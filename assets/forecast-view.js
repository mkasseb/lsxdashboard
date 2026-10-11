/* Daily forecast presentation. Validated source payloads are explicit inputs; no fetching here. */
function renderDailyForecast(f,h){
  var daily=document.getElementById("daily");
var hByDate=h?hourlyByDate(h.properties.periods):{};
var ps=f.properties.periods.slice(0,15);
/* Pair day + night periods into single calendar days — seven visible rows, capped ON PURPOSE.
   After sunset the feed leads with a night-only "Tonight" and ends on a day-only tail
   (a Thursday with a high and no low — its night isn't issued yet, and the forecast grid
   holds nothing to recover one from: minTemperature and even the hourly temperature
   series stop at the same edge). An eighth row carrying that tail was tried and read as
   broken — a lone high and a dash where every other row shows a pair — so the tail stays
   dropped from the card: Tonight plus six full days, and the seventh day arrives whole in
   the morning. The Bottom Line keeps the final period because its seven-day scope needs it. */
var weekDays=pairForecastPeriods(ps),days=weekDays.slice(0,7);
smart.weekDays=weekDays;
smart.days=days;
renderHeroToday(); // today's high/low is now known — fill the hero's range bar
// Week-wide temp range for bar scaling
var wMin=999, wMax=-999;
days.forEach(function(d){
  if(d.day) { wMax=Math.max(wMax,d.day.temperature); wMin=Math.min(wMin,d.day.temperature); }
  if(d.night){ wMax=Math.max(wMax,d.night.temperature); wMin=Math.min(wMin,d.night.temperature); }
});
var range=Math.max(1,wMax-wMin);
// Cache today's forecast hi/lo for the Climate-vs-Normal card
if(days[0]){
  if(typeof climate!=="undefined"){
    var hiPeriod=days[0].day, fcHi=hiPeriod?hiPeriod.temperature:null, hiLabel="";
    if(fcHi==null){ // evening: today's daytime high already passed → use next available daytime high
      for(var k=1;k<days.length;k++){ if(days[k].day){ hiPeriod=days[k].day; fcHi=hiPeriod.temperature; hiLabel=" (tmrw)"; break; } }
    }
    climate.fcHi=fcHi;
    climate.fcHiDate=hiPeriod?weatherParts(hiPeriod.startTime).key:null;
    climate.fcLoDate=days[0].night?weatherParts(Date.parse(days[0].night.endTime)-1).key:null;
    climate.fcHiLabel=hiLabel;
    climate.fcLo=days[0].night?days[0].night.temperature:null;
    if(typeof renderVsNormal==="function") renderVsNormal();
  }
}
function popOf(p){ return (p&&p.probabilityOfPrecipitation&&p.probabilityOfPrecipitation.value!=null)?p.probabilityOfPrecipitation.value:null; }
function factsFor(d){
  var hi=d.day?d.day.temperature:null, lo=d.night?d.night.temperature:null;
  var main=d.day||d.night;
  var wall=main&&main.startTime?nwsWallTime(main.startTime):null;
  var key=wall?wall.key:null;
  var hrec=(key&&hByDate[key])?hByDate[key]:null;
  var full=!!(hrec&&hrec.lastH>=18);
  var rh=full?hrec.rh:null;
  var highPeriod=d.day||main, lowPeriod=d.night||main;
  var feelsHigh=(full&&hrec.fl!=null)?hrec.fl
        :feelsLikeF(highPeriod?highPeriod.temperature:null,rh,parseMph(highPeriod?highPeriod.windSpeed:null));
  var feelsLow=(full&&hrec.flMin!=null)?hrec.flMin
        :feelsLikeF(lowPeriod?lowPeriod.temperature:null,null,parseMph(lowPeriod?lowPeriod.windSpeed:null));
  var lowHr=(full&&hrec.flMinH!=null)?hrec.flMinH:null;
  var lowLabel=/^tonight$/i.test(d.name)?"Tonight"
    :(lowHr!=null&&lowHr<12?d.name+" morning":(lowHr!=null&&lowHr<18?d.name:d.name+" night"));
  var dayPop=popOf(d.day), nightPop=popOf(d.night);
  return {name:d.name,hi:hi,lo:lo,main:main,month:wall?wall.month:null,dayOfMonth:wall?wall.day:null,
          key:key,hrec:hrec,full:full,rh:rh,
          feelsHigh:feelsHigh,feelsLow:feelsLow,feelsLowLabel:lowLabel,
          dayPop:dayPop,nightPop:nightPop,
          dayCondition:d.day?d.day.shortForecast:"",nightCondition:d.night?d.night.shortForecast:"",
          pop:Math.max(dayPop!=null?dayPop:0,nightPop!=null?nightPop:0),
          wind:main?(((main.windDirection?main.windDirection+" ":"")+(main.windSpeed||"")).trim()||"—"):"—"};
}
// Stored as a repaintable closure: climate context (per-day normals) usually lands AFTER the
// forecast, and renderContext calls this again so the "vs Normal" cell can appear.
loadForecast._paint=function(){
  var open=[], focused=-1;
  [].slice.call(daily.querySelectorAll(".day-item")).forEach(function(it,i){
    if(it.classList.contains("open")) open.push(i);
    if(it.contains(document.activeElement)) focused=i;
  });
  daily.innerHTML=paintDays();
  var items=daily.querySelectorAll(".day-item");
  if(typeof NbmRange!=="undefined") NbmRange.forecast(days);
  renderForecastRecords(true);
  open.forEach(function(i){ if(items[i]) setOpen(items[i],items[i].querySelector(".day"),true); });   // keep expanded rows expanded
  // …and keep the keyboard where it was. This repaint fires on its own schedule (whenever
  // the climate normals land), and restoring the open rows but not the focus dumped a
  // keyboard user onto <body> mid-tab. Same courtesy, same index.
  if(focused>=0&&items[focused]) items[focused].querySelector(".day").focus();
  // No fitDayDates() here: this innerHTML write is itself a mutation the masonry observer
  // will see, and the repack it schedules ends in exactly that call — with the card at its
  // final width, which a measurement taken now wouldn't have.
};
function paintDays(){ return days.map(function(d){
  var fact=factsFor(d), hi=fact.hi, lo=fact.lo;
  var a=(lo!=null?lo:hi), b=(hi!=null?hi:lo);
  var left=((Math.min(a,b)-wMin)/range)*100, width=Math.max(4,(Math.abs(b-a)/range)*100);
  var grad="linear-gradient(90deg,"+tCol(Math.min(a,b))+","+tCol(Math.max(a,b))+")";
  var pop=fact.pop, popText=summaryPopText(pop), main=fact.main, wind=fact.wind;
  var mMonth=fact.month, mDay=fact.dayOfMonth, _dk=fact.key, hrec=fact.hrec, rh=fact.rh;
  var hotImpact=forecastImpact(fact.feelsHigh,hi!=null?hi:(main?main.temperature:null));
  var coldImpact=forecastImpact(fact.feelsLow,lo!=null?lo:(main?main.temperature:null));
  var impact=(hotImpact&&hotImpact.kind==="hot")?hotImpact:((coldImpact&&coldImpact.kind==="cold")?coldImpact:null);
  var fl=impact&&impact.kind==="cold"?fact.feelsLow:fact.feelsHigh;
  var condition=impact?impact.label:compactCondition(main.shortForecast,pop);
  /* A day period whose night hasn't been issued. The 7-row cap normally leaves the feed's
     day-only tail on the floor (see the pairing loop), so this fires only when the feed
     itself comes up short of seven whole days — rare, but a real NWS failure mode. When it
     does, the missing low is the DATA's edge, not a fetch that failed, and there is no
     honest number to recover (the grid's minTemperature stops at the same edge). What must
     not happen is a silent blank: on every other row that slot holds a number, so an empty
     one reads as "we forgot", when the truth is "NWS hasn't said yet". Same doctrine as
     ccGap on the conditions card — a dash that says whose gap it is. */
  var noNight=!!(d.day&&!d.night);
  var detail="";
  if(d.day)   detail+='<p class="dd-text"><b>Day</b>'+esc(d.day.detailedForecast||d.day.shortForecast)+'</p>';
  if(d.night) detail+='<p class="dd-text"><b>Night</b>'+esc(d.night.detailedForecast||d.night.shortForecast)+'</p>';
  else if(noNight) detail+='<p class="dd-text"><b>Night</b>Not issued yet — the NWS forecast currently ends with the '+esc(d.name)+' daytime period. The overnight low arrives in a later forecast package.</p>';
  // The date beside the name: "Friday" is ambiguous by day five of a seven-day list, and
  // NWS sometimes swaps a holiday name in ("Independence Day") that says even less about
  // where in the week it falls. Visually it's the muted "8/1"; a screen reader gets the
  // month spelled out instead, since "8 slash 1" is noise. fitDayDates() measures
  // after paint; narrow rows stack the date beneath the name so it stays visible.
  var md=mMonth!=null?'<span class="dnd" aria-hidden="true">'+(mMonth+1)+"/"+mDay+'</span>'
            +'<span class="sr">, '+MONTHS[mMonth]+" "+mDay+'</span>':'';
  return '<div class="day-item">'
    +'<button class="day" type="button" aria-expanded="false" title="'+esc(main.shortForecast)+'">'
      +'<div><div class="dn"><span aria-hidden="true">'+esc(compactDayName(d.name))+'</span>'
        +'<span class="sr">'+esc(d.name)+'</span>'+md+'</div>'
        +'<div class="dcond'+(impact?' impact-'+impact.kind:'')+'">'+esc(condition)+'</div></div>'
      +'<div class="di">'+wxImg(main.shortForecast,!!d.day,26,!!impact)+'</div>'
      +'<div class="dp">'+(popText?ic("drop")
        +'<span class="sr">Precipitation '+(popText.charAt(0)==="~"?"about ":"")+popText.replace("~","")+'</span>'
        +'<span aria-hidden="true">'+popText+'</span>':"&nbsp;")+'</div>'
      +'<div class="tbar"><div class="tfill" style="left:'+left.toFixed(1)+'%;width:'+width.toFixed(1)+'%;background:'+grad+'"></div></div>'
      // The visible H/L survives colour-vision differences and makes the conventional
      // high-first order explicit. The clipped words keep the same clarity for a reader.
      +'<div class="dt'+(((hi==null&&lo!=null)||(hi!=null&&lo==null&&!noNight))?' only-one':'')+'">'
        +(hi!=null?'<span '+tvAttr(hi)+'><span class="tl" aria-hidden="true">H</span><span class="sr">High </span>'+hi+'°</span>':'')
        +(lo!=null?'<span '+tvAttr(lo,"lo")+'><span class="tl" aria-hidden="true">L</span><span class="sr">Low </span>'+lo+'°</span>'
        :(noNight?'<span class="dt-na" title="No low yet — NWS hasn\'t issued '+esc(d.name)+' Night">'
          +'<span class="sr">Low not yet forecast</span><span aria-hidden="true">L —</span></span>':''))+'</div>'
      +'<div class="chev" aria-hidden="true">▾</div>'
    +'</button>'
    +'<div class="day-detail">'
      +detail
      +'<div class="dd-grid">'
        +'<div class="dd-item"><div class="k">Precip Chance</div><div class="v">'+(pop>0?pop+"%":"0%")+'</div></div>'
        +'<div class="dd-item"><div class="k">Wind</div><div class="v">'+esc(wind)+'</div></div>'
        +'<div class="dd-item'+(impact?' impact-'+impact.kind:'')+'"><div class="k">'
          +(impact&&impact.kind==="hot"?"Peak Feels Like":(impact&&impact.kind==="cold"?"Lowest Feels Like":"Feels Like"))+'</div>'
          +'<div class="v">'+(fl!=null?fl+"°":"—")+'</div></div>'
        // The key names the hour the reading came from — the page's habit of saying exactly
        // what a number is. Usually "(1pm)"; on a Tonight row the winner is an evening hour.
        +'<div class="dd-item"><div class="k">Humidity'+(rh!=null&&hrec.rhH!=null?' ('+hrWord(hrec.rhH)+')':'')
          +'</div><div class="v">'+(rh!=null?rh+"%":"—")+'</div></div>'
        +(function(){   // that day's peak UV, when Open-Meteo has it for the date
          var du=_dk?uv.daily[_dk]:null;
          if(du==null) return "";
          var dr=Math.round(du), dl=uvLevel(dr);
          return '<div class="dd-item"><div class="k">UV Index</div>'
            +'<div class="v"><span class="lvcol" style="color:'+dl.c+'">'+dr+" "+dl.t+'</span></div></div>';
        })()
        +(function(){   // how this day sits against the 1991–2020 normal for that date
          var nw=_dk&&ctx.normWeek?ctx.normWeek[_dk]:null;
          if(!nw||(nw.hi==null&&nw.lo==null)) return "";
          function dp(v,n){
            if(v==null||n==null) return '<span class="cn-na">—</span>';
            var d=Math.round(v-n), s=(d>0?"+":"")+d+"°";
            return '<span class="'+(Math.abs(d)<1?"cn-flat":(d>0?"cn-warm":"cn-cool"))+'">'+s+'</span>';
          }
          return '<div class="dd-item"><div class="k">vs Normal ('+Math.round(nw.hi)+"°/"+Math.round(nw.lo)+'°)</div>'
            +'<div class="v">'+dp(hi,nw.hi)+" / "+dp(lo,nw.lo)+'</div></div>';
        })()
      +'</div>'
    +'</div>'
  +'</div>';
}).join(""); }
loadForecast._paint();
if(typeof ensureForecastRecordDates==="function") ensureForecastRecordDates();
}

