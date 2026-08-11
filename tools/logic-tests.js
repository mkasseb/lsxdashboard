#!/usr/bin/env node
/* Unit tests for the pure decision functions in index.html.
 *
 * There is no build step and no package.json, so there is nowhere to import from — these lift the
 * functions out of the source by name and run them. That is uglier than a module boundary and it
 * is the honest trade: the alternative is a bundler, a dependency tree and a lockfile in a repo
 * whose whole premise is that you can edit one file and reload the page.
 *
 * Only functions that decide something belong here. Anything that paints is left to the eye — a
 * test asserting that a <span> has a class is a test of the test.
 *
 * Run locally with:  node tools/logic-tests.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* Pull a top-level declaration out of the source by name. Anchored to a line start and closed by a
   brace in column 0, which is how every function in the file is written; a rename or a re-indent
   fails loudly here rather than silently testing nothing. */
function lift(pattern, label) {
  const m = SRC.match(pattern);
  if (!m) {
    console.error(`FAIL  lift: could not find ${label} in index.html.`);
    console.error('      It was renamed, re-indented, or removed. Fix the pattern in this file,');
    console.error('      or delete the tests that cover it — do not leave it silently unrun.');
    process.exit(1);
  }
  return m[0];
}

const SUBJECT = new Function(`
  ${lift(/^function rangeMark\(lo,hi,now\)\{[\s\S]*?^\}/m, 'rangeMark()')}
  ${lift(/^function rangeRow\(d0,d1,now\)\{[\s\S]*?^\}/m, 'rangeRow()')}
  ${lift(/^function alertParas\(txt\)\{[\s\S]*?^\}/m, 'alertParas()')}
  ${lift(/^var LEVELS=\{[\s\S]*?^\};/m, 'LEVELS')}
  ${lift(/^function alertLevel\(p\)\{[\s\S]*?^\}/m, 'alertLevel()')}
  ${lift(/^function isTakeCover\(lv\)\{.*\}$/m, 'isTakeCover()')}
  ${lift(/^var ALERT_SEV_RANK=\{[\s\S]*?\};/m, 'ALERT_SEV_RANK')}
  ${lift(/^function cardCmp\(a,b\)\{[\s\S]*?^\}/m, 'cardCmp()')}
  ${lift(/^var HIT_RANK=\{[\s\S]*?\};/m, 'HIT_RANK')}
  ${lift(/^function strongestHit\(kinds\)\{[\s\S]*?^\}/m, 'strongestHit()')}
  ${lift(/^function alertScope\(hit,localMode\)\{[\s\S]*?^\}/m, 'alertScope()')}
  ${lift(/^function scopeAttr\(hit,localMode\)\{.*\}$/m, 'scopeAttr()')}
  ${lift(/^var FAMILY_CFG=\{[\s\S]*?^\};/m, 'FAMILY_CFG')}
  ${lift(/^var LAYERS_MAX=\d+;/m, 'LAYERS_MAX')}
  ${lift(/^function coldVerdict\(nowT,mMin,cMin\)\{[\s\S]*?^\}/m, 'coldVerdict()')}
  ${lift(/^function compactDayName\(name\)\{[\s\S]*?^\}/m, 'compactDayName()')}
  ${lift(/^function compactCondition\(text\)\{[\s\S]*?^\}/m, 'compactCondition()')}
  ${lift(/^function summaryPop\(pop\)\{[\s\S]*?^\}/m, 'summaryPop()')}
  ${lift(/^function forecastImpact\(feels,air\)\{[\s\S]*?^\}/m, 'forecastImpact()')}
  ${lift(/^var OUTLOOK_CFG=\{[\s\S]*?^\};/m, 'OUTLOOK_CFG')}
  ${lift(/^function outlookVerdict\(cfg,l0,l1\)\{[\s\S]*?^\}/m, 'outlookVerdict()')}
  ${lift(/^function parseMcd\(text\)\{[\s\S]*?^\}/m, 'parseMcd()')}
  ${lift(/^function mcdValidEnd\(v,refMs\)\{[\s\S]*?^\}/m, 'mcdValidEnd()')}
  ${lift(/^function geomTouchesEnv\(geom,env\)\{[\s\S]*?^\}/m, 'geomTouchesEnv()')}
  ${lift(/^function watchBoundary\(feats\)\{[\s\S]*?^\}/m, 'watchBoundary()')}
  ${lift(/^function chaikinRing\(ring,iters\)\{[\s\S]*?^\}/m, 'chaikinRing()')}
  return { rangeMark, rangeRow, alertLevel, isTakeCover, cardCmp, strongestHit, alertScope, scopeAttr,
           FAMILY_CFG, coldVerdict, compactDayName, compactCondition, summaryPop, forecastImpact,
           OUTLOOK_CFG, outlookVerdict,
           parseMcd, mcdValidEnd, geomTouchesEnv, watchBoundary, chaikinRing };
`)();

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) return;
  console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
  failed++;
}

