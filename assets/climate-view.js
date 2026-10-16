/* ============ CLIMATE vs NORMAL (RCC-ACIS, 1991-2020 normals, keyless) ============ */
var ACIS="https://data.rcc-acis.org/";
var climate={normHi:null, normLo:null, fcHi:null, fcLo:null, station:null, stationName:""};
var _climStationCache={};
function acisNum(v){ // ACIS returns "M" (missing), "T" (trace), or a numeric string
  if(v==null) return null;
  if(v==="T") return 0;            // trace precip/snow → treat as ~0
  if(v==="M"||v==="") return null;
  var n=parseFloat(v);
  return isNaN(n)?null:n;
}

function fmtDep(v,unit){
  if(v==null) return '<span class="cn-na">—</span>';
  var s=(v>0?"+":"")+ (unit==="°"?v.toFixed(1):v.toFixed(2)) + unit;
  var cls = Math.abs(v)<(unit==="°"?0.5:0.05) ? "cn-flat"
          : (unit==="°"
              ? (v>0?"cn-warm":"cn-cool")
              : (v>0?"cn-wet":"cn-dry"));
  return '<span class="'+cls+'">'+s+'</span>';
}
function renderVsNormal(){
  var el=document.getElementById("cnToday"); if(!el) return;
  function dep(fc,norm){
    if(fc==null||norm==null) return '';
    var d=fc-norm, s=(d>0?"+":"")+Math.round(d)+"°";
    var cls=Math.abs(d)<1?"cn-flat":(d>0?"cn-warm":"cn-cool");
    return ' <span class="'+cls+'">('+s+')</span>';
  }
  var hiNormal=forecastNormalFor(climate.fcHiDate), loNormal=forecastNormalFor(climate.fcLoDate);
  var normHi=hiNormal?hiNormal.hi:(climate.normDate===climate.fcHiDate?climate.normHi:null);
  var normLo=loNormal?loNormal.lo:(climate.normDate===climate.fcLoDate?climate.normLo:null);
  var hi = climate.fcHi!=null ? '<b>'+climate.fcHi+'°</b>'+dep(climate.fcHi,normHi) : '—';
  var lo = climate.fcLo!=null ? '<b>'+climate.fcLo+'°</b>'+dep(climate.fcLo,normLo) : '—';
  var nh = normHi!=null ? normHi+'°' : 'unavailable for this date';
  var nl = normLo!=null ? normLo+'°' : 'unavailable for this date';
  var hiLbl = "Forecast high"+(climate.fcHiLabel||"");
  el.innerHTML='<div class="cn-trow"><span class="cn-k">'+hiLbl+'</span><span class="cn-v">'+hi+'</span><span class="cn-n">normal '+nh+'</span></div>'
    +'<div class="cn-trow"><span class="cn-k">Forecast low'+(climate.fcLoDate?' ('+weatherTime(calendarDate(climate.fcLoDate),{weekday:"short"})+')':'')+'</span><span class="cn-v">'+lo+'</span><span class="cn-n">normal '+nl+'</span></div>';
}
/* Gap tolerance depends on the statistic, because gaps hurt sums and means differently:
   a SUM of precipitation always loses rain on a missing day (biased low, so be strict), while a
   MEAN temperature over 19 of 25 days is simply a smaller sample (unbiased, so be generous). */
function climGapMax(periodDays,isSum){
  return isSum ? Math.max(2,Math.floor(0.05*periodDays)) : Math.max(3,Math.floor(0.25*periodDays));
}

/* Each departure arrives as [value, missingDays] thanks to add:"mcnt" — return the value with a
   verdict, so the caller can decide between using it, borrowing, or blanking. */
function climCells(row,showSnow,per){
  function plain(x){ return Array.isArray(x)?acisNum(x[x.length-1]):acisNum(x); }
  function grab(x,period,isSum){
    if(!Array.isArray(x)){ var v0=acisNum(x); return {v:v0, ok:v0!=null}; }
    var miss=(x.length>1)?(+x[1]||0):0, v=acisNum(x[0]);
    return {v:v, ok:(v!=null && miss<=climGapMax(period,isSum)), miss:miss};
  }
  return {normHi:plain(row[1]), normLo:plain(row[2]),
          t1:grab(row[3],per.mtd,false), t2:grab(row[4],per.ytd,false),
          p1:grab(row[5],per.mtd,true),  p2:grab(row[6],per.ytd,true),
          sn:showSnow?grab(row[7],per.std,true):{v:null,ok:true}};
}
function climAllOK(c,showSnow){
  return c.t1.ok&&c.t2.ok&&c.p1.ok&&c.p2.ok&&(!showSnow||c.sn.ok);
}


