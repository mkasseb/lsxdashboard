/* Pure weather decisions and date/geometry helpers. Loaded before feeds and UI. */
/* ============ HELPERS ============ */
var WEATHER_TZ="America/Chicago";

var WEATHER_PARTS=new Intl.DateTimeFormat("en-US",{timeZone:WEATHER_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"});

/* ===== One severity ramp =====
   NWS hands us two orthogonal signals and the card used to colour itself by BOTH at once: CAP's
   `severity` field and the word in the event name. They disagree often — a Flood Advisory can carry
   severity "Severe" — so the same alert would arrive tinted one way and tagged another. Worse, the
   NWS's own watch/warning colour table runs to ~60 hues, which is the thing Hazard Simplification
   exists to collapse; every serious public warning system (Met Office, ECCC) has settled on a short
   ramp instead.

   So: rank by the WORD, because that is what the reader is being asked to act on, and let CAP
   severity escalate — never demote — a step above it. The event FAMILY (eventFamily) stays a
   separate axis on purpose: it answers "what kind of weather", not "how bad". */
var LEVELS={
  emergency:{k:"emergency", label:"Emergency", rank:0},
  warning:  {k:"warning",   label:"Warning",   rank:1},
  watch:    {k:"watch",     label:"Watch",     rank:2},
  advisory: {k:"advisory",  label:"Advisory",  rank:3},
  statement:{k:"statement", label:"Statement", rank:4}
};

/* ============ ALERTS (Fix 2) ============ */
/* CAP's own severity field, ranked. It is the LAST tiebreaker in the card order below and the only
   thing that decides which segment of a group speaks for it — never the primary sort, because it
   disagrees with the event name often enough that alertLevel() exists to arbitrate. */
var ALERT_SEV_RANK={Extreme:0,Severe:1,Moderate:2,Minor:3,Unknown:4};

var HIT_RANK={polygon:0, county:1, zone:2, fire:3};

/* Per-family presentation: icon, and — where present — `merge`, which marks the family's products
   as foldable into one banner (its value names the hazard, for the reader of this table). A family
   carries `merge` only if its products are graduated TIERS of one hazard: an Extreme Heat Warning
   and a Heat Advisory are the same air at different strengths, and NWS even writes them as one
   text ("For the Extreme Heat Warning... For the Heat Advisory..."). It is deliberately absent
   from convective and flood — a Tornado Warning and a Severe Thunderstorm Watch share a family
   without being the same hazard, and a Flash Flood Warning is not a tier of a river Flood
   Warning. */
var FAMILY_CFG={
  convective:{ico:"storm"},
  winter:    {ico:"snow",    merge:"Winter weather"},
  flood:     {ico:"flood"},
  heat:      {ico:"heat",    merge:"Heat"},
  wind:      {ico:"wind",    merge:"Wind"},
  fire:      {ico:"fire",    merge:"Fire weather"}
};

/* Which cold thing to say about the hours ahead, if any — the decision on its own, so it can be
   tested without a DOM. `nowT` is the current temperature, `mMin` the 6–9am low (null if the
   window holds no morning), `cMin` the lowest hour ahead (null if unknown).

   One trough, one verdict. These used to be two independent blocks and both fired: a 70° evening
   falling to 40° by dawn printed "Falling 30° to 40° by 7am — dress in layers" AND "40° near 7am
   — dress for cold", one fact twice, in a card that only shows four.

   The order is what the reader has to do about it. Freezing outranks everything because ice is a
   different problem from a chilly evening, and "layers" is the wrong advice for 28°.

   `cMin<=LAYERS` is the fix for the bug that started this: "dress in layers" is advice about
   where the temperature LANDS, not how far it fell. Gated on the fall alone, a 99° afternoon
   easing to 80° overnight — the ordinary summer diurnal cycle, still shorts-and-a-fan weather —
   advised layers. Every hot day does that, and none of them need a jacket. */
var LAYERS_MAX=58;   // about where an evening starts to want a jacket

/* Which outlook candidate a hazard family earns, if any — the decision on its own, so it can be
   tested without a DOM. `l0`/`l1` are today's and tomorrow's category LEVELS (spcRisk/eroRisk/
   fireRisk .lvl, not raw dn), so "no risk" (-1) and SPC's "General Storms" (0) both fall out
   of the same `<1` gate.

   One candidate per hazard family: the card holds four slots, and two flood messages would say less
   than one. The stronger day speaks; a tie reads "today and tomorrow" — dropping the weaker
   day is fine because the outlook matrix below still shows every cell.

   Priorities sit ON PURPOSE around the hourly candidates: an SPC Moderate (97) outranks the wet
   block's own thunderstorm call (95) because "widespread severe storms" is the why behind it,
   but a Marginal (59) must not push "Rain likely" (60) off a quiet card. */
var OUTLOOK_CFG={
  spc:{ico:"storm", topic:"storm", label:"Severe outlook", action:"Review your severe-weather plan and keep alerts enabled.", den:5, pri:[0,59,80,90,97,99],
       cat:["","Marginal Risk","Slight Risk","Enhanced Risk","Moderate Risk","High Risk"],
       txt:["","Isolated severe storms possible","Severe storms possible","Severe storms likely",
            "Widespread severe storms expected","Severe weather outbreak expected"]},
  ero:{ico:"flood", topic:"flood", label:"Flood outlook", action:"Avoid flood-prone roads if heavy rain develops.", den:4, pri:[0,44,79,91,98],
       cat:["","Marginal Risk","Slight Risk","Moderate Risk","High Risk"],
       txt:["","Isolated flash flooding possible","Flash flooding possible","Flash flooding likely",
            "Widespread flash flooding expected"]},
  fire:{ico:"fire", topic:"fire", label:"Fire outlook", action:"Avoid outdoor burning and anything that could spark.", den:3, pri:[0,51,82,94],
       cat:["","","",""],   // "Critical fire weather (Critical 2/3)" would say it twice
       txt:["","Elevated fire weather","Critical fire weather","Extreme fire weather"]},
  /* WPC's Winter Storm Severity Index (wssiQuery ranks its `impact` field 1–4). Major (96)
     outranks the wet block's own wintry call (93) for the same reason Moderate severe outranks
     thunder: the hourly rules can say "snow tonight", only the desk can say how bad. */
  wssi:{ico:"snow", topic:"winter", label:"Winter outlook", action:"Build extra time into travel plans.", den:4, pri:[0,61,89,96,99],
       cat:["","","","",""],   // "Minor winter impacts (Minor 1/4)" would say it twice
       txt:["","Minor winter impacts","Moderate winter impacts","Major winter storm impacts",
            "Extreme winter storm impacts"]}
};

function weatherParts(value){
  var d=value==null?new Date():new Date(value), p={};
  WEATHER_PARTS.formatToParts(d).forEach(function(v){ if(v.type!=="literal") p[v.type]=Number(v.value); });
  p.month--; p.key=p.year+"-"+("0"+(p.month+1)).slice(-2)+"-"+("0"+p.day).slice(-2);
  return p;
}

function weatherTime(value,options){
  return new Date(value).toLocaleString("en-US",Object.assign({timeZone:WEATHER_TZ},options));
}

/* Calendar-only ACIS dates are carried at UTC noon and advanced in UTC. They are not instants
   to convert into the viewer's timezone, and a calendar day must stay 24 hours across DST. */
function calendarDate(key){
  var p=String(key).split("-");
  return new Date(Date.UTC(+p[0],+p[1]-1,+p[2],12));
}

function weatherDay(value){ return calendarDate(weatherParts(value).key); }

/* Where the "now" mark sits on the range bar, as a 0-1 fraction of the track, or null when there
   is nothing to mark. Split out of the paint so it can be exercised without a browser — see
   tools/logic-tests.js. The ends are deliberately NOT sorted, so the fraction has to survive a
   descending pair; it does, because both differences flip sign together.
   An identical pair has no position to mark but is still a true thing to draw, so it returns null
   rather than suppressing the row — and never NaN, which would emit `left:NaN%`. */
function rangeMark(lo,hi,now){
  if(lo==null||hi==null||now==null||hi===lo) return null;
  return Math.max(0,Math.min(1,(now-lo)/(hi-lo)));
}

/* Everything the range row decides, in one place with no DOM in reach: which two readings are the
   ends, whether there is a row at all, and where the mark goes. The paint below only formats what
   this returns — which is the point, because the bug this shape exists to prevent lived in a guard,
   not in the arithmetic, and a guard buried in a paint function cannot be tested.

   Both ends is the ONLY requirement. It used to also demand hi>lo, which quietly drew nothing on
   the one evening the row matters most: after the last daytime period the ends are tonight's low
   and TOMORROW's high, so an Arctic front puts tomorrow below tonight — the reading most worth
   seeing, and the only one that vanished. Nothing else needed changing: rangeMark()'s fraction
   already handles a descending pair, because both differences flip sign together.

   The gradient is not what tells you the direction — tCol() maps each end by its ABSOLUTE value on
   the scale the rest of the page shares, so 62°→48° is green-to-green and reads as two mild
   readings, which is what they are. Direction comes from the numbers and the mark's position. That
   is the deliberate trade made when this bar joined the shared scale: a gradient tuned to dramatise
   each row's own delta would make identical colours mean different things in different cards. */
function rangeRow(d0,d1,now){
  var lo=d0&&d0.night?d0.night.temperature:null;
  var hi=d0&&d0.day?d0.day.temperature:null;
  /* After the last daytime period has passed, the NWS feed's first entry is night-only, so there is
     no "today's high" left to show — which silently emptied this whole row every evening. Fall
     back to tonight's low against TOMORROW's high, and say so, rather than showing nothing. */
  var nextDay=false;
  if(hi==null&&d1&&d1.day&&d1.day.temperature!=null){ hi=d1.day.temperature; nextDay=true; }
  if(hi==null||lo==null) return null;
  /* How much colder tomorrow's high is than tonight's low — the cue that says out loud what the
     bar can only imply, since the gradient reports absolute temperature rather than direction.

     Gated on nextDay, and that gate is the whole subtlety of this row. Only in that branch do the
     ends run in time order: tonight's low on the left, tomorrow's high on the right. In the daytime
     branch they are today's OWN low and high — a range, not a sequence, and stored with the later
     reading (tonight's low) on the left. A warm front can put today's high under tonight's low
     there, which is the same arithmetic meaning the exact opposite thing, so "colder" would be
     backwards. It also only speaks when it has something to say: a daytime high that outruns the
     preceding night's low is every ordinary day, and needs no remarking. */
  var drop=(nextDay&&hi<lo)?(lo-hi):null;
  return {lo:lo, hi:hi, nextDay:nextDay, mark:rangeMark(lo,hi,now), drop:drop};
}

function alertParas(txt){
  return String(txt||"").split(/\n\s*\n/).map(function(p){ return p.replace(/\s*\n\s*/g," ").trim(); }).filter(Boolean);
}

function alertLevel(p){
  p=p||{};
  var ev=(p.event||"").toLowerCase(), sev=(p.severity||"").toLowerCase();
  // A tornado warning is the one event where the word and the stakes are not the same size.
  if(ev.indexOf("tornado")>=0&&ev.indexOf("warning")>=0) return LEVELS.emergency;
  /* A WATCH is never the top tier, whatever CAP says about it — the one place the escalate-never-
     demote rule above has to be told to sit down. NWS ships Tornado Watch with severity "Extreme",
     alone among watches: a sweep of every active watch in the country found Severe or below on all
     the rest (Flash Flood, Flood, High Wind, Fire Weather, Gale). So this branch is not a general
     rule doing its job on an unusual product — it fires on exactly one product, and it fires wrong.
     A watch says conditions are becoming favorable, which is the tier the word already names, and
     an emergency card is red, PULSES, and never folds — so a Tornado Watch was arriving in the
     exact chrome of the Tornado Warning it most needs to be distinguishable from. Above the
     `warning` test too, because no NWS event name carries both words and the ordering shouldn't
     depend on that staying true. */
  if(ev.indexOf("watch")>=0)    return LEVELS.watch;
  if(sev==="extreme") return LEVELS.emergency;
  if(ev.indexOf("warning")>=0)  return LEVELS.warning;
  if(ev.indexOf("advisory")>=0) return LEVELS.advisory;
  return LEVELS.statement;
}

/* Is this the tier where the answer is ACT NOW? Three places need to know, and they were each
   spelling it `lv.k==="emergency"` inline: the sort (it leads its list), the family fold (it is
   never a line item inside another card), and the local all-clear row (it drops the calm voice
   while one is running nearby). Three copies of one question, which is fine right up until the
   answer moves — and it just did, when Tornado Watch stopped being an emergency. That change
   silently rewrote all three call sites at once and happened to be correct at all three. Naming
   the question makes the coupling something you can see instead of something you rediscover. */
function isTakeCover(lv){ return !!lv&&lv.k==="emergency"; }

/* ===== The card order: what is over YOU leads =====
   Level used to be the primary key, which sounds right and reads wrong. alertLevel() promotes every
   Tornado Warning to `emergency`, so a tornado two counties away sorted above a Severe Thunderstorm
   Warning genuinely over the reader's roof. The reader is standing in one place; the first thing
   they see should be about that place.

   So coverage outranks level. The emergency term above it is still here but it no longer decides
   which SECTION a card lands in — loadAlerts files cards by coverage alone, so this comparator runs
   twice over, once inside "for this place" and once inside "elsewhere", and "an emergency leads"
   now means it leads its own list. That is the honest version of the rule: a tornado warning two
   counties over should be the first thing in the elsewhere list, and it should not be able to climb
   into a section that promises the reader it's about them. The coverage term still does real work
   in the degraded flat mode, where zones never resolved and one list holds everything.

   Hoisted out of loadAlerts() so tools/logic-tests.js can lift it: this is the rule the whole
   section exists to express, and it should be asserted rather than eyeballed. */
function cardCmp(a,b){
  var ae=isTakeCover(a.lv)?0:1, be=isTakeCover(b.lv)?0:1;
  if(ae!==be) return ae-be;                  // a take-cover product leads its list
  if(!!a.hit!==!!b.hit) return a.hit?-1:1;   // then everything over YOU, whatever its level
  if(a.lv.rank!==b.lv.rank) return a.lv.rank-b.lv.rank;
  var ra=ALERT_SEV_RANK[a.sev], rb=ALERT_SEV_RANK[b.sev];
  return (ra==null?5:ra)-(rb==null?5:rb);    // then by CAP severity within the level
}

/* The strongest evidence in a set of matches: polygon beats county beats zone beats fire. A group
   renders ONE card making ONE coverage claim, so its segments have to reduce to a single kind, and
   the claim has to be the one the best evidence supports. Falsy entries are misses. */
function strongestHit(kinds){
  var best=false;
  (kinds||[]).forEach(function(h){ if(h&&(!best||HIT_RANK[h]<HIT_RANK[best])) best=h; });
  return best;
}

/* ===== Which LIST a card belongs to =====
   Hoisted out of loadAlerts() for the reason cardCmp() is: this is the rule the alerts section
   exists to express — is this about the reader, or about somewhere else — and it should be
   asserted in tools/logic-tests.js rather than eyeballed against whatever the sky is doing today.
   It used to be a line inside a promise chain, testable only during an actual outbreak.

   Coverage decides it, and the signature is the reason it can't drift: there is nowhere to pass a
   severity. Severity sets how loud a card is; it never sets whether the card is about you.

   THREE answers, not two. "flat" is the degraded mode — zones never resolved, so coverage is
   unknowable and the page owes the reader one undivided list instead of a confident split it can't
   support. It is deliberately not "away": an alert we cannot place is not an alert we have placed
   somewhere else, and collapsing those two would file a warning that might be overhead under a
   heading that says it isn't. */
function alertScope(hit,localMode){
  if(!localMode) return "flat";
  return hit?"here":"away";
}

/* The DOM half of the same answer — which of the two cards an event can now own this one is. The
   flat mode writes no attribute rather than "flat": three readers normalise a missing data-scope
   to "" (the open-drawer set, the focus restore, the radar's polygon→card link), and the mode
   where coverage is unknowable should not hand them a third value to agree about. */
function scopeAttr(hit,localMode){ var s=alertScope(hit,localMode); return s==="flat"?"":s; }

// Classify an NWS event into a "family" so the alert banners can pick an icon and fold tiers.
function eventFamily(ev){
  ev=(ev||"").toLowerCase();
  if(/tornado|thunderstorm|special marine|dust storm|squall/.test(ev)) return "convective";
  if(/winter|snow|blizzard|ice storm|ice |sleet|freezing|frost|freeze|wind chill|cold/.test(ev)) return "winter";
  if(/flood|flash flood|hydrologic|seiche/.test(ev)) return "flood";
  if(/heat|hot/.test(ev)) return "heat";
  if(/fire|red flag|smoke/.test(ev)) return "fire";
  if(/wind|gale|storm warning|hurricane|tropical/.test(ev)) return "wind";
  return "convective"; // default treatment (red)
}

function coldVerdict(nowT,mMin,cMin){
  if(mMin!=null&&mMin<=32) return "freezing";
  if(nowT!=null&&nowT>=55&&cMin!=null&&cMin<=LAYERS_MAX&&nowT-cMin>=18) return "falling";
  if(mMin!=null&&mMin<=45) return "cold";
  return null;
}

/* Feels-like: NOAA's own formulas. Heat index (Rothfusz) when >=80°F; wind chill when <=50°F & wind >3 mph. */
function parseMph(s){ var m=String(s||"").match(/\d+/g); return m?Math.max.apply(null,m.map(Number)):null; }

/* Slim temperature sparkline that sits under the scrollable hour cards */
function precipChance(p){
  var v=p&&p.value;
  if(v==null||v==="") return null;
  v=Number(v);
  return isFinite(v)?Math.max(0,Math.min(100,Math.round(v))):null;
}

/* ── Next 24 Hours: full-width integrated hourly chart ──
   Smooth temp curve (per-hour color gradient) + day/night bands + precip bars
   + hour icons + now marker + hover readout. Re-renders on resize. */
/* NWS grid intervals carry totals for precipitation, but a constant speed for gusts.
   Never multiply a six-hour precipitation total by six or prorate it into an hourly forecast. */
function gridInterval(validTime){
  var parts=String(validTime||"").split("/"), start=Date.parse(parts[0]);
  var m=/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(parts[1]||"");
  if(parts.length!==2||!isFinite(start)||!m) return null;
  var duration=((+m[1]||0)*86400+(+m[2]||0)*3600+(+m[3]||0)*60+(+m[4]||0))*1000;
  return duration>0?{start:start,end:start+duration}:null;
}

function gridSeries(layer,kind){
  if(!layer||!Array.isArray(layer.values)) return [];
  var u=String(layer.uom||"").replace(/^wmoUnit:/,""), factor=null;
  if(kind==="amount") factor={mm:1/25.4,cm:1/2.54,m:1/0.0254,in:1}[u];
  if(kind==="wind") factor={"km_h-1":0.621371,"m_s-1":2.236936,"mi_h-1":1,kt:1.150779}[u];
  if(factor==null) return [];
  var out=[];
  layer.values.forEach(function(p){
    var t=gridInterval(p.validTime); if(!t) return;
    t.value=typeof p.value==="number"&&isFinite(p.value)&&p.value>=0?p.value*factor:null;
    out.push(t);
  });
  out.sort(function(a,b){return a.start-b.start;});
  // Overlapping intervals cannot safely be added or sampled; reject the ambiguous series.
  for(var i=1;i<out.length;i++) if(out[i].start<out[i-1].end) return [];
  return out;
}

function gridAmount(series,start,end){
  var cursor=start, amount=0;
  for(var i=0;i<series.length&&cursor<end;i++){
    var p=series[i]; if(p.end<=start||p.start>=end) continue;
    if(p.start>cursor||p.value==null) return null;
    // Zero can span a boundary. A nonzero total cannot be split without inventing its timing.
    if(p.value>0&&(p.start<start||p.end>end)) return null;
    amount+=p.value; cursor=Math.min(end,p.end);
  }
  return cursor>=end?amount:null;
}

function gridGustAt(series,at){
  for(var i=0;i<series.length;i++) if(series[i].start<=at&&at<series[i].end) return series[i].value;
  return null;
}

function precipEventSummary(grid,nowMs,horizonHours){
  var q=gridSeries(grid&&grid.quantitativePrecipitation,"amount");
  var snow=gridSeries(grid&&grid.snowfallAmount,"amount"), ice=gridSeries(grid&&grid.iceAccumulation,"amount");
  var limit=nowMs+horizonHours*3600000, events=[], currentEvent=null, cursor=nowMs, complete=true, unknown=false, unknownEnd=nowMs;
  q.forEach(function(p){
    if(p.end<=nowMs) return;
    var gap=p.start>cursor;
    if((gap||p.value==null)&&cursor<limit){ complete=false; unknown=true; unknownEnd=p.value==null?p.end:p.start; }
    if(gap||p.value==null){
      if(currentEvent) currentEvent.partial=true;
      currentEvent=null;
    }
    cursor=Math.max(cursor,p.end);
    if(p.value==null) return;
    if(p.value===0){
      // More than six known dry hours closes an event, including its missing-data boundary.
      // A later outage must not turn a completed earlier event into a subtotal.
      if(currentEvent&&p.end-currentEvent.end>6*3600000) currentEvent=null;
      if(unknown&&p.end-unknownEnd>6*3600000) unknown=false;
      return;
    }
    if(!currentEvent||p.start-currentEvent.end>6*3600000){
      if(p.start>=limit) { currentEvent=null; return; }
      currentEvent={start:p.start,end:p.end,amount:p.value,partial:unknown,ongoing:p.start<nowMs};
      events.push(currentEvent);
    }else{
      currentEvent.end=p.end; currentEvent.amount+=p.value;
    }
    unknown=false;
  });
  if(cursor<limit) complete=false;
  var edge=q.length?q[q.length-1].end:nowMs;
  events.forEach(function(e){
    e.snow=gridAmount(snow,e.start,e.end); e.ice=gridAmount(ice,e.start,e.end);
    e.continues=e.end===edge; e.beyondView=e.end>limit;
    // Only call liquid-equivalent QPF "rain" when both frozen-precipitation layers verify zero.
    e.rain=e.snow===0&&e.ice===0;
  });
  var frozenReported=snow.concat(ice).some(function(p){return p.start<limit&&p.end>nowMs&&p.value>0;});
  if(!events.length&&frozenReported) complete=false;
  return {events:events,complete:complete,dry:complete&&events.length===0};
}

function forecastWindowHours(hrs,hours,nowMs){
  var start=Math.floor(nowMs/3600000)*3600000, end=start+hours*3600000;
  return (hrs||[]).filter(function(p){
    var t=Date.parse(p.startTime);
    return isFinite(t)&&t>=start&&t<end&&typeof p.temperature==="number"&&isFinite(p.temperature);
  }).sort(function(a,b){return Date.parse(a.startTime)-Date.parse(b.startTime);});
}

function spcUtcTime(value){
  var m=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value||""));
  if(!m) return null;
  var t=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);
  // Date.UTC rolls invalid fields forward; reject those instead of legitimizing a bad timestamp.
  var d=new Date(t);
  return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]
    &&d.getUTCHours()===+m[4]&&d.getUTCMinutes()===+m[5]?t:null;
}