/* ============ rangeMark ============ */
// The hero's range bar. Left end is the earlier reading, right end the later one.
{
  const R = SUBJECT.rangeMark;

  // Ascending: the ordinary case, and the numbers behind the screenshot this was reported from.
  check('rangeMark ascending, now near the low end', R(78, 96, 81), 3 / 18);
  check('rangeMark ascending, now at the low end', R(78, 96, 78), 0);
  check('rangeMark ascending, now at the high end', R(78, 96, 96), 1);

  // Descending — tomorrow colder than tonight, i.e. a front arriving overnight. This is the case
  // the old hi>lo guard rejected, taking the whole row off the page with it.
  check('rangeMark descending, now midway', R(62, 48, 55), 0.5);
  check('rangeMark descending, now at tonight (warm) end', R(62, 48, 62), 0);
  check('rangeMark descending, now at tomorrow (cold) end', R(62, 48, 48), 1);
  check('rangeMark descending by a single degree', R(60, 59, 59), 1);

  // Out of range clamps to the track rather than running off it, in both directions.
  check('rangeMark ascending, now above both', R(78, 96, 120), 1);
  check('rangeMark ascending, now below both', R(78, 96, 40), 0);
  check('rangeMark descending, now above both', R(62, 48, 70), 0);
  check('rangeMark descending, now below both', R(62, 48, 30), 1);

  // No mark, but these must not suppress the row — the caller draws the bar regardless.
  check('rangeMark identical ends', R(60, 60, 60), null);
  check('rangeMark with no observation yet', R(78, 96, null), null);
  check('rangeMark missing an end', R(null, 96, 81), null);

  // Never NaN: it would reach the DOM as left:NaN% and put the mark somewhere arbitrary.
  for (const args of [[60, 60, 60], [0, 0, 0], [null, null, null]]) {
    const v = R.apply(null, args);
    check(`rangeMark(${args}) is not NaN`, v === null || Number.isFinite(v), true);
  }
}

/* ============ rangeRow ============ */
// Which readings become the ends, and — the part that regressed — WHETHER there is a row at all.
// These assertions are the ones that matter: the arithmetic was never wrong, the guard was.
{
  const day = t => (t == null ? null : { day: { temperature: t }, night: null });
  const both = (hi, lo) => ({ day: hi == null ? null : { temperature: hi }, night: { temperature: lo } });
  const night = lo => ({ day: null, night: { temperature: lo } });
  const R = SUBJECT.rangeRow;

  // Daytime: today's own high and tonight's low.
  check('rangeRow daytime uses today', R(both(96, 78), day(90), 81),
    { lo: 78, hi: 96, nextDay: false, mark: 3 / 18, drop: null });

  // Evening: no daytime period left, so it borrows TOMORROW's high and says so.
  check('rangeRow evening borrows tomorrow and flags it', R(night(78), day(96), 81),
    { lo: 78, hi: 96, nextDay: true, mark: 3 / 18, drop: null });

  // THE REGRESSION. A front overnight puts tomorrow below tonight. The row must still be drawn —
  // this returned null for as long as the guard demanded hi>lo, taking the row off the page on
  // exactly the evening a reader most needs it.
  check('rangeRow still draws when tomorrow is colder than tonight', R(night(62), day(48), 55),
    { lo: 62, hi: 48, nextDay: true, mark: 0.5, drop: 14 });
  check('rangeRow draws a one-degree fall', R(night(60), day(59), 59),
    { lo: 60, hi: 59, nextDay: true, mark: 1, drop: 1 });

  // Identical ends: a real reading with nothing to mark. Row yes, mark no.
  check('rangeRow draws identical ends without a mark', R(night(60), day(60), 60),
    { lo: 60, hi: 60, nextDay: true, mark: null, drop: null });

  // No row only when there is genuinely no pair.
  check('rangeRow with no tomorrow to borrow', R(night(62), day(null), 55), null);
  check('rangeRow with no low', R({ day: { temperature: 96 }, night: null }, day(null), 81), null);
  check('rangeRow with nothing at all', R(null, null, null), null);

  // No observation yet: the row still draws, it just has no mark on it.
  check('rangeRow before the first observation', R(both(96, 78), day(90), null),
    { lo: 78, hi: 96, nextDay: false, mark: null, drop: null });

  // The "N° colder" cue. It speaks only when tomorrow's high lands under tonight's low, and only
  // in the evening branch — see the gate's comment in index.html for why that matters.
  check('drop is stated when tomorrow is colder', R(night(62), day(48), 55).drop, 14);
  check('drop is not stated when tomorrow is warmer', R(night(78), day(96), 81).drop, null);
  check('drop is not stated for identical ends', R(night(60), day(60), 60).drop, null);
  check('drop counts whole degrees from the pair', R(night(45), day(38), 41).drop, 7);

  // THE TRAP. In the daytime branch the ends are today's own low and high, stored with the LATER
  // reading (tonight's low) on the left — a range, not a sequence. A warm front overnight puts
  // today's high under tonight's low, which is the identical arithmetic meaning the opposite
  // thing. Saying "5° colder" there would be exactly backwards.
  check('no drop in the daytime branch, even when hi<lo', R(both(40, 45), day(50), 42).drop, null);
  check('...and that row still draws', R(both(40, 45), day(50), 42),
    { lo: 45, hi: 40, nextDay: false, mark: 0.6, drop: null });
}

