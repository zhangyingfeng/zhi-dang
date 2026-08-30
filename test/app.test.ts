// Characterization tests for public/app.js — the frontend has never had
// automated coverage, and the two real regressions that shipped in 1.1.0/1.1.1
// (logout not clearing the task list; logout crashing on a stale #reveal
// reference) were both exactly the kind of DOM-state-logic bug this file is
// meant to catch. It runs the real app.js source inside jsdom, with
// window.__TAURI__/fetch/setInterval/Notification stubbed out — see
// createHarness() below for what's faked and why.
import test from "node:test"; import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, "../public/index.html"), "utf8");
const appJsSource = readFileSync(path.join(here, "../public/app.js"), "utf8");

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

// Lets any pending microtasks (unawaited async IIFEs, .then() chains from the
// initial login check, etc.) settle before a test makes assertions.
const flush = () => new Promise((r) => setTimeout(r, 0));

type InvokeHandler = (args: any) => any;

function createHarness(opts: { checkLoginStatus?: any } = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "dangerously" });
  const window = dom.window as any;
  const document = window.document;

  const invokeCalls: { cmd: string; args: any }[] = [];
  const invokeHandlers: Record<string, InvokeHandler> = {
    check_login_status: () => opts.checkLoginStatus ?? { loggedIn: false },
  };
  window.__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: any) => {
        invokeCalls.push({ cmd, args });
        const handler = invokeHandlers[cmd];
        return Promise.resolve(handler ? handler(args) : undefined);
      },
    },
    event: { listen: () => {} },
  };

  let statusState: any = { phase: "idle", message: "准备就绪" };
  const fetchCalls: { url: string; init?: any }[] = [];
  window.fetch = (url: string, init?: any) => {
    fetchCalls.push({ url, init });
    if (url === "/api/status") return Promise.resolve(jsonResponse({ progress: statusState }));
    // Real endpoint long-polls for up to 25s; never resolving here mirrors
    // that instead of spinning relayFrontendFetches()'s for(;;) loop hot.
    if (url === "/api/frontend-fetch-request") return new Promise(() => {});
    if (url === "/api/reset") { statusState = { phase: "idle", message: "准备就绪" }; return Promise.resolve(jsonResponse({ ok: true })); }
    if (url === "/api/export/pause") { statusState = { ...statusState, paused: true }; return Promise.resolve(jsonResponse({ ok: true })); }
    if (url === "/api/export/resume") { statusState = { ...statusState, paused: false }; return Promise.resolve(jsonResponse({ ok: true })); }
    return Promise.resolve(jsonResponse({ ok: true }));
  };

  // jsdom doesn't implement the Notification API at all.
  function NotificationStub(this: any) {}
  NotificationStub.permission = "granted";
  NotificationStub.requestPermission = async () => "granted";
  window.Notification = NotificationStub;

  // Real timers would make tests slow (resizeToContent alone waits 150ms)
  // and flaky; nothing in app.js awaits resizeToContent's own promise, so
  // letting its internal timer hang forever is harmless here.
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  let tick: (() => Promise<void>) | null = null;
  window.setInterval = (fn: any) => { tick = fn; return 1; };

  window.eval(appJsSource);

  return {
    window, document,
    setStatus: (s: any) => { statusState = s; },
    tick: async () => { await tick?.(); },
    invokeCalls, fetchCalls,
    setInvokeHandler: (cmd: string, fn: InvokeHandler) => { invokeHandlers[cmd] = fn; },
  };
}

test("no existing session on launch shows the disabled login screen",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:false}});
  await flush();
  assert.equal(h.document.getElementById("step-title").textContent,"登录知乎导出");
  assert.equal(h.document.getElementById("auth-btn").textContent,"开始登录");
  assert.equal(h.document.getElementById("dir").disabled,true);
  assert.equal(h.document.getElementById("export").disabled,true);
});

