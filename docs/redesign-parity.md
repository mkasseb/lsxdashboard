# LSX visual redesign — pre-edit parity checklist

Baseline: remote main `17d4971e368ddc9cd5d91fed200be3a47f6be138`, fetched October 2, 2026. No AGENTS.md or checkout skill files were present. This inventory was prepared before implementation.

The original and repaired Library references could not provide image pixels in this executor. The user explicitly approved implementation from the parent's detailed visual specification; the parent will compare the screenshots against the original images. This is specification-driven, not a claim of pixel matching.

All rows below are implemented with original IDs and controls retained. The old decorative Right now rail is removed; its location hook remains available to screen readers. All static external links are retained. The weather decision core and forecast calculation/rendering module are unchanged.

| Existing feature / hooks | Proposed placement | Parity contract / verification |
|---|---|---|
| Header refresh/status, clock/date, themeBtn | Compact header | Manual and scheduled refresh; clock uses Central time; auto/light/dark persistence and contrast |
| geoBtn, locForm, locSearch, locSug, locNow, locFeedback | Compact location row | Search keyboard/listbox, geolocation, validation, feedback, rapid location changes and late responses |
| locationTools, favoriteToggle/Select/Remove, shareLocation, locationLink | Existing individual location disclosure | Save/remove/select favorites; copy/share URL; URL precedence and validation; persisted state |
| jumpNav, stickyLocation/stickyKind, jump-step buttons | Clear sticky navigation | Active section after repack/disclosures, scrolling overflow buttons, anchor offset, focus and keyboard |
| alertsCard, alerts, alertUpdateNote, mcd | Prominent above hero | Every alert, coverage ordering, disclosures, expiry, retained-unverified warnings, official links and short-fused discussions |
| currentCard/current/ccStation, callCard/callRow/callHorizon | Coherent Now and Bottom Line hero | All current readings, station and age; generated guidance labels; unchanged thresholds and advice |
| briefPlanning, briefWhy, briefEvidence, briefStatus | Individual hero disclosures | Later-week content, source evidence and missing-source cues; independent open states across refresh |
| h24Card, hourlyOptions, precipEvents, hourly24 | Beside radar desktop; above radar mobile | 24/48/72 switches, chart/slider keyboard/touch, selected timestamp and focus retention, gaps, amounts and event horizons |
| radarCard, rsTabs, rsFull, rsRadar, radar, radarPlay/Slider, rsLegend/rsWarnKey/rsCap | Generous radar pane | Actual rendered tiles/panes, layer toggles, pan/zoom/touch lock, playback/scrub, legends, fullscreen focus/Escape, diagnostics and official link |
| Radar/station map bootstrap and per-layer recovery | Existing map surfaces | Initial failure, bounded startup, retry, late scripts/styles, WebGL fallback, tile outage, stale/pending source cues |
| forecastCard/daily | Compact seven-day below hourly; full-height radar beside both | All daytime/nighttime periods, details and links; no horizon reduction or clipped content |
| aqiCard/aqi | Lower local context | AQI/UV values, guidance, attribution, ages, unavailable state and AirNow link |
| afdCard/afd | Lower official discussion | All NWS-authored content, individual disclosures and full discussion link; generated-vs-NWS distinction |
| riskCard/spc/spcThreats/riskHelp | Retained lower context | Storm/flood/fire, tornado/wind/hail, every period and explanation, touch/keyboard behavior, attribution |
| hazardsCard/hazards/hazIssued | Retained lower context | All days 3–14 hazards, issue ages and official link |
| obsCard/stnTools/stnmap/stnEx/stnAge | Retained lower context | Temp/feels/dew/wind modes, station detail, map controls, source ages and recovery |
| riversCard/rivers/qpf7 | Lower river context | Distinct Now and Forecast peak labels without computation changes; flood thresholds, freshness, trends, forecast window/crest distinction, pins and NWPS links |
| droughtCard/drNow/drMonth/drSeason | Retained lower context | Current/monthly/seasonal data and official links |
| climateCard/cnToday/cnGrid/cnSrc/cnCtx/cnStation | Retained lower context | Normals, records, rankings, precipitation/dry streaks, sample gates, forecast date alignment and midnight retirement |
| cpcCard/cpc | Retained lower context | Every outlook horizon, confidence, provenance and links |
| linksCard and footer | Retained lower reference area | Every deep-dive, licensing and official source link; lastUpdate |
| snapBar and per-feed FEEDS states | Same relevant surfaces | Saved snapshot TTL, partial/full outage, timeouts, source timestamps separate from check times; bump SNAP_KEY if fragment shape changes |
| Six versioned JS/CSS assets and _headers | Existing repository workflow | Run tools/version_assets.py for edits, check hash/version integrity, real HTTP-cache old-to-new upgrade regression |
| Accessibility and individual disclosures | Across every layout | Semantic headings/landmarks, native DOM hooks, tab order aligned with visual order, independent disclosure persistence; do not add global Compact context control |

## Validation