/* ============ compact 7-day decisions ============ */
{
  const { compactDayName: day, compactCondition: cond, summaryPop: pop, forecastImpact: impact } = SUBJECT;

  check('long weekdays use deliberate abbreviations',
    ['Monday', 'Wednesday', 'Sunday'].map(day), ['Mon', 'Wed', 'Sun']);
  check('period names that are not weekdays survive',
    ['Tonight', 'Today', 'Independence Day'].map(day), ['Tonight', 'Today', 'Independence Day']);

  check('condition language keeps the useful distinction',
    [cond('Mostly Sunny'), cond('Partly Cloudy'), cond('Chance Rain Showers'), cond('Severe Thunderstorms')],
    ['Mostly sunny', 'Partly cloudy', 'Showers', 'Storms']);
  check('condition fallback preserves unfamiliar NWS wording', cond('Patchy Blowing Dust'), 'Patchy Blowing Dust');

  check('single-digit precip stays out of the collapsed scan', [pop(0), pop(4), pop(14)], [null, null, null]);
  check('collapsed precip rounds while the detail can keep exact data',
    [pop(15), pop(37), pop(96), pop(100)], [20, 40, 100, 100]);

  check('truly consequential heat is promoted', impact(112, 98), { kind: 'hot', label: 'Feels 112°' });
  check('ordinary summer apparent temperature is not promoted', impact(94, 91), null);
  check('truly consequential cold is promoted', impact(-8, 5), { kind: 'cold', label: 'Feels -8°' });
  check('an air temperature extreme without a meaningful apparent delta is not doubled', impact(103, 101), null);
}


/* ============ alertLevel ============ */
// One ramp. Ranks by the word in the event name; CAP severity may escalate, never demote.
{
  const L = (event, severity) => SUBJECT.alertLevel({ event, severity }).k;

  check('tornado warning is an emergency', L('Tornado Warning', 'Severe'), 'emergency');
  check('CAP Extreme escalates an advisory', L('Wind Advisory', 'Extreme'), 'emergency');
  check('warning outranks its CAP severity', L('Extreme Heat Warning', 'Severe'), 'warning');

  // The disagreement that motivated the ramp: NWS ships this pairing, and the old code tinted the
  // card by one signal and tagged it by the other.
  check('Flood Advisory carrying severity Severe stays an advisory', L('Flood Advisory', 'Severe'), 'advisory');

  check('watch', L('Severe Thunderstorm Watch', 'Severe'), 'watch');

  /* The one case where CAP severity is NOT allowed to escalate. NWS ships Tornado Watch with
     severity "Extreme" — alone among watches — and the escalation rule read that as a take-cover
     product, handing a watch the emergency ramp: red, pulsing, unfoldable, indistinguishable from
     the Tornado Warning above it. A watch is a watch. */
  check('a tornado watch is a WATCH, not an emergency', L('Tornado Watch', 'Extreme'), 'watch');
  check('no watch escalates on CAP severity', L('Flash Flood Watch', 'Extreme'), 'watch');
  // ...and the escalation still works everywhere it was meant to, which is why it stayed.
  check('a warning still escalates on CAP Extreme', L('Flash Flood Warning', 'Extreme'), 'emergency');
  check('statement', L('Special Weather Statement', 'Minor'), 'statement');
  check('CAP Moderate never demotes a warning', L('Winter Storm Warning', 'Moderate'), 'warning');
  check('unknown event with no severity', L('Beach Hazards Message', ''), 'statement');
  check('missing properties do not throw', SUBJECT.alertLevel(null).k, 'statement');

  // Ordering is what the alert list sorts on, so assert the ranks relate, not just the names.
  const rank = e => SUBJECT.alertLevel({ event: e, severity: 'Severe' }).rank;
  check('emergency outranks warning outranks watch outranks advisory',
    rank('Tornado Warning') < rank('Heat Warning') &&
    rank('Heat Warning') < rank('Heat Watch') &&
    rank('Heat Watch') < rank('Heat Advisory'), true);
}

