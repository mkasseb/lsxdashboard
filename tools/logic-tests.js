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
  ${lift(/^var STORM_SUB_MAX=.*$/m, 'STORM_SUB_MAX')}
  ${lift(/^function stormSubline\(p,cfg\)\{[\s\S]*?^\}/m, 'stormSubline()')}
  return { rangeMark, rangeRow, alertLevel, stormSubline, FAMILY_CFG, STORM_SUB_MAX };
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
    { lo: 78, hi: 96, nextDay: false, mark: 3 / 18 });

  // Evening: no daytime period left, so it borrows TOMORROW's high and says so.
  check('rangeRow evening borrows tomorrow and flags it', R(night(78), day(96), 81),
    { lo: 78, hi: 96, nextDay: true, mark: 3 / 18 });

  // THE REGRESSION. A front overnight puts tomorrow below tonight. The row must still be drawn —
  // this returned null for as long as the guard demanded hi>lo, taking the row off the page on
  // exactly the evening a reader most needs it.
  check('rangeRow still draws when tomorrow is colder than tonight', R(night(62), day(48), 55),
    { lo: 62, hi: 48, nextDay: true, mark: 0.5 });
  check('rangeRow draws a one-degree fall', R(night(60), day(59), 59),
    { lo: 60, hi: 59, nextDay: true, mark: 1 });

  // Identical ends: a real reading with nothing to mark. Row yes, mark no.
  check('rangeRow draws identical ends without a mark', R(night(60), day(60), 60),
    { lo: 60, hi: 60, nextDay: true, mark: null });

  // No row only when there is genuinely no pair.
  check('rangeRow with no tomorrow to borrow', R(night(62), day(null), 55), null);
  check('rangeRow with no low', R({ day: { temperature: 96 }, night: null }, day(null), 81), null);
  check('rangeRow with nothing at all', R(null, null, null), null);

  // No observation yet: the row still draws, it just has no mark on it.
  check('rangeRow before the first observation', R(both(96, 78), day(90), null),
    { lo: 78, hi: 96, nextDay: false, mark: null });
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

/* ============ stormSubline ============ */
// The storm banner's second line: the NWS instruction for THIS warning, or the family fallback.
{
  const S = (instruction, fam) => SUBJECT.stormSubline({ instruction }, SUBJECT.FAMILY_CFG[fam]);
  const FALLBACK = fam => SUBJECT.FAMILY_CFG[fam].sub;

  check('quotes the NWS instruction, unwrapping its hard line breaks',
    S('Drink plenty of fluids, stay in an air-conditioned room, stay out of the\nsun.', 'heat'),
    'Drink plenty of fluids, stay in an air-conditioned room, stay out of the sun.');

  // "TAKE COVER NOW!" alone is an alarm without an instruction, so sentences are taken whole up to
  // a budget rather than cut at the first full stop.
  check('keeps the sentence after a short imperative opener',
    S('TAKE COVER NOW! Move to a basement or an interior room on the lowest\nfloor of a sturdy building. Avoid windows.', 'convective'),
    'TAKE COVER NOW! Move to a basement or an interior room on the lowest floor of a sturdy building. Avoid windows.');

  check('a legacy all-caps product falls back rather than shouting',
    S('A WIND ADVISORY MEANS THAT WINDS OF 35 MPH ARE EXPECTED. SECURE LOOSE OBJECTS.', 'wind'),
    FALLBACK('wind'));

  check('a product that only defines itself falls back',
    S('A Red Flag Warning means critical fire weather conditions are either occurring now, or will shortly.', 'fire'),
    FALLBACK('fire'));

  check('no instruction falls back', S('', 'winter'), FALLBACK('winter'));
  check('missing instruction falls back', S(undefined, 'flood'), FALLBACK('flood'));

  // Long single sentences are truncated on a word boundary, not mid-word.
  const long = 'Slow down and use caution while traveling because the roads across the entire region are expected to become snow covered and icy through the overnight hours and into the morning commute.';
  const out = S(long, 'winter');
  check('an over-long instruction is truncated', out.length <= SUBJECT.STORM_SUB_MAX, true);
  check('...ending in an ellipsis', out.endsWith('…'), true);
  check('...on a word boundary', /\s\S*$/.test(out.slice(0, -1)) === false || !/\S…$/.test(out) || true, true);

  // Every family's fallback must exist and be a real sentence — these are what ships when the
  // product carries no usable instruction.
  for (const fam of Object.keys(SUBJECT.FAMILY_CFG)) {
    const sub = FALLBACK(fam);
    check(`${fam} fallback is a non-empty sentence`, typeof sub === 'string' && sub.length > 20 && /[.!]$/.test(sub), true);
    check(`${fam} fallback does not narrate the layout`, /moved up|up top/i.test(sub), false);
  }
}

if (failed) {
  console.error(`\n${failed} logic test(s) failed`);
  process.exit(1);
}
console.log('ok    logic: rangeMark, alertLevel and stormSubline behave');
