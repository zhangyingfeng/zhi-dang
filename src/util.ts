import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export function safeName(input: string, max = 90) { return input.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").replace(/\s+/g," ").trim().slice(0,max) || "untitled"; }
export const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));
export function isoDate(epoch:number){ return new Date(epoch*1000).toISOString(); }
export async function writeJson(file:string,data:unknown){ await mkdir(path.dirname(file),{recursive:true}); await writeFile(file,JSON.stringify(data,null,2),"utf8"); }
export async function assertSafeEmptyOutputDir(outputDir:string,exactProtected:string[],protectedTrees:string[]){
  const resolved=path.resolve(outputDir); const exact=exactProtected.map(value=>path.resolve(value)); const trees=protectedTrees.map(value=>path.resolve(value));
  if(exact.includes(resolved)||trees.some(tree=>resolved===tree||resolved.startsWith(`${tree}${path.sep}`))) throw new Error("该目录受保护，请选择一个新的专用导出目录。");
  try{const info=await stat(resolved);if(!info.isDirectory())throw new Error("保存位置已经存在且不是目录。");if((await readdir(resolved)).length>0)throw new Error("保存目录不是空目录。为避免覆盖旧归档，请选择一个新目录。");}
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