function spcOutlookPeriod(attrs,day,nowMs){
  if(!attrs) return null;
  var start=spcUtcTime(attrs.valid), end=spcUtcTime(attrs.expire), issue=spcUtcTime(attrs.issue);
  var d=new Date(nowMs), base=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),12);
  if(base>nowMs) base-=86400000;
  var expectedEnd=base+day*86400000;
  if(start==null||end!==expectedEnd||issue==null||issue>nowMs+10*60000) return null;
  if(day===1&&(start<base||start>nowMs)) return null;
  if(day===2&&start!==base+86400000) return null;
  return {start:start,end:end,issue:issue,valid:attrs.valid,expire:attrs.expire};
}

function spcThreatProductCurrent(data,period){
  if(!period||!data||data.error||data.exceededTransferLimit||!Array.isArray(data.features)||!data.features.length) return false;
  return data.features.every(function(f){
    var a=f&&f.attributes;
    return !!a&&a.valid===period.valid&&a.expire===period.expire&&spcUtcTime(a.issue)===period.issue;
  });
}

function spcThreatProbability(data,period,product){
  if(!period||!data||data.error||data.exceededTransferLimit||!Array.isArray(data.features)) return null;
  // An empty point query has no product timestamps. Only the same layer can verify its issuance.
  if(!data.features.length) return spcThreatProductCurrent(product,period)?0:null;
  if(!spcThreatProductCurrent(data,period)) return null;
  var max=0;
  for(var i=0;i<data.features.length;i++){
    var a=data.features[i].attributes;
    if(typeof a.dn!=="number"||!isFinite(a.dn)||a.dn<=0||a.dn>100) return null;
    max=Math.max(max,a.dn);
  }
  return max;
}

