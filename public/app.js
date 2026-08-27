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
  $("auth-status").textContent=loggedIn?"所有内容和登录会话仅保存在这台电脑，不会上传到任何地方。":"本应用不会保存或上传用户名和密码";
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
  post("/api/export",{outputDir:$("dir").value,downloadImages:$("images").checked,delayMs:900,urlToken}).catch(e=>showToast(e.message,true));
};
$("reveal").onclick=()=>{
  if(lastOutputDir) invoke("plugin:opener|reveal_item_in_dir",{paths:[lastOutputDir]}).catch(e=>showToast(e.message||String(e),true));
};
let lastPhase=null;
setInterval(async()=>{try{
  const {progress:p}=await fetch("/api/status").then(readJson);
  $("message").textContent=p.message;
  $("count").textContent=p.total?`${p.current||0} / ${p.total}`:(p.current?String(p.current):"");
  $("bar").value=p.total?100*(p.current||0)/p.total:0;
  $("dot").className=p.phase==="error"?"error":p.phase==="done"?"done":p.phase==="idle"?"idle":"active";
  const nextBusy=p.phase==="listing"||p.phase==="exporting";
  if(nextBusy!==busy){ busy=nextBusy; syncControls(); }
  $("export").textContent=busy?"导出中…":"开始导出";
  if(p.phase==="done"&&p.outputDir){
    lastOutputDir=p.outputDir;
    $("reveal").hidden=false;
    if(lastPhase!=="done") showToast(`导出完成：${p.outputDir}`);
  }
  lastPhase=p.phase;
}catch{}},1200);
