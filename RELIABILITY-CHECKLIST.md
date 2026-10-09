# Reliability completion evidence

Scope: the accepted October 1 reliability proposal, including individual context disclosures and measured performance work. PR 48's wholesale makeover is not included.

| Requirement | Implementation | Regression evidence |
| --- | --- | --- |
| Internal AQI escalation and model-commentary guards | `aqiInfo`, `bottomLineHourlyCandidates`, `buildBottomLine`; poor AQI suppresses favorable outdoors/ventilation; urgent storm warnings suppress conflicting comfort support | Category boundary logic; hazardous AQI 325; night storm warning; heat/wind/winter scenarios |
| Timestamp timeline and gaps | `forecastWindowHours`, timestamp-based SVG positions and broken segments; incomplete coverage limits favorable claims | Missing-hour spacing and advice; DST; 24/48/72-hour controls |
| Independent forecasts | `validatedForecast` filters malformed periods; separate daily/hourly success state and rendering | Daily HTTP failure and malformed daily periods preserve hourly; malformed/empty/elapsed hourly preserve daily |
| Saved startup remains in LSX | `initLocation` uses existing verified selection and generation guards; the local default remains active until membership succeeds | In-area, outside, unavailable/malformed lookup, pending lookup superseded by a favorite, unverified snapshot exclusion, local alert scope and normal startup at 390/1280px in three browser engines |
| River observation vs retrieval age | `riverObservationState`; 2-hour observation tolerance (multiple reporting cycles), separately labeled successful checks; 48-hour forecast issuance limit | Missing/stale observations and old forecast issuance; crest/rising/falling scenarios |
| Date-matched climate | Separate historical-record queries and derived cache entries for today/tomorrow; forecast-date selection in context and briefing; weekly normals; location/request/date guards and Central midnight refresh | Actual fetched tomorrow record displayed; year-end/leap day; partial outage; cache; superseded/location/midnight races; next-day refetch; multiple browser timezones |
| Retained warnings | `liveAlertFeatures`, `renderRetainedAlerts`; last-verified notice on both warning list and radar (including fullscreen), original expiration, cancellation/new-warning uncertainty; map and briefing retire expired evidence | Outage, retained local warning, expiry, recovery |
| Hourly navigation | Sticky Hourly link | Narrow navigation and duration controls |
| Missing alerts/AQI affects recommendations | `briefingComfortAllowed`, prominent `briefStatus` | Unknown exposure and alert outage scenarios; no favorable comfort advice |
| Optional compact everyday view | `dashboard-context.js`: individual context disclosures; redundant global Compact context removed by request; climate navigation opens its disclosure; warnings/current/NWS messages/radar/hourly remain prominent | 320/390/1280px individual touch toggles, focus, overlap and overflow checks; saved-content reload stays accessible; default stays expanded |
| Map recovery | Bounded request adapter, retryable style/time metadata and script/CSS dependencies; reachable retry controls; tile-health badge | Real libraries with controlled map styles/tiles: timeout, outage/retry, loaded print-only CSS with healthy scripts, WebGL teardown/retry, animation and tile failures |
| Fullscreen accessibility | Dialog role/name, inert background, focus trap, Escape and focus restoration | Keyboard traversal; touch open/close; targeted Firefox/WebKit CI |
| Measured safe deferral | Demand state for station requests/map and deep climate records, 300px approach observer and explicit opening; current/basic climate remain immediate | `tools/context-performance.js` paired controlled phone-sized experiment; deferred approach/request regression |
| Focused modularization | Pure decisions in `weather-core.js`, loaders in `weather-feeds.js`, explicit validated daily payloads into `forecast-view.js`; optional context state in `dashboard-context.js` | Static syntax/CSP checks, logic and production-page browser suites |
| Broader regression coverage | Chromium full suite plus targeted Firefox and Playwright WebKit CI matrix | See final CI run and JSON artifacts |

## Validation limits

Browser scenarios intercept external requests. Real pinned Leaflet/MapLibre libraries render controlled styles and PNG tiles; weather scenarios are synthetic plus one recorded LSX replay. They do not establish live upstream availability. Playwright WebKit is not a real Safari run. The performance experiment uses an emulated 390x900 viewport, CPU throttling and controlled latency, not a physical phone. Its paired request counts show avoided startup work; wall-clock timings are illustrative and not a live performance promise.

## Performance experiment