function spcThreatText(prob,kind){
  return prob==null?"Unavailable":prob===0?(kind==="tornado"?"<2%":"<5%"):prob+"%";
}

function heatIndexF(t,rh){
  if(t==null||rh==null||t<80) return null;
  var HI=-42.379+2.04901523*t+10.14333127*rh-0.22475541*t*rh-0.00683783*t*t-0.05481717*rh*rh
        +0.00122874*t*t*rh+0.00085282*t*rh*rh-0.00000199*t*t*rh*rh;
  if(rh<13&&t<=112) HI-=((13-rh)/4)*Math.sqrt((17-Math.abs(t-95))/17);
  else if(rh>85&&t<=87) HI+=((rh-85)/10)*((87-t)/5);
  return Math.round(Math.max(HI,t));   // HI is only meaningful when it exceeds the air temp
}

function windChillF(t,mph){
  if(t==null||mph==null||t>50||mph<=3) return null;
  return Math.round(35.74+0.6215*t-35.75*Math.pow(mph,0.16)+0.4275*t*Math.pow(mph,0.16));
}

function feelsLikeF(t,rh,mph){
  if(t==null) return null;
  var hi=heatIndexF(t,rh); if(hi!=null) return hi;
  var wc=windChillF(t,mph); if(wc!=null) return wc;
  return t;
}

/* ============ FORECAST ============ */
/* Compact display decisions used by the collapsed 7-day rows. These stay pure because every pixel
   is scarce in the one-third-width desktop card AND the phone card, and a subtle threshold change
   otherwise becomes something that can only be checked against whichever forecast happens to be
   live. The expanded row always preserves the exact NWS wording and precipitation value. */
function compactDayName(name){
  var days={Monday:"Mon",Tuesday:"Tue",Wednesday:"Wed",Thursday:"Thu",Friday:"Fri",Saturday:"Sat",Sunday:"Sun"};
  return days[name]||name;
}

function compactCondition(text,pop){
  var t=String(text||"").toLowerCase();
  if(t.indexOf("tornado")>=0) return "Tornado";
  if(t.indexOf("thunder")>=0||t.indexOf("storm")>=0){
    /* Match the coverage word to the same nearest-ten band the collapsed row presents. NWS
       point probabilities can arrive between those display steps (17%, 29%, etc.), so using the
       raw cutoff would let "~30%" sit beside "Isolated storms". Unknown or out-of-band values
       stay generic rather than claiming more spatial precision than the feed supports. */
    var chance=(pop==null||pop==="")?null:Number(pop);
    var band=(chance!=null&&isFinite(chance))?Math.max(0,Math.min(100,Math.round(chance/10)*10)):null;
    if(band>=10&&band<=20) return "Isolated storms";
    if(band>=30&&band<=50) return "Scattered storms";
    return "Storms";
  }
  if(t.indexOf("freezing")>=0||t.indexOf("sleet")>=0||t.indexOf("ice")>=0) return "Wintry mix";
  if(t.indexOf("snow")>=0||t.indexOf("flurr")>=0) return "Snow";
  if(t.indexOf("shower")>=0) return "Showers";
  if(t.indexOf("rain")>=0||t.indexOf("drizzle")>=0) return "Rain";
  if(t.indexOf("fog")>=0) return "Fog";
  if(t.indexOf("haze")>=0||t.indexOf("smoke")>=0) return "Hazy";
  if(t.indexOf("wind")>=0||t.indexOf("breezy")>=0||t.indexOf("blustery")>=0) return "Windy";
  if(t.indexOf("mostly sunny")>=0) return "Mostly sunny";
  if(t.indexOf("partly sunny")>=0) return "Partly sunny";
  if(t.indexOf("mostly clear")>=0) return "Mostly clear";
  if(t.indexOf("partly cloudy")>=0) return "Partly cloudy";
  if(t.indexOf("mostly cloudy")>=0) return "Mostly cloudy";
  if(t.indexOf("overcast")>=0||t.indexOf("cloudy")>=0) return "Cloudy";
  if(t.indexOf("sunny")>=0||t.indexOf("hot")>=0) return "Sunny";
  if(t.indexOf("clear")>=0||t.indexOf("fair")>=0) return "Clear";
  return text||"Forecast";
}

function summaryPop(pop){
  if(pop==null||pop<15) return null;
  return Math.min(100,Math.round(pop/10)*10);
}

function forecastImpact(feels,air){
  if(feels!=null&&feels>=100&&(air==null||feels-air>=5)) return {kind:"hot",label:"Feels "+Math.round(feels)+"°"};
  if(feels!=null&&feels<=0&&(air==null||air-feels>=5)) return {kind:"cold",label:"Feels "+Math.round(feels)+"°"};
  return null;
}

function summaryPopText(pop){
  var rounded=summaryPop(pop);
  if(rounded==null) return "";
  return (Math.round(pop)===rounded?"":"~")+rounded+"%";
}

/* Keep every NWS day/night period for the Bottom Line. The visible forecast card intentionally
   shows only seven rows, but after an evening load the feed can end with an eighth, day-only row. */
function pairForecastPeriods(periods){
  var days=[],i=0,ps=periods||[];
  while(i<ps.length){
    var p=ps[i];
    if(p.isDaytime){
      var n=(i+1<ps.length&&!ps[i+1].isDaytime)?ps[i+1]:null;
      days.push({name:p.name.replace("This ","").replace("Afternoon","Aft."),day:p,night:n});
      i+=n?2:1;
    }else{
      days.push({name:p.name,day:null,night:p});
      i++;
    }
  }
  return days;
}

/* One walk over the hourly forecast, two recoveries per local date:
   — rh: the humidity nearest midday (1pm). NWS removed relativeHumidity from the twice-daily
     /forecast periods (API discussion #752), so the day's headline humidity comes from here.
     rhH remembers WHICH hour won, because the cell's label says so: on a full day that's 1pm,
     but a "Tonight" row's nearest-to-midday hour is this evening, and a label that just said
     "midday" would be claiming an hour the feed never supplied.
   — fl/flMin: the date's hottest and coldest feels-like. The daily high and the 1pm humidity don't co-occur — the
     high lands mid-afternoon, after the morning moisture has mixed out — and running the heat
     index on that pair overstated summer days by ~5° (a forecast of 85°/77% afternoon showed
     "Feels Like 99°"). Each hour is scored with its OWN temp/RH/wind. Keeping both ends matters:
     the maximum is the heat story, while the minimum is the wind-chill story a max would erase.
   — lastH: the latest local hour the feed covers for that date. The hourly feed runs ~6½ days,
     so its final date arrives with only its morning hours; a "peak" taken from half a day would
     understate with the same confidence the old pairing overstated. Both extrema are only trusted when
     coverage reaches evening (see the Feels Like cell), and lastH is what says whether it does.
   NWS timestamps include the forecast location's UTC offset. Pulling the wall-clock fields out of
   that timestamp before Date converts it keeps date grouping and source-hour labels tied to the
   forecast location instead of whichever timezone the browser or CI runner happens to use. */
function nwsWallTime(value){
  var m=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/);
  if(!m) return null;
  var month=Number(m[2]), day=Number(m[3]), hour=Number(m[4]);
  if(month<1||month>12||day<1||day>31||hour<0||hour>23) return null;
  return {key:m[1]+"-"+m[2]+"-"+m[3],month:month-1,day:day,hour:hour};
}

function hourlyByDate(hrs){
  var map={};
  (hrs||[]).forEach(function(pp){
    if(!pp.startTime) return;
    var wall=nwsWallTime(pp.startTime);
    if(!wall) return;
    var rec=map[wall.key]||(map[wall.key]={rh:null, rhH:null, diff:99, fl:null, flH:null, flMin:null, flMinH:null, lastH:-1});
    var hr=wall.hour;
    if(hr>rec.lastH) rec.lastH=hr;
    var rh=(pp.relativeHumidity && pp.relativeHumidity.value!=null)?Math.round(pp.relativeHumidity.value):null;
    if(rh!=null){
      var diff=Math.abs(hr-13); // closeness to 1pm local
      if(diff<rec.diff){ rec.rh=rh; rec.rhH=hr; rec.diff=diff; }
    }
    var fl=feelsLikeF(pp.temperature,rh,parseMph(pp.windSpeed));
    if(fl!=null&&(rec.fl==null||fl>rec.fl)){ rec.fl=fl; rec.flH=hr; }
    if(fl!=null&&(rec.flMin==null||fl<rec.flMin)){ rec.flMin=fl; rec.flMinH=hr; }
  });
  return map;
}

function hrWord(d){
  if(typeof d==="number") return ((d%12)||12)+(d<12?"am":"pm");
  return hrWord(weatherParts(d).hour);
}

/* The same clock word, plus the day when it isn't today. The Bottom Line reasons over a 24-hour
   window, so a bare "near 1pm" read at 8pm was describing TOMORROW afternoon in a voice that
   sounds like this afternoon. Twenty-four hours can only reach tomorrow, never further. */
function whenWord(d,base){
  base=base||new Date();
  var w=hrWord(d);
  var days=Math.round((weatherDay(d)-weatherDay(base))/86400000);
  return days===0?w:w+(days===1?" tomorrow":" "+weatherTime(d,{weekday:"long"}));
}

function windowSpan(a,b,base){
  base=base||new Date();
  var span=hrWord(a)+"–"+hrWord(b);
  if(weatherParts(a).key!==weatherParts(b).key) return whenWord(a,base)+"–"+whenWord(b,base);
  var days=Math.round((weatherDay(a)-weatherDay(base))/86400000);
  return days===0?span:span+(days===1?" tomorrow":" "+weatherTime(a,{weekday:"long"}));
}

function bottomLineHorizon(d){
  var wall=typeof d==="string"?nwsWallTime(d):null;
  if(wall){
    var day=calendarDate(wall.key);
    var hour=hrWord(wall.hour).replace(/(am|pm)$/i,function(m){ return " "+m.toUpperCase(); });
    return "Through "+day.toLocaleDateString("en-US", {timeZone:"UTC",weekday:"short"})+" "+hour;
  }
  if(!d||typeof d==="string"||isNaN(d.getTime())) return "Next 24 hours";
  var clock=hrWord(d).replace(/(am|pm)$/i,function(m){ return " "+m.toUpperCase(); });
  return "Through "+d.toLocaleDateString("en-US", {timeZone:WEATHER_TZ,weekday:"short"})+" "+clock;
}

