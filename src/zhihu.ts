import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import { sleep } from "./util.js";
import type { ContentKind, ListingResult, ZhihuItem } from "./types.js";

export type ApiPage = { data: any[]; paging: { is_end: boolean; next?: string; totals?: number } };
export type Account = { url_token: string };
export type PageFetcher = (url:string) => Promise<ApiPage>;
export interface PaginateOptions { onCount?:(n:number)=>void; delayMs?:number; maxPages?:number; }

export function buildListingUrl(kind:ContentKind,token:string){
  return kind==="answer"?`https://www.zhihu.com/api/v4/members/${token}/answers?include=data[*].content,excerpt,created_time,updated_time,voteup_count,favlists_count,comment_count,thumbnail,question.title,question.id&limit=20&offset=0&sort_by=created`:`https://www.zhihu.com/api/v4/members/${token}/articles?include=data[*].content,excerpt,created,updated,voteup_count,favlists_count,comment_count,title,url,image_url&limit=20&offset=0&sort_by=created`;
}

export function normalizeItem(kind:ContentKind,x:any):ZhihuItem {
  const question=x.question??{}; const id=String(x.id); const html=String(x.content||"");
  const favoriteRaw=x.favlists_count??x.favorite_count;
  return {id,kind,questionId:kind==="answer"&&question.id!=null?String(question.id):null,title:kind==="answer"?(question.title||`回答 ${id}`):(x.title||`文章 ${id}`),url:x.url||(kind==="answer"?`https://www.zhihu.com/question/${question.id}/answer/${id}`:`https://zhuanlan.zhihu.com/p/${id}`),html,excerpt:(x.excerpt||"").replace(/<[^>]+>/g,""),created:Number(x.created_time??x.created??0),updated:Number(x.updated_time??x.updated??x.created??0),voteupCount:Number(x.voteup_count??0),favoriteCount:favoriteRaw==null?null:Number(favoriteRaw),commentCount:Number(x.comment_count??0),coverUrl:cleanImageUrl(x.image_url??x.thumbnail)??firstImageUrl(html)};
}

export async function paginateListing(kind:ContentKind,startUrl:string,fetchPage:PageFetcher,options:PaginateOptions={}):Promise<ListingResult>{
  const {onCount,delayMs=800,maxPages=1000}=options;
  const output:ZhihuItem[]=[]; const seen=new Set<string>(); const visitedUrls=new Set<string>(); let completed=false; let expectedTotal:number|undefined; let received=0; let duplicates=0; let url=startUrl;
  for(let guard=0;guard<maxPages;guard++){
    if(visitedUrls.has(url)) throw new Error("知乎分页出现循环：下一页地址与之前请求过的地址相同，导出已停止以避免死循环。");
    visitedUrls.add(url);
    const page=await fetchPage(url);
    if(typeof page.paging.totals==="number"&&Number.isFinite(page.paging.totals)) expectedTotal=page.paging.totals;
    received+=page.data.length;
    for(const raw of page.data){ const item=normalizeItem(kind,raw); const key=`${kind}:${item.id}`; if(!seen.has(key)){seen.add(key);output.push(item);}else duplicates++; }
    onCount?.(output.length);
    if(page.paging.is_end){ completed=true; break; }
    if(!page.paging.next) throw new Error("知乎分页数据不完整：尚未结束但缺少下一页地址。");
    url=page.paging.next; await sleep(delayMs);
  }
  if(!completed) throw new Error("知乎分页超过安全上限，导出已停止以避免生成不完整归档。");
  const warning=expectedTotal!=null&&received!==expectedTotal?`知乎报告总数 ${expectedTotal}，分页实际返回 ${received} 条；已导出能够取得的内容。`:null;
  return {items:output,report:{kind,reportedTotal:expectedTotal??null,received,unique:output.length,duplicates,warning}};
}

