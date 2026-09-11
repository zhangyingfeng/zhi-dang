const $=id=>document.getElementById(id); const readJson=async r=>{const text=await r.text();try{return JSON.parse(text)}catch{throw Error(r.ok?"应用返回了无法识别的数据。请重启应用后重试。":`应用发生错误（HTTP ${r.status}）。请查看终端中的详细信息。`)}}; const post=(url,body={})=>fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(async r=>{const j=await readJson(r);if(!r.ok)throw Error(j.error||"操作失败");return j});
const invoke=window.__TAURI__.core.invoke;
let urlToken=null;
let accessSecret=null;
// "direct" (default) or "official" — set once at startup from /api/about
// and never changed after; everything below that branches on it is the
// entire visible difference between the two editions (see
// src/source/types.ts's ContentSource for the corresponding backend seam).
let edition="direct";
let lastOutputDir=null;
let loggedIn=false;
let busy=false;
// Last known remaining "creator" quota for the official edition — null
// means unknown (not yet checked, or the last check failed), 0 means today's
// "我的创作全文" quota is confirmed exhausted. Kept up to date by every
// checkOfficialQuota() call (login, refreshQuotaDisplay) and consulted by
// syncControls()/the status poll to keep "开始导出" disabled rather than
// letting the user start a run that can only fail on the very first item.
let officialQuotaRemaining=null;
function officialQuotaExhausted(){ return edition==="official"&&officialQuotaRemaining===0; }