/* ============ CLIMATE CONTEXT — records, rankings, streaks ============
   Up to seven visible calendar dates plus today/tomorrow, one observation per year per
   date; existing monthly/recent queries and bounded normal date ranges. At most three requests in flight,
   each with the existing 20s deadline. Only derived facts enter the 12-hour cache. */
var CTX_KEY="lsxCtx_v6";
var ctx={ready:false, recHi:null, recLo:null, recPcp:null, doyHi:[], doyLo:[],
         monWet:[], monWarm:[], monMtd:null, monMean:null, monName:"", years:0,
         dry:null, hist:null, normWeek:{}, recStation:""};
/* Minimum samples before a statistic is worth printing. "Warmer than 0 of 11 Jul 24s" carries
   the same visual confidence as "12 of 96" — suppression beats false precision. */
var CTX_MIN_YEARS=30, CTX_MIN_MONTHS=25;
/* ---- deep-record station for daily records & rankings ----
   The nearest station is right for normals and recent stats, but records need DEPTH. A station
   qualifies as deep when its temperature POR starts by 1965 — a legacy record, not a modern
   ASOS whose daterange merely LOOKS long (Mount Vernon spans 1976–2026 with 11 usable years).
   Search wider than the local pick (±1.8°) since legacy stations are sparse. */
var _deepCache={};

var MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
function ctxTodayKey(){ return weatherParts().key; }
function contextRecord(date){
  if(!ctx.ready) return null;
  return ctx.recordsByDate&&ctx.recordsByDate[date] || (ctx.recordDate===date?ctx:null);
}
function ctxNumPairs(rows,col,pickMax){
  // → {best:{v,y}, sorted:[v...]} over one column, ignoring M/T padding
  var vals=[], best=null;
  (rows||[]).forEach(function(r){
    var v=acisNum(r[col]);
    if(v==null||r[col]==="M") return;
    var y=String(r[0]).slice(0,4);
    vals.push(v);
    if(!best || (pickMax?v>best.v:v<best.v)) best={v:v,y:y};   // strict: ties keep the year the record was SET
  });
  vals.sort(function(a,b){return a-b;});
  return {best:best, sorted:vals};
}

/* ---- derived lookups (cheap, recomputed as the forecast changes) ---- */
function ctxRankBelow(sorted,v){
  if(v==null||!sorted||!sorted.length) return null;
  var n=0; for(var i=0;i<sorted.length;i++){ if(sorted[i]<v) n++; }
  return {below:n, total:sorted.length, pct:Math.round(n/sorted.length*100)};
}
function ctxDateAt(i){
  if(!ctx.hist) return null;
  var d=calendarDate(ctx.hist.start);
  d.setUTCDate(d.getUTCDate()+i);
  return d;
}
function ctxSince(kind,v){
  // most recent earlier day that reached v (hot) / dropped to v (cold); null = not in the window
  if(v==null||!ctx.hist) return null;
  var arr=(kind==="hot")?ctx.hist.maxt:ctx.hist.mint;
  for(var i=arr.length-2;i>=0;i--){        // skip today (often incomplete)
    var x=arr[i];
    if(x==null) continue;
    if(kind==="hot"?x>=v:x<=v){
      var d=ctxDateAt(i);
      return {date:d, days:Math.round((weatherDay()-d)/86400000)};
    }
  }
  return {date:null, days:null, beyond:true};
}
function fmtMD(d){ return d?d.toLocaleDateString("en-US", {timeZone:"UTC",month:"short", day:"numeric"}):""; }
/* Same date, with the year. ctxSince() searches two full years back and only reports a gap of 21
   days or more, so "warmest since Aug 27" could mean five weeks ago or twenty months — and a
   reader has no way to tell which, or whether the year was simply left off. The year is not
   decoration on a sentence whose whole point is how long it has been. Always printed, including
   for a date in the current year: a rule with an exception is a rule you have to check. */
