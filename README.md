# LSX Dashboard

A one-page weather dashboard for the **NWS St. Louis (LSX) County Warning Area** — eastern Missouri
and southwest Illinois. Alerts, radar, forecasts, river gauges, and climate context for a location
inside the CWA.

Not an official NWS product. During severe weather, defer to official warnings and a NOAA Weather Radio.

## What it is

One file. [`index.html`](index.html) is the entire application — all CSS, markup, and JavaScript,
inline.

- **No build step.** No bundler, no transpiler, no `package.json`. Edit the file, reload the page.
- **No API keys.** Every feed was chosen because it is keyless and CORS-open, so the whole thing
  runs as a static page with no server and no secrets.
- **Two runtime dependencies**, both from a CDN with SRI hashes: Leaflet 1.9.4 for the maps, and
  Meteocons for the sky-condition icons. Both degrade gracefully if the CDN is unreachable — every
  other icon on the page comes from an inline sprite that ships with the file.
- **Installable PWA** via [`manifest.webmanifest`](manifest.webmanifest). There is deliberately no
  service worker — return visits paint instantly from a `localStorage` snapshot instead.

## Running it locally

Serve it over `localhost` rather than opening the file directly — `file://` breaks geolocation and
the snapshot cache, both of which need a secure context.

```bash
python3 -m http.server 8787
```

Then open <http://localhost:8787>.

With no build step there is nothing between an edit and production, so the mistakes that would
ship silently are checked mechanically. CI runs both on every pull request:

```bash
python3 tools/check.py        # syntax, CSP origins, icon names, root files
node tools/logic-tests.js     # the functions that decide something
```

[`tools/check.py`](tools/check.py) catches the four footguns this repo's shape creates — a syntax
error in the inline script, an origin the CSP doesn't declare, an icon name with no `<symbol>`, and
a missing or self-contradicting file at the site root. [`tools/logic-tests.js`](tools/logic-tests.js)
covers the pure decision functions (`rangeRow()`, `alertLevel()`, `cardCmp()`, `coldVerdict()`);
anything that paints is reviewed by eye.

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

All public-domain or openly licensed, all keyless.

| Feed | Used for |
|---|---|
| `api.weather.gov` | Forecast, hourly, station obs, active alerts, AFD + mesoscale discussion text, county zones |
| `opengeo.ncep.noaa.gov` (WMS) | Official NWS radar, including the time dimension driving the loop |
| `mapservices.weather.noaa.gov` | SPC convective + fire outlooks and mesoscale discussion polygons, convective watch county fills, WPC excessive rainfall, CPC 6–10/8–14 day, CPC hazards & drought, WPC QPF |
| `api.water.noaa.gov` (NWPS) | River gauge stages and crest forecasts |
| `data.rcc-acis.org` | 1991–2020 normals, daily records, rankings, dry streaks |
| Open-Meteo | Air quality, UV index, and the location geocoder |
| `gibs.earthdata.nasa.gov` (WMTS) | GOES-19 ABI GeoColor satellite tiles, in the map's own projection |

Basemap © CARTO & OpenStreetMap contributors.