function bottomLineWeekHorizon(days){
  var last=null,lastText="";
  (days||[]).forEach(function(d){
    [d&&d.day,d&&d.night].forEach(function(p){
      if(!p) return;
      var end=new Date(p.endTime||p.startTime);
      if(!isNaN(end.getTime())&&(!last||end>last)){
        last=end; lastText=p.endTime||p.startTime;
      }
    });
  });
  if(!last) return "Next 7 days";
  var wall=nwsWallTime(lastText);
  var date=wall?calendarDate(wall.key):weatherDay(last);
  return "Through "+date.toLocaleDateString("en-US", {timeZone:"UTC",weekday:"short",month:"short",day:"numeric"});
}

function bottomLineBriefingHorizon(days,H,weekEnabled,hasRisk){
  if(weekEnabled&&days&&days.length) return bottomLineWeekHorizon(days);
  if(H&&H.length>=6) return bottomLineHorizon(H[H.length-1].endText||H[H.length-1].end);
  return hasRisk?"Today and tomorrow":"Forecast outlook";
}

function dewF(tF,rh){ // Magnus approximation, good to ~±1° in this range
  if(tF==null||rh==null||rh<=0) return null;
  var tC=(tF-32)/1.8, g=Math.log(rh/100)+17.625*tC/(243.04+tC);
  return Math.round((243.04*g/(17.625-g))*1.8+32);
}

function outlookVerdict(cfg,l0,l1){
  var lv=Math.max(l0||0,l1||0);
  if(lv<1) return null;
  var day=(l0===lv&&l1===lv)?"today and tomorrow":(l0===lv?"today":"tomorrow");
  var tag=(cfg.cat[lv]?cfg.cat[lv]+" ":"")+lv+"/"+cfg.den;
  return {priority:cfg.pri[lv], icon:cfg.ico, topic:cfg.topic, label:cfg.label,
          headline:cfg.txt[lv]+" "+day, detail:tag, action:cfg.action,
          tone:lv>=3?"danger":"warning", context:false};
}

function bottomCandidate(pri,ico,topic,label,headline,detail,action,tone,context,opts){
  opts=opts||{};
  return {priority:pri,icon:ico,topic:topic,label:label,headline:headline,
          detail:detail||"",action:action||"",tone:tone||"neutral",context:!!context,
          supportRank:opts.supportRank,mergeAction:opts.mergeAction||"",
          windowLabel:opts.windowLabel||"",windowEnd:opts.windowEnd||"",
          alertFamilies:opts.alertFamilies||[],horizon:opts.horizon||"hourly"};
}

/* Normalize the NWS hourly shape once. Invalid timestamps are ignored rather than becoming an
   "Invalid Date" timing claim, and missing optional values stay missing so the decisions below
   can fail quiet instead of inventing precision. */
function bottomLineHours(hrs){
  var H=[];
  (hrs||[]).slice(0,24).forEach(function(p){
    p=p||{};
    var d=new Date(p.startTime);
    if(isNaN(d.getTime())) return;
    var end=new Date(p.endTime);
    if(isNaN(end.getTime())||end<=d) end=new Date(d.getTime()+3600000);
    var rh=(p.relativeHumidity&&p.relativeHumidity.value!=null)?Number(p.relativeHumidity.value):null;
    if(rh!=null&&!isFinite(rh)) rh=null;
    var pop=precipChance(p.probabilityOfPrecipitation);
    var mph=parseMph(p.windSpeed), sf=p.shortForecast||"", t=p.temperature;
    H.push({t:t,d:d,end:end,endText:p.endTime||"",hr:weatherParts(d).hour,pop:pop,rh:rh,mph:mph,
            dew:dewF(t,rh),fl:feelsLikeF(t,rh,mph),
            thund:/thunder|t-?storm/i.test(sf),wint:/snow|sleet|wintry|freezing|blizzard/i.test(sf),
            fog:/fog/i.test(sf),day:!!p.isDaytime});
  });
  return H;
}

/* The NWS /observations/latest endpoint can return an hours-old report with HTTP 200. A
   timestamp and a temperature are both required before the hero may call it "Now". */
function currentObservationFresh(o,nowMs){
  var p=o&&o.properties, ts=p&&Date.parse(p.timestamp);
  return !!p&&isFinite(ts)&&ts>0&&ts<=nowMs+10*60000&&nowMs-ts<=STN_STALE_MS
    &&p.temperature&&p.temperature.value!=null&&isFinite(Number(p.temperature.value));
}