export class ZhihuClient {
  private context?: BrowserContext; private page?: Page;
  constructor(private dataDir:string){}
  async open(){
    if(this.context){
      try{if(!this.page||this.page.isClosed())this.page=await this.context.newPage();return;}
      catch{this.context=undefined;this.page=undefined;}
    }
    const context=await chromium.launchPersistentContext(path.join(this.dataDir,"browser-profile"),{headless:false,channel:"chrome",viewport:null,args:["--start-maximized"]});
    this.context=context; this.page=context.pages().find(page=>!page.isClosed())??await context.newPage();
    context.once("close",()=>{if(this.context===context){this.context=undefined;this.page=undefined;}});
  }
  async login(){
    for(let attempt=0;attempt<2;attempt++){
      await this.open();
      try{await this.page!.goto("https://www.zhihu.com/signin",{waitUntil:"domcontentloaded"});return;}
      catch(error){if(attempt===0&&isClosedTargetError(error)){this.context=undefined;this.page=undefined;continue;}throw error;}
    }
  }
  async me(){
    await this.open();
    const response=await this.context!.request.get("https://www.zhihu.com/api/v4/me?include=url_token",{headers:{accept:"application/json, text/plain, */*",referer:"https://www.zhihu.com/"},timeout:30000});
    const contentType=response.headers()["content-type"]||""; if(!response.ok()||!contentType.toLowerCase().includes("application/json")) return null;
    try { const result=JSON.parse(await response.text()); return result?.url_token?{url_token:String(result.url_token)}:null; } catch { return null; }
  }
  async waitForLogin(timeoutMs=300000){ const end=Date.now()+timeoutMs; while(Date.now()<end){ const me=await this.me().catch(()=>null); if(me?.url_token) return me; await sleep(1500); } throw new Error("等待登录超时，请重新点击登录。"); }
  private async api(url:string):Promise<ApiPage>{
    await this.open();
    const response=await this.context!.request.get(url,{headers:{accept:"application/json, text/plain, */*",referer:"https://www.zhihu.com/"},timeout:30000});
    const status=response.status(); const contentType=response.headers()["content-type"]||""; const body=await response.text();
    if(!response.ok()) throw new Error(status===401||status===403?"知乎登录已失效或要求安全验证，请回到 Chrome 完成验证后重试。":`知乎接口返回 ${status}`);
    if(!contentType.toLowerCase().includes("application/json")||body.trimStart().startsWith("<")) throw new Error("知乎返回了登录或安全验证页面，而不是内容数据。请在打开的 Chrome 中完成验证后重试。");
    try { const data=JSON.parse(body); if(!Array.isArray(data?.data)||!data?.paging) throw new Error("shape"); return data; } catch { throw new Error("知乎返回的数据格式已经变化，无法继续解析；请检查应用更新。"); }
  }
  async list(kind:ContentKind,token:string,onCount?:(n:number)=>void){
    return paginateListing(kind,buildListingUrl(kind,token),url=>this.api(url),{onCount});
  }
  async download(url:string){ await this.open(); const r=await this.context!.request.get(url,{timeout:30000}); if(!r.ok()) throw new Error(`图片下载失败 ${r.status()}`); return {body:await r.body(),contentType:r.headers()["content-type"]||"application/octet-stream"}; }
  async close(){ const context=this.context; this.context=undefined; this.page=undefined; await context?.close().catch(()=>undefined); }
}

function isClosedTargetError(error:unknown){return error instanceof Error&&/target page, context or browser has been closed/i.test(error.message);}

function cleanImageUrl(value:unknown){ const url=typeof value==="string"?value.trim():""; return /^https?:\/\//.test(url)?url:null; }
function firstImageUrl(html:string){ const normalized=html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,""); const tag=/<img\b[^>]*>/i.exec(normalized)?.[0]; if(!tag)return null; const get=(name:string)=>new RegExp(`\\s${name}=["']([^"']+)["']`,"i").exec(tag)?.[1]; return cleanImageUrl(get("data-original")||get("data-actualsrc")||get("src")); }