/* ============ isTakeCover ============ */
/* "Is the answer ACT NOW?" — the question three unrelated-looking behaviours turn out to share:
 * the sort (it leads its list), the family fold (it is never a line item inside another card), and
 * the local all-clear row (it drops the calm voice while one runs nearby). Each used to ask it
 * inline as lv.k === 'emergency'. Three copies is fine until the answer moves, and it just did —
 * Tornado Watch stopped being an emergency, which rewrote all three at once and happened to be
 * right at all three. These assert the membership itself, so the next such move is checked rather
 * than lucky. */
{
  const T = (event, severity) => SUBJECT.isTakeCover(SUBJECT.alertLevel({ event, severity }));

  check('a tornado warning is take-cover', T('Tornado Warning', 'Severe'), true);
  check('CAP Extreme on a warning is take-cover', T('Flash Flood Warning', 'Extreme'), true);

  // The move that motivated the naming. A watch is a watch, so it leads nothing, folds like
  // anything else in its family, and does not mute the all-clear line.
  check('a tornado watch is NOT take-cover', T('Tornado Watch', 'Extreme'), false);

  check('an ordinary warning is not', T('Winter Storm Warning', 'Severe'), false);
  check('an advisory is not', T('Heat Advisory', 'Minor'), false);
  check('a missing level does not throw', SUBJECT.isTakeCover(null), false);

  // The predicate and the ramp must not be able to drift apart: take-cover is exactly the set
  // alertLevel() calls `emergency`, no more and no less.
  const RAMP = ['Tornado Warning', 'Flash Flood Warning', 'Tornado Watch', 'Winter Storm Warning',
                'Heat Advisory', 'Special Weather Statement'];
  check('take-cover is exactly the emergency tier',
    RAMP.map(e => SUBJECT.isTakeCover(SUBJECT.alertLevel({ event: e, severity: 'Extreme' }))),
    RAMP.map(e => SUBJECT.alertLevel({ event: e, severity: 'Extreme' }).k === 'emergency'));
}

/* ============ strongestHit / alertScope / scopeAttr ============ */
/* WHICH LIST a card goes in — "for this place" or "elsewhere in the office's area". This is the
 * rule the alerts section exists to express, and until the extraction it was a line inside
 * loadAlerts()'s promise chain: verifiable only by pointing a browser at a live outbreak, which is
 * a test you cannot run in calm weather and cannot run at all in CI.
 *
 * The signature is half the fix. alertScope() takes coverage and nothing else, so the exception
 * that used to live on that line — an emergency stayed in the local section from anywhere — has
 * nowhere to be expressed: there is no severity to consult. Severity sets how loud a card is; it
 * never sets whether the card is about you. */
{
  const { strongestHit, alertScope, scopeAttr } = SUBJECT;

  // One card makes one coverage claim, so a group's segments reduce to their best evidence: a real
  // point-in-polygon beats a county listing beats a forecast zone beats a fire zone.
  check('polygon is the strongest claim', strongestHit(['zone', 'polygon', 'county']), 'polygon');
  check('county beats zone', strongestHit(['zone', 'county']), 'county');
  check('a miss among hits does not weaken the claim', strongestHit([false, 'zone', false]), 'zone');
  check('all misses is a miss', strongestHit([false, false]), false);
  check('no segments is a miss', strongestHit([]), false);
  check('a missing list does not throw', strongestHit(undefined), false);

  // The regression that started this: a tornado warning whose polygon has not reached you belongs
  // in the elsewhere list. It used to be hoisted into the local section, where it sat under a
  // heading meaning "for this place" wearing a badge that said it wasn't.
  check('no coverage is ELSEWHERE, whatever the alert is', alertScope(false, true), 'away');
  check('a polygon hit is local', alertScope('polygon', true), 'here');
  // A zone match is weaker evidence but it is still coverage — it decides the list, and only the
  // BADGE is held to the stronger standard.
  check('a zone hit is local too', alertScope('zone', true), 'here');

  /* Fail open. With /points unresolved, coverage is unknowable and the page owes one undivided
     list rather than a split it cannot support — "flat" is deliberately not "away", because an
     alert we cannot place is not an alert we have placed somewhere else. A cluttered list is a
     much smaller failure than a warning filed under a heading promising it isn't overhead. */
  check('zones unresolved: nothing is filed away', alertScope(false, false), 'flat');
  check('...not even something that matched', alertScope('polygon', false), 'flat');

  // The DOM half. Flat mode writes no attribute, because three readers normalise a missing
  // data-scope to "" and inventing a third value would give them something new to disagree about.
  check('flat mode writes no data-scope', scopeAttr('polygon', false), '');
  check('the split writes its side', [scopeAttr('polygon', true), scopeAttr(false, true)],
    ['here', 'away']);
}

