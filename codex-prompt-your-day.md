# Codex task: fix the "Now" takeaway and the "Your day" card logic

## Context

Repo: `mkasseb/lsxdashboard`. This is a static weather dashboard with no build step and no npm dependencies; the plain JS lives in `assets/`. The two sections in scope are:

- **The Now takeaway (the "lead")**: the one-line card beside the current temperature, rendered into `#ccTake` by `paintNowTakeaway()` in `assets/dashboard.js`.
- **The Your day card (`#glanceCard`)**: the supporting rows plus the "Wear" row, rendered by `renderGlance()` in `assets/dashboard.js`.

Both are built from candidates:

- `bottomLineHourlyCandidates(H, opts)`, `bottomLineWeekCandidates(days, cutoff, hourly)`, `buildBottomLine(candidates, localAlert)`, `glanceWear(H)`, `coldVerdict()` and `bottomLineHours()` live in `assets/weather-core.js`.
- The caller is `renderTheCall` (around `assets/dashboard.js:1600–1660`), which also adds the climate "context" candidates.
- Climate records and normals come from `ctx` / `contextRecord()` / `ctxRankBelow()` in `assets/climate-view.js`.

### The bad output we are fixing (real screenshot, Wed Nov 18, 8:40 AM, O'Fallon MO)

- Observed: feels like 34°, clear, calm, dew point 30°, humidity 86%. Today's range is 42→66°.
- Lead: **"Cold · Cold morning · 42° near 8am. · Dress for the cold."**
- Your day row 1: **"Week ahead · Rain — Rain possible Saturday night. NWS precipitation chance 46%."**
- Your day row 2: **"Wear — Warm jacket. Feels like 38–66° while you're out · dress in layers."**

## Problems, in priority order

1. **Bug: dedup by topic drops today's rain answer.** The hourly "Rain unlikely / Rain possible" candidate (priority 40, topic `precip`) and the week-ahead rain candidate (priority 51, topic `precip`) collide in `buildBottomLine`'s one-per-topic dedup. Saturday's rain wins, so a card labelled "Next 24 hours" never answers "will it rain today?". Week-ahead storm and snow use the topics `storm` / `winter`, so only rain hits this.
2. **The lead describes the hour already in progress.** `bottomLineHours()` keeps `H[0]` even when it started 40+ minutes ago. The 6–9am morning-minimum search then reports "42° near 8am" at 8:40am.
3. **The forecast contradicts the observation.** On one screen the hero says feels like 34° (observed), the lead says 42° (forecast air temp) and Wear says 38° (forecast feels-like). For the current hour, the fresh observation must win.
4. **"Cold morning" fires on ordinary days.** `coldVerdict()` returns `"cold"` for any morning ≤45°, at priority 70. Normal mid-November lows in St. Louis are in the mid-30s, so this leads almost every day from October to April.
5. **Redundancy.** The label "Cold", the headline "Cold morning", the action "Dress for the cold" and the Wear row "Warm jacket" all say one thing. Dedup compares topic strings, so `cold` and `wear` count as different topics.
6. **The day's real story is missing.** There's a "Sharp temperature drop" rule but nothing for a big warm-up. "Excellent outdoor conditions" needs every daytime hour ≥58°, so one cold morning hour rules out the whole day.
7. **Wear treats the whole day as one block.** It chooses the clothing tier from the minimum feels-like only, so "Warm jacket" is shown for a 66° afternoon.
8. **No frost cue.** Clear + calm + dew point ≤32° + temp ≤36° near dawn is radiational frost. The freeze logic only fires at air temp ≤32°.

## Required changes

### A. Separate today from later (fixes #1)
- Week-ahead candidates must never share a dedup key with hourly candidates. Dedup on `horizon + topic` (or give week candidates `week-` prefixed topics), whichever is cleaner.
- When hourly data is usable, Your day **always** includes exactly one today-rain row, even when the answer is "Dry today". Example: `Rain · Dry today · under 10% through 8am tomorrow`.
- Week-ahead items take at most one row. That row goes **last**, labelled `Later`. It must not use the "Next 24 hours" scope or outrank any today row.

### B. Look forward only (fixes #2)
- In the candidate logic, ignore hourly periods that started more than 30 minutes before `now` when computing morning minimums, "near X" timing and first-freeze timing. Don't delete them from `H` globally if other code relies on them; filter where the timing claims are made.
- If the only morning hours left are tomorrow's, the wording must say "tomorrow". `whenWord()` already does this, so make sure it's used.

### C. The observation wins for "now" (fixes #3)
- Pass the fresh current observation into the candidate builder through `opts`, e.g. `opts.obs = {t, fl, at}`. Use `currentObservationFresh()` to decide whether it's usable.
- When it's fresh, any claim about the current hour uses the observed value. Optional: if the obs and `H[0]` differ by ≥5°, shift the next ~3 forecast hours toward the obs with linear decay. Only do this if it stays simple and well tested.
- Wear's low end must be no warmer than the fresh observed feels-like while the current hour is inside Wear's window.