function stationMiles(lat1,lon1,lat2,lon2){
  var r=Math.PI/180, dLat=(lat2-lat1)*r, dLon=(lon2-lon1)*r;
  var a=Math.sin(dLat/2)*Math.sin(dLat/2)
    +Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return 3959*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

/* Every hourly-data decision in one pure function. The renderer supplies normalized hours and
   slower-feed facts; tests supply controlled scenarios. `now` is explicit so "today/tomorrow",
   expired UV peaks and the after-5pm behavior do not depend on the test runner's clock. */
function aqiInfo(v){
  if(v==null)return {c:"var(--muted)",t:"—",s:""};
  // Guidance wording follows the EPA's own AQI category advice rather than paraphrasing it — this is
  // health information, and the agency that sets the scale has already chosen the words for it.
  if(v<=50)return {c:"#3ecf8e",t:"Good",s:"Little or no health risk."};
  if(v<=100)return {c:"#ffd23f",t:"Moderate",s:"Unusually sensitive people should limit prolonged exertion."};
  if(v<=150)return {c:"#ff9f2f",t:"Unhealthy (Sensitive)",s:"Sensitive groups should reduce prolonged exertion."};
  if(v<=200)return {c:"#ff6a2f",t:"Unhealthy",s:"Everyone should reduce prolonged outdoor exertion."};
  if(v<=300)return {c:"#c13bff",t:"Very Unhealthy",s:"Avoid prolonged exertion; move activities indoors."};
  return {c:"#ff3b3b",t:"Hazardous",s:"Avoid all outdoor physical activity."};
}
function bottomLineHourlyCandidates(H,opts){
  H=H||[]; opts=opts||{};
  var now=opts.now||new Date(), n=H.length, i, candidates=[];
  var gaps=!!(n&&H[0].d>now)||H.some(function(h,j){return j>0&&h.d-H[j-1].d!==3600000;});
  var comfortOK=opts.allowComfort!==false&&!(opts.aqi>100);
  function push(pri,ico,topic,label,headline,detail,action,tone,context,extra){
    candidates.push(bottomCandidate(pri,ico,topic,label,headline,detail,action,tone,context,extra));
  }
  function when(d){ return whenWord(d,now); }

  // Rain/storm window. One wet block owns its weather type; a later storm cannot relabel it.
  var wet0=-1, wetEnd=-1, hasThunder=false, hasWintry=false, maxPop=0, popMissing=gaps, popKnown=false;
  for(i=0;i<n;i++){
    if(H[i].pop==null) popMissing=true;
    else popKnown=true;
    if(H[i].pop>maxPop) maxPop=H[i].pop;
    if(wet0<0&&H[i].pop>=40) wet0=i;
    if(wet0>=0&&wetEnd<0&&i>wet0&&H[i].pop!=null&&H[i].pop<30) wetEnd=i;
  }
  for(i=(wet0<0?n:wet0);i<(wetEnd>wet0?wetEnd:n);i++){
    if(H[i].pop>=30&&H[i].thund) hasThunder=true;
    if(H[i].pop>=30&&H[i].wint) hasWintry=true;
  }
  if(n){
    if(wet0<0){
      if(popMissing) push(40,"rain","precip","Rain","Rain chance incomplete",
        popKnown?"Some hours have no rain-chance data; known peak chance "+maxPop+"%.":"No hourly rain chances were reported.",
        "Check the updated forecast before weather-sensitive plans.","neutral");
      else if(maxPop>=20) push(40,"rain","precip","Rain","Rain possible",
        "Peak chance "+maxPop+"% through "+when(H[n-1].d)+".",
        "Keep an eye on the forecast for outdoor plans.","neutral");
      else push(40,"sun","precip","Rain","Rain unlikely",
        "Chance stays below 20% through "+when(H[n-1].d)+".",
        "Keep checking the forecast before outdoor plans.","neutral");
    }else{
      var span=(wetEnd>wet0)
        ?(wet0===0&&H[wet0].d<=now?"now":"~"+when(H[wet0].d))+"–"+when(H[wetEnd].d)
        :(wet0===0&&H[wet0].d<=now?"now":"from ~"+when(H[wet0].d));
      var wet2=-1;
      if(wetEnd>0){ for(i=wetEnd;i<n;i++){ if(H[i].pop>=40){ wet2=i; break; } } }
      var more=(wet2>0)?" · another round ~"+when(H[wet2].d):"";
      if(popMissing) more+=" · some rain chances unavailable";
      if(hasThunder&&hasWintry) push(96,"storm","precip","Storm & travel weather",
        "Thunderstorms with wintry precipitation",span+more,
        "Be ready to move inside and watch for slick roads.","danger",false,
        {supportRank:0,alertFamilies:["convective","winter"]});
      else if(hasThunder) push(95,"storm","precip","Storm timing","Thunderstorms likely",span+more,
        "Keep outdoor plans flexible and be ready to move inside.","danger",false,{supportRank:0});
      else if(hasWintry) push(93,"snow","precip","Travel weather","Snow or wintry mix",span+more,
        "Allow extra travel time and watch for slick roads.","danger",false,{supportRank:0});
      else push(60,"rain","precip","Rain timing","Rain likely",span+more,
        "Plan around the wet window.","warning",false,{supportRank:0});
    }
  }

  // Later hazardous rounds keep their own timing instead of inheriting the first rain block.
  var laterSeen={};
  for(i=wetEnd>wet0?wetEnd:n;i<n;i++){
    if(H[i].pop==null||H[i].pop<30||!H[i].thund&&!H[i].wint) continue;
    var laterStorm=H[i].thund, laterTopic=laterStorm?"storm":"winter";
    if(laterSeen[laterTopic]) continue;
    laterSeen[laterTopic]=true;
    push(laterStorm?95:93,laterStorm?"storm":"snow",laterStorm?"storm":"winter",
      laterStorm?"Later storm timing":"Later travel weather",
      laterStorm?"Thunderstorms later":"Wintry precipitation later","From ~"+when(H[i].d)+".",
      laterStorm?"Be ready to move indoors before storms arrive.":"Watch for slick roads and allow extra travel time.","danger",false,{supportRank:0});
  }

  var maxFl=-999, flAt=null;
  for(i=0;i<n;i++){ if(H[i].fl!=null&&H[i].fl>maxFl){ maxFl=H[i].fl; flAt=H[i].d; } }
  if(maxFl>=105) push(100,"heat","heat","Heat","Dangerous heat near "+when(flAt),
    "Heat index around "+maxFl+"°.","Limit outdoor exertion near peak heat.","danger");
  else if(maxFl>=99) push(72,"heat","heat","Heat","High heat near "+when(flAt),
    "Feels like "+maxFl+"°.","Take frequent breaks during outdoor work.","warning");

  var minFl=Infinity,coldAt=null;
  for(i=0;i<n;i++){ if(H[i].fl!=null&&H[i].fl<minFl){minFl=H[i].fl;coldAt=H[i].d;} }
  if(minFl<=-20) push(102,"cold","cold","Cold","Dangerous cold near "+when(coldAt),
    "Feels like "+minFl+"°.","Limit time outside and cover exposed skin.","danger");

  var mMin=999,mAt=null;
  for(i=0;i<n;i++){ if(H[i].hr>=6&&H[i].hr<=9&&H[i].t!=null&&H[i].t<mMin){ mMin=H[i].t; mAt=H[i].d; } }
  var cMin=999,cAt=null;
  for(i=3;i<n;i++){ if(H[i].t!=null&&H[i].t<cMin){ cMin=H[i].t; cAt=H[i].d; } }
  var firstFreeze=null;
  for(i=0;i<n;i++){if(H[i].t!=null&&H[i].t<=32){firstFreeze=H[i];break;}}
  if(firstFreeze&&(!mAt||mMin>32)) push(86,"cold","cold","Cold","Freezing near "+when(firstFreeze.d),
    firstFreeze.t+"°.","Watch for freezing temperatures and slick spots where surfaces are wet.","danger");
  var cold=coldVerdict(H[0]&&H[0].t,mAt?mMin:null,cAt?cMin:null);
  if(cold==="freezing") push(85,"cold","cold","Cold","Freezing early",
    mMin+"° near "+when(mAt)+".","Plan for freezing temperatures early.","danger");
  else if(cold==="falling") push(66,"trend-down","cold","Temperature trend","Sharp temperature drop",
    "Falling "+(H[0].t-cMin)+"° to "+cMin+"° by "+when(cAt)+".","Bring a layer if you'll be out late.","warning");
  else if(cold==="cold") push(70,"cold","cold","Cold","Cold morning",
    mMin+"° near "+when(mAt)+".","Dress for the cold.","warning");

  for(i=0;i<n;i++){ if(H[i].fog){
    var morningFog=H[i].hr>=4&&H[i].hr<=9;
    push(68,"fog","fog","Visibility",morningFog?"Fog early":"Fog near "+when(H[i].d),
      morningFog?"Reduced visibility during the morning drive.":"Reduced visibility is possible.",
      "Slow down and leave extra following distance.","warning"); break;
  } }

  var wMax=0,wAt=null;
  for(i=0;i<n;i++){ if(H[i].mph!=null&&H[i].mph>wMax){ wMax=H[i].mph; wAt=H[i].d; } }
  if(wMax>=35) push(78,"wind","wind","Wind","Very windy near "+when(wAt),
    "Sustained wind around "+wMax+" mph.","Secure loose outdoor objects.","danger");
  else if(wMax>=25) push(65,"wind","wind","Wind","Windy near "+when(wAt),
    "Sustained wind around "+wMax+" mph.","Use extra care with outdoor plans.","warning");

  var peak=opts.uvPeak;
  if(peak&&peak.t>now.getTime()){
    var uvR=Math.round(peak.v),uvAt=when(new Date(peak.t));
    if(uvR>=11) push(76,"uv","uv","Sun exposure","Extreme UV near "+uvAt,
      "UV "+uvR+"; unprotected skin may burn in about "+Math.max(5,Math.round(200/uvR))+" minutes.",
      "Use shade, protective clothing, and sunscreen.","danger");
    else if(uvR>=8) push(62,"uv","uv","Sun exposure","Very high UV near "+uvAt,
      "UV index around "+uvR+".","Use sun protection for outdoor plans.","warning");
  }
  if(opts.aqi!=null&&opts.aqi>100){
    var air=aqiInfo(opts.aqi);
    push(opts.aqi>300?110:opts.aqi>200?101:opts.aqi>150?90:75,"air","air","Air quality",
      air.t+" air quality","AQI "+opts.aqi+".",air.s,opts.aqi>150?"danger":"warning");
  }

  var n0=-1;
  for(i=0;i<n;i++){ if(H[i].hr>=21||H[i].hr<=6){ n0=i; break; } }
  var night=[];
  for(i=n0;i>=0&&i<n&&(H[i].hr>=21||H[i].hr<=6);i++){
    if(night.length&&H[i].d.getTime()-night[night.length-1].d.getTime()!==3600000) break;
    night.push(H[i]);
  }
  if(night.length>=4){
    var ok=true,muggy=false,lo=999;
    night.forEach(function(h){
      if(h.t<lo) lo=h.t;
      if(h.t<50||h.t>72||h.pop==null||h.pop>=25||(h.mph==null||h.mph>14)||h.dew==null||h.dew>64||h.thund||h.wint||h.fog) ok=false;
      if(h.dew!=null&&h.dew>=67&&h.t>=70) muggy=true;
    });
    if(ok&&!muggy&&comfortOK&&!gaps) push(50,"moon","overnight","Tonight","Comfortable overnight",
      "Low near "+lo+"° with dry air.","Good window-opening weather.","good");
    else if(muggy) push(30,"moon","overnight","Tonight","Warm and humid overnight",
      "Low near "+lo+"°.","Open windows may offer little relief.","neutral");
  }

  var localNow=weatherParts(now), today=localNow.key;
  var dayH=H.filter(function(h){ return h.day&&weatherParts(h.d).key===today; });
  if(comfortOK&&!gaps&&dayH.length>=4&&localNow.hour<17){
    var dhi=-999,nice=true;
    dayH.forEach(function(h){
      if(h.t!=null&&h.t>dhi) dhi=h.t;
      if(h.t==null||h.pop==null||h.pop>=20||h.t<58||h.t>88||(h.fl!=null&&h.fl>=95)||(h.mph==null||h.mph>15)||(h.dew==null||h.dew>66)||h.thund||h.wint||h.fog) nice=false;
    });
    if(nice) push(55,"check","outdoors","Outdoor plans","Excellent outdoor conditions",
      dhi+"° and dry through "+when(dayH[dayH.length-1].end||new Date(+dayH[dayH.length-1].d+3600000))+".",
      "Good day to keep outdoor plans.","good");
  }

  if(comfortOK&&(maxFl>=99||wet0>=0||wMax>=25)){
    var windowHours=[];
    for(i=0;i<n;i++){
      var hb=H[i];
      if(!hb.day||hb.hr<7||hb.hr>20||hb.pop==null||hb.pop>=40||hb.thund||hb.wint||hb.fog||hb.mph==null||hb.mph>=25) continue;
      var fl2=(hb.fl!=null)?hb.fl:hb.t;
      if(fl2==null) continue;
      var sc=Math.abs(fl2-70)*1.3;
      sc+=hb.pop>=50?60:(hb.pop>=30?30:(hb.pop>=20?12:0));
      if(hb.thund&&hb.pop>=30) sc+=70;
      if(hb.mph!=null) sc+=hb.mph>=20?14:(hb.mph>=15?6:0);
      windowHours.push({idx:i,h:hb,sc:sc});
    }
    var bw=null;
    for(i=0;i+1<windowHours.length;i++){
      if(windowHours[i+1].idx!==windowHours[i].idx+1) continue;
      if(windowHours[i+1].h.d.getTime()-windowHours[i].h.d.getTime()!==3600000) continue;
      var s2=(windowHours[i].sc+windowHours[i+1].sc)/2;
      if(!bw||s2<bw.sc) bw={sc:s2,a:windowHours[i].h,b:windowHours[i+1].h};
    }
    if(bw&&bw.sc<=30){
      var bFl=Math.round(((bw.a.fl!=null?bw.a.fl:bw.a.t)+(bw.b.fl!=null?bw.b.fl:bw.b.t))/2);
      var bWet=Math.max(bw.a.pop,bw.b.pop)>=20?"":", dry";
      var end=new Date(bw.b.d.getTime()+3600000),bSpan=windowSpan(bw.a.d,end,now);
      push(58,"walk","outdoors","Outdoor window","Best window: "+bSpan,
        "Feels like "+bFl+"°"+bWet+".","Use this window for strenuous or weather-sensitive plans.","good",false,
        {mergeAction:"Use "+bSpan+" for strenuous or weather-sensitive plans.",
         windowLabel:bSpan,windowEnd:when(end)});
    }
  }
  return candidates;
}

/* The NWS seven-day day/night periods extend the briefing beyond the hourly edge. When one spans
   that edge, only its uncovered tail is evaluated, using the additional hourly records already
   supplied by NWS. A gap in those records leaves the crossing period out: whole-period daily
   values cannot honestly be attributed to its tail. Later periods keep day-level wording. */
function bottomLineWeekCandidates(days,cutoff,hourly){
  var cut=cutoff instanceof Date?cutoff.getTime():Number(cutoff);
  if(!isFinite(cut)) cut=Date.now();
  var P=[];
  (days||[]).forEach(function(d){
    [d&&d.day,d&&d.night].forEach(function(p){
      if(!p) return;
      var start=new Date(p.startTime).getTime(), end=new Date(p.endTime).getTime();
      if(!isFinite(start)||!isFinite(end)||end<=start||end<=cut) return;
      var partial=start<cut, tail=[];
      if(partial){
        tail=bottomLineHours((hourly||[]).filter(function(h){
          var t=new Date(h&&h.startTime).getTime();
          return isFinite(t)&&t>=cut&&t<end;
        }));
        var needed=Math.ceil((end-cut)/3600000);
        if(!needed||needed>24||tail.length!==needed||tail[0].d.getTime()!==cut||
           tail[tail.length-1].end.getTime()<end) return;
        for(var k=1;k<tail.length;k++){
          if(tail[k].d.getTime()!==tail[k-1].end.getTime()) return;
        }
      }
      var pop=partial?(tail.every(function(h){return h.pop!=null;})?
        Math.max.apply(null,tail.map(function(h){return h.pop;})):null):
        precipChance(p.probabilityOfPrecipitation);
      var temp=partial?(tail.every(function(h){return h.t!=null&&isFinite(h.t);})?
        Math[!!p.isDaytime?"max":"min"].apply(null,tail.map(function(h){return h.t;})):null):
        (p.temperature==null?null:Number(p.temperature));
      if(temp!=null&&!isFinite(temp)) temp=null;
      var name=String(p.name||d.name||"later this week").replace(/ Night$/, " night");
      P.push({start:start,name:name,day:!!p.isDaytime,pop:pop,temp:temp,
              mph:partial?(tail.every(function(h){return h.mph!=null;})?
                Math.max.apply(null,tail.map(function(h){return h.mph;})):null):parseMph(p.windSpeed),
              forecast:partial?tail.map(function(h){return (h.thund?" thunderstorms":"")+
                (h.wint?" snow":"")+(h.fog?" fog":"");}).join(" "):String(p.shortForecast||""),partial:partial});
    });
  });
  if(!P.length) return [];
  function strongest(list,value){
    return list.sort(function(a,b){ return value(b)-value(a)||a.start-b.start; })[0]||null;
  }
  var out=[], opts={horizon:"week"};
  var wet=P.filter(function(p){return p.pop>=40;});
  var wintry=strongest(wet.filter(function(p){return /freezing|sleet|ice|wintry|snow|flurr|blizzard/i.test(p.forecast);}),
    function(p){return p.pop;});
  var stormy=strongest(wet.filter(function(p){return /thunder|storm|tornado/i.test(p.forecast)&&
    !/freezing|sleet|ice|wintry|snow|flurr|blizzard/i.test(p.forecast);}),
    function(p){return p.pop;});
  var rainy=!wintry&&!stormy?strongest(wet,function(p){return p.pop;}):null;
  if(wintry) out.push(bottomCandidate(58,"snow","winter","Week ahead · Travel weather",
    "Wintry weather possible "+wintry.name,
    (wintry.partial?"Peak remaining hourly chance ":"NWS precipitation chance ")+wintry.pop+"%.",
    "Allow flexibility for travel and check updates closer to the day.","warning",false,opts));
  if(stormy) out.push(bottomCandidate(57,"storm","storm","Week ahead · Storms",
    "Storms possible "+stormy.name,
    (stormy.partial?"Peak remaining hourly chance ":"NWS precipitation chance ")+stormy.pop+"%.",
    "Keep plans flexible and check updates closer to the day.","warning",false,opts));
  if(rainy) out.push(bottomCandidate(51,"rain","precip","Week ahead · Rain",
    "Rain possible "+rainy.name,
    (rainy.partial?"Peak remaining hourly chance ":"NWS precipitation chance ")+rainy.pop+"%.",
    "Keep plans flexible and check updates closer to the day.","warning",false,opts));
  var hot=strongest(P.filter(function(p){return p.day&&p.temp!=null&&p.temp>=95;}),function(p){return p.temp;});
  if(hot) out.push(bottomCandidate(hot.temp>=100?57:53,"heat","heat","Week ahead · Heat",
    "Hot weather "+hot.name,"Forecast high near "+Math.round(hot.temp)+"°.",
    "Plan strenuous outdoor work for cooler hours.","warning",false,opts));
  var cold=strongest(P.filter(function(p){return !p.day&&p.temp!=null&&p.temp<=32;}),function(p){return -p.temp;});
  if(cold) out.push(bottomCandidate(55,"cold","cold","Week ahead · Cold",
    "Freezing "+cold.name,"Forecast low near "+Math.round(cold.temp)+"°.",
    "Plan for freezing temperatures.","warning",false,opts));
  var wind=strongest(P.filter(function(p){return p.mph!=null&&p.mph>=25;}),function(p){return p.mph;});
  if(wind) out.push(bottomCandidate(49,"wind","wind","Week ahead · Wind",
    "Windy "+wind.name,"Forecast sustained wind around "+wind.mph+" mph.",
    "Secure loose outdoor objects before it arrives.","warning",false,opts));
  var highs=P.filter(function(p){return p.day&&p.temp!=null;}).sort(function(a,b){return a.start-b.start;});
  var change=null;
  for(var i=1;i<highs.length;i++){
    var delta=Math.round(highs[i].temp-highs[i-1].temp);
    if(Math.abs(delta)>=15&&(!change||Math.abs(delta)>Math.abs(change.delta)))
      change={from:highs[i-1],to:highs[i],delta:delta};
  }
  if(change&&!hot&&!cold) out.push(bottomCandidate(46,"stats","trend","Week ahead · Temperature",
    (change.delta<0?"Cooler":"Warmer")+" by "+change.to.name,
    "Forecast high "+Math.round(change.from.temp)+"° to "+Math.round(change.to.temp)+"°.",
    "Plan for the temperature change.","neutral",false,opts));
  if(!out.length){
    var known=P.filter(function(p){return p.pop!=null;});
    if(known.length===P.length){
      var peak=strongest(known,function(p){return p.pop;});
      out.push(bottomCandidate(peak.pop>=20?38:35,peak.pop>=20?"rain":"sun","week","Week ahead",
        peak.pop>=20?"Some rain possible later this week":"Mainly dry later this week",
        peak.pop>=20?"Highest NWS rain chance "+peak.pop+"% "+peak.name+".":
          "NWS rain chances stay below 20% in the later forecast periods.",
        peak.pop>=20?"Check the forecast before outdoor plans.":"","neutral",false,opts));
    }
  }
  return out;
}

function bottomLineLocalAlert(groups,nowMs){
  if(nowMs==null) nowMs=Date.now();
  var local=null,bestKey=null,ranks={emergency:0,warning:1,watch:2,advisory:3,statement:4};
  (groups||[]).forEach(function(g){
    if(!g||g.scope==="away") return;
    // A folded card's union end must not keep its expired higher tier active.
    var phases=g.phases&&g.phases.length?g.phases:[g];
    phases.forEach(function(p){
      if(p.latest>0&&p.latest<=nowMs) return;
      var level=p.lv&&p.lv.k||"statement",rank=ranks[level]==null?5:ranks[level];
      var severity=p.best&&p.best.properties?p.best.properties.severity:p.sev||g.sev;
      var sev=ALERT_SEV_RANK[severity],key=[rank,sev==null?5:sev,String(p.ev||"Alert")].join("|");
      if(bestKey!=null&&key>=bestKey) return;
      bestKey=key;
      local={event:p.ev||"Alert",family:eventFamily(p.ev),level:level,ends:p.latest||0};
    });
  });
  return local;
}

/* The Bottom Line is selected independently of the DOM so its hierarchy can be tested. Candidate
   order is deliberately irrelevant: feeds resolve in a different order on every load, and a
   slower climate or outlook response must not reshuffle equal-priority facts arbitrarily. */
function bottomLineCmp(a,b){
  if(a.priority!==b.priority) return b.priority-a.priority;
  var at=a.topic||"", bt=b.topic||"";
  if(at!==bt) return at<bt?-1:1;
  var ah=a.headline||"", bh=b.headline||"";
  return ah<bh?-1:(ah>bh?1:0);
}

function bottomLineAlertMatch(alert,candidate){
  if(!alert||!candidate) return false;
  if(candidate.horizon==="week") return false;
  var ev=(alert.event||"").toLowerCase();
  /* These products fall into a presentation family by default, but semantically they are
     exclusive: a Dense Smoke Advisory must not rewrite a fire-weather outlook, and a Dense Fog
     Advisory must not rewrite a severe-storm candidate merely because both use fallback chrome. */
  if(/air quality|smoke/.test(ev)) return candidate.topic==="air";
  if(/fog/.test(ev)) return candidate.topic==="fog";
  var fam=alert.family;
  if(candidate.alertFamilies&&candidate.alertFamilies.indexOf(fam)>=0) return true;
  if(fam==="convective") return candidate.topic==="storm"||(candidate.topic==="precip"&&candidate.icon==="storm");
  if(fam==="winter") return candidate.topic==="winter"||candidate.topic==="cold"||(candidate.topic==="precip"&&candidate.icon==="snow");
  return fam===candidate.topic;
}

/* Short-fuse convective warnings need an action for NOW. A forecast's best later outdoor window
   cannot qualify that action: in the failure that prompted this guard, a Severe Thunderstorm
   Warning over the selected location was rewritten as "finish outdoor tasks by 9am tomorrow"
   merely because 7–9am was the coolest dry pair of hours after the overnight storms. */
function bottomLineUrgentStormAlert(alert,candidate){
  if(!alert||!candidate||alert.family!=="convective"||
     (alert.level!=="warning"&&alert.level!=="emergency")) return false;
  return candidate.topic==="storm"||(candidate.topic==="precip"&&candidate.icon==="storm");
}

function bottomLineAlertHeadline(candidate,outdoor,alert){
  if(bottomLineUrgentStormAlert(alert,candidate))
    return /tornado/i.test(alert.event||"")?"Take tornado shelter now":"Take shelter indoors now";
  if(outdoor&&outdoor.windowEnd){
    if(candidate.topic==="heat") return "Finish strenuous outdoor work by "+outdoor.windowEnd;
    if(candidate.topic==="wind") return "Handle outdoor setup by "+outdoor.windowEnd;
  }
  if(candidate.topic==="precip"&&candidate.alertFamilies&&
     candidate.alertFamilies.indexOf("convective")>=0&&candidate.alertFamilies.indexOf("winter")>=0)
    return "Prepare for storms and slick travel";
  if(candidate.topic==="precip"&&candidate.icon==="snow") return "Allow extra time for winter travel";
  var plans={heat:"Avoid strenuous outdoor work near peak heat",
             storm:"Be ready to move plans indoors",
             precip:"Be ready to move plans indoors",
             flood:"Avoid flood-prone travel during heavy rain",
             winter:"Allow extra time for winter travel",
             cold:"Plan around freezing or dangerous cold",
             wind:"Secure loose outdoor objects",
             fire:"Avoid outdoor burning",
             air:"Limit prolonged outdoor exertion",
             fog:"Slow down for reduced visibility"};
  return plans[candidate.topic]||candidate.headline;
}

function bottomLineWindowAction(candidate,outdoor){
  if(!outdoor) return "";
  if(outdoor.windowEnd){
    if(candidate.topic==="heat") return "If outdoor work is necessary, finish by "+outdoor.windowEnd+".";
    if(candidate.topic==="wind") return "Handle weather-sensitive outdoor tasks by "+outdoor.windowEnd+".";
  }
  return outdoor.mergeAction||"";
}

function buildBottomLine(candidates,localAlert){
  var shelterWarning=localAlert&&(localAlert.level==="warning"||localAlert.level==="emergency")
    &&/tornado|thunderstorm|flash flood|winter|ice storm|blizzard|dust/i.test(localAlert.event||"");
  var exposureAlert=localAlert&&/smoke|fog|air quality|dust/i.test(localAlert.event||"");
  var unsupportedWindHeat=localAlert&&/wind|heat/i.test(localAlert.event||"")
    &&!(candidates||[]).some(function(c){return bottomLineAlertMatch(localAlert,c);});
  var sorted=(candidates||[]).filter(function(c){
    if(!c||(shelterWarning||exposureAlert||unsupportedWindHeat)&&c.tone==="good"&&(c.topic==="overnight"||c.topic==="outdoors")) return false;
    return typeof c.priority==="number"&&c.topic&&c.headline;
  }).slice().sort(bottomLineCmp);
  var seen={}, unique=[];
  sorted.forEach(function(c){
    if(seen[c.topic]) return;
    seen[c.topic]=true; unique.push(c);
  });
  var actionable=unique.filter(function(c){ return !c.context; });
  var sourceLead=actionable.length?actionable[0]:null;
  /* A local warning or emergency is more consequential than the generic priority table. When
     hourly/outlook evidence contains the same hazard, translate THAT candidate as the lead even
     if an unrelated condition has a numerically higher score. Watches and advisories stay in the
     normal ranking; the alert banner above already gives them authoritative placement. */
  if(localAlert&&(localAlert.level==="emergency"||localAlert.level==="warning")){
    var alertLead=actionable.filter(function(c){ return bottomLineAlertMatch(localAlert,c); })[0];
    if(alertLead) sourceLead=alertLead;
    else if(localAlert.level==="emergency") return {lead:null,supports:[]};
  }
  var lead=sourceLead?Object.assign({},sourceLead):null;
  if(!lead) return {lead:null,supports:[]};
  var outdoor=unique.filter(function(c){ return c.topic==="outdoors"&&c.mergeAction; })[0]||null;
  /* A scored comfort window can be a useful cutoff for heat or wind. It is not storm timing:
     rain may already be in progress or may end hours before that window, so its endpoint must not
     become "finish by" guidance for a storm/rain lead. */
  var mergeOutdoor=!!(outdoor&&{heat:1,wind:1}[lead.topic]);
  var alertAware=bottomLineAlertMatch(localAlert,lead);
  var urgentStorm=bottomLineUrgentStormAlert(localAlert,lead);
  if(alertAware){
    lead.headline=bottomLineAlertHeadline(lead,mergeOutdoor?outdoor:null,localAlert);
    lead.detail="Alert active locally"+(lead.detail?" · "+lead.detail:"");
    lead.alertAware=true;
    if(urgentStorm){
      lead.action=/tornado/i.test(localAlert.event||"")
        ?"Go to a basement or small interior room away from windows."
        :"Stay indoors and away from windows until the warning passes.";
    }
  }else if(mergeOutdoor){
    lead.action=bottomLineWindowAction(lead,outdoor)+(lead.action?" "+lead.action:"");
  }
  /* During any matching storm alert, the alert and forecast timing own the scarce briefing slots.
     Do not reintroduce the unrelated comfort window as a supporting cue after declining to turn it
     into a deadline. Outside an alert it remains useful, explicitly labelled supporting evidence. */
  var suppressOutdoor=!!(outdoor&&alertAware&&(lead.topic==="storm"||lead.topic==="precip"));
  var rest=unique.filter(function(c){
    return c.topic!==lead.topic&&!c.context&&((!mergeOutdoor&&!suppressOutdoor)||c.topic!=="outdoors");
  });
  rest.sort(function(a,b){
    var ar=typeof a.supportRank==="number"?a.supportRank:1;
    var br=typeof b.supportRank==="number"?b.supportRank:1;
    return ar!==br?ar-br:bottomLineCmp(a,b);
  });
  var supports=rest.slice(0,3);
  /* Context is garnish for a genuinely quiet briefing, never a fourth fact competing with a
     warning. A neutral dry lead or a good outdoor lead can use it; hazard leads cannot. */
  if(supports.length<3&&(lead.tone==="neutral"||lead.tone==="good")){
    unique.filter(function(c){ return c.context; }).sort(bottomLineCmp).some(function(c){
      supports.push(c); return supports.length>=3;
    });
  }
  return {lead:lead,supports:supports};
}

function extractAFD(text){
  var wants=[["KEY MESSAGES","Key Messages","key"],["SYNOPSIS","Synopsis","para"],["SHORT TERM","Short-Term Outlook","para"]];
  for(var i=0;i<wants.length;i++){
    var pat=wants[i][0].replace(" ","\\s+");
    // LSX commonly qualifies this heading as `.SHORT TERM /THROUGH THURSDAY/...`.
    if(wants[i][0]==="SHORT TERM") pat+="(?:\\s*\\/[^\\n]*\\/)?";
    var re=new RegExp("\\."+pat+"\\.\\.\\.([\\s\\S]*?)(?=\\n\\.[A-Z]|\\n&&|\\$\\$)","i");
    var m=text.match(re);
    if(m){
      var body=m[1];
      body=body.replace(/^\s*\([^)]*\)\s*/,"");          // drop "(Through Tonight)" style tag
      body=body.replace(/Issued at[^\n]*\d{4}\s*/i,"");   // drop "Issued at ... 2026" stamp
      body=body.trim();
      if(body.length>15) return {kind:wants[i][2], label:wants[i][1], text:body};
    }
  }
  return null;
}