/* ============ cardCmp ============ */
/* The order of the alert list, which is the one thing about this section a reader acts on. The rule
   is: an emergency leads, then everything covering THIS LOCATION, then everything else — level
   inside each of those, CAP severity last.
 *
 * Level used to be the primary key, and that put a tornado warning two counties away above a severe
 * thunderstorm warning genuinely overhead, because alertLevel() promotes every tornado warning to
 * `emergency`. These assert the rule directly rather than by eye.
 *
 * What "an emergency leads" means narrowed once loadAlerts started filing cards into the local and
 * elsewhere sections by COVERAGE alone: this comparator runs inside each section, so an emergency
 * leads its own list and can no longer climb into a section that promises it's about the reader.
 * The mixed-coverage cases below still describe one sorted list because that is what cardCmp sees —
 * loadAlerts sorts first and splits after, and the split preserves order. */
{
  // Build the shape cardCmp reads off a glist entry: level, coverage, CAP severity.
  const card = (event, hit, severity = 'Severe') => ({
    ev: event, lv: SUBJECT.alertLevel({ event, severity }), hit, sev: severity,
  });
  // Sort a list and read back the event names — cardCmp is a comparator, so exercise it as one.
  const order = (...cards) => cards.slice().sort(SUBJECT.cardCmp).map(c => c.ev);

  const localStorm  = card('Severe Thunderstorm Warning', 'polygon');
  const localHeat   = card('Heat Advisory', 'zone', 'Minor');
  const awayTornado = card('Tornado Warning', false, 'Extreme');
  const awayWinter  = card('Winter Storm Warning', false);
  const awayHeat    = card('Heat Advisory', false, 'Minor');

  // Emergency is still the first term, above coverage. Inside the elsewhere list that is the whole
  // job: a tornado warning two counties over leads the other things two counties over. It is also
  // what keeps the degraded flat mode — zones unresolved, one undivided list — from filing an
  // active tornado below a heat advisory.
  check('an emergency leads whatever it is sorted against', order(localStorm, awayTornado)[0], 'Tornado Warning');

  // The rule the rest of the list follows. Both of these used to come out the other way round.
  check('your warning outranks a distant warning',
    order(awayWinter, localStorm), ['Severe Thunderstorm Warning', 'Winter Storm Warning']);
  check('your ADVISORY outranks a distant WARNING',
    order(awayWinter, localHeat), ['Heat Advisory', 'Winter Storm Warning']);

  // Coverage having won, level orders within each half, and CAP severity breaks a tie under that.
  check('level still orders what covers you',
    order(localHeat, localStorm), ['Severe Thunderstorm Warning', 'Heat Advisory']);
  check('CAP severity is the last word', SUBJECT.cardCmp(
    card('Flood Warning', 'county', 'Severe'),
    card('Flood Warning', 'county', 'Moderate'),
  ) < 0, true);

  // Within the emergencies, yours is still yours.
  check('your emergency leads a distant one', SUBJECT.cardCmp(
    card('Tornado Warning', 'polygon', 'Extreme'), awayTornado,
  ) < 0, true);

  // The full list, top to bottom — the shape a reader in a busy hour actually sees.
  check('the whole order', order(awayHeat, awayWinter, localHeat, localStorm, awayTornado),
    ['Tornado Warning', 'Severe Thunderstorm Warning', 'Heat Advisory',
     'Winter Storm Warning', 'Heat Advisory']);

  // A comparator that is not a total order sorts differently depending on input order, which shows
  // up as a list that reshuffles itself between 60-second refreshes.
  check('the order does not depend on the order it arrived in',
    JSON.stringify(order(awayTornado, localStorm, awayWinter, localHeat, awayHeat)),
    JSON.stringify(order(awayHeat, localHeat, awayWinter, localStorm, awayTornado)));
}

/* ============ FAMILY_CFG ============ */
// Per-family presentation for the alert banners. The banner's second line used to live here too,
// as a fallback sentence per family; it went when the banner dropped to one line — the alert card
// directly beneath it now carries the NWS instruction itself, so the banner was saying the same
// thing twice within a screen. What survives is what the banners still route on: the icon and
// the fold list.
{
  for (const [fam, cfg] of Object.entries(SUBJECT.FAMILY_CFG)) {
    check(`${fam} names an icon`, typeof cfg.ico === 'string' && cfg.ico.length > 0, true);
    // The dead `sub` key must not creep back: the banner has nowhere to put it.
    check(`${fam} carries no banner subline`, 'sub' in cfg, false);
  }

  // The fold list. `merge` marks families whose products are graduated tiers of ONE hazard and
  // fold into a single banner. Convective and flood must never gain it: a Tornado Warning and a
  // Severe Thunderstorm Watch share a family without being the same hazard, and a Flash Flood
  // Warning is not a tier of a river Flood Warning. Adding `merge` to either would silently
  // start folding distinct hazards into one banner — this is the guard that makes it loud.
  check('convective never folds', 'merge' in SUBJECT.FAMILY_CFG.convective, false);
  check('flood never folds', 'merge' in SUBJECT.FAMILY_CFG.flood, false);
  for (const fam of ['heat', 'winter', 'wind', 'fire']) {
    const m = SUBJECT.FAMILY_CFG[fam].merge;
    check(`${fam} folds as one hazard`, typeof m === 'string' && m.length > 0, true);
  }
}

