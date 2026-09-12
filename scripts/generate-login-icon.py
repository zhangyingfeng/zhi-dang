#!/usr/bin/env python3
"""Derives the login edition's app-icon source PNG from the shared master.

Simple inverted-color scheme so the two editions' Dock icons are never
confused when both are open at once: key edition keeps the original blue
background / white "档" glyph (src-tauri/icons/, unchanged); login edition
swaps that to a white background / blue glyph. Same shape (including the
100px transparent margin + 185.4px corner radius from
scripts/apply-apple-icon-spec.py), just the two colors traded places.

No hand-drawn border/stroke around the shape — that was tried (to give the
white icon a visible boundary against light Dock/Finder chrome) and dropped:
a thin ring rendered visibly unevenly between the flat edges and the rounded
corners once macOS composited the real icon (its own dynamic drop shadow —
offset 12px down per Apple's spec, so not even meant to be symmetric — mixed
with the ring in ways that were hard to get right and not worth chasing
further). The white icon relies on the same system-drawn shadow every other
macOS icon gets for edge definition, same as the key edition's blue icon.

Requires Pillow (`pip3 install pillow`). Run from anywhere; paths are
resolved relative to this script:

    python3 scripts/generate-login-icon.py

Then regenerate the actual icon set Tauri bundles from that source:

    npx tauri icon assets/app-icon-login-source.png -o src-tauri/icons-login
    rm -rf src-tauri/icons-login/ios src-tauri/icons-login/android  # unused targets

Only rerun this if assets/app-icon-source.png (the shared master, also the
key edition's icon source as-is) changes — the recolor math below assumes
its exact background/glyph colors (see the BLUE/WHITE constants).
"""
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC = REPO_ROOT / "assets" / "app-icon-source.png"
OUT = REPO_ROOT / "assets" / "app-icon-login-source.png"

# Sampled directly from app-icon-source.png: every opaque pixel there is a
# blend of these two colors — flat fill, anti-aliased corner-mask edges, and
# anti-aliased glyph edges alike — so re-deriving each pixel's blend ratio
# and swapping which color it's anchored to recolors everything correctly,
# not just a flat pixel swap.
BLUE = (23, 105, 224)
WHITE = (255, 255, 255)


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            t = (r - BLUE[0]) / (WHITE[0] - BLUE[0])
            t = max(0.0, min(1.0, t))
            # Original: t=0 -> BLUE (background), t=1 -> WHITE (glyph).
            # Inverted: t=0 -> WHITE (background), t=1 -> BLUE (glyph).
            nr = round(WHITE[0] + t * (BLUE[0] - WHITE[0]))
            ng = round(WHITE[1] + t * (BLUE[1] - WHITE[1]))
            nb = round(WHITE[2] + t * (BLUE[2] - WHITE[2]))
            px[x, y] = (nr, ng, nb, a)
    im.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
