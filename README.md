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
node tools/spc-discovery-tests.js # bounded SPC retries, cancellation and concurrency
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
  a combined Now / NWS Key Messages hero, hourly planning, radar and seven-day forecast, then local
  context. Hourly and a compact seven-day card stack beside a full-height radar; phones read hourly,
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
- **Official message provenance.** NWS Key Messages preserves NWS St. Louis AFD wording
  and bullet order. “Source and freshness” separates AFD product issuance from explicit section
  time, and identifies the current local NWS forecast fallback when messages cannot be verified.
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

Internal safety guards for optional model commentary share AQI category guidance with the air-quality
card. Poor air or unverified alert/air checks suppress favorable comfort assumptions. Missing hourly samples leave
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

## Supplemental NBM temperature range

Supplemental NBM ranges appear alongside official NWS day/night entries in the forecast card.
Expand an entry to compare the NWS temperature and exact interval with native NOAA NBM P25/P50/P75
values and the native 18-hour interval. **NBM model range** spans P25–P75 alongside the official NWS high/low. A single shared note explains the
18-hour windows; individual rows keep only the ranges. Exact interval differences remain in expanded details.
The collapsed **About NBM ranges & unmatched windows** section explains the percentiles,
source age, nearest cell, coverage, and windows that cannot be paired. `/?nbm=0` disables guidance.

Placement requires a unique same-kind match in both directions covering at least 75% of the
NWS interval. This overlap rule does not make the windows equivalent: differing endpoints
are explicitly labeled. Missing official values, ambiguous overlaps, expired periods, and
invalid or stale model data never produce paired comparisons. Zero temperatures are valid.
All displayed endpoints use America/Chicago, including each endpoint's DST offset. Model
annotations are excluded from saved NWS HTML and require both current-location sources after
reload. The existing static dataset and publisher are reused; no new storage, backend, credentials,
or infrastructure costs are introduced.
NWS forecasts, headlines, warnings and risk decisions receive no NBM values.

### Regional refresh

The smallest supported pipeline is one Python/ecCodes extraction producing static JSON, with
no database or request-time backend. It downloads each selected GRIB message once for the entire
region. To run it locally (normal TLS only):

```bash
python3 -m venv /tmp/nbm-venv
/tmp/nbm-venv/bin/pip install -r tools/nbm-requirements.txt
/tmp/nbm-venv/bin/python tools/nbm-refresh.py --output-dir data
python3 -m http.server 8787
# Open http://localhost:8787/
```

Default discovery examines actual QMD publication within the last 24 hours and considers the two
newest published cycles. It does not infer readiness from core. Eighteen consecutive native maximum/minimum windows (about nine days)
are required before replacing the current dataset. The newest cycle receives up to three attempts,
15 seconds apart, including index-before-GRIB and incomplete-index publication races; a prior
published cycle may then be used within the same source-age limit. Transient network failures are
bounded; access denials and invalid GRIB metadata/order fail closed. An explicit `--run YYYYMMDDHH`
is available for current-cycle validation, not historical data masquerading as live data.

`.github/workflows/nbm-refresh.yml` checks hourly at minute 17 UTC and also accepts manual
workflow dispatch. Publication is restricted to `main`. Hourly checks accommodate delayed QMD
publication; only changed validated cycles or revisions make a data commit and trigger Pages.
Manual main-branch runs additionally verify the public data hash/receipt and rendered mobile/desktop
card over normal TLS, including nearest-cell values and native interval labels. Verification polls
Pages for at most five minutes and fails if the expected data is not served; it does not bypass TLS.
This browser job does not run on hourly polls.
The extraction job uses read-only access and retains artifacts/status for three days; the separate
publisher uses only the approved job-scoped built-in token write permission.

### Coverage and matching

Supported geography is **38.2–39.2°N, 91.1–89.5°W**, a metro rectangle, not the full LSX county-warning
area. It includes Lake St. Louis, St. Louis, Belleville, Edwardsville, Washington, Arnold and Alton.
Existing dashboard LSX location checks still apply. Requests outside the rectangle show unsupported
coverage. Inside it, the card selects the nearest stored native GRIB cell by spherical distance,
requiring at most **3 km**; it neither interpolates values nor substitutes a station. A small grid
padding permits correct selection at the rectangle's edges. All three percentiles use that same
cell, run and native interval. The point extractor uses schema 4; regional data uses schema 3. Both identify native [25, 50, 75]. Legacy P10/P50/P90 schemas are rejected.

### Data correctness and freshness