/* ============ coldVerdict ============ */
// Which cold thing the Bottom Line says about the hours ahead. One trough, one verdict.
{
  const V = SUBJECT.coldVerdict;   // (nowT, morning 6-9am low, lowest hour ahead)

  // THE BUG THIS WAS WRITTEN FOR. A hot afternoon easing off overnight is the ordinary summer
  // diurnal cycle — every hot day does it — and 80° needs no jacket. Gated on the FALL alone
  // (>=18°), this told people to dress in layers at 80°, next to a dangerous-heat pill.
  check('99 falling to 80 is not layers weather', V(99, null, 80), null);
  check('88 falling to 70 is not layers weather', V(88, null, 70), null);
  check('a fall that lands just above the line stays quiet', V(85, null, 59), null);

  // A real evening chill: same size of fall, but it lands somewhere a jacket helps.
  check('72 falling to 45 is layers weather', V(72, null, 45), 'falling');
  check('a fall landing exactly on the line speaks', V(80, null, 58), 'falling');

  // The fall must still be a fall, and it must start from somewhere warm — a 50° day drifting to
  // 40° is just a cold day, and the morning tier says that better.
  check('too small a fall is not a fall', V(70, null, 55), null);
  check('already cold is not a fall', V(50, null, 33), null);
  check('...and its morning is reported as plain cold', V(50, 33, 33), 'cold');

  // Priority: freezing outranks the swing (ice is a different problem, and "layers" is the wrong
  // advice for 28°), and the swing outranks the plain cold morning (it says strictly more).
  check('freezing wins over a big fall', V(60, 28, 28), 'freezing');
  check('a big fall wins over the cold-morning tier', V(72, 44, 44), 'falling');
  check('cold morning speaks when nothing else does', V(48, 40, 40), 'cold');
  check('a mild morning says nothing', V(60, 52, 52), null);

  // Missing inputs must not throw or invent a verdict.
  check('no data at all', V(null, null, null), null);
  check('no morning in the window, no fall', V(60, null, 59), null);
  check('freezing morning with no ahead-low', V(40, 30, null), 'freezing');
}

/* ============ outlookVerdict ============ */
// Which outlook pill a hazard family earns. Inputs are category LEVELS for today and tomorrow
// (spcRisk/eroRisk/fireRisk .lvl), so -1 means "no risk" and SPC's 0 means "General Storms".
{
  const V = SUBJECT.outlookVerdict, C = SUBJECT.OUTLOOK_CFG;

  // The gap this closes: a Slight Risk for TOMORROW afternoon, invisible to the 24-hour hourly
  // window, must still make the card — that is the whole point of reading the outlook desks.
  check('slight risk tomorrow speaks', V(C.spc, -1, 2),
    { pri: 80, ico: 'storm', txt: 'Severe storms possible tomorrow (Slight Risk 2/5)' });

  // Non-hazards stay quiet: no outlook at all, and SPC's "General Storms" (thunder without
  // severe potential) — the wet-block pill already covers plain storms.
  check('no risk either day is no pill', V(C.spc, -1, -1), null);
  check('general storms is not a hazard', V(C.spc, 0, 0), null);

  // One pill per family: the stronger day speaks, a tie reads as one span.
  check('the stronger day wins', V(C.spc, 3, 2),
    { pri: 90, ico: 'storm', txt: 'Severe storms likely today (Enhanced Risk 3/5)' });
  check('a tie merges the days', V(C.ero, 2, 2),
    { pri: 79, ico: 'flood', txt: 'Flash flooding possible today and tomorrow (Slight Risk 2/4)' });

  // Fire categories already name themselves — no "(Critical 2/3)" saying it twice.
  check('fire skips the category tag', V(C.fire, 0, 2),
    { pri: 82, ico: 'fire', txt: 'Critical fire weather tomorrow (2/3)' });

  // Winter (WSSI Overall Impact): rank 0 is "Winter Weather Area" — snow on the map, nothing to
  // act on — and a Major day outranks the wet block's own wintry pill (93), which can only say
  // "snow tonight", not how bad.
  check('winter weather area alone stays quiet', V(C.wssi, 0, 0), null);
  check('a major winter storm tomorrow speaks', V(C.wssi, 0, 3),
    { pri: 96, ico: 'snow', txt: 'Major winter storm impacts tomorrow (3/4)' });
  check('major winter outranks the wintry-mix pill', V(C.wssi, 3, 0).pri > 93, true);

  // The top of each scale exists and outranks the hourly rules it explains.
  check('an outbreak outranks the thunder pill', V(C.spc, 5, 5).pri > 95, true);
  check('high flood risk lands', V(C.ero, -1, 4),
    { pri: 98, ico: 'flood', txt: 'Widespread flash flooding expected tomorrow (High Risk 4/4)' });

  // Missing inputs must not throw or invent a verdict.
  check('undefined levels are no pill', V(C.spc, undefined, undefined), null);
}

