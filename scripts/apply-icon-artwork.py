#!/usr/bin/env python3
"""Turns a raw, full-bleed square icon design into a proper macOS app-icon
master: resizes to Apple's 824x824 artwork size, centers it on a 1024x1024
transparent canvas with the required 100px margin, and applies the
185.4px corner radius — see scripts/apply-apple-icon-spec.py's docstring
for where these numbers come from (Apple's official macOS icon template)
and reference_macos_icon_autobox_gotcha in project memory for why skipping
this (handing Tauri an un-rounded, full-bleed square) makes macOS bolt its
own gray frame onto the icon instead of trusting the artwork's shape.

Unlike apply-apple-icon-spec.py (a one-off migration for the old flat
blue-square design, and generate-login-icon.py (which *derives* the login
edition's icon from the key edition's via color-blend math — only valid
when the two really are just a recolor of the same flat shape), this script
takes any independently-designed raw artwork as input — the two editions no
longer have to be mechanically related, since each is now its own supplied
design.

Usage:

    python3 scripts/apply-icon-artwork.py <raw-square.png> <dest-master.png>

Then regenerate everything downstream that reads from <dest-master.png> —
see docs/DEVELOPMENT.md's "改图标要同步的三个地方".

Requires Pillow.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

CANVAS = 1024
ARTWORK = 824  # Apple's official spec
CORNER_RADIUS = 185.4  # Apple's official spec, relative to the 824 artwork square
MARGIN = (CANVAS - ARTWORK) // 2  # 100, per spec
SUPERSAMPLE = 4


def rounded_rect_mask(size: int, radius: float, ss: int) -> Image.Image:
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size * ss - 1, size * ss - 1], radius=radius * ss, fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def main() -> None:
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <raw-square.png> <dest-master.png>", file=sys.stderr)
        sys.exit(1)
    src_path, dest_path = Path(sys.argv[1]), Path(sys.argv[2])

    im = Image.open(src_path).convert("RGBA")
    w, h = im.size
    assert w == h, f"expected a square image, got {w}x{h}"

    artwork = im.resize((ARTWORK, ARTWORK), Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(artwork, (MARGIN, MARGIN))

    mask = rounded_rect_mask(ARTWORK, CORNER_RADIUS, SUPERSAMPLE)
    full_mask = Image.new("L", (CANVAS, CANVAS), 0)
    full_mask.paste(mask, (MARGIN, MARGIN))

    result = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    result.paste(canvas, (0, 0), full_mask)

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(dest_path)
    print(f"wrote {dest_path} ({ARTWORK}x{ARTWORK} artwork, r={CORNER_RADIUS}, {MARGIN}px margin)")


if __name__ == "__main__":
    main()