// The official edition has no API that returns the account holder's own
// name/url_token (checked every documented endpoint — none echo it back,
// looks deliberate on Zhihu's side, not a gap). This is a user-supplied
// substitute, not a fetched one: paste your own profile URL once, parsed
// locally into the same url_token direct-connect already uses for the
// welcome text and default folder name. It's not a secret, so it lives in
// this WKWebView's own localStorage rather than the Keychain (Access Secret
// storage, see save_access_secret/get_access_secret) — never sent anywhere,
// never verified against Zhihu.
const PROFILE_URL_STORAGE_KEY="zhidang-official-profile-url";
function parseZhihuUrlToken(input){
  return /zhihu\.com\/people\/([^/?#]+)/i.exec((input||"").trim())?.[1]||null;
}

let toastTimer=null;
function showToast(message,isError){
  const t=$("toast");
  t.textContent=message;
  t.className="toast"+(isError?" error":"");
  t.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{t.hidden=true},isError?5000:3000);
}

// Lets the user step away during a long export and still know when it's
// done, without this app playing its own sound — the system notification's
// sound (or lack of one, under Do Not Disturb etc.) already follows
// whatever the user has set for notifications in general, which is more
// considerate than the app overriding that. Uses the plain Web Notification
// API directly (no @tauri-apps/plugin-notification import): the WKWebView
// backing this window routes it to the real macOS notification center, and
// this app has no bundler for public/app.js to import an npm package into
// anyway — every other plugin call here goes through the same window.*
// globals for that reason.
async function ensureNotificationPermission(){
  if(window.Notification.permission==="granted") return true;
  if(window.Notification.permission==="denied") return false;
  try{ return (await window.Notification.requestPermission())==="granted"; }catch{ return false; }
}
function notify(title,body){
  if(window.Notification.permission==="granted"){ try{ new window.Notification(title,{body}); }catch{} }
}

// Measures the page's own rendered height rather than using a guessed
// constant, so the window always fits exactly (no scrollbar, no dead
// space) regardless of font-rendering differences between the WKWebView
// used in the packaged app and whatever this was last tuned against.
//
// Uses the last element's actual bottom position rather than
// document.body.scrollHeight: <main>'s margin-top collapses through the
// (border/padding-less) <body>, so scrollHeight silently undercounts it —
// getBoundingClientRect() isn't fooled by margin collapse.
//
// A fixed allowance can't be trusted to always be enough (WKWebView's own
// chrome/rendering can differ from what this was tuned against), so after
// resizing once, re-check whether the viewport is still shorter than the
// content and top up the difference if so, instead of guessing harder.
async function resizeToContent(){
  const titlebarAllowance=32;
  const measureContent=()=>document.querySelector("footer").getBoundingClientRect().bottom;
  const target=measureContent()+titlebarAllowance;
  await invoke("resize_main_window",{height:target}).catch(()=>{});
  await new Promise(r=>setTimeout(r,150));
  const overflow=document.documentElement.scrollHeight-window.innerHeight;
  if(overflow>0){
    invoke("resize_main_window",{height:target+overflow+8}).catch(()=>{});
  }
}

// Renders the per-item/per-subtask task list (see src/types.ts's ExportTask)
// incrementally rather than rebuilding the DOM every poll: rows are created
// once per item id and then only patched in place, so scrolling through a
// long list — or an expanded detail panel — isn't reset out from under the
// user every 1.2s.
//
// Row layout is deliberately minimal — status dot, kind badge, title, and an
// actions slot (expand toggle + skip) — subtask/image detail is demoted
// into a collapsed-by-default panel instead of competing with those
// controls for space on the row.
const statusLabel=s=>s==="active"?"进行中":s==="done"?"完成":s==="error"?"失败":s==="skipped"?"已跳过":"未开始";
const subTaskLabel=key=>key==="images"?"图片":"写入";
const taskRows=new Map();
function clearTaskList(){
  taskRows.clear();
  $("task-list").replaceChildren();
  $("task-list").hidden=true;
}
function buildTaskRow(t){
  const item=document.createElement("div"); item.className="task-item";
  const row=document.createElement("div"); row.className="task-row";
  const dot=document.createElement("span"); dot.className="task-dot";
  const kind=document.createElement("span"); kind.className="task-kind"; kind.textContent=t.kind==="answer"?"回答":"文章";
  const title=document.createElement("span"); title.className="task-title"; title.textContent=t.title;
  // Read-only hint only — exact-content duplicate candidates are flagged
  // here so the user can see them, but no merge/skip action exists yet
  // (that's a later "管理" pass); hidden by default, toggled in patchTaskRow.
  const dup=document.createElement("span"); dup.className="task-dup"; dup.textContent="疑似重复"; dup.hidden=true;
  const actions=document.createElement("span"); actions.className="task-actions";
  // Only meaningful while the item hasn't started — skipping something
  // already in flight or finished would mean touching a file already
  // written, which is out of scope here (see server.ts's /api/export/skip).
  const skipBtn=document.createElement("button"); skipBtn.type="button"; skipBtn.className="task-skip"; skipBtn.textContent="跳过"; skipBtn.hidden=true;
  skipBtn.onclick=()=>{ skipBtn.disabled=true; post("/api/export/skip",{id:t.id,scope:"item"}).catch(e=>{ skipBtn.disabled=false; showToast(e.message||String(e),true); }); };
  const expandBtn=document.createElement("button"); expandBtn.type="button"; expandBtn.className="task-expand"; expandBtn.textContent="▸"; expandBtn.setAttribute("aria-label","展开详情");
  actions.append(skipBtn,expandBtn);
  row.append(dot,kind,title,dup,actions);

  const detail=document.createElement("div"); detail.className="task-detail"; detail.hidden=true;
  const subEls=new Map();
  for(const s of t.subtasks){
    const subRow=document.createElement("div"); subRow.className="task-detail-row";
    const subDot=document.createElement("span"); subDot.className="task-dot";
    const subLabelEl=document.createElement("span"); subLabelEl.textContent=subTaskLabel(s.key);
    subRow.append(subDot,subLabelEl);
    const entry={dot:subDot,label:subLabelEl};
    if(s.key==="images"){
      const skipImagesBtn=document.createElement("button"); skipImagesBtn.type="button"; skipImagesBtn.className="task-skip"; skipImagesBtn.textContent="跳过图片"; skipImagesBtn.hidden=true;
      skipImagesBtn.onclick=()=>{ skipImagesBtn.disabled=true; post("/api/export/skip",{id:t.id,scope:"images"}).catch(e=>{ skipImagesBtn.disabled=false; showToast(e.message||String(e),true); }); };
      subRow.appendChild(skipImagesBtn); entry.skipBtn=skipImagesBtn;
      const list=document.createElement("div"); list.className="task-image-list"; detail.appendChild(subRow); detail.appendChild(list); entry.list=list; entry.imageEls=new Map();
    }else{
      detail.appendChild(subRow);
    }
    subEls.set(s.key,entry);
  }
  expandBtn.onclick=()=>{
    const willExpand=detail.hidden;
    detail.hidden=!willExpand; expandBtn.textContent=willExpand?"▾":"▸";
    resizeToContent();
  };
  item.append(row,detail);
  return {item,dot,dup,skipBtn,subEls};
}
function patchTaskRow(entry,t){
  entry.item.classList.toggle("skipped",t.status==="skipped");
  entry.dot.className="task-dot "+t.status;
  entry.dot.title=statusLabel(t.status)+(t.error?`：${t.error}`:"");
  entry.dup.hidden=!t.duplicate;
  if(t.duplicate) entry.dup.title=`与 ${t.duplicate.otherTitles.length} 项内容完全一致：${t.duplicate.otherTitles.join("、")}`;
  entry.skipBtn.hidden=t.status!=="pending";
  for(const s of t.subtasks){
    const sub=entry.subEls.get(s.key); if(!sub) continue;
    sub.dot.className="task-dot "+s.status; sub.dot.title=statusLabel(s.status);
    sub.label.textContent=subTaskLabel(s.key)+(s.key==="images"&&s.images?` (${s.images.length})`:"");
    if(sub.skipBtn) sub.skipBtn.hidden=s.status!=="pending";
    if(s.key!=="images"||!s.images) continue;
    for(const img of s.images){
      let ie=sub.imageEls.get(img.url);
      if(!ie){
        const row=document.createElement("div"); row.className="task-image-row";
        const dot=document.createElement("span"); dot.className="task-dot";
        const label=document.createElement("span"); label.className="task-image-url"; label.textContent=img.url;
        row.append(dot,label); sub.list.appendChild(row);
        ie={dot,label}; sub.imageEls.set(img.url,ie);
      }
      ie.dot.className="task-dot "+img.status; ie.dot.title=statusLabel(img.status)+(img.error?`：${img.error}`:"");
      ie.label.title=img.url+(img.error?`\n${img.error}`:"");
    }
  }
}
function renderTasks(tasks){
  const list=$("task-list");
  const wasHidden=list.hidden;
  if(!tasks||!tasks.length){ if(!wasHidden){ list.hidden=true; resizeToContent(); } return; }
  for(const t of tasks){
    let entry=taskRows.get(t.id);
    if(!entry){ entry=buildTaskRow(t); list.appendChild(entry.item); taskRows.set(t.id,entry); }
    patchTaskRow(entry,t);
  }
  if(wasHidden){ list.hidden=false; resizeToContent(); }
}

function syncControls(){
  const disabled=!loggedIn||busy;
  $("dir").disabled=disabled;
  $("browse").disabled=disabled;
  $("images").disabled=disabled;
  // Quota exhaustion only blocks starting a *new* run — 保存位置/图片选项
  // stay editable so the user can still prepare for tomorrow, and the
  // status poll below independently governs "开始导出" the rest of the
  // time (once an export is running/just finished) so this call only needs
  // to win the case syncControls itself is called from: right after login.
  $("export").disabled=disabled||officialQuotaExhausted();
  $("auth-btn").disabled=busy;
}

function setAuthUI(nextLoggedIn,name,detail){
  loggedIn=nextLoggedIn;
  const isOfficial=edition==="official";
  const btn=$("auth-btn");
  // "保存" undersold what this click does — it validates the secret against
  // Zhihu (checkOfficialQuota) before ever persisting it, so "验证并登录"
  // names the actual effect instead of implying a plain settings save.
  btn.textContent=loggedIn?"退出登录":isOfficial?"验证并登录":"开始登录";
  btn.classList.toggle("secondary",loggedIn);
  $("step-title").textContent=loggedIn?(name?`欢迎 ${name}，可以下载`:(isOfficial?"知乎官方 API 已连接":"可以下载")):isOfficial?"配置知乎官方 API":"登录知乎导出";
  if(loggedIn&&isOfficial){
    // Access Secret auth has no equivalent of a display name (only Zhihu
    // OAuth exposes profile info, and this edition deliberately doesn't use
    // OAuth) — show today's remaining "创作能力" quota here instead, since
    // that's the one piece of real account state this auth mode actually
    // has, via checkOfficialQuota/formatQuotaLine below. The "额度说明" link
    // only makes sense next to this line, so it's shown/hidden together.
    $("auth-status").hidden=false;
    $("auth-status-text").textContent=detail||"官方 API 已连接";
    $("quota-help-btn").hidden=false;
  }else{
    // Once logged in (direct edition) this line would just repeat the
    // footer's identical sentence ("所有内容...不会上传到任何地方") — hide
    // it instead of showing the same trust message twice and costing an
    // extra row.
    $("auth-status").hidden=loggedIn;
    $("auth-status-text").textContent=isOfficial?"Access Secret 只保存在本机系统钥匙串，不会上传到任何地方":"本应用不会保存或上传用户名和密码";
    $("quota-help-btn").hidden=true;
  }
  $("secret-row").hidden=loggedIn||!isOfficial;
  $("profile-row").hidden=loggedIn||!isOfficial;
  // Nothing about "保存位置"/"下载正文图片"/"开始导出" is meaningful before
  // there's an authenticated account to export *from* — shown only once
  // logged in, hidden again on logout, rather than just grayed out while
  // still visible.
  $("save-location-row").hidden=!loggedIn;
  $("download-actions").hidden=!loggedIn;
  syncControls();
}

// Validates an Access Secret against Zhihu's official platform *before* it's
// trusted anywhere — the quota endpoint is the right probe for this because
// it (a) requires real auth so a bad/expired secret fails exactly like it
// would on export, and (b) is explicitly documented as not consuming any
// daily quota, unlike actually trying to list or fetch content just to test.
async function checkOfficialQuota(secret){
  const res=await fetch(`/api/official/quota?accessSecret=${encodeURIComponent(secret)}`);
  const body=await readJson(res);
  if(!res.ok) throw new Error(body.error||"验证 Access Secret 失败");
  return body.quota;
}
// Also updates officialQuotaRemaining as a side effect — every call site
// that wants the display text also wants "开始导出" gated on the same
// number, so keeping them in the same function makes it impossible for one
// to update without the other.
function formatQuotaLine(quotaList){
  const creator=(quotaList||[]).find((q)=>q.apiId==="creator");
  officialQuotaRemaining=creator?creator.remaining:null;
  if(!creator) return "官方 API 已连接";
  return `官方 API 已连接 · 今日创作能力额度剩余 ${creator.remaining}/${creator.total} 次`;
}
// Called right after login and again whenever an export run finishes —
// those are the only moments the number can actually have changed, so this
// deliberately isn't on the 1.2s status-poll timer (that would just be
// hammering Zhihu's servers for a number nothing has updated).
async function refreshQuotaDisplay(){
  if(edition!=="official"||!loggedIn||!accessSecret) return;
  try{ $("auth-status-text").textContent=formatQuotaLine(await checkOfficialQuota(accessSecret)); syncControls(); }catch{}
}

// Relays knowledge-base fetches requested by the Node backend through the
// authenticated login window, since only this (Tauri) side can reach it.
// Only meaningful for the direct edition: the official edition's backend
// (src/index.official.ts) calls Zhihu's open platform directly over plain
// HTTP and never queues anything here, so this loop is simply never started
// for it (see the startup block below).
async function relayFrontendFetches(){
  for(;;){
    let next;
    try{ next=await fetch("/api/frontend-fetch-request").then(readJson); }
    catch{ await new Promise(r=>setTimeout(r,2000)); continue; }
    if(!next) continue;
    let status=0,body="";
    try{ [status,body]=await invoke("zhihu_fetch",{url:next.url}); }
    catch(e){ status=0; body=String(e); }
    await post("/api/frontend-fetch-result",{id:next.id,status,body}).catch(()=>{});
  }
}

// On launch: find out which edition this build is (the one thing that
// decides which of the two auth flows below applies), then silently check
// whether that edition's credential is already in place from a previous run
// — the login window's session for direct, the Keychain-stored Access
// Secret for official — so the user only sees the auth step when they
// actually need it.
(async()=>{
  try{ const about=await fetch("/api/about").then(readJson); if(about.edition) edition=about.edition; }catch{}
  if(edition==="official"){
    try{
      const configured=await invoke("has_access_secret");
      if(configured){
        accessSecret=await invoke("get_access_secret");
        try{ urlToken=parseZhihuUrlToken(localStorage.getItem(PROFILE_URL_STORAGE_KEY)); }catch{ urlToken=null; }
        $("dir").value=urlToken||"exports";
        $("status-section").hidden=false;
        // Best-effort: a momentary network hiccup at launch shouldn't force
        // re-entering the secret, so a failed quota check here still leaves
        // the user logged in — just without the quota line filled in yet.
        let detail;
        try{ detail=formatQuotaLine(await checkOfficialQuota(accessSecret)); }catch{}
        setAuthUI(true,urlToken,detail);
        resizeToContent();
        if(officialQuotaExhausted()) showToast("今日创作能力额度已用完，请明天再继续导出。",true);
        return;
      }
    }catch{}
    setAuthUI(false);
    resizeToContent();
    return;
  }
  relayFrontendFetches();
  try{
    const r=await invoke("check_login_status");
    if(r.loggedIn){
      urlToken=r.urlToken;
      $("dir").value=urlToken||"exports";
      $("status-section").hidden=false;
      setAuthUI(true,r.name);
      resizeToContent();
      return;
    }
  }catch{}
  setAuthUI(false);
  resizeToContent();
})();

$("auth-btn").onclick=async()=>{
  if(edition==="official"){
    if(loggedIn){
      $("auth-btn").disabled=true;
      try{ await invoke("clear_access_secret"); }catch(e){ showToast(e.message||String(e),true); }
      await post("/api/reset").catch(()=>{});
      accessSecret=null;
      urlToken=null;
      lastOutputDir=null;
      completedAtDir=null;
      $("secret-input").value="";
      $("profile-input").value="";
      try{ localStorage.removeItem(PROFILE_URL_STORAGE_KEY); }catch{}
      $("dir").value="exports";
      $("status-section").hidden=true;
      clearTaskList();
      setAuthUI(false);
      resizeToContent();
      showToast("已退出登录");
      return;
    }
    const secret=$("secret-input").value.trim();
    if(!secret){ showToast("请先粘贴 Access Secret",true); return; }
    $("auth-btn").disabled=true;
    // Validate against Zhihu before accepting it as "logged in" — a bad
    // secret should never get past this screen (it would otherwise only
    // surface as a confusing failure the first time an export runs).
    let quota;
    try{ quota=await checkOfficialQuota(secret); }
    catch(e){ showToast(e.message||String(e),true); $("auth-btn").disabled=false; return; }
    try{
      await invoke("save_access_secret",{secret});
      accessSecret=secret;
      // Not a secret, so this lives in localStorage rather than going
      // through save_access_secret's Keychain path — see
      // PROFILE_URL_STORAGE_KEY's doc comment above.
      urlToken=parseZhihuUrlToken($("profile-input").value);
      try{ if(urlToken) localStorage.setItem(PROFILE_URL_STORAGE_KEY,$("profile-input").value.trim()); else localStorage.removeItem(PROFILE_URL_STORAGE_KEY); }catch{}
      $("dir").value=urlToken||"exports";
      $("status-section").hidden=false;
      setAuthUI(true,urlToken,formatQuotaLine(quota));
      resizeToContent();
      if(officialQuotaExhausted()) showToast("今日创作能力额度已用完，请明天再开始导出。",true);
    }catch(e){
      showToast(e.message||String(e),true);
      $("auth-btn").disabled=false;
    }
    return;
  }
  if(loggedIn){
    $("auth-btn").disabled=true;
    try{ await invoke("logout"); }catch(e){ showToast(e.message||String(e),true); }
    await post("/api/reset").catch(()=>{});
    urlToken=null;
    lastOutputDir=null;
    completedAtDir=null;
    $("dir").value="exports";
    $("status-section").hidden=true;
    clearTaskList();
    setAuthUI(false);
    resizeToContent();
    showToast("已退出登录");
    return;
  }
  $("auth-btn").disabled=true;
  try{
    await invoke("open_login_window");
    const result=await invoke("wait_for_login");
    urlToken=result.urlToken;
    $("dir").value=urlToken||"exports";
    $("status-section").hidden=false;
    setAuthUI(true,result.name);
    resizeToContent();
  }catch(e){
    showToast(e.message||String(e),true);
    $("auth-btn").disabled=false;
  }
};
function openAbout(){
  $("about-overlay").hidden=false;
  fetch("/api/about").then(readJson).then(({version,edition:e})=>{
    $("about-version").textContent=version;
    $("about-edition").textContent=e==="official"?"官方 API 版":"直连版";
  }).catch(()=>{});
}
function closeAbout(){ $("about-overlay").hidden=true; }
$("about-btn").onclick=openAbout;
$("about-close").onclick=closeAbout;
$("about-overlay").onclick=(e)=>{ if(e.target.id==="about-overlay") closeAbout(); };
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"&&!$("about-overlay").hidden) closeAbout(); });
$("about-website").onclick=()=>{
  invoke("plugin:opener|open_url",{url:"https://yingfeng.ca/zhi-dang"}).catch(e=>showToast(e.message||String(e),true));
};
$("about-repo").onclick=()=>{
  invoke("plugin:opener|open_url",{url:"https://github.com/zhangyingfeng/zhi-dang"}).catch(e=>showToast(e.message||String(e),true));
};

// Only relevant to the official edition — "额度说明" next to the quota line
// (hidden/shown by setAuthUI) opens this same overlay pattern as "关于".
function openQuotaHelp(){ $("quota-overlay").hidden=false; }
function closeQuotaHelp(){ $("quota-overlay").hidden=true; }
$("quota-help-btn").onclick=openQuotaHelp;
$("quota-close").onclick=closeQuotaHelp;
$("quota-overlay").onclick=(e)=>{ if(e.target.id==="quota-overlay") closeQuotaHelp(); };
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"&&!$("quota-overlay").hidden) closeQuotaHelp(); });
$("quota-docs-link").onclick=()=>{
  invoke("plugin:opener|open_url",{url:"https://developer.zhihu.com/docs?key=quota"}).catch(e=>showToast(e.message||String(e),true));
};
$("quota-profile-link").onclick=()=>{
  invoke("plugin:opener|open_url",{url:"https://developer.zhihu.com/profile"}).catch(e=>showToast(e.message||String(e),true));
};
// Lets someone without an Access Secret yet jump straight to where one is
// generated, instead of having to already know that URL.
$("secret-help-link").onclick=()=>{
  invoke("plugin:opener|open_url",{url:"https://developer.zhihu.com/profile"}).catch(e=>showToast(e.message||String(e),true));
};
// Lets the macOS menu bar's "关于知档" item (see lib.rs's custom About menu
// item) open this same in-page panel instead of a separate native dialog.
window.__TAURI__.event.listen("show-about",openAbout);
$("browse").onclick=async()=>{
  try{
    const selected=await invoke("plugin:dialog|open",{options:{directory:true,multiple:false,title:"选择保存位置"}});
    if(selected) $("dir").value=selected;
  }catch(e){ showToast(e.message||String(e),true); }
};
// A single button that swaps roles instead of two side-by-side buttons: once
// an export finishes, "开始导出" turns into "在访达中显示" (same button, new
// label and click behavior) rather than disabling one and revealing another
// next to it. It swaps back the moment "保存位置" changes to anything other
// than the directory that just finished — see the mode toggle in the
// polling loop below.
$("export").onclick=async()=>{
  if($("export").dataset.mode==="reveal"){
    if(lastOutputDir) invoke("plugin:opener|reveal_item_in_dir",{paths:[lastOutputDir]}).catch(e=>showToast(e.message||String(e),true));
    return;
  }
  const credentialField=edition==="official"?"accessSecret":"urlToken";
  if(edition==="official"){
    if(!accessSecret){ try{ accessSecret=await invoke("get_access_secret"); }catch{} }
    if(!accessSecret){
      showToast("Access Secret 已丢失，请重新配置。",true);
      $("status-section").hidden=true;
      setAuthUI(false);
      resizeToContent();
      return;
    }
  }else{
    if(!urlToken){
      try{ urlToken=(await invoke("zhihu_me")).urlToken; }catch{}
    }
    if(!urlToken){
      showToast("登录状态已丢失，请重新登录。",true);
      $("status-section").hidden=true;
      setAuthUI(false);
      resizeToContent();
      return;
    }
  }
  completedAtDir=null;
  clearTaskList();
  ensureNotificationPermission();
  post("/api/export",{outputDir:$("dir").value,downloadImages:$("images").checked,delayMs:900,[credentialField]:edition==="official"?accessSecret:urlToken}).catch(e=>showToast(e.message,true));
};
$("pause-btn").onclick=()=>{
  const btn=$("pause-btn"); const willPause=btn.textContent==="暂停";
  btn.disabled=true;
  post(willPause?"/api/export/pause":"/api/export/resume").catch(e=>showToast(e.message||String(e),true)).finally(()=>{ btn.disabled=false; });
};
let lastPhase=null;
// The directory that was current at the moment an export finished. While
// "保存位置" still holds that exact value, the button stays in "在访达中
// 显示" mode; the moment it no longer matches (typed, or picked via
// "浏览…"), the button swaps back to "开始导出" for a fresh run. Comparing
// values on every tick, rather than listening for input events, means it
// doesn't matter *how* the field changed.
let completedAtDir=null;
setInterval(async()=>{try{
  const {progress:p}=await fetch("/api/status").then(readJson);
  // The backend's progress/tasks belong to whatever export last ran and
  // aren't reset on logout (logout is a Tauri-side session clear, not an
  // HTTP call) — without this guard, the very next tick would flip the
  // button back to "在访达中显示" and repopulate the task list right after
  // clearTaskList() clears them, since the stale data is still sitting in
  // /api/status.
  if(!loggedIn) return;
  $("message").textContent=p.message;
  $("count").textContent=p.total?`${p.current||0} / ${p.total}`:(p.current?String(p.current):"");
  $("bar").value=p.total?100*(p.current||0)/p.total:0;
  // "quota" (see src/types.ts's Progress.phase) means the official edition
  // stopped early — quota exhausted, not every item finished — but there's
  // still a real, partial, resumable archive at p.outputDir, so it's
  // rendered the same as "done" rather than as an error.
  const finished=p.phase==="done"||p.phase==="quota";
  $("dot").className=p.phase==="error"?"error":finished?"done":p.phase==="idle"?"idle":"active";
  renderTasks(p.tasks);
  const nextBusy=p.phase==="listing"||p.phase==="exporting";
  if(nextBusy!==busy){ busy=nextBusy; syncControls(); }
  if(finished&&p.outputDir){
    lastOutputDir=p.outputDir;
    if(lastPhase!==p.phase){
      showToast(p.phase==="quota"?p.message:`导出完成：${p.outputDir}`);
      notify("知档",p.message||`导出完成：${p.outputDir}`);
      // The quota stop is easy to miss if it's only a toast (auto-dismisses
      // in 3-5s) or a system notification (silent if the OS one is muted,
      // or the app isn't focused) — whether it happened before a single
      // item was exported or 166 items in, the user needs to actually see
      // why the run stopped short, not just infer it from a static message
      // line. A native modal blocks until acknowledged.
      if(p.phase==="quota") invoke("plugin:dialog|message",{message:p.message,title:"知档 · 官方 API 配额已用完",kind:"warning"}).catch(()=>{});
      completedAtDir=$("dir").value;
      refreshQuotaDisplay();
    }
  }
  const justCompleted=finished&&completedAtDir!==null&&$("dir").value===completedAtDir;
  $("export").dataset.mode=justCompleted?"reveal":"export";
  $("export").textContent=justCompleted?"在访达中显示":busy?"导出中…":"开始导出";
  // "在访达中显示" (justCompleted) opens Finder, not a new export — quota
  // has no bearing on that action, so it's excluded from this check.
  $("export").disabled=justCompleted?false:(busy||!loggedIn||officialQuotaExhausted());
  $("export").title=(!justCompleted&&officialQuotaExhausted())?"今日创作能力额度已用完，请明天再继续导出":"";
  // Pausing only makes sense once there's an actual export loop running
  // (listing itself can't be paused — it's a couple of quick paginated
  // fetches, not the long per-item work pause targets).
  $("pause-btn").hidden=p.phase!=="exporting";
  $("pause-btn").textContent=p.paused?"继续":"暂停";
  lastPhase=p.phase;
}catch{}},1200);
