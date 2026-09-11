import test from "node:test"; import assert from "node:assert/strict";
import { KeyContentSource, fetchKeyQuota } from "../src/source/key.js";
import { QuotaExhaustedError } from "../src/source/types.js";
import type { ZhihuItem } from "../src/types.js";

// Stubs global fetch for the duration of `run`, routing every call through
// `handler(url)` to produce the JSON body — callOfficialApi (src/source/key.ts)
// always parses a { Code, Message, Data } shape, so that's all handler needs to return.
async function withMockFetch(handler: (url: URL) => unknown, run: () => Promise<void>) {
  const original = globalThis.fetch;
  // @ts-expect-error - test double, not a full Fetch implementation
  globalThis.fetch = async (input: any) => {
    const url = input instanceof URL ? input : new URL(String(input));
    return { ok: true, status: 200, json: async () => handler(url) };
  };
  try { await run(); } finally { globalThis.fetch = original; }
}

const sampleItem: ZhihuItem = { id: "1", kind: "answer", questionId: null, title: "标题", url: "https://www.zhihu.com/answer/1", html: "", excerpt: "", created: 0, updated: 0, voteupCount: 0, favoriteCount: null, commentCount: 0, coverUrl: null };

test("listAll paginates via Offset/NextOffset, maps answer/article, and drops other content types", async () => {
  const pages: Record<number, unknown> = {
    0: { Code: 0, Message: "success", Data: { Items: [
      { ContentType: "answer", Url: "https://www.zhihu.com/question/7/answer/1", Title: "A1", Summary: "s1", CreatedAt: 100, LikeCount: 1, CommentCount: 2, FavoriteCount: 3 },
      { ContentType: "pin", Url: "https://www.zhihu.com/pin/9" },
    ], Paging: { IsEnd: false, NextOffset: "50", Totals: 5 } } },
    50: { Code: 0, Message: "success", Data: { Items: [
      { ContentType: "article", Url: "https://zhuanlan.zhihu.com/p/2", Title: "Art", Summary: "s2", CreatedAt: 200 },
    ], Paging: { IsEnd: true, Totals: 5 } } },
  };
  await withMockFetch((url) => {
    assert.equal(url.pathname, "/api/v1/user/contents");
    return pages[Number(url.searchParams.get("Offset"))];
  }, async () => {
    const source = new KeyContentSource("secret", 0);
    const { items, reports } = await source.listAll();
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((i) => i.kind).sort(), ["answer", "article"]);
    const answer = items.find((i) => i.kind === "answer")!;
    assert.equal(answer.id, "1");
    assert.equal(answer.questionId, "7");
    assert.equal(answer.html, "", "list endpoint is metadata/excerpt only — fetchBody fills this in later");
    assert.equal(answer.excerpt, "s1");
    const byKind = Object.fromEntries(reports.map((r) => [r.kind, r]));
    assert.equal(byKind.answer.received, 1);
    assert.equal(byKind.article.received, 1);
    // Paging.Totals counts every ContentType (including the dropped "pin"),
    // so a per-kind report must not claim it as that kind's expected total.
    assert.equal(byKind.answer.reportedTotal, null);
  });
});

test("listAll counts same-kind duplicate ids without dropping the first occurrence", async () => {
  await withMockFetch(() => ({ Code: 0, Message: "success", Data: { Items: [
    { ContentType: "answer", Url: "https://www.zhihu.com/answer/1", Title: "A" },
    { ContentType: "answer", Url: "https://www.zhihu.com/answer/1", Title: "A dup" },
  ], Paging: { IsEnd: true } } }), async () => {
    const source = new KeyContentSource("secret", 0);
    const { items, reports } = await source.listAll();
    assert.equal(items.length, 1);
    const answerReport = reports.find((r) => r.kind === "answer")!;
    assert.equal(answerReport.received, 2);
    assert.equal(answerReport.duplicates, 1);
    assert.equal(answerReport.unique, 1);
  });
});

test("listAll throws a descriptive error when a page isn't final but has no NextOffset", async () => {
  await withMockFetch(() => ({ Code: 0, Message: "success", Data: { Items: [], Paging: { IsEnd: false } } }), async () => {
    const source = new KeyContentSource("secret", 0);
    await assert.rejects(source.listAll(), /分页数据不完整/);
  });
});

test("listAll throws a descriptive error when the listing call itself fails", async () => {
  await withMockFetch(() => ({ Code: 20001, Message: "鉴权失败" }), async () => {
    const source = new KeyContentSource("secret", 0);
    await assert.rejects(source.listAll(), /20001/);
  });
});

test("fetchBody returns the full body text on success", async () => {
  await withMockFetch((url) => {
    assert.equal(url.pathname, "/api/v1/user/content_detail");
    assert.equal(url.searchParams.get("ContentUrl"), sampleItem.url);
    return { Code: 0, Message: "success", Data: { ContentType: "answer", Url: sampleItem.url, Title: "A", Body: "<p>full</p>" } };
  }, async () => {
    const source = new KeyContentSource("secret");
    assert.equal(await source.fetchBody(sampleItem), "<p>full</p>");
  });
});

test("fetchBody throws QuotaExhaustedError on the quota/rate-limit codes (30001, 30002)", async () => {
  for (const code of [30001, 30002]) {
    await withMockFetch(() => ({ Code: code, Message: "限流" }), async () => {
      const source = new KeyContentSource("secret");
      await assert.rejects(source.fetchBody(sampleItem), QuotaExhaustedError);
    });
  }
});

test("fetchBody throws a plain (non-quota) Error on other failure codes", async () => {
  await withMockFetch(() => ({ Code: 20001, Message: "鉴权失败" }), async () => {
    const source = new KeyContentSource("secret");
    await assert.rejects(source.fetchBody(sampleItem), (err: unknown) => err instanceof Error && !(err instanceof QuotaExhaustedError) && /鉴权失败/.test(err.message));
  });
});

test("fetchKeyQuota maps the Data array into a stable shape", async () => {
  await withMockFetch((url) => {
    assert.equal(url.pathname, "/api/v1/quota");
    assert.equal(url.searchParams.get("APIIDs"), "creator");
    return { Code: 0, Message: "success", Data: [{ APIID: "creator", APIName: "创作能力", TotalQuota: 100, TotalUsed: 12, RemainingQuota: 88 }] };
  }, async () => {
    assert.deepEqual(await fetchKeyQuota("secret"), [{ apiId: "creator", name: "创作能力", total: 100, used: 12, remaining: 88 }]);
  });
});
