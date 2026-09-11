import { buildListingUrl, paginateListing, type PageFetcher } from "../zhihu.js";
import type { ContentSource } from "./types.js";
import type { ZhihuItem } from "../types.js";

// Wraps the existing webview-relay listing (src/zhihu.ts, unchanged) as a
// ContentSource. Zhihu's member-listing endpoint already returns full HTML
// content per item, so there's no separate per-item fetch — fetchBody is a
// no-op that just hands back what listAll already collected.
export class LoginContentSource implements ContentSource {
  constructor(private urlToken: string, private fetchPage: PageFetcher, private delayMs = 800) {}

  // onCount reports a running total across both listings (answers first,
  // then articles) so the two sources present the same "已发现 N 项" shape
  // to server.ts regardless of how many underlying requests that took.
  async listAll(onCount?: (n: number) => void) {
    let answersSoFar = 0;
    const answerResult = await paginateListing("answer", buildListingUrl("answer", this.urlToken), this.fetchPage, {
      delayMs: this.delayMs,
      onCount: (n) => { answersSoFar = n; onCount?.(n); },
    });
    const articleResult = await paginateListing("article", buildListingUrl("article", this.urlToken), this.fetchPage, {
      delayMs: this.delayMs,
      onCount: (n) => onCount?.(answersSoFar + n),
    });
    return { items: [...answerResult.items, ...articleResult.items], reports: [answerResult.report, articleResult.report] };
  }

  async fetchBody(item: ZhihuItem) {
    return item.html;
  }
}
