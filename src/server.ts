import express from "express";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { ZhihuClient } from "./zhihu.js";
import { Exporter } from "./exporter.js";
import { assertSafeEmptyOutputDir } from "./util.js";
import type { Progress } from "./types.js";

const root=process.cwd(); const dataDir=path.join(root,".data");
const client=new ZhihuClient(dataDir); const exporter=new Exporter(client); let progress:Progress={phase:"idle",message:"准备就绪"}; let loggedIn=false;
const app=express(); app.use(express.json()); app.use(express.static(path.join(root,"public")));
app.get("/api/status",(_req,res)=>res.json({progress,loggedIn}));
app.post("/api/login",async(_req,res)=>{ try{loggedIn=false;progress={phase:"login",message:"请在打开的 Chrome 窗口中登录知乎"};await client.login();res.json({ok:true});}catch(e){const message=e instanceof Error?e.message:String(e);progress={phase:"error",message};res.status(500).json({error:`无法打开登录窗口：${message}`});} });
app.post("/api/wait-login",async(_req,res)=>{ try{await client.waitForLogin(); loggedIn=true; progress={phase:"idle",message:"登录成功"}; res.json({ok:true});}catch(e){loggedIn=false;const message=e instanceof Error?e.message:String(e);progress={phase:"error",message};res.status(400).json({error:message})} });
app.post("/api/export",async(req,res)=>{ const parsed=z.object({outputDir:z.string().min(1).default("exports"),downloadImages:z.boolean().default(true),delayMs:z.number().min(300).max(10000).default(900)}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:parsed.error.message}); if(progress.phase==="listing"||progress.phase==="exporting") return res.status(409).json({error:"已有导出任务正在运行"}); const out=path.resolve(root,parsed.data.outputDir); try{await assertSafeEmptyOutputDir(out,[path.parse(out).root,os.homedir(),root],[dataDir,path.join(root,"node_modules"),path.join(root,"dist")]);}catch(e){return res.status(400).json({error:e instanceof Error?e.message:String(e)});} const account=await client.me().catch(()=>null); if(!account){loggedIn=false;return res.status(401).json({error:"请先登录知乎"});} loggedIn=true; res.json({ok:true}); void (async()=>{try{progress={phase:"listing",message:"正在获取回答列表",current:0}; const answerResult=await client.list("answer",account.url_token,n=>progress={phase:"listing",message:`已获取 ${n} 个回答`,current:n}); progress={phase:"listing",message:"正在获取文章列表",current:0}; const articleResult=await client.list("article",account.url_token,n=>progress={phase:"listing",message:`已获取 ${n} 篇文章`,current:n}); const answers=answerResult.items; const articles=articleResult.items; const items=[...answers,...articles].sort((a,b)=>b.created-a.created); await exporter.export(items,[answerResult.report,articleResult.report],{...parsed.data,outputDir:out},(i,total,title)=>progress={phase:"exporting",message:title,current:i,total}); const duplicateCount=answerResult.report.duplicates+articleResult.report.duplicates; progress={phase:"done",message:`完成：${answers.length} 个回答，${articles.length} 篇文章${duplicateCount?`；已去重 ${duplicateCount} 条重复记录`:""}`,current:items.length,total:items.length};}catch(e){progress={phase:"error",message:e instanceof Error?e.message:String(e)}}})(); });
app.post("/api/close",async(_req,res)=>{await client.close();loggedIn=false;progress={phase:"idle",message:"浏览器已关闭"};res.json({ok:true})});
const port=Number(process.env.PORT||4317); app.listen(port,"127.0.0.1",()=>console.log(`知档已启动：http://127.0.0.1:${port}`));

let shuttingDown=false;
async function shutdown(signal:NodeJS.Signals){ if(shuttingDown)return; shuttingDown=true; console.log(`收到 ${signal}，正在关闭浏览器...`); await client.close().catch(()=>undefined); process.exit(0); }
process.on("SIGINT",()=>shutdown("SIGINT")); process.on("SIGTERM",()=>shutdown("SIGTERM"));