/* ============ parseMcd ============ */
// One SPC mesoscale discussion text → the fields the risk card's strip renders. The sample is
// MD 1810 (2026-07-31), abridged mid-discussion; the line structure is the real product's.
{
  const MD = `ACUS11 KWNS 311914
SWOMCD
SPC MCD 311913
MOZ000-ILZ000-312115-

Mesoscale Discussion 1810
NWS Storm Prediction Center Norman OK
0213 PM CDT Fri Jul 31 2026

Areas affected...much of central/eastern Missouri into western
Illinois

Concerning...Severe potential...Watch likely

Valid 311913Z - 312115Z

Probability of Watch Issuance...80 percent

SUMMARY...Potential for damaging wind and a couple of tornadoes to
increase through the afternoon/evening.

DISCUSSION...Air mass recovery is ongoing across portions of western
and central Missouri behind morning thunderstorm activity.

..Thornton/Mosier.. 07/31/2026

ATTN...WFO...PAH...LSX...DVN...SGF...EAX...

LAT...LON   38759474 39039367 39299179 39519038
`;
  const p = SUBJECT.parseMcd(MD);
  check('parseMcd number', p.num, 1810);
  check('parseMcd concerning line', p.concerning, 'Severe potential...Watch likely');
  check('parseMcd watch probability', p.prob, 80);
  check('parseMcd valid-end stamp', p.validEnd, '312115');
  // The LSX membership test the loader applies — and the LAT...LON block after the blank line
  // must NOT leak into the office list as "LAT"/"LON".
  check('parseMcd ATTN offices', p.attn, ['PAH', 'LSX', 'DVN', 'SGF', 'EAX']);
  check('parseMcd summary joins wrapped lines', p.summary,
    'Potential for damaging wind and a couple of tornadoes to increase through the afternoon/evening.');
  check('parseMcd areas affected', p.areas, 'much of central/eastern Missouri into western Illinois');

  // A watch-issued MD swaps the probability line for the watch number. prob must be null — the
  // strip renders 0 as "0%", which would claim SPC said a watch is ruled out.
  const W = MD.replace('Concerning...Severe potential...Watch likely',
                       'Concerning...Severe Thunderstorm Watch 479...')
              .replace('Probability of Watch Issuance...80 percent\n\n', '');
  const pw = SUBJECT.parseMcd(W);
  check('parseMcd watch-issued concerning', pw.concerning, 'Severe Thunderstorm Watch 479...');
  check('parseMcd watch-issued has no probability', pw.prob, null);

  // Not an MD at all → null, never a half-parsed object for the renderer to paint.
  check('parseMcd rejects a non-MD product', SUBJECT.parseMcd('THUNDERSTORM OUTLOOK NARRATIVE'), null);
}

/* ============ mcdValidEnd ============ */
// "Valid ...Z - 312115Z" has no month or year; the issuance time supplies both, and the day
// field wrapping a month boundary is the case that would fail silently on exactly one night.
{
  const V = SUBJECT.mcdValidEnd;
  const issued = Date.UTC(2026, 6, 31, 19, 13);   // MD 1810's own issuance
  check('mcdValidEnd same day', V('312115', issued), Date.UTC(2026, 6, 31, 21, 15));
  check('mcdValidEnd crosses midnight into a new month',
    V('010115', Date.UTC(2026, 6, 31, 23, 13)), Date.UTC(2026, 7, 1, 1, 15));
  check('mcdValidEnd crosses into a new year',
    V('010030', Date.UTC(2026, 11, 31, 23, 0)), Date.UTC(2027, 0, 1, 0, 30));
  check('mcdValidEnd malformed stamp', V('21Z', issued), null);
  check('mcdValidEnd missing issuance', V('312115', 0), null);
}

