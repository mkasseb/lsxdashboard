# Design notes

Why the code is shaped the way it is: what each decision replaced, what broke the first time, and
which parts are load-bearing. The [README](README.md) covers what this is and how to run it; this
file is for reading before *changing* [`index.html`](index.html).

The script is sectioned by `/* ==== BANNER ==== */` comments and reads top to bottom: config →
helpers → ~15 per-card loaders → derived renderers → orchestration → scheduler → layout engine.

## What the checks cover, and how

With no build step there is nothing between an edit and production, so the mistakes that would
ship silently are checked mechanically. [`tools/check.py`](tools/check.py) catches the four
footguns this repo's shape creates — a syntax error in the inline script, an origin the CSP
doesn't declare, an icon name with no `<symbol>`, and a missing or self-contradicting file at the
site root. [`tools/logic-tests.js`](tools/logic-tests.js) covers the pure decision functions:
`rangeRow()`, `alertLevel()`, `cardCmp()` and `coldVerdict()`. With no build step there is nothing
to import from, so it lifts them out of `index.html` by name and runs them — which means a rename
fails the suite loudly rather than leaving it silently testing nothing. Anything that paints is
left to the eye. `cardCmp()` and `ALERT_SEV_RANK` sit at the top level of the script rather than
inside `loadAlerts()` for exactly this reason: the order of the alert list is the one thing about
that section a reader acts on, and it is asserted rather than eyeballed.

## The root files

Three root files are configuration rather than content, and Cloudflare Pages reads them by name:

- [`404.html`](404.html) — an unmatched path is answered with this file **and a 404 status**. With
  no such file the fallback is `index.html` at 200, so `/robots.txt` used to return 378 KB of
  dashboard (Lighthouse scored the site 92 on SEO and read it as 5,953 syntax errors), and every
  URL a crawler invented became another indexable, byte-identical copy of the homepage. Delete the
  file and all of that comes back silently, which is why `tools/check.py` insists on it.
- [`robots.txt`](robots.txt) — allows everything and points at the sitemap. There is nothing to
  exclude on a one-page site.
- [`sitemap.xml`](sitemap.xml) — the one URL there is, with no `<lastmod>`: nothing builds, so any
  date here would be a hand-written claim about freshness that starts drifting on commit.

That URL is stated in four places — `rel=canonical`, `og:url`, the sitemap's `<loc>` and the
`Sitemap:` line — each read by something that never sees the other three, so `tools/check.py`
fails if they stop agreeing. Moving the site means changing `SELF_ORIGIN` there and all four.

## One icon language, and it is not emoji

Every mark on the page except the sky-condition icons comes from the `<svg id="sprite">` block at
the top of `<body>`, drawn with `ic("name")`. Icons are stroked and sized in `em`, so a mark
inherits the colour and the size of the label it sits in — which is the whole reason for the
change. The page used to draw hazards in emoji, and emoji are a separate rendering engine: they
carry their own palette, so a heat mark could not take a warning's colour; they render as a
different picture on every platform; they sit off the text baseline; and they have tone, which is
a strange thing for a life-safety warning to have. Worse, nothing tied them together — heat was a
sweating face in five places and a flame in two, and rain was a cloud, a droplet or an umbrella
depending on which loader drew it. The sprite is one glyph per *concept*, so those are now the
same picture everywhere.

It is inline rather than a CDN set for the same reason Meteocons has a fallback at all: a page that
someone opens during severe weather cannot have its icons fail with the network. Inline also means
no origin to add to the CSP. `tools/check.py` fails if a name has no `<symbol>`, or if a `<symbol>`
has no caller — a `<use>` pointing at a missing id renders *nothing at all*, with no error anywhere,
so a typo in one arm of `hazIcon()` would silently drop an icon and stay dropped. Meteocons still
draws the sky in colour in the hero and the 24-hour chart, and `wxiFail()` now falls back to a
sprite glyph at the size the dead `<img>` had reserved.

## Severity is one ramp