test("an existing session on launch skips straight to the ready state",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:true,urlToken:"zhangyingfeng",name:"张三"}});
  await flush();
  assert.equal(h.document.getElementById("step-title").textContent,"欢迎 张三，可以下载");
  assert.equal(h.document.getElementById("auth-btn").textContent,"退出登录");
  assert.equal(h.document.getElementById("dir").value,"zhangyingfeng");
  assert.equal(h.document.getElementById("dir").disabled,false);
  assert.equal(h.document.getElementById("export").disabled,false);
});

test("logging out fully resets the UI: task list, status card, save location, and doesn't throw",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:true,urlToken:"zhangyingfeng",name:"张三"}});
  await flush();
  // Simulate a finished export so there's a populated task list/visible
  // status card to clear -- this is the exact scenario both regressions
  // (49411da and the #reveal crash) only showed up in.
  h.setStatus({phase:"done",message:"完成：1 个回答",current:1,total:1,outputDir:"/Users/zhangyingfeng/zhangyingfeng",tasks:[
    {id:"1",kind:"answer",title:"标题",status:"done",subtasks:[{key:"write",status:"done"}]},
  ]});
  await h.tick();
  h.document.getElementById("status-section").hidden=false;
  assert.equal(h.document.getElementById("task-list").hidden,false,"sanity check: task list should be visible before logout");

  await assert.doesNotReject(h.document.getElementById("auth-btn").onclick());

  assert.equal(h.document.getElementById("task-list").hidden,true);
  assert.equal(h.document.getElementById("task-list").children.length,0);
  assert.equal(h.document.getElementById("status-section").hidden,true);
  assert.equal(h.document.getElementById("dir").value,"exports");
  assert.equal(h.document.getElementById("auth-btn").textContent,"开始登录");
  assert.ok(h.invokeCalls.some(c=>c.cmd==="logout"));
  assert.ok(h.fetchCalls.some(c=>c.url==="/api/reset"));
});

test("logout is guarded against the poll loop resurrecting stale state",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:true,urlToken:"zhangyingfeng",name:"张三"}});
  await flush();
  h.setStatus({phase:"done",message:"完成",current:1,total:1,outputDir:"/x",tasks:[
    {id:"1",kind:"answer",title:"t",status:"done",subtasks:[]},
  ]});
  await h.document.getElementById("auth-btn").onclick();
  // The backend's fake /api/status still reports the old "done" progress
  // (logout doesn't touch it directly -- only /api/reset does, which the
  // handler already called above). A poll tick after logout must not
  // repopulate the UI from it.
  await h.tick();
  assert.equal(h.document.getElementById("task-list").hidden,true);
  assert.equal(h.document.getElementById("export").disabled,true);
});

test("task list renders one row per item with correct kind/status, and patches in place rather than rebuilding",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:true}});
  await flush();
  h.setStatus({phase:"exporting",message:"x",current:0,total:2,tasks:[
    {id:"1",kind:"answer",title:"第一项",status:"pending",subtasks:[{key:"write",status:"pending"}]},
    {id:"2",kind:"article",title:"第二项",status:"active",subtasks:[{key:"write",status:"active"}]},
  ]});
  await h.tick();
  const rows=h.document.querySelectorAll(".task-item");
  assert.equal(rows.length,2);
  assert.equal(rows[0].querySelector(".task-kind").textContent,"回答");
  assert.equal(rows[0].querySelector(".task-title").textContent,"第一项");
  assert.equal(rows[0].querySelector(".task-dot").className,"task-dot pending");
  assert.equal(rows[1].querySelector(".task-kind").textContent,"文章");
  assert.equal(rows[1].querySelector(".task-dot").className,"task-dot active");

  const firstRowEl=rows[0];
  h.setStatus({phase:"exporting",message:"x",current:1,total:2,tasks:[
    {id:"1",kind:"answer",title:"第一项",status:"done",subtasks:[{key:"write",status:"done"}]},
    {id:"2",kind:"article",title:"第二项",status:"active",subtasks:[{key:"write",status:"active"}]},
  ]});
  await h.tick();
  const rowsAfter=h.document.querySelectorAll(".task-item");
  assert.equal(rowsAfter.length,2,"a second tick must not duplicate rows");
  assert.strictEqual(rowsAfter[0],firstRowEl,"an existing row must be patched in place, not rebuilt");
  assert.equal(rowsAfter[0].querySelector(".task-dot").className,"task-dot done");
});

