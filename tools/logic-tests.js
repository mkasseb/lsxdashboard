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
  ${lift(/^function eventFamily\(ev\)\{[\s\S]*?^\}/m, 'eventFamily()')}
  ${lift(/^var FAMILY_CFG=\{[\s\S]*?^\};/m, 'FAMILY_CFG')}
  ${lift(/^var LAYERS_MAX=\d+;/m, 'LAYERS_MAX')}
  ${lift(/^function coldVerdict\(nowT,mMin,cMin\)\{[\s\S]*?^\}/m, 'coldVerdict()')}
  ${lift(/^function parseMph\(s\)\{.*\}$/m, 'parseMph()')}
  ${lift(/^function heatIndexF\(t,rh\)\{[\s\S]*?^\}/m, 'heatIndexF()')}
  ${lift(/^function windChillF\(t,mph\)\{[\s\S]*?^\}/m, 'windChillF()')}
  ${lift(/^function feelsLikeF\(t,rh,mph\)\{[\s\S]*?^\}/m, 'feelsLikeF()')}
  ${lift(/^function compactDayName\(name\)\{[\s\S]*?^\}/m, 'compactDayName()')}
  ${lift(/^function compactCondition\(text\)\{[\s\S]*?^\}/m, 'compactCondition()')}
  ${lift(/^function summaryPop\(pop\)\{[\s\S]*?^\}/m, 'summaryPop()')}
  ${lift(/^function forecastImpact\(feels,air\)\{[\s\S]*?^\}/m, 'forecastImpact()')}
  ${lift(/^function summaryPopText\(pop\)\{[\s\S]*?^\}/m, 'summaryPopText()')}
  ${lift(/^function buildForecastSummary\(facts\)\{[\s\S]*?^\}/m, 'buildForecastSummary()')}
  ${lift(/^function nwsWallTime\(value\)\{[\s\S]*?^\}/m, 'nwsWallTime()')}
  ${lift(/^function hourlyByDate\(hrs\)\{[\s\S]*?^\}/m, 'hourlyByDate()')}
  ${lift(/^function hrWord\(d\)\{[\s\S]*?^\}/m, 'hrWord()')}
  ${lift(/^function whenWord\(d,base\)\{[\s\S]*?^\}/m, 'whenWord()')}
  ${lift(/^function windowSpan\(a,b,base\)\{[\s\S]*?^\}/m, 'windowSpan()')}
  ${lift(/^function bottomLineHorizon\(d\)\{[\s\S]*?^\}/m, 'bottomLineHorizon()')}
  ${lift(/^function dewF\(tF,rh\)\{[\s\S]*?^\}/m, 'dewF()')}
  ${lift(/^var OUTLOOK_CFG=\{[\s\S]*?^\};/m, 'OUTLOOK_CFG')}
  ${lift(/^function outlookVerdict\(cfg,l0,l1\)\{[\s\S]*?^\}/m, 'outlookVerdict()')}
  ${lift(/^function bottomCandidate\(pri,ico,topic,label,headline,detail,action,tone,context,opts\)\{[\s\S]*?^\}/m, 'bottomCandidate()')}
  ${lift(/^function bottomLineHours\(hrs\)\{[\s\S]*?^\}/m, 'bottomLineHours()')}
  ${lift(/^function bottomLineHourlyCandidates\(H,opts\)\{[\s\S]*?^\}/m, 'bottomLineHourlyCandidates()')}
  ${lift(/^function bottomLineLocalAlert\(groups\)\{[\s\S]*?^\}/m, 'bottomLineLocalAlert()')}
  ${lift(/^function bottomLineCmp\(a,b\)\{[\s\S]*?^\}/m, 'bottomLineCmp()')}
  ${lift(/^function bottomLineAlertMatch\(alert,candidate\)\{[\s\S]*?^\}/m, 'bottomLineAlertMatch()')}
  ${lift(/^function bottomLineAlertHeadline\(candidate,outdoor\)\{[\s\S]*?^\}/m, 'bottomLineAlertHeadline()')}
  ${lift(/^function bottomLineWindowAction\(candidate,outdoor\)\{[\s\S]*?^\}/m, 'bottomLineWindowAction()')}
  ${lift(/^function buildBottomLine\(candidates,localAlert\)\{[\s\S]*?^\}/m, 'buildBottomLine()')}
  ${lift(/^function extractAFD\(text\)\{[\s\S]*?^\}/m, 'extractAFD()')}
  ${lift(/^function parseMcd\(text\)\{[\s\S]*?^\}/m, 'parseMcd()')}
  ${lift(/^function mcdValidEnd\(v,refMs\)\{[\s\S]*?^\}/m, 'mcdValidEnd()')}
  ${lift(/^function geomTouchesEnv\(geom,env\)\{[\s\S]*?^\}/m, 'geomTouchesEnv()')}
  ${lift(/^function watchBoundary\(feats\)\{[\s\S]*?^\}/m, 'watchBoundary()')}
  ${lift(/^function chaikinRing\(ring,iters\)\{[\s\S]*?^\}/m, 'chaikinRing()')}
  return { rangeMark, rangeRow, alertLevel, isTakeCover, cardCmp, strongestHit, alertScope, scopeAttr,
           FAMILY_CFG, coldVerdict, parseMph, heatIndexF, windChillF, feelsLikeF,
           compactDayName, compactCondition, summaryPop, forecastImpact,
           summaryPopText, buildForecastSummary, nwsWallTime, hourlyByDate, hrWord,
           whenWord, windowSpan, bottomLineHorizon, dewF,
           OUTLOOK_CFG, outlookVerdict, bottomLineHours, bottomLineHourlyCandidates,
           bottomLineLocalAlert, buildBottomLine,
           extractAFD, parseMcd, mcdValidEnd, geomTouchesEnv, watchBoundary, chaikinRing };
