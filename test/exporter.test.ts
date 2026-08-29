import test from "node:test"; import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises"; import os from "node:os"; import path from "node:path";
import { Exporter } from "../src/exporter.js";
import { assertSafeOutputDir } from "../src/util.js";
import type { ExportControl, ExportRecord, TaskEvent, ZhihuItem } from "../src/types.js";

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

test("a manifest is left behind after every item, not just at the end (so an interrupted run is still resumable)",async()=>{
  const outputDir=await tmpDir(); const seenTotalsAtEachWrite:number[]=[];
  // A real (if small) delayMs between items, so a short fixed wait after
  // each "done" event is guaranteed to land strictly before the *next*
  // item starts — otherwise a race between this check and the exporter's
  // own next iteration could read a later item's state instead.
  const control=freshControl();
  const onEvent=async(e:TaskEvent)=>{
    if(e.type!=="done") return;
    await new Promise(r=>setTimeout(r,15));
    try{ seenTotalsAtEachWrite.push(JSON.parse(await readFile(path.join(outputDir,"index.json"),"utf8")).summary.succeeded); }
    catch{ seenTotalsAtEachWrite.push(-1); }
  };
  await new Exporter().export([item("1"),item("2"),item("3")],[],{outputDir,downloadImages:false,delayMs:80},e=>{ void onEvent(e); },control);
  await new Promise(r=>setTimeout(r,30));
  assert.deepEqual(seenTotalsAtEachWrite,[1,2,3],"index.json's succeeded count should climb with each item, not jump straight to 3");
});

test("resuming a directory replays already-finished items without redoing them, and merges in newly-finished ones",async()=>{
  const outputDir=await tmpDir();
  // Run 1: a full run of two items, one of which fails deliberately by
  // pointing at an unwritable images directory... simpler: just complete
  // both normally, then simulate a second, later run against the same
  // directory that discovers three items (the original two, plus a new
  // one Zhihu returned this time).
  const firstEvents:TaskEvent[]=[];
  await new Exporter().export([item("1"),item("2")],[],{outputDir,downloadImages:false,delayMs:0},e=>firstEvents.push(e),freshControl());
  assert.ok(firstEvents.some(e=>e.type==="start"&&e.id==="1"));
  assert.ok(firstEvents.some(e=>e.type==="start"&&e.id==="2"));

  // What server.ts does between runs: confirm the directory is now
  // recognized as resumable, then read the manifest back.
  await assert.doesNotReject(assertSafeOutputDir(outputDir,[],[]));
  const prevIndex=JSON.parse(await readFile(path.join(outputDir,"index.json"),"utf8"));
  const resumedRecords=new Map<string,ExportRecord>(prevIndex.items.map((r:ExportRecord)=>[r.id,r]));
  assert.equal(resumedRecords.size,2);

  const secondEvents:TaskEvent[]=[];
  const control=freshControl({resumedRecords});
  await new Exporter().export([item("1"),item("2"),item("3")],[],{outputDir,downloadImages:false,delayMs:0},e=>secondEvents.push(e),control);

  assert.ok(!secondEvents.some(e=>e.type==="start"&&(e.id==="1"||e.id==="2")),"already-finished items must not be reprocessed on resume");
  assert.ok(secondEvents.some(e=>e.type==="start"&&e.id==="3"),"a genuinely new item must still be processed normally");
  assert.ok(secondEvents.some(e=>e.type==="done"&&e.id==="1"&&e.status==="done"));

  const finalIndex=JSON.parse(await readFile(path.join(outputDir,"index.json"),"utf8"));
  assert.deepEqual(finalIndex.items.map((r:ExportRecord)=>r.id).sort(),["1","2","3"]);
  assert.equal(finalIndex.summary.discovered,3);
});
