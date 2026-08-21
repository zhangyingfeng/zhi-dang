import express from "express";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { paginateListing, buildListingUrl } from "./zhihu.js";
import { Exporter } from "./exporter.js";
import { assertSafeEmptyOutputDir } from "./util.js";
import { fetchViaFrontend, waitForFrontendRequest, submitFrontendResult } from "./frontendBridge.js";
import type { Progress } from "./types.js";

const root=process.cwd();
const exporter=new Exporter(); let progress:Progress={phase:"idle",message:"准备就绪"};
const app=express(); app.use(express.json({limit:"10mb"})); app.use(express.static(path.join(root,"public")));
app.get("/api/status",(_req,res)=>res.json({progress}));
app.get("/api/frontend-fetch-request",async(_req,res)=>{ const next=await waitForFrontendRequest(25000); res.json(next); });
app.post("/api/frontend-fetch-result",(req,res)=>{ const parsed=z.object({id:z.number(),status:z.number(),body:z.string()}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:parsed.error.message}); submitFrontendResult(parsed.data.id,parsed.data.status,parsed.data.body); res.json({ok:true}); });
app.post("/api/export",async(req,res)=>{ const parsed=z.object({outputDir:z.string().min(1).default("exports"),downloadImages:z.boolean().default(true),delayMs:z.number().min(300).max(10000).default(900),urlToken:z.string().min(1)}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:parsed.error.message}); if(progress.phase==="listing"||progress.phase==="exporting") return res.status(409).json({error:"已有导出任务正在运行"}); const out=path.resolve(root,parsed.data.outputDir); try{await assertSafeEmptyOutputDir(out,[path.parse(out).root,os.homedir(),root],[path.join(root,"node_modules"),path.join(root,"dist")]);}catch(e){return res.status(400).json({error:e instanceof Error?e.message:String(e)});} res.json({ok:true}); void (async()=>{try{progress={phase:"listing",message:"正在获取回答列表",current:0}; const answerResult=await paginateListing("answer",buildListingUrl("answer",parsed.data.urlToken),fetchViaFrontend,{onCount:n=>progress={phase:"listing",message:`已获取 ${n} 个回答`,current:n}}); progress={phase:"listing",message:"正在获取文章列表",current:0}; const articleResult=await paginateListing("article",buildListingUrl("article",parsed.data.urlToken),fetchViaFrontend,{onCount:n=>progress={phase:"listing",message:`已获取 ${n} 篇文章`,current:n}}); const answers=answerResult.items; const articles=articleResult.items; const items=[...answers,...articles].sort((a,b)=>b.created-a.created); await exporter.export(items,[answerResult.report,articleResult.report],{...parsed.data,outputDir:out},(i,total,title)=>progress={phase:"exporting",message:title,current:i,total}); const duplicateCount=answerResult.report.duplicates+articleResult.report.duplicates; progress={phase:"done",message:`完成：${answers.length} 个回答，${articles.length} 篇文章${duplicateCount?`；已去重 ${duplicateCount} 条重复记录`:""}`,current:items.length,total:items.length};}catch(e){progress={phase:"error",message:e instanceof Error?e.message:String(e)}}})(); });
const port=Number(process.env.PORT||4317); app.listen(port,"127.0.0.1",()=>console.log(`知档已启动：http://127.0.0.1:${port}`));
