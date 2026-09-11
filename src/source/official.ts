import { createHash } from "node:crypto";
import { sleep } from "../util.js";
import { QuotaExhaustedError, type ContentSource } from "./types.js";
import type { ContentKind, ListingReport, ZhihuItem } from "../types.js";

// Zhihu's official Data Open Platform (developer.zhihu.com) — the
// App-Store-safe replacement for the webview-relay direct source. Every
// call is a plain bearer-token REST request; unlike direct.ts, none of this
// needs the Tauri login window or its page-context fetch relay.
const OFFICIAL_API_BASE = "https://developer.zhihu.com/api/v1";

interface OfficialResponse { Code: number; Message: string; Data: any }

async function callOfficialApi(path: string, params: Record<string, string>, secret: string): Promise<OfficialResponse> {
  const url = new URL(`${OFFICIAL_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}`, "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)) },
  });
  if (!response.ok) throw new Error(`知乎开放平台接口返回 HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!body || typeof body.Code !== "number") throw new Error("知乎开放平台返回的数据格式无法解析，请检查应用更新。");
  return body as OfficialResponse;
}

const KNOWN_ERROR_MESSAGES: Record<number, string> = {
  10001: "请求参数错误或内容不可用",
  20001: "鉴权失败，请检查 Access Secret 是否正确或已过期",
  30001: "调用频率、并发或当日额度超限",
  30002: "当日额度已耗尽",
  30003: "请求被知乎风控拒绝",
  90001: "知乎开放平台服务内部错误",
};
function officialErrorMessage(code: number, message: string) {
  return `知乎开放平台返回错误 ${code}：${KNOWN_ERROR_MESSAGES[code] ?? message}`;
}

function parseIdFromUrl(kind: ContentKind, url: string): string {
  const pattern = kind === "answer" ? /\/answer\/(\d+)(?:[/?]|$)/ : /\/p\/(\d+)(?:[/?]|$)/;
  const match = pattern.exec(url);
  // A URL shape Zhihu hasn't documented yet shouldn't crash the export —
  // fall back to a stable hash of the URL so the item still gets a usable,
  // consistent id (dedup keys, filenames) instead of one that changes
  // between runs.
  return match?.[1] ?? createHash("sha256").update(url).digest("hex").slice(0, 16);
}
function parseQuestionId(url: string): string | null {
  return /\/question\/(\d+)\/answer\//.exec(url)?.[1] ?? null;
}

function normalizeOfficialItem(kind: ContentKind, x: any): ZhihuItem {
  const url = String(x.Url || "");
  const id = parseIdFromUrl(kind, url);
  return {
    id,
    kind,
    questionId: kind === "answer" ? parseQuestionId(url) : null,
    title: x.Title || (kind === "answer" ? `回答 ${id}` : `文章 ${id}`),
    url,
    // Filled in later by fetchBody — the list endpoint only returns a
    // summary, not the full body.
    html: "",
    excerpt: String(x.Summary || ""),
    created: Number(x.CreatedAt ?? 0),
    // The list endpoint has no separate "updated" timestamp; CreatedAt is
    // the best available approximation.
    updated: Number(x.CreatedAt ?? 0),
    voteupCount: Number(x.LikeCount ?? 0),
    favoriteCount: x.FavoriteCount == null ? null : Number(x.FavoriteCount),
    commentCount: Number(x.CommentCount ?? 0),
    // Not provided by this endpoint.
    coverUrl: null,
  };
}

export class OfficialApiContentSource implements ContentSource {
  constructor(private accessSecret: string, private delayMs = 300) {}

  async listAll(onCount?: (n: number) => void) {
    const buckets: Record<ContentKind, { seen: Set<string>; items: ZhihuItem[]; duplicates: number; received: number }> = {
      answer: { seen: new Set(), items: [], duplicates: 0, received: 0 },
      article: { seen: new Set(), items: [], duplicates: 0, received: 0 },
    };
    let offset = 0;
    let completed = false;
    const maxPages = 1000;
    for (let guard = 0; guard < maxPages; guard++) {
      const page = await callOfficialApi("user/contents", { ContentType: "all", Offset: String(offset), Limit: "50" }, this.accessSecret);
      if (page.Code !== 0) throw new Error(officialErrorMessage(page.Code, page.Message));
      const items: any[] = page.Data?.Items ?? [];
      const paging = page.Data?.Paging ?? {};
      for (const raw of items) {
        const kind: ContentKind | null = raw.ContentType === "answer" ? "answer" : raw.ContentType === "article" ? "article" : null;
        // pin/zvideo/question are out of scope — 知档 only archives answers
        // and articles, matching the direct source's coverage.
        if (!kind) continue;
        const bucket = buckets[kind];
        bucket.received++;
        const normalized = normalizeOfficialItem(kind, raw);
        if (bucket.seen.has(normalized.id)) { bucket.duplicates++; continue; }
        bucket.seen.add(normalized.id);
        bucket.items.push(normalized);
      }
      onCount?.(buckets.answer.items.length + buckets.article.items.length);
      if (paging.IsEnd) { completed = true; break; }
      if (paging.NextOffset == null) throw new Error("知乎官方接口分页数据不完整：尚未结束但缺少下一页偏移量。");
      offset = Number(paging.NextOffset);
      await sleep(this.delayMs);
    }
    if (!completed) throw new Error("知乎官方接口分页超过安全上限，导出已停止以避免生成不完整归档。");
    // reportedTotal is deliberately null: Paging.Totals counts across all
    // ContentType values (including pins/videos/questions this tool
    // doesn't archive), so comparing it against a single kind's received
    // count would produce a false "count mismatch" warning.
    const reports: ListingReport[] = (["answer", "article"] as const).map((kind) => ({
      kind,
      reportedTotal: null,
      received: buckets[kind].received,
      unique: buckets[kind].items.length,
      duplicates: buckets[kind].duplicates,
      warning: null,
    }));
    return { items: [...buckets.answer.items, ...buckets.article.items], reports };
  }

  async fetchBody(item: ZhihuItem) {
    const page = await callOfficialApi("user/content_detail", { ContentUrl: item.url }, this.accessSecret);
    // 30001 also covers plain rate limiting, not only the daily quota — but
    // since the daily quota is what actually blocks a large export, and
    // resuming later is harmless either way, both codes are treated the
    // same: stop for now, let the caller resume on a later run.
    if (page.Code === 30001 || page.Code === 30002) throw new QuotaExhaustedError(officialErrorMessage(page.Code, page.Message));
    if (page.Code !== 0) throw new Error(officialErrorMessage(page.Code, page.Message));
    const body = page.Data?.Body;
    if (typeof body !== "string" || !body) throw new Error("知乎开放平台未返回可用正文。");
    return body;
  }
}

export interface OfficialQuota { apiId: string; name: string; total: number; used: number; remaining: number }
// Doesn't consume business quota (per the open platform's own docs) — safe
// to call as often as the UI wants to show "今日剩余 N 次".
export async function fetchOfficialQuota(secret: string, apiIds: string[] = ["creator"]): Promise<OfficialQuota[]> {
  const page = await callOfficialApi("quota", { APIIDs: apiIds.join(",") }, secret);
  if (page.Code !== 0) throw new Error(officialErrorMessage(page.Code, page.Message));
  return (page.Data ?? []).map((q: any) => ({ apiId: q.APIID, name: q.APIName, total: Number(q.TotalQuota), used: Number(q.TotalUsed), remaining: Number(q.RemainingQuota) }));
}
