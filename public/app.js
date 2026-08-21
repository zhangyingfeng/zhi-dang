const $=id=>document.getElementById(id); const readJson=async r=>{const text=await r.text();try{return JSON.parse(text)}catch{throw Error(r.ok?"应用返回了无法识别的数据。请重启应用后重试。":`应用发生错误（HTTP ${r.status}）。请查看终端中的详细信息。`)}}; const post=(url,body={})=>fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(async r=>{const j=await readJson(r);if(!r.ok)throw Error(j.error||"操作失败");return j});
const invoke=window.__TAURI__.core.invoke;
let urlToken=null;

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
  $("login").disabled=true; $("login").textContent="等待登录...";
  try{
    await invoke("open_login_window");
    const result=await invoke("wait_for_login");
    urlToken=result.urlToken;
    $("step-login").style.display="none";
    $("step-export").style.display="";
  }catch(e){
    alert(e.message||String(e));
    $("login").disabled=false; $("login").textContent="登录知乎";
  }
};
$("export").onclick=async()=>{
  if(!urlToken){
    try{ urlToken=(await invoke("zhihu_me")).urlToken; }catch{}
  }
  if(!urlToken){
    alert("登录状态已丢失，请重新登录。");
    $("step-login").style.display=""; $("step-export").style.display="none";
    $("login").disabled=false; $("login").textContent="登录知乎";
    return;
  }
  post("/api/export",{outputDir:$("dir").value,downloadImages:$("images").checked,delayMs:900,urlToken}).catch(e=>alert(e.message));
};
setInterval(async()=>{try{const {progress:p}=await fetch("/api/status").then(readJson);$("message").textContent=p.message;$("count").textContent=p.total?`${p.current||0} / ${p.total}`:(p.current?String(p.current):"");$("bar").value=p.total?100*(p.current||0)/p.total:0;$("dot").style.background=p.phase==="error"?"#ff6b6b":p.phase==="done"?"#6fdd8b":"#f1c75b"}catch{}},1200);