Run `NODE_PATH=<test dependencies>/node_modules CHROMIUM_PATH=<chromium> node tools/context-performance.js`. Five alternating pairs compare fresh contexts with only initial demand state changed. Both receive identical controlled payloads, pinned map libraries, 4x CPU throttling and 80ms per external request. Output separates request/observation/ACIS counts, station map allocation, and readiness wall time. Historical results from PR 49's isolated cloud Chromium run (five pairs): median startup requests fell **138 → 119** (15 station observations and 4 deep-climate requests deferred); the second map was not allocated before demand. Median DOM nodes fell **4,415 → 3,093**. Median controlled readiness was **2,565 → 2,383 ms** (about 7%); timing is secondary evidence in this synthetic environment. Current/hourly weather and the radar were ready in every sample. The on-demand regression additionally checks all 15 station markers after approach. The JSON sample data is in `tools/fixtures/context-performance.json`.

The follow-up adds one deferred historical-record query. Five new controlled pairs confirm startup requests **139 → 119** (15 station observations and 5 deep-climate requests deferred), with current/hourly weather and radar ready in each sample. See `tools/fixtures/context-performance-followup.json`. This run overlapped another browser suite, so its wall-clock timings are not used to claim a speed improvement; the earlier isolated timings above describe the PR 49 version.

## All-season stress coverage

`tools/seasonal-tests.js` exercises 2,880 deterministic temperature × humidity × wind × AQI combinations, rotating condition types and seasonal/DST/year-boundary dates. Assertions cover finite bounded feels-like values, deterministic priority regardless of candidate order, AQI escalation, strong wind, heat, dangerous wind chill, winter classification, fog, and suppression of conflicting favorable advice. Explicit boundary cases cover later hazardous precipitation, flash freezes, missing wind, delayed hourly starts, and official alerts that disagree with otherwise benign modeled conditions. The separate accumulation suite supplies 2,000 generated cases with an independent oracle and inches/mm/cm units.

Browser scenarios additionally cover fair weather in each season; humid/dry extreme heat; blizzard, sleet, freezing rain and a near-freezing transition; extreme cold/wind chill; damaging wind; afternoon fog; wildfire smoke; compound heat/smoke/tornado; drought; future observation timestamps; old/missing/future AQI timestamps; fresh alert expiration and cancellation; contradictory frozen-precipitation feeds; and local wind/fog/smoke alerts with benign forecasts. Earlier scenarios cover heavy rain, flash/river flooding, severe storms, mixed winter accumulations, observation/endpoint outages, source mismatch, midnight and DST. Assertions check guidance and warning meaning, accumulation labels/totals, chart controls, map evidence, and sane visible numbers. These are representative scenarios and defined invariants, not exhaustive proof for every real weather event.

### Independent audit follow-through

| Reproduced concern | Resolution | Evidence |
| --- | --- | --- |
| Hourly feed starts four hours ahead but says rain now | Leading coverage gap blocks unqualified comfort; wet timing uses the actual first timestamp | Seasonal helper and browser leading-gap tests |
| Rain first hides later freezing/snow/storm rounds | Later hazardous round receives its own candidate and timestamp | Explicit rain → break → thunder/snow/freezing-rain assertions |
| Afternoon/evening cold disappears when next morning is mild | Any-hour freezing cue; severe feels-like cold has explicit priority and exposure guidance | Flash-freeze helper and extreme-cold browser scenario |
| High Wind Warning with calm model still endorses outdoors | Conflicting official wind/heat evidence and fog/smoke alerts constrain favorable advice | Helper and browser conflicting-alert cases |
| Missing nighttime wind certifies ventilation | Unknown wind prevents favorable open-window guidance | Missing-wind boundary assertion |
| AQI HTTP success makes yesterday's value current | Source observation timestamp required, at most two hours old and no more than ten minutes ahead; retrieval time remains separate | Missing/old/future AQI browser cases |
| Fresh alerts use event end beyond message expiration | Both fresh and retained evidence use earliest end/expiration; clock expiry retires list, briefing and map evidence | Fresh and retained earlier-expiration browser tests |

The seasonal expansion also corrected blizzard classification, visibility guidance outside morning hours, and zero-QPF/positive-frozen-amount contradictions. Individual context disclosures observe actual card size changes and disclosure visibility to keep asynchronously refreshed cards packed correctly.

## Follow-up reconciliation

