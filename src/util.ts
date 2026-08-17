import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
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
