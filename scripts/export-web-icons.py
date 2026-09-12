#!/usr/bin/env python3
"""Exports web/doc-facing icon PNGs (assets/icon-key.png, assets/icon-login.png,
and their site/assets/ copies) from the 1024px master sources, cropped tight
to the actual artwork — no transparent margin.

The 1024px masters (assets/app-icon-source.png, assets/app-icon-login-source.png)
carry Apple's official macOS icon margin (824x824 artwork centered with a
100px transparent gutter — see scripts/apply-apple-icon-spec.py) because
that's what macOS's own Dock/Finder/.icns bundling expects. That convention
doesn't apply to a plain <img> on a web page or in a markdown table: there's
no system-drawn shadow or icon-grid alignment involved, so the margin just
reads as unwanted whitespace inside the image's own bounding box (this is
exactly what "网页上的图标为什么四周有空白区域" was pointing at). Cropping
to the tight 824x824 artwork before downscaling for web use fixes that
without touching the actual macOS-bound icon sets.

Flat PNGs only, deliberately — no baked-in drop shadow. A CSS shadow was
tried in the markdown docs (README.md / docs/DEVELOPMENT.md) first, but
GitHub's markdown renderer strips `style` and `class` attributes from any
HTML it renders (a security measure — see github/markup#245 and GitHub's
DOMPurify-based sanitizer), so a shadow can only reach those pages by being
part of the pixels. That was rejected in favor of keeping icon assets plain
everywhere; site/index.html gets its floating effect entirely from CSS
(.hero-icon, .edition-icon — see the --icon-shadow token) instead.

Run after regenerating either master:

    python3 scripts/export-web-icons.py
"""
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
MARGIN = 100  # must match scripts/apply-apple-icon-spec.py
ARTWORK = 824
WEB_SIZE = 256  # matches the previous convention (128x128@2x)

SOURCES = {
    "key": REPO_ROOT / "assets" / "app-icon-source.png",
    "login": REPO_ROOT / "assets" / "app-icon-login-source.png",
}
DESTS = [REPO_ROOT / "assets", REPO_ROOT / "site" / "assets"]


def main() -> None:
    for edition, src_path in SOURCES.items():
        im = Image.open(src_path).convert("RGBA")
        cropped = im.crop((MARGIN, MARGIN, MARGIN + ARTWORK, MARGIN + ARTWORK))
        web = cropped.resize((WEB_SIZE, WEB_SIZE), Image.LANCZOS)
        for dest_dir in DESTS:
            out = dest_dir / f"icon-{edition}.png"
            web.save(out)
            print(f"wrote {out}")


if __name__ == "__main__":
    main()
