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
  ${lift(/^var ALERT_SEV_RANK=\{[\s\S]*?\};/m, 'ALERT_SEV_RANK')}
  ${lift(/^function cardCmp\(a,b\)\{[\s\S]*?^\}/m, 'cardCmp()')}
  ${lift(/^var FAMILY_CFG=\{[\s\S]*?^\};/m, 'FAMILY_CFG')}
  ${lift(/^var LAYERS_MAX=\d+;/m, 'LAYERS_MAX')}
  ${lift(/^function coldVerdict\(nowT,mMin,cMin\)\{[\s\S]*?^\}/m, 'coldVerdict()')}
  ${lift(/^var OUTLOOK_CFG=\{[\s\S]*?^\};/m, 'OUTLOOK_CFG')}
  ${lift(/^function outlookVerdict\(cfg,l0,l1\)\{[\s\S]*?^\}/m, 'outlookVerdict()')}
  ${lift(/^function parseMcd\(text\)\{[\s\S]*?^\}/m, 'parseMcd()')}
  ${lift(/^function mcdValidEnd\(v,refMs\)\{[\s\S]*?^\}/m, 'mcdValidEnd()')}
  ${lift(/^function geomTouchesEnv\(geom,env\)\{[\s\S]*?^\}/m, 'geomTouchesEnv()')}
  return { rangeMark, rangeRow, alertLevel, cardCmp, FAMILY_CFG, coldVerdict, OUTLOOK_CFG, outlookVerdict,
           parseMcd, mcdValidEnd, geomTouchesEnv };
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

/* ============ cardCmp ============ */
/* The order of the alert list, which is the one thing about this section a reader acts on. The rule
   is: an emergency leads from anywhere, then everything covering THIS LOCATION, then everything
   else — level inside each of those, CAP severity last.
 *
 * Level used to be the primary key, and that put a tornado warning two counties away above a severe
 * thunderstorm warning genuinely overhead, because alertLevel() promotes every tornado warning to
 * `emergency`. These assert the rule directly rather than by eye. */
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

  // The exception, and it stays: a tornado emergency leads from anywhere. A page that files an
  // active tornado below your heat advisory because its polygon hasn't reached you is not a
  // weather page.
  check('a distant emergency still leads', order(localStorm, awayTornado)[0], 'Tornado Warning');

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

if (failed) {
  console.error(`\n${failed} logic test(s) failed`);
  process.exit(1);
}
console.log('ok    logic: rangeMark, alertLevel, cardCmp, FAMILY_CFG, coldVerdict, outlookVerdict, parseMcd, mcdValidEnd and geomTouchesEnv behave');
