import type { ListingReport, ZhihuItem } from "../types.js";

// The one seam between "where content comes from" and everything else
// (Exporter, server.ts, the task list UI). LoginContentSource (login.ts)
// and KeyContentSource (key.ts) are the two implementations — see
// docs/DEVELOPMENT.md for which edition ships which one. Adding a third
// source later should only ever mean implementing this interface, never
// touching Exporter or the export API route.
export interface ContentSource {
  // Discovers every answer/article the user has. Items may come back with an
  // empty html body (the official API's list endpoint is metadata + excerpt
  // only) — fetchBody is what actually fills that in per item.
  listAll(onCount?: (n: number) => void): Promise<{ items: ZhihuItem[]; reports: ListingReport[] }>;
  // Returns the full HTML body for one item. For a source whose listing
  // already includes full content, this can just return item.html.
  fetchBody(item: ZhihuItem): Promise<string>;
}

// Thrown by fetchBody when the source's daily quota for full-text fetches is
// exhausted (not a per-item failure). Exporter.export catches this
// specifically and stops the run early, leaving the remaining items
// untouched (still "pending") so a later run resumes them normally instead
// of recording hundreds of identical quota failures.
export class QuotaExhaustedError extends Error {}
