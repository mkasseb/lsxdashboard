# LSX Weather Command

A one-page weather dashboard for the **NWS St. Louis (LSX) County Warning Area** — alerts, radar,
forecasts, river gauges, and climate context for a location inside the CWA.

Not an official NWS product. During severe weather, defer to official warnings and a NOAA Weather Radio.

## What it is

One file. [`index.html`](index.html) is the entire application: ~800 lines of CSS, ~260 lines of
markup, and ~3,600 lines of JavaScript, all inline.

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
collapses to a single all-clear line), then the hero band — Current Conditions beside the radar —
then The Call, the 24-hour chart, the forecast discussion, and finally the masonry. The hero card
carries the reading, today's high/low with "now" marked inside the range, sun times, and the next
six hours, which is both the information a first-time visitor needs and what keeps the left column
level with the radar instead of stranding a gap beside it. `.railhead` labels name each band; Storm
Mode reorders the grid for urgency, so those labels hide when it engages. The hero row is a pair —
`#radarCard` carries its own breakpoint overrides so the generic `col-8`/`col-4` rules can't drop
the radar to full width while Current Conditions stays at half.

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

## Known gaps

- No `aria-expanded` on the expandable alert and forecast rows.
- The masonry positions cards absolutely after sorting by importance and height, so visual order
  diverges from DOM order — which is what keyboard and screen-reader order follow.
- `saveSnapshot()` serialises synchronously on `visibilitychange`.
