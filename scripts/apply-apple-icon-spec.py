#!/usr/bin/env python3
"""Re-derives assets/app-icon-source.png to match Apple's official macOS app
icon template dimensions, in place.

The icon was full-bleed to the 1024x1024 canvas edge with an ad-hoc ~180px
circular-arc corner radius (17.6% of the canvas) — not per any published
spec, just whatever produced a visually rounded corner at the time (see
CHANGELOG.md's "sharp corners in the Dock" fix). That is structurally wrong
against Apple's actual template, not just a matter of curve taste:

    Apple's official macOS Big Sur+ app icon template (per Apple's own
    Design Resources download page, as quoted directly from Apple's
    developer forums — https://developer.apple.com/forums/thread/670578,
    referencing Mike Swanson's icon-shape script that implements it):
      - Reference canvas: 1024 x 1024
      - Actual artwork square: 824 x 824, corner radius 185.4px
        (185.4 / 824 = 22.5% of the artwork's own side, not the full canvas)
      - Centered in the canvas, giving exactly 100px of transparent margin
        on all four sides — the artwork is NOT full-bleed.

A full-bleed icon with no margin at all is likely why macOS's own
icon-shape heuristics got confused when the corner curve was also tweaked
away from a plain circle in an earlier attempt (see
reference_macos_icon_autobox_gotcha in project memory) — the real defect
was the missing 100px gutter, not primarily the curve exponent.

This script rebuilds the master to those exact proportions: recovers the
flat full-bleed square version of the existing artwork (fills the old
rounded-off corners back in with the background color, since they're pure
background there — no glyph pixels live in the corner regions), scales it
down to 824x824, centers it on a fresh 1024x1024 transparent canvas, and
applies a corner radius of 185.4px to that 824x824 square (equivalent
radius on the full 1024 canvas at the same relative position).

Curve style: a plain circular arc, not Apple's exact "continuous corner"
(superellipse-like Bezier) construction — matching Apple's spec on
dimensions (the part with clear, corroborated official numbers) rather than
guessing further at the exact curve exponent, which is exactly the kind of
unverified tweak that caused a regression last time.

Run once, then regenerate everything downstream (see DEVELOPMENT.md or just
scripts/generate-login-icon.py's own docstring for the login-edition half):

    python3 scripts/apply-apple-icon-spec.py
    npx tauri icon assets/app-icon-source.png -o src-tauri/icons
    rm -rf src-tauri/icons/ios src-tauri/icons/android
    cp src-tauri/icons/128x128@2x.png assets/icon-key.png
    cp assets/icon-key.png site/assets/icon-key.png
    python3 scripts/generate-login-icon.py
    npx tauri icon assets/app-icon-login-source.png -o src-tauri/icons-login
    rm -rf src-tauri/icons-login/ios src-tauri/icons-login/android
    cp src-tauri/icons-login/128x128@2x.png assets/icon-login.png
    cp assets/icon-login.png site/assets/icon-login.png

Requires Pillow.
"""
from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
MASTER = REPO_ROOT / "assets" / "app-icon-source.png"

BACKGROUND = (23, 105, 224)  # the master's flat fill color (blue)
CANVAS = 1024
ARTWORK = 824  # Apple's official spec
CORNER_RADIUS = 185.4  # Apple's official spec, relative to the 824 artwork square
MARGIN = (CANVAS - ARTWORK) // 2  # 100, per spec
SUPERSAMPLE = 4


def recover_full_bleed_square(im: Image.Image) -> Image.Image:
    """Undoes the old ad-hoc corner rounding: anywhere alpha isn't already
    255, force it to the flat background color at full opacity. Safe because
    the corner regions are confirmed background-only — no glyph pixel lives
    there — so this exactly reconstructs what the artwork would look like
    before any corner mask was ever applied to it."""
    w, h = im.size
    square = Image.new("RGBA", (w, h), (*BACKGROUND, 255))
    square.paste(im, (0, 0), im)
    return square


def rounded_rect_mask(size: int, radius: float, ss: int) -> Image.Image:
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size * ss - 1, size * ss - 1], radius=radius * ss, fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def main() -> None:
    im = Image.open(MASTER).convert("RGBA")
    assert im.size == (CANVAS, CANVAS), f"expected {CANVAS}x{CANVAS}, got {im.size}"

    square = recover_full_bleed_square(im)
    artwork = square.resize((ARTWORK, ARTWORK), Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(artwork, (MARGIN, MARGIN))

    mask = rounded_rect_mask(ARTWORK, CORNER_RADIUS, SUPERSAMPLE)
    full_mask = Image.new("L", (CANVAS, CANVAS), 0)
    full_mask.paste(mask, (MARGIN, MARGIN))

    result = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    result.paste(canvas, (0, 0), full_mask)

    result.save(MASTER)
    print(f"wrote {MASTER} ({ARTWORK}x{ARTWORK} artwork, r={CORNER_RADIUS}, {MARGIN}px margin)")


if __name__ == "__main__":
    main()
