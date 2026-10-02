# PR 49 completion evidence

Scope: the accepted October 1 reliability proposal, including compact context and measured performance work. PR 48's wholesale makeover is not included.

| Requirement | Implementation | Regression evidence |
| --- | --- | --- |
| Shared AQI escalation and consistent advice | `aqiInfo`, `bottomLineHourlyCandidates`, `buildBottomLine`; poor AQI suppresses favorable outdoors/ventilation; urgent storm warnings suppress conflicting comfort support | Category boundary logic; hazardous AQI 325; night storm warning; heat/wind/winter scenarios |
| Timestamp timeline and gaps | `forecastWindowHours`, timestamp-based SVG positions and broken segments; incomplete coverage limits favorable claims | Missing-hour spacing and advice; DST; 24/48/72-hour controls |
| Independent forecasts | `validatedForecast` filters malformed periods; separate daily/hourly success state and rendering | Daily HTTP failure and malformed daily periods preserve hourly; malformed/empty/elapsed hourly preserve daily |
| River observation vs retrieval age | `riverObservationState`; 2-hour observation tolerance (multiple reporting cycles), separately labeled successful checks; 48-hour forecast issuance limit | Missing/stale observations and old forecast issuance; crest/rising/falling scenarios |
| Date-matched climate | Forecast high/low dates, record date and weekly normals; Central midnight invalidation | Tonight/tomorrow vs today's record; midnight; multiple browser timezones |
| Retained warnings | `liveAlertFeatures`, `renderRetainedAlerts`; last-verified notice on both warning list and radar (including fullscreen), original expiration, cancellation/new-warning uncertainty; map and briefing retire expired evidence | Outage, retained local warning, expiry, recovery |
| Hourly navigation | Sticky Hourly link | Narrow navigation and duration controls |
| Missing alerts/AQI affects recommendations | `briefingComfortAllowed`, prominent `briefStatus` | Unknown exposure and alert outage scenarios; no favorable comfort advice |
| Optional compact everyday view | `dashboard-context.js`: context disclosures, compact control, climate navigation opens its disclosure; warnings/current/briefing/radar/hourly remain prominent | 320/390/1280px touch, focus, overlap and overflow checks; default stays expanded |
| Map recovery | Bounded request adapter, retryable style/time metadata and script/CSS dependencies; reachable retry controls; tile-health badge | Real libraries with controlled map styles/tiles: timeout, outage/retry, CSS recovery, animation and tile failures |
| Fullscreen accessibility | Dialog role/name, inert background, focus trap, Escape and focus restoration | Keyboard traversal; touch open/close; targeted Firefox/WebKit CI |
| Measured safe deferral | Demand state for station requests/map and deep climate records, 300px approach observer and explicit opening; current/basic climate remain immediate | `tools/context-performance.js` paired controlled phone-sized experiment; deferred approach/request regression |
| Focused modularization | Pure decisions in `weather-core.js`, loaders in `weather-feeds.js`, explicit validated daily payloads into `forecast-view.js`; optional context state in `dashboard-context.js` | Static syntax/CSP checks, logic and production-page browser suites |
| Broader regression coverage | Chromium full suite plus targeted Firefox and Playwright WebKit CI matrix | See final CI run and JSON artifacts |

## Validation limits

Browser scenarios intercept external requests. Real pinned Leaflet/MapLibre libraries render controlled styles and PNG tiles; weather scenarios are synthetic plus one recorded LSX replay. They do not establish live upstream availability. Playwright WebKit is not a real Safari run. The performance experiment uses an emulated 390x900 viewport, CPU throttling and controlled latency, not a physical phone. Its paired request counts show avoided startup work; wall-clock timings are illustrative and not a live performance promise.

## Performance experiment

Run `NODE_PATH=<test dependencies>/node_modules CHROMIUM_PATH=<chromium> node tools/context-performance.js`. Five alternating pairs compare fresh contexts with only initial demand state changed. Both receive identical controlled payloads, pinned map libraries, 4x CPU throttling and 80ms per external request. Output separates request/observation/ACIS counts, station map allocation, and readiness wall time. Results from the isolated cloud Chromium run (five pairs): median startup requests fell **138 → 119** (15 station observations and 4 deep-climate requests deferred); the second map was not allocated before demand. Median DOM nodes fell **4,415 → 3,093**. Median controlled readiness was **2,565 → 2,383 ms** (about 7%); timing is secondary evidence in this synthetic environment. Current/hourly weather and the radar were ready in every sample. The on-demand regression additionally checks all 15 station markers after approach. The JSON sample data is in `tools/fixtures/context-performance.json`.


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

The seasonal expansion also corrected blizzard classification, visibility guidance outside morning hours, and zero-QPF/positive-frozen-amount contradictions. Compact context observes actual card size changes and disclosure visibility to keep asynchronously refreshed cards packed correctly.