Two icon sets, both MIT: sky conditions are [Meteocons](https://github.com/basmilius/weather-icons)
(© Bas Milius), loaded from a CDN; everything else is the inline `<svg id="sprite">` in
[`index.html`](index.html), whose interface and generic data glyphs are drawn from, or closely
after, [Feather](https://feathericons.com) (© 2013–2023 Cole Bemis), and whose weather-specific
glyphs are original to this project. Both licences ask that the copyright notice travel with the
work — hence the two names here and in the [licence table](#license) below, which the page footer
links.

## Design

The script is sectioned by `/* ==== BANNER ==== */` comments and reads top to bottom: config →
helpers → ~15 per-card loaders → derived renderers → orchestration → scheduler → layout engine.
The full design rationale — what each decision replaced, and why — lives in
[`DESIGN.md`](DESIGN.md). The invariants worth knowing before changing anything:

- **One icon language.** Every mark except the sky icons comes from the inline sprite, drawn with
  `ic("name")` so it inherits the colour and size of its label. One glyph per concept, no emoji;
  `tools/check.py` verifies every reference resolves and every symbol is used.
- **Severity is one ramp.** `alertLevel()` returns `emergency → warning → watch → advisory →
  statement` and sets `--lv` on the card; everything tinted reads that one variable. CAP severity
  may escalate a step, never demote — and never touches a watch.
- **Location outranks severity.** `cardCmp()` ranks coverage above level, and coverage alone
  (`alertCoversMe()`) decides which section a card lands in. If `/points` fails, coverage fails
  **open**: nothing is ranked down and the list goes flat — a cluttered list beats a hidden warning.
- **Grouping is by event *and* coverage.** The same hazard can hold a card here and a card
  elsewhere; neither speaks for the other.
- **Colour is scarce.** Saturated colour means severity, links are blue; that is the whole budget.
  Type carries the hierarchy through the `--fs-*`/`--r-*`/`--sp-*` scales.
- **The page is ordered by what a visitor came for.** Alerts, the Bottom Line, The Pulse, the hero
  band, the 24-hour chart, then the masonry — in DOM order, with no CSS `order` anywhere.
- **Radar is a peek, not the product.** The map's height is an aspect ratio, never leftover space;
  radar and satellite stack on one Leaflet map; the loop targets a 60-minute span, not a sweep
  count; and a dead tile layer is detected per layer so it can never read as clear skies.
- **Every loader owns its failure.** Each degrades to an official link or to silence; one dead
  NOAA service must never blank a sibling card.
- **Location generations.** Every location-scoped fetch checks `fresh()` before writing to the
  DOM, so one town's numbers can never appear under another town's label.
- **Nothing unverified is printed.** Sample-size gates, missing-day checks, borrowed figures
  attributed by name. Suppression beats false precision.
- **Instant paint.** Return visits paint from a `localStorage` snapshot before any network
  request; reshaping a card's DOM means bumping `SNAP_KEY`.

**Adding a card** means touching five places: the markup, the `RANK` map in `layoutMasonry`'s
`tier()`, `SNAP_PARTS`, the `SCHED` table, and `clearLocationUI`/`resetLocationState`. **Adding a
location-scoped loader** means a sixth, the `jobs` array inside `setLocation()` — the reasons are
in [`DESIGN.md`](DESIGN.md#adding-a-card-adding-a-loader).

## Known gaps

- No `aria-expanded` on the expandable alert and forecast rows.
- The hero pair only bottom-aligns in one direction. The reading column stretches to meet the Sky
  card, so the ordinary case is flush — but when the AQI card earns its slot the left column becomes
  the taller of the two, and the leftover reappears under the map. Stretching the map to absorb it
  stays off the table: its height is an aspect ratio, not a number looking for a value.
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

Both checks run on every pull request and must pass:

```bash
python3 tools/check.py        # syntax, CSP origins, icon names, root files
node tools/logic-tests.js     # the functions that decide something
```

Adding a feed means adding its origin to `connect-src` in [`_headers`](_headers), or the fetch is
blocked in production and works fine locally — `tools/check.py` fails until you do. Anything that
only paints is reviewed by eye; there is no snapshot suite to update. Read
[`DESIGN.md`](DESIGN.md) before reshaping anything it names as load-bearing.

## License

[MIT](LICENSE) for everything original to this repository — [`index.html`](index.html), the scripts
in [`tools/`](tools), and the weather-specific glyphs in the inline sprite.

Everything that came from somewhere else keeps its own terms. This table is the canonical credits
list — the page footer links here instead of repeating it, and keeps on the page only what has to
be there: Open-Meteo's CC BY attribution (its data renders in the page itself) and the basemap
credit on each map, where CARTO's terms ask for it. MIT's one condition is that the copyright
notice travels with the work, which this table and [`LICENSE`](LICENSE) satisfy now that the
repository is public:

| Component | Terms |
|---|---|
| [Meteocons](https://github.com/basmilius/weather-icons) sky icons | MIT, © Bas Milius |
| Interface & generic data glyphs, drawn from or after [Feather](https://feathericons.com) | MIT, © 2013–2023 Cole Bemis |
| [Leaflet](https://leafletjs.com) 1.9.4 | BSD-2-Clause |
| NWS/NOAA feeds — `api.weather.gov`, NCEP, NWPS, SPC/WPC/CPC, NESDIS/GOES | Public domain, as U.S. government work |
| NASA GIBS GOES-19 ABI tiles | Public domain |
| Open-Meteo air quality, UV & geocoding | CC BY 4.0 |
| [RCC-ACIS](https://www.rcc-acis.org/) normals, records & rankings | Open access |
| CARTO basemap tiles | CARTO terms; underlying data © OpenStreetMap contributors, ODbL |

**The warranty disclaimer is load-bearing, not boilerplate.** This is a weather page, and the `AS IS`
clause is the reason a fork is the forker's problem: a stale copy still serving last week's warnings
during a severe event is the failure this project can neither detect nor control. The footer line —
*not an official NWS product; during severe weather defer to official warnings and a NOAA Weather
Radio* — applies to every copy, and forks are asked to keep it intact.
