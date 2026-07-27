# LSX Weather (lsxdashboard.com) — Fix List from Design/UX Audit

## Context for Claude Code

This is a single-page weather dashboard for the NWS St. Louis (LSX) forecast area
(eastern Missouri / southwest Illinois). It is intentionally lean: one HTML page,
vanilla JS, Leaflet as the only library, ~107KB transfer, ~1,260 DOM nodes.

**Prime directive: do not break what's good.** No frameworks, no build step, no new
runtime dependencies. Every fix below should be plain HTML/CSS/JS edits. Preserve the
existing dark theme, card layout, `prefers-reduced-motion` support, aria-labels,
`aria-expanded` accordion behavior, and the hidden-until-needed error fallbacks
(e.g., the satellite "didn't load" message).

An audit was performed on 2026-07-27 with an Extreme Heat Warning active, which is
useful context for the alert-card items below.

---

## Priority 1 — High impact

### 1.1 Add SEO / social sharing metadata (currently none)
The page has NO meta description, NO Open Graph tags, NO Twitter card tags, and NO
canonical link. Add to `<head>`:

- `<meta name="description" content="...">` — one sentence describing live radar,
  alerts, and forecasts for the St. Louis (LSX) region. Keep under ~155 chars.
- Open Graph: `og:title`, `og:description`, `og:url`, `og:type` (website),
  `og:image` (create or reuse a 1200×630 branded image; the existing
  `icon-192.png` is too small for link previews — generate a simple OG card
  image with the site name/logo on the dark theme background if none exists).
- Twitter: `twitter:card` (summary_large_image), `twitter:title`,
  `twitter:description`, `twitter:image`.
- `<link rel="canonical" href="https://lsxdashboard.com/">`

Acceptance: pasting the URL into a link-preview debugger (or any chat app) renders
title + description + image.

### 1.2 Restructure the alert card — stop burying What/When/Impacts under county chips
Currently a warning renders 40+ county chips BEFORE the "+32 more" collapse button,
pushing the actual hazard text (What / Where / When / Impacts / What to do) far down
the card.

- Reorder within the alert card: headline + time remaining → What / When / Impacts /
  What to do → THEN geography.
- Collapse the county list by default: show "Your zone is included" (already exists)
  plus at most ~6–8 nearest/most-relevant counties, then a single "+N more" expander
  for the rest. Never render 40 chips uncollapsed.
- The "×2" badge is unexplained until the user opens details and finds "2 zone
  groups." Either add a title/tooltip ("2 zone groups") to the badge or replace the
  badge with plain text like "2 zone groups."

Acceptance: with a multi-county warning active, the What/When/Impacts text is visible
without scrolling past more than one row of county chips.

### 1.3 Fix muted-text contrast (WCAG AA failure)
Muted metadata text (timestamps like "Saved view from 9:44 AM", "ends Mon 9:00 PM",
"Mon 1:43 AM", issued/observed lines) measures ~2.97:1 against the dark background at
11–12px. WCAG AA requires 4.5:1 for text below ~19px.

- Lighten the muted-text color variable(s) in the dark theme until all body/metadata
  text at <19px computes to ≥4.5:1 against its actual rendered background.
- Check the light theme for the same issue after adjusting.
- While in there: audit the smallest text sizes. 11px metadata is very small for a
  site used outdoors in sunlight; consider a floor of 12–13px for anything
  informational.

Acceptance: no text under 19px computes below 4.5:1 contrast in either theme.

### 1.4 Add landmarks, a skip link, and in-page section navigation
- Wrap the content column in `<main>` (currently there is a `<header>` and `<footer>`
  but no `<main>`).
- Add a visually-hidden-until-focused "Skip to content" link as the first focusable
  element, targeting `<main>`.
- Add a slim sticky in-page nav (or jump-link row under the header) with anchors to
  the major sections, e.g.: Alerts · Now · Radar · 7-Day · Rivers · Climate. The page
  is ~3,800px tall with 14 stacked sections and currently no way to jump. Keep it
  lightweight — anchor links + `scroll-margin-top` on the section headings is enough;
  no JS scrollspy required (optional nice-to-have).

Acceptance: keyboard Tab from page load reaches the skip link first; each nav anchor
lands with the section heading visible below the sticky elements.

---

## Priority 2 — Medium impact

### 2.1 Copy/data bugs
- **"99° would be the warmest since Aug 27"** — ambiguous/broken date string in the
  Climate vs Normal card. It must include the year (e.g., "since Aug 27, 2023").
  Find where this string is built and include the year of the referenced date.
- **Leaflet attribution renders "© © ·"** — doubled copyright glyphs from string
  concatenation in the map attribution setup (both the radar map and the station-plot
  map show "© © · obs:" / "© © · Radar & warnings:"). Fix the attribution string
  assembly so each source gets exactly one © and separators are clean.
