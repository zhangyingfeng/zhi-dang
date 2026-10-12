// Paid-knowledge answers: the author's own listing returns the full body, but
// readers without access only see a preview on Zhihu. We keep the archive in
// line with that — only the first PREVIEW_RATIO of the text is exported, cut
// at a block boundary, followed by a pointer back to the original.
//
// The 10% figure is an approximation chosen for the archive, not Zhihu's
// actual preview length.
export const PREVIEW_RATIO = 0.1;

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

interface Block { html: string; textLength: number; }

function textLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, "x")
    .replace(/\s+/g, "").length;
}

// Splits html into its top-level elements. Text or comments sitting between
// elements ride along with the following block so nothing is dropped.
function splitTopLevel(html: string): Block[] {
  const blocks: Block[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let depth = 0; let start = 0; let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    const closing = match[1] === "/"; const name = match[2].toLowerCase(); const selfClosing = match[3] === "/" || VOID_TAGS.has(name);
    if (closing) depth = Math.max(0, depth - 1);
    else if (!selfClosing) depth++;
    if (depth === 0) {
      const end = match.index + match[0].length; const chunk = html.slice(start, end);
      blocks.push({ html: chunk, textLength: textLength(chunk) }); start = end;
    }
  }
  const rest = html.slice(start);
  if (rest.trim()) blocks.push({ html: rest, textLength: textLength(rest) });
  return blocks;
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function truncatePaidPreview(html: string, url: string, ratio = PREVIEW_RATIO): { html: string; truncated: boolean } {
  const blocks = splitTopLevel(html);
  const total = blocks.reduce((sum, b) => sum + b.textLength, 0);
  if (total === 0) return { html, truncated: false };
  const budget = Math.floor(total * ratio);
  const kept: Block[] = []; let used = 0; let hasText = false;
  for (const block of blocks) {
    // The first block with text is always kept so a short answer never
    // collapses to an empty preview.
    if (hasText && used + block.textLength > budget) break;
    kept.push(block); used += block.textLength;
    if (block.textLength > 0) hasText = true;
  }
  if (kept.length === blocks.length) return { html, truncated: false };
  const notice = `<blockquote><p>以下为知乎付费内容，此处仅保留前 ${Math.round(ratio * 100)}%。完整内容请前往知乎付费阅读：<a href="${escapeAttr(url)}">${escapeAttr(url)}</a></p></blockquote>`;
  return { html: kept.map(b => b.html).join("") + notice, truncated: true };
}
