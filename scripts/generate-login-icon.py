#!/usr/bin/env python3
"""Derives the login edition's app-icon source PNG from the shared master.

Key edition keeps the original blue background / white "档" glyph
(src-tauri/icons/, unchanged). Login edition's background is a soft diagonal
gradient — white at the top-left corner to a light gray (225,225,225) at the
bottom-right — with the same blue glyph as the key edition. Same shape
(including the 100px transparent margin + 185.4px corner radius from
scripts/apply-apple-icon-spec.py), just the background recolored.

The gradient (not flat white) exists specifically so the icon has *some*
visible boundary against a plain white page background in contexts that
can't get one any other way — README.md / docs/DEVELOPMENT.md, rendered by
GitHub, which strips `style`/`class` from any HTML it renders (see
export-web-icons.py's docstring), so neither a CSS box-shadow nor a CSS
border can ever reach those pages. A flat-white icon on GitHub's white
background has effectively zero edge definition there. Went through several
rounds before landing here — a hand-drawn border/stroke (visible boundary via
a gray ring baked into the shape) was tried first and dropped: eroding a
circular arc with a square kernel doesn't shrink it evenly in every
direction, and even after fixing that, the ring still read unevenly once
macOS composited the real .app icon (see
reference_macos_icon_autobox_gotcha and the border-removal commits). A
tinted/gradient background sidesteps all of that — it's just a color choice,
not a shape macOS's icon compositor or a screen's downscaling has any
opinion about.

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
# tells us how much "background" vs. "glyph" a pixel is, regardless of what
# color each one gets mapped to below.
BLUE = (23, 105, 224)
WHITE = (255, 255, 255)

# The login background: a very soft top-to-bottom gradient (near-white to a
# barely-darker near-white gray), not flat — see the docstring above for why.
# Went through several rounds: a diagonal gray version (rejected), diagonal
# and vertical white-to-light-blue at four strengths each (rejected —
# "不好看"), vertical gray-to-gray at progressively lighter levels down to
# this one. Deliberately about as subtle as this approach can go before it
# stops giving any boundary at all against a white page — the user picked
# this level explicitly after seeing that tradeoff.
GRADIENT_START = (254, 254, 254)
GRADIENT_END = (247, 247, 247)


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
            # t=0 -> BLUE in the master (background), t=1 -> WHITE (glyph).
            # frac is this pixel's position top-to-bottom, used to pick this
            # pixel's *background* color from the gradient; t then blends
            # between that and BLUE (the glyph color), same role WHITE played
            # before switching to a gradient.
            frac = y / (h - 1)
            bg = tuple(GRADIENT_START[i] + (GRADIENT_END[i] - GRADIENT_START[i]) * frac for i in range(3))
            nr = round(bg[0] + t * (BLUE[0] - bg[0]))
            ng = round(bg[1] + t * (BLUE[1] - bg[1]))
            nb = round(bg[2] + t * (BLUE[2] - bg[2]))
            px[x, y] = (nr, ng, nb, a)
    im.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
