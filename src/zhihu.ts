import { sleep } from "./util.js";
import type { ContentKind, ListingResult, ZhihuItem } from "./types.js";

export type ApiPage = { data: any[]; paging: { is_end: boolean; next?: string; totals?: number } };
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
    url=page.paging.next.replace(/^http:\/\//,"https://"); await sleep(delayMs);
  }
  if(!completed) throw new Error("知乎分页超过安全上限，导出已停止以避免生成不完整归档。");
  const warning=expectedTotal!=null&&received!==expectedTotal?`知乎报告总数 ${expectedTotal}，分页实际返回 ${received} 条；已导出能够取得的内容。`:null;
  return {items:output,report:{kind,reportedTotal:expectedTotal??null,received,unique:output.length,duplicates,warning}};
}

export async function downloadImage(url:string){
  const response=await fetch(url,{headers:{referer:"https://www.zhihu.com/"}});
  if(!response.ok) throw new Error(`图片下载失败 ${response.status}`);
  const body=Buffer.from(await response.arrayBuffer());
  const contentType=response.headers.get("content-type")||"application/octet-stream";
  return {body,contentType};
}

function cleanImageUrl(value:unknown){ const url=typeof value==="string"?value.trim():""; return /^https?:\/\//.test(url)?url:null; }
function firstImageUrl(html:string){ const normalized=html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,""); const tag=/<img\b[^>]*>/i.exec(normalized)?.[0]; if(!tag)return null; const get=(name:string)=>new RegExp(`\\s${name}=["']([^"']+)["']`,"i").exec(tag)?.[1]; return cleanImageUrl(get("data-original")||get("data-actualsrc")||get("src")); }