`alertLevel()` returns one of `emergency → warning → watch → advisory → statement`, and the level
sets `--lv` on the card; every tinted thing inside it — the rail, the tint, the tier tag, the
progress bar, the "what to do" block — reads that one variable, mixed with `color-mix()` so the
tints follow the light theme instead of staying tuned to the dark one. This replaced two functions
that classified the same alert by two different rules at once: `alertClass()` on CAP `severity`
and `alertTier()` on the word in the event name. They disagree in practice — a Flood Advisory can
carry severity `Severe` — so a card would arrive tinted by one and tagged by the other. The ramp
ranks by the word, because that is what the reader is being asked to act on, and lets CAP severity
escalate (never demote) a step above it; a tornado warning is promoted outright, being the one
event where the word and the stakes are not the same size. The event *family* (`eventFamily`) is
*not* part of this and stays a separate axis: it answers "what kind of weather", which is a
different question from "how bad".

A **watch** is the one thing that escalation may not touch. NWS ships Tornado Watch with severity
`Extreme` — alone among watches; a sweep of every active watch in the country found `Severe` or
below on all the rest — so the rule was not handling an unusual product, it was firing on exactly
one product and firing wrong. A watch says conditions are becoming favorable, which is the tier the
word already names, and the emergency ramp is red, *pulses*, and never folds: a Tornado Watch was
arriving in the exact chrome of the Tornado Warning it most needs to be distinguishable from.

## Severity is not the sort key — location is

The office issues for forty-odd counties and the reader is standing in one spot in them, so
`cardCmp()` ranks coverage above level: an emergency leads, then everything covering this location
whatever its level, then everything else. It used to sort on level first, which reads right and
isn't — `alertLevel()` promotes every Tornado Warning to `emergency`, so a tornado two counties
away outranked a Severe Thunderstorm Warning genuinely overhead. Your Heat Advisory now sits above
a distant Winter Storm Warning, which is the correct answer to "what should I look at".

Severity sets how loud a card is; it never sets whether the card is *about you*. So it decides
nothing about which **section** a card lands in — that is coverage, alone. There used to be an
exception here, hoisting any emergency-level alert into the local section from anywhere, and what
it shipped was a card sitting under a heading that means "for this place" wearing a badge that said
it wasn't. A reader resolves that contradiction while deciding whether to move their family. The
distant tornado leads the elsewhere list instead, red rail and all. `cardCmp()` is unchanged by
this and simply runs inside each section now, so "an emergency leads" means it leads its own list;
the coverage term in it still does real work in the degraded flat mode, where zones never resolved
and one list holds everything.

## Coverage

Coverage is decided by `alertCoversMe()`, which is two tests because NWS issues alerts two ways:
storm-based warnings carry a polygon and get a real point-in-shape ray-cast (holes included), while
watches and advisories carry `affectedZones` and get an exact match against the zone URLs `/points`
hands us for this location. It returns *which* kind of match it was, so a badge can never claim
more than the evidence supports — "your forecast zone is included" is a different statement from
"you're inside this area", and NWS issues zone products against forecast zones rather than counties.
If `/points` fails the whole thing fails **open**: coverage becomes unknowable, nothing is ranked
down, and the list goes flat. A cluttered list is a much smaller failure than a hidden warning.

## Grouping is by event *and* coverage

NWS ships one record per zone group, so segments have to be consolidated or the list reads as a
dozen copies of one storm — but consolidating on the event name alone did it too well. A Severe
Thunderstorm Warning over this location and a different one three counties east arrived as one
card, flagged as covering you, wearing the union of both county lists: the local storm described
with geography that wasn't its own, and the distant one with no existence in the list at all. The
same hazard can now hold a card here and a card elsewhere, and neither speaks for the other. The
family fold (`FAMILY_CFG.merge`) is keyed the same way, and the two-way polygon↔card link on the
radar carries a `data-scope` alongside the event name, because a name no longer identifies a card
by itself.

## The rest of the office's area stays on the page