- Baseline before edits: static checks, logic, 2,880 seasonal combinations, 145 Chromium weather cases (including 2,000 accumulation oracle cases), and real-cache upgrade all passed.
- Redesigned static/hash, logic and seasonal suites: passed.
- Redesigned full Chromium weather suite after layout repair: 145 passed, 0 failed. The final weather rerun also passed 145/145 before the last navigation-only refinement and snapshot cleanup; exact-commit CI runs the suite again.
- Redesigned Chromium real-cache upgrade: passed. Negative control reproduces stale-script blank radar; versioned upgrade fetches all six assets and renders map tiles/controls/diagnostics.
- PASS: all 24 cases in `tools/redesign-tests.js`: phone 320/390, tablet 768, desktop 1024/1180/1440/1920 in dark/light; card inventory, geometry, daily keyboard disclosures, hourly period/slider/focus retention, advice disclosure, navigation after repack, river labels, page/card bounds, palette contrast and JS errors. Screenshots are explicitly labeled deterministic QA fixtures.
- Existing suite additionally covers all-season hazards/advice, missing/pending/stale/saved sources, map rendered panes/tiles, startup timeout/retry/late completion, map style/tile failures, fullscreen focus, playback, touch, location/favorites/sharing, dates and repeated refresh.
- Firefox/WebKit are unavailable locally. Installation failed with HTTP 403 `Domain forbidden` at browser download hosts. Existing CI matrix and the added layout suite cover these browsers on GitHub; record exact-commit results in the PR. WebKit browser testing is not physical iPhone Safari validation.

## Diagnosed regressions and fixes

- Light-theme weather artwork retains its natural colors. A fine contour separates pale artwork from the card; rendered-pixel tests check readable boundaries while a golden-fill assertion prevents brown suns.

- WebKit event tracing exposed transient overlap during deferred content growth: pointer-down hit the records panel while pointer-up hit the intended risk summary. Content mutations now repack before the next paint; a regression test fails on the delayed implementation and passes on the fix. Repacking also waits until a held pointer completes its native click.

- Removed top/left travel animations on repacked context cards: targets must not travel between touch-down and click while another card loads or collapses.
- The old `.grid` start alignment collapsed the newly flex-based lower container, causing narrow probability cells and moving controls. Explicit stretch alignment fixes it; focused overflow/disclosure tests pass.
- Snapshot-key tests now seed/assert v20 because river presentation labels changed. No calculation changed.
- Active navigation now accounts for the anchor scroll margin and side-by-side target ties, and updates after masonry/disclosure changes.

## Deliberate differences from the illustrative concepts

- All observation metrics, UV/AQI exposure guidance and associated source freshness remain visible. The hero is taller than the simplified mockup, especially on phones.
- All seven original navigation destinations, search, favorites/sharing, refresh and theme controls remain. The header uses compact rows rather than removing destinations to match a four-item sample navigation.
- Hourly retains all 24/48/72-hour chart interactions, accumulation details and source states, so its card is taller than the six-hour illustration.
- Forecast rows retain temperature ranges and expandable complete forecast details, rather than flattening them into a static sample table.
- Lower context retains every card and the existing individual expanded/collapsed behavior. No global Compact context control exists.
- After actual Mac Safari review, hourly and compact seven-day stack in one desktop column. Successful radar fills the adjacent column; no separate map aspect ratio can create a dead band above seven-day. Rows keep at least 44px touch targets. A confirmed startup failure uses a compact error/retry panel above seven-day on the right, avoiding a tall empty fallback. Retry restores the full-height map. Mobile/tablet ordering remains hourly, radar, seven-day.
- River rows retain full-width name, Now and forecast detail.
- Successful Chromium map evidence: 807px rendered map height at 1180px, 889px at 1440/1920px, with loaded tiles in both themes; radar/week bottom difference 0px and hourly/week gap 16px. Exact geometry and tile counts are retained in CI layout reports.
- Tests explicitly assert successful rendered tile height and card bottom alignment, compact forecast rows, and separate failure/retry layout at 1180/1440/1920 plus phone/tablet in both themes.
- River rising endpoints are labeled peak **in window** and retain “rising to”; falling forecasts are labeled **Forecast trend**, never a false crest.
- No sample values or QA labels are included in production assets. QA screenshots use controlled map tiles; live upstream availability needs the branch preview.

## Release boundary

Draft PR and branch preview only. No merge or production deployment is authorized. Parent visual comparison remains part of review.

## Light-mode icon refinement

Removed the dark seven-day icon badge while retaining its dimensions and all row spacing. Natural golden sun, blue moon and pale cloud/snow fills are preserved; a fine light-theme contour provides separation from the card without blanket brightness filters. Dark-mode artwork, condition mappings, animation, alternative text and CDN fallbacks remain unchanged. `tools/icon-theme-tests.js` renders 23 actual SVG variants, verifies transparent slots and visible 3:1-contrast pixels, requires bright golden sun pixels, checks unknown-state fallback semantics, and captures light/dark galleries at 390, 768 and 1440px. MIT-licensed artwork fixtures are test-only.

The focused palette audit covered text, temperature labels from −10 to 95°F, hourly chart lines/bars, and semantic status colors in both themes. Primary/muted/accent/status text has at least 5.06:1 contrast on its card background; the sampled temperature text has at least 6.46:1. The chart retains its existing temperature hue ramp and cyan precipitation encoding. Official hazard colors are unchanged. Existing readable text and status colors were retained instead of expanding this correction into another palette redesign.

## Radar camera centering regression

Forecast reset/repaint changes the stretched desktop map height while selecting a location. Leaflet's animated recenter could retain its old pixel destination across those resizes, leaving the correct marker below the full-canvas center. The location-change path now refreshes the measured size and sets the new camera without animation. Resize, scrolling and ordinary feed refresh do not recenter the map, preserving deliberate pan/zoom. The radar dimensions/layout remain unchanged; full-canvas centering is distinct from the visible portion of a tall map on a scrolled page.

`tools/radar-camera-tests.js` checks rendered marker/canvas and MapLibre/Leaflet camera geometry at 1180/1440/1920px, saved-location startup, asynchronous geolocation, selected towns, content/window resizing, scrolling, fullscreen, user pan/zoom and fallback/retry using the latest point. The original camera implementation fails the same regression, while the fixed implementation keeps the selected marker within two rendered pixels of center.