`)();

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) return;
  console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
  failed++;
}

/* Restored snapshots contain rendered HTML, so a Bottom Line DOM migration must reject the old
   shape rather than painting v12 pills under v13 briefing styles. */
check('Bottom Line markup migration bumps the snapshot key',
  /var SNAP_KEY="lsxSnap_v13"/.test(SRC), true);
check('the previous v12 snapshot is explicitly discarded',
  /"lsxSnap_v12"\]\s*\.forEach\(function\(k\)\{ localStorage\.removeItem\(k\); \}\)/.test(SRC), true);

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
  const { compactDayName: day, compactCondition: cond, summaryPop: pop,
          summaryPopText: popText, forecastImpact: impact } = SUBJECT;

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
  check('approximate precipitation is labelled honestly',
    [popText(30), popText(37), popText(4)], ['30%', '~40%', '']);

  check('truly consequential heat is promoted', impact(112, 98), { kind: 'hot', label: 'Feels 112°' });
  check('ordinary summer apparent temperature is not promoted', impact(94, 91), null);
  check('truly consequential cold is promoted', impact(-8, 5), { kind: 'cold', label: 'Feels -8°' });
  check('an air temperature extreme without a meaningful apparent delta is not doubled', impact(103, 101), null);
}

/* ============ 7-day editorial summary ============ */
/* These are forecast regimes, not markup snapshots. Each case asserts the judgment users see:
   what leads, which weather word is used, and how a multi-period window is named. This keeps a
   future copy tweak from accidentally reviving the old fixed
   "Peak / Rain peaks / Coolest low" template. */
{
  const S = SUBJECT.buildForecastSummary;
  const fact = (name, hi, lo, extra = {}) => Object.assign({
    name, hi, lo, feelsHigh: hi, feelsLow: lo, feelsLowLabel: `${name} night`,
    dayPop: 0, nightPop: 0, dayCondition: 'Mostly Sunny', nightCondition: 'Mostly Clear'
  }, extra);

  const hot = [
    fact('Monday', 96, 76, { feelsHigh: 108 }),
    fact('Tuesday', 98, 75, { feelsHigh: 112 }),
    fact('Wednesday', 97, 74, { feelsHigh: 110, nightPop: 30, nightCondition: 'Chance Thunderstorms' }),
    fact('Thursday', 95, 73, { feelsHigh: 106, dayPop: 30, nightPop: 37,
      dayCondition: 'Chance Thunderstorms', nightCondition: 'Showers and Thunderstorms' }),
    fact('Friday', 94, 74, { feelsHigh: 103, dayPop: 37, dayCondition: 'Chance Thunderstorms' }),
    fact('Saturday', 96, 73, { feelsHigh: 108 }),
    fact('Sunday', 95, 72, { feelsHigh: 105 })
  ];
  check('heat regime leads with duration and keeps peak plus storm window', S(hot), {
    headline: 'Very hot through Sunday',
    facts: [
      { label: 'Peak feels', value: '112° Tue', icon: 'heat', tone: 'hot' },
      { label: 'Storm window', value: 'Wed night–Fri · ~40%', icon: 'storm', tone: 'storm' },
      { label: 'Highs', value: '94–98°', icon: 'heat', tone: 'temp' },
      { label: 'Night lows', value: '72–76°', icon: 'moon', tone: 'night' }
    ],
    tone: 'hot',
    icon: 'heat'
  });
  const delayedHeat = hot.map((f, i) => Object.assign({}, f, i === 0
    ? { hi: 88, feelsHigh: 90 }
    : {}));
  check('heat that starts later names both ends instead of implying it begins now', S(delayedHeat).headline,
    'Very hot Tuesday–Sunday');

  const cold = [
    fact('Monday', 18, 3, { feelsLow: -8, feelsLowLabel: 'Monday night' }),
    fact('Tuesday', 12, -2, { feelsLow: -15, feelsLowLabel: 'Tuesday morning' }),
    fact('Wednesday', 22, 8, { feelsLow: -4 }),
    fact('Thursday', 31, 18), fact('Friday', 36, 23), fact('Saturday', 40, 25), fact('Sunday', 38, 21)
  ];
  check('cold regime promotes the coldest apparent temperature at its actual period', S(cold).headline,
    'Wind chills down to -15° Tuesday morning');
  check('cold regime carries the cold tone', S(cold).tone, 'cold');
  check('cold regime labels the apparent-temperature fact compactly', S(cold).facts[0],
    { label: 'Lowest feels', value: '-15° Tue morning', icon: 'cold', tone: 'cold' });

  const snow = [
    fact('Monday', 34, 24),
    fact('Tuesday', 31, 22, { nightPop: 55, nightCondition: 'Snow Likely' }),
    fact('Wednesday', 28, 18, { dayPop: 60, nightPop: 20, dayCondition: 'Snow', nightCondition: 'Chance Snow' }),
    fact('Thursday', 30, 20), fact('Friday', 35, 23), fact('Saturday', 38, 27), fact('Sunday', 40, 29)
  ];
  check('snow regime names snow and preserves an overnight window', S(snow).headline,
    'Snow chances Tuesday night–Wednesday (60%)');
  check('snow regime is classified independently from rain', S(snow).tone, 'snow');
  check('snow regime exposes a compact, labeled weather window', S(snow).facts[0],
    { label: 'Snow window', value: 'Tue night–Wed · 60%', icon: 'snow', tone: 'snow' });

  const dry = [
    fact('Monday', 72, 51, { dayPop: 4 }), fact('Tuesday', 74, 52, { nightPop: 10 }),
    fact('Wednesday', 75, 53), fact('Thursday', 76, 54), fact('Friday', 77, 55),
    fact('Saturday', 76, 54), fact('Sunday', 75, 53)
  ];
  check('quiet week receives a plain dry headline', S(dry).headline, 'Mainly dry this week');
  check('quiet week is classified dry', S(dry).tone, 'dry');
  check('quiet week still says what the precipitation signal is', S(dry).facts[0],
    { label: 'Rain signal', value: 'Mostly dry', icon: 'sun', tone: 'dry' });

  const front = [
    fact('Monday', 80, 58), fact('Tuesday', 82, 60), fact('Wednesday', 81, 57),
    fact('Thursday', 64, 43), fact('Friday', 62, 41), fact('Saturday', 66, 44), fact('Sunday', 69, 47)
  ];
  check('a meaningful front earns the fourth fact when no hazard metric displaces it', S(front).facts[3],
    { label: 'Temperature trend', value: '17° cooler Thu', icon: 'stats', tone: 'temp' });

  const overnightRain = [
    fact('Monday', 68, 48),
    fact('Tuesday', 66, 50, { nightPop: 35, nightCondition: 'Rain Showers Likely' }),
    fact('Wednesday', 62, 44, { dayPop: 32, dayCondition: 'Chance Rain Showers' }),
    fact('Thursday', 60, 42), fact('Friday', 64, 45), fact('Saturday', 67, 47), fact('Sunday', 69, 49)
  ];
  check('overnight rain is a continuous named window, not two tied days', S(overnightRain).headline,
    'Rain chances Tuesday night–Wednesday (~40%)');
  check('overnight rain fact keeps timing and probability together', S(overnightRain).facts[0],
    { label: 'Rain window', value: 'Tue night–Wed · ~40%', icon: 'rain', tone: 'rain' });

  check('missing facts fail with a stable neutral result', S([]), {
    headline: 'Forecast summary unavailable', facts: [], tone: 'neutral', icon: 'info'
  });
}

/* ============ hourly apparent-temperature extrema ============ */
{
  const H = SUBJECT.hourlyByDate;
  check('NWS wall time preserves the forecast-local date and hour',
    SUBJECT.nwsWallTime('2026-01-10T23:00:00-06:00'),
    { key: '2026-01-10', month: 0, day: 10, hour: 23 });
  check('invalid NWS wall time fails closed', SUBJECT.nwsWallTime('not-a-time'), null);
  check('forecast-local source hours render without timezone conversion',
    [SUBJECT.hrWord(0), SUBJECT.hrWord(12), SUBJECT.hrWord(23)], ['12am', '12pm', '11pm']);
  const hours = [
    { startTime: '2026-01-10T06:00:00-06:00', temperature: 5,
      relativeHumidity: { value: 70 }, windSpeed: '20 mph' },
    { startTime: '2026-01-10T13:00:00-06:00', temperature: 20,
      relativeHumidity: { value: 55 }, windSpeed: '5 mph' },
    { startTime: '2026-01-10T19:00:00-06:00', temperature: 10,
      relativeHumidity: { value: 60 }, windSpeed: '12 mph' }
  ];
  const rec = H(hours)['2026-01-10'];
  check('hourly summary retains full-day coverage', rec.lastH, 19);
  check('hourly summary retains the midday humidity source', [rec.rh, rec.rhH], [55, 13]);
  check('hourly summary retains both apparent-temperature ends', rec.flMin < rec.fl, true);
  check('coldest apparent temperature keeps its source hour', rec.flMinH, 6);
  check('warmest apparent temperature keeps its source hour', rec.flH, 13);
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
// Which structured briefing candidate an outlook family earns. Inputs are category LEVELS for today and tomorrow
// (spcRisk/eroRisk/fireRisk .lvl), so -1 means "no risk" and SPC's 0 means "General Storms".
{
  const V = SUBJECT.outlookVerdict, C = SUBJECT.OUTLOOK_CFG;

  // The gap this closes: a Slight Risk for TOMORROW afternoon, invisible to the 24-hour hourly
  // window, must still make the card — that is the whole point of reading the outlook desks.
  check('slight risk tomorrow speaks', V(C.spc, -1, 2), {
    priority: 80, icon: 'storm', topic: 'storm', label: 'Severe outlook',
    headline: 'Severe storms possible tomorrow', detail: 'Slight Risk 2/5',
    action: 'Review your severe-weather plan and keep alerts enabled.', tone: 'warning', context: false
  });

  // Non-hazards stay quiet: no outlook at all, and SPC's "General Storms" (thunder without
  // severe potential) — the wet-block candidate already covers plain storms.
  check('no risk either day is no candidate', V(C.spc, -1, -1), null);
  check('general storms is not a hazard', V(C.spc, 0, 0), null);

  // One candidate per family: the stronger day speaks, a tie reads as one span.
  check('the stronger day wins', V(C.spc, 3, 2), {
    priority: 90, icon: 'storm', topic: 'storm', label: 'Severe outlook',
    headline: 'Severe storms likely today', detail: 'Enhanced Risk 3/5',
    action: 'Review your severe-weather plan and keep alerts enabled.', tone: 'danger', context: false
  });
  check('a tie merges the days', V(C.ero, 2, 2), {
    priority: 79, icon: 'flood', topic: 'flood', label: 'Flood outlook',
    headline: 'Flash flooding possible today and tomorrow', detail: 'Slight Risk 2/4',
    action: 'Avoid flood-prone roads if heavy rain develops.', tone: 'warning', context: false
  });

  // Fire categories already name themselves — no "(Critical 2/3)" saying it twice.
  check('fire skips the category tag', V(C.fire, 0, 2), {
    priority: 82, icon: 'fire', topic: 'fire', label: 'Fire outlook',
    headline: 'Critical fire weather tomorrow', detail: '2/3',
    action: 'Avoid outdoor burning and anything that could spark.', tone: 'warning', context: false
  });

  // Winter (WSSI Overall Impact): rank 0 is "Winter Weather Area" — snow on the map, nothing to
  // act on — and a Major day outranks the wet block's own wintry pill (93), which can only say
  // "snow tonight", not how bad.
  check('winter weather area alone stays quiet', V(C.wssi, 0, 0), null);
  check('a major winter storm tomorrow speaks', V(C.wssi, 0, 3), {
    priority: 96, icon: 'snow', topic: 'winter', label: 'Winter outlook',
    headline: 'Major winter storm impacts tomorrow', detail: '3/4',
    action: 'Build extra time into travel plans.', tone: 'danger', context: false
  });
  check('major winter outranks the wintry-mix candidate', V(C.wssi, 3, 0).priority > 93, true);

  // The top of each scale exists and outranks the hourly rules it explains.
  check('an outbreak outranks the thunder candidate', V(C.spc, 5, 5).priority > 95, true);
  check('high flood risk lands', V(C.ero, -1, 4), {
    priority: 98, icon: 'flood', topic: 'flood', label: 'Flood outlook',
    headline: 'Widespread flash flooding expected tomorrow', detail: 'High Risk 4/4',
    action: 'Avoid flood-prone roads if heavy rain develops.', tone: 'danger', context: false
  });

  // Missing inputs must not throw or invent a verdict.
  check('undefined levels are no candidate', V(C.spc, undefined, undefined), null);
}

/* ============ Bottom Line hourly decisions ============ */
// Controlled hourly facts test the actual source used by renderTheCall(), not hand-authored final
// candidates. Every threshold gets a just-below/at-boundary assertion; missing data must fail quiet.
{
  const C = SUBJECT.bottomLineHourlyCandidates;
  const NOW = new Date(2026, 7, 13, 12, 0, 0, 0);
  function hours(start, count, edit) {
    return Array.from({length: count}, (_, i) => {
      const d = new Date(start.getTime() + i * 3600000), hr = d.getHours();
      return Object.assign({t: 70, d, hr, pop: 0, rh: 50, mph: 5, dew: 50, fl: 70,
        thund: false, wint: false, fog: false, day: hr >= 7 && hr <= 19}, edit ? edit(i, d) : {});
    });
  }
  function topic(list, name) { return list.find(x => x.topic === name) || null; }
  function weather(H, opts) { return C(H, Object.assign({now: NOW}, opts || {})); }

  const normalized = SUBJECT.bottomLineHours([
    {startTime: 'not-a-time', temperature: 80},
    {startTime: '2026-08-13T12:00:00-05:00', temperature: 80,
      relativeHumidity: {value: 'bad'}, probabilityOfPrecipitation: {value: 130},
      windSpeed: '10 to 20 mph', shortForecast: 'Thunderstorms, snow and fog', isDaytime: true},
    {startTime: '2026-08-13T13:00:00-05:00', temperature: 75,
      probabilityOfPrecipitation: {value: -4}, shortForecast: '', isDaytime: false}
  ]);
  check('hour normalization drops invalid timestamps', normalized.length, 2);
  check('hour normalization clamps malformed precipitation probabilities', normalized.map(h => h.pop), [100, 0]);
  check('hour normalization preserves missing humidity instead of inventing dew point',
    [normalized[0].rh, normalized[0].dew], [null, null]);
  check('hour normalization takes the strongest sustained-wind number', normalized[0].mph, 20);
  check('hour normalization identifies storm, winter and fog signals',
    [normalized[0].thund, normalized[0].wint, normalized[0].fog], [true, true, true]);
  check('hour normalization preserves the official daylight flag', normalized.map(h => h.day), [true, false]);

  let H = hours(NOW, 12, i => ({pop: i === 2 ? 39 : 0}));
  check('39 percent stays a dry-window call', topic(weather(H), 'precip').headline, 'No rain expected');
  H = hours(NOW, 12, i => ({pop: i === 2 ? 40 : (i === 3 ? 29 : 0)}));
  check('40 percent starts a rain block', topic(weather(H), 'precip').headline, 'Rain likely');
  check('below 30 percent ends a rain block', topic(weather(H), 'precip').detail, '~2pm–3pm');
  H = hours(NOW, 12, i => ({pop: i === 2 ? 50 : (i === 3 ? 35 : (i === 4 ? 20 : (i === 8 ? 35 : 0))), thund: i === 8}));
  check('thunder outside the first wet block cannot relabel rain', topic(weather(H), 'precip').headline, 'Rain likely');
  H = hours(NOW, 12, i => ({pop: i === 2 ? 50 : (i === 3 ? 20 : 0), thund: i === 2}));
  check('thunder inside the wet block becomes storm timing', topic(weather(H), 'precip').headline, 'Thunderstorms likely');
  H = hours(NOW, 12, i => ({pop: i === 2 ? 50 : (i === 3 ? 20 : 0), wint: i === 2}));
  check('winter weather inside the wet block becomes travel weather', topic(weather(H), 'precip').headline, 'Snow or wintry mix');
  H = hours(NOW, 12, i => ({pop: i === 2 ? 50 : (i === 3 ? 20 : 0), thund: i === 2, wint: i === 2}));
  check('mixed thunder and winter weather states both hazards', topic(weather(H), 'precip').headline,
    'Thunderstorms with wintry precipitation');
  check('mixed thunder and winter weather includes both actions', topic(weather(H), 'precip').action,
    'Be ready to move inside and watch for slick roads.');
  H = hours(NOW, 12, i => ({pop: i === 2 || i === 7 ? 50 : (i === 3 ? 20 : 0)}));
  check('a second wet round is disclosed instead of merged into the first',
    topic(weather(H), 'precip').detail.includes('another round ~7pm'), true);
  H = hours(NOW, 12, i => ({pop: i === 3 ? 24 : 0}));
  check('24 percent does not get a peak-chance qualifier', topic(weather(H), 'precip').detail.includes('peak chance'), false);
  H = hours(NOW, 12, i => ({pop: i === 3 ? 25 : 0}));
  check('25 percent gets an honest peak-chance qualifier', topic(weather(H), 'precip').detail.includes('peak chance 25%'), true);

  for (const [feels, expected] of [[98, null], [99, 'High heat near 2pm'], [104, 'High heat near 2pm'], [105, 'Dangerous heat near 2pm']]) {
    H = hours(NOW, 12, i => ({fl: i === 2 ? feels : 70}));
    check(`heat threshold at feels-like ${feels}`, topic(weather(H), 'heat')?.headline || null, expected);
  }

  const EVE = new Date(2026, 7, 13, 18);
  H = hours(EVE, 18, i => ({t: i === 0 ? 72 : (i === 12 ? 28 : 60), fl: i === 0 ? 72 : (i === 12 ? 28 : 60)}));
  check('a freezing morning becomes the cold lead candidate', topic(weather(H, {now: EVE}), 'cold').headline, 'Freezing early');
  H = hours(NOW, 12, i => ({t: i === 0 ? 72 : (i === 6 ? 45 : 65), fl: i === 0 ? 72 : (i === 6 ? 45 : 65)}));
  check('a real temperature crash becomes one trend candidate', topic(weather(H), 'cold').headline, 'Sharp temperature drop');
  H = hours(new Date(2026, 7, 14, 0), 12, i => ({t: i === 6 ? 40 : 48, fl: i === 6 ? 40 : 48}));
  check('a cold morning without a sharp fall stays a cold-morning candidate',
    topic(C(H, {now: new Date(2026, 7, 14, 0)}), 'cold').headline, 'Cold morning');

  for (const [hour, expected] of [[3, false], [4, true], [9, true], [10, false]]) {
    H = hours(new Date(2026, 7, 14, 0), 12, i => ({fog: i === hour}));
    check(`fog at ${hour}:00 respects the morning-drive window`, !!topic(C(H, {now: new Date(2026, 7, 14, 0)}), 'fog'), expected);
  }
  for (const [mph, expected] of [[24, null], [25, 'Windy near 2pm'], [34, 'Windy near 2pm'], [35, 'Very windy near 2pm']]) {
    H = hours(NOW, 12, i => ({mph: i === 2 ? mph : 5}));
    check(`wind threshold at ${mph} mph`, topic(weather(H), 'wind')?.headline || null, expected);
  }

  H = hours(NOW, 12);
  check('expired UV peak cannot speak', !!topic(weather(H, {uvPeak: {v: 12, t: NOW.getTime() - 1}}), 'uv'), false);
  check('UV 7 stays below the action threshold', !!topic(weather(H, {uvPeak: {v: 7, t: NOW.getTime() + 3600000}}), 'uv'), false);
  check('UV 8 becomes very high guidance', topic(weather(H, {uvPeak: {v: 8, t: NOW.getTime() + 3600000}}), 'uv').headline,
    'Very high UV near 1pm');
  check('UV 11 becomes extreme guidance', topic(weather(H, {uvPeak: {v: 11, t: NOW.getTime() + 3600000}}), 'uv').headline,
    'Extreme UV near 1pm');
  check('AQI 100 stays quiet', !!topic(weather(H, {aqi: 100}), 'air'), false);
  check('AQI 101 triggers sensitive-group guidance', topic(weather(H, {aqi: 101}), 'air').action,
    'Sensitive groups should limit prolonged outdoor exertion.');

  const NIGHT = new Date(2026, 7, 13, 21);
  H = hours(NIGHT, 6, () => ({t: 65, fl: 65, dew: 50, pop: 0, mph: 5, day: false}));
  check('four continuous mild dry night hours support window-opening guidance',
    topic(C(H, {now: NIGHT}), 'overnight').headline, 'Comfortable overnight');
  H = hours(NIGHT, 6, () => ({t: 65, fl: 65, dew: null, pop: 0, mph: 5, day: false}));
  check('missing dew point cannot be described as dry air', !!topic(C(H, {now: NIGHT}), 'overnight'), false);
  H = hours(NIGHT, 6, () => ({t: 72, fl: 72, dew: 68, pop: 0, mph: 5, day: false}));
  check('muggy overnight conditions warn that windows may not help', topic(C(H, {now: NIGHT}), 'overnight').headline,
    'Warm and humid overnight');
  H = hours(NIGHT, 6, () => ({t: 65, fl: 65, dew: 50, pop: 0, mph: 5, day: false}));
  H[2].d = new Date(H[2].d.getTime() + 3600000);
  check('a gap in hourly coverage cannot certify the overnight window', !!topic(C(H, {now: NIGHT}), 'overnight'), false);

  const MORNING = new Date(2026, 7, 13, 8);
  H = hours(MORNING, 6);
  check('four or more genuinely good daylight hours earn the excellent call', topic(C(H, {now: MORNING}), 'outdoors').headline,
    'Excellent outdoor conditions');
  H = hours(MORNING, 6, i => i === 2 ? {pop: 20} : {});
  check('20 percent rain prevents an all-day excellent claim', !!topic(C(H, {now: MORNING}), 'outdoors'), false);
  H = hours(MORNING, 6, i => i === 2 ? {fl: 95} : {});
  check('feels-like 95 prevents an all-day excellent claim', !!topic(C(H, {now: MORNING}), 'outdoors'), false);
  H = hours(MORNING, 6, i => i === 2 ? {mph: 16} : {});
  check('16 mph wind prevents an all-day excellent claim', !!topic(C(H, {now: MORNING}), 'outdoors'), false);
  H = hours(MORNING, 6, i => i === 2 ? {dew: 67} : {});
  check('oppressive humidity prevents an all-day excellent claim', !!topic(C(H, {now: MORNING}), 'outdoors'), false);
  H = hours(MORNING, 6, i => i === 2 ? {t: null, fl: null} : {});
  check('missing temperature cannot become an excellent-day claim', !!topic(C(H, {now: MORNING}), 'outdoors'), false);
  check('the excellent-day claim stops after 5 PM',
    !!topic(C(hours(new Date(2026, 7, 13, 17), 4, () => ({day: true})), {now: new Date(2026, 7, 13, 17)}), 'outdoors'), false);

  H = hours(EVE, 24, i => ({fl: i < 2 ? 99 : 70}));
  const afterFiveWindow = topic(C(H, {now: EVE}), 'outdoors');
  check('after 5 PM can still find tomorrow daylight', afterFiveWindow.windowLabel, '7am–9am tomorrow');
  H = hours(new Date(2026, 7, 13, 7), 14, i => ({fl: i === 0 ? 99 : 70, day: false}));
  check('clock time alone cannot masquerade as official daylight', !!topic(C(H, {now: new Date(2026, 7, 13, 7)}), 'outdoors'), false);
  H = hours(new Date(2026, 7, 13, 7), 5, i => ({fl: i === 0 || i === 3 || i === 4 ? 120 : 70, day: true}));
  H[2].d = new Date(H[2].d.getTime() + 3600000);
  check('non-contiguous forecast hours cannot form a two-hour outdoor window',
    !!topic(C(H, {now: new Date(2026, 7, 13, 7)}), 'outdoors'), false);
  H = hours(MORNING, 6);
  check('quiet weather does not invent a narrow best-window cutoff',
    topic(C(H, {now: MORNING}), 'outdoors').headline, 'Excellent outdoor conditions');
  check('empty hourly data produces no weather claims', C([], {now: NOW}), []);
}

/* ============ Bottom Line local-alert selection ============ */
{
  const L = SUBJECT.bottomLineLocalAlert;
  const awayEmergency = {scope: 'away', ev: 'Tornado Warning', lv: {k: 'emergency'}, latest: 500};
  const localAdvisory = {scope: 'here', ev: 'Heat Advisory', lv: {k: 'advisory'}, latest: 300};
  const localWarning = {scope: 'here', ev: 'High Wind Warning', lv: {k: 'warning'}, latest: 400};
  check('alerts elsewhere never enter Bottom Line state', L([awayEmergency]), null);
  check('the strongest local alert wins regardless of input order', L([localAdvisory, awayEmergency, localWarning]),
    {event: 'High Wind Warning', family: 'wind', level: 'warning', ends: 400});
  check('reversing alert input cannot change the strongest local alert',
    L([localWarning, awayEmergency, localAdvisory]), L([localAdvisory, awayEmergency, localWarning]));
  const floodWarning = {scope: 'here', ev: 'Flash Flood Warning', lv: {k: 'warning'}, sev: 'Severe', latest: 450};
  const stormWarning = {scope: 'here', ev: 'Severe Thunderstorm Warning', lv: {k: 'warning'}, sev: 'Severe', latest: 460};
  check('equal-level local alerts use a deterministic tiebreaker',
    L([stormWarning, floodWarning]), L([floodWarning, stormWarning]));
  check('degraded flat mode remains fail-open for alert translation',
    L([{scope: '', ev: 'Winter Storm Watch', lv: {k: 'watch'}, latest: 200}]),
    {event: 'Winter Storm Watch', family: 'winter', level: 'watch', ends: 200});
  check('missing alert groups fail quiet', L(null), null);
}

/* ============ buildBottomLine ============ */
// Feed completion order cannot decide the visible hierarchy. One topic earns one slot; wet timing
// is protected, dry timing competes normally, and climate context is reserved for a quiet lead.
{
  const B = SUBJECT.buildBottomLine;
  function c(topic, priority, context, headline, extras) {
    return Object.assign({ topic, priority, context: !!context, headline: headline || topic,
      icon: 'check', label: topic, detail: '', action: '', tone: context ? 'context' : 'neutral' }, extras || {});
  }
  function shape(list, alert) {
    const m = B(list, alert);
    return { lead: m.lead && `${m.lead.topic}:${m.lead.headline}`,
      supports: m.supports.map(x => `${x.topic}:${x.headline}`) };
  }

  check('a local severe-storm warning outranks unrelated dangerous heat', shape([
    c('heat', 100, false, 'Dangerous heat', {icon: 'heat', tone: 'danger'}),
    c('precip', 95, false, 'Thunderstorms likely', {icon: 'storm', tone: 'danger'})
  ], {family: 'convective', event: 'Severe Thunderstorm Warning', level: 'warning'}),
    {lead: 'precip:Be ready to move plans indoors', supports: ['heat:Dangerous heat']});
  check('a local winter warning outranks unrelated dangerous heat', shape([
    c('heat', 100, false, 'Dangerous heat', {icon: 'heat', tone: 'danger'}),
    c('winter', 89, false, 'Moderate winter impacts', {icon: 'snow', tone: 'danger'})
  ], {family: 'winter', event: 'Winter Storm Warning', level: 'warning'}),
    {lead: 'winter:Allow extra time for winter travel', supports: ['heat:Dangerous heat']});
  check('a watch does not displace a more consequential unrelated lead', shape([
    c('heat', 100, false, 'Dangerous heat', {icon: 'heat', tone: 'danger'}),
    c('storm', 80, false, 'Severe storms possible', {icon: 'storm', tone: 'warning'})
  ], {family: 'convective', event: 'Severe Thunderstorm Watch', level: 'watch'}),
    {lead: 'heat:Dangerous heat', supports: ['storm:Severe storms possible']});
  check('an unmatched emergency suppresses a distracting unrelated briefing', shape([
    c('heat', 100, false, 'Dangerous heat', {icon: 'heat', tone: 'danger'})
  ], {family: 'convective', event: 'Tornado Warning', level: 'emergency'}),
    {lead: null, supports: []});
  check('an unmatched non-emergency warning does not invent a weather candidate', shape([
    c('heat', 100, false, 'Dangerous heat', {icon: 'heat', tone: 'danger'})
  ], {family: 'flood', event: 'Flood Warning', level: 'warning'}),
    {lead: 'heat:Dangerous heat', supports: []});

  const airAlert = {family: 'convective', event: 'Air Quality Alert', level: 'advisory'};
  check('air-quality products match air guidance',
    B([c('air', 75, false, 'Poor air quality', {icon: 'air', tone: 'warning'})], airAlert).lead.alertAware, true);
  check('air-quality products cannot rewrite storm guidance',
    B([c('storm', 80, false, 'Storms possible', {icon: 'storm', tone: 'warning'})], airAlert).lead.alertAware, undefined);
  const smokeAlert = {family: 'fire', event: 'Dense Smoke Advisory', level: 'advisory'};
  check('smoke products cannot rewrite fire-weather guidance',
    B([c('fire', 82, false, 'Critical fire weather', {icon: 'fire', tone: 'warning'})], smokeAlert).lead.alertAware, undefined);
  const fogAlert = {family: 'convective', event: 'Dense Fog Advisory', level: 'advisory'};
  check('fog products cannot rewrite severe-storm guidance',
    B([c('storm', 80, false, 'Storms possible', {icon: 'storm', tone: 'warning'})], fogAlert).lead.alertAware, undefined);

  check('dangerous heat leads its practical briefing', shape([
    c('climate', 92, true, 'record'), c('overnight', 30),
    c('heat', 100, false, 'heat', {tone: 'danger'}), c('precip', 40)
  ]), { lead: 'heat:heat', supports: ['precip:precip', 'overnight:overnight'] });

  check('severe outlook and useful storm timing coexist', shape([
    c('storm', 97, false, 'storm', {tone: 'danger'}),
    c('precip', 95, false, 'precip', {supportRank: 0}), c('air', 75), c('outdoors', 58)
  ]), { lead: 'storm:storm', supports: ['precip:precip', 'air:air', 'outdoors:outdoors'] });

  check('rain-only data still produces a lead', shape([c('precip', 60)]),
    { lead: 'precip:precip', supports: [] });

  check('quiet weather leads with the outdoor opportunity', shape([
    c('precip', 40), c('overnight', 50), c('outdoors', 55), c('climate', 88, true)
  ]), { lead: 'outdoors:outdoors', supports: ['overnight:overnight', 'precip:precip', 'climate:climate'] });

  check('poor AQI can lead when it is the main actionable issue', shape([
    c('precip', 40), c('air', 75, false, 'air', {tone: 'warning'}), c('climate', 92, true)
  ]), { lead: 'air:air', supports: ['precip:precip'] });

  check('freezing suppresses the weaker duplicate cold cue', shape([
    c('cold', 70, false, 'cold morning'), c('precip', 40), c('cold', 85, false, 'freezing early')
  ]), { lead: 'cold:freezing early', supports: ['precip:precip'] });

  check('outdoor-window scan no longer stops after 5 PM',
    /if\(maxFl>=99\|\|wet0>=0\|\|wMax>=25\)/.test(SRC), true);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(7, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow); tomorrowEnd.setHours(9);
  check('tomorrow outdoor window carries its day', SUBJECT.windowSpan(tomorrow, tomorrowEnd), '7am–9am tomorrow');

  check('climate stays out of a hazard briefing even with a spare slot', shape([
    c('heat', 100, false, 'heat', {tone: 'danger'}), c('precip', 40), c('climate', 99, true)
  ]), { lead: 'heat:heat', supports: ['precip:precip'] });

  check('dry precipitation competes instead of claiming a reserved slot', shape([
    c('heat', 100, false, 'heat', {tone: 'danger'}), c('air', 75), c('wind', 65),
    c('outdoors', 58), c('precip', 40)
  ]), { lead: 'heat:heat', supports: ['air:air', 'wind:wind', 'outdoors:outdoors'] });

  check('wet timing keeps its protected support rank', shape([
    c('heat', 100, false, 'heat', {tone: 'danger'}),
    c('precip', 60, false, 'wet', {supportRank: 0}), c('air', 75), c('wind', 65), c('outdoors', 58)
  ]), { lead: 'heat:heat', supports: ['precip:wet', 'air:air', 'wind:wind'] });

  const merged = B([
    c('heat', 100, false, 'Dangerous heat', {tone: 'danger', detail: 'Heat index around 111°.', action: 'Limit exertion near peak heat.'}),
    c('outdoors', 58, false, 'Best window', {mergeAction: 'Use 7am–9am tomorrow for strenuous plans.', windowLabel: '7am–9am tomorrow', windowEnd: '9am tomorrow'}),
    c('precip', 40)
  ]);
  check('best window becomes specific lead guidance', merged.lead.action,
    'If outdoor work is necessary, finish by 9am tomorrow. Limit exertion near peak heat.');
  check('merged outdoor guidance does not consume a support slot', merged.supports.map(x => x.topic), ['precip']);

  const alerted = B([
    c('heat', 100, false, 'Dangerous heat', {tone: 'danger', icon: 'heat', detail: 'Heat index around 111°.', action: 'Limit exertion near peak heat.'}),
    c('outdoors', 58, false, 'Best window', {mergeAction: 'Use 7am–9am tomorrow for strenuous plans.', windowLabel: '7am–9am tomorrow', windowEnd: '9am tomorrow'})
  ], {family: 'heat', event: 'Extreme Heat Warning'});
  check('matching local alert translates into a plan', alerted.lead.headline,
    'Finish strenuous outdoor work by 9am tomorrow');
  check('alert title is not repeated in the briefing', JSON.stringify(alerted).includes('Extreme Heat Warning'), false);
  check('alert-aware lead retains local provenance', alerted.lead.detail,
    'Alert active locally · Heat index around 111°.');

  /* Copy matrix: every hazard that can own the lead. A usable outdoor window should become a
     natural cutoff only for conditions it helps avoid; without one, the alert becomes a concise
     condition-specific action. The product title itself always stays in the alert banner. */
  const windowCue = c('outdoors', 58, false, 'Best window', {
    mergeAction: 'Use 7am–9am tomorrow for weather-sensitive plans.',
    windowLabel: '7am–9am tomorrow', windowEnd: '9am tomorrow'
  });
  [
    {name: 'heat', candidate: c('heat', 100, false, 'Dangerous heat', {icon: 'heat', tone: 'danger'}),
      alert: {family: 'heat', event: 'Extreme Heat Warning'},
      headline: 'Finish strenuous outdoor work by 9am tomorrow'},
    {name: 'severe storms', candidate: c('storm', 97, false, 'Severe storms likely', {icon: 'storm', tone: 'danger'}),
      alert: {family: 'convective', event: 'Severe Thunderstorm Warning'},
      headline: 'Finish weather-sensitive outdoor tasks by 9am tomorrow'},
    {name: 'thunderstorm timing', candidate: c('precip', 95, false, 'Thunderstorms likely', {icon: 'storm', tone: 'danger'}),
      alert: {family: 'convective', event: 'Severe Thunderstorm Watch'},
      headline: 'Finish weather-sensitive outdoor tasks by 9am tomorrow'},
    {name: 'wind', candidate: c('wind', 78, false, 'Very windy', {icon: 'wind', tone: 'danger'}),
      alert: {family: 'wind', event: 'High Wind Warning'},
      headline: 'Handle outdoor setup by 9am tomorrow'}
  ].forEach(x => {
    const m = B([x.candidate, windowCue], x.alert);
    check(`${x.name} alert uses a natural window cutoff`, m.lead.headline, x.headline);
    check(`${x.name} alert title stays in the banner`, JSON.stringify(m.lead).includes(x.alert.event), false);
    check(`${x.name} merged window does not become a support`, m.supports.map(s => s.topic).includes('outdoors'), false);
  });

  [
    {name: 'heat', candidate: c('heat', 100, false, 'Dangerous heat', {tone: 'danger', action: 'Limit exertion.'}),
      action: 'If outdoor work is necessary, finish by 9am tomorrow. Limit exertion.'},
    {name: 'storm outlook', candidate: c('storm', 97, false, 'Severe storms likely', {tone: 'danger', action: 'Keep alerts enabled.'}),
      action: 'Finish weather-sensitive outdoor tasks by 9am tomorrow. Keep alerts enabled.'},
    {name: 'ordinary rain', candidate: c('precip', 60, false, 'Rain likely', {icon: 'rain', tone: 'warning', action: 'Plan around rain.'}),
      action: 'Finish weather-sensitive outdoor tasks by 9am tomorrow. Plan around rain.'},
    {name: 'wind', candidate: c('wind', 78, false, 'Very windy', {tone: 'danger', action: 'Secure loose objects.'}),
      action: 'Handle weather-sensitive outdoor tasks by 9am tomorrow. Secure loose objects.'}
  ].forEach(x => {
    const m = B([x.candidate, windowCue]);
    check(`${x.name} uses the cutoff without an alert`, m.lead.action, x.action);
  });

  [
    {name: 'heat', topic: 'heat', headline: 'Dangerous heat', alert: {family: 'heat', event: 'Heat Advisory'},
      expected: 'Avoid strenuous outdoor work near peak heat'},
    {name: 'severe storms', topic: 'storm', headline: 'Severe storms likely', alert: {family: 'convective', event: 'Tornado Watch'},
      expected: 'Be ready to move plans indoors'},
    {name: 'wintry precipitation', topic: 'precip', icon: 'snow', headline: 'Snow or wintry mix', alert: {family: 'winter', event: 'Winter Storm Warning'},
      expected: 'Allow extra time for winter travel'},
    {name: 'winter outlook', topic: 'winter', headline: 'Major winter impacts', alert: {family: 'winter', event: 'Winter Storm Watch'},
      expected: 'Allow extra time for winter travel'},
    {name: 'freezing cold', topic: 'cold', headline: 'Freezing early', alert: {family: 'winter', event: 'Freeze Warning'},
      expected: 'Plan around freezing or dangerous cold'},
    {name: 'flooding', topic: 'flood', headline: 'Flash flooding likely', alert: {family: 'flood', event: 'Flash Flood Warning'},
      expected: 'Avoid flood-prone travel during heavy rain'},
    {name: 'fire weather', topic: 'fire', headline: 'Critical fire weather', alert: {family: 'fire', event: 'Red Flag Warning'},
      expected: 'Avoid outdoor burning'},
    {name: 'wind', topic: 'wind', headline: 'Very windy', alert: {family: 'wind', event: 'Wind Advisory'},
      expected: 'Secure loose outdoor objects'},
    {name: 'air quality', topic: 'air', headline: 'Poor air quality', alert: {family: 'convective', event: 'Air Quality Alert'},
      expected: 'Limit prolonged outdoor exertion'},
    {name: 'smoke', topic: 'air', headline: 'Poor air quality', alert: {family: 'fire', event: 'Dense Smoke Advisory'},
      expected: 'Limit prolonged outdoor exertion'},
    {name: 'fog', topic: 'fog', headline: 'Fog early', alert: {family: 'convective', event: 'Dense Fog Advisory'},
      expected: 'Slow down for reduced visibility'}
  ].forEach(x => {
    const candidate = c(x.topic, 90, false, x.headline, {icon: x.icon || x.topic, tone: 'warning'});
    const m = B([candidate], x.alert);
    check(`${x.name} alert has useful no-window guidance`, m.lead.headline, x.expected);
    check(`${x.name} no-window case invents no morning cutoff`, /\b9am\b/.test(m.lead.headline + ' ' + m.lead.action), false);
  });

  [
    {topic: 'precip', headline: 'Rain likely'}, {topic: 'cold', headline: 'Cold morning'},
    {topic: 'fog', headline: 'Fog early'}, {topic: 'uv', headline: 'Extreme UV'},
    {topic: 'air', headline: 'Poor air quality'}, {topic: 'flood', headline: 'Flooding possible'},
    {topic: 'fire', headline: 'Critical fire weather'}, {topic: 'winter', headline: 'Winter impacts'},
    {topic: 'overnight', headline: 'Comfortable overnight'}, {topic: 'outdoors', headline: 'Excellent outdoor conditions'}
  ].forEach(x => {
    const m = B([c(x.topic, 70, false, x.headline, {tone: 'warning'})]);
    check(`${x.topic} stays literal without alert or window evidence`, m.lead.headline, x.headline);
    check(`${x.topic} invents no morning cutoff`, /\b9am\b/.test(m.lead.headline + ' ' + m.lead.action), false);
  });

  const mismatch = B([
    c('wind', 78, false, 'Very windy', {icon: 'wind', tone: 'danger'}), windowCue
  ], {family: 'heat', event: 'Heat Advisory'});
  check('an unrelated active alert cannot rewrite the lead', mismatch.lead.headline, 'Very windy');
  check('an unrelated alert still allows evidence-based window guidance', mismatch.lead.action,
    'Handle weather-sensitive outdoor tasks by 9am tomorrow.');

  const unordered = [c('wind', 65), c('precip', 40), c('heat', 72), c('outdoors', 58), c('climate', 88, true)];
  check('candidate arrival order cannot change the briefing',
    JSON.stringify(shape(unordered)), JSON.stringify(shape(unordered.slice().reverse())));

  check('missing optional feeds are valid', B([null, undefined, c('precip', 40)]).lead.topic, 'precip');
  check('context alone never becomes the Bottom Line', shape([c('climate', 99, true)]),
    { lead: null, supports: [] });

  check('the horizon names a concrete end time',
    SUBJECT.bottomLineHorizon(new Date(2026, 7, 14, 21)), 'Through Fri 9 PM');
}

/* ============ extractAFD ============ */
// LSX often puts a slash-delimited time qualifier between SHORT TERM and the ellipsis. The
// dashboard must accept both that operational form and the simpler heading used by older products.
{
  const E = SUBJECT.extractAFD;
  check('extractAFD accepts qualified SHORT TERM heading',
    E(`.SHORT TERM /THROUGH THURSDAY/...