/* Optional observed station context has its own date, location and freshness gates.
   It never supplies an NWS temperature, NBM range, alert or planning decision. */
function forecastRecordFor(date){
  if(!ctx||!ctx.ready||ctx.location!==locationKey(current)||ctx.recordAsOf!==ctxTodayKey()) return null;
  var r=ctx.recordsByDate&&ctx.recordsByDate[date];
  if(!r||r.recordDate!==date||r.asOf!==ctxTodayKey()||r.location!==locationKey(current)
    ||typeof r.checkedAt!=="number"||Date.now()<r.checkedAt||Date.now()-r.checkedAt>FEEDS.context.age
    ||!r.source||!ctx.recordSource||r.source.sid!==ctx.recordSource.sid||!recordStationMatches(ctx.recordSource.sid,r.source)) return null;
  return r;
}
function forecastRecordYears(record,compact){
  var years=record.years||[record.y];
  return compact&&years.length>2?years[0]+" +"+(years.length-1):years.join(", ");
}
function forecastRecordCoverage(source,col){
  var range=source&&source.valid_daterange&&source.valid_daterange[col];
  return range&&recordDateKey(range[0])&&recordDateKey(range[1])?range:null;
}
function renderForecastRecords(force){
  var daily=document.getElementById("daily"),station=document.getElementById("forecastRecordStation"),body=document.getElementById("forecastRecordSourceBody");
  if(!daily||!station||!body||typeof ctx==="undefined"||typeof smart==="undefined") return;
  var same=ctx.location===locationKey(current)&&ctx.recordAsOf===ctxTodayKey(),source=same?ctx.recordSource:null;
  var rows=[].slice.call(daily.querySelectorAll(".day-item")),markup=[],details=[],counts=[];
  (smart.days||[]).slice(0,7).forEach(function(day){
    var period=day.day||day.night,date=forecastCalendarKey(period);
    if(!date){
      markup.push('<span class="record-label">Records</span> <span>Calendar date unavailable</span>');
      details.push('<h3>Daily records unavailable</h3><p>This forecast period does not supply a usable calendar date.</p>');
      counts.push('<li>Calendar date unavailable</li>');return;
    }
    var md=fmtMD(calendarDate(date)),r=forecastRecordFor(date),min=calendarRecordMinimum(date);
    if(r) source=r.source; // actual returned station metadata, not a guessed station name
    var hi=r&&r.hiCount>=min?r.recHi:null,lo=r&&r.loCount>=min?r.recLo:null;
    function value(label,record){return '<span class="record-value">'+label+' '+(record?'<b>'+esc(String(record.v))+'°</b> <span class="record-years">('+esc(forecastRecordYears(record,true))+')</span>':'unavailable')+'</span>';}
    markup.push('<span class="record-label">Records<span class="sr"> for '+esc(md)+'</span></span> '
      +(hi||lo?value("High",hi)+'<span class="record-dot" aria-hidden="true">·</span>'+value("Low",lo)
        :'<span>'+esc(md)+' records unavailable</span>'));
    function observation(label,record,count,range){
      return '<p>'+label+': '+(record?'<b>'+esc(String(record.v))+'°F</b> ('+esc(forecastRecordYears(record,false))+')':'unavailable')
        +(r?' · '+count+' usable '+esc(md)+' observations'+(range&&range[0]?' from '+range[0].slice(0,4)+'–'+range[1].slice(0,4):''):'')+'.</p>';
    }
    var detail='<h3>Daily records for '+esc(md)+'</h3>'
      +observation('Highest daily high',hi,r?r.hiCount:0,r&&r.hiPeriod)
      +observation('Lowest daily low',lo,r?r.loCount:0,r&&r.loPeriod);
    if(r){
      detail+='<p>'+esc(r.source.name)+' · checked '+esc(weatherTime(r.checkedAt,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))+' CT. Missing observations are omitted.'
        +((!hi||!lo)?' At least '+min+' observed dates are required for each record.':'')+'</p>';
    }
    if(day.night){
      detail+='<p>NWS overnight low: '+esc(weatherTime(day.night.startTime,{month:"short",day:"numeric",hour:"numeric",timeZoneName:"short"}))+' – '
        +esc(weatherTime(day.night.endTime,{month:"short",day:"numeric",hour:"numeric",timeZoneName:"short"}))+'. It can occur the following morning; records match the row’s calendar date.</p>';
    }
    if(date.slice(5)==="02-29") detail+='<p>Only observed February 29 dates are used. February 28 substitutions from annual date stepping are excluded.</p>';
    details.push(detail);
    counts.push('<li>'+esc(md)+': '+(r?'high '+r.hiCount+' / low '+r.loCount+' usable dates; checked '+esc(weatherTime(r.checkedAt,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))+' CT':'records unavailable')+'</li>');
  });
  var id=source&&Array.isArray(source.sids)?source.sids.filter(function(s){return / 5$/.test(s);})[0]:null;
  id=id?id.split(" ")[0]:source&&source.sid;
  var hp=forecastRecordCoverage(source,0),lp=forecastRecordCoverage(source,1);
  var since=hp&&lp&&hp[0].slice(0,4)===lp[0].slice(0,4)?' · since '+hp[0].slice(0,4):'';
  var stationText=source?'Daily records: '+shortStn(source.name||source.sid)+(id?' ('+id+')':'')+since:'Daily records: station data unavailable';
  var sourceHtml='<p>Observed daily maximum highs and minimum lows in °F from RCC ACIS. These are this station’s calendar-date records; station observations do not describe the selected location’s exact GPS point. The airport series is kept separate from NWS area records.</p>';
  if(source){
    sourceHtml+='<p><b>'+esc(source.name||source.sid)+'</b> · '+esc(id||source.sid)+'. '
      +(hp?'Daily high archive: '+hp[0]+' to '+hp[1]+'. ':'Daily high period of record unavailable. ')
      +(lp?'Daily low archive: '+lp[0]+' to '+lp[1]+'.':'Daily low period of record unavailable.')+'</p>';
    if(same&&ctx.recordSelection!=="legacy airport") sourceHtml+='<p>Using the '+esc(ctx.recordSelection||"selected station")+' series; legacy airport lookup did not supply a deeper series.</p>';
  }
  sourceHtml+='<p>Only completed dates before '+esc(ctxTodayKey())+' are included. Archive spans can contain gaps. All tied record years appear in each day’s details; records are withheld when checks are over 12 hours old.</p><ul>'+counts.join("")+'</ul>'
    +'<p>'+officialSourceLink("https://www.rcc-acis.org/ACISWSdoc.html","ACIS source documentation","ACIS source documentation ↗")+'</p>'
    +'<p>'+officialSourceLink("https://www.weather.gov/lsx/climate","NWS LSX climate and area records","NWS LSX climate &amp; area records ↗")+'</p>';
  var signature=JSON.stringify([locSeq,stationText,sourceHtml,markup,details,rows.length]);
  if(!force&&renderForecastRecords.signature===signature) return;
  renderForecastRecords.signature=signature;
  station.textContent=stationText;
  if(body.innerHTML!==sourceHtml) body.innerHTML=sourceHtml;
  rows.forEach(function(row,index){
    if(!markup[index]) return;
    var line=row.querySelector('.record-inline'),detail=row.querySelector('.record-detail');
    if(!line){line=document.createElement('div');line.className='record-inline';(row.querySelector('.nbm-inline')||row.querySelector('.day')).after(line);}
    if(line.innerHTML!==markup[index]) line.innerHTML=markup[index];
    if(!detail){detail=document.createElement('div');detail.className='record-detail';row.querySelector('.day-detail').appendChild(detail);}
    if(detail.innerHTML!==details[index]) detail.innerHTML=details[index];
  });
}