/* AFD Key Messages are official text, never a synopsis or a generated substitute. Keep the
   product clock separate: aviation-only issuances often carry the same messages forward. */
var NWS_MESSAGES_MAX_AGE=18*3600000;
function nwsTextTime(line){
  var m=/^(?:Issued at\s+)?(\d{1,4})\s+(AM|PM)\s+(CST|CDT|EST|EDT|MST|MDT|PST|PDT|AKST|AKDT|HST|UTC|GMT)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/i.exec(line.trim());
  if(!m) return 0;
  var clock=+m[1], h=clock<13?clock:Math.floor(clock/100), min=clock<13?0:clock%100;
  var month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[4].toLowerCase());
  if(h<1||h>12||min>59||month<0) return 0;
  var day=+m[5], year=+m[6], date=new Date(Date.UTC(year,month,day));
  if(date.getUTCMonth()!==month||date.getUTCDate()!==day) return 0;
  var offset={CST:6,CDT:5,EST:5,EDT:4,MST:7,MDT:6,PST:8,PDT:7,AKST:9,AKDT:8,HST:10,UTC:0,GMT:0}[m[3].toUpperCase()];
  return Date.UTC(year,month,day,h%12+(m[2].toUpperCase()==='PM'?12:0)+offset,min);
}
function afdKeyMessages(prod,office,now){
  var bad=function(status){return {status:status,messages:[]};};
  if(!prod||typeof prod.productText!=='string'||prod.productText.length>150000||! /^[A-Z]{3}$/.test(office||'')) return bad('malformed');
  var text=prod.productText.replace(/\r/g,''), issued=Date.parse(prod.issuanceTime||'');
  var header=new RegExp('^AFD'+office+'[ \\t]*$','m');
  if(prod.productCode!=='AFD'||prod.issuingOffice!=='K'+office||!header.test(text)||!isFinite(issued)||issued<=0||issued>now+10*60000) return bad('malformed');
  var name=/^National Weather Service[ \t]+([^\n]+)$/im.exec(text);
  if(!name) return bad('malformed');
  if(now-issued>NWS_MESSAGES_MAX_AGE) return bad('stale');
  var headings=Array.from(text.matchAll(/^[ \t]*\.KEY[ \t]+MESSAGES(?:\.{3}|…)[ \t]*$/gim));
  if(!headings.length) return bad('missing');
  if(headings.length!==1) return bad('malformed');
  var rest=text.slice(headings[0].index+headings[0][0].length);
  var end=/^[ \t]*(?:&&|\$\$|\.[A-Z][^\n]*(?:\.{3}|…))[^\n]*$/m.exec(rest);
  if(!end) return bad('malformed'); // A truncated section must not silently lose a qualifier.
  var lines=rest.slice(0,end.index).trim().split('\n'), sectionIssued=0;
  if(/^(?:Issued at\b|\d.*\b(?:AM|PM)\b)/i.test(lines[0]||'')){
    sectionIssued=nwsTextTime(lines.shift());
    if(!sectionIssued||sectionIssued>issued+10*60000) return bad('malformed');
    if(now-sectionIssued>NWS_MESSAGES_MAX_AGE) return bad('stale');
  }
  var messages=[], item='';
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim(); if(!line) continue;
    if(/^(?:[-*•]|\d{1,2}[.)])\s*$/.test(line)) return bad('malformed');
    // A wrapped decimal or negative temperature is prose, not another bullet. NWS also uses
    // "-Dry" without a space, while numbered lists require a space after their marker.
    var bullet=/^(?:[-*•][ \t]+|[-*•](?=[A-Za-z"“(])|\d{1,2}[.)][ \t]+)(\S.*)$/.exec(line);
    if(bullet){if(item) messages.push(item);item=bullet[1];}
    else if(item) item+=' '+line;
    else return bad('malformed');
  }
  if(item) messages.push(item);
  messages=messages.map(function(s){return s.replace(/\s+/g,' ').trim();});
  if(!messages.length) return bad('missing');
  if(messages.length>10||messages.some(function(s){return s.length<8||s.length>2500||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s);})) return bad('malformed');
  return {status:'ready',messages:messages,issuedAt:issued,sectionIssuedAt:sectionIssued,office:office,officeName:name[1].trim()};
}
function nwsLocalPeriod(data,check,now,maxCheckAge){
  if(feedState(check,now,maxCheckAge)!=='ready'||check.saved) return null;
  var issued=Date.parse(data&&data.properties&&(data.properties.updateTime||data.properties.updated||data.properties.generatedAt)||'');
  if(!isFinite(issued)||issued<=0||issued>now+10*60000||now-issued>12*3600000) return null;
  var periods=data&&data.properties&&data.properties.periods;
  if(!Array.isArray(periods)) return null;
  var period=periods.find(function(p){return p&&Date.parse(p.startTime)<=now&&Date.parse(p.endTime)>now
    &&typeof (p.detailedForecast||p.shortForecast)==='string'&&(p.detailedForecast||p.shortForecast).trim();});
  return period?{period:period,issuedAt:issued}:null;
}

