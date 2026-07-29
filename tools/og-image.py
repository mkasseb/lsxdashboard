#!/usr/bin/env python3
"""Regenerate og-image.png — the 1200x630 card chat apps and search engines show.

Run by hand, not by CI: the output is committed, and the page has no build step. The only
reason this exists as a script rather than a hand-drawn asset is that the card has to stay
in sync with the header it stands in for — same logo geometry, same palette, same words.
Change --bg or the logo path in index.html and you should re-run this.

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

# Palette lifted from the dark theme in index.html. Muted is the POST-contrast-fix value.
BG = (10, 14, 20)
TEXT = (230, 237, 245)
MUTED = (167, 180, 198)
ACCENT = (107, 180, 255)
LOGO_BG1 = (27, 63, 112)
LOGO_BG2 = (18, 43, 78)
LOGO_RING = (127, 182, 255)
LOGO_BOLT = (255, 207, 61)

FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
BOLD, MEDIUM, REGULAR = 1, 10, 0

# The bolt from the header logo, in its native 44x44 viewBox. Straight segments only, so the
# SVG path is a plain polygon here: M26 7 L14.5 24 H20.5 L18 37 L29.5 20 H23.5 Z
BOLT = [(26, 7), (14.5, 24), (20.5, 24), (18, 37), (29.5, 20), (23.5, 20)]


def font(index, size):
    return ImageFont.truetype(FONT, size * SS, index=index)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return m


def logo(px):
    """The header mark at `px` logical pixels square, drawn at SS x.

    The bolt is knocked OUT of the rings rather than laid over them, same as the SVG: the
    2.6-unit stroke in the mask is the clearance halo that keeps the two from reading as
    two pictures fighting for one tile.
    """
    n = px * SS
    s = n / 44.0  # viewBox units -> device pixels

    # Tile: vertical gradient, top colour to bottom colour.
    ramp = np.linspace(0, 1, n)[:, None]
    tile = np.zeros((n, n, 3), dtype=np.uint8)
    for i in range(3):
        tile[:, :, i] = (LOGO_BG1[i] + (LOGO_BG2[i] - LOGO_BG1[i]) * ramp).astype(np.uint8)
    img = Image.fromarray(tile, "RGB")

    rings = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    for r, op in ((15, 0.34), (10, 0.46), (5, 0.58)):
        rd.ellipse(
            [(22 - r) * s, (22 - r) * s, (22 + r) * s, (22 + r) * s],
            outline=LOGO_RING + (round(255 * op),),
            width=max(1, round(1.5 * s)),
        )
    # Sweep wedge — the still frame of the radar animation, parked where the CSS starts it.
    rd.pieslice([7 * s, 7 * s, 37 * s, 37 * s], -90, -50, fill=LOGO_RING + (52,))

    # Mask: white keeps the rings, black (bolt + its stroked halo) removes them.
    mask = Image.new("L", (n, n), 255)
    md = ImageDraw.Draw(mask)
    pts = [(x * s, y * s) for x, y in BOLT]
    md.polygon(pts, fill=0)
    md.line(pts + [pts[0]], fill=0, width=round(2.6 * s), joint="curve")
    rings.putalpha(Image.composite(rings.getchannel("A"), Image.new("L", (n, n), 0), mask))
    img.paste(rings, (0, 0), rings)

    ImageDraw.Draw(img).polygon(pts, fill=LOGO_BOLT)
    img.putalpha(rounded_mask((n, n), round(11 * s)))
    return img


def glow(size, cx, cy, rx, ry, colour, peak):
    """The body's radial accent wash, as an alpha-masked colour layer."""
    g = Image.radial_gradient("L").resize((rx * 2, ry * 2), Image.LANCZOS)
    g = Image.eval(g, lambda v: round((255 - v) / 255 * peak))
    mask = Image.new("L", size, 0)
    mask.paste(g, (cx - rx, cy - ry))
    layer = Image.new("RGB", size, colour)
    return layer, mask


def tracked(d, xy, text, fnt, fill, track):
    """PIL has no letter-spacing, and the eyebrow needs the same tracking as --ls-eyebrow."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + track


def main():
    n = (W * SS, H * SS)
    img = Image.new("RGB", n, BG)
    layer, mask = glow(n, round(0.82 * n[0]), round(-0.06 * n[1]),
                       1150 * SS, 620 * SS, ACCENT, 46)
    img.paste(layer, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # A hairline of accent along the bottom edge — the one bit of chrome, and it survives
    # the aggressive crops some clients apply to the top of the card.
    d.rectangle([0, n[1] - 7 * SS, n[0], n[1]], fill=ACCENT)

    pad = 96 * SS
    mark = 128
    top = 150 * SS
    img.paste(m := logo(mark), (pad, top), m)

    x = pad + (mark + 34) * SS
    d.text((x, top - 6 * SS), "LSX Dashboard", font=font(BOLD, 82), fill=TEXT)
    d.text((x, top + 96 * SS), "Eastern Missouri and Southwest Illinois Weather",
           font=font(MEDIUM, 34), fill=MUTED)

    d.text((pad, 372 * SS), "Live radar, watches and warnings,",
           font=font(REGULAR, 40), fill=TEXT)
    d.text((pad, 424 * SS), "7-day forecast, river gauges and climate.",
           font=font(REGULAR, 40), fill=TEXT)

    tracked(d, (pad, 516 * SS), "LSXDASHBOARD.COM", font(BOLD, 26), ACCENT, 2.6 * SS)

    img.resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print("wrote %s (%d bytes)" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
