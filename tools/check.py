#!/usr/bin/env python3
"""Pre-deploy checks for a repo with no build step.

`index.html` is served to production byte-for-byte, so nothing between an edit and a
visitor's browser would notice a mistake. These are the five mistakes worth catching
mechanically:

  0. An unbalanced comment in the inline <style>. CSS has no nesting: the FIRST `*/`
     closes the comment, so appending a paragraph to an existing block leaves its text
     as live declarations and takes the next rule down with it. Nothing reports this —
     not the parser, not the console — the rule is simply gone, which in practice means
     a fix that was written, reviewed and merged silently does nothing.

  1. A syntax error in an inline <script>. The whole application is one script block.
     A stray character doesn't degrade one card, it blanks the entire dashboard.

  2. An external origin that isn't declared in the Content-Security-Policy. A new feed
     works locally (no CSP on localhost, and Pages only applies `_headers` when it
     serves the file), then silently fetches nothing in production. The only evidence
     is a console message nobody is looking at.

  3. An icon name with no matching <symbol> in the sprite. A <use> pointing at a missing
     id renders NOTHING — no box, no error, no console message. A typo in one arm of
     hazIcon() would simply drop the icon off a chip that nobody had a drought outlook
     for that week, and stay dropped.

  4. A missing file at the site root, or a site URL that disagrees with itself. Pages
     answers an unmatched path with 404.html and a 404 status only while that file
     exists; delete it and every wrong URL quietly goes back to serving the entire
     dashboard at 200 — which is how /robots.txt came to be 378 KB of HTML that crawlers
     read as 5,953 syntax errors. The URL itself is written in four places for four
     audiences that never compare notes, so nothing else would notice them drifting.

Checks 2 and 3 work by classification, not by guessing which URLs are fetched or which
icons are reachable: every https origin in the HTML Pages serves — index.html and 404.html,
since `_headers` applies the CSP to both — must be declared somewhere in the CSP or listed
in NAV_ONLY below as a link target, and every icon-shaped string literal must name a symbol
that exists. Adding a feed introduces an origin in neither set, so the check fails until it
is put in one — which is the point.

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
# Pages serves the repo root as-is, so these three are live infrastructure, not documentation:
# 404.html is the only thing giving an unmatched path a 404 status, and the other two are the
# two files a crawler asks for by name before it asks for anything else.
NOT_FOUND = os.path.join(ROOT, "404.html")
ROBOTS = os.path.join(ROOT, "robots.txt")
SITEMAP = os.path.join(ROOT, "sitemap.xml")

# Origins that appear only as <a href> navigation targets or attribution links. Browsers
# don't apply fetch directives to a link the user clicks, so these need no CSP entry —
# but they must be named here so a genuinely new *feed* can't hide among them.
NAV_ONLY = {
    "https://aviationweather.gov",
    "https://carto.com",
    "https://droughtmonitor.unl.edu",
    "https://feathericons.com",
    "https://forecast.weather.gov",
    "https://github.com",
    "https://gispub.epa.gov",
    "https://leafletjs.com",
    # The satellite layer's attribution link. The TILES come from gibs.earthdata.nasa.gov, which is
    # a different host and is declared in img-src; this one is only ever an <a href>.
    "https://www.earthdata.nasa.gov",
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

# The site's own origin. It appears absolutely — not as a path — only where a relative URL is
# not allowed to: rel=canonical, og:url, og:image and twitter:image are resolved by crawlers
# that never saw the page's base URL, so a relative href there is a coin flip per scraper.
# 'self' in default-src/img-src already covers it; the origin scan below doesn't know that,
# hence this name rather than a stray CSP entry that would look like a third party.
SELF_ORIGIN = "https://lsxdashboard.com"
CANONICAL = SELF_ORIGIN + "/"
SITEMAP_URL = SELF_ORIGIN + "/sitemap.xml"

INLINE_STYLE = re.compile(r"<style[^>]*>(.*?)</style>", re.S)
INLINE_SCRIPT = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S)
ORIGIN = re.compile(r"https://[A-Za-z0-9.*-]+")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def fail(lines):
    for line in lines:
        print(line)
    return False


def check_style_comments(html):
    """Every `*/` in an inline <style> closes a comment that was actually open.

    Walks the block rather than counting delimiters, because the counts balance in exactly
    the case that breaks: adding prose to a finished comment gives `/* a */ b */`, which is
    two of each and still leaves `b` as live CSS plus a stray close.
    """
    blocks = list(INLINE_STYLE.finditer(html))
    if not blocks:
        return fail(["FAIL  css: no inline <style> found — has index.html moved?"])

    stray, unterminated = [], []
    for m in blocks:
        css, base = m.group(1), html.count("\n", 0, m.start(1))
        i, opened = 0, False
        while i < len(css) - 1:
            two = css[i : i + 2]
            if two == "/*" and not opened:
                opened = True
                i += 2
                continue
            if two == "*/":
                if not opened:
                    stray.append(base + css.count("\n", 0, i) + 1)
                opened = False
                i += 2
                continue
            i += 1
        if opened:
            unterminated.append(base + css.count("\n") + 1)

    if stray or unterminated:
        lines = ["FAIL  css: comment delimiters don't balance in the inline <style>:", ""]
        lines += ["        index.html:%d  `*/` with no comment open" % n for n in stray]
        lines += ["        index.html:%d  comment never closed" % n for n in unterminated]
        lines += [
            "",
            "      A stray `*/` leaves the text before it as live declarations and eats the",
            "      rule that follows, silently. Usually it means prose was appended to a",
            "      comment that already ended — delete the earlier `*/`, don't add another.",
        ]
        return fail(lines)

    total = sum(len(m.group(1).splitlines()) for m in blocks)
    print("ok    css: %d inline <style> block(s), %d lines, comments balance" % (len(blocks), total))
    return True


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


def check_csp_covers_origins(served_html, headers_text):
    """Every https origin in the HTML Pages serves is declared in the CSP or listed as nav-only.

    `served_html` is index.html and 404.html concatenated. The `/*` rule in _headers applies the
    same policy to both, so an external font or image added to the error page would be blocked
    exactly as silently as one added to the dashboard — and on a page whose whole job is to
    render when something has already gone wrong.
    """
    directives = csp_directives(headers_text)
    if directives is None:
        return fail(["FAIL  csp: no Content-Security-Policy header found in _headers"])

    declared = [s for srcs in directives.values() for s in srcs if s.startswith("https://")]
    connect = directives.get("connect-src", [])

    found = sorted(set(ORIGIN.findall(served_html)) - {SELF_ORIGIN})
    undeclared = [o for o in found if o not in NAV_ONLY and not covered_by(o, declared)]
    if undeclared:
        return fail(
            ["FAIL  csp: origin(s) in the served HTML declared nowhere in the CSP:", ""]
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
            ["FAIL  csp: connect-src allows origin(s) the served HTML never references:", ""]
            + ["        " + o for o in unused]
            + ["", "      Remove them from _headers — the allowlist should stay minimal."]
        )

    print(
        "ok    csp: %d origin(s) in index.html + 404.html, all declared (%d fetchable via connect-src)"
        % (len(found), len([o for o in connect if o.startswith("https://")]))
    )
    return True


SYMBOL = re.compile(r'<symbol id="i-([a-z0-9-]+)"')
# Every way an icon name reaches the sprite. ic("x") and <use href="#i-x"> are direct; the rest
# are the producers that hand a name to ic() indirectly — the per-family and per-hazard lookup
# tables, and the two renderers that take the name as a positional argument (push(pri, ico, txt)
# for the Bottom Line, line(ico, html) for the climate context).
ICON_REFS = [
    re.compile(r'\bic\("([a-z0-9-]+)"'),
    re.compile(r'href="#i-([a-z0-9-]+)"'),
    re.compile(r'\bico:"([a-z0-9-]+)"'),
    re.compile(r'\bic:"([a-z0-9-]+)"'),
    re.compile(r'\bpush\(\d+,"([a-z0-9-]+)"'),
    re.compile(r'\bline\("([a-z0-9-]+)"'),
]


def check_icons_resolve(html):
    """Every referenced icon name has a <symbol>, and every <symbol> is referenced."""
    defined = set(SYMBOL.findall(html))
    if not defined:
        return fail(["FAIL  icons: no <symbol id=\"i-…\"> found — has the sprite moved?"])

    used = set()
    for pat in ICON_REFS:
        used |= set(pat.findall(html))

    # The mapper functions return bare names; scope the scan to their bodies so an unrelated
    # `return "sleet"` elsewhere in the file can't be mistaken for an icon reference.
    for fn in ("wxFallback", "alertIcon", "hazIcon"):
        m = re.search(r"function %s\(.*?\n\}" % fn, html, re.S)
        if m:
            used |= set(re.findall(r'return "([a-z0-9-]+)"', m.group(0)))

    missing = sorted(used - defined)
    if missing:
        return fail(
            ["FAIL  icons: name(s) referenced with no <symbol> in the sprite:", ""]
            + ["        " + n for n in missing]
            + ["", "      A <use> pointing at a missing id renders nothing at all, silently.",
               "      Add the symbol to #sprite in index.html, or fix the name."]
        )

    # The reverse: a symbol nothing draws is dead weight in every page load.
    unused = sorted(defined - used)
    if unused:
        return fail(
            ["FAIL  icons: <symbol>(s) in the sprite that nothing references:", ""]
            + ["        i-" + n for n in unused]
            + ["", "      Remove them — the sprite ships inline on every request."]
        )

    print("ok    icons: %d symbol(s), all referenced, all references resolve" % len(defined))
    return True


def stated(values):
    """How a list of matches reads in a failure line."""
    if not values:
        return "absent"
    if len(values) == 1:
        return values[0]
    return "%d values (%s)" % (len(values), ", ".join(values))


def check_root_files(html):
    """404.html, robots.txt and sitemap.xml exist, and everything agrees on the site's URL.

    Pages has no setting for any of this — the behaviour is the files. An unmatched path gets
    404.html with a 404 status if the file is there and index.html with a 200 if it isn't, so
    deleting it doesn't break the site in any visible way: it just quietly starts answering
    every wrong URL with a complete copy of the dashboard, which is duplicate content to a
    crawler and 5,953 lines of invalid robots.txt to a validator.

    The URL is then written four times over — rel=canonical and og:url for scrapers that never
    saw the page's base URL, <loc> for the sitemap, and robots.txt's Sitemap line — and each is
    read by something that will never see the other three. This is the only thing comparing them.
    """
    missing = [os.path.basename(p) for p in (NOT_FOUND, ROBOTS, SITEMAP) if not os.path.exists(p)]
    if missing:
        return fail(
            ["FAIL  root: file(s) missing from the repo root:", ""]
            + ["        " + n for n in missing]
            + [
                "",
                "      Pages serves the root as-is, so a file that isn't committed isn't served.",
                "      Without 404.html every unmatched path returns index.html with a 200.",
            ]
        )

    robots, sitemap = read(ROBOTS), read(SITEMAP)

    # A blanket disallow deindexes the whole site and reads as deliberate to everything that
    # obeys it, so nothing reports it — it surfaces as search traffic that quietly stopped,
    # months later or not at all. `Disallow: /` is the one value that means "none of it".
    blanket = [n for n, line in enumerate(robots.splitlines(), 1)
               if re.match(r"\s*disallow:\s*/\s*$", line, re.I)]
    if blanket:
        return fail(
            ["FAIL  root: robots.txt blocks the entire site:", ""]
            + ["        robots.txt:%d  `Disallow: /`" % n for n in blanket]
            + [
                "",
                "      That asks every crawler to drop the site. If the intent was to allow",
                "      everything, the line is `Allow: /` or a `Disallow:` with nothing after it.",
            ]
        )

    problems = []
    declared = re.findall(r"^\s*sitemap:\s*(\S+)\s*$", robots, re.I | re.M)
    if declared != [SITEMAP_URL]:
        problems.append("robots.txt    Sitemap: %s — expected %s" % (stated(declared), SITEMAP_URL))

    locs = re.findall(r"<loc>\s*(.*?)\s*</loc>", sitemap, re.S)
    if locs != [CANONICAL]:
        problems.append("sitemap.xml   <loc>: %s — expected %s" % (stated(locs), CANONICAL))

    for label, pattern in (
        ("rel=canonical", r'<link rel="canonical" href="([^"]*)"'),
        ("og:url       ", r'<meta property="og:url" content="([^"]*)"'),
    ):
        got = re.findall(pattern, html)
        if got != [CANONICAL]:
            problems.append("index.html    %s: %s — expected %s" % (label, stated(got), CANONICAL))

    if problems:
        return fail(
            ["FAIL  root: the site's own URL doesn't agree across the files that state it:", ""]
            + ["        " + p for p in problems]
            + [
                "",
                "      Moving the site means changing SELF_ORIGIN above and every line listed",
                "      here. A crawler following the stale one lands somewhere that isn't this.",
            ]
        )

    print("ok    root: 404.html, robots.txt, sitemap.xml present and agree on %s" % CANONICAL)
    return True


def main():
    html = read(INDEX)
    headers_text = read(HEADERS)
    # _headers applies `/*` to every response, so the CSP governs the error page too. Read it
    # only if it's there — its absence is check_root_files's failure to report, not a traceback.
    served_html = html + (read(NOT_FOUND) if os.path.exists(NOT_FOUND) else "")
    results = [
        check_style_comments(html),
        check_inline_script_syntax(html),
        check_csp_covers_origins(served_html, headers_text),
        check_icons_resolve(html),
        check_root_files(html),
    ]
    if not all(results):
        print("\nchecks failed")
        return 1
    print("\nchecks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
