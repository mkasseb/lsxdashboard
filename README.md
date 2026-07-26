# LSX Weather Command

A one-page weather dashboard for the **NWS St. Louis (LSX) County Warning Area** — alerts, radar,
forecasts, river gauges, and climate context for a location inside the CWA.

Not an official NWS product. During severe weather, defer to official warnings and a NOAA Weather Radio.

## What it is

One file. [`index.html`](index.html) is the entire application: ~840 lines of CSS, ~265 lines of
markup, and ~3,900 lines of JavaScript, all inline.

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
| `data.rcc-acis.org` | 1991–2020 normals, daily records, rankings, dry streaks |
| Open-Meteo | Air quality, UV index, and the location geocoder |
| NESDIS / GOES-19 | Satellite imagery |

Basemap © CARTO & OpenStreetMap contributors. Weather icons by
[Meteocons](https://github.com/basmilius/weather-icons) (Bas Milius, MIT).

## How it fits together

The script is sectioned by `/* ==== BANNER ==== */` comments and reads top to bottom: config →
helpers → ~15 per-card loaders → derived renderers → orchestration → scheduler → layout engine.

A few things are load-bearing and worth understanding before changing anything:

**The page is ordered by what a visitor came for.** Alerts first (in calm weather that card
collapses to a single all-clear line), then the Bottom Line, then the hero band — "Now & Next 24
Hours" on the left, radar on the right — then the forecast discussion, and finally the masonry.
The Bottom Line (né The Call; ids are still `callCard`/`callRow`) is the page reasoning on the
visitor's behalf rather than handing them numbers: rain/storm windows, heat and cold, UV with a
burn clock, wind, air quality, a temperature-crash warning, climate records — and one synthesized
verdict that scores every daylight hour on comfort, rain risk and wind to name the best two-hour
window to be outside, spoken only when the day has adversity worth dodging. It ranks directly
under safety. Storm Mode is the one exception: an `order` drops it below the hero, because while
a warning is live the radar outranks advice.

`.railhead` labels name each band and hide under `body.storm`, where the grid reorders for urgency
and a band label would lie about what follows it. Only *direct* grid children get an `order`, so
cards that live inside a `.stack` (the 24-hour chart, the radar) ride up with the stack rather than
carrying their own — a rule worth remembering, because an `order` on a nested card is silently a
no-op.

**The hero card is two loaders in one card.** `#current` (the reading, today's range with "now"
marked inside it, sun times) and `#hourly24` (the 24-hour chart) are *siblings* inside
`#currentCard`, never nested. `loadCurrent()` rebuilds `#current` wholesale — including on failure
— so nesting the chart inside it would let a dead observation feed take the forecast chart down
with it, breaking the rule below. The chart measures its own container and thins its labels, so it
survives the narrower column; it shows ~6 hour labels there against ~24 at full width, with
per-hour detail still available on hover.

**The hero row is a pair of stacks, but only on wide screens.** Left is the conditions card (+ AQI
when it's notable); right is the radar. Below 1100px they stop being a pair and both go full width:
at ~474px per column the left one still had to carry the reading, the metrics grid and the 24-hour
chart while the right had only the radar, so they came out ~400px apart *and* both were cramped —
a 438x246 radar and a 440px chart showing 6 hour labels. Stacking costs roughly the vertical space
the hole wasted and gives both the full width instead: a 928x521 radar and 12 hour labels.

**The radar earns its slot.** Like the AQI card, it only appears when it has a story to tell:
Storm Mode for a *radar-shaped* warning family, a tornado/severe watch, precipitation falling now
(`data-wx`), or thunder or a ≥40% rain chance inside the next 6 hours — `radarWorthy()` in the
source. Radar-shaped means `convective` or `flood` (`RADAR_FAMILIES`): those are the families you
open a reflectivity map to find. Heat, wind, fire and winter warnings describe the air rather than
echoes in it, so they engage Storm Mode's theme, banner and prime card but leave the radar slot to
the conditions card — an Extreme Heat Warning shouldn't hoist a radar nobody came for. Falling snow
still summons it through `data-wx`, which is the case a Winter Storm Warning would want it for. On a
clear day the card (satellite tab included) is hidden, the conditions card takes the full row, and
the 24-hour chart gets the whole width back — all ~24 hour labels, exactly the thing the hero
merge had traded away. A rail button summons it by hand; the ✕ to dismiss exists only on a
hand-summoned card, since an auto-shown one would re-appear on the next update. While hidden it
fetches no tiles (`refreshRadarLayer` returns early), and the show path re-renders the 24-hour
chart, because the chart only re-measures on *window* resize and this toggle resizes its container
without one.

**When shown, the radar is a peek, not the product.** Its height comes from an `aspect-ratio`,
never from leftover space. An earlier version stretched the map to match the left column, which made its size
a side effect of how much content the conditions card happened to have — that is how it ended up
660px tall on a calm day and *portrait* (0.67) at 1000px, the worst possible shape for weather that
moves west to east. It is now 16:9 (4:3 on phones), so it is landscape at every width, with
fullscreen a click away for the "where exactly, and when" case. Storm Mode widens it to 16:10 (1:1
on phones): the page already knows when radar is the story, so the strip earns space back exactly
then rather than being large all year for the few days it matters.

**Fullscreen moves the card, not the map.** `body.radar-full` makes `#radarCard` fixed and
full-viewport; the Leaflet instance, the loop, the warning polygons and the satellite tab are
untouched, so nothing needs re-initialising. Escape closes it, focus returns to whatever opened it,
and body scroll is locked so a wheel gesture over the map can't scroll the page behind it. Leaflet
is told to `invalidateSize()` twice — once immediately, once after the transition — or it renders
tiles for the old viewport. A `ResizeObserver` on `#radar` covers the same hazard for Storm Mode's
resize, which no window event announces.

**The location search asks the geocoder several questions, not one.** Open-Meteo's geocoder does
no fuzzy matching at all — a name that doesn't match the stored spelling character-for-character
returns an empty list, not a near miss — and its index is inconsistent about the abbreviations this
area is full of. It holds *Lake Saint Louis*, *East Saint Louis*, *Saint Ann* and *City of Saint
Peters* spelled out, but *St. Louis* and *Mt. Vernon* abbreviated. Typed the way everyone here
writes them, "Lake St. Louis", "East St. Louis", "St. Ann" and "Ste. Genevieve" all returned
nothing, and "St. Charles" returned an airport plus a town in Kane County, Illinois. So
`queryVariants()` rewrites what was typed into up to six spellings — St./Saint, Ste./Sainte,
Mt./Mount, Ft./Fort, the directionals, the apostrophe repairs, `&`/and — `geoLookup()` asks for all
of them at once and merges by geoname id, and the ranking decides what actually matched.
Requests are memoised per variant string, so the next keystroke re-sends almost nothing.

Four rules do the ranking, in the order they matter:

- **Name match beats population.** Someone who typed six characters of a small town meant that
  town. `matchScore()` grades exact, word-prefix, still-typing prefix, contained, then bigram
  similarity; population is a tiebreak worth at most 18 points.
- **Populated places beat everything else.** Searching Ste. Genevieve turns up a flying club and
  Lake St. Louis turns up its dam. Non-`PPL*` features survive only when nothing populated matched,
  where a lake or a park is plausibly the place someone wants a forecast for.
- **Coincidental alternate-name hits are pruned.** The index matches historical names it doesn't
  hand back, so "Springfield" returns Palmyra — which is in Marion County, and therefore in area.
  Left alone that made Palmyra the one suggestion for Springfield. `pruneWeak()` drops it *only*
  when something in the full result set really is named what was typed; if nothing anywhere matches
  by name, the hit came from a name we can't see and is trusted rather than thrown away.
- **A typo is rescued last, never first.** Only after every exact spelling comes back empty does
  `fuzzyRescue()` re-ask for a prefix of the query and keep what a bigram comparison says is close
  ("Chesterfeild", "Edwardsvile"). Fuzziness never reorders results that did match, where it would
  happily rank a wrong town above a right one.

A miss says which kind of miss it was, because they need different responses: a place that exists
but sits outside the CWA is the dashboard's limit, while no place at all is a spelling to fix.
Naming the out-of-area town takes an *exact* match — three characters into "Ste. Genevieve" the
index offers Ste. Marie, Illinois, and that is a confusing thing to read while still typing.

Suggestions are labelled with the county, which is the only thing that tells the three O'Fallons
apart, and printed the way the area writes them: `prettyPlace()` turns the index's *Saint* back
into *St.* and drops the *City of* prefix. Arrow keys move the highlight (`.hot` was in the
stylesheet from the start with nothing applying it) and Enter takes it.

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
- The hero pair (when the radar has earned its slot) still runs ~110-170px unequal at desktop
  widths, since the left column's height is
  content-driven and the radar's is fixed by its aspect ratio. It is page-edge whitespace under the
  radar rather than a framed hole. Growing the radar to close it is exactly the mistake that made
  the map portrait in the first place, so it stays.
- The masonry positions cards absolutely after sorting by importance and height. `reorderMasonryDOM`
  re-syncs DOM order to visual order after each pack; it skips only if a card hosts an iframe
  (re-inserting reloads them), and nothing in the masonry does today.
- `saveSnapshot()` serialises synchronously on `visibilitychange`.
