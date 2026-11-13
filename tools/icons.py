#!/usr/bin/env python3
"""Regenerate the home-screen icons: icon-180.png, icon-192.png and icon-512.png.

Run by hand, not by CI, like tools/og-image.py: the output is committed and the page has no
build step. Needs Pillow (dev machine only).

    python3 tools/icons.py

The icons are full-bleed squares with no rounded corners of their own. iOS and Android both
apply their own mask, and icon-512 is declared "any maskable" in manifest.webmanifest, so
everything that matters has to sit inside the central safe zone: the bolt spans 56% of the
height, well inside the 80% circle a maskable icon is guaranteed.

One fixed colourway, because a home-screen icon cannot follow the page theme: the graphite of
the light theme's logo tile with the gold bolt. The favicon in index.html is an inline SVG and
does follow the browser's colour scheme; it is not generated here.
"""

import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS = 4  # supersample factor; PIL has no antialiased polygon fill

BG = (18, 19, 21)       # --text in the light theme, the logo tile there
BOLT_FILL = (255, 207, 61)  # --logo-bolt

# The bolt from the header logo, in its native 44x44 viewBox (centre 22,22; 30 units tall).
BOLT = [(26, 7), (14.5, 24), (20.5, 24), (18, 37), (29.5, 20), (23.5, 20)]
BOLT_HEIGHT = 0.56  # fraction of the icon's height


def icon(px):
    n = px * SS
    s = BOLT_HEIGHT * n / 30.0
    img = Image.new("RGB", (n, n), BG)
    ImageDraw.Draw(img).polygon(
        [(n / 2 + (x - 22) * s, n / 2 + (y - 22) * s) for x, y in BOLT], fill=BOLT_FILL)
    return img.resize((px, px), Image.LANCZOS)


def main():
    for px in (180, 192, 512):
        out = os.path.join(ROOT, "icon-%d.png" % px)
        icon(px).save(out, optimize=True)
        print("wrote %s (%d bytes)" % (os.path.relpath(out, ROOT), os.path.getsize(out)))


if __name__ == "__main__":
    main()
