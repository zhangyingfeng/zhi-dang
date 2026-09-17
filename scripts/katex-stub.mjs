// Stand-in for the real `katex` package, swapped in at sidecar-build time
// (see build-sidecar.mjs's onResolve plugin) so the compiled binary doesn't
// carry katex's real weight. markdown-docx (our fork, see docs/DEVELOPMENT.md
// for why it's a fork) only calls katex.renderToString() from branches that
// handle $.../$$...$$/```math tokens — Zhihu content never contains those
// (Zhihu already rasterizes formulas to images before we ever see the HTML,
// so the exported Markdown has no LaTeX source to render), so this path is
// provably unreachable for us. If it were ever hit, throwing loudly is
// better than silently returning garbage into someone's exported .docx.
export default {
  renderToString() {
    throw new Error("katex-stub: math rendering was not expected to be reachable from zhihu content");
  },
};
