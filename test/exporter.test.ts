import test from "node:test"; import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises"; import os from "node:os"; import path from "node:path";
import { Exporter } from "../src/exporter.js";
import { assertSafeOutputDir } from "../src/util.js";
import type { ContentSource } from "../src/source/types.js";
import type { ExportControl, ExportRecord, TaskEvent, ZhihuItem } from "../src/types.js";

const tmpDir=()=>mkdtemp(path.join(os.tmpdir(),"export-test-"));
// A source that already has full content (mirrors DirectContentSource) —
// fetchBody is a no-op, matching every one of these tests' assumption that
// item.html is already the full body to write.
const identitySource:ContentSource={listAll:async()=>({items:[],reports:[]}),fetchBody:async(item)=>item.html};
const item=(id:string,overrides:Partial<ZhihuItem>={}):ZhihuItem=>({
  id,kind:"answer",questionId:"q1",title:`标题 ${id}`,url:`https://example.com/${id}`,
  html:`<p>正文 ${id}</p>`,excerpt:"",created:1700000000,updated:1700000000,
  voteupCount:0,favoriteCount:null,commentCount:0,coverUrl:null,...overrides,
});
const freshControl=(overrides:Partial<ExportControl>={}):ExportControl=>({paused:false,skippedItemIds:new Set(),skipImagesItemIds:new Set(),...overrides});

test("a skipped item is excluded from output and recorded in the report, not treated as a failure",async()=>{
  const outputDir=await tmpDir(); const events:TaskEvent[]=[];
  const control=freshControl({skippedItemIds:new Set(["2"])});
  await new Exporter().export([item("1"),item("2"),item("3")],[],{outputDir,downloadImages:false,delayMs:0},identitySource,e=>events.push(e),control);
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
  const run=new Exporter().export([item("1"),item("2")],[],{outputDir,downloadImages:false,delayMs:0},identitySource,e=>events.push(e),control);
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
  await new Exporter().export([item("1",{html:`<p>正文</p><img src="https://example.com/pic.jpg">`})],[],{outputDir,downloadImages:true,delayMs:0},identitySource,e=>events.push(e),control);
  assert.ok(events.some(e=>e.type==="subtask"&&e.id==="1"&&e.key==="images"&&e.status==="skipped"));
  assert.ok(!events.some(e=>e.type==="images-list"),"a skipped images subtask should never enumerate URLs to fetch");
  const report=JSON.parse(await readFile(path.join(outputDir,"export-report.json"),"utf8"));
  assert.equal(report.summary.succeeded,1);
  assert.equal(report.summary.imageFailures,0);
});

test("a manifest is left behind after every item, not just at the end (so an interrupted run is still resumable)",async()=>{
  const outputDir=await tmpDir(); const seenTotalsAtEachWrite:number[]=[];
  // export() fires the "done" event synchronously, *before* its own
  // await persist() below has actually finished writing index.json — so a
  // fixed-delay wait here is inherently racy under CI's less predictable
  // I/O scheduling (this flaked in CI: saw [1,1,2] instead of [1,2,3],
  // each read lagging one item behind because persist() for the just-
  // finished item hadn't landed on disk yet). Poll instead of guessing a
  // delay that's "surely" long enough: each "done" event knows which
  // item number it corresponds to, so wait until index.json actually
  // reports that count (bounded by a generous timeout, not a fixed sleep).
  const control=freshControl();
  let expectedCount=0;
  const onEvent=async(e:TaskEvent)=>{
    if(e.type!=="done") return;
    expectedCount++;
    const target=expectedCount;
    const deadline=Date.now()+2000;
    let count=-1;
    while(Date.now()<deadline){
      try{ count=JSON.parse(await readFile(path.join(outputDir,"index.json"),"utf8")).summary.succeeded; }
      catch{ count=-1; }
      if(count>=target) break;
      await new Promise(r=>setTimeout(r,5));
    }
    seenTotalsAtEachWrite.push(count);
  };
  await new Exporter().export([item("1"),item("2"),item("3")],[],{outputDir,downloadImages:false,delayMs:80},identitySource,e=>{ void onEvent(e); },control);
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
  await new Exporter().export([item("1"),item("2")],[],{outputDir,downloadImages:false,delayMs:0},identitySource,e=>firstEvents.push(e),freshControl());
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
  await new Exporter().export([item("1"),item("2"),item("3")],[],{outputDir,downloadImages:false,delayMs:0},identitySource,e=>secondEvents.push(e),control);

  assert.ok(!secondEvents.some(e=>e.type==="start"&&(e.id==="1"||e.id==="2")),"already-finished items must not be reprocessed on resume");
  assert.ok(secondEvents.some(e=>e.type==="start"&&e.id==="3"),"a genuinely new item must still be processed normally");
  assert.ok(secondEvents.some(e=>e.type==="done"&&e.id==="1"&&e.status==="done"));

  const finalIndex=JSON.parse(await readFile(path.join(outputDir,"index.json"),"utf8"));
  assert.deepEqual(finalIndex.items.map((r:ExportRecord)=>r.id).sort(),["1","2","3"]);
  assert.equal(finalIndex.summary.discovered,3);
});