/* ============ SPC MESOSCALE DISCUSSIONS ============ */
/* The gap the outlook matrix can't see: a Mesoscale Discussion is SPC's short-fused note that
   severe weather — usually a watch — is expected in the next 1–3 hours, issued hours after the
   day's categorical outlook and expired again by evening. Two feeds, both on origins the page
   already talks to. The polygon service says which MDs are ACTIVE right now (and where); the
   SWOMCD text product carries everything the strip actually says — the concerning line, the
   watch probability, the summary, and the ATTN list of offices, which is the same relevance
   test the alert list applies with isLSX(). */
function parseMcd(text){
  var t=String(text||"").replace(/\r/g,"");
  var num=/Mesoscale Discussion (\d+)/i.exec(t);
  if(!num) return null;   // not recognisably an MD → drop it, never paint half a strip
  function para(re){ var m=re.exec(t); return m?m[1].replace(/\s*\n\s*/g," ").trim():""; }
  var valid=/Valid\s+\d{6}Z?\s*-\s*(\d{6})Z/.exec(t);
  var prob=/Probability of Watch Issuance\s*\.\.\.\s*(\d+)\s*percent/i.exec(t);
  // Blank-line terminated so the LAT...LON block can't leak in; length===3 keeps only WFO ids.
  var am=/ATTN\.\.\.WFO\.\.\.([\s\S]*?)(?:\n\s*\n|\s*$)/.exec(t);
  return {
    num:+num[1],
    areas:para(/Areas affected\s*\.\.\.([\s\S]*?)\n\s*\n/),
    concerning:para(/Concerning\s*\.\.\.([^\n]*)/),
    validEnd:valid?valid[1]:null,
    prob:prob?+prob[1]:null,   // watch-issued MDs have no probability line: null, never 0
    summary:para(/SUMMARY\s*\.\.\.([\s\S]*?)\n\s*\n/),
    attn:am?am[1].split(/[^A-Z]+/).filter(function(s){ return s.length===3; }):[]
  };
}

/* "Valid 311913Z - 312115Z" carries no month or year. Anchor the end stamp to the product's
   issuance time and pick the month that lands it nearest — an MD lives at most six hours, so a
   stamp that computes ~15+ days away is the day field wrapping a month boundary, not a two-week
   discussion. Pure and testable, because month/year rollover is exactly the edge a July 31st or
   December 31st product would exercise silently. */
function mcdValidEnd(v,refMs){
  var m=/^(\d\d)(\d\d)(\d\d)$/.exec(String(v||""));
  if(!m||!refMs) return null;
  var ref=new Date(refMs);
  var d=Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth(),+m[1],+m[2],+m[3]);
  if(d-refMs>15*86400000)      d=Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth()-1,+m[1],+m[2],+m[3]);
  else if(refMs-d>15*86400000) d=Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth()+1,+m[1],+m[2],+m[3]);
  return d;
}

/* Bounding-box overlap, deliberately generous: a geometry whose bbox clips the envelope counts
   even if its actual shape misses, because this test only ever DROPS things — a false keep costs
   one wasted text fetch, a false drop is a severe-weather product silently gone. */
function geomTouchesEnv(geom,env){
  var bb=[Infinity,Infinity,-Infinity,-Infinity];
  (function walk(c){
    if(typeof c[0]==="number"){
      if(c[0]<bb[0])bb[0]=c[0]; if(c[0]>bb[2])bb[2]=c[0];
      if(c[1]<bb[1])bb[1]=c[1]; if(c[1]>bb[3])bb[3]=c[1];
    } else c.forEach(walk);
  })(geom&&geom.coordinates||[]);
  return bb[0]<=env.xmax&&bb[2]>=env.xmin&&bb[1]<=env.ymax&&bb[3]>=env.ymin;
}

/* Dissolve a watch's county polygons into their outer perimeter. No geometry math: every edge two
   counties share appears in the set exactly twice (once per county), so the perimeter is precisely
   the edges that appear ONCE, stitched end-to-end into rings. Vertex equality can stand in for
   intersection because the WWA service returns topologically shared borders and the query rounds
   them to geometryPrecision=3 — neighbouring counties hand back bit-identical coordinates. Where
   that assumption ever slips (a T-junction the rounding didn't heal), the walk just ends early and
   ships an open polyline: a short gap in the outline, never a wrong shape. Returns rings as
   [lat,lng] pairs, Leaflet-ready. */
function watchBoundary(feats){
  var cnt={}, seg={};
  function k(p){ return p[0]+","+p[1]; }
  function ring(r){
    for(var i=0;i<r.length-1;i++){
      var a=k(r[i]), b=k(r[i+1]);
      if(a===b) continue;
      var e=a<b?a+"|"+b:b+"|"+a;
      cnt[e]=(cnt[e]||0)+1;
      seg[e]=[r[i],r[i+1]];
    }
  }
  feats.forEach(function(f){
    var g=(f&&f.geometry)||{};
    var polys=g.type==="Polygon"?[g.coordinates]:(g.type==="MultiPolygon"?g.coordinates:[]);
    polys.forEach(function(p){ (p||[]).forEach(ring); });
  });
  var edges=[], adj={};
  Object.keys(cnt).forEach(function(e){
    if(cnt[e]!==1) return;   // shared border — interior, not perimeter
    var s=seg[e], ed={a:k(s[0]),b:k(s[1]),pa:s[0],pb:s[1],used:false};
    edges.push(ed);
    (adj[ed.a]=adj[ed.a]||[]).push(ed);
    (adj[ed.b]=adj[ed.b]||[]).push(ed);
  });
  var rings=[];
  edges.forEach(function(start){
    if(start.used) return;
    start.used=true;
    var pts=[start.pa,start.pb], cur=start.b, guard=edges.length+1;
    while(cur!==start.a && guard-->0){
      var nxt=(adj[cur]||[]).filter(function(ed){ return !ed.used; })[0];
      if(!nxt) break;
      nxt.used=true;
      pts.push(nxt.a===cur?nxt.pb:nxt.pa);
      cur=nxt.a===cur?nxt.b:nxt.a;
    }
    if(pts.length>2) rings.push(pts.map(function(p){ return [p[1],p[0]]; }));  // GeoJSON x,y → Leaflet lat,lng
  });
  return rings;
}