- **Silent partial-data state**: on one load, Wind and Gusts rendered as "—" while
  everything else populated (transient upstream/obs gap). Distinguish "no data
  reported" from "failed to fetch": if the fetch failed, show a subtle stale/retry
  indicator on the card rather than bare em dashes, and retry on the next refresh
  cycle.
- **"burn ~50 min"** microcopy in the UV row is cryptic. Change to something
  self-explanatory, e.g., "burn time ~50 min" with a `title` attribute explaining
  it's estimated time to sunburn for untanned skin, or reword entirely.

### 2.2 Enlarge small tap targets
29 of 54 interactive elements measure under 40px in at least one dimension (county
chips, 7-day expander rows/carets, station-plot toggle buttons Temp/Feels/Dew/Wind,
footer links, map zoom controls).

- Target: minimum 44×44px effective hit area on touch devices for anything tappable.
  Use padding or an expanded hit area (e.g., `::after` overlay or min-height on the
  row) — do not visually bloat the chips; the hit area can exceed the visual bounds.
- The 7-day rows: make the entire row the button hit area (it may already be — verify
  the computed size is ≥44px tall on the mobile breakpoints).

### 2.3 Jargon needs an on-ramp
Station and product codes (KSUS, ASOS/METAR, AFD, QPF, UIN, SAR, etc.) are shown with
no explanation. Keep the codes (the target audience likes them) but add affordances
for everyone else:

- `title` attributes and/or `<abbr>` elements on codes (e.g., KSUS → "Spirit of
  St. Louis Airport station", AFD → "Area Forecast Discussion", QPF → "Quantitative
  Precipitation Forecast").
- Station plot map: station labels could show full names in the tap-for-detail
  popup if they don't already.

### 2.4 Weather icon alt text
Map tiles without alt are fine (decorative). But the ~10 weather-condition icons
loaded from cdn.jsdelivr.net (Meteocons) have no alt and are announced as unnamed
images by screen readers. For each:
- If purely decorative next to text that already states the condition: add
  `alt=""` (or `aria-hidden="true"`).
- If the icon is the only conveyance of the condition anywhere: add a real alt
  (e.g., `alt="Partly cloudy"`).

---

## Priority 3 — Polish

### 3.1 Pause ambient animations when tab is hidden
Infinite CSS animations run continuously: `wxBreathe` (12s), `wxDriftA` (80s),
`radarSweep` (4s), `pulse` (1.6s). `prefers-reduced-motion` is already honored —
keep that. Add a `visibilitychange` listener that toggles a class on `<html>` (e.g.,
`.tab-hidden { animation-play-state: paused }` scoped to the ambient animations) so
a tab left open all day doesn't burn battery.

### 3.2 Consolidate radar show/hide controls
There is a top-of-page "Show radar & satellite" button AND a "Hide" button inside the
Radar card header — two controls for one region's visibility state. Pick one pattern:
either the card's own Hide/Show toggle, or the top button, and make the remaining
control clearly reflect current state (e.g., label flips between Show/Hide). Ensure
`aria-expanded`/`aria-controls` wiring on whichever control survives.

### 3.3 Review duplicated data across cards
High/low, UV, and record values each appear in 3–4 places (Bottom Line, Now card,
7-Day, Climate vs Normal). Some repetition is intentional summary design — don't
gut it — but do one pass to confirm each repetition earns its spot, and that values
can't disagree with each other (they should all derive from the same fetched data,
not separate fetches).

### 3.4 Heading hierarchy (minor)
Structure is one `<h1>` + 14 `<h2>`s and nothing else. Fine, but if any cards have
internal sub-sections (e.g., "Next 24 hours" inside the Now card, "Details" inside
alerts), consider `<h3>`s for them.

---

## Verification checklist (run after all fixes)

- [ ] Link preview shows title, description, and image (OG/Twitter debuggers)
- [ ] Lighthouse: Accessibility ≥ 95, SEO ≥ 95, Performance stays ≥ 95 (do not
      regress load: page currently DCL ~400ms / load ~740ms / ~107KB — keep it there)
- [ ] axe or Lighthouse reports no contrast failures in either theme
- [ ] Keyboard-only: skip link works, all controls reachable, focus visible
- [ ] Mobile viewport (390×844): tap targets ≥44px, no horizontal overflow,
      county chips collapsed by default
- [ ] Alert card with an active warning shows What/When/Impacts above the fold of
      the card
- [ ] Attribution strings show single © per source
- [ ] "warmest since" string includes a year
- [ ] Animations pause when `document.visibilityState === 'hidden'` and remain
      disabled under `prefers-reduced-motion`
