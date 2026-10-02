# LSX Dashboard

A one-page weather dashboard for the **NWS St. Louis (LSX) County Warning Area** — eastern Missouri
and southwest Illinois. Alerts, radar, forecasts, river gauges, and climate context for a location
inside the CWA.

Not an official NWS product. During severe weather, defer to official warnings and a NOAA Weather Radio.

[Open the dashboard](https://lsxdashboard.com/).

## What it is

A static page with plain assets: [`index.html`](index.html) contains the markup,
[`assets/dashboard.css`](assets/dashboard.css) the styles,
[`assets/weather-core.js`](assets/weather-core.js) the decision functions,
[`assets/weather-feeds.js`](assets/weather-feeds.js) the feed registry and loaders, and
[`assets/dashboard.js`](assets/dashboard.js) the rendering, interactions, maps and startup.

- **No build step.** No bundler, no transpiler, no runtime `package.json`. Edit a plain file and reload.
- **No API keys.** Every feed was chosen because it is keyless and CORS-open, so the whole thing
  runs as a static page with no server and no secrets.
- **Three pinned map dependencies** from CDNs with SRI hashes: Leaflet 1.9.4, MapLibre GL, and its
  Leaflet adapter. Meteocons sky-condition icons load separately from a CDN with an inline fallback.
  The maps link to the official NWS view if the map libraries fail to load.
- **Installable PWA** via [`manifest.webmanifest`](manifest.webmanifest). There is deliberately no
  service worker — return visits paint from a `localStorage` snapshot once the page loads, but the
  page itself is not available offline.

## Running it locally

Serve it over `localhost` rather than opening the file directly. Browsers handle geolocation and
`localStorage` differently for `file://` pages; `localhost` gives the app a consistent origin and
counts as a secure context for geolocation.

```bash
python3 -m http.server 8787
```

Then open <http://localhost:8787>.

With no build step there is nothing between an edit and production, so the mistakes that would
ship silently are checked mechanically. CI runs static and logic checks on every pull request:

```bash
python3 tools/check.py        # HTML/CSS comments, JS syntax, CSP, icons, root files
node tools/logic-tests.js     # the functions that decide something
```

The browser suite runs in CI alongside the static and logic checks, against intercepted NWS/ArcGIS-shaped
weather scenarios and a recorded LSX response set. It covers heavy rain, snow and ice, warning
expiration, SPC issuance changes, AQI/UV, river trends, feed failures, daylight-saving changes,
phone/tablet/desktop widths, rapid location changes and repeated refresh/chart work. Freshness
checks cover full and partial outages, request timeouts, saved-view TTLs and per-feed verification.
Weather timing is checked in Chicago, UTC, Los Angeles and Tokyo browser timezones, including UV
samples across both daylight-saving transitions. Interaction checks cover focus and selected-hour
preservation, briefing disclosures, sticky location context, favorites, shared URLs and river pins.
It also checks
2,000 seeded accumulation cases against a separate oracle. The fixture records its source URLs
and retrieval time; extreme scenarios are synthetic. Map scenarios load the pinned Leaflet/MapLibre libraries against deterministic tiles and styles,
including initial style failure/retry, radar playback, tile outages and fullscreen keyboard behavior.
This suite does not verify live upstream tile availability or browser-specific rendering outside Chromium.

Install Playwright separately from the dashboard (which has no npm dependencies), then run with a
local Chromium executable:

```bash
npm install --prefix /tmp/lsx-browser-tests playwright@1.62.1 leaflet@1.9.4 maplibre-gl@5.24.0 @maplibre/maplibre-gl-leaflet@0.1.4
NODE_PATH=/tmp/lsx-browser-tests/node_modules CHROMIUM_PATH=/usr/bin/chromium \
  node tools/weather-stress-tests.js
```

Set `WEATHER_STRESS_REPORT` to choose the JSON report path (default:
`/tmp/lsx-weather-stress-report.json`). `WEATHER_CASE_FILTER=expiration` runs just matching case
names for debugging; omit it for the full suite. Network responses are intercepted, so a test run
does not depend on live weather services.

[`tools/check.py`](tools/check.py) checks HTML/CSS comment balance, served JavaScript syntax, CSP
origins, sprite references, and the site root files and URLs. [`tools/logic-tests.js`](tools/logic-tests.js)
covers pure decisions such as alert scope, forecast summaries, radar geometry, and temperature
calculations; visual rendering is reviewed by eye.
`tools/source.js` reads the same local scripts and styles referenced by the page, so the tests
exercise the served assets. CI installs Playwright outside the app and saves its scenario report.
Locally, omit `CHROMIUM_PATH` to use a browser installed with Playwright's `install chromium` command.

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

Three more root files are configuration rather than content, and Pages reads them by name:
[`404.html`](404.html) is the only thing giving an unmatched path a real 404 status (without it,
every wrong URL serves the whole dashboard at 200), [`robots.txt`](robots.txt) allows everything
and points at the sitemap, and [`sitemap.xml`](sitemap.xml) holds the one URL there is. The site's
URL is stated in four places — `rel=canonical`, `og:url`, the sitemap's `<loc>` and the `Sitemap:`
line — and `tools/check.py` fails if they stop agreeing; moving the site means changing
`SELF_ORIGIN` there and all four.

## Data sources

All feeds are keyless. The sources have different attribution and reuse terms; see [License](#license).

| Feed | Used for |
|---|---|
| `api.weather.gov` | Forecast, 24–72-hour views, grid event precipitation totals + gusts, station obs, active alerts, AFD + mesoscale discussion text, county zones |
| `opengeo.ncep.noaa.gov` (WMS) | Official NWS radar, including the time dimension driving the loop |
| `mapservices.weather.noaa.gov` | SPC convective outlooks and separate tornado/wind/hail probabilities; fire outlooks and mesoscale discussion polygons; watch county fills; WPC excessive rainfall, winter storm severity, and QPF; CPC 6–10/8–14 day, hazards, and drought outlooks |
| `services5.arcgis.com` | Current U.S. Drought Monitor classification |
| `api.water.noaa.gov` (NWPS) | River gauge stages and crest forecasts |
| `data.rcc-acis.org` | 1991–2020 normals, daily records, rankings, dry streaks |
| Open-Meteo | Air quality from Copernicus Atmosphere Monitoring Service (CAMS), UV index, and the location geocoder using GeoNames data |
| `gibs.earthdata.nasa.gov` (WMTS) | GOES-19 ABI GeoColor satellite tiles, in the map's own projection |

Basemap via OpenFreeMap: © OpenMapTiles, data from OpenStreetMap contributors.

Two icon sets, both MIT: sky conditions are [Meteocons](https://github.com/basmilius/weather-icons)
(© Bas Milius), loaded from a CDN; everything else is the inline `<svg id="sprite">` in
[`index.html`](index.html), whose interface and generic data glyphs are drawn from, or closely
after, [Feather](https://feathericons.com) (© 2013–2023 Cole Bemis), and whose weather-specific
glyphs are original to this project. Both licences ask that the copyright notice travel with the
work — hence the two names here and in the [licence table](#license) below, which the page footer
links.

## Design

Plain scripts load in dependency order: weather decisions, feed adapters, then the UI.
`FEEDS` supplies loader names, cadence, location scope, freshness limits, failure policy,
location reset targets and snapshot eligibility. Manual refresh, location refresh and the scheduler
derive their work from that registry.
The full design rationale — what each decision replaced, and why — lives in
[`DESIGN.md`](DESIGN.md). The invariants worth knowing before changing anything:

- **One icon language.** Every mark except the sky icons comes from the inline sprite, drawn with
  `ic("name")` so it inherits the colour and size of its label. One glyph per concept, no emoji;
  `tools/check.py` verifies every reference resolves and every symbol is used.
- **Severity is one ramp.** `alertLevel()` returns `emergency → warning → watch → advisory →
  statement` and sets `--lv` on the card; everything tinted reads that one variable. CAP severity
  can escalate an alert, but a watch stays a watch.
- **Location outranks severity.** `cardCmp()` ranks coverage above level, and coverage alone
  (`alertCoversMe()`) decides which section a card lands in. If `/points` fails, coverage fails
  **open**: nothing is ranked down and the list goes flat — a cluttered list beats a hidden warning.
- **Grouping is by event *and* coverage.** The same hazard can hold a card here and a card
  elsewhere; neither speaks for the other.
- **Colour is scarce.** Saturated colour means severity, links are blue; that is the whole budget.
  Type carries the hierarchy through the `--fs-*`/`--r-*`/`--sp-*` scales.
- **The page is ordered by what a visitor came for.** Alerts and active mesoscale discussions,
  a combined Now / Bottom Line hero, hourly planning, radar and seven-day forecast, then local
  context. Hourly sits beside radar above a full-width seven-day band; phones read hourly,
  radar, then seven-day. Every existing card and individual disclosure remains available.
- **Radar is a peek, not the product.** The map's height is an aspect ratio, never leftover space;
  radar and satellite stack on one Leaflet map; the loop targets a 60-minute span, not a sweep
  count; and a dead tile layer is detected per layer so it can never read as clear skies.
- **Every loader owns its failure.** Each degrades to an official link or to silence; one dead
  NOAA service must never blank a sibling card. Per-feed labels distinguish validated checks,
  partial results, overdue checks and unavailable data. Source timestamps stay separate from
  check times. JSON requests time out after 20 seconds.
- **Weather uses Central Time.** Clocks, alert windows, briefings, UV, sunrise/sunset and climate
  dates use `America/Chicago`, regardless of the viewer’s timezone. Calendar-only NOAA/ACIS
  product dates retain their stated day; daylight-saving changes never shorten a climate day.
- **Location generations.** Every location-scoped fetch checks `fresh()` before writing to the
  DOM, so one town's numbers can never appear under another town's label.
- **Inspectable advice.** The Bottom Line labels its dashboard-generated guidance, separates
  near-term advice from expandable later-week planning, and explains inputs, source age and
  uncertainty in “Why this recommendation?”. The Pulse contains NWS-authored guidance.
- **Visible, shareable locations.** The sticky navigation retains the selected town. Favorites
  and river pins persist locally; location URLs carry the selected point and override a saved
  location after LSX validation. City searches use representative points; geolocation is more precise.
- **Refresh preserves interaction.** The hourly slider retains its forecast timestamp and focus;
  disclosures keep their open state. Risk explanations support touch and keyboard interaction.
- **Nothing unverified is printed.** Sample-size gates, missing-day checks, borrowed figures
  attributed by name. Suppression beats false precision.
- **Instant paint.** Return visits paint eligible forecast/context cards from a `localStorage`
  snapshot before live data refreshes. Each fragment keeps its original successful-check time;
  saving again does not renew its TTL. Alerts, current observations and short-fused discussions
  are fetched live. Saved labels persist until their own feed is verified or cleared. Reshaping
  a card’s DOM or freshness metadata means bumping `SNAP_KEY`.

The briefing shares AQI category guidance with the air-quality card. Poor air or unverified alert/air
checks suppress favorable outdoor and open-window recommendations. Missing hourly samples leave
real gaps on the time axis and cannot certify an all-day forecast. Daily and hourly endpoint
failures are isolated.

River rows require an observation timestamp no more than two hours old (configurable per gauge);
crest guidance also requires a forecast issuance within 48 hours. Unverified rows link to NWPS.
Climate comparisons carry forecast dates; tomorrow's high never ranks against today's records.
Calendar-bound climate data are retired at Central midnight and refreshed.

After an alert outage, unexpired last-verified alerts remain clearly marked as unverified and
expire on their original deadlines. The briefing and map follow the retained state. Map requests
time out after 20 seconds and failed initialization can be retried from the map or full refresh.

**Adding a card** means registering its lifecycle in `FEEDS`, marking validated outcomes with
`feedUpdate()`, adding its markup and masonry rank, and clearing any derived weather state on
location changes. Refresh, scheduling, reset markup and snapshot lists are generated from `FEEDS`;
the reasons are
in [`DESIGN.md`](DESIGN.md#adding-a-card-adding-a-loader).

## Known gaps

- The satellite follows a *scrub* but does not *animate*. A real satellite loop needs a preloaded
  parallel GOES stack, and the cost is in the tiles — see
  [`DESIGN.md`](DESIGN.md#the-satellite-follows-the-scrub-and-the-reason-it-does-not-follow-playback-is-bytes).
- The masonry positions cards absolutely after sorting by importance and height. `reorderMasonryDOM`
  re-syncs DOM order to visual order after each pack; it skips only if a card hosts an iframe
  (re-inserting reloads them), and nothing in the masonry does today.
- `saveSnapshot()` serialises synchronously on `visibilitychange`.

## Contributing

The scope is the LSX County Warning Area. A change that generalises the dashboard to an arbitrary
US location is a different project — most of what makes this one useful (the CWA's own zones, the
river gauges that matter here, `climStation()`'s search radius) is tuned to eastern Missouri and
southwest Illinois.

Static, logic and Chromium browser checks run on every pull request and must pass:

```bash
python3 tools/check.py        # HTML/CSS comments, JS syntax, CSP, icons, root files
node tools/logic-tests.js     # the functions that decide something
```

Adding a feed means adding its origin to `connect-src` in [`_headers`](_headers), or the fetch is
blocked in production and works fine locally — `tools/check.py` fails until you do. Anything that
only paints is reviewed by eye; there is no snapshot suite to update. Read
[`DESIGN.md`](DESIGN.md) before reshaping anything it names as load-bearing.

## License

[MIT](LICENSE) for everything original to this repository — [`index.html`](index.html), the scripts
in [`assets/`](assets) and [`tools/`](tools), and the weather-specific glyphs in the inline sprite.

Everything that came from somewhere else keeps its own terms. This table is the canonical credits
list — the page footer links here for the full list and displays Open-Meteo's CC BY attribution
with a licence link, plus credits for its CAMS air-quality and GeoNames location sources. Basemap
credits appear on each map. MIT's one condition is that the copyright
notice travels with the work, which this table and [`LICENSE`](LICENSE) satisfy now that the
repository is public:

| Component | Terms |
|---|---|
| [Meteocons](https://github.com/basmilius/weather-icons) sky icons | MIT, © Bas Milius |
| Interface & generic data glyphs, drawn from or after [Feather](https://feathericons.com) | MIT, © 2013–2023 Cole Bemis |
| [Leaflet](https://leafletjs.com) 1.9.4 | BSD-2-Clause |
| [MapLibre GL JS](https://maplibre.org/) 5.24.0 | BSD-3-Clause |
| [MapLibre GL Leaflet](https://github.com/maplibre/maplibre-gl-leaflet) 0.1.4 | ISC |
| NWS/NOAA feeds — `api.weather.gov`, NCEP, NWPS, SPC/WPC/CPC, NESDIS/GOES | Public domain, as U.S. government work |
| NASA GIBS GOES-19 ABI tiles | Public domain |
| [U.S. Drought Monitor](https://droughtmonitor.unl.edu/DmData/GISData.aspx) classifications | Credit NDMC, USDA, and NOAA when using the GIS data |
| [Open-Meteo](https://open-meteo.com/) air quality, UV & geocoding | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Copernicus Atmosphere Monitoring Service (CAMS)](https://atmosphere.copernicus.eu/) global atmospheric composition forecasts | Upstream air-quality data used by Open-Meteo; CAMS and Open-Meteo credited on the page. See [Open-Meteo's attribution guidance](https://open-meteo.com/en/docs/air-quality-api#citation). |
| [GeoNames](https://www.geonames.org/) location data | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); upstream data used by Open-Meteo's geocoder |
| [RCC-ACIS](https://www.rcc-acis.org/) normals, records & rankings | Open access |
| [OpenFreeMap](https://openfreemap.org/) basemap | Public keyless tiles; © OpenMapTiles, data from OpenStreetMap contributors. The public instance offers no SLA. |

**The warranty disclaimer is load-bearing, not boilerplate.** This is a weather page, and the `AS IS`
clause is the reason a fork is the forker's problem: a stale copy still serving last week's warnings
during a severe event is the failure this project can neither detect nor control. The footer line —
*not an official NWS product; during severe weather defer to official warnings and a NOAA Weather
Radio* — applies to every copy, and forks are asked to keep it intact.

## Redesign review

The specification-driven visual refresh is tracked in [the feature parity checklist](docs/redesign-parity.md).
Run `NODE_PATH=/path/to/test/node_modules CHROMIUM_PATH=/usr/bin/chromium node tools/redesign-tests.js`
for the additional phone/tablet/desktop checks in both themes. Set `REDESIGN_ARTIFACTS` to save
explicitly labeled fixture screenshots; these sample values and controlled map tiles are test-only.
The existing weather, seasonal and real-cache upgrade suites remain required.
