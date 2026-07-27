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
  ${lift(/^var FAMILY_CFG=\{[\s\S]*?^\};/m, 'FAMILY_CFG')}
  return { rangeMark, rangeRow, alertLevel, FAMILY_CFG };
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

/* ============ FAMILY_CFG ============ */
// Storm Mode's per-family presentation. The banner's second line used to live here too, as a
// fallback sentence per family; it went when the banner dropped to one line — the alert card
// directly beneath it now carries the NWS instruction itself, so the banner was saying the same
// thing twice within a screen. What survives is what Storm Mode still routes on.
{
  const VALID_PRIME = new Set(['obsCard', 'riversCard', 'riskCard']);
  for (const [fam, cfg] of Object.entries(SUBJECT.FAMILY_CFG)) {
    check(`${fam} names an icon`, typeof cfg.ico === 'string' && cfg.ico.length > 0, true);
    check(`${fam} primes a card that exists`, VALID_PRIME.has(cfg.prime), true);
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

if (failed) {
  console.error(`\n${failed} logic test(s) failed`);
  process.exit(1);
}
console.log('ok    logic: rangeMark, alertLevel and FAMILY_CFG behave');