Actual QMD extrema are TMP records with GRIB2 template 4.10 and maximum/minimum statistical
processing (2/3), in kelvin at 2 m. Validated native windows are **18 hours**, not local calendar
highs/lows. For example, the October 8 maximum spans Oct 8 07:00 CDT to Oct 9 01:00 CDT; the following
minimum spans Oct 8 19:00 CDT to Oct 9 13:00 CDT. Both endpoints use America/Chicago independently
across DST. Hourly percentiles are never used to derive extrema; crossed percentiles are rejected,
not reordered. P50 is the model median, not the official NWS forecast.

Regional schema 3 stores a shared cell table and shared per-interval provenance, plus three Kelvin
values per cell. Each message preserves its NOAA URL, byte range, SHA-256, ETag, upload time, decoded
cycle, native interval and grid identity. The browser converts the selected cell to Fahrenheit and
revalidates the percentile group. Cycle age never resets on extraction or page refresh. Data 24 hours old
or older is withheld on the next 15-minute card refresh; expired native intervals are removed.
The 24-hour limit is dashboard policy, not a NOAA SLA.

Local writes use a flushed temporary file and atomic replacement, with a writer lock and rejection
of cycle rollback. A failed extraction leaves previous data bytes and retrieval/source timestamps
unchanged and emits `nbm-status.json` with a nonzero process/job result. Status includes fallback
notes, bytes, requests, elapsed time and peak RSS. Two distinct cycle snapshots are retained under
`history/`; GRIB downloads are not stored. Runtime JSON, receipt, status, lock and history are Git-ignored.

An unchanged-source gate reuses retained output only when its validation receipt matches the bytes,
validator version and cycle, the current index ranges match, and eighteen one-byte probes confirm unchanged
source ETags. Structural consumer validation also runs before reuse. The `regional-quartiles-v2` receipt identity rejects legacy data and receipts even for the same source cycle. A missing receipt, old schema or source revision requires native extraction. An unchanged result reports
`changed:false` without rewriting data, receipt, history or retrieval time. `nbm-status.json` still
records the check; the publisher gates on `changed` and never commits status timestamps.
The receipt is local integrity evidence, not a signature or a replacement for source validation.

**Persistence boundary:** the manual workflow uses a fresh temporary directory each run. Its history
is not cross-run persistence and its artifacts are not a public serving endpoint. Last-good retention
across jobs requires a persistent publication adapter to load/preserve the existing object;
the publisher below implements that adapter. If runtime data is absent, the card shows unavailable. The committed compressed regional fixture is recorded test evidence only
and is never fetched by the dashboard. A retained file becomes stale by source age even if every later
refresh fails. Job failures/status artifacts provide reporting; no new notification integration exists.

### Data-only publisher

The approved publisher (`tools/nbm-publish.py`) is wired as a separate job with **job-scoped
`contents: write`**, using the built-in `GITHUB_TOKEN` through checkout. This permission is
repository-wide; it is not a GitHub-enforced path permission. The publisher's temporary Git index
and final tree comparison permit only `data/nbm-range.json` and `data/nbm-receipt.json`. Other staged
files, status timestamps, local history and application code cannot enter its commit.

The user authorized rollout using the existing Cloudflare Free plan (500 builds/month), accepting
that current consumption is unverified. Supplied settings confirm `main` automatic deployments,
include paths `*`, no build command and root output. Existing branch/Actions rules remain authoritative:
the readable `protect-main` ruleset blocks deletion and force-push; classic protection and Actions
settings returned 403. Normal operations must fail on policy rejection; never bypass restrictions,
create credentials or change security settings. The hourly schedule and main-only publisher implement
the approved rollout, subject to successful normal merge, workflow and deployment verification.

Extraction now loads the last committed dataset/receipt from `main` into its temporary output,
allowing unchanged-cycle reuse across jobs. It fails closed on an incomplete retained pair.
The publisher checks the receipt hash, recent successful status, source age, all regional percentile
rows and consumer provenance validation before fetching the latest `main`. It rejects older cycles
or older/equal retrieval revisions, and aborts if publishing/validation code changed during the run.
An unchanged result requires byte-identical remote files and makes no commit.

A candidate commit has the latest remote head as its sole parent, retaining concurrent app changes.
Exactly one ordinary fast-forward push is attempted. A competing push or branch-rule rejection fails
closed; there is no force-push, rebase, automatic merge or retry of an ambiguous push. The next run
reads the actual remote state. Workflow concurrency serializes NBM jobs, while Git also protects
against other writers. Remote files change together in one commit. Extraction/validation failures
leave last-good data serving; failed Pages deployment leaves the prior deployed version. A lost
push response may mean Git accepted the commit: the audit explicitly requires inspecting remote state.

