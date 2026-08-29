export type ContentKind = "answer" | "article";
export interface ZhihuItem {
  id: string;
  kind: ContentKind;
  questionId: string | null;
  title: string;
  url: string;
  html: string;
  excerpt: string;
  created: number;
  updated: number;
  voteupCount: number;
  favoriteCount: number | null;
  commentCount: number;
  coverUrl: string | null;
}
export interface ExportOptions { outputDir: string; downloadImages: boolean; delayMs: number; }
export type TaskStatus = "pending" | "active" | "done" | "error";
// One row per image referenced by an item — nested inside the "images"
// SubTask so the UI can show a per-image breakdown (which one failed, why)
// behind an expand toggle instead of cluttering the item row itself.
export interface ImageTask { url: string; status: TaskStatus; error?: string; }
export interface SubTask { key: "images" | "write"; status: TaskStatus; images?: ImageTask[]; }
// One row per answer/article in the export task list — the "展示" (visibility)
// layer of the export redesign: replaces the single opaque progress bar with
// per-item and per-subtask state the UI can render directly.
// Set when this item's normalized body text hash-matches one or more other
// items in the same export (see contentHash in util.ts) — an exact-content
// signal only, surfaced read-only for now; deciding what to do about it
// (merge/skip) is a later "管理" pass, not this one.
export interface DuplicateInfo { groupSize: number; otherTitles: string[]; }
export interface ExportTask { id: string; kind: ContentKind; title: string; status: TaskStatus; subtasks: SubTask[]; error?: string; duplicate?: DuplicateInfo; }
// Emitted by Exporter.export as it works through each item, so the caller
// (src/server.ts) can update its own ExportTask list without the exporter
// needing to know anything about how progress is surfaced.
export type TaskEvent =
  | { type: "start"; id: string }
  | { type: "subtask"; id: string; key: SubTask["key"]; status: "active" | "done" | "error" }
  | { type: "images-list"; id: string; urls: string[] }
  | { type: "image"; id: string; url: string; status: "active" | "done" | "error"; error?: string }
  | { type: "done"; id: string; status: "done" | "error"; error?: string };
export interface Progress { phase: "idle"|"login"|"listing"|"exporting"|"done"|"error"; message: string; current?: number; total?: number; outputDir?: string; tasks?: ExportTask[]; }
export interface ListingReport { kind: ContentKind; reportedTotal: number | null; received: number; unique: number; duplicates: number; warning: string | null; }
export interface ListingResult { items: ZhihuItem[]; report: ListingReport; }