### D. Judge cold against normal (fixes #4)
- Replace the fixed 45° "cold" threshold with a comparison to climatology when climate data is ready. Use `ctx.doyLo` / `contextRecord()` and follow the patterns already used for the "Unusually warm/cool" context candidates.
  - Suggested rule: lead-worthy "Cold morning" only when the morning low is in the bottom ~15% for the date, or ≥8° below normal. Copy says so, e.g. "Coldest morning since March" or "9° colder than normal".
  - If climate data isn't ready, fall back to a stricter fixed threshold (e.g. ≤35°) at a **lower** priority (≤50), so it can't take the lead from more useful facts on a quiet day.
- Keep the existing freeze / hard-freeze / dangerous-cold logic and priorities unchanged.

### E. Group topics by meaning (fixes #5)
- Add a topic-family mapping: `{cold, wear, freeze} → "temperature-cold"`, `{heat, uv, wear} → "temperature-warm"`. When the lead is in a temperature family, merge Wear into the lead's action line ("Jacket until ~11am, sweater after") instead of showing a separate Wear row.
- Delete actions that just repeat the headline. Remove "Dress for the cold.", "Keep an eye on the forecast for outdoor plans." and "Keep checking the forecast before outdoor plans.", or replace them with `""`. Empty actions must not render.

### F. A good-day / warm-up lead (fixes #6)
- Add a "warming" counterpart to `"falling"` in `coldVerdict()` / the candidate builder. Fire it when today's high minus the current (observed) temp is ≥18° and there's no hazard. Headline example: `Chilly start, mild afternoon`. Detail: `34° now → 66° by 2pm`, plus `· N° warmer/colder than normal` when climate is ready.
- Relax "Excellent outdoor conditions" so it judges the core outdoor hours (e.g. 11am–6pm) rather than every daytime hour, or let the warm-up candidate cover that case. Pick one approach and document it in a comment.
- This candidate's priority goes above the context garnish and above the new fallback cold (D) but below every hazard (≥60).

### G. Wear with times (fixes #7)
- `glanceWear()` should find where the forecast crosses its tier thresholds inside the window and phrase the advice with times, e.g. `Jacket until ~11am, then a sweater` and `cold again after sunset (4:47)` when the evening drops back a tier. Sunset is already shown in the Now card; reuse its source.
- Keep the return shape backward compatible (`lo`, `hi`, `umbrella`, `boots`, `layers`). Add new fields rather than renaming.
- Still fail quiet (`null`) on fewer than 3 usable hours.

### H. Frost cue (fixes #8)
- New candidate: between ~3am and 9am (forward-looking only, see B), sky clear/mostly clear (NWS shortForecast wording), wind ≤5 mph, dew point ≤32°, temp ≤36° → `Frost possible` / `On windshields and roofs near 6am.` Tone `warning`, priority just below the existing freeze candidates (~80). Suppress it when a freeze candidate already fires.

## Out of scope (don't do in this PR)
- User-entered commute or schedule times.
- Any change to alert handling, the NBM commentary (`renderTheCall._nbmContext` must keep receiving the same model shape), radar or other tabs.
- Visual redesign. Small CSS additions for a `Later` row label are fine.

## Constraints
- Follow the existing code style: ES5-ish, `var`, no new dependencies, no build step. Comments explain *why*, like the existing ones do.
- Keep `buildBottomLine`'s alert-priority behaviour exactly as it is: warnings override, emergencies withhold, and urgent-storm wording stays.
- Keep the "How this is worked out" `<details>` text in `index.html` accurate: update it to describe the obs-vs-forecast rule, climate-relative cold and the Today/Later split.
- No change to the `#ccTake` / `#glance` DOM contract unless a test is updated alongside it.

## Tests (required)
Add cases to `tools/logic-tests.js` (and `tools/seasonal-tests.js` where it fits) using the existing `SUBJECT.*` lift pattern:

1. **Nov 18 regression fixture:** now = 8:40am, observed temp 34° / feels-like 34°, hourly 42°→66° dry, week has Saturday night PoP 46%, climate normal low ~35°.
   - The lead is **not** "Cold morning" and contains no "8am" timing.
   - A today-rain row exists and says dry.
   - The Saturday row is labelled `Later` and comes last.
   - Wear's low ≤ 34 and its text includes a time ("until ~").
2. Dedup: an hourly `precip` candidate and a week `precip` candidate both survive.
3. A past-hour exclusion test for the morning minimum.
4. Climate-relative cold: the same 40° morning leads in a week with normal low 55° and does not lead with normal low 36°. With climate not ready, the fallback threshold and lower priority apply.
5. Frost: fires on clear/calm/dew 30°/temp 34°; doesn't fire at wind 12 mph or under a freeze candidate.
6. Warm-up lead fires on a 34→66° dry day and never outranks a hazard candidate.
7. Empty actions don't render (check `renderGlance` output in the existing browser/glance test if practical: `tools/glance-browser-tests.js`).

Run everything CI runs before opening the PR (see `.github/workflows/checks.yml`). At minimum:
```
python3 tools/check.py
node tools/logic-tests.js
node tools/seasonal-tests.js
node tools/weather-contract-tests.js
node tools/nbm-briefing-tests.js
```
Update any existing assertions that encoded the old behaviour (e.g. "Cold morning" at 45°, "Dress for the cold."), and say in the PR description which ones changed and why.

## PR description should include
- A before/after of the Nov 18 example (text is fine).
- The list of problems 1–8 and how each was fixed.
- Any threshold you chose (percentile, degrees, priorities) and why.
- Anything you deliberately left out.
