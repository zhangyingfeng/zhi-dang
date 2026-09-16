import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import TurndownService from "turndown";
import type { DuplicateInfo, ExportControl, ExportOptions, ExportRecord, ListingReport, TaskEvent, ZhihuItem } from "./types.js";
import { MIN_DEDUP_TEXT_LENGTH, contentHash, isoDate, normalizePlainText, safeName, sleep, writeFileAtomic, writeJson } from "./util.js";
import { downloadImage } from "./zhihu.js";
import { QuotaExhaustedError, type ContentSource } from "./source/types.js";

// Polled between items (and again between an item's subtasks) rather than
// threaded through every inner await — see ExportControl's doc comment for
// why this is deliberately a same-process-only pause, not a resumable
// interrupted-run design.
async function waitWhilePaused(control:ExportControl){ while(control.paused) await sleep(300); }

export class Exporter {
  private td=new TurndownService({headingStyle:"atx",codeBlockStyle:"fenced",bulletListMarker:"-"});
  private imageCache=new Map<string,string>();
  async export(items:ZhihuItem[],listingReports:ListingReport[],opts:ExportOptions,source:ContentSource,onEvent:(e:TaskEvent)=>void,control:ExportControl={paused:false,skippedItemIds:new Set(),skipImagesItemIds:new Set()}){
    this.imageCache.clear(); await mkdir(opts.outputDir,{recursive:true});
    const records:ExportRecord[]=[]; const imageFailures:ImageFailure[]=[]; const itemFailures:ItemFailure[]=[]; const skippedItems:SkippedItem[]=[];
    // Backstop for sources whose listing is metadata-only (see
    // ContentSource.fetchBody) — server.ts's own upfront pass over
    // already-known bodies is a no-op for those (nothing to hash yet), so
    // duplicates among them would otherwise never surface at all. Keyed by
    // content hash, populated as each item's body is actually fetched here;
    // harmless (just redundant) for a source that already provides full
    // bodies at listing time, since it recomputes the same hashes
    // server.ts's pass already found.
    const hashGroups=new Map<string,{id:string;title:string}[]>();
    const noteContentHash=(item:ZhihuItem,html:string)=>{
      if(normalizePlainText(html).length<MIN_DEDUP_TEXT_LENGTH) return;
      const hash=contentHash(html);
      const group=hashGroups.get(hash);
      const entry={id:item.id,title:item.title};
      if(!group){ hashGroups.set(hash,[entry]); return; }
      group.push(entry);
      if(group.length<2) return;
      for(const member of group){
        const info:DuplicateInfo={groupSize:group.length,otherTitles:group.filter(g=>g.id!==member.id).map(g=>g.title)};
        onEvent({type:"duplicate",id:member.id,info});
      }
    };
    // Written after every item (not just once at the end) so an interrupted
    // run — force-quit, crash — still leaves a manifest behind. That's what
    // makes resume possible at all: assertSafeOutputDir trusts this file's
    // presence, and the next run reads index.json back to seed
    // control.resumedRecords with whatever already finished.
    const persist=()=>this.writeManifests(opts.outputDir,items.length,listingReports,records,itemFailures,skippedItems,imageFailures);
    let quotaExhausted=false;
    for(let i=0;i<items.length;i++){
      const item=items[i];
      if(control.skippedItemIds.has(item.id)){ skippedItems.push({itemId:item.id,kind:item.kind,title:item.title}); onEvent({type:"done",id:item.id,status:"skipped"}); await persist(); continue; }
      const resumed=control.resumedRecords?.get(item.id);
      if(resumed){ records.push(resumed); onEvent({type:"done",id:item.id,status:"done"}); await persist(); continue; }
      // Once quota is exhausted, every remaining not-yet-done item must be
      // left completely alone (still "pending", no fetchBody attempt) — but
      // the loop itself must keep scanning rather than `break`ing out.
      // Breaking here used to mean any already-resumed/already-skipped item
      // *later* in this array (items sorted newest-first; quota typically
      // runs out partway through, not at the very end) never got the chance
      // to be re-affirmed into `records`/`skippedItems` above, so the next
      // persist() call would write a manifest that had silently dropped
      // them — a real data-loss bug: their .md files stayed untouched on
      // disk, but index.json stopped listing them, so the *next* run's
      // resume would treat them as never-done and burn quota re-fetching
      // work that was already sitting in that very folder.
      if(quotaExhausted) continue;
      await waitWhilePaused(control);
      // Fetched (and, for a quota-limited source, potentially rejected)
      // before announcing "start": on QuotaExhaustedError this item must
      // stay untouched ("pending"), not recorded as started or failed, so a
      // later run resumes it normally instead of the task list showing
      // hundreds of identical quota errors.
      let html:string;
      try{ html=await source.fetchBody(item); }
      catch(error){
        if(error instanceof QuotaExhaustedError){ quotaExhausted=true; continue; }
        const message=error instanceof Error?error.message:String(error);
        onEvent({type:"start",id:item.id});
        itemFailures.push({itemId:item.id,kind:item.kind,title:item.title,error:message}); onEvent({type:"done",id:item.id,status:"error",error:message});
        await persist(); await sleep(opts.delayMs); continue;
      }
      noteContentHash(item,html);
      onEvent({type:"start",id:item.id});
      try{
        const folder=path.join(opts.outputDir,item.kind==="answer"?"answers":"articles"); await mkdir(folder,{recursive:true}); let cover:string|null=item.coverUrl;
        if(opts.downloadImages){
          if(control.skipImagesItemIds.has(item.id)){
            onEvent({type:"subtask",id:item.id,key:"images",status:"skipped"});
          }else{
            onEvent({type:"subtask",id:item.id,key:"images",status:"active"});
            const localized=await this.localizeImages(html,path.join(opts.outputDir,"images"),item.id,item.coverUrl?[item.coverUrl]:[],onEvent);
            html=localized.html; imageFailures.push(...localized.failures); if(item.coverUrl&&localized.paths.has(item.coverUrl))cover=localized.paths.get(item.coverUrl)!;
            onEvent({type:"subtask",id:item.id,key:"images",status:localized.failures.length?"error":"done"});
          }
        }
        await waitWhilePaused(control);
        onEvent({type:"subtask",id:item.id,key:"write",status:"active"});
        const markdown=this.td.turndown(html); const markdownCover=cover?.startsWith("images/")?`../${cover}`:cover; const front=["---",`id: "${item.id}"`,`type: ${item.kind}`,...(item.questionId?[`question_id: "${item.questionId}"`]:[]),`title: ${JSON.stringify(item.title)}`,`url: ${item.url}`,`created: ${isoDate(item.created)}`,`updated: ${isoDate(item.updated)}`,`voteup_count: ${item.voteupCount}`,`favorite_count: ${item.favoriteCount??"null"}`,`comment_count: ${item.commentCount}`,...(markdownCover?[`cover: ${JSON.stringify(markdownCover)}`]:[]),"---","",`# ${item.title}`,"",markdown,"",`[知乎原文](${item.url})`,""];
        const filename=`${new Date(item.created*1000).toISOString().slice(0,10)}-${item.id}-${safeName(item.title)}.md`; await writeFileAtomic(path.join(folder,filename),front.join("\n")); records.push({...item,html:undefined,cover,file:path.relative(opts.outputDir,path.join(folder,filename))} as ExportRecord);
        onEvent({type:"subtask",id:item.id,key:"write",status:"done"}); onEvent({type:"done",id:item.id,status:"done"});
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        itemFailures.push({itemId:item.id,kind:item.kind,title:item.title,error:message}); onEvent({type:"done",id:item.id,status:"error",error:message});
      }
      await persist();
      await sleep(opts.delayMs);
    }
    await persist();
    return { quotaExhausted };
  }
  private async writeManifests(outputDir:string,discovered:number,listingReports:ListingReport[],records:ExportRecord[],itemFailures:ItemFailure[],skippedItems:SkippedItem[],imageFailures:ImageFailure[]){
    const exportedAt=new Date().toISOString(); const summary={discovered,succeeded:records.length,failed:itemFailures.length,skipped:skippedItems.length,answers:records.filter(x=>x.kind==="answer").length,articles:records.filter(x=>x.kind==="article").length,imageFailures:imageFailures.length};
    await writeJson(path.join(outputDir,"index.json"),{schemaVersion:"1.0.0",exportedAt,summary,items:records});
    await writeJson(path.join(outputDir,"export-report.json"),{schemaVersion:"1.0.0",exportedAt,summary,listingReports,itemFailures,imageFailures,skippedItems});
    const listingWarnings=listingReports.filter(report=>report.warning).map(report=>`- ${report.warning}`).join("\n");
    await writeFileAtomic(path.join(outputDir,"README.md"),`# 知乎个人内容归档\n\n发现 ${summary.discovered} 项，成功 ${summary.succeeded} 项，失败 ${summary.failed} 项${summary.skipped?`，用户跳过 ${summary.skipped} 项`:""}；回答 ${summary.answers}，文章 ${summary.articles}。图片失败 ${summary.imageFailures} 项，详情见 export-report.json。${listingWarnings?`\n\n## 分页警告\n\n${listingWarnings}\n`:"\n"}`);
  }
  private async localizeImages(html:string,imageDir:string,itemId:string,extraUrls:string[]=[],onEvent?:(e:TaskEvent)=>void){
    await mkdir(imageDir,{recursive:true}); html=normalizeImageSources(html); const paths=new Map<string,string>(); const failures:ImageFailure[]=[];
    const urls=[...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1]).concat(extraUrls).filter(u=>/^https?:/.test(u));
    const uniqueUrls=[...new Set(urls)];
    onEvent?.({type:"images-list",id:itemId,urls:uniqueUrls});
    for(const url of uniqueUrls){
      onEvent?.({type:"image",id:itemId,url,status:"active"});
      try{
        let name=this.imageCache.get(url); if(!name){ const data=await this.downloadWithRetry(url); name=imageFileName(data.body,data.contentType); await writeFile(path.join(imageDir,name),data.body); this.imageCache.set(url,name); }
        const local=`images/${name}`; paths.set(url,local); html=html.split(url).join(`../${local}`);
        onEvent?.({type:"image",id:itemId,url,status:"done"});
      }
      catch(error){
        const message=error instanceof Error?error.message:String(error);
        failures.push({itemId,url,error:message}); onEvent?.({type:"image",id:itemId,url,status:"error",error:message});
      }
    }
    return {html,paths,failures};
  }
  private async downloadWithRetry(url:string){ let last:unknown; for(let attempt=1;attempt<=3;attempt++){ try{return await downloadImage(url);}catch(error){last=error;if(attempt<3)await sleep(500*2**(attempt-1));} } throw last; }
}