// Mirrors the key edition's KeyContentSource: listAll returns items with no
// html at all (metadata-only listing), and the real body only shows up once
// fetchBody is called per item — the case server.ts's own upfront
// duplicate-detection pass (over items[].html) can't do anything with,
// since every item's normalized length is 0 at that point.
const lazySource=(bodies:Record<string,string>):ContentSource=>({listAll:async()=>({items:[],reports:[]}),fetchBody:async(it)=>bodies[it.id]});

test("a duplicate only knowable after fetchBody (metadata-only listing) is still flagged, not silently exported unflagged",async()=>{
  const outputDir=await tmpDir(); const events:TaskEvent[]=[];
  const source=lazySource({
    "1":"<p>这是一段完全相同的正文内容，用来验证跨条目的哈希去重能不能生效。</p>",
    "2":"<p>这一条内容完全不一样，不应该被标记成重复。</p>",
    "3":"<p>这是一段完全相同的正文内容，用来验证跨条目的哈希去重能不能生效。</p>",
  });
  await new Exporter().export([item("1"),item("2"),item("3")],[],{outputDir,downloadImages:false,delayMs:0},source,e=>events.push(e),freshControl());
  const dupEvents=events.filter(e=>e.type==="duplicate") as Extract<TaskEvent,{type:"duplicate"}>[];
  // Item "2" (unique body) must never be flagged.
  assert.ok(!dupEvents.some(e=>e.id==="2"));
  // Both "1" and "3" must end up flagged, including "1" — discovered only
  // once "3" is fetched, well after "1" already finished — confirming the
  // backfill onto an already-"done" task actually fires.
  const flaggedIds=new Set(dupEvents.map(e=>e.id));
  assert.deepEqual([...flaggedIds].sort(),["1","3"]);
  for(const e of dupEvents){ assert.equal(e.info.groupSize,2); }
  // Both copies are still written — this is a read-only hint, not an
  // automatic skip.
  const finalIndex=JSON.parse(await readFile(path.join(outputDir,"index.json"),"utf8"));
  assert.deepEqual(finalIndex.items.map((r:ExportRecord)=>r.id).sort(),["1","2","3"]);
});

test("bodies too short for reliable comparison are never flagged as duplicates",async()=>{
  const outputDir=await tmpDir(); const events:TaskEvent[]=[];
  const source=lazySource({"1":"<p>短</p>","2":"<p>短</p>"});
  await new Exporter().export([item("1"),item("2")],[],{outputDir,downloadImages:false,delayMs:0},source,e=>events.push(e),freshControl());
  assert.ok(!events.some(e=>e.type==="duplicate"));
});
