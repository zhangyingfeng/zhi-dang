#!/usr/bin/env python3
"""Derives the key edition's app-icon source PNG from the login edition's.

The two editions' Dock icons are meant to be visibly different at a glance —
both a different background color and a distinct "key" badge, not just a
tint — because the two apps look otherwise identical (same window, same
title, same "知档" wordmark) and running both to compare/test them side by
side is a normal thing to do (see docs/RELEASE_CHECKLIST.md). Colors alone
would degrade to indistinguishable circles in the Dock in some hover/theme
combinations; the badge is a second, distinguishing signal that doesn't rely
on color perception.

Requires Pillow (`pip3 install pillow`). Run from anywhere; paths are
resolved relative to this script:

    python3 scripts/generate-key-icon.py

Then regenerate the actual icon set Tauri bundles from that source:

    npx tauri icon assets/app-icon-key-source.png -o src-tauri/icons-key
    rm -rf src-tauri/icons-key/ios src-tauri/icons-key/android  # unused targets

Only rerun this if assets/app-icon-source.png (the login edition's source)
changes — the recolor math below assumes its exact background/glyph colors
(sampled from that file; see the BLUE/WHITE constants).
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC = REPO_ROOT / "assets" / "app-icon-source.png"
OUT = REPO_ROOT / "assets" / "app-icon-key-source.png"

# The login edition's background blue and glyph white, sampled directly from
# app-icon-source.png (see git history / PR discussion for how these were
# derived: every opaque pixel in that file is a blend of these two colors —
# flat fill, anti-aliased corner-mask edges, and anti-aliased glyph edges all
# recolor correctly by re-deriving each pixel's blend ratio against these).
BLUE = (23, 105, 224)
WHITE = (255, 255, 255)

# Key edition: warm amber/gold — reads as "credential" rather than "session",
# and is unambiguously different from the login edition's blue in the Dock,
# Cmd-Tab, and notifications.
AMBER = (180, 95, 6)
AMBER_DARK = (110, 56, 3)  # badge circle — a darker shade of the same hue


def recolor(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            t = (r - BLUE[0]) / (WHITE[0] - BLUE[0])
            t = max(0.0, min(1.0, t))
            nr = round(AMBER[0] + t * (WHITE[0] - AMBER[0]))
            ng = round(AMBER[1] + t * (WHITE[1] - AMBER[1]))
            nb = round(AMBER[2] + t * (WHITE[2] - AMBER[2]))
            px[x, y] = (nr, ng, nb, a)
    return im


def add_key_badge(im: Image.Image) -> Image.Image:
    w, h = im.size
    draw = ImageDraw.Draw(im)

    def opaque(x: float, y: float) -> bool:
        if x < 0 or y < 0 or x >= w or y >= h:
            return False
        return im.getpixel((int(x), int(y)))[3] == 255

    # Find the largest badge circle, centered near the bottom-right corner,
    # that stays entirely within the squircle's opaque area (the mask rounds
    # off right at that corner, so this can't just be a fixed radius).
    cx, cy, radius = 810, 810, 176
    while True:
        ok = all(
            opaque(cx + radius * math.cos(a), cy + radius * math.sin(a))
            for a in [i * math.pi / 24 for i in range(48)]
        )
        if ok:
            break
        radius -= 4
    badge_r = radius
    draw.ellipse([cx - badge_r, cy - badge_r, cx + badge_r, cy + badge_r], fill=AMBER_DARK)

    # Key silhouette (ring bow + shaft + two teeth), drawn upright at 4x
    # supersample for clean anti-aliasing, then rotated as a whole and
    # downsampled onto the badge.
    S = badge_r * 4
    key_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    kd = ImageDraw.Draw(key_layer)
    bc = S / 2

    bow_r_out = S * 0.20
    wall = S * 0.075
    bow_cx = bc - S * 0.24
    bow_cy = bc
    kd.ellipse([bow_cx - bow_r_out, bow_cy - bow_r_out, bow_cx + bow_r_out, bow_cy + bow_r_out], fill=WHITE)
    kd.ellipse(
        [bow_cx - bow_r_out + wall, bow_cy - bow_r_out + wall, bow_cx + bow_r_out - wall, bow_cy + bow_r_out - wall],
        fill=(0, 0, 0, 0),
    )

    shaft_w = S * 0.09
    shaft_x0 = bow_cx + bow_r_out - wall * 0.3
    shaft_x1 = bc + S * 0.30
    kd.rectangle([shaft_x0, bc - shaft_w / 2, shaft_x1, bc + shaft_w / 2], fill=WHITE)

    tooth_w = S * 0.075
    tooth_h = S * 0.11
    kd.rectangle(
        [shaft_x1 - tooth_w * 2.3, bc + shaft_w / 2, shaft_x1 - tooth_w * 1.3, bc + shaft_w / 2 + tooth_h], fill=WHITE
    )
    kd.rectangle(
        [shaft_x1 - tooth_w * 0.9, bc + shaft_w / 2, shaft_x1 + tooth_w * 0.1, bc + shaft_w / 2 + tooth_h * 1.6],
        fill=WHITE,
    )

    key_layer = key_layer.rotate(-38, resample=Image.BICUBIC, center=(bc, bc))
    key_layer = key_layer.resize((badge_r * 2, badge_r * 2), Image.LANCZOS)
    im.alpha_composite(key_layer, (cx - badge_r, cy - badge_r))
    return im


def main() -> None:
    im = Image.open(SRC)
    im = recolor(im)
    im = add_key_badge(im)
    im.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
