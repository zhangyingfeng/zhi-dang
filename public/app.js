const $=id=>document.getElementById(id); const readJson=async r=>{const text=await r.text();try{return JSON.parse(text)}catch{throw Error(r.ok?"应用返回了无法识别的数据。请重启应用后重试。":`应用发生错误（HTTP ${r.status}）。请查看终端中的详细信息。`)}}; const post=(url,body={})=>fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(async r=>{const j=await readJson(r);if(!r.ok)throw Error(j.error||"操作失败");return j});
const invoke=window.__TAURI__.core.invoke;
$("login").onclick=async()=>{
  $("login").disabled=true; $("login").textContent="等待登录...";
  try{
    await invoke("open_login_window");
    await invoke("wait_for_login");
    $("step-login").style.display="none";
    $("step-export").style.display="";
  }catch(e){
    alert(e.message||String(e));
    $("login").disabled=false; $("login").textContent="登录知乎";
  }
};
$("export").onclick=()=>post("/api/export",{outputDir:$("dir").value,downloadImages:$("images").checked,delayMs:900}).catch(e=>alert(e.message));
setInterval(async()=>{try{const {progress:p}=await fetch("/api/status").then(readJson);$("message").textContent=p.message;$("count").textContent=p.total?`${p.current||0} / ${p.total}`:(p.current?String(p.current):"");$("bar").value=p.total?100*(p.current||0)/p.total:0;$("dot").style.background=p.phase==="error"?"#ff6b6b":p.phase==="done"?"#6fdd8b":"#f1c75b"}catch{}},1200);