function fmtMDY(d){ return d?d.toLocaleDateString("en-US", {timeZone:"UTC",month:"short", day:"numeric", year:"numeric"}):""; }
function shortStn(n){   // "ST LOUIS LAMBERT INTL AIRPORT" → "St Louis Lambert"
  var w=String(n||"").split(/\s+/).filter(function(x){
    return !/^(INTL|INTERNATIONAL|AIRPORT|ARPT|AP|FIELD|FLD|MUNICIPAL|MUNI|RGNL|REGIONAL|OUTLAND|AFB)$/i.test(x);
  });
  return w.slice(0,3).join(" ").replace(/\w\S*/g,function(t){ return t.charAt(0)+t.slice(1).toLowerCase(); });
}
function renderContext(){
  var el=document.getElementById("cnCtx");
  if(!el) return;
  if(!ctx.ready){ el.innerHTML=""; if(typeof renderForecastRecords==="function") renderForecastRecords(); return; }
  var L=[];
  function line(ico,html,cls){ L.push('<div class="cx'+(cls?" "+cls:"")+'"><span class="cxi">'+ic(ico)+'</span><span>'+html+'</span></div>'); }
  var record=contextRecord(climate.fcHiDate)||contextRecord(ctx.recordDate)||ctx;
  var md=fmtMD(record.recordDate?calendarDate(record.recordDate):weatherDay());
  // records for the forecast date — only from a sample that can support the claim; attribute the deep
  // station when it isn't the local one
  var deepOK=record.years>=CTX_MIN_YEARS;
  if(deepOK&&record.recHi&&record.recLo){
    line("record","Record for "+md+": high <b class=\"cx-rec\">"+Math.round(record.recHi.v)+"°</b> ("+record.recHi.y+")"
      +" · low <b class=\"cx-cold\">"+Math.round(record.recLo.v)+"°</b> ("+record.recLo.y+")"
      +' <span class="cx-src">· '+record.years+" years"
      +(ctx.recStation?" · "+esc(shortStn(ctx.recStation)):"")+'</span>');
  }else if(record.years>0&&!deepOK){
    line("info","Stations near here have short records ("+record.years+" yrs) — daily records omitted");
  }
  // where the forecast high would land among its matching calendar dates
  var r=deepOK&&climate.fcHiDate===record.recordDate?ctxRankBelow(record.doyHi,climate.fcHi):null;
  if(r&&climate.fcHi!=null){
    var pos=Math.max(0,Math.min(100,r.pct));
    L.push('<div class="cx cx-rank">'
      +'<div class="cx-row"><span class="cxi">'+ic("stats")+'</span>'
      +'<span>Forecast <b>'+climate.fcHi+'°</b> would rank warmer than <b>'+r.below+'</b> of '+r.total+' '+md+'s on record</span></div>'
      +'<div class="cx-bar"><i style="left:calc('+pos+'% - 1.5px)"></i></div>'
      +'</div>');
  }
  // month-to-date rankings stay LOCAL, so they need the local station to have enough history —
  // "wetter than 4 of 17 full Julys" is noise dressed as signal
  if(ctx.monMtd!=null&&ctx.monWet.length>=CTX_MIN_MONTHS){
    var rw=ctxRankBelow(ctx.monWet,ctx.monMtd);
    line("rain",ctx.monName+" rain <b class=\"cx-wet\">"+ctx.monMtd.toFixed(2)+"″</b> so far — already wetter than <b>"+rw.below+"</b> of "+rw.total+" full "+ctx.monName+"s");
  }
  if(ctx.monMean!=null&&ctx.monWarm.length>=CTX_MIN_MONTHS){
    var rt=ctxRankBelow(ctx.monWarm,ctx.monMean);
    line("heat",ctx.monName+" averaging <b>"+ctx.monMean.toFixed(1)+"°</b> — warmer than <b>"+rt.below+"</b> of "+rt.total+" "+ctx.monName+"s");
  }
  // dry streak
  if(ctx.dry&&ctx.dry.days>=3){
    line("drought","<b class=\"cx-dry\">"+ctx.dry.days+" days</b> since measurable rain (last "+ctx.dry.amt.toFixed(2)+"″ on "+fmtMD(calendarDate(ctx.dry.date))+")");
  }
  // "warmest since" / "coldest since", only when the gap is actually interesting
  if(climate.fcHi!=null){
    var s=ctxSince("hot",climate.fcHi);
    if(s&&s.beyond) line("heat","<b>"+climate.fcHi+"°</b> would be the warmest in at least 2 years");
    else if(s&&s.days>=21) line("heat","<b>"+climate.fcHi+"°</b> would be the warmest since "+fmtMDY(s.date));
  }
  if(climate.fcLo!=null){
    var sc=ctxSince("cold",climate.fcLo);
    if(sc&&sc.beyond) line("cold","<b>"+climate.fcLo+"°</b> would be the coolest in at least 2 years");
    else if(sc&&sc.days>=21) line("cold","<b>"+climate.fcLo+"°</b> would be the coolest since "+fmtMDY(sc.date));
  }
  el.innerHTML=L.join("");
  renderCurrentCtx(); renderVsNormal();
  // per-day normals arrive after the 7-day is already on screen → repaint it once
  if(typeof loadForecast==="function" && loadForecast._paint) loadForecast._paint();
  if(typeof renderTheCall==="function") renderTheCall();
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
/* Today's range + sun times, painted into the hero.
   Two feeds have to agree before this can say anything: the observation supplies "now" and the
   7-day supplies today's high/low. Either can land first, so both call this and it renders
   whatever is currently known — the same idempotent-repaint contract renderCurrentCtx uses. */
var heroNow={temp:null};

function renderHeroToday(){
  var el=document.getElementById("ccToday");
  if(!el) return;
  var r=rangeRow((smart.days&&smart.days[0])||null,(smart.days&&smart.days[1])||null,heroNow.temp);
  var out="";
  if(r){
    var lo=r.lo, hi=r.hi, nextDay=r.nextDay;
    var mark=(r.mark==null)?"":'<b style="left:'+(r.mark*100).toFixed(1)+'%"></b>';
    out+='<div class="cc-range">'
      +'<span class="cr-lbl">'+(nextDay?"Tonight":"Today")+'</span>'
      +'<span '+tvAttr(lo,"cr-lo")+'>'+lo+'°</span>'
      +'<span class="cc-track"><i style="background:linear-gradient(90deg,'+tCol(lo)+','+tCol(hi)+')"></i>'+mark+'</span>'
      +'<span '+tvAttr(hi,"cr-hi")+'>'+hi+'°'
        +(nextDay?'<span class="cr-nx">tmrw</span>':'')+'</span>'
      +(r.drop!=null?'<span class="cr-drop">'+r.drop+'° colder</span>':'')
      +'</div>';
  }
  // Sun line: lead with whichever event is still ahead — that's the one worth planning around.
  var st=sunTimes(current.lat,current.lon,new Date()), now=Date.now();
  if(st.rise&&st.set){
    var bits;
    if(now<st.rise.getTime()){
      bits=['<span>'+mcImg("sunrise","sun",18)+'Sunrise <b>'+fmtT(st.rise)+'</b></span>'];
    }else if(now<st.set.getTime()){
      bits=['<span>'+mcImg("sunset","moon",18)+'Sunset <b>'+fmtT(st.set)+'</b></span>',
            '<span class="cs-sep">·</span>',
            '<span><b>'+fmtDur(st.set.getTime()-now)+'</b> of daylight left</span>'];
    }else{
      var tm=sunTimes(current.lat,current.lon,new Date(weatherDay(now).getTime()+86400000));
      bits=['<span>'+mcImg("sunset","moon",18)+'Sun set <b>'+fmtT(st.set)+'</b></span>'];
      if(tm.rise) bits.push('<span class="cs-sep">·</span>',
                            '<span>'+mcImg("sunrise","sun",18)+'Sunrise <b>'+fmtT(tm.rise)+'</b></span>');
    }
    out+='<div class="cc-sun">'+bits.join("")+'</div>';
  }
  // No next-few-hours strip here: the full 24-hour chart now sits in this same card, and two
  // renderings of the same forecast an inch apart is worse than either alone.
  el.innerHTML=out;
}
function renderCurrentCtx(){
  var el=document.getElementById("ccCtx"), src=document.getElementById("ccRecSrc");
  if(!el) return;
  var bits=[], credit="";
  if(climate.normDate===weatherParts().key&&climate.normHi!=null&&climate.normLo!=null)
    bits.push('<span class="cx-pair"><i>Normal</i><b>'+Math.round(climate.normHi)+"°/"+Math.round(climate.normLo)+"°</b></span>");
  if(ctx.recordDate===weatherParts().key&&ctx.years>=CTX_MIN_YEARS){   // records only when the sample can support them
    var r=[];
    if(ctx.recHi) r.push('<b class="rc-hi">'+Math.round(ctx.recHi.v)+'°</b><span class="rc-y">'+ctx.recHi.y+'</span>');
    if(ctx.recLo) r.push('<b class="rc-lo">'+Math.round(ctx.recLo.v)+'°</b><span class="rc-y">'+ctx.recLo.y+'</span>');
    if(r.length) bits.push('<span class="cx-pair"><i>Record</i>'+r.join('<span class="rc-sep"></span>')+'</span>');
    // The credit follows the numbers down to the provenance line, but it still follows them —
    // a figure borrowed from another station stays attributed by name.
    if(ctx.recStation&&r.length) credit=' · <span class="nw">'+esc(shortStn(ctx.recStation))+" records</span>";
  }
  el.innerHTML=bits.join("");
  if(src) src.innerHTML=credit;
}
