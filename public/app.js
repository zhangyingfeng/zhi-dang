const $=id=>document.getElementById(id); const readJson=async r=>{const text=await r.text();try{return JSON.parse(text)}catch{throw Error(r.ok?"应用返回了无法识别的数据。请重启应用后重试。":`应用发生错误（HTTP ${r.status}）。请查看终端中的详细信息。`)}}; const post=(url,body={})=>fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(async r=>{const j=await readJson(r);if(!r.ok)throw Error(j.error||"操作失败");return j});
const invoke=window.__TAURI__.core.invoke;
let urlToken=null;
let lastOutputDir=null;

let toastTimer=null;
function showToast(message,isError){
  const t=$("toast");
  t.textContent=message;
  t.className="toast"+(isError?" error":"");
  t.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{t.hidden=true},isError?5000:3000);
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

$("login").onclick=async()=>{
  $("login").disabled=true;
  try{
    await invoke("open_login_window");
    const result=await invoke("wait_for_login");
    urlToken=result.urlToken;
    $("dir").value=urlToken||"exports";
    $("step-login").style.display="none";
    $("step-export").style.display="";
    $("status-section").hidden=false;
    invoke("resize_main_window",{height:500}).catch(()=>{});
  }catch(e){
    showToast(e.message||String(e),true);
    $("login").disabled=false;
  }
};
$("logout").onclick=async()=>{
  try{ await invoke("logout"); }catch(e){ showToast(e.message||String(e),true); }
  urlToken=null;
  lastOutputDir=null;
  $("reveal").hidden=true;
  $("step-export").style.display="none";
  $("step-login").style.display="";
  $("status-section").hidden=true;
  $("login").disabled=false;
  invoke("resize_main_window",{height:280}).catch(()=>{});
  showToast("已退出登录");
};
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
    $("step-login").style.display=""; $("step-export").style.display="none";
    $("status-section").hidden=true;
    $("login").disabled=false;
    invoke("resize_main_window",{height:280}).catch(()=>{});
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
  if(p.phase==="done"&&p.outputDir){
    lastOutputDir=p.outputDir;
    $("reveal").hidden=false;
    if(lastPhase!=="done") showToast(`导出完成：${p.outputDir}`);
  }
  lastPhase=p.phase;
}catch{}},1200);
