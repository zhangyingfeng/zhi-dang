import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export function safeName(input: string, max = 90) { return input.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").replace(/\s+/g," ").trim().slice(0,max) || "untitled"; }
export const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));
export function isoDate(epoch:number){ return new Date(epoch*1000).toISOString(); }
// Writes via a temp file + rename rather than a direct writeFile, so a crash
// or force-quit mid-write can never leave a truncated-but-present file at
// the real path — the rename only happens once the full content is already
// safely on disk. This matters most for export-report.json/index.json,
// which resume (see assertSafeOutputDir below) trusts as ground truth for
// "what already finished."
export async function writeFileAtomic(file:string,data:string){
  await mkdir(path.dirname(file),{recursive:true});
  const tmp=`${file}.${randomUUID()}.tmp`;
  await writeFile(tmp,data,"utf8");
  await rename(tmp,file);
}
export async function writeJson(file:string,data:unknown){ await writeFileAtomic(file,JSON.stringify(data,null,2)); }
// The presence of this file in an otherwise non-empty output directory is
// what assertSafeOutputDir trusts to allow resuming into it (see below) —
// it's written incrementally by Exporter.export, not just once at the end,
// specifically so an interrupted run still leaves it behind.
export const RESUME_MARKER_FILE="export-report.json";
export async function assertSafeOutputDir(outputDir:string,exactProtected:string[],protectedTrees:string[]){
  const resolved=path.resolve(outputDir); const exact=exactProtected.map(value=>path.resolve(value)); const trees=protectedTrees.map(value=>path.resolve(value));
  if(exact.includes(resolved)||trees.some(tree=>resolved===tree||resolved.startsWith(`${tree}${path.sep}`))) throw new Error("该目录受保护，请选择一个新的专用导出目录。");
  try{
    const info=await stat(resolved); if(!info.isDirectory()) throw new Error("保存位置已经存在且不是目录。");
    const entries=await readdir(resolved);
    if(entries.length>0&&!entries.includes(RESUME_MARKER_FILE)) throw new Error("保存目录不是空目录，且不像是知档之前创建的归档。为避免覆盖已有内容，请选择一个新目录。");
  }
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
}
// Strips markup and collapses whitespace so two posts with the same visible
// text but different HTML formatting (e.g. answers vs. articles come back
// from different Zhihu API shapes) still normalize to the same string.
export function normalizePlainText(html:string){ return html.replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim(); }
// Used to flag exact-content duplicates in the export task list (see
// src/server.ts) — deliberately just a hash equality check, not any kind of
// similarity/fuzzy matching, so it needs no model or tunable threshold.
export function contentHash(html:string){ return createHash("sha256").update(normalizePlainText(html)).digest("hex"); }
