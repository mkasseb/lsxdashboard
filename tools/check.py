#!/usr/bin/env python3
"""Pre-deploy checks for a repo with no build step.

`index.html` is served to production byte-for-byte, so nothing between an edit and a
visitor's browser would notice a mistake. These are the two mistakes worth catching
mechanically:

  1. A syntax error in an inline <script>. The whole application is one script block.
     A stray character doesn't degrade one card, it blanks the entire dashboard.

  2. An external origin that isn't declared in the Content-Security-Policy. A new feed
     works locally (no CSP on localhost, and Pages only applies `_headers` when it
     serves the file), then silently fetches nothing in production. The only evidence
     is a console message nobody is looking at.

Check 2 works by classification, not by guessing which URLs are fetched: every https
origin in index.html must be declared somewhere in the CSP, or listed in NAV_ONLY below
as a link target. Adding a feed introduces an origin in neither set, so the check fails
until it is put in one — which is the point.

Run locally with:  python3 tools/check.py
"""

import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
HEADERS = os.path.join(ROOT, "_headers")

# Origins that appear only as <a href> navigation targets or attribution links. Browsers
# don't apply fetch directives to a link the user clicks, so these need no CSP entry —
# but they must be named here so a genuinely new *feed* can't hide among them.
NAV_ONLY = {
    "https://aviationweather.gov",
    "https://carto.com",
    "https://droughtmonitor.unl.edu",
    "https://forecast.weather.gov",
    "https://github.com",
    "https://gispub.epa.gov",
    "https://leafletjs.com",
    "https://open-meteo.com",
    "https://radar.weather.gov",
    "https://water.noaa.gov",
    "https://www.blitzortung.org",
    "https://map.blitzortung.org",
    "https://www.cpc.ncep.noaa.gov",
    "https://www.drought.gov",
    "https://www.openstreetmap.org",
    "https://www.rcc-acis.org",
    "https://www.spc.noaa.gov",
    "https://www.star.nesdis.noaa.gov",
    "https://www.weather.gov",
    "https://www.wpc.ncep.noaa.gov",
    "https://xmacis.rcc-acis.org",
}

INLINE_SCRIPT = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S)
ORIGIN = re.compile(r"https://[A-Za-z0-9.*-]+")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def fail(lines):
    for line in lines:
        print(line)
    return False


def check_inline_script_syntax(html):
    """Parse each inline <script> with node --check."""
    blocks = list(INLINE_SCRIPT.finditer(html))
    if not blocks:
        return fail(["FAIL  syntax: no inline <script> found — has index.html moved?"])

    for i, m in enumerate(blocks, 1):
        body = m.group(1)
        # node counts lines from the start of the block; the reader needs the line in
        # index.html, so translate before printing.
        offset = html.count("\n", 0, m.start(1))
        with tempfile.NamedTemporaryFile(
            "w", suffix=".js", encoding="utf-8", delete=False
        ) as tmp:
            tmp.write(body)
            path = tmp.name
        try:
            done = subprocess.run(
                ["node", "--check", path], capture_output=True, text=True
            )
        finally:
            os.unlink(path)
        if done.returncode != 0:
            detail = re.sub(
                re.escape(path) + r":(\d+)",
                lambda hit: "index.html:%d" % (int(hit.group(1)) + offset),
                done.stderr,
            ).replace(path, "index.html")
            return fail(["FAIL  syntax: inline script block %d" % i, "", detail.rstrip()])

    total = sum(len(m.group(1).splitlines()) for m in blocks)
    print("ok    syntax: %d inline script block(s), %d lines, parses" % (len(blocks), total))
    return True


def csp_directives(headers_text):
    """{directive: [source, ...]} from the Content-Security-Policy in _headers."""
    m = re.search(r"^\s*Content-Security-Policy:\s*(.+)$", headers_text, re.M)
    if not m:
        return None
    out = {}
    for chunk in m.group(1).split(";"):
        parts = chunk.split()
        if parts:
            out[parts[0]] = parts[1:]
    return out


def covered_by(origin, allowed):
    """True if `origin` matches an allowed source, honouring one leading wildcard."""
    for src in allowed:
        if src == origin:
            return True
        if src.startswith("https://*."):
            if origin.startswith("https://") and origin.endswith(src[len("https://*"):]):
                return True
    return False


def check_csp_covers_origins(html, headers_text):
    """Every https origin in index.html is declared in the CSP or listed as nav-only."""
    directives = csp_directives(headers_text)
    if directives is None:
        return fail(["FAIL  csp: no Content-Security-Policy header found in _headers"])

    declared = [s for srcs in directives.values() for s in srcs if s.startswith("https://")]
    connect = directives.get("connect-src", [])

    found = sorted(set(ORIGIN.findall(html)))
    undeclared = [o for o in found if o not in NAV_ONLY and not covered_by(o, declared)]
    if undeclared:
        return fail(
            ["FAIL  csp: origin(s) in index.html declared nowhere in the CSP:", ""]
            + ["        " + o for o in undeclared]
            + [
                "",
                "      If fetched, add to connect-src in _headers (an <img> needs img-src,",
                "      an <iframe> frame-src). If it is only an <a href>, add it to NAV_ONLY",
                "      in tools/check.py.",
            ]
        )

    # The reverse: a connect-src entry for a feed that no longer exists is dead policy,
    # and dead policy is how the list stops being trustworthy.
    unused = [o for o in connect if o.startswith("https://") and o not in found]
    if unused:
        return fail(
            ["FAIL  csp: connect-src allows origin(s) index.html never references:", ""]
            + ["        " + o for o in unused]
            + ["", "      Remove them from _headers — the allowlist should stay minimal."]
        )

    print(
        "ok    csp: %d origin(s) in index.html, all declared (%d fetchable via connect-src)"
        % (len(found), len([o for o in connect if o.startswith("https://")]))
    )
    return True


def main():
    html = read(INDEX)
    headers_text = read(HEADERS)
    results = [
        check_inline_script_syntax(html),
        check_csp_covers_origins(html, headers_text),
    ]
    if not all(results):
        print("\nchecks failed")
        return 1
    print("\nchecks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
