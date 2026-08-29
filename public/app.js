const $=id=>document.getElementById(id); const readJson=async r=>{const text=await r.text();try{return JSON.parse(text)}catch{throw Error(r.ok?"应用返回了无法识别的数据。请重启应用后重试。":`应用发生错误（HTTP ${r.status}）。请查看终端中的详细信息。`)}}; const post=(url,body={})=>fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(async r=>{const j=await readJson(r);if(!r.ok)throw Error(j.error||"操作失败");return j});
const invoke=window.__TAURI__.core.invoke;
let urlToken=null;
let lastOutputDir=null;
let loggedIn=false;
let busy=false;

let toastTimer=null;
function showToast(message,isError){
  const t=$("toast");
  t.textContent=message;
  t.className="toast"+(isError?" error":"");
  t.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{t.hidden=true},isError?5000:3000);
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
  $("export").disabled=disabled;
  $("auth-btn").disabled=busy;
}

function setAuthUI(nextLoggedIn,name){
  loggedIn=nextLoggedIn;
  const btn=$("auth-btn");
  btn.textContent=loggedIn?"退出登录":"开始登录";
  btn.classList.toggle("secondary",loggedIn);
  $("step-title").textContent=loggedIn?`欢迎 ${name||""}，可以下载`:"登录知乎导出";
  // Once logged in this line would just repeat the footer's identical
  // sentence ("所有内容...不会上传到任何地方") — hide it instead of
  // showing the same trust message twice and costing an extra row.
  $("auth-status").hidden=loggedIn;
  $("auth-status").textContent="本应用不会保存或上传用户名和密码";
  syncControls();
}

// Relays knowledge-base fetches requested by the Node backend through the
// authenticated login window, since only this (Tauri) side can reach it.
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

relayFrontendFetches();

// On launch, silently check whether the login window already holds a valid
// session (from a previous run) so the user only sees the login step when
// they actually need it.
(async()=>{
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
  if(loggedIn){
    $("auth-btn").disabled=true;
    try{ await invoke("logout"); }catch(e){ showToast(e.message||String(e),true); }
    urlToken=null;
    lastOutputDir=null;
    $("reveal").hidden=true;
    $("status-section").hidden=true;
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
  fetch("/api/about").then(readJson).then(({version})=>{ $("about-version").textContent=version; }).catch(()=>{});
}
function closeAbout(){ $("about-overlay").hidden=true; }
$("about-btn").onclick=openAbout;
$("about-close").onclick=closeAbout;
$("about-overlay").onclick=(e)=>{ if(e.target.id==="about-overlay") closeAbout(); };
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape"&&!$("about-overlay").hidden) closeAbout(); });
$("about-website").onclick=()=>{
  invoke("plugin:opener|open_url",{url:"https://yingfeng.ca"}).catch(e=>showToast(e.message||String(e),true));
};
$("about-repo").onclick=()=>{
  invoke("plugin:opener|open_url",{url:"https://github.com/zhangyingfeng/zhi-dang"}).catch(e=>showToast(e.message||String(e),true));
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
$("export").onclick=async()=>{
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
  $("reveal").hidden=true;
  clearTaskList();
  post("/api/export",{outputDir:$("dir").value,downloadImages:$("images").checked,delayMs:900,urlToken}).catch(e=>showToast(e.message,true));
};
$("reveal").onclick=()=>{
  if(lastOutputDir) invoke("plugin:opener|reveal_item_in_dir",{paths:[lastOutputDir]}).catch(e=>showToast(e.message||String(e),true));
};
$("pause-btn").onclick=()=>{
  const btn=$("pause-btn"); const willPause=btn.textContent==="暂停";
  btn.disabled=true;
  post(willPause?"/api/export/pause":"/api/export/resume").catch(e=>showToast(e.message||String(e),true)).finally(()=>{ btn.disabled=false; });
};
let lastPhase=null;
setInterval(async()=>{try{
  const {progress:p}=await fetch("/api/status").then(readJson);
  $("message").textContent=p.message;
  $("count").textContent=p.total?`${p.current||0} / ${p.total}`:(p.current?String(p.current):"");
  $("bar").value=p.total?100*(p.current||0)/p.total:0;
  $("dot").className=p.phase==="error"?"error":p.phase==="done"?"done":p.phase==="idle"?"idle":"active";
  renderTasks(p.tasks);
  const nextBusy=p.phase==="listing"||p.phase==="exporting";
  if(nextBusy!==busy){ busy=nextBusy; syncControls(); }
  $("export").textContent=busy?"导出中…":"开始导出";
  // Pausing only makes sense once there's an actual export loop running
  // (listing itself can't be paused — it's a couple of quick paginated
  // fetches, not the long per-item work pause targets).
  $("pause-btn").hidden=p.phase!=="exporting";
  $("pause-btn").textContent=p.paused?"继续":"暂停";
  if(p.phase==="done"&&p.outputDir){
    lastOutputDir=p.outputDir;
    $("reveal").hidden=false;
    if(lastPhase!=="done") showToast(`导出完成：${p.outputDir}`);
  }
  lastPhase=p.phase;
}catch{}},1200);
