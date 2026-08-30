import express from "express";
import path from "node:path";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { paginateListing, buildListingUrl } from "./zhihu.js";
import { Exporter } from "./exporter.js";
import { assertSafeOutputDir, contentHash, normalizePlainText } from "./util.js";
import { fetchViaFrontend, waitForFrontendRequest, submitFrontendResult } from "./frontendBridge.js";
import type { DuplicateInfo, ExportControl, ExportRecord, ExportTask, Progress, TaskStatus } from "./types.js";
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
// Set for the duration of a single running export (see ExportControl's doc
// comment in types.ts); the pause/resume/skip endpoints below mutate it,
// and Exporter.export polls it from inside the already-running loop.
let exportControl:ExportControl|null=null;
const app=express(); app.use(express.json({limit:"10mb"})); app.use(express.static(publicDir));
app.get("/api/status",(_req,res)=>res.json({progress}));
app.get("/api/about",(_req,res)=>res.json({version:pkg.version}));
// Called on logout so a fresh login doesn't inherit the previous account's
// leftover task list / output dir — /api/export's own 409 guard already
// keeps this from firing mid-run, and the frontend disables the logout
// button while an export is busy, so this never races a running export.
app.post("/api/reset",(_req,res)=>{
  if(progress.phase==="listing"||progress.phase==="exporting") return res.status(409).json({error:"导出正在进行，无法重置"});
  progress={phase:"idle",message:"准备就绪"}; res.json({ok:true});
});
app.get("/api/frontend-fetch-request",async(_req,res)=>{ const next=await waitForFrontendRequest(25000); res.json(next); });
app.post("/api/frontend-fetch-result",(req,res)=>{ const parsed=z.object({id:z.number(),status:z.number(),body:z.string()}).safeParse(req.body); if(!parsed.success) return res.status(400).json({error:parsed.error.message}); submitFrontendResult(parsed.data.id,parsed.data.status,parsed.data.body); res.json({ok:true}); });
app.post("/api/export",async(req,res)=>{
  const parsed=z.object({outputDir:z.string().min(1).default("exports"),downloadImages:z.boolean().default(true),delayMs:z.number().min(300).max(10000).default(900),urlToken:z.string().min(1)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  if(progress.phase==="listing"||progress.phase==="exporting") return res.status(409).json({error:"已有导出任务正在运行"});
  const out=path.resolve(exportBase,parsed.data.outputDir);
  try{await assertSafeOutputDir(out,[path.parse(out).root,os.homedir(),exportBase],[path.join(root,"node_modules"),path.join(root,"dist")]);}catch(e){return res.status(400).json({error:e instanceof Error?e.message:String(e)});}
  // Resuming into a directory this tool already wrote to: read back what
  // finished last time so it isn't redone. Best-effort — a missing or
  // unreadable manifest just means nothing gets seeded (fresh start), never
  // an error; assertSafeOutputDir above already made the trust call.
  const resumedRecords=new Map<string,ExportRecord>(); const resumedSkippedIds=new Set<string>();
  try{
    const prevIndex=JSON.parse(await readFile(path.join(out,"index.json"),"utf8"));
    for(const record of prevIndex.items??[]) resumedRecords.set(record.id,record);
  }catch{}
  try{
    const prevReport=JSON.parse(await readFile(path.join(out,"export-report.json"),"utf8"));
    for(const s of prevReport.skippedItems??[]) resumedSkippedIds.add(s.itemId);
  }catch{}
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
      // before a single byte of export work has actually started. Items
      // that already finished (or were skipped) in a previous interrupted
      // run are pre-marked here too, so a resume shows the real picture
      // immediately instead of every row starting at "未开始" again.
      const tasks:ExportTask[]=items.map(it=>{
        const alreadyDone=resumedRecords.has(it.id); const alreadySkipped=!alreadyDone&&resumedSkippedIds.has(it.id);
        const status:TaskStatus=alreadyDone?"done":alreadySkipped?"skipped":"pending";
        return {id:it.id,kind:it.kind,title:it.title,status,subtasks:[...(parsed.data.downloadImages?[{key:"images" as const,status}]:[]),{key:"write" as const,status}],duplicate:contentDuplicates.get(it.id)};
      });
      const taskById=new Map(tasks.map(t=>[t.id,t]));
      const doneCount=()=>tasks.reduce((n,t)=>n+(t.status==="done"||t.status==="error"||t.status==="skipped"?1:0),0);
      exportControl={paused:false,skippedItemIds:resumedSkippedIds,skipImagesItemIds:new Set(),resumedRecords};
      const resumedCount=resumedRecords.size+resumedSkippedIds.size;
      progress={phase:"exporting",message:resumedCount?`继续导出：${resumedCount} 项已在上次完成`:"开始导出",current:doneCount(),total:tasks.length,tasks,paused:false};
      try{
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
        },exportControl);
      }finally{ exportControl=null; }
      const skippedCount=tasks.filter(t=>t.status==="skipped").length;
      const duplicateCount=answerResult.report.duplicates+articleResult.report.duplicates;
      progress={phase:"done",message:`完成：${answers.length} 个回答，${articles.length} 篇文章${duplicateCount?`；已去重 ${duplicateCount} 条重复记录`:""}${skippedCount?`；已跳过 ${skippedCount} 项`:""}`,current:items.length,total:items.length,outputDir:out,tasks};
    }catch(e){progress={phase:"error",message:e instanceof Error?e.message:String(e)};}
  })();
});
app.post("/api/export/pause",(_req,res)=>{
  if(!exportControl) return res.status(409).json({error:"当前没有正在进行的导出"});
  exportControl.paused=true; progress={...progress,paused:true}; res.json({ok:true});
});
app.post("/api/export/resume",(_req,res)=>{
  if(!exportControl) return res.status(409).json({error:"当前没有正在进行的导出"});
  exportControl.paused=false; progress={...progress,paused:false}; res.json({ok:true});
});
// Marks a not-yet-started item (or, with scope "images", a not-yet-started
// image subtask within an item) to be skipped once Exporter.export's loop
// reaches it. Restricted to "pending" so an already in-flight or finished
// item/subtask can't be retroactively un-done from here — this is a queue
// edit, not a way to delete an existing file.
app.post("/api/export/skip",(req,res)=>{
  const parsed=z.object({id:z.string().min(1),scope:z.enum(["item","images"]).default("item")}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:parsed.error.message});
  if(!exportControl||!progress.tasks) return res.status(409).json({error:"当前没有正在进行的导出"});
  const task=progress.tasks.find(t=>t.id===parsed.data.id);
  if(!task) return res.status(404).json({error:"未找到该项"});
  if(parsed.data.scope==="item"){
    if(task.status!=="pending") return res.status(409).json({error:"该项已经开始处理，无法跳过"});
    exportControl.skippedItemIds.add(task.id); task.status="skipped";
  }else{
    const sub=task.subtasks.find(s=>s.key==="images");
    if(!sub) return res.status(404).json({error:"该项没有图片子任务"});
    if(sub.status!=="pending") return res.status(409).json({error:"图片子任务已经开始处理，无法跳过"});
    exportControl.skipImagesItemIds.add(task.id); sub.status="skipped";
  }
  progress={...progress,tasks:progress.tasks}; res.json({ok:true});
});
const port=Number(process.env.PORT||4317); app.listen(port,"127.0.0.1",()=>console.log(`知档已启动：http://127.0.0.1:${port}`));
