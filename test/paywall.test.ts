import test from "node:test"; import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises"; import os from "node:os"; import path from "node:path";
import { truncatePaidPreview } from "../src/paywall.js";
import { normalizeItem, buildListingUrl } from "../src/zhihu.js";
import { Exporter } from "../src/exporter.js";
import type { ContentSource } from "../src/source/types.js";
import type { ZhihuItem } from "../src/types.js";

const url="https://www.zhihu.com/question/1/answer/2";
const paragraphs=(n:number)=>Array.from({length:n},(_,i)=>`<p>${"字".repeat(10)}${i}</p>`).join("");

test("keeps about 10% of the text at a paragraph boundary and appends a notice with the link",()=>{
  const result=truncatePaidPreview(paragraphs(20),url);
  assert.equal(result.truncated,true);
  assert.equal((result.html.match(/<p>字/g)??[]).length,2);
  assert.ok(result.html.includes(`href="${url}"`));
  assert.ok(result.html.includes("付费阅读"));
  assert.ok(!result.html.includes("字字字字字字字字字字5"));
});

test("always keeps the first paragraph of a short answer, even if it exceeds 10%",()=>{
  const result=truncatePaidPreview("<p>"+"字".repeat(100)+"</p><p>第二段</p>",url);
  assert.equal(result.truncated,true);
  assert.ok(result.html.startsWith("<p>"+"字".repeat(100)+"</p>"));
  assert.ok(!result.html.includes("第二段"));
});

test("images and nested elements are kept or dropped with their block",()=>{
  const html=`<p>${"字".repeat(10)}</p><figure><img src="https://a/keep.jpg"></figure>${paragraphs(10)}<figure><img src="https://a/drop.jpg"></figure>`;
  const result=truncatePaidPreview(html,url);
  assert.ok(result.html.includes("keep.jpg"));
  assert.ok(!result.html.includes("drop.jpg"));
});

test("content that fits in the preview is returned unchanged and not marked truncated",()=>{
  const result=truncatePaidPreview("<p>短</p>",url);
  assert.deepEqual(result,{html:"<p>短</p>",truncated:false});
  assert.deepEqual(truncatePaidPreview("",url),{html:"",truncated:false});
});

test("normalizeItem marks only answer_type paid_knowledge as paid; missing field and articles are null",()=>{
  assert.equal(normalizeItem("answer",{id:1,content:"",answer_type:"paid_knowledge"}).isPaid,true);
  assert.equal(normalizeItem("answer",{id:1,content:"",answer_type:"normal"}).isPaid,false);
  assert.equal(normalizeItem("answer",{id:1,content:""}).isPaid,null);
  assert.equal(normalizeItem("article",{id:1,content:"",answer_type:"paid_knowledge"}).isPaid,null);
  assert.ok(buildListingUrl("answer","tok").includes("answer_type"));
});

const make=(id:string,isPaid:boolean|null,html:string):ZhihuItem=>({id,kind:"answer",questionId:"q1",title:`标题 ${id}`,url:`https://example.com/${id}`,html,excerpt:"",created:1700000000,updated:1700000000,voteupCount:0,favoriteCount:null,commentCount:0,coverUrl:null,isPaid});
const identity:ContentSource={listAll:async()=>({items:[],reports:[]}),fetchBody:async(item)=>item.html};

test("export truncates only paid items and records them in index.json and export-report.json",async()=>{
  const outputDir=await mkdtemp(path.join(os.tmpdir(),"paywall-test-"));
  const body=paragraphs(20);
  await new Exporter().export([make("1",true,body),make("2",false,body),make("3",null,body)],[],{outputDir,downloadImages:false,delayMs:0},identity,()=>{});
  const index=JSON.parse(await readFile(path.join(outputDir,"index.json"),"utf8"));
  const report=JSON.parse(await readFile(path.join(outputDir,"export-report.json"),"utf8"));
  assert.equal(index.schemaVersion,"1.1.0");
  const byId=Object.fromEntries(index.items.map((r:any)=>[r.id,r]));
  assert.deepEqual([byId["1"].truncated,byId["2"].truncated,byId["3"].truncated],[true,false,false]);
  assert.deepEqual([byId["1"].isPaid,byId["2"].isPaid,byId["3"].isPaid],[true,false,null]);
  assert.equal(report.summary.truncated,1);
  assert.deepEqual(report.truncatedItems.map((x:any)=>x.itemId),["1"]);
  const paid=await readFile(path.join(outputDir,byId["1"].file),"utf8");
  assert.ok(paid.includes("paid: true")&&paid.includes("truncated: true"));
  assert.ok(paid.includes("付费阅读"));
  const full=await readFile(path.join(outputDir,byId["2"].file),"utf8");
  assert.ok(!full.includes("truncated:")&&full.includes("字字字字字字字字字字19"));
});
