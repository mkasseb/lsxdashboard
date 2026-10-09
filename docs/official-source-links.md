# Official outlook links

The dashboard's outlook links open the latest official product in a separate tab. These are
rolling products: a saved dashboard view can be older than the official page. CPC period pages
contain both temperature and precipitation maps, their legends, valid dates and discussion;
links intentionally retain that context instead of opening a bare image.

## Source inventory

Verified 2026-10-07 against the official pages:

| Dashboard target | Official destination | Verification |
| --- | --- | --- |
| CPC 6–10 day temperature and precipitation tiles | https://www.cpc.ncep.noaa.gov/products/predictions/610day/ | Page identifies 6–10 day outlooks and both probability maps. |
| CPC 8–14 day temperature and precipitation tiles | https://www.cpc.ncep.noaa.gov/products/predictions/814day/ | Page identifies 8–14 day outlooks and both probability maps. |
| Drought: Now | https://droughtmonitor.unl.edu/CurrentMap.aspx | Current U.S. Drought Monitor map from the product publisher (NDMC/USDA/NOAA). National coverage includes both Missouri and Illinois. |
| Drought: Month ahead | https://www.cpc.ncep.noaa.gov/products/expert_assessment/mdo_summary.php | Monthly Drought Outlook graphic and assessment. |
| Drought: Season (3 mo) | https://www.cpc.ncep.noaa.gov/products/expert_assessment/sdo_summary.php | Seasonal Drought Outlook graphic and assessment. |
| Hazards: Days 3–7 | https://www.wpc.ncep.noaa.gov/threats/threats.php | CPC's official hazards page explicitly links here as “WPC 3-7 Day Hazards”. Direct retrieval returns HTTP 403 in this environment; destination identity is verified through CPC, not a successful WPC page load. |
| Hazards: Days 8–14 | https://www.cpc.ncep.noaa.gov/products/predictions/threats/threats.php | CPC Week-2 Hazards Outlook with composite days 8–14 map and valid period. |

The existing CPC and WPC heading links now explicitly name their respective 6–10 and 3–7 day
periods; neither heading claims to cover the longer-period row.

## Interaction and scope

CPC tiles are native anchors, with the leaning/probability attached as an accessible description.
Drought and hazards period labels are independent native anchors; their values remain readable.
Each new link has an underlined blue label, visible external arrow, at least 44px target height,
keyboard focus outline, an accessible new-tab notice, `target="_blank"` and
`rel="noopener noreferrer"`. No click listener intercepts card content. Existing disclosure
buttons remain separate and retain their behavior. Source links remain available when feed
queries fail. The rendered snapshot version advances to v21 so old unlinked fragments cannot
be restored over the new presentation; local asset hashes advance as well.

Other candidates reviewed:

- Radar/satellite, river gauge rows, forecast discussion, mesoscale discussions, station observations,
  air quality and climate already expose source links; these remain intact.
- Risk pills and severe-weather probabilities provide interactive explanations. They remain
  explanation controls, avoiding nested links or ambiguous tap behavior. The existing SPC map
  link remains available.
- Hourly cursor/options, expandable seven-day rows, location search/favorites, river pins and
  map controls keep their existing tasks. Dashboard-generated Bottom Line guidance has no
  equivalent official product to link as its source.

## Verification

`tools/source-link-tests.js` tests all fifteen anchors' exact destinations, names, security
attributes, accessible CPC descriptions and target sizes. It activates each link with actual
Enter/Tab navigation on tablet/desktop and touch on phones, confirms the new tab has no opener,
checks independent disclosure behavior and refresh/outage states, checks saved markup, and
checks horizontal overflow at 320/390/768/1280px in both themes. External navigations are fulfilled
by a fixture; they test browser behavior, not upstream availability. This suite runs in the
existing Chromium/Firefox/WebKit CI matrix.

Run with the browser dependencies installed outside the static app:

```sh
NODE_PATH=/path/to/node_modules CHROMIUM_PATH=/usr/bin/chromium node tools/source-link-tests.js
```

Set `SOURCE_LINK_ARTIFACTS` to save fixture screenshots of the three changed cards. Existing
static/syntax checks, logic, seasonal, full weather scenarios, redesign layout and real-cache
upgrade suites remain applicable. There is no build, TypeScript typecheck or separate lint
configuration: the repository serves plain assets, and `tools/check.py` performs its supported
static and JavaScript syntax checks.

## Contextual resources (October 9, 2026)

The bottom Deep-Dive Links card is retired. Its unique destinations are small underlined links
in their related cards, with native keyboard/touch activation and 44px minimum target height.
Winter and aviation resources start hidden in a native More weather resources disclosure after
the context cards. The disclosure survives feed refreshes and supports Enter, Space and touch.
It starts collapsed on a new page load. New-tab links use `noopener noreferrer` and accessible
notices. Lightning is explicitly attributed to the Blitzortung community network.

| Location | Destination | Live verification on October 9 |
| --- | --- | --- |
| Risk Outlook | https://www.spc.noaa.gov/exper/mesoanalysis/ | Existing official SPC URL; indexed primary-page title identifies SPC Mesoanalysis. Direct retrieval returned 403 here; live page availability is unverified. |
| Precipitation amounts | https://www.wpc.ncep.noaa.gov/qpf/qpf2.shtml | Existing official WPC URL; indexed primary-page title identifies Day 1 Quantitative Precipitation Forecasts. Direct retrieval returned 403 here; live page availability is unverified. |
| Radar | https://map.blitzortung.org/#7/38.7/-90.4 | HTTP 200; live community lightning map. Existing map view retained. |
| Climate vs Normal | https://www.weather.gov/lsx/climate | HTTP 200; NWS St. Louis local climate page. |
| More weather resources | https://www.weather.gov/lsx/winter | HTTP 200; LSX Snow and Ice Potential Forecasts. |
| More weather resources | https://aviationweather.gov/gfa/#obs | HTTP 200; Aviation Weather Center GFA. Existing observations view retained. |

The full discussion links in NWS Key Messages and NWS Forecast Details, Drought Outlook's
national current map, and the river card's NWPS link keep the duplicate destinations available.
The Missouri-only drought shortcut is removed so Illinois selections retain national coverage.
The national drought and NWPS pages both returned HTTP 200. All live requests used normal TLS;
browser popup tests use navigation fixtures and do not assert upstream page availability.

Only static card surroundings change, so snapshot v22 and native quartile data remain unchanged.
Source-link tests additionally cover the six moved links, initially collapsed resources, duplicate
removal, refreshed precipitation/outlook/discussion markup, outages and restored snapshots.
Layout tests cover the shorter page's final-section navigation after late content growth.
Set `SOURCE_LINK_ARTIFACTS` to capture the related cards and the expanded resource disclosure.

The existing read-only hosted-verification job also runs for this draft branch. Its NWS verifier
compares the exact deployed app and both NBM datasets/receipts/publication manifest to the PR
commit before checking live integration. `tools/weather-resources-preview-tests.js` then checks
the immutable HTTPS preview at 390/1440px in both themes, saves collapsed/expanded screenshots,
verifies static destinations and native disclosure behavior, and tests opener-free native popups
with clearly labeled navigation fixtures. Default TLS validation remains enabled. Artifacts are
saved in the existing hosted-verification upload. Production refresh events, schedules, data,
workflow permissions and external credentials are unchanged.