Publication is bounded to two current files (each at most 2 MB), one commit and one push per run,
a five-minute publish job, and three-day audit artifacts. Local extraction retains at most two cycle
snapshots; those snapshots are not committed. The commit message records run, data SHA-256, parent,
workflow run and attempt; result JSON records the published commit or failure. Git history is still
cumulative and needs an agreed long-term policy before recurring operation. Consumer staleness uses
source age even if retained files survive every subsequent failure.

Offline tests use temporary bare Git remotes, including rejected writes and concurrent updates;
recorded data is never published by these tests. Run `python3 tools/nbm-publish-tests.py`.

### Full seven-day horizon and measured operating impact

The first prototype deliberately extracted only six native extrema windows (roughly three days).
Blank later rows were an extraction limit, not evidence that NOAA lacks later percentiles. On
2026-10-08, current 00Z QMD indexes contained complete native P10/P50/P90 groups through at least
forecast hour 258. The bounded extractor now selects 18 consecutive windows, with 12-hour-spaced
endpoints at 06/18 UTC and each native interval retaining its actual 18-hour length. This gives
buffer beyond seven NWS rows for a cycle up to 24 hours old, partial first/last periods and DST.
Only unique same-kind overlaps are paired; a missing/ambiguous NWS period is never synthesized.

The consumer accepts six-window quartile recordings for tests; legacy percentile schemas fail closed. New publication requires
all 18 windows; incomplete new cycles retry/fall back within existing limits and never publish a
shortened replacement. A cached six-window snapshot cannot pass the longer-plan unchanged gate.

The authentic full-horizon rehearsal selected **2026-10-08 00Z**, because the newer 06Z cycle's
f024 index was not yet published. It validated **2,969 cells, 18 windows, and 54 GRIB messages**:
**115,295,645 bytes**, **87 requests**, **122.220 seconds**, **184.96 MiB peak RSS**. JSON is
**1,244,080 bytes** (see the recorded compressed fixture), versus the prototype's 508,060 bytes.
A second check reused byte-identical data and its original retrieval time: **510,048 bytes**,
**51 requests**, **40.516 seconds**, **32.0 MiB RSS**, `changed:false`. These measurements are in
`tools/fixtures/weather/nbm-regional-full-*`; recorded data is used only by tests.

All existing limits remain unchanged: 100 requests, 150 MB, 10-minute extraction budget,
15-minute workflow timeout, 2 MB candidate-size ceiling and the same supported region. The larger
extraction leaves less retry headroom; exhausted budgets retain last-good data and its stale state,
so a delayed cycle is not guaranteed to recover within the same run. The longer
horizon needs about three times the GRIB transfer per changed cycle and 2.45 times the client JSON
payload. At 120 changed extractions plus 600 unchanged checks per 30 days, this measured scenario
is approximately **14.14 GB downloaded and 650 minutes** of work before startup/retries, versus
4.72 GB and 338 minutes for the earlier prototype measurements. If every hourly artifact retained
both current and new-history JSON, 72 artifacts would be about 179 MB raw before compression.
Storage/transfer use increases; no new service, credentials, region, paid entitlement, or billing
commitment is introduced. Changed-cycle publication frequency and Pages build count are unchanged.

### Original six-window measurements (historical baseline)

On 2026-10-07, automatic discovery selected **12Z QMD**, with 06Z also published. The run extracted
**2,969 cells and six windows** using **38,480,036 downloaded bytes**, **42 requests**, **55.089 seconds**
and **185.23 MiB peak RSS** on this Linux environment. Output was **508,060 bytes** (about 100 KB gzip).
These are extraction measurements; runner startup and dependency installation add time. The recorded
source and measurements are in `tools/fixtures/weather/nbm-regional-*`. A 2,665-point offline sweep
of the authentic grid found complete supported coverage, with maximum nearest-cell distance about
1.711 km. Regional values at the original default point match the independent earlier point capture.

Bounds per invocation: 100 HTTP requests, 150 MB response budget, a 10-minute work budget checked
between requests, 20-second network timeouts, and a 15-minute workflow timeout. These fail closed
rather than widening the region or dropping checks. Bounded retries may repeat a partially downloaded
cycle, but the extractor never repeats a full download for each location. Cross-run reuse requires
supplying the previously validated JSON and receipt from persistent storage or repository checkout.

The retained-data gate was tested against the original authentic capture without repeating extraction:
**174,884 bytes**, **30 requests**, **22.767 seconds**, **23.75 MiB RSS**, `changed:false` and identical
output bytes. Hourly checks therefore do not require hourly GRIB extraction or deployment. Using the
typical four QMD cycles/day as a planning scenario gives about 120 extractions and 600 unchanged checks
per 30 days: approximately **4.72 GB downloaded and 338 minutes** of measured work, before startup,
installation, source revisions and retries. Publication timing and cycle availability are discovered,
not assumed. A fresh-run rehearsal without retained data would still re-extract each time.

