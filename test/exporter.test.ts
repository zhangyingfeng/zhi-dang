import test from "node:test"; import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises"; import os from "node:os"; import path from "node:path";
import { Exporter } from "../src/exporter.js";
import type { ExportControl, TaskEvent, ZhihuItem } from "../src/types.js";

const tmpDir=()=>mkdtemp(path.join(os.tmpdir(),"export-test-"));
const item=(id:string,overrides:Partial<ZhihuItem>={}):ZhihuItem=>({
  id,kind:"answer",questionId:"q1",title:`标题 ${id}`,url:`https://example.com/${id}`,
  html:`<p>正文 ${id}</p>`,excerpt:"",created:1700000000,updated:1700000000,
  voteupCount:0,favoriteCount:null,commentCount:0,coverUrl:null,...overrides,
});
const freshControl=(overrides:Partial<ExportControl>={}):ExportControl=>({paused:false,skippedItemIds:new Set(),skipImagesItemIds:new Set(),...overrides});

test("a skipped item is excluded from output and recorded in the report, not treated as a failure",async()=>{
  const outputDir=await tmpDir(); const events:TaskEvent[]=[];
  const control=freshControl({skippedItemIds:new Set(["2"])});
  await new Exporter().export([item("1"),item("2"),item("3")],[],{outputDir,downloadImages:false,delayMs:0},e=>events.push(e),control);
  const report=JSON.parse(await readFile(path.join(outputDir,"export-report.json"),"utf8"));
  assert.equal(report.summary.skipped,1);
  assert.equal(report.summary.succeeded,2);
  assert.equal(report.summary.failed,0);
  assert.deepEqual(report.skippedItems.map((s:{itemId:string})=>s.itemId),["2"]);
  assert.ok(events.some(e=>e.type==="done"&&e.id==="2"&&e.status==="skipped"));
  assert.ok(!events.some(e=>e.type==="start"&&e.id==="2"),"a skipped item should never emit a start event");
});

test("pausing blocks the loop until resumed, without dropping any items",async()=>{
  const outputDir=await tmpDir(); const events:TaskEvent[]=[];
  const control=freshControl({paused:true});
  const run=new Exporter().export([item("1"),item("2")],[],{outputDir,downloadImages:false,delayMs:0},e=>events.push(e),control);
  await new Promise(r=>setTimeout(r,150));
  assert.equal(events.length,0,"no item should start while paused");
  control.paused=false;
  await run;
  assert.equal(events.filter(e=>e.type==="start").length,2);
  const report=JSON.parse(await readFile(path.join(outputDir,"export-report.json"),"utf8"));
  assert.equal(report.summary.succeeded,2);
});

test("skipping just the images subtask still writes the item, without downloading images",async()=>{
  const outputDir=await tmpDir(); const events:TaskEvent[]=[];
  const control=freshControl({skipImagesItemIds:new Set(["1"])});
  await new Exporter().export([item("1",{html:`<p>正文</p><img src="https://example.com/pic.jpg">`})],[],{outputDir,downloadImages:true,delayMs:0},e=>events.push(e),control);
  assert.ok(events.some(e=>e.type==="subtask"&&e.id==="1"&&e.key==="images"&&e.status==="skipped"));
  assert.ok(!events.some(e=>e.type==="images-list"),"a skipped images subtask should never enumerate URLs to fetch");
  const report=JSON.parse(await readFile(path.join(outputDir,"export-report.json"),"utf8"));
  assert.equal(report.summary.succeeded,1);
  assert.equal(report.summary.imageFailures,0);
});