PR 49 initially suppressed mismatched tomorrow/today record comparisons but did not fetch tomorrow's historical record, and its CSS retry missed already-loaded print-only styles when scripts were healthy. The earlier completion claim was too broad. The follow-up implements both missing paths. Two new assertions were run against merge `8d3ae35` and failed for the expected visible reasons (today's 90° record instead of tomorrow's 100° record; both styles still `print`); they pass with the fixes. Cache version v4 prevents reuse of the old single-date schema. Leap-day query start dates use a valid leap year.

The global Compact context control had no persisted setting in the shipped version; its state was only a DOM attribute. It and its handler/styles are removed. Individual controls remain accessible, default to expanded on reload, and retain demand loading and navigation behavior. A snapshot/reload regression verifies previously collapsed content remains accessible.

## Mobile map startup investigation and bounded bootstrap

A controlled indefinitely pending initial CDN script reproduced the iPhone screenshot's empty map, no controls/Retry, and otherwise populated hourly weather on both PR 49 and PR 51. After 90 simulated seconds, `mapsCanStart` remained false because deferred scripts blocked `DOMContentLoaded`. This establishes an older unbounded startup mechanism, not which request or browser condition caused the actual iPhone incident. The CDN URLs/integrity attributes did not change between those releases. Cloud live requests were proxy-blocked, so that environment cannot establish an upstream outage.

Map script tags are now inert descriptors. One ordered loader performs abortable CORS downloads with the existing SRI hashes, executes verified bytes only for the active attempt, and bounds each download at 20 seconds. Context initialization no longer waits on third-party scripts. Existing CSP inline-script permission is unchanged; the two already trusted script hosts are also permitted in `connect-src` for these checked downloads. CSS/style and WebGL failures retain bounded retry/fallback behavior. Loading/unavailable status replaces healthy-looking pre-initialization controls; local expandable diagnostics identify dependency, host, elapsed time and stage without telemetry.

New browser assertions exercise production CSP, deliberately mismatched integrity, repeated stalled downloads, retry, late response rejection, single map allocation, loaded tiles, controls and touch fullscreen. Normal CDN/CSS/WebGL recovery remains covered. The station-map review's proposed hidden touch-lock symptom does not apply to current markup (there is no such wrapper); browser recovery asserts its zoom controls and absence of a failed-state ancestor. The actual iPhone trigger remains unverified; if it recurs, expand **Map diagnostics** and share its text to identify the failed dependency/stage.

The diagnostic disclosure remains available below the map even if initialization claims readiness; it reports library presence, DOM readiness, pane/control/loaded-tile counts, and exact dependency URLs/stages. Firefox CI initially reported `AllowWebgl2:false`; it now uses a virtual display and software rendering to exercise actual WebGL map recovery. WebKit's intentional integrity-rejection error is asserted narrowly rather than treated as an unexpected application exception.

## Cached upgrade reconciliation

Production HTML revalidated immediately, but unchanged local JS/CSS URLs were served with `max-age=14400`. A real HTTP-cache reproduction primed with PR 49 assets then received new HTML: the old context handler dereferenced the removed Compact context button, leaving empty radar, blue layer buttons and no diagnostics. The same-phone Private Browsing success supports this explanation, though the actual phone exception was not captured. This is distinct from the separately reproduced deferred-CDN startup hang.

All root HTML references to local JS/CSS now include SHA-256 content versions. Run `python3 tools/version_assets.py --write` after editing those assets; `python3 tools/check.py` rejects missing/stale versions. Script order and third-party SRI remain unchanged. `/assets/*` explicitly uses `Cache-Control: no-cache, max-age=0, must-revalidate`; new version URLs also bypass copies already fresh under the old four-hour policy. There are no dynamic local imports or service workers in the current app.

`tools/cache-upgrade-tests.js` uses an actual HTTP server/cache without Playwright routing. Its negative control reproduces the old null-handler failure without any new asset request. The corrected case must fetch all six versioned assets, avoid the handler exception, initialize diagnostics and controls, and render actual radar tiles. External map libraries/data and ancillary outages are controlled; local cache behavior is real. The historical baseline is pinned to `f8976ef0d8101528cec520ff886bb278096f271c`, so the browser CI checkout fetches history. No saved browser data is removed. An already-open old document still needs an ordinary reload to request the new HTML.

The explicit `no-cache` directive requires validation even where a Cloudflare Browser Cache TTL raises the numeric max-age; see [Cloudflare Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/). Production response headers are checked after deployment.