test("a duplicate-flagged item shows the read-only badge; others don't",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:true}});
  await flush();
  h.setStatus({phase:"exporting",message:"x",tasks:[
    {id:"1",kind:"answer",title:"a",status:"pending",subtasks:[],duplicate:{groupSize:2,otherTitles:["b"]}},
    {id:"2",kind:"answer",title:"b",status:"pending",subtasks:[]},
  ]});
  await h.tick();
  const rows=h.document.querySelectorAll(".task-item");
  assert.equal(rows[0].querySelector(".task-dup").hidden,false);
  assert.equal(rows[1].querySelector(".task-dup").hidden,true);
});

test("skip button is shown only while an item is pending, and posts the right scope",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:true}});
  await flush();
  h.setStatus({phase:"exporting",message:"x",tasks:[
    {id:"1",kind:"answer",title:"a",status:"pending",subtasks:[{key:"images",status:"pending"},{key:"write",status:"pending"}]},
  ]});
  await h.tick();
  const row=h.document.querySelectorAll(".task-item")[0];
  const skipBtn=row.querySelector(".task-actions .task-skip");
  assert.equal(skipBtn.hidden,false);
  skipBtn.onclick();
  assert.ok(h.fetchCalls.some(c=>c.url==="/api/export/skip"&&JSON.parse(c.init.body).scope==="item"&&JSON.parse(c.init.body).id==="1"));

  h.setStatus({phase:"exporting",message:"x",tasks:[
    {id:"1",kind:"answer",title:"a",status:"active",subtasks:[{key:"images",status:"active"},{key:"write",status:"pending"}]},
  ]});
  await h.tick();
  assert.equal(row.querySelector(".task-actions .task-skip").hidden,true,"an in-flight item can't be skipped");
});

test("pause button reflects export phase/paused state and posts the right endpoint",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:true}});
  await flush();
  h.setStatus({phase:"listing",message:"x"});
  await h.tick();
  assert.equal(h.document.getElementById("pause-btn").hidden,true,"listing isn't pausable");

  h.setStatus({phase:"exporting",message:"x",paused:false});
  await h.tick();
  assert.equal(h.document.getElementById("pause-btn").hidden,false);
  assert.equal(h.document.getElementById("pause-btn").textContent,"暂停");
  await h.document.getElementById("pause-btn").onclick();
  assert.ok(h.fetchCalls.some(c=>c.url==="/api/export/pause"));

  h.setStatus({phase:"exporting",message:"x",paused:true});
  await h.tick();
  assert.equal(h.document.getElementById("pause-btn").textContent,"继续");
});

test("export button becomes 在访达中显示 only while 保存位置 still matches the finished directory, and reverts once it's edited",async()=>{
  const h=createHarness({checkLoginStatus:{loggedIn:true,urlToken:"zhangyingfeng"}});
  await flush();
  h.document.getElementById("dir").value="zhangyingfeng";

  h.setStatus({phase:"done",message:"完成",current:1,total:1,outputDir:"/x/zhangyingfeng"});
  await h.tick();
  const exportBtn=h.document.getElementById("export");
  assert.equal(exportBtn.textContent,"在访达中显示");
  assert.equal(exportBtn.dataset.mode,"reveal");
  assert.equal(exportBtn.disabled,false);

  // Clicking in reveal mode must reveal, not start a new export.
  await exportBtn.onclick();
  assert.ok(h.invokeCalls.some(c=>c.cmd==="plugin:opener|reveal_item_in_dir"));
  assert.ok(!h.fetchCalls.some(c=>c.url==="/api/export"));

  h.document.getElementById("dir").value="exports-2";
  await h.tick();
  assert.equal(exportBtn.textContent,"开始导出");
  assert.equal(exportBtn.dataset.mode,"export");
});