These are planning scenarios, not a dollar quote or a guarantee. Artifacts include current plus history copies; with the
fresh-run rehearsal and three-day retention, 72 hourly artifacts would hold roughly 73 MB of raw
JSON before archive compression, plus small status files. Existing repository artifacts share quotas.

This repository is public and uses standard Ubuntu runners, which GitHub currently documents as
[free runner usage](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Storage remains plan-dependent; no account billing entitlement was assumed. Cloudflare Pages Free
currently allows [500 builds/month](https://developers.cloudflare.com/pages/platform/limits/).
Publishing only newly validated cycles at four/day would use about **120 builds/month**, leaving
roughly 380 for ordinary app builds, previews, revisions and other usage within that quota. Actual
current consumption is unverified and was explicitly accepted by the user. Do not equate 720 hourly checks with 720 site builds.

**Simplest infrastructure option:** keep the existing Git-connected Pages deployment and publish
data-only commits only when `changed:true`. The job starts with the
last committed dataset and receipt, retains them on failure, validates a complete replacement, then
atomically commits only the approved data paths against the current branch head. No-op checks must produce no commit or build;
failed deployment must leave the prior Pages version serving. The existing same-origin data URL and
new revalidation header avoid CORS changes. This uses existing hosting and needs no new storage product.

**Actual repository constraint:** the visible `protect-main` ruleset blocks deletion and force-push.
Classic protection/default-token settings remain inaccessible (403). The user approved job-scoped
built-in token writes and rollout despite unverified consumption; existing account restrictions remain authoritative.
If classic settings require PR review, preserve that review path rather than bypass it. No PAT/App token
or relaxed protection is needed or authorized.

Automated repository updates add commit noise and long-term Git history; deleting old working-tree
snapshots does not prune that history. Concurrent app changes require conflict-safe retry rather than
force-push. GitHub notes that ordinary pushes made with
[`GITHUB_TOKEN` do not start another Actions run](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
so required validation must run in the publisher itself. Pages documents
[deployments on branch pushes](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/),
but the eventual approved automation identity must be verified in a non-production test before
assuming it triggers this specific installation. Other automation identities may also trigger the
ordinary app CI matrix. Only the approved built-in token permission is declared on the publisher job.

**Operating limits:** four new cycles/day is roughly 120 monthly data builds, not a guarantee.
Same-cycle NOAA revisions, validation-version changes requiring refreshed output, ordinary app
commits, previews and retries can add builds. Unchanged checks never commit status timestamps.
Check usage periodically; if quota is exhausted, preserve last-good data and let source-age expiry
withhold stale values. Pause the NBM workflow if needed rather than buying services or bypassing policy.

Normal-TLS access was verified for the [S3 source](https://noaa-nbm-grib2-pds.s3.amazonaws.com/),
[NOMADS](https://nomads.ncep.noaa.gov/pub/data/nccf/com/blend/prod/) (HTTP/1.1; malformed HTTP/2 header)
and [NBM docs](https://blend.mdl.nws.noaa.gov/nbm-documentation). The
[VLab textcard docs](https://vlab.noaa.gov/web/mdl/nbm-textcard-v5.0) returned 403; no station fallback
is implemented. Source cycle, upload time and retrieval time remain separate.

```bash
node tools/nbm-tests.js
python3 tools/nbm-extract-tests.py
python3 tools/nbm-refresh-tests.py
NODE_PATH=/path/to/playwright/node_modules CHROMIUM_PATH=/usr/bin/chromium \
  NBM_ARTIFACTS=/tmp/nbm-visual node tools/nbm-browser-tests.js
```

Tests distinguish authentic captures from deliberate malformed-data/outage mutations and cover
regional matching, boundaries, native-period provenance, unit/order failures, DST, retries,
publication races, retention, atomic interruptions, source-age preservation, and bounded main-only scheduling.
Existing dashboard checks remain required.

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

## Official outlook sources

CPC leanings, drought periods and hazards periods open matching official products in a new tab.
See [the source inventory and interaction checks](docs/official-source-links.md).

## Redesign review

The specification-driven visual refresh is tracked in [the feature parity checklist](docs/redesign-parity.md).
Run `NODE_PATH=/path/to/test/node_modules CHROMIUM_PATH=/usr/bin/chromium node tools/redesign-tests.js`
for the additional phone/tablet/desktop checks in both themes. Set `REDESIGN_ARTIFACTS` to save
explicitly labeled fixture screenshots; these sample values and controlled map tiles are test-only.
The existing weather, seasonal and real-cache upgrade suites remain required.

### Optional 24-hour NBM temperature band (dependent review)

The hourly branch depends on the reviewed seven-day work in PR #58. The existing NWS hourly
line, values, summaries, precipitation, headlines and risk logic remain primary. A checkbox in
**Plan your day** enables a separate **NBM model range** (native P25–P75) in the 24-hour view. It plots the
actual model bounds; the NWS line can be outside them. Slider, keyboard and touch details show
P25/P50/P75 and the valid Central time with CDT/CST. The range is model guidance, not an NWS
confidence interval. Longer views remain NWS-only; no interpolation fills missing native hours.

`tools/nbm-hourly-refresh.py` independently extracts instantaneous **TMP at 2 m**, GRIB2 PDT6,
NOAA centre, Kelvin, native P25/P50/P75. It checks decoded run, forecast step, valid UTC time,
percentile order and the identical subset grid/cell coordinates across all groups. These fields
are not the 18-hour TMAX/TMIN extrema. Current inventories were verified to include hourly
percentiles through f060; later sampled fields are three-hourly. QMD publication is about seven
hours behind its 00/06/12/18Z cycle, unlike the faster core product. The separate hourly payload
contains f001–f048, so a source younger than 24 hours can cover the current rolling 24-hour window.
The browser requires unique exact UTC matches to one-hour NWS periods, with no replacement of
missing NWS temperatures and no substitution of model values into official forecasts.

The actual download source is NOAA NOMADS' regional GRIB subset service. The region is padded
by 0.08 degrees before extraction and trimmed to the existing 0.05-degree cell halo. The complete
rehearsal retained 2,969 cells. Thirty P10/P50/P90 comparisons at corners, edge midpoints and
interior points in one authentic hour matched the original S3 full-grid native cells and values;
this is sampled cross-source verification, not proof that all source files are byte-identical.
The recorded subset GRIB and `nbm-hourly-edge-audit.json` make that check inspectable. All 48
hours independently passed decoded metadata, coverage and percentile validation.

NOMADS supplies Last-Modified and Content-Length, not S3's ETag. Each original NOMADS object's
metadata is checked before and after its subset is decoded; the subset SHA256 is recorded.
S3 listings are used only to discover actually published cycles (NOMADS can return 403 for an
unpublished path). An access denial is never treated as a retry/fallback signal. The unchanged
check compares all 48 NOMADS revision indicators and a retained receipt; it is not a cryptographic
proof against an upstream edit preserving both timestamp and length. No cross-source ETag identity
is claimed. Source age is based on the actual run; unchanged checks preserve retrieval time.

Hourly bounds are separate from the daily pipeline: **180 requests, 30 MB downloaded, 600 seconds,
30-second request timeout, two attempts for transient failures, 4 MB output**, and a one-second
pause between subset requests. The October 8 06Z full rehearsal measured **146 requests,
6,408,858 bytes, 410.123 seconds, 107.07 MiB peak RSS**, and **3,819,936 bytes of JSON**. The newer
12Z QMD was not listed. Values are retained to 0.001 K (maximum rounding error 0.0005 K, less than
0.001°F), avoiding meaningless decimal expansion from subset repacking. The first rehearsal
rejected oversized output; it did not publish it or relax the size guard. A subsequent unchanged
check used **50 requests, 1,038 response-body bytes and 23.157 seconds**, without replacing the
snapshot. Measurements are in `tools/fixtures/weather/nbm-hourly-*-status-recorded.json` and
`nbm-hourly-status-recorded.json`. Header/transport overhead is not included in body-byte counts.

At 120 changed cycles and 600 unchanged checks per 30 days, these measurements imply roughly
**0.77 GB of downloaded bodies and 1,052 execution minutes**, before runner setup/retries, in
addition to the existing daily job. The hourly browser payload adds 3.82 MB uncompressed per
changed response (1.07 MB with local gzip; actual delivery encoding can differ). If retained as 72 hourly artifacts, one snapshot each is about 275 MB raw before
compression. These are scenarios, not a new spending commitment. No paid service, credentials or
browser network permission is added. Reliability and latency of NOAA's subset service remain an
operational dependency; budget exhaustion or malformed/incomplete groups preserve last-good data,
which still expires at 24 hours of source age.

`tools/nbm-hourly-publish.py` reuses the existing guarded Git publisher but permits only the hourly
JSON and receipt. It rejects partial, stale, malformed, oversized, rollback or obsolete-code
candidates and preserves unrelated files. Real local Git tests cover races and remote rejection.
The **NBM hourly rehearsal** workflow is manual and read-only: it produces artifacts without a
schedule or publication job. Production activation is handled by the combined release configuration
below. Immutable review previews still expire normally rather than silently refreshing themselves. Hourly model graphics are excluded from
saved NWS chart HTML and cannot pair with restored-only official data.

### Refresh reliability and publication budget (PR #59, release activation)

This section supersedes the earlier prototype's activation and four-cycles/day planning
assumptions. The daily and hourly products now share **one recurring workflow and one publisher**.
The release-approved cron checks hourly at minute 17 on `main`, unless the repository variable
`NBM_REFRESH_ENABLED` is explicitly `false`. Publication and manual verification use the same
opt-out. An unset variable enables this reviewed release configuration; branch dispatches remain
read-only rehearsals. Variable administration is not available to the release integration, so
activation is an ordinary reviewed code change rather than a new credential or permission. The existing
job-scoped `contents: write` permission is unchanged; there are no new secrets, tokens or services.
The hourly-only workflow remains manual and read-only, with no second schedule.

Each eligible check starts from committed daily/hourly pairs and the publication budget on a
freshly fetched `main`. Each producer has independent bounds and a 630-second process deadline.
The sequential extraction job has a 25-minute limit: up to 1,260 seconds of producer execution,
plus checkout/setup/reporting. Daily source limits remain 100 requests/150 MB/600 seconds;
hourly limits remain 180 requests/30 MB/600 seconds, 4 MB output, two request attempts, and
one-second subset pacing. Failed/timed-out products cannot reuse a previous successful status.
Known resource use is reported even on producer failure; killed-process totals are explicitly
marked `resourceUsageIncomplete`, and their unreported work is not claimed as zero.

Hourly readiness now requires every exact CONUS f001–f048 file in the bounded S3 inventory.
A listing may be truncated after those files because it contains other regions; all 48 required
keys must still be present. Advertised incomplete cycles and transient failures receive at most
two selection attempts, 15 seconds apart, within the same total resource budget, before an older
eligible cycle is considered. Missing/invalid percentiles cannot enter a published snapshot.
403/access denials are never retried or hidden by fallback. Both products must be individually
complete for publication (18 native daily windows; 48 instantaneous hourly fields). A failed
product retains its entire last-good pair, while its healthy sibling may publish. Their source
cycles may differ; no source age is reset by checking, retaining or publishing data.

`nbm-combined-publish.py` validates each candidate/status/receipt independently, fetches current
`main`, checks code freshness and per-product rollback, and uses one private Git index for one
ordinary fast-forward push. Changed pairs and `data/nbm-publication.json` are committed atomically.
Only those **five allowlisted data files** can change. A failed sibling is omitted completely;
its remote bytes stay intact. A partially successful publication is explicitly audited as
`degraded` and returns a failed job status so the failure remains visible. Two failed products
make no commit. A race/rejection never force-pushes, rebases or automatically retries an ambiguous
write. Local interrupted pairs are not atomic across two filesystem replacements, but an invalid
receipt or unsuccessful status prevents them from becoming a Git publication.

**Budget:** the manifest allows at most one changed data commit assigned to each six-hour UTC
preparation window (00–06, 06–12, 12–18, 18–24). The same cap applies to manual publisher calls.
It is read from the fetched remote head and advanced only in a changed publication. Unchanged,
failed and deferred checks do not advance it. An absent manifest can bootstrap only with complete
history and no previous manifest; a deleted, malformed or future-dated established manifest fails
closed. `preparedAt` is the commit preparation time, **not a confirmed deployment timestamp**.
A push/build can complete across a window or billing-month boundary; neighboring windows can
publish close together. The cap is 120 assigned commits over 30 UTC days or 124 over 31, not a
promise about all builds in the Cloudflare billing month.

A closed window skips NOAA extraction and decoder installation. The next open window performs
fresh validation; deferred candidates are not blindly published later. A fixed f001–f048 hourly
payload is aligned to the rolling view in the browser, so moving the clock or requested horizon
never rewrites the payload. A no-op preserves the original retrieval timestamp and receipt.
A late product, revision, or recovering sibling can wait nearly six hours after another product
uses its window. This can cause an unavailable interval during upstream disruption: old data is
still withheld at 24 hours of **source-cycle age**. The cap deliberately trades fastest possible
recovery for a predictable data-commit budget; the approved release retains that tradeoff.

Batching alone is insufficient: staggered daily/hourly arrivals can otherwise cause two commits
per cycle, and revisions could turn hourly checks into 720 monthly commits. Simulations cover
hourly revisions, clock/horizon movement, no-ops, fixed-window boundaries and sibling recovery;
real Git tests cover one transaction, retained bytes, rollback, concurrent writes and rejection.
Cloudflare documents [500 Free builds/month](https://developers.cloudflare.com/pages/platform/limits/).
App commits, preview builds, manual rebuilds, other writers and carried-over builds are outside
this publisher's cap. Existing account usage is unverified. No free-usage or zero-overage guarantee
is made for Cloudflare headroom or storage charges. All jobs in the refresh and rehearsal
workflows use standard `ubuntu-latest` GitHub-hosted runners. This repository is public, so
[that runner execution is free](https://docs.github.com/en/billing/concepts/product-billing/github-actions):
the runtime estimate below is not billable runner minutes or consumption of a private-repository
minutes allowance. Larger runners would be charged even for a public repository; none are selected.
Artifact/cache storage and other service limits remain separate from runner execution and
Cloudflare builds.

Live normal-TLS rehearsal measurements (October 8): fresh daily extraction **89 requests,
115,471,105 response-body bytes, 119.696 seconds**; a combined unchanged check **103 requests,
845,578 bytes, 70.345 seconds**, with unchanged hourly data/receipt bytes and retrieval time.
Recorded reports are `nbm-daily-reliability-recorded.json` and `nbm-combined-noop-recorded.json`.
The first rehearsal correctly isolated a too-strict inventory check as an hourly failure while
daily extraction succeeded; the inventory handling was corrected and the combined check passed.
The earlier authentic full hourly extraction measured 146 requests, 6,408,858 bytes and 410.123
seconds; the new full inventory adds roughly 0.34 MB compared with its old discovery query.
Combining those observations, a planning scenario of 120 paired extractions, 120 eligible no-ops
and 480 closed-window skips is approximately **14.8 GB of NOAA response bodies, 40,560 requests
and 1,200 producer minutes of runtime per 30 days**, before setup/retries—not paid runner minutes
for this public repository on standard runners. This is an estimate assembled
from separate measured runs, not a measured month or a bound. Failed runs can consume their full
budgets without publishing. Git checkout/history transfer, package installation, response headers,
artifact storage, app/preview CI and source revisions are additional. Full history is fetched for
reliable deleted-budget detection; repository growth therefore remains an operational cost.
Artifacts can include both current pairs plus daily history: roughly 6.3 MB per changed artifact
before compression in this rehearsal, about 450 MB if all 72 hourly artifacts were that size.
Account quotas and remaining usage are not verified here; this existing-service release makes no zero-overage promise.

The daily and hourly interfaces say **NBM model range** and use native NOAA P25/P50/P75.
Roughly 25% of modeled outcomes lie below the range and 25% above it; outcomes outside remain possible.
This applies to each hour or native extrema window, not the chance that the whole time series stays inside.
No accuracy improvement or confidence probability is claimed. P50 is the median, not the midpoint of P25
and P75. Daily details preserve explicit native 18-hour windows; hourly details retain exact UTC matching
and Central display time. Percentile definitions and source details remain keyboard/touch accessible. A failed browser check retains validated same-location guidance
with a clear previous-range notice until its original expiry; location reset clears it immediately.

### NWS Key Messages and current local fallback

The hero replaces generated Bottom Line advice with NWS St. Louis (LSX) `.KEY MESSAGES…`
text. This remains an LSX-only dashboard, with its existing location controls and boundaries.
Saved startup coordinates now pass the same live `/points` LSX membership check as shared links
and favorites. The known Lake St. Louis default stays active until that check succeeds, so outside,
unavailable or malformed membership cannot pair another office's local forecasts with LSX messages
and alerts. Unverified saved HTML is not restored; a newer selection supersedes a pending lookup.
The stored choice is retained for a later retry when verification is unavailable.
The LSX product list is sorted by issuance rather than assuming array order. Requests revalidate their HTTP cache, use location cancellation and generation
guards, and reject older overlapping refreshes. Product identity, timestamps, section termination and
bullet formatting must validate before official text is shown. Wrapped decimals, negative temperatures,
geographic qualifiers and source order are preserved. Only whitespace and list markers are normalized.

The card names the regional office, links to its full discussion, and shows **AFD issued** and successful
check times. AFD issuance is not a Key Messages revision clock: aviation-only updates can carry the same
messages forward. An explicit section timestamp, with or without “Issued at”, is retained separately;
otherwise its revision time remains unknown. Messages are withheld after 18 hours of product/explicit
section age or one hour without a successful check. These conservative dashboard limits are not NWS
product expiration rules. The messages and detailed discussion are never restored from saved HTML.

Missing, stale, malformed or unavailable messages change the heading to **NWS Local Forecast**, with a
reason and a link for the selected coordinates. Fallback text is the current official daily period,
or independently verified current hourly period; source issuance must be within 12 hours and check
age within one hour. Saved, expired and unverified forecasts supply no fallback text. Generated
advice is never labeled NWS Key Messages. Local active warnings remain above the regional outlook
and take precedence; the regional bullets keep their geographic qualifiers.

The lower **NWS Forecast Details** card retains short-term/synopsis reasoning without repeating the
hero bullets. NWS Key Messages and its fallback remain independent of native daily/hourly NBM quartiles.
The former optional P10/P90 threshold commentary has been removed; quartiles do not inherit those tail heuristics. Stable disclosures preserve keyboard focus and open state; unchanged live-status
text is not rewritten on unrelated feed checks.

Sources: [LSX AFD](https://forecast.weather.gov/product.php?site=LSX&issuedby=LSX&product=AFD&format=CI&version=1&glossary=1)
and [NWS Central Region AFD section guidance](https://www.weather.gov/media/directives/010_pdfs/pd01005003c102023curr.pdf).
The authentic recorded October 8 afternoon/evening issuances test carried-forward messages at
October 9 01:04 UTC. Tests never refresh or publish NBM data.

Run `node tools/nws-message-tests.js` and
`NODE_PATH=<test dependencies>/node_modules CHROMIUM_PATH=<chromium> node tools/nws-message-browser-tests.js`.
The aggregate check workflow includes the parser suite and Chromium/Firefox/WebKit browser coverage.
Hosted verification uses `tools/nws-preview-tests.js`, default TLS and exact checkout-byte hashes,
including both NBM datasets, receipts and the publication manifest. It checks an immutable PR preview
or the main deployment through the existing push event, without extraction, publication, credentials
or schedule changes. Saved LSX and outside points also exercise actual live membership/alert lookups.
Controlled missing-section checks are reported separately from live weather; expired static NBM
guidance is accepted only when correctly withheld, without rewriting its timestamps.
On the custom domain, Cloudflare can insert its JS-detection bootstrap into HTML. Comparison accepts
only the exact captured bootstrap template immediately before `</body>`, with its ray ID bound to
the response header and a canonical base64 decimal timestamp. All remaining application bytes must
match the release exactly; unknown bootstrap shapes or application changes still fail. Assets and
NBM files remain raw-byte comparisons. The browser receives the original response, including the
Cloudflare script. Recorded hosted captures and negative controls run in `tools/hosted-html-tests.js`.

### Native quartile draft preview

This scoped change replaces the three stored values with native NOAA P25/P50/P75; it does not add
wider percentiles or interpolate the old P10/P50/P90 values. Daily schema 3 (point schema 4), hourly
schema 2, top-level percentile tuples, member/hour tuples and new receipt identities all agree.
Legacy schemas and mixed identities are withheld. Snapshot v22 discards v21; versioned asset URLs
and real HTTP-cache upgrade tests cover retained old JSON. Same-cycle migration requires a real
native extraction, while valid no-ops retain original data, receipts and retrieval timestamps.
The optional threshold sentence and its tail-based API/styles/markup have been removed.

The October 9 00Z preview dataset was extracted once over normal TLS: daily **72 requests,
115,829,780 response-body bytes, 29.966 seconds, 1,244,105 output bytes**; hourly **146 requests,
6,718,439 bytes, 375.318 seconds, 3,819,881 output bytes**. Both include 2,969 native cells;
daily has 18 windows/54 messages and hourly has fixed f001–f048. The explicit-cycle command omits
normal discovery overhead. Historical measurements above used older percentile schemas and
remain historical evidence, not active quartile fixtures. Existing request/byte/runtime/output
limits and the six-hour production publication budget are unchanged. Header/transport, package,
Git and deployment overhead are outside measured response-body counts. Hourly output has only
180,119 bytes of remaining headroom; no five-value payload is introduced.

New authentic recordings are `tools/fixtures/weather/nbm-quartile-*`. Historical wider-percentile
recordings remain unmodified as negative controls. Tests cover old/malformed/mixed schemas,
missing periods, ordering, receipt/cache migration, no-ops/budgets, native daily/hourly alignment,
NWS wording/state, location changes, stale withholding and phone/desktop/200% text layouts.
[Preview provenance and measurements](docs/native-quartile-preview.md) record sampled raw-GRIB
validation and limits. The immutable preview retains actual source timestamps and expires at
October 10 00Z; that expiry is distinct from production refresh failure. This draft does not merge,
activate production refreshes, change permissions, or create services/credentials.
