#!/usr/bin/env python3
"""Derives the login edition's app-icon source PNG from the shared master.

Simple inverted-color scheme so the two editions' Dock icons are never
confused when both are open at once: key edition keeps the original blue
background / white "档" glyph (src-tauri/icons/, unchanged); login edition
swaps that to a white background / blue glyph. Same squircle mask, same
glyph shape — just the two colors traded places. A thin light-gray stroke is
added around the squircle's edge, since a plain white icon has no visible
boundary against a light Dock/menu-bar background otherwise.

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

from PIL import Image, ImageChops, ImageFilter

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

BORDER_GRAY = (214, 214, 214)
# Width in the 1024px source canvas. This has to survive being scaled down to
# the small sizes the icon actually renders at (a 60px hero icon, a 32px Dock
# icon) — 10px here looked fine at full size but became a hairline that
# nearly disappeared after downscaling, especially along the rounded
# corners (a square erosion kernel doesn't shrink a curved edge as evenly as
# a straight one, so the ring reads thinner exactly at each corner's midpoint
# even before scaling makes it worse). 26px stays clearly visible down to the
# smallest size this icon ships at.
BORDER_PX = 26


def add_border(im: Image.Image) -> Image.Image:
    """Paints a thin BORDER_GRAY ring just inside the squircle's edge, in the
    band between the full mask and an eroded copy of it (MinFilter on a
    binarized alpha channel = erosion), so the white icon has a visible
    boundary against a light Dock/menu-bar background.

    The squircle's flat sides (top/bottom/left/right, away from the rounded
    corners) touch the source canvas's edge exactly — there's no transparent
    margin outside them within the image. MinFilter clamps to the edge pixel
    for anything off-canvas, so without padding first it finds nothing to
    erode against there and only the rounded corners would get a border.
    Padding with real transparent pixels on all sides first, then cropping
    back afterwards, gives erosion something to bite into everywhere."""
    pad = BORDER_PX + 4
    w, h = im.size
    padded = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    padded.paste(im, (pad, pad))

    alpha = padded.split()[3]
    mask = alpha.point(lambda a: 255 if a > 128 else 0)
    eroded = mask.filter(ImageFilter.MinFilter(BORDER_PX * 2 + 1))
    ring = ImageChops.subtract(mask, eroded)

    px = padded.load()
    ring_px = ring.load()
    alpha_px = alpha.load()
    for y in range(padded.height):
        for x in range(padded.width):
            if ring_px[x, y]:
                px[x, y] = (*BORDER_GRAY, alpha_px[x, y])

    return padded.crop((pad, pad, pad + w, pad + h))


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
    im = add_border(im)
    im.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
