import test from "node:test"; import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises"; import os from "node:os"; import path from "node:path";
import { Exporter } from "../src/exporter.js";
import { QuotaExhaustedError, type ContentSource } from "../src/source/types.js";
import type { ExportControl, ExportRecord, TaskEvent, ZhihuItem } from "../src/types.js";

const tmpDir = () => mkdtemp(path.join(os.tmpdir(), "export-quota-test-"));
const item = (id: string): ZhihuItem => ({ id, kind: "answer", questionId: null, title: `标题 ${id}`, url: `https://example.com/${id}`, html: "", excerpt: "", created: 1700000000, updated: 1700000000, voteupCount: 0, favoriteCount: null, commentCount: 0, coverUrl: null });
const freshControl = (overrides: Partial<ExportControl> = {}): ExportControl => ({ paused: false, skippedItemIds: new Set(), skipImagesItemIds: new Set(), ...overrides });
const identitySource: ContentSource = { listAll: async () => ({ items: [], reports: [] }), fetchBody: async (it) => `<p>${it.id}</p>` };

test("a QuotaExhaustedError from fetchBody stops the run without failing the current or later items", async () => {
  const outputDir = await tmpDir();
  let calls = 0;
  const quotaOnSecond: ContentSource = {
    listAll: async () => ({ items: [], reports: [] }),
    fetchBody: async (it) => { calls++; if (calls === 2) throw new QuotaExhaustedError("配额已用完"); return `<p>${it.id}</p>`; },
  };
  const events: TaskEvent[] = [];
  const result = await new Exporter().export([item("1"), item("2"), item("3")], [], { outputDir, downloadImages: false, delayMs: 0 }, quotaOnSecond, (e) => events.push(e), freshControl());
  assert.equal(result.quotaExhausted, true);
  assert.ok(events.some((e) => e.type === "done" && e.id === "1" && e.status === "done"));
  assert.ok(!events.some((e) => e.id === "2"), "the item that hit the quota must not emit any event (not started, not failed)");
  assert.ok(!events.some((e) => e.id === "3"), "items after the quota hit must be left completely untouched");
  const index = JSON.parse(await readFile(path.join(outputDir, "index.json"), "utf8"));
  assert.deepEqual(index.items.map((r: ExportRecord) => r.id), ["1"]);
  assert.equal(index.summary.failed, 0, "a quota stop is not an item failure");
});

test("resuming after a quota stop picks up exactly where it left off", async () => {
  const outputDir = await tmpDir();
  let calls = 0;
  const quotaOnSecond: ContentSource = {
    listAll: async () => ({ items: [], reports: [] }),
    fetchBody: async (it) => { calls++; if (calls === 2) throw new QuotaExhaustedError("配额已用完"); return `<p>${it.id}</p>`; },
  };
  await new Exporter().export([item("1"), item("2"), item("3")], [], { outputDir, downloadImages: false, delayMs: 0 }, quotaOnSecond, () => {}, freshControl());
  const prevIndex = JSON.parse(await readFile(path.join(outputDir, "index.json"), "utf8"));
  const resumedRecords = new Map<string, ExportRecord>(prevIndex.items.map((r: ExportRecord) => [r.id, r]));
  assert.equal(resumedRecords.size, 1);

  const secondEvents: TaskEvent[] = [];
  const result = await new Exporter().export([item("1"), item("2"), item("3")], [], { outputDir, downloadImages: false, delayMs: 0 }, identitySource, (e) => secondEvents.push(e), freshControl({ resumedRecords }));
  assert.equal(result.quotaExhausted, false);
  assert.ok(!secondEvents.some((e) => e.type === "start" && e.id === "1"), "already-finished item must not be reprocessed");
  assert.ok(secondEvents.some((e) => e.type === "start" && e.id === "2"));
  assert.ok(secondEvents.some((e) => e.type === "start" && e.id === "3"));
  const finalIndex = JSON.parse(await readFile(path.join(outputDir, "index.json"), "utf8"));
  assert.deepEqual(finalIndex.items.map((r: ExportRecord) => r.id).sort(), ["1", "2", "3"]);
});

test("an already-resumed item positioned after the quota-exhaustion point is not dropped from the manifest", async () => {
  const outputDir = await tmpDir();
  // Reproduces the real bug: item "2" is genuinely new and hits the quota
  // wall; item "4" was already successfully exported in a *previous* run
  // (seeded via resumedRecords) but sits *after* the break point in this
  // array — exactly what a real newest-first listing produces when quota
  // runs out partway through, not at the very end. Before the fix, `break`
  // meant item "4" never got the chance to be re-affirmed into `records`,
  // so it silently vanished from index.json even though its .md file was
  // untouched on disk — the next run would then burn quota re-fetching
  // content that was already sitting right there.
  const resumedRecord = { ...item("4"), html: undefined, cover: null, file: "answers/4.md" } as unknown as ExportRecord;
  const control = freshControl({ resumedRecords: new Map([["4", resumedRecord]]) });
  const quotaOnItem2: ContentSource = {
    listAll: async () => ({ items: [], reports: [] }),
    fetchBody: async (it) => { if (it.id === "2") throw new QuotaExhaustedError("配额已用完"); return `<p>${it.id}</p>`; },
  };
  const result = await new Exporter().export([item("1"), item("2"), item("3"), item("4")], [], { outputDir, downloadImages: false, delayMs: 0 }, quotaOnItem2, () => {}, control);
  assert.equal(result.quotaExhausted, true);
  const index = JSON.parse(await readFile(path.join(outputDir, "index.json"), "utf8"));
  assert.deepEqual(index.items.map((r: ExportRecord) => r.id).sort(), ["1", "4"], "item 4 must survive this run's manifest even though it comes after where quota ran out");
});

test("a non-quota fetchBody error is still recorded as an ordinary item failure", async () => {
  const outputDir = await tmpDir();
  const failingSource: ContentSource = {
    listAll: async () => ({ items: [], reports: [] }),
    fetchBody: async (it) => { if (it.id === "2") throw new Error("知乎开放平台返回错误 20001：鉴权失败"); return `<p>${it.id}</p>`; },
  };
  const events: TaskEvent[] = [];
  const result = await new Exporter().export([item("1"), item("2"), item("3")], [], { outputDir, downloadImages: false, delayMs: 0 }, failingSource, (e) => events.push(e), freshControl());
  assert.equal(result.quotaExhausted, false, "an ordinary failure must not be treated as a quota stop");
  assert.ok(events.some((e) => e.type === "done" && e.id === "2" && e.status === "error"));
  assert.ok(events.some((e) => e.type === "start" && e.id === "3"), "processing continues past an ordinary per-item failure");
  const report = JSON.parse(await readFile(path.join(outputDir, "export-report.json"), "utf8"));
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.succeeded, 2);
});
