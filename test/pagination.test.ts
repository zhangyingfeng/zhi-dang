import test from "node:test"; import assert from "node:assert/strict";
import { paginateListing, normalizeItem, buildListingUrl, type ApiPage } from "../src/zhihu.js";

const page=(data:any[],paging:Partial<ApiPage["paging"]>):ApiPage=>({data,paging:{is_end:false,...paging}});
const raw=(id:string)=>({id,content:"<p>x</p>"});

test("single completed page produces items with no warning",async()=>{
  const fetch=async()=>page([raw("1"),raw("2")],{is_end:true,totals:2});
  const result=await paginateListing("answer","url1",fetch,{delayMs:0});
  assert.equal(result.items.length,2);
  assert.equal(result.report.received,2);
  assert.equal(result.report.unique,2);
  assert.equal(result.report.duplicates,0);
  assert.equal(result.report.warning,null);
});

test("follows paging.next across multiple pages in order",async()=>{
  const pages:Record<string,ApiPage>={
    url1:page([raw("1")],{is_end:false,next:"url2"}),
    url2:page([raw("2")],{is_end:true}),
  };
  const fetch=async(url:string)=>pages[url];
  const result=await paginateListing("answer","url1",fetch,{delayMs:0});
  assert.deepEqual(result.items.map(i=>i.id),["1","2"]);
  assert.equal(result.report.received,2);
});

test("deduplicates items that reappear across pages",async()=>{
  const pages:Record<string,ApiPage>={
    url1:page([raw("1"),raw("2")],{is_end:false,next:"url2"}),
    url2:page([raw("2"),raw("3")],{is_end:true}),
  };
  const fetch=async(url:string)=>pages[url];
  const result=await paginateListing("answer","url1",fetch,{delayMs:0});
  assert.deepEqual(result.items.map(i=>i.id),["1","2","3"]);
  assert.equal(result.report.received,4);
  assert.equal(result.report.unique,3);
  assert.equal(result.report.duplicates,1);
});

test("reports a warning when received count differs from reported total",async()=>{
  const fetch=async()=>page([raw("1")],{is_end:true,totals:5});
  const result=await paginateListing("answer","url1",fetch,{delayMs:0});
  assert.match(result.report.warning??"",/知乎报告总数 5/);
  assert.match(result.report.warning??"",/分页实际返回 1/);
});

test("throws when a page is not final but has no next url",async()=>{
  const fetch=async()=>page([],{is_end:false,next:undefined});
  await assert.rejects(paginateListing("answer","url1",fetch,{delayMs:0}),/分页数据不完整/);
});

test("throws when the page count exceeds the safety cap",async()=>{
  let n=0;
  const fetch=async()=>{n++;return page([],{is_end:false,next:`url${n+1}`});};
  await assert.rejects(paginateListing("answer","url1",fetch,{delayMs:0,maxPages:3}),/安全上限/);
});

test("throws immediately when paging.next cycles back to a visited url",async()=>{
  const pages:Record<string,ApiPage>={
    url1:page([raw("1")],{is_end:false,next:"url2"}),
    url2:page([raw("2")],{is_end:false,next:"url1"}),
  };
  const fetch=async(url:string)=>pages[url];
  await assert.rejects(paginateListing("answer","url1",fetch,{delayMs:0}),/出现循环/);
});

test("onCount reports cumulative unique count as pages complete",async()=>{
  const pages:Record<string,ApiPage>={
    url1:page([raw("1")],{is_end:false,next:"url2"}),
    url2:page([raw("2")],{is_end:true}),
  };
  const fetch=async(url:string)=>pages[url];
  const counts:number[]=[];
  await paginateListing("answer","url1",fetch,{delayMs:0,onCount:n=>counts.push(n)});
  assert.deepEqual(counts,[1,2]);
});

test("buildListingUrl targets the right endpoint per content kind",()=>{
  assert.match(buildListingUrl("answer","token1"),/\/members\/token1\/answers\?/);
  assert.match(buildListingUrl("article","token1"),/\/members\/token1\/articles\?/);
});

test("normalizeItem falls back to a generated title when the source omits one",()=>{
  const item=normalizeItem("answer",{id:9,question:{id:7}});
  assert.equal(item.title,"回答 9");
  assert.equal(item.questionId,"7");
  assert.equal(item.url,"https://www.zhihu.com/question/7/answer/9");
});
