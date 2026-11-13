#!/usr/bin/env python3
"""Regenerate og-image.png — the 1200x630 card chat apps and search engines show.

Run by hand, not by CI: the output is committed, and the page has no build step. The only
reason this exists as a script rather than a hand-drawn asset is that the card has to stay
in sync with the header it stands in for — same logo geometry, same palette, same words.
Change --bg, the faces in assets/fonts/ or the logo path in index.html and you should re-run this.

    python3 tools/og-image.py

Needs Pillow and numpy (dev machine only — neither ships to production).

Everything below is drawn at SS x scale and downsampled once at the end. PIL has no
antialiased polygon fill, so supersampling IS the antialiasing; drawing at 1x gives the
bolt visibly stepped edges at the size Slack and iMessage render this.
"""

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "og-image.png")

W, H = 1200, 630
SS = 3  # supersample factor

# Palette lifted from the dark "Station Log" theme at the end of assets/dashboard.css.
BG = (14, 15, 17)
TEXT = (238, 237, 233)
MUTED = (168, 171, 166)
RULE = (51, 55, 61)

# The page's own self-hosted faces, so the card cannot drift from the header it stands in for
# and the script runs the same on any machine. Pillow's FreeType reads woff2 directly.
FONTS = os.path.join(ROOT, "assets", "fonts")
DISPLAY = os.path.join(FONTS, "barlow-condensed-latin-600-normal.woff2")
MONO = os.path.join(FONTS, "ibm-plex-mono-latin-500-normal.woff2")

# The bolt from the header logo, in its native 44x44 viewBox. Straight segments only, so the
# SVG path is a plain polygon here: M26 7 L14.5 24 H20.5 L18 37 L29.5 20 H23.5 Z
BOLT = [(26, 7), (14.5, 24), (20.5, 24), (18, 37), (29.5, 20), (23.5, 20)]


def font(path, size):
    return ImageFont.truetype(path, size * SS)


def logo(px):
    """The header mark at `px` logical pixels square, drawn at SS x: a flat text-coloured tile
    with the bolt in the page colour. The radar rings and sweep left the mark with the redesign."""
    n = px * SS
    s = n / 44.0  # viewBox units -> device pixels
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, n - 1, n - 1], round(3 * s), fill=TEXT + (255,))
    d.polygon([(x * s, y * s) for x, y in BOLT], fill=BG + (255,))
    return img


def tracked(d, xy, text, fnt, fill, track):
    """PIL has no letter-spacing; the mono lines carry the same slight tracking as the page."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + track


def main():
    n = (W * SS, H * SS)
    img = Image.new("RGB", n, BG)
    d = ImageDraw.Draw(img)

    pad = 96 * SS
    # The masthead rule, and a hairline above the address. Both sit well inside the frame so
    # they survive the crops some clients apply to the edges of the card.
    d.rectangle([pad, 96 * SS, n[0] - pad, 96 * SS + 4 * SS], fill=TEXT)
    d.rectangle([pad, 500 * SS, n[0] - pad, 500 * SS + 1 * SS], fill=RULE)

    mark = 120
    top = 150 * SS
    img.paste(m := logo(mark), (pad, top), m)

    x = pad + (mark + 32) * SS
    d.text((x, top - 22 * SS), "LSX Dashboard", font=font(DISPLAY, 112), fill=TEXT)
    tracked(d, (x + 4 * SS, top + 106 * SS), "Eastern Missouri and Southwest Illinois Weather",
            font(MONO, 26), MUTED, 0.6 * SS)

    d.text((pad, 336 * SS), "Live radar, watches and warnings,",
           font=font(DISPLAY, 58), fill=TEXT)
    d.text((pad, 404 * SS), "7-day forecast, river gauges and climate.",
           font=font(DISPLAY, 58), fill=TEXT)

    tracked(d, (pad, 526 * SS), "lsxdashboard.com", font(MONO, 28), TEXT, 1 * SS)

    img.resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print("wrote %s (%d bytes)" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
