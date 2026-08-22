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
export interface Progress { phase: "idle"|"login"|"listing"|"exporting"|"done"|"error"; message: string; current?: number; total?: number; outputDir?: string; }
export interface ListingReport { kind: ContentKind; reportedTotal: number | null; received: number; unique: number; duplicates: number; warning: string | null; }
export interface ListingResult { items: ZhihuItem[]; report: ListingReport; }