type ImageFailure={itemId:string;url:string;error:string};
type ItemFailure={itemId:string;kind:string;title:string;error:string};
type SkippedItem={itemId:string;kind:string;title:string};

// Naming by content hash (not source URL) means images reused across posts,
// or served from different CDN URLs with identical bytes, collapse to one
// file automatically instead of being downloaded and stored redundantly.
export function imageFileName(body:Buffer,contentType:string){ const type=contentType.toLowerCase().split(";",1)[0]; const ext:Record<string,string>={"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp","image/svg+xml":"svg","image/avif":"avif"}; const hash=createHash("sha256").update(body).digest("hex"); return `${hash}.${ext[type]??"bin"}`; }
// Zhihu's HTML lazy-loads images: the real URL is in data-original or
// data-actualsrc, with src pointing at a placeholder, and a <noscript> tag
// duplicating the same <img> as a no-JS fallback. Without this, downloading
// would fetch placeholder blobs and the same image would appear twice.
export function normalizeImageSources(html:string){
  const withoutFallbacks=html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,"");
  return withoutFallbacks.replace(/<img\b[^>]*>/gi,tag=>{const get=(name:string)=>new RegExp(`\\s${name}=["']([^"']+)["']`,"i").exec(tag)?.[1];const source=get("data-original")||get("data-actualsrc")||get("src");if(!source||source.startsWith("data:"))return "";let clean=tag.replace(/\s(?:data-original|data-actualsrc)=["'][^"']*["']/gi,"");if(/\ssrc=["']/i.test(clean))clean=clean.replace(/\ssrc=["'][^"']*["']/i,` src="${source}"`);else clean=clean.replace(/^<img/i,`<img src="${source}"`);return clean;});
}
