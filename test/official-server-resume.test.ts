import test from "node:test"; import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises"; import os from "node:os"; import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";
import type { ContentSource } from "../src/source/types.js";
import type { ZhihuItem } from "../src/types.js";

// Exercises server.ts's actual disk-based resume path (reading back
// index.json/export-report.json on a second /api/export call) end to end
// over real HTTP — the exporter-level tests (test/exporter.test.ts,
// test/exporter-quota.test.ts) only ever call Exporter.export directly, so
// they never touch this glue code at all.
const tmpDir = () => mkdtemp(path.join(os.tmpdir(), "official-resume-test-"));
const item = (id: string): ZhihuItem => ({ id, kind: "answer", questionId: null, title: `标题 ${id}`, url: `https://www.zhihu.com/answer/${id}`, html: "", excerpt: "", created: 1700000000 + Number(id), updated: 1700000000 + Number(id), voteupCount: 0, favoriteCount: null, commentCount: 0, coverUrl: null });

async function waitForPhase(base: string, phases: string[], timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { progress } = await fetch(`${base}/api/status`).then((r) => r.json());
    if (phases.includes(progress.phase)) return progress;
    if (Date.now() > deadline) throw new Error(`timed out waiting for phase in [${phases}], last saw "${progress.phase}"`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("a second /api/export against the same output dir resumes already-finished items instead of redoing them", async () => {
  const outputDir = await tmpDir();
  const items = [item("1"), item("2"), item("3")];
  let fetchBodyCalls: string[] = [];
  const makeSource = (): ContentSource => ({
    listAll: async () => ({ items, reports: [] }),
    fetchBody: async (it) => { fetchBodyCalls.push(it.id); return `<p>${it.id}</p>`; },
  });
  const app = createServer({ edition: "official", credentialField: "accessSecret", createSource: makeSource });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = () => fetch(`${base}/api/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outputDir, downloadImages: false, delayMs: 300, accessSecret: "s1" }) });

    // First run: nothing exists yet, exports all three from scratch.
    await post();
    const firstDone = await waitForPhase(base, ["done", "error"]);
    assert.equal(firstDone.phase, "done");
    assert.deepEqual(fetchBodyCalls.sort(), ["1", "2", "3"]);

    // Second run against the exact same directory, same three items
    // discovered again (ids match by construction, exactly like a real
    // OfficialApiContentSource re-listing the same account's content):
    // every item must resume from the manifest, none re-fetched.
    fetchBodyCalls = [];
    await post();
    const secondDone = await waitForPhase(base, ["done", "error"]);
    assert.equal(secondDone.phase, "done");
    assert.deepEqual(fetchBodyCalls, [], "an already-finished item must not be re-fetched on resume");
    assert.equal(secondDone.current, 3);
    assert.equal(secondDone.total, 3);
  } finally {
    server.close();
  }
});