Alerts that don't cover this location sit below the local banners under one eyebrow, at one line
each. They used to live behind a collapsed "N alerts elsewhere" disclosure, which answered "is
anything out near me" with a number and made the reader tap to find out what. The rows are the
*same* `.alert` banner as the local cards — the section only takes things away (the subline, some
padding, some weight) and the existing head toggle puts them back — so there is one card renderer,
not a compact one drifting away from a full one. The separation is structural rather than tonal:
no tint, a thinner rail, smaller type, and deliberately no opacity. Dimmed text on a tinted rail
is how the contrast work gets undone, and these are still watches and warnings for somebody.

When nothing covers this location the section opens with the all-clear line, which is the answer to
the only question the reader came with. Its *voice* is conditional, though: with an emergency in
the list below, a glowing green dot sitting directly on top of a red tornado rail is the page
arguing with itself, so the row keeps the fact and drops the good news — muted, no glow — and names
what is running nearby rather than leaving it to be scrolled to.

## The page spends colour like it is scarce

Saturated colour means severity, and links are blue. That is the whole budget. Countdowns moved
off `--accent` for exactly that reason: rendered in the link colour, "23h 16m left" read as
something you could click.

## Type carries the hierarchy

Sizes come from `--fs-*`, radii from `--r-*`, spacing from `--sp-*`. There were 23 distinct font
sizes and 19 pill classes that each defined their own geometry from scratch, which is how chips
sitting side by side in one card ended up with radii between 8px and 22px. The pill classes all
still exist by name — the JS builds them by name and restored snapshots carry those names — but
they now declare only what differs. Anything naming a region of the page (card titles, band rails,
the Bottom Line's own label) is the *eyebrow*: `--fs-xs`, 700, uppercase, `--ls-eyebrow`, muted.
There used to be three idioms for that one job. Chart and station-plot internals deliberately stay
on explicit pixels: those values are tuned to SVG geometry, not to the text system, and folding
them into the type scale would be a category error.

## The page is ordered by what a visitor came for

Alerts first (in calm weather that card collapses to a single all-clear line), then the Bottom
Line, then The Pulse, then the hero band — "Now" on the left, the Sky card on the right — then the
next 24 hours in a full-width band of its own, and finally the masonry.
The Bottom Line (né The Call; ids are still `callCard`/`callRow`) is the page reasoning on the
visitor's behalf rather than handing them numbers: rain/storm windows, heat and cold, UV with a
burn clock, wind, air quality, a temperature-crash warning, climate records — and one synthesized
verdict that scores every daylight hour on comfort, rain risk and wind to name the best two-hour
window to be outside, spoken only when the day has adversity worth dodging. It ranks directly
under safety, so the card is on the first screen whatever the weather is doing.

Its presentation is a decision briefing, not a pill cloud. `buildBottomLine()` receives structured
candidates and chooses one actionable lead; climate context can never take that slot, and the
rain/no-rain candidate is the fallback when the forecast offers no stronger decision. Up to three
supporting cues are then ranked by consequence: useful wet timing receives a protected rank, while
a dry forecast competes normally with air quality, wind, overnight comfort and other decisions.
Duplicate topics collapse before selection, so two ways of describing the same cold trough or heat
episode cannot consume the card.

The synthesized outdoor window now searches the full forecast horizon, including tomorrow after
an evening page load. For heat and wind, that candidate can be folded into the lead as an exact
two-hour plan and removed from the support list. Rain and storm timing stay separate: the endpoint
of the most comfortable pair of hours is not evidence that a storm begins then, so it can only
appear as an explicitly labelled supporting window and never as “finish by” guidance. A matching
storm alert suppresses that comfort cue entirely. The Alerts section remains the safety authority;
the strongest active local alert changes matching Bottom Line wording into an action without
copying the product title, and a short-fuse storm warning always says to shelter now rather than
allowing any later forecast window to qualify the warning.
Historical context fills a spare support slot
only when the lead itself is neutral or good; a warning never spends scarce space on a record fact.
Below 600px that optional context cue yields the space entirely because the same information
remains available in the Climate section.

The header’s horizon is computed from the last hourly period (“Through Fri 9 PM”) rather than
promising a generic 24 hours. The renderer preserves the hierarchy in DOM order — heading, lead,
semantic support list — and uses severity colour only when the underlying candidate warrants it.
The blocks are deliberately not pill-shaped and have no hover state: they are readings, not
controls.

All hourly decisions run through `bottomLineHours()` and the pure
`bottomLineHourlyCandidates()` before rendering. That boundary is intentional safety engineering:
thresholds, wet-block timing, daylight continuity, missing-data behavior and slower-feed inputs can
be tested without a DOM or a live forecast. “Dry air” requires an actual dew point, an outdoor
window requires two truly consecutive hours carrying NWS `isDaytime`, and a local warning or
emergency can promote its matching forecast candidate over an unrelated numeric priority. If an
emergency has no matching evidence to translate, the briefing yields rather than placing an
unrelated recommendation directly below the emergency banner. Air-quality, smoke and fog products
use exclusive semantic matches so their fallback alert styling cannot accidentally rewrite storm
or fire-weather guidance.

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
never actually been handed (see below).

One thing to know before touching `extractAFD`: its Synopsis and Short-Term fallbacks currently
match **nothing** on this office's products. LSX writes `.SHORT TERM /THROUGH THURSDAY/...` and the
pattern wants `.SHORT TERM...`, so the qualifier between the name and the dots defeats it. It goes
unnoticed because Key Messages was present in all 21 recent products sampled, so the first branch
always wins. That is pre-existing and deliberately left alone — fixing it changes what the card
*says*, which deserves its own review. It is also the input the clamp was built for, so if it is
ever fixed, re-measure before reaching for one again.

`.railhead` labels name each band — "Right now", "Next 24 hours", "The week ahead" — so the scroll
has a spine. The grid renders in DOM order (no card carries a CSS `order`), so the sequence above
is exactly the source order of `index.html`.

## The 24-hour chart is never nested inside `#current`

It has its own full-width card (`#h24Card`) below the hero pair; it previously sat inside
`#currentCard` as a *sibling* of `#current`, which was a different arrangement of the same
constraint. `loadCurrent()` rebuilds `#current` wholesale — including on failure — so nesting the
chart inside it would let a dead observation feed take the forecast chart down with it, breaking
the failure-ownership rule below. Wherever the chart lives next, it does not live in there.

The chart measures its own container and thins its labels to fit: all 24 hour labels at full width,
12 when the layout stacks below 1100px, with per-hour detail on hover at every size. Worth knowing
that the threshold it switches compact geometry at is 680px of *container*, not of viewport — in the
hero column it was 617px before the page shell and 456px after, so a desktop was drawing the phone's
chart. That, rather than the whitespace, is what moving it out actually fixed.

## UV and air quality are tiles beside the metric grid, not inside it

They answer the same question as each other — how much is this going to cost me to be outside — so
they sit together in `.cc-expo`, wearing `.cc-item`'s chrome because the card should speak one
language. They stay *out* of `.cc-grid` on purpose: those six tiles are what the `Observed … KSUS`
footline describes, and UV and AQI come from Open-Meteo, so folding them in would make that line
assert something false. The footline names Open-Meteo for exactly that reason. They were four
run-on sentences at 12.5px until the burn clock read identically to a record from 1936; the fix
was hierarchy, not smaller type. Below them the climate line labels its figures (`NORMAL`,
`RECORD`) and drops the words "record high" and "low", because a warm/cool colour pair says it in
no characters at all, and every credit — observation age, station, records station, AirNow —
collects into one dimmer line that reads as a caption rather than a fifth row of data.

One thing there is load-bearing: the severity palettes (`uvLevel`, `aqiInfo`) are tuned for the
dark panel and arrive as inline colours, so a light-mode `filter` darkens them as a group — at tile
size, AQI "Moderate" on the light panel is otherwise 1.3:1.

## The hero row is a pair of stacks, but only on wide screens

Left is the conditions card (+ AQI when it's notable); right is the Sky card. Below 1100px they
stop being a pair and both go full width. Forcing the pair back on at 1024x768 to measure what
keeping it would cost: a 619x348 map beside a 319px reading column, against a 954px map and the
full 988px to the readings when stacked.

Width is the whole argument now, and it did not use to be. The original note leaned on the columns
also coming out ~400px unequal, but the 24-hour chart moving to its own band took that much off the
left column, and the forced pair at 1024 lands 59px apart. Cramping stands on its own: neither a
619px map nor a 319px reading column is doing its job at that size. Note also that the map's height
below the breakpoint is whatever the 62vh ceiling allows rather than a fixed number — 476px at 768
tall — so widths are the comparison that stays true across viewports.

## The reading column gives; the map doesn't

The two halves are sized by different rules — the conditions card's height is whatever its content
comes to, the Sky card's is its width over an aspect ratio — so they never naturally agree. Since
the page shell the Sky card is the taller of the two, and the difference showed as a notch under
the readings: 103px at a 1400 shell on a calm evening. The left column stretches to the row now
and the readings spread into it. Growing the *map* to close it is the mistake its aspect rules
exist to prevent (at 894px wide, tall enough to match is 1.2:1), and growing the metric tiles
instead only relocates the hole into them — a taller tile parks its label at the top of a bigger
box, so 103px buys six small holes in place of one big one.

## The Sky card is permanent

It used to earn its slot the way the AQI card does — shown only for a *radar-shaped* warning
family, a tornado/severe watch, precipitation falling now, or a wet next-few-hours, with a rail
button to summon it by hand on a calm day. That whole subsystem (`radarWorthy()`,
`RADAR_FAMILIES`, `THUNDER_MIN_POP`, `body.no-radar`, the show/hide toggle and a second full-row
layout for Current Conditions) is gone. The judgement it encoded was sound, but it was answering
"is the sky worth a map right now?" — and the honest answer for a weather dashboard is *yes, that
is what people came for*. Removing it also removed the only reason the page had two hero layouts,
so there is now one arrangement to reason about instead of two.

## Radar is a peek, not the product

Its height comes from an `aspect-ratio`, never from leftover space. An earlier version stretched
the map to match the left column, which made its size a side effect of how much content the
conditions card happened to have — that is how it ended up 660px tall on a calm day and *portrait*
(0.67) at 1000px, the worst possible shape for weather that moves west to east. It is now 16:9
(4:3 on phones), so it is landscape at every width, with fullscreen a click away for the "where
exactly, and when" case.

## Fullscreen moves the card, not the map

`body.radar-full` makes `#radarCard` fixed and full-viewport; the Leaflet instance, the loop, the
warning polygons and the layer toggles are untouched, so nothing needs re-initialising. Escape
closes it, focus returns to whatever opened it, and body scroll is locked so a wheel gesture over
the map can't scroll the page behind it. Leaflet is told to `invalidateSize()` twice — once
immediately, once after the transition — or it renders tiles for the old viewport. A
`ResizeObserver` on `#radar` covers the same hazard for any container-driven resize, which no
window event announces.

One non-obvious dependency: `body.radar-full` also has to clear the entrance animation on
`.grid>.stack`. `cardIn` ends on `transform:none`, but `animation-fill-mode: both` keeps the
animation's output applied forever after, and a *filled* transform still computes to a matrix
rather than to `none` — which makes the stack the containing block for `position:fixed`
descendants. Without that reset the fullscreen card resolves `inset:0` against its 824px column
instead of the viewport and opens as a sliver.

## The location search asks the geocoder several questions, not one

Open-Meteo's geocoder does no fuzzy matching at all — a name that doesn't match the stored spelling
character-for-character returns an empty list, not a near miss — and its index is inconsistent
about the abbreviations this area is full of. It holds *Lake Saint Louis*, *East Saint Louis*,
*Saint Ann* and *City of Saint Peters* spelled out, but *St. Louis* and *Mt. Vernon* abbreviated.
Typed the way everyone here writes them, "Lake St. Louis", "East St. Louis", "St. Ann" and
"Ste. Genevieve" all returned nothing, and "St. Charles" returned an airport plus a town in Kane
County, Illinois. So `queryVariants()` rewrites what was typed into up to six spellings —
St./Saint, Ste./Sainte, Mt./Mount, Ft./Fort, the directionals, the apostrophe repairs, `&`/and —
`geoLookup()` asks for all of them at once and merges by geoname id, and the ranking decides what
actually matched. Requests are memoised per variant string, so the next keystroke re-sends almost
nothing.

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

## Location generations

Every fetch that describes *a place* captures the generation it was issued under via `locGuard()`,
and checks `fresh()` before writing to the DOM. `setLocation()` increments the generation and
aborts the previous `AbortController`, so superseded requests are both cancelled and — if they
land anyway — discarded. This is why one town's numbers can never appear under another town's
label. Feeds that are *not* location-scoped (the CWA-wide alert list, the fixed river gauges, the
AFD, the regional station plot) deliberately opt out of both.

## Every loader owns its failure

Each has a `.catch` that degrades to an official link or to silence. One dead NOAA service must
never blank a sibling card. Error paints are generation-scoped too, so a superseded failure can't
deface the location that replaced it.

## Nothing unverified is printed

Climate statistics are gated on minimum sample sizes, ACIS departures carry missing-day counts
that are checked before use, and a figure borrowed from a different station is attributed by name.
Suppression beats false precision.

## Instant paint

Each refresh serialises the rendered HTML of ~22 cards into `localStorage`, so a return visit
paints a full dashboard before any network request. Each card carries its own TTL (alerts expire
after 15 minutes; drought after 48 hours). The warning banner is *never* restored, because it
asserts something about right now.

A snapshot is restored *markup*, painted under whatever stylesheet ships today — so reshaping a
card's DOM means bumping `SNAP_KEY`. Skip it and every returning visitor gets one visibly wrong
first paint: yesterday's elements picking up today's rules with none of today's structure. One
cold paint is the cheaper mistake.

## Adding a card, adding a loader

**Adding a card** means touching five places: the markup, the `RANK` map in `layoutMasonry`'s
`tier()`, `SNAP_PARTS`, the `SCHED` table, and `clearLocationUI`/`resetLocationState`.

**Adding a location-scoped loader** means a sixth: the `jobs` array inside `setLocation()`. `SCHED`
only governs the periodic refresh, and `refreshAll()` only covers the initial paint — a loader
missing from `setLocation` looks like it works, then silently never re-runs when the visitor
changes town. Worse, it can appear broken on first load too: geolocation resolves *after* the first
`refreshAll()`, so the generation bumps, the in-flight fetch is discarded by its own `fresh()`
guard, and nothing re-issues it.

## Radar and satellite are one widget, stacked

They answer the same question at different scales, so they share one Leaflet map: GOES cloud
shield underneath, reflectivity inside it, warning polygons on top. They were two alternating
*views* until the satellite source changed. NESDIS's sector product is a finished 600x600 JPEG in
a fixed frame — nothing in it says where its corners are and its projection isn't the map's, so it
could never be laid over the radar. NASA GIBS serves the same GOES-19 ABI GeoColor imagery as WMTS
in EPSG:3857, which registers with the radar at every zoom and pan, and the tabs became
independent layer toggles.

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

## The loop targets a duration, not a sweep count

It used to take `times.slice(-10)` and the Loop button's tooltip claimed "the last ~30 minutes".
Measured against the live WMS, NWS publishes `conus_bref_qcd` on a **120-second** cadence and
advertises 60 sweeps (~118 minutes), so ten sweeps was an 18-minute loop — and six, on a phone, was
ten. Long enough to prove a storm exists, too short to show where it is going, which is the only
question a loop answers. `RADAR_SPAN_MIN` (60) is now the target and
`RADAR_N_DESK`/`RADAR_N_PHONE` are a frame *budget*; `pickRadarTimes()` thins the window to fit.
Nothing hard-codes a duration any more — `radarSpanMin()` reads the built frame list and
`setRadarBtn()` writes it into both the tooltip and the `aria-label`, so the number a visitor
reads is the number of minutes on screen.

The thinning grid is **anchored to the epoch, not to "now"**, and that is the part worth not
undoing. `radarPool` keys on the timestamp string, so pooling only pays if a refresh asks for the
timestamps it asked for last time. Striding backwards from the newest sweep — the obvious
implementation — fails exactly that: two fresh sweeps land, every stride shifts two slots, and all
fifteen frames miss the pool and re-download every four minutes. Against a fixed grid the same wall
clock instants keep resolving to the same sweeps. Replayed over the archive, each refresh builds
**one** new layer and reuses fourteen, so an hour-long loop costs the same per refresh as the
18-minute one did.

## A dead feed must not look like clear skies

Every other feed on this page fails visibly, but a tile layer that fails leaves the basemap
showing, and a bare basemap under this card is what a calm evening looks like — the one wrong
answer a weather dashboard must never give confidently. Nothing was watching: `.imgfail` covers
only the case where Leaflet itself never loaded. `bindSkyHealth()` now counts
`tileload`/`tileerror` **per layer**, and that per-layer part is load-bearing: a shared counter
cannot work alongside pooling, because on a refresh fourteen frames are already painted and silent
(cached `<img>`s re-fire nothing), so a counter reset each cycle would read one new frame's
failures against zero fresh successes and cry outage over a map that is drawing perfectly. The
verdict is deliberately strict — errors *and* not one tile through — because radar tiles 404 at
the mosaic's edges routinely, and a badge that flickers red on ordinary noise is worse than no
badge.

`syncRadarBadge()` is the single owner of that badge. It used to be written from two places that
knew different things (`showRadarFrame()` had the timestamp, the `refreshRadarLayer()` catch had
the failure) and neither could say the thing that matters: whether what you are looking at is
current. It now distinguishes four states — current sweep, scrubbed back (amber), stalled, and
down (red). Stalled is its own case because it is the dangerous one: a real sweep, drawn
correctly, quietly `RADAR_STALE_MIN` minutes out of date reads as live to anyone who does not do
arithmetic against the header clock. The caption follows the same rule it always did, naming what
is actually drawn — which now has to include naming a layer that is switched on and failing, or it
goes from honest to crediting NOAA for reflectivity nobody received.

## The reflectivity key uses the server's own colours

The map painted a ramp and nothing said what it meant. The gradient stops in `.rl-bar` were
sampled per-5-dBZ out of this layer's `GetLegendGraphic` rather than eyeballed, so the key cannot
drift from what GeoServer draws; the scale runs 15→65 dBZ and the tick words sit at their real
positions, `(D−15)/50`. It is `role="img"` with an `aria-label`, because read linearly the ticks
are "light heavy hail", which is noise. It hides when reflectivity is off *or* down — a guide to
colours the map is not painting is clutter.

## The satellite follows the scrub, and the reason it does not follow playback is bytes

Scrubbing the radar back an hour used to leave the cloud shield at "now" — the storm in the past
and the system carrying it in the present, drawn as one picture, which is the exact thing stacking
the two layers was supposed to prevent. `syncSatToRadar()` re-points the satellite to the newest
GOES frame at or before the displayed radar moment.

An earlier version of these notes blamed the archive's gaps for there being no GOES time track at all.
That was the wrong diagnosis. The gaps are real — measured across three hours, only 11 of 18
nominal 10-minute slots existed, and a missing slot is a hard 404, so the moments must be
**discovered** rather than computed. But discovery is cheap: `DescribeDomains` bounded to a few
hours answers in ~350 bytes. (Unbounded it returns the archive back to 2021, about 1 MB, which is
presumably what made this look impractical.) Two details bite: the time is a segment of its own
**after** the style (`…/GOES-East_ABI_GeoColor/default/{time}/GoogleMapsCompatible_Level7/…`) —
putting it where `default` sits answers 400 for every tile — and the domain is a list of
`START/END/PERIOD` *intervals*, which is how the gaps are encoded, so it has to be expanded before
anything can snap to it.

The real constraint is tile weight. Measured: a reflectivity tile is **1,980 bytes** (sparse,
transparent), a GeoColor tile is **113,601 bytes** (opaque, full colour) — **57× bigger**. That
one ratio explains the whole design: the radar keeps ~15 frames alive, the satellite keeps exactly
**one**, and nothing preloads a parallel stack. It also decides the playback exemption — a
GeoColor frame is ~450 KB for this map, and fetching that every 450 ms would stall the loop rather
than enrich it. Playback therefore triggers no satellite work at all (verified: zero swaps, zero
tile requests across a running loop); pausing syncs once to wherever the visitor stopped. A drag
is coalesced behind a 180 ms timer and a swap generation counter, because tiles do not come back
in request order and a slow early frame must not paint last.

`gibs.earthdata.nasa.gov` appears in **both** `img-src` and `connect-src`, which looks like a
duplicate and is not: the tiles are images, the timestamp list is a fetch.

## The frame budget answers to zoom, because tile cost does

Every pooled frame refetches on a view change, and a low-zoom `GetMap` covers far more ground:
measured against the live WMS, a median **5.9 s** per tile at z4 (p95 10.1 s), **120 requests**
for fifteen frames, ~8 seconds before the set was whole again. The loop meanwhile kept stepping on
its 450 ms timer onto frames whose tiles had not arrived — which paints nothing and reads as *the
loop broke*. That is what it was: reported as "the satellite stops looping when I zoom out", and
the satellite had nothing to do with it.

Two changes. `radarFrameCount()` now returns `RADAR_N_WIDE` (7) at or below `RADAR_WIDE_ZOOM` (5)
— detail is not what a continent-wide view is for, and the *span* is unaffected, so the loop still
covers its hour, just in coarser steps. The budget is re-picked on `zoomend` from
`radarTimesCache` rather than waiting for the next 4-minute refresh, which would have left fifteen
layers thrashing across a z4 view for minutes. Measured after: **48 requests** instead of 120.

And `radarStep()` holds rather than advancing through unpainted frames, showing `loading frames…`
in the `.rc-load` slot — a style that had existed with no element behind it since the scrubber
shipped. The hold tests Leaflet's `_loading`, not the frames' own `_ready`: `_ready` is set by the
first load ever and never cleared, so it stays true through a zoom that has invalidated every tile
behind it. The hold is bounded at `RADAR_HOLD_MAX` (9 s) so a frame that never settles cannot
freeze the loop for good.

## Only the basemap is credited on the map

The NOAA and NASA lines used to ride along in the Leaflet attribution, and on a 375px phone all
four wrapped to three lines: 46px over a 236px map, a fifth of the picture. They were never
load-bearing — `#rsCap` names every source that is drawing and the
[licence table](README.md#license) lists all of them — so CARTO and OSM stay (their terms ask for
a link on the map itself) and the rest moved to the caption. The bar is one 15px line now. This
also un-broke the map lock: `.maplock` sat at z-index 3 while Leaflet's control containers sit at
1000, and `#radar` sets no z-index so it never opens a stacking context to trap them. The controls
won, the attribution landed exactly where a bottom-centred pill lands, and `elementFromPoint` on
the middle of "Tap to interact" returned the OpenStreetMap link — the affordance announcing the
map was interactive was a link to openstreetmap.org. The overlay now sits above the controls, so
locked means locked (including the zoom buttons, which used to poke through and work while the map
said it was not listening).

## Off has to mean off the map, not hidden

The first cut toggled the radar by setting `display:none` on its pane, which looks equivalent and
isn't: a Leaflet layer that is merely invisible is still on the map, and `GridLayer` requests
tiles for the current view on every `moveend` regardless of whether anything can see them.
Measured, one pan across the state pulled ~90 reflectivity tiles with the layer "off".
`detachRadarLayers()` now removes the fallback layer and every pooled sweep and *clears* the pool
— clears, because `buildRadarFrames()` only calls `addTo()` for timestamps it hasn't seen, so a
pool of detached layers would be silently reused on the way back and draw nothing. Rebuilding
costs one capabilities fetch, and those sweeps would be stale by then anyway.

The satellite refresh swaps layers rather than calling `redraw()`, which drops every tile first
and leaves a hole while replacements load: build the new layer, swap once it has painted.
Both-layers-off is reachable by clicking but is never *restored* from `localStorage` — landing on
a bare basemap with nothing on screen explaining why is a broken first impression.
