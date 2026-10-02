#!/usr/bin/env python3
"""Stamp local JS/CSS references; --check rejects missing or stale content versions."""
import argparse
import hashlib
from pathlib import Path
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
REF = re.compile(r'\b(src|href)="([^"]+)"')


def versioned_html(text, page):
    def replace(match):
        url = urlsplit(match[2])
        if url.scheme or url.netloc or not url.path.endswith((".js", ".css")):
            return match[0]
        target = (ROOT / url.path.lstrip("/") if url.path.startswith("/") else page.parent / url.path).resolve()
        if not target.is_relative_to(ROOT) or not target.is_file():
            raise ValueError("Invalid local asset: " + match[2])
        digest = hashlib.sha256(target.read_bytes()).hexdigest()[:16]
        query = [(key, value) for key, value in parse_qsl(url.query) if key != "v"] + [("v", digest)]
        return match[1] + '="' + urlunsplit(("", "", url.path, urlencode(query), url.fragment)) + '"'
    return REF.sub(replace, text)


def update_versions(write=False):
    stale = []
    for page in sorted(ROOT.glob("*.html")):
        text = page.read_text()
        updated = versioned_html(text, page)
        if text != updated:
            stale.append(page.name)
            if write:
                page.write_text(updated)
    if stale and not write:
        print("FAIL  versions: stale/missing asset hashes in " + ", ".join(stale))
        print("      Run python3 tools/version_assets.py --write")
        return False
    print("ok    versions: local JS/CSS content hashes " + ("updated" if write else "match"))
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    raise SystemExit(0 if update_versions(args.write) else 1)
