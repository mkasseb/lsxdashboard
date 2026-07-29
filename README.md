# LSX Weather

A one-page weather dashboard for the **NWS St. Louis (LSX) County Warning Area** — eastern Missouri
and southwest Illinois. Alerts, radar, forecasts, river gauges, and climate context for a location
inside the CWA.

Not an official NWS product. During severe weather, defer to official warnings and a NOAA Weather Radio.

## What it is

One file. [`index.html`](index.html) is the entire application: ~1,010 lines of CSS, ~315 lines of
markup, and ~3,965 lines of JavaScript, all inline.

- **No build step.** No bundler, no transpiler, no `package.json`. Edit the file, reload the page.
- **No API keys.** Every feed was chosen because it is keyless and CORS-open, so the whole thing
  runs as a static page with no server and no secrets.
- **Two runtime dependencies**, both from a CDN with SRI hashes: Leaflet 1.9.4 for the maps, and
  Meteocons for the sky-condition icons. Both degrade gracefully if the CDN is unreachable — every
  other icon on the page comes from an inline sprite that ships with the file (see below).
- **Installable PWA** via [`manifest.webmanifest`](manifest.webmanifest). There is deliberately no
  service worker — return visits paint instantly from a `localStorage` snapshot instead (see below).

## Running it locally

Serve it over `localhost` rather than opening the file directly — `file://` breaks geolocation and
the snapshot cache, both of which need a secure context.

```bash
python3 -m http.server 8787
```

Then open <http://localhost:8787>.

With no build step there is nothing between an edit and production, so the mistakes that would
ship silently are checked mechanically:

```bash
python3 tools/check.py        # syntax, CSP origins, icon names, root files
node tools/logic-tests.js     # the functions that decide something
```

[`tools/check.py`](tools/check.py) catches the four footguns this repo's shape creates — a syntax
error in the inline script, an origin the CSP doesn't declare, an icon name with no `<symbol>`, and
a missing or self-contradicting file at the site root.
[`tools/logic-tests.js`](tools/logic-tests.js) covers the pure decision functions: `rangeRow()`,
`alertLevel()`, `cardCmp()` and `coldVerdict()`. With no build step there is nothing to import
from, so it lifts them out of `index.html` by name and runs them — which means a rename fails the
suite loudly rather than leaving it silently testing nothing. Anything that paints is left to the
eye. `cardCmp()` and `ALERT_SEV_RANK` sit at the top level of the script rather than inside
`loadAlerts()` for exactly this reason: the order of the alert list is the one thing about that
section a reader acts on, and it is asserted rather than eyeballed.

CI runs both on every pull request.

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

- [`404.html`](404.html) — an unmatched path is answered with this file **and a 404 status**. With no
  such file the fallback is `index.html` at 200, so `/robots.txt` used to return 378 KB of dashboard
  (Lighthouse scored the site 92 on SEO and read it as 5,953 syntax errors), and every URL a crawler
  invented became another indexable, byte-identical copy of the homepage. Delete the file and all of
  that comes back silently, which is why `tools/check.py` insists on it.
- [`robots.txt`](robots.txt) — allows everything and points at the sitemap. There is nothing to
  exclude on a one-page site.
- [`sitemap.xml`](sitemap.xml) — the one URL there is, with no `<lastmod>`: nothing builds, so any
  date here would be a hand-written claim about freshness that starts drifting on commit.

That URL is now stated in four places — `rel=canonical`, `og:url`, the sitemap's `<loc>` and the
`Sitemap:` line — each read by something that never sees the other three, so `tools/check.py` fails
if they stop agreeing. Moving the site means changing `SELF_ORIGIN` there and all four.

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
| `gibs.earthdata.nasa.gov` (WMTS) | GOES-19 ABI GeoColor satellite tiles, in the map's own projection |

Basemap © CARTO & OpenStreetMap contributors.

Two icon sets, both MIT:

- **Sky conditions** — [Meteocons](https://github.com/basmilius/weather-icons), © Bas Milius. Loaded
  from a CDN and drawn in colour in the hero and the 24-hour chart.
- **Everything else** — the inline `<svg id="sprite">` in [`index.html`](index.html). Roughly half of
  its 35 glyphs — the interface marks (close, expand, lock, pin, check, play/pause) and the generic
  data marks (alert triangle, info, flag, bar chart, trending-down, wind, droplet, paper plane, bolt)
  — are drawn from, or closely after, [Feather](https://feathericons.com), © 2013–2023 Cole Bemis.
  The weather-specific glyphs (cloud, rain, storm, snow, flood, tornado, fog, fire, drought,
  thermometers, UV, air) are original to this project.

Both licences are the MIT licence, which asks that the copyright notice travel with the work — hence
the two names above and the credit line in the page footer.

## How it fits together

The script is sectioned by `/* ==== BANNER ==== */` comments and reads top to bottom: config →
helpers → ~15 per-card loaders → derived renderers → orchestration → scheduler → layout engine.

A few things are load-bearing and worth understanding before changing anything:

**One icon language, and it is not emoji.** Every mark on the page except the sky-condition icons
comes from the `<svg id="sprite">` block at the top of `<body>`, drawn with `ic("name")`. Icons are
stroked and sized in `em`, so a mark inherits the colour and the size of the label it sits in —
which is the whole reason for the change. The page used to draw hazards in emoji, and emoji are a
separate rendering engine: they carry their own palette, so a heat mark could not take a warning's
colour; they render as a different picture on every platform; they sit off the text baseline; and
they have tone, which is a strange thing for a life-safety warning to have. Worse, nothing tied
them together — heat was a sweating face in five places and a flame in two, and rain was a cloud,
a droplet or an umbrella depending on which loader drew it. The sprite is one glyph per *concept*,
so those are now the same picture everywhere.

It is inline rather than a CDN set for the same reason Meteocons has a fallback at all: a page that
someone opens during severe weather cannot have its icons fail with the network. Inline also means
no origin to add to the CSP. `tools/check.py` fails if a name has no `<symbol>`, or if a `<symbol>`
has no caller — a `<use>` pointing at a missing id renders *nothing at all*, with no error anywhere,
so a typo in one arm of `hazIcon()` would silently drop an icon and stay dropped. Meteocons still
draws the sky in colour in the hero and the 24-hour chart, and `wxiFail()` now falls back to a
sprite glyph at the size the dead `<img>` had reserved.

**Severity is one ramp.** `alertLevel()` returns one of `emergency → warning → watch → advisory →
statement`, and the level sets `--lv` on the card; every tinted thing inside it — the rail, the
tint, the tier tag, the progress bar, the "what to do" block — reads that one variable, mixed with
`color-mix()` so the tints follow the light theme instead of staying tuned to the dark one. This
replaced two functions that classified the same alert by two different rules at once: `alertClass()`
on CAP `severity` and `alertTier()` on the word in the event name. They disagree in practice — a
Flood Advisory can carry severity `Severe` — so a card would arrive tinted by one and tagged by the
other. The ramp ranks by the word, because that is what the reader is being asked to act on, and
lets CAP severity escalate (never demote) a step above it; a tornado warning is promoted outright,
being the one event where the word and the stakes are not the same size. `--storm` is *not* part of
this and stays: it answers "what kind of weather", which is a different question from "how bad".

**But severity is not the sort key — location is.** The office issues for forty-odd counties and
the reader is standing in one spot in them, so `cardCmp()` ranks coverage above level: an emergency
leads from anywhere, then everything covering this location whatever its level, then everything
else. It used to sort on level first, which reads right and isn't — `alertLevel()` promotes every
Tornado Warning to `emergency`, so a tornado two counties away outranked a Severe Thunderstorm
Warning genuinely overhead and took the lead banner's glow with it. Your Heat Advisory now sits
above a distant Winter Storm Warning, which is the correct answer to "what should I look at".

Coverage is decided by `alertCoversMe()`, which is two tests because NWS issues alerts two ways:
storm-based warnings carry a polygon and get a real point-in-shape ray-cast (holes included), while
watches and advisories carry `affectedZones` and get an exact match against the zone URLs `/points`
hands us for this location. It returns *which* kind of match it was, so a badge can never claim
more than the evidence supports — "your forecast zone is included" is a different statement from
"you're inside this area", and NWS issues zone products against forecast zones rather than counties.
If `/points` fails the whole thing fails **open**: coverage becomes unknowable, nothing is ranked
down, and the list goes flat. A cluttered list is a much smaller failure than a hidden warning.

**Grouping is by event *and* coverage.** NWS ships one record per zone group, so segments have to
be consolidated or the list reads as a dozen copies of one storm — but consolidating on the event
name alone did it too well. A Severe Thunderstorm Warning over this location and a different one
three counties east arrived as one card, flagged as covering you, wearing the union of both county
lists: the local storm described with geography that wasn't its own, and the distant one with no
existence in the list at all. The same hazard can now hold a card here and a card elsewhere, and
neither speaks for the other. The family fold (`FAMILY_CFG.merge`) is keyed the same way, and the
two-way polygon↔card link on the radar carries a `data-scope` alongside the event name, because a
name no longer identifies a card by itself.

**The rest of the office's area stays on the page.** Alerts that don't cover this location sit
below the local banners under one eyebrow, at one line each. They used to live behind a collapsed
"N alerts elsewhere" disclosure, which answered "is anything out near me" with a number and made
the reader tap to find out what. The rows are the *same* `.alert` banner as the local cards — the
section only takes things away (the subline, some padding, some weight) and the existing head
toggle puts them back — so there is one card renderer, not a compact one drifting away from a full
one. The separation is structural rather than tonal: no tint, a thinner rail, smaller type, and
deliberately no opacity. Dimmed text on a tinted rail is how the contrast work gets undone, and
these are still watches and warnings for somebody.

**The page spends colour like it is scarce.** Saturated colour means severity, and links are blue.
That is the whole budget. Storm Mode used to ring three cards in the family accent while the banner
above them glowed in the same colour, so a warning arrived as four concentric halos and the alert
card's own severity ramp had to compete with a border painted by family rather than by level — the
banner keeps the glow now and the cards take a tinted hairline. Countdowns moved off `--accent` for
the same reason: rendered in the link colour, "23h 16m left" read as something you could click.

**Type carries the hierarchy.** Sizes come from `--fs-*`, radii from `--r-*`, spacing from `--sp-*`.
There were 23 distinct font sizes and 19 pill classes that each defined their own geometry from
scratch, which is how chips sitting side by side in one card ended up with radii between 8px and
22px. The pill classes all still exist by name — the JS builds them by name and restored snapshots
carry those names — but they now declare only what differs. Anything naming a region of the page
(card titles, band rails, the Bottom Line's own label) is the *eyebrow*: `--fs-xs`, 700, uppercase,
`--ls-eyebrow`, muted. There used to be three idioms for that one job. Chart and station-plot
internals deliberately stay on explicit pixels: those values are tuned to SVG geometry, not to the
text system, and folding them into the type scale would be a category error.

**The page is ordered by what a visitor came for.** Alerts first (in calm weather that card
collapses to a single all-clear line), then the Bottom Line, then The Pulse, then the hero band —
"Now & Next 24 Hours" on the left, radar on the right — and finally the masonry.
The Bottom Line (né The Call; ids are still `callCard`/`callRow`) is the page reasoning on the
visitor's behalf rather than handing them numbers: rain/storm windows, heat and cold, UV with a
burn clock, wind, air quality, a temperature-crash warning, climate records — and one synthesized
verdict that scores every daylight hour on comfort, rain risk and wind to name the best two-hour
window to be outside, spoken only when the day has adversity worth dodging. It ranks directly
under safety, and that rank is not conditional: Storm Mode re-orders every other band around it
but leaves it second, so the card is on the first screen whatever the weather is doing. It used to
drop below the hero under `body.storm`, on the theory that a live warning makes the radar outrank
advice — but that filed the plain-English read of the warning *under* a full-width hero band,
a scroll away on a phone in exactly the conditions someone checks this page one-handed. The radar
still leads the hero; the sentence explaining it just arrives first.

**The Pulse rides directly behind it in calm weather, at full length.** `#afdCard` is the same kind
of card as the Bottom Line — one verdict computed by this page, one written by a human at NWS
St. Louis — so the two reason together above the numbers. It used to sit below the
hero under "the week ahead & deeper context", which mis-filed it twice: `extractAFD` reaches for
Key Messages, then the Synopsis, then the **Short-Term Outlook**, all of which describe the next
12–24 hours rather than the week, and the rank buried the forecaster's read of the day some
2,000px down.

**There is deliberately no clamp, and that took two attempts.** The card first shipped collapsed to
a few lines behind a "Read the full discussion" button, on the theory that it had to be cheap to
deserve the rank. Measuring the 21 most recent LSX products said otherwise: in the calm-weather
layout the card runs 151–365px (median 304), putting the top of `#currentCard` between 668px and
881px — so on a 912px phone the hero is on the first screen in every one of them, clamped or not.
The clamp was hiding up to 200px, and cutting the forecaster off mid-sentence, to buy room nothing
needed. It had been sized against multi-paragraph Short-Term prose, which is an input this card has
never actually been handed (see below). Full length is affordable for a structural reason too: the
only time this card sits second is calm weather, which is exactly when the space above the hero is
cheapest — a one-line all-clear and a few pills.

One thing to know before touching `extractAFD`: its Synopsis and Short-Term fallbacks currently
match **nothing** on this office's products. LSX writes `.SHORT TERM /THROUGH THURSDAY/...` and the
pattern wants `.SHORT TERM...`, so the qualifier between the name and the dots defeats it. It goes
unnoticed because Key Messages was present in all 21 recent products sampled, so the first branch
always wins. That is pre-existing and deliberately left alone — fixing it changes what the card
*says*, which deserves its own review. It is also the input the clamp was built for, so if it is
ever fixed, re-measure before reaching for one again.

**That rank is calm-weather only — The Pulse is the one card here whose rank is conditional**, and
the contrast with the Bottom Line is deliberate. `body.storm #afdCard{order:-2}` puts it back under
the hero band, for two reasons that agree. Measured: Storm Mode is exactly when everything above the
hero is already tall — a glowing lead banner in place of the one-line all-clear, and a Bottom Line
full of pills — and even clamped to two lines The Pulse left the radar at 832px on an 844px phone,
twelve visible pixels of map during a Tornado Warning (and it is no longer clamped at all). On the
merits: an AFD is a scheduled prose
product issued a few times a day, so during a fast-moving warning it was very likely written
*before* the event being read about. The warning is live and the radar is live; the discussion is
the only thing in that band that isn't. The Bottom Line can hold its rank through all of this
because it is a pill row computed from live data, one or two lines that stay true minute to minute
— paragraphs of periodically issued prose are a different object and get a different rule.

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

**UV and air quality are tiles beside the metric grid, not inside it.** They answer the same
question as each other — how much is this going to cost me to be outside — so they sit together in
`.cc-expo`, wearing `.cc-item`'s chrome because the card should speak one language. They stay
*out* of `.cc-grid` on purpose: those six tiles are what the `Observed … KSUS` footline describes,
and UV and AQI come from Open-Meteo, so folding them in would make that line assert something
false. The footline names Open-Meteo for exactly that reason. They were four run-on sentences at
12.5px until the burn clock read identically to a record from 1936; the fix was hierarchy, not
smaller type. Below them the climate line labels its figures (`NORMAL`, `RECORD`) and drops the
words "record high" and "low", because a warm/cool colour pair says it in no characters at all,
and every credit — observation age, station, records station, AirNow — collects into one dimmer
line that reads as a caption rather than a fifth row of data.

One thing there is load-bearing: the severity palettes (`uvLevel`, `aqiInfo`) are tuned for the
dark panel and arrive as inline colours, so a light-mode `filter` darkens them as a group — at tile
size, AQI "Moderate" on the light panel is otherwise 1.3:1.

**The hero row is a pair of stacks, but only on wide screens.** Left is the conditions card (+ AQI
when it's notable); right is the Sky card. Below 1100px they stop being a pair and both go full
width: at ~474px per column the left one still had to carry the reading, the metrics grid and the
24-hour chart while the right had only the map, so they came out ~400px apart *and* both were
cramped — a 438x246 map and a 440px chart showing 6 hour labels. Stacking costs roughly the
vertical space the hole wasted and gives both the full width instead: a 928x521 map and 12 hour
labels.

**The Sky card is permanent.** It used to earn its slot the way the AQI card does — shown only for
a *radar-shaped* warning family, a tornado/severe watch, precipitation falling now, or a wet
next-few-hours, with a rail button to summon it by hand on a calm day. That whole subsystem
(`radarWorthy()`, `RADAR_FAMILIES`, `THUNDER_MIN_POP`, `body.no-radar`, the show/hide toggle and a
second full-row layout for Current Conditions) is gone. The judgement it encoded was sound, but it
was answering "is the sky worth a map right now?" — and the honest answer for a weather dashboard
is *yes, that is what people came for*. Removing it also removed the only reason the page had two
hero layouts, so there is now one arrangement to reason about instead of two.

One thing `radarWorthy()` was doing had to survive it, though — see the family gate below. Storm
Mode's rules for this card were written when "Storm Mode is on" and "the map is on screen" were the
same statement, because a dry warning engaged Storm Mode and never produced a card. Permanence
broke that equivalence, so anything phrased as plain `body.storm` had to be re-examined.

**Radar is a peek, not the product.** Its height comes from an `aspect-ratio`,
never from leftover space. An earlier version stretched the map to match the left column, which made its size
a side effect of how much content the conditions card happened to have — that is how it ended up
660px tall on a calm day and *portrait* (0.67) at 1000px, the worst possible shape for weather that
moves west to east. It is now 16:9 (4:3 on phones), so it is landscape at every width, with
fullscreen a click away for the "where exactly, and when" case.

Storm Mode widens it to 16:10 (1:1 on phones) and tints its border in the family accent — but
**only for `data-storm="convective"` or `"flood"`**, the two families with echoes to look at. That
selector *is* the old `RADAR_FAMILIES` test, moved from JS into CSS off the attribute
`setStormMode()` already writes. As a plain `body.storm` rule it would enlarge the map and tint it
during an Extreme Heat Warning, taking space from the cards that actually matter for heat — which
is the same mistake `radarWorthy()` existed to prevent, arriving through a different door once the
card stopped disappearing. Heat, wind, fire and winter keep Storm Mode's theme, banner and prime
card, and leave the map at its everyday size.

**Fullscreen moves the card, not the map.** `body.radar-full` makes `#radarCard` fixed and
full-viewport; the Leaflet instance, the loop, the warning polygons and the layer toggles are
untouched, so nothing needs re-initialising. Escape closes it, focus returns to whatever opened it,
and body scroll is locked so a wheel gesture over the map can't scroll the page behind it. Leaflet
is told to `invalidateSize()` twice — once immediately, once after the transition — or it renders
tiles for the old viewport. A `ResizeObserver` on `#radar` covers the same hazard for Storm Mode's
resize, which no window event announces.

One non-obvious dependency: `body.radar-full` also has to clear the entrance animation on
`.grid>.stack`. `cardIn` ends on `transform:none`, but `animation-fill-mode: both` keeps the
animation's output applied forever after, and a *filled* transform still computes to a matrix
rather than to `none` — which makes the stack the containing block for `position:fixed`
descendants. Without that reset the fullscreen card resolves `inset:0` against its 824px column
instead of the viewport and opens as a sliver.

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

A snapshot is restored *markup*, painted under whatever stylesheet ships today — so reshaping a
card's DOM means bumping `SNAP_KEY`. Skip it and every returning visitor gets one visibly wrong
first paint: yesterday's elements picking up today's rules with none of today's structure. One
cold paint is the cheaper mistake.

**Storm mode.** An active warning is classified into a family (convective / winter / flood / heat /
wind / fire), which sets the accent colour, floats the most relevant card to the top of the layout,
and rewrites the banner.

*Which* warning is the one at the top of the sorted card list, read straight off `glist` after
`cardCmp()` has ordered it. It used to walk the raw feature list in CAP-severity order and test for
the word "warning" — a second severity opinion in a page whose whole alert design is that there is
only one. The two could disagree (the ramp promotes a Tornado Warning that the office tagged merely
`Severe`), and the page would then theme itself for one warning while a different one led the list.
Reading the sorted list means the colour, the primed card and the lead banner are the same alert
because they cannot be anything else.

The banner's second line comes from the NWS instruction for *that* warning, via `stormSubline()`,
not from a string keyed to the family — a family as broad as "winter" spans a blizzard and a frost
advisory, and one sentence cannot be useful for both. `FAMILY_CFG.sub` is the fallback, and three
things send it there: a product with no instruction, one written entirely in upper case (legacy
all-caps products; the alert card has room to show those, the banner does not), and one that opens
by defining itself — *"A Red Flag Warning means critical fire weather conditions…"* is true and no
use to someone deciding what to do in the next minute. Sentences are taken whole up to a budget,
because the useful first sentence of a tornado instruction is "TAKE COVER NOW!" and on its own that
is an alarm without an instruction.

The line before this one used to narrate the page's own layout — *"Regional feels-like moved up"* —
which says nothing about the weather and only parses for someone who saw the page **before** the
warning fired. The banner has one job: what this means and what to do about it.

**Adding a card** means touching five places: the markup, the `RANK` map in `layoutMasonry`'s
`tier()`, `SNAP_PARTS`, the `SCHED` table, and `clearLocationUI`/`resetLocationState`.

**Adding a location-scoped loader** means a sixth: the `jobs` array inside `setLocation()`. `SCHED`
only governs the periodic refresh, and `refreshAll()` only covers the initial paint — a loader
missing from `setLocation` looks like it works, then silently never re-runs when the visitor
changes town. Worse, it can appear broken on first load too: geolocation resolves *after* the first
`refreshAll()`, so the generation bumps, the in-flight fetch is discarded by its own `fresh()`
guard, and nothing re-issues it.

**Radar and satellite are one widget, stacked.** They answer the same question at different scales,
so they share one Leaflet map: GOES cloud shield underneath, reflectivity inside it, warning
polygons on top. They were two alternating *views* until the satellite source changed. NESDIS's
sector product is a finished 600x600 JPEG in a fixed frame — nothing in it says where its corners
are and its projection isn't the map's, so it could never be laid over the radar. NASA GIBS serves
the same GOES-19 ABI GeoColor imagery as WMTS in EPSG:3857, which registers with the radar at every
zoom and pan, and the tabs became independent layer toggles.

Three details of that endpoint shape the code:

- The path is `{TileMatrix}/{TileRow}/{TileCol}` — **z/y/x**, not Leaflet's usual z/x/y.
- `GoogleMapsCompatible_Level7` provides z0–z7; z8+ answers HTTP 400. `maxNativeZoom: 7` lets
  Leaflet upscale past that rather than request tiles that aren't there. Nothing is lost — ABI
  GeoColor is 2 km data, and z7 is already finer than that.
- Omitting the time segment resolves to the newest frame *and* answers `no-store`. A dated URL is
  worse on both counts: the archive has gaps, so a computed "now minus latency" guess is a hard 404
  that blanks the layer, and a dated URL is cacheable — the opposite of what a live panel wants.
  Undated + `no-store` means a fresh layer object always fetches current pixels with no cache-buster.

GeoColor is opaque, so it hides the basemap's geography. CARTO publishes the label half of the same
basemap separately (`*_only_labels`), so the labels go back on *top* of the imagery rather than the
imagery being made translucent, which would only turn both layers to mud.

Reflectivity lives in its own Leaflet pane (`radarPane`, z-index 350 — above the tiles at 200,
below the overlays at 400). The pane is for **stacking only**: a pane rather than another `zIndex`
per layer, because the loop creates ~15 of them at runtime and they would all have to agree with
whatever the satellite is using. Warning polygons deliberately do **not** toggle with reflectivity
— someone who turns it off to read the cloud shield still needs to see where the warning is.

**The loop targets a duration, not a sweep count.** It used to take `times.slice(-10)` and the Loop
button's tooltip claimed "the last ~30 minutes". Measured against the live WMS, NWS publishes
`conus_bref_qcd` on a **120-second** cadence and advertises 60 sweeps (~118 minutes), so ten sweeps
was an 18-minute loop — and six, on a phone, was ten. Long enough to prove a storm exists, too short
to show where it is going, which is the only question a loop answers. `RADAR_SPAN_MIN` (60) is now
the target and `RADAR_N_DESK`/`RADAR_N_PHONE` are a frame *budget*; `pickRadarTimes()` thins the
window to fit. Nothing hard-codes a duration any more — `radarSpanMin()` reads the built frame list
and `setRadarBtn()` writes it into both the tooltip and the `aria-label`, so the number a visitor
reads is the number of minutes on screen.

The thinning grid is **anchored to the epoch, not to "now"**, and that is the part worth not
undoing. `radarPool` keys on the timestamp string, so pooling only pays if a refresh asks for the
timestamps it asked for last time. Striding backwards from the newest sweep — the obvious
implementation — fails exactly that: two fresh sweeps land, every stride shifts two slots, and all
fifteen frames miss the pool and re-download every four minutes. Against a fixed grid the same wall
clock instants keep resolving to the same sweeps. Replayed over the archive, each refresh builds
**one** new layer and reuses fourteen, so an hour-long loop costs the same per refresh as the
18-minute one did.

**A dead feed must not look like clear skies.** Every other feed on this page fails visibly, but a
tile layer that fails leaves the basemap showing, and a bare basemap under this card is what a calm
evening looks like — the one wrong answer a weather dashboard must never give confidently. Nothing
was watching: `.imgfail` covers only the case where Leaflet itself never loaded. `bindSkyHealth()`
now counts `tileload`/`tileerror` **per layer**, and that per-layer part is load-bearing: a shared
counter cannot work alongside pooling, because on a refresh fourteen frames are already painted and
silent (cached `<img>`s re-fire nothing), so a counter reset each cycle would read one new frame's
failures against zero fresh successes and cry outage over a map that is drawing perfectly. The
verdict is deliberately strict — errors *and* not one tile through — because radar tiles 404 at the
mosaic's edges routinely, and a badge that flickers red on ordinary noise is worse than no badge.

`syncRadarBadge()` is the single owner of that badge. It used to be written from two places that
knew different things (`showRadarFrame()` had the timestamp, the `refreshRadarLayer()` catch had the
failure) and neither could say the thing that matters: whether what you are looking at is current.
It now distinguishes four states — current sweep, scrubbed back (amber), stalled, and down (red).
Stalled is its own case because it is the dangerous one: a real sweep, drawn correctly, quietly
`RADAR_STALE_MIN` minutes out of date reads as live to anyone who does not do arithmetic against the
header clock. The caption follows the same rule it always did, naming what is actually drawn — which
now has to include naming a layer that is switched on and failing, or it goes from honest to
crediting NOAA for reflectivity nobody received.

**The reflectivity key uses the server's own colours.** The map painted a ramp and nothing said what
it meant. The gradient stops in `.rl-bar` were sampled per-5-dBZ out of this layer's
`GetLegendGraphic` rather than eyeballed, so the key cannot drift from what GeoServer draws; the
scale runs 15→65 dBZ and the tick words sit at their real positions, `(D−15)/50`. It is `role="img"`
with an `aria-label`, because read linearly the ticks are "light heavy hail", which is noise. It
hides when reflectivity is off *or* down — a guide to colours the map is not painting is clutter.

**The satellite follows the scrub, and the reason it does not follow playback is bytes.** Scrubbing
the radar back an hour used to leave the cloud shield at "now" — the storm in the past and the
system carrying it in the present, drawn as one picture, which is the exact thing stacking the two
layers was supposed to prevent. `syncSatToRadar()` re-points the satellite to the newest GOES frame
at or before the displayed radar moment.

An earlier note in this file blamed the archive's gaps for there being no GOES time track at all.
That was the wrong diagnosis. The gaps are real — measured across three hours, only 11 of 18 nominal
10-minute slots existed, and a missing slot is a hard 404, so the moments must be **discovered**
rather than computed. But discovery is cheap: `DescribeDomains` bounded to a few hours answers in
~350 bytes. (Unbounded it returns the archive back to 2021, about 1 MB, which is presumably what
made this look impractical.) Two details bite: the time is a segment of its own **after** the style
(`…/GOES-East_ABI_GeoColor/default/{time}/GoogleMapsCompatible_Level7/…`) — putting it where
`default` sits answers 400 for every tile — and the domain is a list of `START/END/PERIOD`
*intervals*, which is how the gaps are encoded, so it has to be expanded before anything can snap
to it.

The real constraint is tile weight. Measured: a reflectivity tile is **1,980 bytes** (sparse,
transparent), a GeoColor tile is **113,601 bytes** (opaque, full colour) — **57× bigger**. That one
ratio explains the whole design: the radar keeps ~15 frames alive, the satellite keeps exactly
**one**, and nothing preloads a parallel stack. It also decides the playback exemption — a GeoColor
frame is ~450 KB for this map, and fetching that every 450 ms would stall the loop rather than
enrich it. Playback therefore triggers no satellite work at all (verified: zero swaps, zero tile
requests across a running loop); pausing syncs once to wherever the visitor stopped. A drag is
coalesced behind a 180 ms timer and a swap generation counter, because tiles do not come back in
request order and a slow early frame must not paint last.

`gibs.earthdata.nasa.gov` now appears in **both** `img-src` and `connect-src`, which looks like a
duplicate and is not: the tiles are images, the timestamp list is a fetch.

**The frame budget answers to zoom, because tile cost does.** Every pooled frame refetches on a view
change, and a low-zoom `GetMap` covers far more ground: measured against the live WMS, a median
**5.9 s** per tile at z4 (p95 10.1 s), **120 requests** for fifteen frames, ~8 seconds before the set
was whole again. The loop meanwhile kept stepping on its 450 ms timer onto frames whose tiles had not
arrived — which paints nothing and reads as *the loop broke*. That is what it was: reported as "the
satellite stops looping when I zoom out", and the satellite had nothing to do with it.

Two changes. `radarFrameCount()` now returns `RADAR_N_WIDE` (7) at or below `RADAR_WIDE_ZOOM` (5) —
detail is not what a continent-wide view is for, and the *span* is unaffected, so the loop still
covers its hour, just in coarser steps. The budget is re-picked on `zoomend` from `radarTimesCache`
rather than waiting for the next 4-minute refresh, which would have left fifteen layers thrashing
across a z4 view for minutes. Measured after: **48 requests** instead of 120.

And `radarStep()` holds rather than advancing through unpainted frames, showing `loading frames…` in
the `.rc-load` slot — a style that had existed with no element behind it since the scrubber shipped.
The hold tests Leaflet's `_loading`, not the frames' own `_ready`: `_ready` is set by the first load
ever and never cleared, so it stays true through a zoom that has invalidated every tile behind it.
The hold is bounded at `RADAR_HOLD_MAX` (9 s) so a frame that never settles cannot freeze the loop
for good.

**Only the basemap is credited on the map.** The NOAA and NASA lines used to ride along in the
Leaflet attribution, and on a 375px phone all four wrapped to three lines: 46px over a 236px map, a
fifth of the picture. They were never load-bearing — `#rsCap` names every source that is drawing and
the footer links all of them — so CARTO and OSM stay (their terms ask for a link on the map itself)
and the rest moved to the caption. The bar is one 15px line now. This also un-broke the map lock:
`.maplock` sat at z-index 3 while Leaflet's control containers sit at 1000, and `#radar` sets no
z-index so it never opens a stacking context to trap them. The controls won, the attribution landed
exactly where a bottom-centred pill lands, and `elementFromPoint` on the middle of "Tap to interact"
returned the OpenStreetMap link — the affordance announcing the map was interactive was a link to
openstreetmap.org. The overlay now sits above the controls, so locked means locked (including the
zoom buttons, which used to poke through and work while the map said it was not listening).

**Off has to mean off the map, not hidden.** The first cut toggled the radar by setting
`display:none` on its pane, which looks equivalent and isn't: a Leaflet layer that is merely
invisible is still on the map, and `GridLayer` requests tiles for the current view on every
`moveend` regardless of whether anything can see them. Measured, one pan across the state pulled
~90 reflectivity tiles with the layer "off". `detachRadarLayers()` now removes the fallback layer
and every pooled sweep and *clears* the pool — clears, because `buildRadarFrames()` only calls
`addTo()` for timestamps it hasn't seen, so a pool of detached layers would be silently reused on
the way back and draw nothing. Rebuilding costs one capabilities fetch, and those sweeps would be
stale by then anyway.

That teardown also disarms the Storm Mode autoplay for free — `updateRadarCtl()` starts the loop
when a warning lands, and an empty frame list makes `radarFramesReady()` false. It still tests
`skyOn.radar` explicitly, because that call site is the one moment the page is most inclined to
start something on the visitor's behalf, and "don't animate a layer they switched off" shouldn't
rest on a side effect two functions away.

The satellite refresh swaps layers rather than calling `redraw()`, which drops every tile first and
leaves a hole while replacements load: build the new layer, swap once it has painted. Both-layers-off
is reachable by clicking but is never *restored* from `localStorage` — landing on a bare basemap
with nothing on screen explaining why is a broken first impression.

## Known gaps

- No `aria-expanded` on the expandable alert and forecast rows.
- The hero pair still runs roughly 50-120px unequal at desktop widths, since the left column's
  height is content-driven and the Sky card's is fixed by its aspect ratio. (It was ~110-170px
  before the conditions footer became a tile pair, which gave the left column back ~50-60px.) It is
  page-edge whitespace under the map rather than a framed hole. Growing the map to close it is
  exactly the mistake that made it portrait in the first place, so it stays.

  Re-measured against live data (calm evening, KSUS 84°, no active alerts, so the AQI card was
  hidden and the left column was the conditions card alone) the range above did not reproduce, and
  the number moves with the viewport rather than sitting still:

  | shell | left column | Sky card | left taller by |
  |------:|------------:|---------:|---------------:|
  |  1330 |         860 |      592 |            268 |
  |  1884 |         822 |      786 |             36 |
  |  2524 |         868 |     1026 |    -158 (*map* taller) |

  So it was ~36px at 1920 and ~268px at 1366, and past ~2000 it inverts. The map's height follows
  its width; the reading column's does not, and narrower even makes it slightly taller as the text
  rewraps. The page shell trades that variation for one figure at every width from 1440 up — the
  left column 860 against a 618 Sky card, ~240px — which is more consistent but not smaller, and
  larger than it was at 1920 before the cap. That is the standing cost of bounding the page: a
  narrower shell means a shorter aspect-locked map with no matching reduction opposite it.

  Sweeping `--maxw` from 1400 to 2000 does not close it (best ~160px, and the map stops growing at
  1600 where its own max-height takes over), so the shell width is not the lever. The left column is
  479px of observations plus a 308px 24-hour chart; that chart is essentially the entire gap. Moving
  it out of the hero card — a full-width row of its own, where 24 points would stop having to thin
  their labels into a 456px column — balances the pair to within ~70px without touching the map.
- The satellite follows a *scrub* but does not *animate*. Stopping on a past radar frame re-points
  it to the matching moment; pressing Loop leaves it on the live frame. Preloading a parallel GOES
  stack is what a real satellite loop needs, and the cost is in the tiles — see below.
- The masonry positions cards absolutely after sorting by importance and height. `reorderMasonryDOM`
  re-syncs DOM order to visual order after each pack; it skips only if a card hosts an iframe
  (re-inserting reloads them), and nothing in the masonry does today.
- `saveSnapshot()` serialises synchronously on `visibilitychange`.
