import express from "express";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { paginateListing, buildListingUrl } from "./zhihu.js";
import { Exporter } from "./exporter.js";
import { assertSafeEmptyOutputDir, contentHash, normalizePlainText } from "./util.js";
import { fetchViaFrontend, waitForFrontendRequest, submitFrontendResult } from "./frontendBridge.js";
import type { DuplicateInfo, ExportTask, Progress } from "./types.js";
// Statically imported (not read from disk at runtime) so it's inlined at
// compile time by both tsc and Bun's --compile — reading it from the
// filesystem would break in the packaged app, where cwd isn't reliable.
import pkg from "../package.json" with { type: "json" };

const root=process.cwd();
const isPackaged=!!process.env.ZHIDANG_PUBLIC_DIR;
const publicDir=process.env.ZHIDANG_PUBLIC_DIR||path.join(root,"public");
// A packaged app's cwd is whatever launched it (often "/"), so relative
// export paths must resolve against a real, writable, user-owned directory
// instead of process.cwd(). In dev, cwd is the project root, which is fine.
const exportBase=isPackaged?path.join(os.homedir(),"Documents"):root;
const exporter=new Exporter(); let progress:Progress={phase:"idle",message:"准备就绪"};
const app=express(); app.use(express.json({limit:"10mb"})); app.use(express.static(publicDir));
app.get("/api/status",(_req,res)=>res.json({progress}));
app.get("/api/about",(_req,res)=>res.json({version:pkg.version}));
app.get("/api/frontend-fetch-request",async(_req,res)=>{ const next=await waitForFrontendRequest(25000); res.json(next); });
app.post("/api/frontend-fetch-result",(req,res)=>{ const parsed=z.object({id:z.number(),status:z.number(),body:z.string()}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:parsed.error.message}); submitFrontendResult(parsed.data.id,parsed.data.status,parsed.data.body); res.json({ok:true}); });
app.post("/api/export",async(req,res)=>{
  const parsed=z.object({outputDir:z.string().min(1).default("exports"),downloadImages:z.boolean().default(true),delayMs:z.number().min(300).max(10000).default(900),urlToken:z.string().min(1)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  if(progress.phase==="listing"||progress.phase==="exporting") return res.status(409).json({error:"已有导出任务正在运行"});
  const out=path.resolve(exportBase,parsed.data.outputDir);
  try{await assertSafeEmptyOutputDir(out,[path.parse(out).root,os.homedir(),exportBase],[path.join(root,"node_modules"),path.join(root,"dist")]);}catch(e){return res.status(400).json({error:e instanceof Error?e.message:String(e)});}
  res.json({ok:true});
  void (async()=>{
    try{
      progress={phase:"listing",message:"正在获取回答列表",current:0};
      const answerResult=await paginateListing("answer",buildListingUrl("answer",parsed.data.urlToken),fetchViaFrontend,{onCount:n=>progress={phase:"listing",message:`已获取 ${n} 个回答`,current:n}});
      progress={phase:"listing",message:"正在获取文章列表",current:0};
      const articleResult=await paginateListing("article",buildListingUrl("article",parsed.data.urlToken),fetchViaFrontend,{onCount:n=>progress={phase:"listing",message:`已获取 ${n} 篇文章`,current:n}});
      const answers=answerResult.items; const articles=articleResult.items; const items=[...answers,...articles].sort((a,b)=>b.created-a.created);
      // Exact-content duplicate detection: groups items whose normalized body
      // text hashes identically (e.g. the same essay posted as both an
      // answer and an article). Deliberately hash equality only — no
      // similarity/fuzzy matching — so it's a read-only hint the list can
      // show, not a judgment call the app is making on the user's behalf.
      // Very short bodies are skipped so near-empty items don't all cluster
      // together as false positives.
      const MIN_DEDUP_TEXT_LENGTH=20;
      const hashGroups=new Map<string,(typeof items)[number][]>();
      for(const it of items){
        if(normalizePlainText(it.html).length<MIN_DEDUP_TEXT_LENGTH) continue;
        const hash=contentHash(it.html); const group=hashGroups.get(hash); if(group) group.push(it); else hashGroups.set(hash,[it]);
      }
      const contentDuplicates=new Map<string,DuplicateInfo>();
      for(const group of hashGroups.values()){
        if(group.length<2) continue;
        for(const it of group) contentDuplicates.set(it.id,{groupSize:group.length,otherTitles:group.filter(g=>g.id!==it.id).map(g=>g.title)});
      }
      // Task list is built up front from the already-fetched listing (Zhihu's
      // listing API returns full content, so there's no separate "fetch" step
      // per item) — this is what lets the UI show every item as "未开始"
      // before a single byte of export work has actually started.
      const tasks:ExportTask[]=items.map(it=>({id:it.id,kind:it.kind,title:it.title,status:"pending",subtasks:[...(parsed.data.downloadImages?[{key:"images" as const,status:"pending" as const}]:[]),{key:"write" as const,status:"pending" as const}],duplicate:contentDuplicates.get(it.id)}));
      const taskById=new Map(tasks.map(t=>[t.id,t]));
      const doneCount=()=>tasks.reduce((n,t)=>n+(t.status==="done"||t.status==="error"?1:0),0);
      progress={phase:"exporting",message:"开始导出",current:0,total:tasks.length,tasks};
      await exporter.export(items,[answerResult.report,articleResult.report],{...parsed.data,outputDir:out},(e)=>{
        const task=taskById.get(e.id); if(!task) return;
        if(e.type==="start"){ task.status="active"; progress={...progress,message:task.title,tasks}; }
        else if(e.type==="subtask"){ const sub=task.subtasks.find(s=>s.key===e.key); if(sub) sub.status=e.status; progress={...progress,tasks}; }
        // The two image-level events populate/patch the "images" subtask's
        // own nested list — this is what lets the UI show a per-image
        // breakdown behind an expand toggle instead of one opaque badge.
        else if(e.type==="images-list"){ const sub=task.subtasks.find(s=>s.key==="images"); if(sub) sub.images=e.urls.map(url=>({url,status:"pending" as const})); progress={...progress,tasks}; }
        else if(e.type==="image"){ const img=task.subtasks.find(s=>s.key==="images")?.images?.find(i=>i.url===e.url); if(img){ img.status=e.status; if(e.error) img.error=e.error; } progress={...progress,tasks}; }
        else{ task.status=e.status; if(e.error) task.error=e.error; progress={...progress,current:doneCount(),tasks}; }
      });
      const duplicateCount=answerResult.report.duplicates+articleResult.report.duplicates;
      progress={phase:"done",message:`完成：${answers.length} 个回答，${articles.length} 篇文章${duplicateCount?`；已去重 ${duplicateCount} 条重复记录`:""}`,current:items.length,total:items.length,outputDir:out,tasks};
    }catch(e){progress={phase:"error",message:e instanceof Error?e.message:String(e)};}
  })();
});
const port=Number(process.env.PORT||4317); app.listen(port,"127.0.0.1",()=>console.log(`知档已启动：http://127.0.0.1:${port}`));
