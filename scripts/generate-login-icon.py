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

from PIL import Image, ImageDraw

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
# nearly disappeared after downscaling. 26px stays clearly visible down to
# the smallest size this icon ships at.
BORDER_PX = 26
# Measured directly off app-icon-source.png (see the corner-radius probe in
# git history if this ever needs re-deriving): the squircle's corner arc
# meets the flat edge at ~179-180px from the true corner, on a 1024px canvas
# that the shape fills edge-to-edge on all four flat sides.
CORNER_RADIUS = 180
SUPERSAMPLE = 4  # for anti-aliasing the inset rounded-rect mask below


def add_border(im: Image.Image) -> Image.Image:
    """Paints a BORDER_GRAY ring of uniform width just inside the squircle's
    edge, so the white icon has a visible boundary against a light Dock/menu
    bar background.

    An earlier version built this by eroding a binarized alpha mask with
    PIL's MinFilter (a square structuring element) and taking the band
    between the original and eroded masks. That erodes a straight edge
    correctly, but a *square* kernel doesn't shrink a *circular* arc by the
    same perpendicular distance in every direction — it's exact along the
    axes and effectively erodes ~41% further at each rounded corner's 45°
    midpoint (Chebyshev vs. Euclidean distance). The corner's inner boundary
    came out as a blocky, octagon-ish approximation of a circle instead of a
    smooth concentric arc, and that jagged inner edge is what read as
    "thinner"/softer at the corners once downscaled to real display sizes —
    not an actual width difference.

    This version sidesteps the geometry problem instead of compensating for
    it: draw the *exact* inset rounded-rectangle a uniform border should have
    (same corner style, radius reduced by BORDER_PX, margins of BORDER_PX on
    every side) directly with ImageDraw, supersampled for a smooth edge, and
    use that as a paste mask over a solid-gray copy of the icon's own alpha
    shape. The ring's width is then geometrically exact and uniform on the
    flat sides and around the curve alike."""
    w, h = im.size
    alpha = im.split()[3]

    # Every already-opaque pixel gets painted gray; alpha (including the
    # smooth anti-aliased outer edge) comes along unchanged.
    gray_layer = Image.new("RGBA", (w, h), (*BORDER_GRAY, 0))
    gray_layer.putalpha(alpha)

    # The inset rounded-rect that the icon's *interior* (white bg + glyph)
    # should be clipped to — same shape, margined in by BORDER_PX on every
    # side, corner radius reduced to match.
    ss = SUPERSAMPLE
    inner_radius = max(0, CORNER_RADIUS - BORDER_PX)
    inner_mask = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(inner_mask).rounded_rectangle(
        [BORDER_PX * ss, BORDER_PX * ss, w * ss - BORDER_PX * ss, h * ss - BORDER_PX * ss],
        radius=inner_radius * ss,
        fill=255,
    )
    inner_mask = inner_mask.resize((w, h), Image.LANCZOS)

    result = gray_layer.copy()
    result.paste(im, (0, 0), inner_mask)
    return result


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