Useful short-term guidance for the next day.
&&`),
    { kind: 'para', label: 'Short-Term Outlook', text: 'Useful short-term guidance for the next day.' });
  check('extractAFD accepts plain SHORT TERM heading',
    E(`.SHORT TERM...
Useful short-term guidance without a qualifier.
$$`),
    { kind: 'para', label: 'Short-Term Outlook', text: 'Useful short-term guidance without a qualifier.' });
  check('extractAFD still prefers KEY MESSAGES',
    E(`.KEY MESSAGES...
- First actionable point for today.

.SHORT TERM /TODAY/...
Secondary forecast prose that should not win.
&&`),
    { kind: 'key', label: 'Key Messages', text: '- First actionable point for today.' });
  check('extractAFD rejects unrelated text', E('Area forecast discussion without a recognized section.'), null);
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
console.log('ok    logic: rangeMark, alertLevel, isTakeCover, cardCmp, strongestHit, alertScope, scopeAttr, FAMILY_CFG,\n             compact forecast decisions, regime summaries, hourly extrema, coldVerdict, outlookVerdict,\n             Bottom Line hourly candidates, local-alert routing, buildBottomLine, extractAFD, parseMcd,\n             mcdValidEnd, geomTouchesEnv, watchBoundary and chaikinRing behave');