/* Chaikin corner-cutting: each pass replaces every vertex with two points a quarter and three
   quarters of the way along its edges. Two passes turn the dissolve's county stair-steps into
   gentle curves — the perimeter stops tracing bureaucracy and starts reading as weather. The
   smoothed line no longer matches the county fill EDGE for edge, and that is fine on purpose:
   at a .22 fill the mismatch is invisible, and the alternative (smoothing the fill too) would
   redraw the actual counties under alert, which the fill is the honest record of. Closed rings
   (first point repeated last) come back closed; a chain the boundary walk left open keeps its
   endpoints so a gap stays a gap instead of growing a false bridge. */
function chaikinRing(ring,iters){
  if(!ring||ring.length<3) return ring||[];
  var closed=ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1];
  var pts=closed?ring.slice(0,-1):ring.slice();
  for(var n=0;n<iters;n++){
    var out=[], len=pts.length, edges=closed?len:len-1;
    if(!closed) out.push(pts[0]);
    for(var i=0;i<edges;i++){
      var a=pts[i], b=pts[(i+1)%len];
      out.push([a[0]*.75+b[0]*.25, a[1]*.75+b[1]*.25]);
      out.push([a[0]*.25+b[0]*.75, a[1]*.25+b[1]*.75]);
    }
    if(!closed) out.push(pts[len-1]);
    pts=out;
  }
  return closed?pts.concat([pts[0]]):pts;
}

/* NWPS timestamps describe measurements, not the time the HTTP request succeeded. */
function riverObservationState(ob,now,maxAge){
  var t=Date.parse(ob&&ob.validTime||"");
  if(!isFinite(t)||t<=0||t>now+10*60000) return {state:"unknown",time:0};
  return {state:now-t>maxAge?"stale":"ready",time:t};
}

function feedState(check,now,maxAge){
  if(!check) return "loading";
  if(check.saved) return "saved";
  if(check.status==="ready"||check.status==="partial"){
    if(!check.successAt||now<check.successAt||now-check.successAt>maxAge) return "stale";
  }
  return check.status;
}

function climPeriods(date){
  var p=weatherParts(date), n=calendarDate(p.key), y=p.year;
  var jul1=calendarDate((p.month<6?y-1:y)+"-07-01");
  return {mtd:p.day,
          ytd:Math.round((n-calendarDate(y+"-01-01"))/86400000)+1,
          std:Math.round((n-jul1)/86400000)+1};
}

/* ============ SUN TIMES ============
   Outlived the card they were written for. Two callers: the hero's sun line (renderHeroToday) and
   the day/night variant of the current-conditions icon. fmtT/fmtDur serve the same line. */
function sunTimes(lat,lon,date){
  var rad=Math.PI/180, wall=weatherParts(date);
  var start=Date.UTC(wall.year,0,0);
  var doy=Math.floor((Date.UTC(wall.year,wall.month,wall.day)-start)/86400000);
  var lngHour=lon/15;
  function calc(rising){
    var t=doy+((rising?6:18)-lngHour)/24;
    var M=(0.9856*t)-3.289;
    var Lsun=M+(1.916*Math.sin(M*rad))+(0.020*Math.sin(2*M*rad))+282.634; Lsun=(Lsun%360+360)%360;
    var RA=Math.atan(0.91764*Math.tan(Lsun*rad))/rad; RA=(RA%360+360)%360;
    RA+= (Math.floor(Lsun/90)*90)-(Math.floor(RA/90)*90); RA/=15;
    var sinDec=0.39782*Math.sin(Lsun*rad), cosDec=Math.cos(Math.asin(sinDec));
    var cosH=(Math.cos(90.833*rad)-(sinDec*Math.sin(lat*rad)))/(cosDec*Math.cos(lat*rad));
    if(cosH>1||cosH<-1) return null;
    var H=(rising?360-Math.acos(cosH)/rad:Math.acos(cosH)/rad)/15;
    var T=H+RA-(0.06571*t)-6.622;
    var UT=(T-lngHour)%24; if(UT<0)UT+=24;
    var d=new Date(Date.UTC(wall.year,wall.month,wall.day));
    return new Date(d.getTime()+UT*3600000);
  }
  var r=calc(true), s=calc(false);
  if(r&&s&&s.getTime()<r.getTime()) s=new Date(s.getTime()+86400000);
  return {rise:r, set:s};
}

function cpcParse(d){
  if(!d||d.error||!Array.isArray(d.features)) return null;
  if(!d.features.length) return {cat:"Equal chances",prob:null};
  var best=null;
  (d.features||[]).forEach(function(f){
    var at=f.attributes||{}, cat=null, prob=null;
    for(var k in at){
      var kl=k.toLowerCase();
      if(kl==="cat"||kl==="category") cat=String(at[k]);
      if((kl==="prob"||kl==="probability")&&at[k]!=null) prob=+at[k];
    }
    if(cat&&/above|below|normal|equal|^EC$|^[ABN]$/i.test(cat)&&(best==null||(prob||0)>(best.prob||0))) best={cat:cat,prob:prob};
  });
  return best;
}

function cpcPill(kind,r){
  // kind: "t" temp, "p" precip
  if(!r||!r.cat) return '<span class="cpc-pill" style="background:var(--inset);color:var(--muted)">Unavailable</span>';
  if(!/above|below|^[AB]$/i.test(r.cat)&&/normal|equal|^EC$|^N$/i.test(r.cat)){
    return '<span class="cpc-pill" style="background:var(--inset);color:var(--muted)">'+(/equal|^EC$/i.test(r.cat)?"Equal chances":"Near normal")+'</span>';
  }
  var above=/above|^A$/i.test(r.cat);
  var label, bg;
  if(kind==="t"){ label=above?"Leaning warm":"Leaning cool"; bg=above?"#ff7a2f":"#4aa3ff"; }
  else{ label=above?"Leaning wet":"Leaning dry"; bg=above?"#37b06f":"#c9a15a"; }
  var pct=(r.prob!=null&&!isNaN(r.prob))?" \u00b7 "+Math.round(r.prob)+"%":"";
  return '<span class="cpc-pill" style="background:'+bg+';color:'+textOn(bg)+'">'+label+pct+'</span>';
}

function textOn(bg){
  if(!bg||bg.charAt(0)!=="#") return "var(--text)";
  var r=parseInt(bg.substr(1,2),16),g=parseInt(bg.substr(3,2),16),b=parseInt(bg.substr(5,2),16);
  return (0.299*r+0.587*g+0.114*b)>150?"#141414":"#ffffff";
}

/* Evidence is derived from the same candidates and weather values as the advice. This disclosure
   explains the rule and the inputs; it does not run a second recommendation algorithm. */
function briefingEvidence(c,H){
  var values=c.detail?[c.detail]:[], sources=[], limits=[], reason="The dashboard ranks the available weather impacts by consequence.";
  if(c.horizon==="week"){
    sources=["daily"];
    if(/remaining hourly/.test(c.detail)) sources.push("hourly");
    reason="Later-week planning uses NWS day/night forecast periods after the near-term window.";
    limits.push("Day/night periods do not establish an exact arrival hour. Confidence and timing can change as the day approaches.");
  }else if(/outlook/i.test(c.label)){
    sources=["risk"];
    reason="The strongest available NOAA storm, flood, fire or winter outlook supplies this planning cue.";
    limits.push("An outlook describes potential over an area and period; it does not confirm an event at this point.");
  }else if(c.context){ sources=["context","daily"]; }
  else if(c.topic==="air"){ sources=["aqi"]; reason="The current AQI category determines the exposure guidance."; }
  else if(c.topic==="uv"){ sources=["uv"]; reason="The forecast UV peak determines the sun-exposure guidance."; limits.push("Burn estimates vary with skin type, shade and protection."); }
  else{
    sources=["hourly"];
    var temps=H.map(function(h){return h.t;}).filter(function(v){return typeof v==="number"&&isFinite(v);});
    var pops=H.map(function(h){return h.pop;}).filter(function(v){return v!=null;});
    var winds=H.map(function(h){return h.mph;}).filter(function(v){return v!=null;});
    if(temps.length) values.push("Hourly temperatures "+Math.min.apply(null,temps)+"–"+Math.max.apply(null,temps)+"°F in the near-term window.");
    if(pops.length) values.push("Highest reported hourly precipitation chance "+Math.max.apply(null,pops)+"%.");
    if(winds.length) values.push("Highest forecast sustained wind "+Math.max.apply(null,winds)+" mph.");
    if(pops.length<H.length) limits.push("Some hourly precipitation chances are missing; missing values remain unknown.");
    if(c.topic==="precip"||c.topic==="storm"){
      reason="Rain windows begin at a reported hourly chance of at least 40% and end below 30%; lower chances produce broader planning guidance.";
      limits.push("Precipitation chance is a probability. The forecast does not guarantee a dry gap or exact storm arrival.");
    }else if(c.topic==="outdoors"){
      reason="The outdoor window compares consecutive daylight hours using temperature, humidity, rain chance and wind.";
      limits.push("A comfortable window is not a guarantee of safety or the end of a storm.");
    }else if(c.topic==="heat"||c.topic==="cold"){
      reason="Hourly temperatures and calculated feels-like values determine the temperature guidance.";
      limits.push("Feels-like estimates depend on reported humidity and wind; individual exposure varies.");
    }
    limits.push("Hourly conditions and timing can change between forecast updates.");
  }
  if(c.alertAware){ sources.push("alerts"); reason="An active local NWS alert takes priority over the forecast ranking. Follow the official alert instructions."; }
  return {values:values,sources:sources,limits:limits,reason:reason};
}

function validLocation(l){
  if(!l||typeof l.name!=="string"||!l.name.trim()||l.name.length>120||typeof l.lat!=="number"||typeof l.lon!=="number"||!isFinite(l.lat)||!isFinite(l.lon)||l.lat<-90||l.lat>90||l.lon<-180||l.lon>180) return null;
  return {name:l.name.trim(),lat:l.lat,lon:l.lon,station:/^[A-Z0-9]{3,6}$/.test(l.station||"")?l.station:null,
    precision:/^(representative|device|point)$/.test(l.precision)?l.precision:"point"};
}

function locationKey(l){ return l.lat.toFixed(5)+","+l.lon.toFixed(5); }

function sharedLocation(search){
  var p=new URLSearchParams(search), lat=p.get("lat"), lon=p.get("lon");
  if(lat==null||lon==null||!lat.trim()||!lon.trim()) return null;
  return validLocation({name:p.get("place")||"Shared location",lat:Number(lat),lon:Number(lon),precision:p.get("kind")==="city"?"representative":"point"});
}

/* Validate each forecast independently before any renderer can consume malformed periods. */
function validatedForecast(data,now){
  if(!data||!data.properties||!Array.isArray(data.properties.periods)) return null;
  var periods=data.properties.periods.filter(function(p){
    return p&&typeof p.temperature==="number"&&isFinite(p.temperature)
      &&typeof p.name==="string"&&typeof p.isDaytime==="boolean"
      &&typeof p.shortForecast==="string"&&typeof p.windSpeed==="string"
      &&(p.detailedForecast==null||typeof p.detailedForecast==="string")
      &&isFinite(Date.parse(p.startTime))&&Date.parse(p.endTime)>Date.parse(p.startTime);
  }).sort(function(a,b){return Date.parse(a.startTime)-Date.parse(b.startTime);});
  if(!periods.some(function(p){return Date.parse(p.endTime)>now;})) return null;
  return {properties:Object.assign({},data.properties,{periods:periods})};
}

/* Retained evidence cannot outlive either the event end or the message expiration. */
function alertEvidenceEnd(properties){
  var times=[properties.ends,properties.expires].map(function(t){return Date.parse(t||"");})
    .filter(function(t){return isFinite(t)&&t>0;});
  return times.length?Math.min.apply(null,times):0;
}