/* ============ geomTouchesEnv ============ */
// The regional pre-filter in front of loadMcd's text budget. It only ever DROPS products, so the
// cases that matter are the ones where dropping would be wrong.
{
  const T = SUBJECT.geomTouchesEnv;
  const env = { xmin: -96.5, ymin: 34, xmax: -85, ymax: 43 };
  const poly = coords => ({ type: 'Polygon', coordinates: [coords] });

  check('geomTouchesEnv polygon inside the box',
    T(poly([[-91, 38], [-90, 38], [-90, 39], [-91, 39], [-91, 38]]), env), true);
  check('geomTouchesEnv polygon overlapping an edge',
    T(poly([[-98, 38], [-95, 38], [-95, 39], [-98, 39], [-98, 38]]), env), true);
  check('geomTouchesEnv polygon fully west of the box',
    T(poly([[-105, 38], [-102, 38], [-102, 39], [-105, 39], [-105, 38]]), env), false);
  // A shape LARGER than the box on every side still touches it — the bbox test must not require
  // any vertex to fall inside.
  check('geomTouchesEnv polygon containing the box',
    T(poly([[-110, 25], [-70, 25], [-70, 50], [-110, 50], [-110, 25]]), env), true);
  check('geomTouchesEnv MultiPolygon with one distant and one local part',
    T({ type: 'MultiPolygon', coordinates: [
      [[[-120, 40], [-118, 40], [-118, 42], [-120, 42], [-120, 40]]],
      [[[-91, 38], [-90, 38], [-90, 39], [-91, 39], [-91, 38]]],
    ] }, env), true);
  check('geomTouchesEnv empty geometry never matches',
    T({ type: 'Polygon', coordinates: [] }, env), false);
}

/* ============ watchBoundary ============ */
// The dissolve behind the watch outline. The property that matters: an edge two counties share
// must vanish, an edge only one county has must survive — everything else is stitching.
{
  const W = SUBJECT.watchBoundary;
  const sq = coords => ({ geometry: { type: 'Polygon', coordinates: [coords] } });
  // Two unit "counties" sharing the x=1 border. The dissolve of the pair is the 2x1 rectangle:
  // one ring, six perimeter corners (the shared corners survive, the shared EDGE does not).
  const left  = sq([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  const right = sq([[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]);
  const pair = W([left, right]);
  // One ring of exactly 7 points (6 perimeter vertices + the closing repeat) is only reachable
  // if the shared x=1 edge dissolved: with it still present the walk would close early on one
  // square and leave the other as a second ring.
  check('watchBoundary dissolves two counties to one ring', pair.length, 1);
  check('watchBoundary perimeter closes', pair[0].length, 7);
  check('watchBoundary ring returns to its start',
    JSON.stringify(pair[0][0]), JSON.stringify(pair[0][pair[0].length - 1]));
  // A county with no neighbour keeps every edge it arrived with — [lat,lng] flipped from GeoJSON.
  const lone = W([sq([[10, 20], [11, 20], [11, 21], [10, 21], [10, 20]])]);
  check('watchBoundary lone county keeps its own ring', lone.length, 1);
  check('watchBoundary flips GeoJSON x,y to Leaflet lat,lng',
    JSON.stringify(lone[0][0]), JSON.stringify([20, 10]));
  // Two watches that don't touch stay two rings — the walk must not weld distant shapes.
  check('watchBoundary separate clusters stay separate rings',
    W([left, sq([[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]])]).length, 2);
  check('watchBoundary MultiPolygon parts contribute their rings',
    W([{ geometry: { type: 'MultiPolygon', coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
    ] } }]).length, 2);
  check('watchBoundary null geometry contributes nothing', W([{ geometry: null }]).length, 0);
}

/* ============ chaikinRing ============ */
// The smoothing between watchBoundary's honest stair-steps and the drawn outline. The invariants:
// corners go, quarter-points arrive, closure and endpoints are preserved exactly.
{
  const C = SUBJECT.chaikinRing;
  const sq = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const s1 = C(sq, 1);
  check('chaikinRing closed ring stays closed',
    JSON.stringify(s1[0]), JSON.stringify(s1[s1.length - 1]));
  check('chaikinRing one pass doubles a closed ring', s1.length, 9);   // 4 vertices → 8, + closing repeat
  check('chaikinRing cuts the corner off', s1.some(p => p[0] === 4 && p[1] === 4), false);
  // The cuts land at 1/4 and 3/4 along each edge — for the (4,0)→(4,4) edge, (4,1) and (4,3).
  check('chaikinRing cuts at quarter points',
    s1.some(p => p[0] === 4 && p[1] === 1) && s1.some(p => p[0] === 4 && p[1] === 3), true);
  // An open chain is a boundary gap the walk could not close; smoothing must not weld it shut.
  const o1 = C([[0, 0], [2, 0], [2, 2]], 1);
  check('chaikinRing open chain keeps its endpoints',
    JSON.stringify([o1[0], o1[o1.length - 1]]), JSON.stringify([[0, 0], [2, 2]]));
  check('chaikinRing degenerate input passes through', C([[1, 2], [3, 4]], 2).length, 2);
}

if (failed) {
  console.error(`\n${failed} logic test(s) failed`);
  process.exit(1);
}
console.log('ok    logic: rangeMark, alertLevel, isTakeCover, cardCmp, strongestHit, alertScope, scopeAttr, FAMILY_CFG,\n             compact forecast decisions, coldVerdict, outlookVerdict, parseMcd, mcdValidEnd,\n             geomTouchesEnv, watchBoundary and chaikinRing behave');
