# LSX Weather Command

A one-page weather dashboard for the **NWS St. Louis (LSX) County Warning Area** — alerts, radar,
forecasts, river gauges, and climate context for a location inside the CWA.

Not an official NWS product. During severe weather, defer to official warnings and a NOAA Weather Radio.

## What it is

One file. [`index.html`](index.html) is the entire application: ~840 lines of CSS, ~265 lines of
markup, and ~3,700 lines of JavaScript, all inline.

- **No build step.** No bundler, no transpiler, no `package.json`. Edit the file, reload the page.
- **No API keys.** Every feed was chosen because it is keyless and CORS-open, so the whole thing
  runs as a static page with no server and no secrets.
- **Two runtime dependencies**, both from a CDN with SRI hashes: Leaflet 1.9.4 for the maps, and
  Meteocons for the weather icons. Both degrade gracefully if the CDN is unreachable.
- **Installable PWA** via [`manifest.webmanifest`](manifest.webmanifest). There is deliberately no
  service worker — return visits paint instantly from a `localStorage` snapshot instead (see below).

## Running it locally

Serve it over `localhost` rather than opening the file directly — `file://` breaks geolocation and
the snapshot cache, both of which need a secure context.

```bash
python3 -m http.server 8787
```

Then open <http://localhost:8787>.

## Deploying

Cloudflare Pages, connected to this repo. Every push to `main` deploys.

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `/` |

There is nothing to build — Pages serves the repo root as-is.

[`_headers`](_headers) supplies the response headers, including a Content-Security-Policy whose
`connect-src` enumerates every origin the app fetches. Adding a feed means adding its origin there
too, or the fetch is blocked.

## Data sources

All public-domain or openly licensed, all keyless.

| Feed | Used for |
|---|---|
| `api.weather.gov` | Forecast, hourly, station obs, active alerts, AFD discussion text, county zones |
| `opengeo.ncep.noaa.gov` (WMS) | Official NWS radar, including the time dimension driving the loop |
| `mapservices.weather.noaa.gov` | SPC convective + fire outlooks, WPC excessive rainfall, CPC 6–10/8–14 day, CPC hazards & drought, WPC QPF |
| `api.water.noaa.gov` (NWPS) | River gauge stages and crest forecasts |
| `data.rcc-acis.org` | 1991–2020 normals, daily records, rankings, dry streaks, freeze dates |
| Open-Meteo | Air quality, UV index, and the location geocoder |
| NESDIS / GOES-19 | Satellite imagery |
| Blitzortung | Live lightning (embedded iframe) |

Basemap © CARTO & OpenStreetMap contributors. Weather icons by
[Meteocons](https://github.com/basmilius/weather-icons) (Bas Milius, MIT).

## How it fits together

The script is sectioned by `/* ==== BANNER ==== */` comments and reads top to bottom: config →
helpers → ~15 per-card loaders → derived renderers → orchestration → scheduler → layout engine.

A few things are load-bearing and worth understanding before changing anything:

**The page is ordered by what a visitor came for.** Alerts first (in calm weather that card
collapses to a single all-clear line), then the hero band — "Now & Next 24 Hours" beside the radar
— then The Call, the forecast discussion, and finally the masonry. `.railhead` labels name each
band; Storm Mode reorders the grid for urgency, so those labels hide when it engages.

**The hero card is two loaders in one card.** `#current` (the reading, today's range with "now"
marked inside it, sun times) and `#hourly24` (the 24-hour chart) are *siblings* inside
`#currentCard`, never nested. `loadCurrent()` rebuilds `#current` wholesale — including on failure
— so nesting the chart inside it would let a dead observation feed take the forecast chart down
with it, breaking the rule below. The chart measures its own container and thins its labels, so it
survives the narrower column; it shows ~6 hour labels there against ~24 at full width, with
per-hour detail still available on hover.

**The hero row is a pair, and it stretches.** `#radarCard` carries its own breakpoint overrides so
the generic `col-8`/`col-4` rules can't drop the radar to full width while the hero stays at half.
Above 680px both sides are `align-self:stretch` and the radar map flexes, so the left column's
content — which has no fixed height — sets the row height and the map absorbs the slack rather than
stranding a gap. A `ResizeObserver` on `#radar` calls `invalidateSize()`, because that height moves
as feeds land and Leaflet only watches the window.

**Location generations.** Every fetch that describes *a place* captures the generation it was
issued under via `locGuard()`, and checks `fresh()` before writing to the DOM. `setLocation()`
increments the generation and aborts the previous `AbortController`, so superseded requests are
both cancelled and — if they land anyway — discarded. This is why one town's numbers can never
appear under another town's label. Feeds that are *not* location-scoped (the CWA-wide alert list,
the fixed river gauges, the AFD, the regional station plot) deliberately opt out of both.

**Every loader owns its failure.** Each has a `.catch` that degrades to an official link or to
silence. One dead NOAA service must never blank a sibling card. Error paints are generation-scoped
too, so a superseded failure can't deface the location that replaced it.

**Nothing unverified is printed.** Climate statistics are gated on minimum sample sizes, ACIS
departures carry missing-day counts that are checked before use, and a figure borrowed from a
different station is attributed by name. Suppression beats false precision.

**Instant paint.** Each refresh serialises the rendered HTML of ~22 cards into `localStorage`, so a
return visit paints a full dashboard before any network request. Each card carries its own TTL
(alerts expire after 15 minutes; drought after 48 hours). Storm mode and the warning banner are
*never* restored, because they assert something about right now.

**Storm mode.** An active warning is classified into a family (convective / winter / flood / heat /
wind / fire), which sets the accent colour, floats the most relevant card to the top of the layout,
and rewrites the banner.

**Adding a card** means touching five places: the markup, the `RANK` map in `layoutMasonry`'s
`tier()`, `SNAP_PARTS`, the `SCHED` table, and `clearLocationUI`/`resetLocationState`.

**Adding a location-scoped loader** means a sixth: the `jobs` array inside `setLocation()`. `SCHED`
only governs the periodic refresh, and `refreshAll()` only covers the initial paint — a loader
missing from `setLocation` looks like it works, then silently never re-runs when the visitor
changes town. Worse, it can appear broken on first load too: geolocation resolves *after* the first
`refreshAll()`, so the generation bumps, the in-flight fetch is discarded by its own `fresh()`
guard, and nothing re-issues it.

**Radar and satellite are one widget, two views.** They answer the same question at different
scales, so they share `#radarCard` and a tab swaps which is visible. They are not layers on one
map: the radar is a live WMS tile source, while NESDIS's GOES product is a fixed-extent sector
*image*, not tiles, so it cannot be georeferenced under the radar without a different provider.
Switching back to the radar calls `invalidateSize()` — Leaflet sized the map against a hidden
container and would otherwise paint into a stale viewport.

## Known gaps

- No `aria-expanded` on the expandable alert and forecast rows.
- The masonry positions cards absolutely after sorting by importance and height, so visual order
  diverges from DOM order — which is what keyboard and screen-reader order follow.
- `saveSnapshot()` serialises synchronously on `visibilitychange`.
