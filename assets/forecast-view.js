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
  // month spelled out instead, since "8 slash 1" is noise. Shown only where the column
  // can hold it — fitDayDates() measures after paint; see the .dnd rule for why no
  // media query can make that call.
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
}
