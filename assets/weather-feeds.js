/* Feed registry, request adapters and loaders. Renderers and state live in dashboard.js. */
/* ============ CONFIG ============ */
/* Two decimals on purpose — this ships in a public file, and four put the default inside a
   ~10 m box around one address. Nothing downstream reads finer: /points snaps to a ~2.5 km
   forecast grid, the zone and county come from point-in-polygon against boundaries that are
   miles across, `station` is pinned to KSUS explicitly rather than found by distance, and
   climStation() rounds to one decimal before it searches. Don't restore precision here to
   "fix" a wrong forecast — at this granularity the grid cell is the same one. */
var DEFAULT_LOC={name:"Lake St. Louis, MO", lat:38.80, lon:-90.79, station:"KSUS",precision:"representative"};

var RIVERS = [
  {name:"Mississippi at St. Louis",  id:"EADM7"},
  {name:"Missouri at St. Charles",   id:"SCLM7"},
  {name:"Mississippi at Alton",      id:"ALNI2"},
  {name:"Meramec at Eureka",         id:"ERKM7"},
  {name:"Missouri at Hermann",       id:"HRNM7"},
  {name:"Illinois at Hardin",        id:"05587060"}
];

var API = "https://api.weather.gov";

var HEADERS = {"Accept":"application/geo+json"};

var LD = {"Accept":"application/ld+json"};

var current = DEFAULT_LOC;

/* A successful HTTP request is not a successful weather check. Loaders mark these only after
   validating their own payloads. Source timestamps and successful-check times stay separate. */
var FEEDS={
  alerts:{label:"Alerts",card:"alertsCard",load:"loadAlerts",every:60000,age:2*60000,local:true,reset:{alerts:"Checking alerts…"}},
  current:{label:"Observation",card:"currentCard",load:"loadCurrent",every:10*60000,age:20*60000,local:true,reset:{current:"Loading conditions…",ccCtx:""}},
  daily:{label:"Daily forecast",card:"forecastCard",load:"loadForecast",every:30*60000,age:60*60000,local:true,reset:{daily:"Loading forecast…"},snapshot:[{id:"daily",ttl:6*3600000}]},
  hourly:{label:"Hourly forecast",card:"h24Card",owner:"daily",age:60*60000,local:true,reset:{hourly24:"Loading hourly…",h24loc:""},snapshot:[{id:"hourly24",ttl:3*3600000},{id:"h24loc",ttl:3*3600000}]},
  grid:{label:"Amounts / gusts",card:"h24Card",load:"loadForecastGrid",every:30*60000,age:60*60000,local:true,reset:{precipEvents:"Loading precipitation amounts…"}},
  aqi:{label:"Air quality",card:"currentCard",load:"loadAqi",every:20*60000,age:40*60000,local:true,reset:{aqi:"",aqiMini:""}},
  uv:{label:"UV",card:"currentCard",load:"loadUv",every:60*60000,age:120*60000,local:true,reset:{ccUv:""}},
  risk:{label:"Risk outlooks",card:"riskCard",load:"loadSpc",every:30*60000,age:60*60000,local:true,reset:{spc:"Loading outlook…",spcThreats:"Loading tornado, wind & hail outlooks…",spcLoc:""}},
  mcd:{label:"Storm discussions",card:"riskCard",load:"loadMcd",every:5*60000,age:10*60000,local:true,failure:"retain-until-expiry",reset:{mcd:""}},
  cpc:{label:"Week-ahead outlooks",card:"cpcCard",load:"loadCpc",every:60*60000,age:120*60000,local:true,reset:{cpc:"Loading outlooks…"},snapshot:[{id:"cpc",ttl:24*3600000}]},
  hazards:{label:"Hazards outlook",card:"hazardsCard",load:"loadHazards",every:60*60000,age:120*60000,local:true,reset:{hazards:"Loading hazards…"},snapshot:[{id:"hazards",ttl:24*3600000}]},
  drought:{label:"Drought",card:"droughtCard",load:"loadDrought",every:6*3600000,age:12*3600000,local:true,reset:{drNow:"Loading…",drMonth:"Loading…",drSeason:"Loading…"},snapshot:[{id:"drNow",ttl:48*3600000},{id:"drMonth",ttl:48*3600000},{id:"drSeason",ttl:48*3600000}]},
  rivers:{label:"River gauges",card:"riversCard",load:"loadRivers",every:15*60000,age:30*60000,snapshot:[{id:"rivers",ttl:3*3600000}]},
  afd:{label:"NWS discussion",card:"afdCard",load:"loadAFD",every:30*60000,age:60*60000,snapshot:[{id:"afd",ttl:6*3600000}]},
  climate:{label:"Climate",card:"climateCard",load:"loadClimate",every:6*3600000,age:12*3600000,local:true,reset:{cnToday:"",cnGrid:"Loading departures…",cnStation:"…",cnSrc:""},snapshot:[{id:"cnToday",ttl:12*3600000},{id:"cnGrid",ttl:12*3600000},{id:"cnStation",ttl:12*3600000}]},
  context:{label:"Records",card:"climateCard",load:"loadClimateContext",every:6*3600000,age:12*3600000,local:true,reset:{cnCtx:""},snapshot:[{id:"cnCtx",ttl:12*3600000}]},
  stations:{label:"Station plot",card:"obsCard",load:"loadStationPlot",every:12*60000,age:24*60000},
  qpf:{load:"loadQpf",every:60*60000,local:true,tracked:false,failure:"loader-owned",reset:{qpf7:""}},
  radar:{load:"refreshRadarLayer",every:4*60000,tracked:false,failure:"loader-owned"},
  satellite:{load:"refreshSatLayer",every:10*60000,tracked:false,failure:"loader-owned"},
  snapshot:{load:"saveSnapshotIdle",every:5*60000,tracked:false,manual:false,failure:"best-effort"}
};

var feedChecks={}, savedParts={}, lastAttempt=0;

/* ===== /points, fetched once per place =====
   One response carries everything four different callers used to ask for separately: the forecast
   and hourly URLs, the county/forecast/fire zone ids, and the observation-station list. Memoised on
   the rounded coordinate — the whole payload is stable metadata about a grid cell, not weather —
   so a location revisited later reuses it instead of paying for another round trip. */
var _pointsCache={};

Object.keys(FEEDS).forEach(function(k){ FEEDS[k].failure=FEEDS[k].failure||"unavailable"; if(FEEDS[k].tracked!==false) feedChecks[k]={status:"loading",successAt:0,issuedAt:0,saved:false}; });

function requestWeather(url,options,signal,asText){
  var ctl=new AbortController(), timedOut=false;
  function abort(){ ctl.abort(); }
  if(signal){ if(signal.aborted) abort(); else signal.addEventListener("abort",abort,{once:true}); }
  var timer=setTimeout(function(){ timedOut=true; ctl.abort(); },20000);
  return fetch(url,Object.assign({},options,{signal:ctl.signal})).then(function(r){
    if(!r.ok) throw new Error("Weather service returned "+r.status);
    return asText?r.text():r.json();
  }).catch(function(e){
    if(timedOut){ var err=new Error("Weather request timed out"); err.name="TimeoutError"; throw err; }
    throw e;
  }).finally(function(){ clearTimeout(timer); if(signal) signal.removeEventListener("abort",abort); });
}

function requestJSON(url,options,signal){ return requestWeather(url,options,signal,false); }
function getText(url){ return requestWeather(url,{},null,true); }

function getJSON(url, headers, signal){
  return requestJSON(url,{headers:headers||{}},signal);
}

function isAbort(e){ return !!e && e.name==="AbortError"; }

function pointsFor(lat,lon){
  var key=(+lat).toFixed(4)+","+(+lon).toFixed(4);
  if(_pointsCache[key]) return _pointsCache[key];
  var p=getJSON(API+"/points/"+key,HEADERS,locSignal()).catch(function(e){
    delete _pointsCache[key];   // a transient failure must not poison the session — retry next cycle
    throw e;
  });
  _pointsCache[key]=p;
  return p;
}

function loadForecastGrid(){
  var fresh=locGuard();
  return pointsFor(current.lat,current.lon).then(function(pt){
    if(!fresh()) return null;
    var url=pt.properties.forecastGridData; if(!url) throw new Error("No forecast grid");
    return getJSON(url,HEADERS,locSignal());
  }).then(function(d){
    if(!fresh()) return;
    if(!d||!d.properties) throw new Error("Invalid forecast grid");
    var gusts=gridSeries(d.properties.windGust,"wind"), amounts=gridSeries(d.properties.quantitativePrecipitation,"amount");
    if(!gusts.some(function(v){return v.value!=null;})&&!amounts.some(function(v){return v.value!=null;})) throw new Error("Grid measurements unavailable");
    var complete=precipEventSummary(d.properties,Date.now(),72).complete&&gusts.length>0;
    feedUpdate("grid",complete?"ready":"partial",d.properties.updateTime);
    forecastGrid={status:"ready",properties:d.properties,gusts:gusts};
    renderPrecipEvents(); renderHourly24();
  }).catch(function(){
    if(!fresh()) return;
    feedUpdate("grid","unavailable");
    forecastGrid={status:"unavailable",properties:null,gusts:[]};
    renderPrecipEvents(); renderHourly24();
  });
}

function loadForecast(){
  var fresh=locGuard();
  var daily=document.getElementById("daily");
  function failDaily(){
    feedUpdate("daily","unavailable");
    smart.days=[]; smart.weekDays=[]; loadForecast._paint=null;
    climate.fcHi=null; climate.fcLo=null; climate.fcHiLabel="";
    climate.fcHiDate=null; climate.fcLoDate=null;
    daily.innerHTML='<div class="empty">Forecast unavailable. <a href="https://forecast.weather.gov/MapClick.php?lat='+current.lat+'&lon='+current.lon+'" target="_blank" rel="noopener">Open NWS forecast ↗</a></div>';
    if(typeof NbmRange!=="undefined") NbmRange.forecast([]);
    renderHeroToday(); renderVsNormal(); renderContext();
  }
  return pointsFor(current.lat,current.lon).then(function(pt){
    if(!fresh()) return;
    var fUrl=pt.properties.forecast, hUrl=pt.properties.forecastHourly;
    // Daily and hourly failures are independent; either healthy response can still render.
    return Promise.all([getJSON(fUrl,HEADERS,locSignal()).catch(function(){return null;}), getJSON(hUrl,HEADERS,locSignal()).catch(function(){return null;})]).then(function(res){
      if(!fresh()) return;   // user moved while this was in flight
      var f=validatedForecast(res[0],Date.now()), h=validatedForecast(res[1],Date.now());
      feedUpdate("hourly",h?"ready":"unavailable",h&&(h.properties.updateTime||h.properties.updated||h.properties.generatedAt));
      if(!f){
        failDaily();
      }else{
        feedUpdate("daily","ready",f.properties.updateTime||f.properties.updated||f.properties.generatedAt);
        try{renderDailyForecast(f,h);renderContext();}catch(e){failDaily();}
      }
      if(h){ // hourly strip only when the hourly feed succeeded
        var hrs=forecastWindowHours(h.properties.periods,24,Date.now());
        smart.hourly=hrs;
        smart.hourlyAll=h.properties.periods;
        renderHourly24(h.properties.periods);
        var hl=document.getElementById("h24loc"); if(hl) hl.textContent=current.name.replace(" (home)","");
      }else{
        smart.hourly=[]; smart.hourlyAll=[]; renderHourly24._hrs=null;
        clearHourlyForecast();
      }
      if(typeof renderTheCall==="function") renderTheCall();
    });
  }).catch(function(){
    if(!fresh()) return;   // a superseded request must not paint an error over the new place
    failDaily(); feedUpdate("hourly","unavailable");
    smart.hourly=[]; smart.hourlyAll=[]; renderHourly24._hrs=null;
    clearHourlyForecast();
    if(typeof renderTheCall==="function") renderTheCall();
  });
}

function loadCurrent(){
  var fresh=locGuard();
  var el=document.getElementById("current"), stEl=document.getElementById("ccStation");
  /* A searched/geolocated place starts without a station. Discovery belongs in this loader so a
     transient failure is retried by the ordinary 10-minute schedule; calling loadCurrent() with a
     null id instead permanently turned every retry into /stations/null/observations/latest. */
  if(!current.station){
    if(el) el.innerHTML='<div class="loading">Finding nearest station\u2026</div>';
    return stationFor(current.lat,current.lon).then(function(st){
      if(!fresh()) return;
      if(!st) throw new Error("no observation station");
      current.station=st;
      saveLoc(current);   // preserve the resolved station for the next visit
      return loadCurrent();
    }).catch(function(e){
      if(isAbort(e)||!fresh()) return;
      feedUpdate("current","unavailable");
      if(stEl) stEl.textContent="\u2014";
      if(el) el.innerHTML='<div class="empty">Couldn\'t find a nearby reporting station. This will retry automatically.</div>';
    });
  }
  return currentObservation().then(function(result){
    if(!fresh()) return;   // user moved while this was in flight
    if(!result.observation){
      feedUpdate("current","unavailable");
      stEl.textContent=result.station||"—";
      heroNow.temp=null;
      el.innerHTML='<div class="empty" role="status"><b>Current observation unavailable.</b> '
        +(result.lastTimestamp&&isFinite(Date.parse(result.lastTimestamp))?'Last report from '+esc(result.station)+' was '+esc(timeAgo(result.lastTimestamp))+'. ':'')
        +'Nearby stations will be checked again on refresh.</div>';
      return;
    }
    if(result.station!==current.station){ current.station=result.station; saveLoc(current); }
    var o=result.observation;
    feedUpdate("current","ready",o.properties.timestamp);
    var p=o.properties, c2f=function(c){return c==null?null:Math.round(c*9/5+32);};
    var temp=c2f(p.temperature&&p.temperature.value), dew=c2f(p.dewpoint&&p.dewpoint.value);
    var rh=(p.relativeHumidity&&p.relativeHumidity.value!=null)?Math.round(p.relativeHumidity.value):null;
    var windMph=(p.windSpeed&&p.windSpeed.value!=null)?Math.round(p.windSpeed.value*0.621371):null;
    var windDir=degToCompass(p.windDirection&&p.windDirection.value);
    var gust=(p.windGust&&p.windGust.value!=null)?Math.round(p.windGust.value*0.621371):null;
    var press=(p.barometricPressure&&p.barometricPressure.value!=null)?(p.barometricPressure.value/3386.39).toFixed(2):null;
    var vis=(p.visibility&&p.visibility.value!=null)?Math.round(p.visibility.value/1609.34):null;
    var hiObs=c2f(p.heatIndex&&p.heatIndex.value), wcObs=c2f(p.windChill&&p.windChill.value);
    var feels=(hiObs!=null)?hiObs:((wcObs!=null)?wcObs:feelsLikeF(temp,rh,windMph));
    var desc=p.textDescription||"—", now=new Date();
    // Real sunrise/sunset for the icon's day/night variant (polar-edge fallback: 7am–7pm)
    var st=sunTimes(current.lat,current.lon,now);
    var day=(st.rise&&st.set)?(now>=st.rise&&now<=st.set):(weatherParts(now).hour>=7&&weatherParts(now).hour<19);
    // The code stays — the audience that reads this page likes it — but it stops being the only
    // thing said. A station we have no name for gets no title rather than an invented one.
    stEl.textContent=current.station;
    stEl.title=stnName(current.station)
      ? stnName(current.station)+" — the weather station these readings come from"
      : "The weather station these readings come from";
    stEl.classList.add("has-hint");
    document.body.setAttribute("data-wx", wxGroup(desc,day));
    heroNow.temp=temp;   // where "now" sits inside today's range, once the 7-day has landed
    el.innerHTML='<div class="cc-main"><div class="cc-icon">'+wxImg(desc,day,64)+'</div><div>'
      +'<div class="cc-temp">'+(temp!=null?temp+"°":"—")+'</div><div class="cc-desc">'+esc(desc)+'</div>'
      +(feels!=null&&temp!=null?'<div class="cc-feels'+(feels-temp>=3?" is-hot":(temp-feels>=3?" is-cold":""))+'">Feels like '+feels+'°</div>':'')
      +'</div></div>'
      +'<div class="cc-today" id="ccToday"></div>'
      +'<div class="cc-grid">'
      +'<div class="cc-item"><div class="k">Dew Point</div><div class="v">'+(dew!=null?dew+"°":ccGap("dew point"))+'</div></div>'
      +'<div class="cc-item"><div class="k">Humidity</div><div class="v">'+(rh!=null?rh+"%":ccGap("humidity"))+'</div></div>'
      +'<div class="cc-item"><div class="k">Wind</div><div class="v">'
        +(windMph!=null?windDir+" "+windMph+'<span class="cc-unit"> mph</span>':ccGap("wind"))+'</div></div>'
      // "None" rather than a dash: see ccNone above — an absent gust is a reading, not a gap.
      +'<div class="cc-item"><div class="k">Gusts</div><div class="v">'
        +(gust!=null?gust+'<span class="cc-unit"> mph</span>'
                    :ccNone("None","No gust reported — a station files one only when the peak run "
                                  +"exceeds the steady wind by enough to be worth noting"))+'</div></div>'
      +'<div class="cc-item"><div class="k">Pressure</div><div class="v">'+(press!=null?press+'"':ccGap("pressure"))+'</div></div>'
      +'<div class="cc-item"><div class="k">Visibility</div><div class="v">'+(vis!=null?vis+'<span class="cc-unit"> mi</span>':ccGap("visibility"))+'</div></div>'
      +'</div>'
      +'<div class="cc-expo"><div class="cc-uv" id="ccUv"></div><div class="aqi-mini" id="aqiMini"></div></div>'
      +'<div class="cc-ctx" id="ccCtx"></div>'
      // Every source in one line, set to be read second. AirNow is a constant href, so it lives in
      // the markup rather than being rebuilt by renderAqiMini — which means it survives an AQI
      // outage, exactly when someone would want to go look the number up themselves.
      // Naming Open-Meteo is not decoration: the exposure pair now wears the same chrome as the
      // metric tiles, and those ARE the station's. Without this the line above would read as a
      // claim that KSUS measures UV and PM2.5.
      +'<div class="stn">Observed '+timeAgo(p.timestamp)+' · <span class="has-hint" title="'
      +esc(stnName(current.station)||"The weather station these readings come from")+'">'
      +esc(current.station)+'</span>'
      +' · UV &amp; air Open-Meteo'
      +'<span id="ccRecSrc"></span>'
      +' · <a href="https://gispub.epa.gov/airnow/" target="_blank" rel="noopener">AirNow ↗</a></div>';
    renderHeroToday();    // today's range + sun times, once the 7-day has landed
    renderUvNow();        // UV, once Open-Meteo has answered
    renderCurrentCtx();   // normals + today's records, once climate context has landed
    if(typeof renderAqiMini==="function") renderAqiMini();   // re-fill the AQI line after the re-render
  }).catch(function(){
    if(!fresh()) return;   // a superseded request must not paint an error over the new place
    feedUpdate("current","unavailable");
    stEl.textContent="—";
    el.innerHTML='<div class="empty">No current obs from '+current.station+'. Station may be offline.</div>';
  });
}

var lastAlertData=null, alertsRetained=false, retainedAlertKey="", alertRequestSeq=0;
function liveAlertFeatures(features,now){
  return (features||[]).filter(function(f){
    var p=f.properties||{}, end=alertEvidenceEnd(p);
    return isFinite(end)&&end>now;
  });
}
function alertUpdateNotice(){
  var el=document.getElementById("alertUpdateNote"); if(!el) return;
  el.hidden=!alertsRetained;
  var retained=liveAlertFeatures(lastAlertData&&lastAlertData.features,Date.now()).length>0;
  el.textContent=alertsRetained?"Alert updates unavailable. "+(retained?"Showing unexpired alerts last verified "
    +(feedChecks.alerts.successAt?weatherTime(feedChecks.alerts.successAt,{weekday:"short",hour:"numeric",minute:"2-digit"})+" CT":"earlier")+". ":"No unexpired previously verified alerts remain. ")
    +"New warnings or cancellations cannot be verified. Check weather.gov/lsx.":"";
  var mapNote=document.getElementById("radarAlertNote");
  if(mapNote){mapNote.hidden=el.hidden;mapNote.textContent=el.textContent;}
}
function renderAlertsUnavailable(){
  callLocalAlert=null; callAlertGroups=[];
  var card=document.getElementById("alertsCard"); card.classList.remove("calm");
  paintAlerts(document.getElementById("alerts"),'<div class="empty">Couldn\'t load alerts. <a href="https://www.weather.gov/lsx/" target="_blank" rel="noopener">Check weather.gov/lsx ↗</a></div>');
  loadWarnPolygons([]); watchFeats=[]; watchKey=""; drawWatchPolygons();
  renderTheCall();
}
function renderRetainedAlerts(){
  var feats=liveAlertFeatures(lastAlertData&&lastAlertData.features,Date.now()).map(function(f){
    return Object.assign({},f,{properties:Object.assign({},f.properties,{ends:new Date(alertEvidenceEnd(f.properties)).toISOString()})});
  });
  var key=JSON.stringify(feats.map(function(f){return f.id||f.properties.id||f.properties.event;}));
  alertUpdateNotice();
  if(key===retainedAlertKey) return;
  retainedAlertKey=key;
  watchFeats=watchFeats.filter(function(f){var p=f.properties||{};return Date.parse(p.ends||p.expiration||"")>Date.now();});
  drawWatchPolygons();
  if(feats.length) renderAlertsData({features:feats});
  else renderAlertsUnavailable();
}
function loadAlerts(){
  var fresh=locGuard(), seq=++alertRequestSeq;
  return Promise.all([getJSON(API+"/alerts/active?area=MO,IL",HEADERS), ensureUserZones()]).then(function(res){
    if(!fresh()||seq!==alertRequestSeq) return;
    var data=res[0];
    if(!data||!Array.isArray(data.features)||!data.features.every(function(f){return f&&f.properties&&typeof f.properties.event==="string";})) throw new Error("Invalid alerts");
    lastAlertData={features:liveAlertFeatures(data.features,Date.now())}; alertsRetained=false; retainedAlertKey="";
    alertUpdateNotice();
    feedUpdate("alerts",zonesResolved()?"ready":"partial",data.updated);
    renderAlertsData(lastAlertData);
  }).catch(function(){
    if(!fresh()||seq!==alertRequestSeq) return;
    alertsRetained=true; retainedAlertKey="";
    feedUpdate("alerts","unavailable");
    renderRetainedAlerts();
  });
}
function renderAlertsData(data){
  var el=document.getElementById("alerts"), card=document.getElementById("alertsCard");
  loadWarnPolygons(data.features||[]);
  if(!alertsRetained) loadWatchPolygons(data.features||[]);
    function isLSX(f){
      var p=f.properties||{};
      var aw=(p.parameters&&p.parameters.AWIPSidentifier&&p.parameters.AWIPSidentifier[0])||"";
      if(String(aw).toUpperCase().indexOf("LSX")>=0) return true;   // product id ends in office code
      var s=(p.senderName||"").toLowerCase().replace(/\./g,"");
      return s.indexOf("st louis")>=0||s.indexOf("saint louis")>=0; // punctuation/spelling tolerant
    }
    var feats=data.features.filter(isLSX);
    feats.sort(function(a,b){
      var ra=ALERT_SEV_RANK[a.properties.severity],rb=ALERT_SEV_RANK[b.properties.severity];
      return (ra==null?5:ra)-(rb==null?5:rb);
    });
    /* ---- the list is for WHERE YOU ARE ----
       The office issues for a 40-plus-county area; the reader lives at one point in it. Alerts that
       cover this location lead the page as full banners; the rest sit below in a compact list —
       present, readable, and plainly not about here. Coverage decides that and nothing else does;
       severity sets how loud a card is, never whether it is about you. See alertScope(), which
       owns the rule and is asserted in tools/logic-tests.js.
       One exception, and it is not about severity: zones unresolved (ensureUserZones failed) means
       coverage is UNKNOWABLE, and unknowable must fail open. Splitting on a failed lookup would let
       a network hiccup quietly file a warning that DOES cover you under "elsewhere", which is worse
       than one flat list. */
    var localMode=zonesResolved();
    var place=(current.name||"").replace(" (home)","");
    var scope=document.getElementById("alertsScope");
    if(scope) scope.textContent=localMode?place:"LSX";
    if(typeof tickCountdowns==="function") setTimeout(tickCountdowns,0);   // fill the new countdowns immediately
    if(feats.length===0&&alertsRetained){ renderAlertsUnavailable(); return; }
    if(feats.length===0){
      /* The scope half earns its place: "no active alerts" without it invites the reader's next
         question, which is "no alerts WHERE — my street, or the region?". This page treats that
         distinction as real enough to give "elsewhere in the St. Louis area" its own list below
         the local banners, so the all-clear should answer it too. feats is filtered by isLSX, so an
         empty list means nothing is out anywhere the office covers — the strong claim, and the
         reassuring one.
         It used to say "NWS St. Louis county warning area." — the office's own term for that
         region, and internal jargon (CWA) outside it: a bare noun phrase, hanging off the end of
         a finished sentence, in which "county", "warning" and "area" each look like they might be
         the noun. The region has a plain-English name that this page already uses about itself,
         in the masthead: eastern Missouri and southwest Illinois. Same two lines on a phone,
         measured — the jargon was not buying brevity either.
         The words live in one span rather than sitting directly in the .calmrow flex, so the
         sentence WRAPS instead of being dealt into columns. As two flex items the claim and its
         scope were laid out side by side, which reads as a label beside a heading — fine when the
         second half was a bare noun phrase, wrong once it became the tail of a sentence, since
         the break landed mid-clause across the row's 10px gap. */
      card.classList.add("calm");
      paintAlerts(el,'<div class="calmrow"><span class="cdot"></span><span>No active watches, warnings or advisories <span class="cmut">anywhere in eastern Missouri or southwest Illinois.</span></span></div>');
      callLocalAlert=null; callAlertGroups=[];
      if(typeof renderTheCall==="function") renderTheCall();
      return;
    }
    card.classList.remove("calm");
    /* Preserve which alerts the user had expanded across the 60s refresh. Keyed by event AND scope,
       because one event name can now own two cards — the local one and the one elsewhere — and a
       bare event key would open and close them as a pair. */
    var openIds={};
    el.querySelectorAll(".alert.open").forEach(function(a){
      if(a.dataset.aid) openIds[a.dataset.aid+"|"+(a.dataset.scope||"")]=1;
    });

    /* ---- one card per hazard PER PLACE ----
       NWS issues the same event as separate records per zone group, so the segments have to be
       consolidated or the list reads as a dozen copies of one storm. Grouping on the event name
       alone did that too well: a Severe Thunderstorm Warning over this location and a different one
       three counties east arrived as ONE card, flagged as covering you, wearing the union of both
       county lists. The local storm was then described with geography that wasn't its own, and the
       distant one had no existence in the list at all — the exact confusion the local/elsewhere
       split exists to prevent. So the key is event + coverage: the same hazard can hold a card here
       and a card elsewhere, and neither speaks for the other.
       Only when localMode holds. With zones unresolved there is no elsewhere list to explain why
       one event produced two cards, and the degraded mode's whole promise is one flat list — so the
       split collapses back to grouping by name, exactly as it was.

       ONE coverage test per feature, and the kind it returns is kept. This used to run here to
       decide the group and then AGAIN per group to find out how strongly it matched — a second
       ray-cast over every polygon, and worse, two fields (`here` and `hit`) that agreed only
       because the second pass re-derived what the first had already decided. Nothing stated that
       invariant and nothing checked it, so a card's "you're inside this area" badge rested on a
       loop thirty lines away continuing to duplicate work. One field now; the group's coverage is
       a function of the kinds its own segments returned. */
    var groups={};
    feats.forEach(function(f){
      var ev=f.properties.event||"Alert", hit=alertCoversMe(f);
      var key=ev+"\u0000"+alertScope(hit,localMode);   // NUL can't appear in an event name
      var grp=groups[key]||(groups[key]={ev:ev,segs:[],hits:[]});
      grp.segs.push(f); grp.hits.push(hit);
    });
    var glist=Object.keys(groups).map(function(key){
      var grp=groups[key], ev=grp.ev, segs=grp.segs;
      var best=segs[0];
      segs.forEach(function(f){
        var rb=ALERT_SEV_RANK[f.properties.severity], ra=ALERT_SEV_RANK[best.properties.severity];
        if((rb==null?5:rb)<(ra==null?5:ra)) best=f;
      });
      var latest=0, earliest=0, counties=[];
      segs.forEach(function(f){
        var p2=f.properties, e=alertEvidenceEnd(p2);
        var s=Date.parse(p2.onset||p2.effective||p2.sent||"")||0;   // when the window actually opened
        if(e>latest) latest=e;
        if(s&&(!earliest||s<earliest)) earliest=s;
        (p2.areaDesc||"").split(";").forEach(function(c){ c=c.trim(); if(c&&counties.indexOf(c)<0) counties.push(c); });
      });
      /* WHICH kind of match, keeping the strongest evidence — the badge states exactly what it can
         support, and no more. No coverage test runs here: the kinds came back with the segments at
         grouping time, so this is a reduce over what is already known rather than a second opinion
         that could differ from the first. `scope` falls out of the same value, which is why a card
         can no longer be filed in one list while its badge claims the other. */
      var hit=strongestHit(grp.hits);
      return {ev:ev,scope:alertScope(hit,localMode),segs:segs,best:best,sev:best.properties.severity,
              lv:alertLevel(best.properties),
              latest:latest,earliest:earliest,counties:counties,hit:hit,
              mapped:segs.some(isMappedAlert)||watchOnRadar(ev)};   // only offer "show on radar" if it IS on the radar
    });
    glist.sort(cardCmp);

    /* ---- one card per hazard, not one per NWS product ----
       Graduated tiers of the same hazard arrive as separate products only because different zones
       get different tiers, so a heat event renders as an Extreme Heat Warning card and a Heat
       Advisory card that half-repeat each other — two cards reading as two hazards. Fold them:
       the top-tier product hosts the card (its name, level and colour lead) and the others become
       phases on it. Folding is per-family opt-in (FAMILY_CFG.merge), and a take-cover product or a
       statement never folds in either direction — a Tornado Warning must not be a line item
       inside anything, and a Special Weather Statement is not a tier of anything. The list is
       already sorted, so the first product seen of a family IS its highest tier.
       Keyed by family AND coverage, for the reason the groups above are: an Extreme Heat Warning
       over this location and a Heat Advisory two counties away are not one hazard the reader can
       act on as a unit, and folding them would hand the local card the distant one's counties. */
    var byFam={}, folded=[];
    glist.forEach(function(g){
      var fam=eventFamily(g.ev), cfg=FAMILY_CFG[fam];
      if(!cfg||!cfg.merge||isTakeCover(g.lv)||g.lv.k==="statement"){ folded.push(g); return; }
      var famKey=fam+"|"+g.scope;
      var host=byFam[famKey];
      if(!host){
        /* The host is its own first phase — but the fold below mutates the host's counties, segs
           and window into the UNION, so the phase row snapshots the host's own facts first.
           (counties is sliced because the fold appends to it in place; segs survives because
           concat replaces the reference rather than growing it.) */
        g.phases=[{ev:g.ev,lv:g.lv,best:g.best,earliest:g.earliest,latest:g.latest,
                   counties:g.counties.slice(),segs:g.segs,hit:g.hit}];
        byFam[famKey]=g; folded.push(g); return;
      }
      host.phases.push(g);
      host.segs=host.segs.concat(g.segs);
      if(g.latest>host.latest) host.latest=g.latest;
      if(g.earliest&&(!host.earliest||g.earliest<host.earliest)) host.earliest=g.earliest;
      g.counties.forEach(function(c){ if(host.counties.indexOf(c)<0) host.counties.push(c); });
      /* The host's claim can only strengthen, never change list: the fold is keyed by scope, so
         host and phase are already on the same side of the split, and a `here` host absorbing a
         `here` phase stays `here` however the evidence upgrades. host.scope needs no update. */
      host.hit=strongestHit([host.hit,g.hit]);
      host.mapped=host.mapped||g.mapped;
    });
    /* No re-sort: folding only ever REMOVES entries, so what survives is still in sorted order, and
       a fold can no longer change a sort key. It used to — absorbing a phase could add "covers you"
       — but phases now share their host's coverage by construction, so there is nothing left to
       discover here. */
    glist=folded;

    /* The alert banners remain the authoritative safety layer. Bottom Line only needs the
       strongest product that actually covers this location so it can turn that hazard into a
       plan instead of repeating the product title. In degraded flat mode every LSX product is
       intentionally treated as local, matching the fail-open list above. */
    callAlertGroups=glist;
    callLocalAlert=bottomLineLocalAlert(callAlertGroups);
    if(typeof renderTheCall==="function") renderTheCall();

    /* Which cards are ELSEWHERE. The rule is alertScope(), up beside alertCoversMe() and asserted
       in tools/logic-tests.js; what is left here is the tally the heading and the all-clear row
       read. There is no `away` field any more — it was a third spelling of one fact, and a spare
       field is exactly where an exception hides: the one that used to keep an emergency in the
       local section from anywhere lived on this line, invisible to any test. */
    var mineN=0, awayN=0;
    glist.forEach(function(g){ if(g.scope==="away") awayN++; else mineN++; });

    /* No summary chips: each banner names its own event in its own colour, which is everything
       the chips used to say. */

    var cardHTMLs=glist.map(function(g,gi){
      var fam=eventFamily(g.ev), fcfg=FAMILY_CFG[fam]||FAMILY_CFG.convective;
      var bp=(g.best&&g.best.properties)||{};
      var mg=!!(g.phases&&g.phases.length>1);   // a folded card holding several products
      var endStr=g.latest?new Date(g.latest).toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric",minute:"2-digit"}):"\u2014";
      var startStr=g.earliest?new Date(g.earliest).toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric",minute:"2-digit"}):"";
      // Elapsed-vs-remaining bar for the alert window; a window that hasn't opened yet is "pending".
      // Only whether the window is a measurable span is decided here — how far along it is changes
      // by the second, so the fill is left to tickCountdowns and kept out of the markup.
      var prog=!!(g.earliest&&g.latest&&g.latest>g.earliest), pending=!!(g.earliest&&Date.now()<g.earliest);
      /* ---- a banner, not a card ----
         Two lines: the event with its window ("Extreme Heat Warning — until Tue 7:00 PM") and the
         first sentence of the instruction. The whole banner is one <button>; everything else —
         the time bar, the phase list, What/When/Impacts, the full instruction, the ledger, the
         counties, the radar jump — expands in place under it. This is the third size this section
         has been (934px card → 141px collapsed card → this), and the direction has been the same
         each time: the resting state earns less and less of the page, and nothing is deleted,
         only demoted a tap. */
      /* ---- the phase list of a folded card ----
         The bar above spans the whole hazard, earliest onset to last end; these rows say which
         product owns which part of it. The tier dot restates each phase's own level because the
         card wears only the LEAD's colour — without it a Heat Advisory row under a warning-tinted
         card borrows severity it doesn't have. There is no per-phase pin: it existed for the case
         where a card's products disagreed about covering you, and grouping by coverage means they
         no longer can — every phase of a card shares the card's answer. */
      var phasesHTML="";
      if(mg){
        phasesHTML='<div class="a2-phases">'+g.phases.map(function(ph){
          var pPend=!!(ph.earliest&&Date.now()<ph.earliest);
          var pe=ph.latest?new Date(ph.latest).toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric",minute:"2-digit"}):"—";
          var ps=ph.earliest?new Date(ph.earliest).toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric",minute:"2-digit"}):"";
          return '<div class="a2-ph ph-'+ph.lv.k+'"><span class="phd"></span><span class="phn">'+esc(ph.ev)+'</span>'
            +'<span class="pht">'+esc(pPend&&ps?ps+" – "+pe:"until "+pe)+'</span></div>';
        }).join("")+'</div>';
      }
      var bullets=parseAlertBullets(bp.description);
      var detail="";
      if(bullets.length) detail+=alertKV(bullets);
      else if(bp.description){
        detail+=alertParas(bp.description).map(function(p){return '<p>'+esc(p)+'</p>';}).join("");
      }
      /* A folded phase whose hazard statement the lead's text doesn't already carry. Usually it
         does \u2014 graduated products ship one description naming every tier \u2014 and "already carries"
         is tested by NAME, not string equality, because segments differ trivially ("up to 110"
         here, "up to 111" one zone group over). Only when the lead never mentions the phase at all
         (independently issued products) does the phase's own What line go in the drawer. The fold
         must never be able to swallow a hazard statement. */
      if(mg) g.phases.slice(1).forEach(function(ph){
        if(String(bp.description||"").indexOf(ph.ev)>=0) return;
        var pd=(ph.best&&ph.best.properties&&ph.best.properties.description)||"";
        var pw=parseAlertBullets(pd).filter(function(b){ return b.k.toLowerCase()==="what"; })[0];
        var v=pw?pw.v:(alertParas(pd)[0]||"");
        if(v) detail+='<p class="a2-phwhat"><b>'+esc(ph.ev)+':</b> '+esc(v)+'</p>';
      });
      if(bp.instruction) detail+=alertDo(bp.instruction);
      if(mg){
        // the per-product ledger: whose counties, until when \u2014 the facts the fold took off the top row
        detail+='<div class="a2-seg">'+g.phases.map(function(ph){
          var pe=ph.latest?new Date(ph.latest).toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric",minute:"2-digit"}):"\u2014";
          return '<b>'+esc(ph.ev)+'</b> \u2014 '+ph.counties.length+(ph.counties.length===1?" county":" counties")
            +' in '+ph.segs.length+(ph.segs.length===1?" zone group":" zone groups")+', ends '+esc(pe);
        }).join("<br>")+'</div>';
      } else if(g.segs.length>1){
        detail+='<div class="a2-seg"><b>'+g.segs.length+' zone groups:</b> '+g.segs.map(function(f){
          var p2=f.properties, e=alertEvidenceEnd(p2);
          var es=e?new Date(e).toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric",minute:"2-digit"}):"\u2014";
          var ar=(p2.areaDesc||"").split(";").length;
          return esc(String(ar))+" counties until "+esc(es);
        }).join(" \u00b7 ")+'</div>';
      }
      /* ---- geography, in the drawer ----
         The county list is the last thing on the card and now lives inside Details with everything
         else. What answers "does this include me" is the badge up in .a2-top — a real
         point-in-polygon or affected-zone match — so the list itself is reference, not headline.
         Still capped at six with a "+N more": a regional heat warning runs to forty-plus, and an
         opened drawer is not a reason to hand someone all of them at once. The order is the order
         NWS issued them in; nothing in the feed carries a county centroid, so "nearest first"
         would be a guess dressed as a fact. */
      var moreN=Math.max(0,g.counties.length-AREA_CHIPS);
      var chips=g.counties.map(function(c,i){
        return '<span class="a2-chip'+(i>=AREA_CHIPS?" a2-xtra":"")+'">'+esc(c)+'</span>';
      }).join("");
      var areasHTML=g.counties.length?'<div class="a2-areas"><span class="a2-geo">'
        +(g.counties.length>1?"Counties":"County")+'</span>'+chips
        +(moreN?'<button type="button" class="a2-more" aria-label="Show '+moreN+' more '
          +(moreN>1?'counties':'county')+'">+'+moreN+' more</button>':'')+'</div>':'';
      detail+=areasHTML;          // counties are the tail of the drawer, after the prose
      /* The second half of a card's identity, written only when the split is real — see scopeAttr.
         In flat mode every card is the only one answering to its name, and an unconditional "away"
         would tell "Show on radar" to skip the very polygon the reader is standing under. */
      var aid=esc(g.ev), scope=scopeAttr(g.hit,localMode);
      /* A polygon hit is a real point-in-shape test; a zone hit only says your zone is listed.
         In the location-scoped list a card's RANK already says "this includes you", so the zone
         badge would restate the whole widget on every card — only the polygon claim still earns a
         badge, because "you're inside this area" on a storm-based warning is an escalation, not a
         restatement.
         There is no third case left in local mode. Cards up here used to be able to NOT cover you —
         the emergency exception let them — and they wore an "Elsewhere in LSX" badge to admit it,
         a card in the local section contradicting the heading over it. Coverage alone files the
         cards now, so that badge has nothing to label and the exception it covered for is gone.
         The elsewhere list is already under a heading that says elsewhere, so its cards spend the
         slot on the fact a one-line row is actually missing: WHERE, in the geography this feed
         hands us. */
      var meBadge="";
      if(g.hit&&(!localMode||g.hit==="polygon"))
        meBadge='<span class="a2-me">'+ic("pin")+esc(HIT_TEXT[g.hit]||"Includes your location")+'</span>';
      else if(g.scope==="away"&&g.counties.length)
        meBadge='<span class="a2-where" title="'+esc(g.counties.join(", "))+'">'+esc(g.counties[0])
          +(g.counties.length>1?' +'+(g.counties.length-1):'')+'</span>';
      /* The banner's own window, not the folded union: "Extreme Heat Warning — until Tue 7 PM"
         must state when the WARNING ends. If an advisory phase outlives it, the merged end would
         put a wrong time next to the warning's name; the union stays on the time bar inside. */
      var hEnd=mg?g.phases[0].latest:g.latest, hStart=mg?g.phases[0].earliest:g.earliest;
      var hPend=!!(hStart&&Date.now()<hStart);
      var hWhen=hPend?("from "+new Date(hStart).toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric",minute:"2-digit"}))
                     :(hEnd?"until "+new Date(hEnd).toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric",minute:"2-digit"}):"");
      // Second line: the ACTION, because the first line already named the hazard. Products with
      // no instruction (statements, mostly) fall back to the What text, then to the prose.
      var sub=firstSentence(bp.instruction);
      if(!sub){
        var wb=bullets.filter(function(b){ return b.k.toLowerCase()==="what"; })[0];
        sub=wb?wb.v:firstSentence(alertParas(bp.description)[0]||"");
      }
      /* The HEAD is the button, not the banner. The first attempt at a clickable card put
         role="button" on the whole card, and ARIA made every descendant presentational — the
         accessibility tree collapsed to one unnamed button with nothing inside it. This shape is
         immune by construction: the <button> contains only text (its accessible name is the
         headline), and everything interactive — "+N more", "Show on radar", the weather.gov
         link — lives in the drawer OUTSIDE it. */
      var drawerId="a2more-"+gi, wasOpen=!!openIds[aid+"|"+scope];
      return '<div class="alert lv-'+g.lv.k+(g.hit?' hits-me':'')+(wasOpen?' open':'')
        +'" data-aid="'+aid+'"'+(scope?' data-scope="'+scope+'"':'')
        /* The map resolves polygons↔cards by event name, and a folded card answers to ALL of its
           products. Two cards can now share a name — the local one and the one elsewhere — so the
           name alone no longer identifies a card; data-scope is the second half of the key, and
           both directions of the link read it. */
        +(mg?' data-evs="'+esc(g.phases.map(function(p){ return p.ev; }).join("|"))+'"':'')+'>'
        +'<button type="button" class="ab-head" aria-expanded="'+(wasOpen?'true':'false')
          +'" aria-controls="'+drawerId+'">'
          +'<span class="a2-ico">'+ic(alertIcon(g.ev,fcfg.ico))+'</span>'
          +'<span class="ab-hx">'
            +'<span class="ab-title">'+esc(g.ev)+(hWhen?' — '+esc(hWhen):'')+'</span>'
            +(sub?'<span class="ab-sub">'+esc(sub)+'</span>':'')
          +'</span>'
          +meBadge
          +'<span class="a-chev">▾</span>'
        +'</button>'
        +'<div class="alert-more" id="'+drawerId+'">'
        +(g.latest||pending?'<div class="ab-cd">'
          +(pending?'<span class="a2-cd a-cd" data-exp="'+g.earliest+'" data-pre="1"></span>'
                   :'<span class="a2-cd a-cd" data-exp="'+g.latest+'"></span>')+'</div>':'')
        +(prog?'<div class="a2-time'+(pending?' pending':'')+'"><div class="a2-prog"><i data-prog="'+g.earliest+','+g.latest+'"></i></div>'
          +'<div class="a2-times"><span>'+(pending?"begins ":"")+esc(startStr||"in effect")+'</span><span>ends '+esc(endStr)+'</span></div></div>'
          :'<div class="a2-times"><span>Through '+esc(endStr)+'</span></div>')
        +phasesHTML
        +detail
        +'<div class="a2-foot">'
          +'<a class="link" href="https://www.weather.gov/lsx/" target="_blank" rel="noopener">weather.gov/lsx \u2197</a>'
          +(g.mapped?'<button type="button" class="a2-radar">'+ic("target")+'Show on radar</button>':'')
        +'</div>'
        +'</div>'
        +'</div>';
    });
    var mineHTML="", awayHTML="";
    glist.forEach(function(g,i){ if(g.scope==="away") awayHTML+=cardHTMLs[i]; else mineHTML+=cardHTMLs[i]; });
    /* All clear HERE while the office is busy elsewhere: say so — it is the answer to the only
       question the reader came with — with the regional list right under it saying what "elsewhere"
       means. The calm VOICE is conditional, though, and it wasn't before: coverage alone files the
       cards now, so an emergency that hasn't reached this location lands in the list below, and a
       glowing green dot sitting directly on top of a red tornado rail is the page arguing with
       itself. When something down there is emergency-level the row keeps the fact and drops the
       good news — muted, no glow — and names what's nearby instead of leaving it to be scrolled to.
       (The sentence lives in one span for the reason the office-wide calm row's does: as bare flex
       items the claim and its tail get dealt into columns instead of wrapping.) */
    var awayEmerg=null;
    glist.forEach(function(g){ if(!awayEmerg&&g.scope==="away"&&isTakeCover(g.lv)) awayEmerg=g; });
    var calmHTML=(!alertsRetained&&!mineN&&awayN)?'<div class="calmrow'+(awayEmerg?' guarded':'')+'">'
      +'<span class="cdot"></span><span>No active watches, warnings or advisories for '+esc(place)+'.'
      +(awayEmerg?' <span class="cmut">'+esc(awayEmerg.ev)+' is active elsewhere in the area.</span>':'')
      +'</span></div>':'';
    /* ---- the rest of the office's area, in full view ----
       These cards used to sit behind a collapsed "N alerts elsewhere" disclosure, which answered
       "is anything out near me" with a number and made the reader tap to find out what. They are
       visible now, at one line each: level rail, event, county, window. The row IS the same .alert
       banner the local cards use — CSS collapses it and the existing head toggle opens it back to
       full detail — so there is one card renderer, not a compact one drifting away from a full one.
       The heading carries the scope so the cards don't have to: each of them would otherwise wear
       an "Elsewhere in LSX" badge saying what one eyebrow says once. */
    var elseHTML="";
    if(awayN){
      /* The space is load-bearing: the count is a separate element moved to the far end by `order`,
         and without it the heading's accessible name runs together as "...areaN". */
      elseHTML='<h3 class="a2-elsehed">Elsewhere in the St. Louis area '
        +'<span class="a2-elsen">'+awayN+'</span></h3>'
        +'<div id="alertsElse">'+awayHTML+'</div>';
    }
    paintAlerts(el,calmHTML+mineHTML+elseHTML);

}


function loadRivers(){
  var el=document.getElementById("rivers"), known=0;
  var jobs=RIVERS.map(function(r){
    var base="https://api.water.noaa.gov/nwps/v1/gauges/"+r.id;
    // the forecast series is a separate endpoint; a gauge without one (Eureka today) just loses
    // the crest clause rather than the whole row
    return Promise.all([getJSON(base), getJSON(base+"/stageflow/forecast").catch(function(){return null;})])
    .then(function(res){
      var d=res[0], fcSeries=res[1];
      var ob=(d.status&&d.status.observed)||{}, val=ob.primary, unit=ob.primaryUnit||"ft", info=catInfo(ob.floodCategory);
      if(typeof val!=="number"||!isFinite(val)||val<=-500) return riverLinkOnly(r);
      var age=riverObservationState(ob,Date.now(),r.maxAge||2*3600000);
      if(age.state!=="ready") return riverLinkOnly(r,age.time
        ?"Last report "+weatherTime(age.time,{weekday:"short",hour:"numeric",minute:"2-digit"})+" CT · stale; current level unverified"
        :"Observation time unavailable; current level unverified");
      known++;
      // Context: how much headroom is left before action stage, and which way it's heading
      var sub=["Observed "+weatherTime(age.time,{weekday:"short",hour:"numeric",minute:"2-digit"})+" CT"];
      var cats=(d.flood&&d.flood.categories)||{};
      var act=cats.action&&cats.action.stage, minor=cats.minor&&cats.minor.stage;
      var ref=(typeof act==="number"&&act>0)?{v:act,n:"action stage"}
             :((typeof minor==="number"&&minor>0)?{v:minor,n:"flood stage"}:null);
      if(ref){
        var gap=ref.v-val;
        sub.push(gap>0?(Math.round(gap*10)/10)+" ft below "+ref.n
                      :(Math.round(-gap*10)/10)+" ft over "+ref.n);
      }
      // What the river is forecast to DO — crest, keep climbing, or recede
      var issue=Date.parse(fcSeries&&fcSeries.issuedTime||"");
      var forecastFresh=isFinite(issue)&&issue>0&&issue<=Date.now()+10*60000&&Date.now()-issue<=48*3600000;
      var cr=forecastFresh?crestInfo(fcSeries,val):null;
      if(fcSeries) sub.push(forecastFresh?"Forecast issued "+weatherTime(issue,{weekday:"short",hour:"numeric",minute:"2-digit"})+" CT":"Forecast issuance unavailable or stale");
      var crestCat=null;
      if(cr){
        var st1=Math.round(cr.stage*10)/10;
        crestCat=stageCategory(cr.stage,cats);
        var word=(cr.kind==="crest")?"▲ cresting ":(cr.kind==="rising")?"▲ rising to ":"▼ falling to ";
        var join=(cr.kind==="crest")?" ":" by ";
        sub.push('<span class="r-forecast-label">'+(cr.kind==="falling"?"Forecast trend: ":"Forecast peak in window: ")+'</span><span class="'+(cr.kind==="falling"?"rdn":"rup")+'">'+word+st1+" ft"+join+esc(crestWhen(cr.when))+'</span>'
          +(crestCat?' <span class="rfcat c-'+crestCat.key+'">'+esc(crestCat.label)+'</span>':''));
      }
      return '<a class="rlink '+info.cls+'" href="https://water.noaa.gov/gauges/'+r.id+'" target="_blank" rel="noopener">'
        +'<span class="rname"><span class="rn-top">'+ic("flood")+esc(r.name)+'</span>'
          +(sub.length?'<span class="rsub">'+sub.join(" · ")+'</span>':'')
        +'</span><span class="rmeta"><span class="rval"><span class="r-now-label">Now</span>'+(Math.round(val*10)/10)+' '+unit+'</span>'
        +'<span class="rcat">'+info.label+'</span></span></a>';
    }).catch(function(){return riverLinkOnly(r);});
  });
  return Promise.all(jobs).then(function(rows){feedUpdate("rivers",known===RIVERS.length?"ready":known?"partial":"unavailable");RIVERS.forEach(function(r,i){riverRows[r.id]=rows[i];});renderRiverRows();});
}

function loadAqi(){
  var fresh=locGuard();
  var el=document.getElementById("aqi"), card=document.getElementById("aqiCard");
  var url="https://air-quality-api.open-meteo.com/v1/air-quality?latitude="+current.lat+"&longitude="+current.lon+"&current=us_aqi,pm2_5,pm10&timeformat=unixtime";
  return getJSON(url,null,locSignal()).then(function(d){
    if(!fresh()) return;   // user moved while this was in flight
    var cur=d.current||{}, aqi=cur.us_aqi, info=aqiInfo(aqi);
    if(typeof aqi!=="number"||!isFinite(aqi)||aqi<0) throw new Error("Invalid AQI");
    var observed=typeof cur.time==="number"?cur.time*1000:0;
    if(!observed||observed>Date.now()+10*60000||Date.now()-observed>2*3600000) throw new Error("AQI observation time unavailable or stale");
    feedUpdate("aqi","ready",observed);
    aqiState={val:(aqi!=null)?aqi:null, pm:(cur.pm2_5!=null)?Math.round(cur.pm2_5):null, err:false};
    // The dedicated card only appears when air quality is a story: AQI > 100 ("Unhealthy for
    // Sensitive Groups" and worse — EPA's literal "Hazardous" is 301+, far too rare a trigger).
    // data-aqibad lets a restored snapshot recover the same visibility decision.
    var bad=(aqiState.val!=null&&aqiState.val>100);
    if(card) card.classList.toggle("show",bad);
    if(el) el.innerHTML=bad
      ?'<div class="aqi-main" data-aqibad="1"><div class="aqi-chip" style="background:'+info.c+'"></div><div>'
        +'<div class="aqi-num" style="color:'+info.c+'">'+aqiState.val+'</div>'
        +'<div class="aqi-cat" style="color:'+info.c+'">'+info.t+'</div>'
        +'<div class="aqi-sub">'+info.s+(aqiState.pm!=null?' · PM2.5 '+aqiState.pm+' µg/m³':'')+'</div></div></div>'
      :"";
    renderAqiMini();
    callAqi=aqiState.val;
    if(typeof renderTheCall==="function") renderTheCall();   // AQI can add/remove a verdict pill
  }).catch(function(){
    if(!fresh()) return;   // a superseded request must not paint an error over the new place
    feedUpdate("aqi","unavailable");
    aqiState={val:null, pm:null, err:true};
    if(card) card.classList.remove("show");
    if(el) el.innerHTML="";
    renderAqiMini();
    callAqi=null;                                            // never let a stale reading keep a pill alive
    if(typeof renderTheCall==="function") renderTheCall();
  });
}

function loadSpc(){
  var fresh=locGuard();
  var el=document.getElementById("spc");
  document.getElementById("spcLoc").textContent="For "+current.name.replace(" (home)","");
  // Wait for named layer ids. If metadata fails, that service stays unavailable until retry.
  return resolveRiskLayers().then(function(){
    if(!fresh()) return null;
    var missing=function(){return Promise.resolve(null);};
    return Promise.all([RISK_READY.spc?spcQuery(RISK_LAYERS.spc[0]):missing(),RISK_READY.spc?spcQuery(RISK_LAYERS.spc[1]):missing(),RISK_READY.spc?spcQuery(RISK_LAYERS.spc[2]):missing(),
            RISK_READY.ero?eroQuery(RISK_LAYERS.ero[0]):missing(),RISK_READY.ero?eroQuery(RISK_LAYERS.ero[1]):missing(),RISK_READY.ero?eroQuery(RISK_LAYERS.ero[2]):missing(),
            RISK_READY.fire?fireQuery(RISK_LAYERS.fireCat[0]):missing(),RISK_READY.fire?fireQuery(RISK_LAYERS.fireCat[1]):missing(),RISK_READY.fire?fireDay3Query():missing(),
            RISK_READY.wssi?wssiQuery(RISK_LAYERS.wssi[0]):missing(),RISK_READY.wssi?wssiQuery(RISK_LAYERS.wssi[1]):missing(),
            fetchSpcThreats()]);
  }).then(function(r){
    if(!r) return;             // stale generation — nothing to paint
    if(!fresh()) return;   // user moved while this was in flight
    smart.spcRisk=r[0];
    smart.eroRisk=r[3];
    smart.fireRisk=r[6];
    /* Day 1 AND day 2 for the Bottom Line: the matrix below paints day 2 and throws it away,
       but tomorrow's outlook is exactly what the card's 24 hourly periods cannot see. WSSI is
       Bottom Line-only — a Winter column in the matrix would sit empty most of the year. */
    var known=r.slice(0,11).filter(function(v){return v!=null;}).length;
    (r[11]||[]).forEach(function(day){
      if(day) known+=day.values.filter(function(v){return v!=null;}).length;
    });
    feedUpdate("risk",known===0?"unavailable":known===17?"ready":"partial");
    callRisk={spc:[r[0],r[1]], ero:[r[3],r[4]], fire:[r[6],r[7]],
              wssi:[r[9],r[10]]};
    var days=["Today","Tomorrow","Day 3"];
    var html='<div class="spc-row rhead"><span></span><span class="rh">'+ic("storm")+'Storm</span><span class="rh">'+ic("flood")+'Flood</span><span class="rh">'+ic("fire")+'Fire</span></div>';
    for(var i=0;i<3;i++){
      html+='<div class="spc-row"><span class="spc-day">'+days[i]+'</span>'
        +riskPill(spcRisk(r[i]),5)
        +riskPill(eroRisk(r[3+i]),4)
        +riskPill(fireRisk(r[6+i]),3)
        +'</div>';
    }
    el.innerHTML=html;
    renderSpcThreats(r[11]);
    if(typeof renderTheCall==="function") renderTheCall();   // outlook levels can add/remove a verdict pill
  }).catch(function(){
    if(!fresh()) return;   // a superseded request must not paint an error over the new place
    feedUpdate("risk","unavailable");
    el.innerHTML='<div class="empty">Risk outlooks unavailable. <a href="https://www.spc.noaa.gov/products/outlook/day1otlk.html" target="_blank" rel="noopener">Open SPC \u2197</a> \u00b7 <a href="https://www.spc.noaa.gov/products/fire_wx/" target="_blank" rel="noopener">Fire \u2197</a></div>';
    callRisk=null;                                           // never let a stale outlook keep a pill alive
    renderSpcThreats(null);
    if(typeof renderTheCall==="function") renderTheCall();
  });
}

function loadMcd(){
  var fresh=locGuard();
  return resolveRiskLayers().then(function(){
    return getJSON(MCD_URL+RISK_LAYERS.mcd+"/query?where=1%3D1&outFields=name&returnGeometry=true&f=geojson");
  }).then(function(fc){
    /* Regional pre-filter BEFORE the fetch budget is set. An MD can only name LSX in its ATTN
       line (or cover the saved point) if its polygon reaches this region, so distant actives
       contribute nothing — but in a national outbreak they inflate the count that decides how
       many texts to fetch, and a nearby MD's text crowded past the cap by ten Plains MDs is a
       silent false negative on a severe-weather surface. geomTouchesEnv only ever over-keeps. */
    if(!fc||!Array.isArray(fc.features)||fc.error) throw new Error("Invalid storm discussions");
    var feats=fc.features.filter(function(f){
      return f.geometry&&/MD\s*\d+/i.test((f.properties&&f.properties.name)||"")
        &&geomTouchesEnv(f.geometry,WWA_ENV);
    });
    if(!feats.length){ if(fresh()){ feedUpdate("mcd","ready"); renderMcd([]); } return; }
    /* The polygons say which MDs are ACTIVE; only the text products know who they're FOR. The
       product list is newest-first but NATIONAL, so a regional MD's text can sit arbitrarily deep
       when the Plains are issuing over it — no fixed fetch count is safe. Walk the list in small
       chunks instead, stopping the moment every regional number has its text: the usual day pays
       one chunk, an outbreak walks only as deep as it must, and the list's own length (20) is the
       hard ceiling either way. */
    var need={};
    feats.forEach(function(f){ need[+(/MD\s*(\d+)/i.exec(f.properties.name)[1])]=1; });
    var byNum={};
    return getJSON(API+"/products?type=SWO&location=MCD&limit=20",LD).then(function(list){
      var g=(list&&list["@graph"])||[], i=0;
      function satisfied(){ return Object.keys(need).every(function(n){ return byNum[n]; }); }
      function chunkNext(){
        if(i>=g.length||satisfied()) return null;
        var batch=g.slice(i,i+4); i+=4;
        return Promise.all(batch.map(function(p){
          return getJSON(p["@id"],LD).then(function(prod){
            var d=parseMcd(prod&&prod.productText);
            // newest-first walk: the first text seen for a number is the current one
            if(d&&!(d.num in byNum)){ d.issued=Date.parse(prod.issuanceTime)||0; byNum[d.num]=d; }
          }).catch(function(){});   // one dead text ≠ no strip; the polygon still speaks
        })).then(chunkNext);
      }
      return chunkNext();
    }).catch(function(){}).then(function(){
      if(!fresh()) return;
      var out=[];
      feats.forEach(function(f){
        var num=+(/MD\s*(\d+)/i.exec(f.properties.name)[1]);
        var d=byNum[num]||{num:num,areas:"",concerning:"",validEnd:null,prob:null,summary:"",attn:[],issued:0};
        var hits=!!ptInGeometry(current.lon,current.lat,f.geometry);
        if(!hits&&d.attn.indexOf("LSX")<0) return;   // a discussion three states away is not this page's business
        var end=d.validEnd?mcdValidEnd(d.validEnd,d.issued):null;
        if(end&&end<=Date.now()) return;   // the service can hold an expired MD briefly past its window
        out.push({num:num,geom:f.geometry,hits:hits,end:end,d:d});
      });
      feedUpdate("mcd",Object.keys(need).every(function(n){return byNum[n];})?"ready":"partial");
      renderMcd(out);
    });
  }).catch(function(e){
    if(isAbort(e)||!fresh()) return;
    feedUpdate("mcd","unavailable");
    /* A failed refresh must not read as "the discussion ended": keep what's already painted until
       its own valid time retires it. (An MD whose window never parsed rides until a fetch succeeds.) */
    renderMcd(lastMcds.filter(function(m){ return !m.end||m.end>Date.now(); }));
  });
}

function loadCpc(){
  var fresh=locGuard();
  var el=document.getElementById("cpc"); if(!el) return Promise.resolve();
  var jobs=[pointQuery(CPC_610,0),pointQuery(CPC_610,1),pointQuery(CPC_814,0),pointQuery(CPC_814,1)];
  return Promise.allSettled(jobs).then(function(rs){
    if(!fresh()) return;   // user moved while this was in flight
    var values=rs.map(function(r){return r.status==="fulfilled"?cpcParse(r.value):null;});
    var known=values.filter(Boolean).length;
    feedUpdate("cpc",known===4?"ready":known?"partial":"unavailable");
    function val(i){ return values[i]; }
    // Each period page contains both temperature and precipitation maps with their legends.
    el.innerHTML='<div class="cpc-grid">'+[
      ["610day","6–10 Day","t","Temperature"],
      ["610day","6–10 Day","p","Precipitation"],
      ["814day","8–14 Day","t","Temperature"],
      ["814day","8–14 Day","p","Precipitation"]
    ].map(function(item,i){
      return officialSourceLink("https://www.cpc.ncep.noaa.gov/products/predictions/"+item[0]+"/",
        "CPC "+item[1]+" "+item[3]+" outlook",
        '<div class="k">'+item[1]+' · '+item[3]+' <span aria-hidden="true">↗</span></div><span id="cpcValue'+i+'">'+cpcPill(item[2],val(i))+'</span>',
        "cpc-item source-link","cpcValue"+i);
    }).join("")+'</div>';
  }).catch(function(){
    if(!fresh()) return;   // a superseded request must not paint an error over the new place
    feedUpdate("cpc","unavailable");
    el.innerHTML='<div class="empty">CPC outlooks unavailable. <a href="https://www.cpc.ncep.noaa.gov/products/predictions/610day/" target="_blank" rel="noopener">Open CPC \u2197</a></div>';
  });
}

function loadDrought(){
  var fresh=locGuard();
  var card=document.getElementById("droughtCard"); if(!card) return Promise.resolve();
  function outlookRow(id, rs){
    var el=document.getElementById(id); if(!el) return;
    if(rs.status!=="fulfilled"){ el.innerHTML='<span class="dr-none dr-dim">— unavailable</span>'; return; }
    var o=null;
    (rs.value.features||[]).forEach(function(f){ var v=f.attributes&&f.attributes.outlook; if(v && v!=="No_Drought") o=v; });
    var cat=o?outlookCat(o):null;
    if(!cat){ el.innerHTML='<span class="dr-none">'+ic("check")+'None expected</span>'; }
    else{ el.innerHTML='<span class="dr-pill" style="background:'+cat.bg+';color:'+cat.fg+'">'+ic(cat.ic)+esc(cat.t)+'</span>'; }
  }
  return Promise.allSettled([
    pointQuery(USDM_URL,0,"DM"),
    pointQuery(DROUGHT_OUTLK_URL,1,"outlook"),
    pointQuery(DROUGHT_OUTLK_URL,4,"outlook")
  ]).then(function(r){
    if(!fresh()) return;   // user moved while this was in flight
    var known=r.filter(function(v){return v.status==="fulfilled";}).length;
    feedUpdate("drought",known===3?"ready":known?"partial":"unavailable");
    // Now — U.S. Drought Monitor
    var nowEl=document.getElementById("drNow");
    if(nowEl){
      if(r[0].status!=="fulfilled"){
        nowEl.innerHTML='<a class="dr-link" href="https://droughtmonitor.unl.edu/" target="_blank" rel="noopener">Drought Monitor ↗</a>';
      }else{
        var maxdm=-1;
        (r[0].value.features||[]).forEach(function(f){ var dm=f.attributes&&f.attributes.DM; if(dm!=null&&dm>maxdm) maxdm=dm; });
        var cat=droughtCat(maxdm);
        nowEl.innerHTML=cat?('<span class="dr-pill" style="background:'+cat.bg+';color:'+cat.fg+'">'+ic("drought")+cat.t+'</span>')
                           :'<span class="dr-none">'+ic("check")+'No drought</span>';
      }
    }
    outlookRow("drMonth",  r[1]);
    outlookRow("drSeason", r[2]);
  });
}

function loadHazards(){
  var fresh=locGuard();
  var el=document.getElementById("hazards"); if(!el) return Promise.resolve();
  // Real service layout: 3-7 day → Temp(1) Precip(4) Fire/Drought(7); 8-14 day → Temp(3) Precip(6) Fire/Drought(8)
  var q37=[pointQuery(HZ_URL,1),pointQuery(HZ_URL,4),pointQuery(HZ_URL,7)];
  var q814=[pointQuery(HZ_URL,3),pointQuery(HZ_URL,6),pointQuery(HZ_URL,8)];
  return Promise.allSettled(q37.concat(q814)).then(function(all){
    if(!fresh()) return;   // user moved while this was in flight
    var d37=hazScan(all.slice(0,3));
    var d814=hazScan(all.slice(3,6));
    var known=all.filter(function(r){return r.status==="fulfilled";}).length;
    feedUpdate("hazards",known===6?"ready":known?"partial":"unavailable");
    function block(title,list,complete){
      title=officialSourceLink(title==="Days 3–7"?"https://www.wpc.ncep.noaa.gov/threats/threats.php":"https://www.cpc.ncep.noaa.gov/products/predictions/threats/threats.php",
        (title==="Days 3–7"?"WPC ":"CPC ")+title+" hazards outlook",esc(title)+' <span aria-hidden="true">↗</span>');
      if(!list.length&&!complete) return '<div class="hz-row"><span class="hz-when">'+title+'</span><span class="hz-none">Hazards data unavailable</span></div>';
      if(!list.length) return '<div class="hz-row hz-clear"><span class="hz-when">'+title+'</span><span class="hz-none">'+ic("check")+'No hazards flagged</span></div>';
      var notes=[];
      var chips=list.map(function(h){
        var r=hazRange(h.start,h.end);
        var n=hazForecastNote(h); if(n&&notes.indexOf(n)<0) notes.push(n);
        return '<span class="hz-chip">'+ic(hazIcon(h.label))+esc(h.label)
          +(r?' <span class="hz-dates">· '+esc(r)+'</span>':'')+'</span>';
      }).join("");
      return '<div class="hz-row"><span class="hz-when">'+title+'</span><span class="hz-list">'+chips
        +(notes.length?'<span class="hz-fc">'+esc(notes.join(" · "))+'</span>':'')
        +'</span></div>';
    }
    el.innerHTML=block("Days 3–7",d37,all.slice(0,3).every(function(r){return r.status==="fulfilled";}))+block("Days 8–14",d814,all.slice(3,6).every(function(r){return r.status==="fulfilled";}));
    // issuance freshness: the newest file date across whatever layers answered
    var issued=0;
    all.forEach(function(rs){
      if(rs.status!=="fulfilled"||!rs.value) return;
      (rs.value.features||[]).forEach(function(f){
        var t=(f.attributes||{}).idp_filedate;
        if(typeof t==="number"&&t>issued) issued=t;
      });
    });
    var cap=document.getElementById("hazIssued");
    if(cap) cap.textContent=issued
      ?("issued "+new Date(issued).toLocaleDateString("en-US", {timeZone:WEATHER_TZ,weekday:"short"})+" · days 3–14")
      :"days 3–14";
  }).catch(function(){
    if(!fresh()) return;   // a superseded request must not paint an error over the new place
    feedUpdate("hazards","unavailable");
    el.innerHTML='<div class="empty">Hazards outlook unavailable. <a href="https://www.wpc.ncep.noaa.gov/threats/threats.php" target="_blank" rel="noopener">Open WPC Hazards ↗</a></div>';
  });
}

function loadClimate(){
  var fresh=locGuard();
  var grid=document.getElementById("cnGrid"); if(!grid) return Promise.resolve();
  return Promise.all([climStation(current.lat,current.lon), deepStation(current.lat,current.lon)]).then(function(sts){
    // Guard HERE, not just at the ask() below: the station lookup is itself async, so a resolved
    // station from a place the user has already left was being written straight into climate state
    // and the card's footer. That's how "VICHY ROLLA" ended up labelling Quincy's departures.
    if(!fresh()) return;
    var st=sts[0], deep=sts[1];
    climate.station=st.sid; climate.stationName=st.name;
    var nameEl=document.getElementById("cnStation"); if(nameEl) nameEl.textContent=st.name||st.sid;
    var showSnow=(function(){var m=weatherParts().month;return m>=10||m<=3;})(); // Nov–Apr
    // add:"mcnt" makes each running departure come back as [departure, missing-day-count] so a
    // gappy station can't pass off a hole-riddled sum as a real anomaly (Mount Vernon: "-19.99""
    // year precip departure with 79 of the days simply missing)
    var elems=[
      {name:"maxt",normal:"1"},
      {name:"mint",normal:"1"},
      {name:"avgt",duration:"mtd",reduce:{reduce:"mean",add:"mcnt"},normal:"departure"},
      {name:"avgt",duration:"ytd",reduce:{reduce:"mean",add:"mcnt"},normal:"departure"},
      {name:"pcpn",duration:"mtd",reduce:{reduce:"sum",add:"mcnt"},normal:"departure"},
      {name:"pcpn",duration:"ytd",reduce:{reduce:"sum",add:"mcnt"},normal:"departure"}
    ];
    if(showSnow) elems.push({name:"snow",duration:"std",season_start:"07-01",reduce:{reduce:"sum",add:"mcnt"},normal:"departure"});
    var today=weatherParts().key; // the station calendar date, even for a viewer elsewhere
    var per=climPeriods();
    function ask(sid){
      return acisPost("StnData",{sid:sid, sdate:today, edate:today, elems:elems, meta:["name"]}).then(function(r){
        if(r&&r.error) throw new Error("acis: "+r.error);          // ACIS reports errors as {"error":...} with HTTP 200
        if(!r||!r.data||!r.data.length) throw new Error("acis: no data");
        return climCells(r.data[0],showSnow,per);
      });
    }
    function paint(c,borrowedFrom){
      feedUpdate("climate",climAllOK(c,showSnow)?"ready":"partial");
      var cells=""
        +'<div class="cn-cell"><span class="cn-lbl">Temp \u00b7 month</span>'+fmtDep(c.t1.ok?c.t1.v:null,"\u00b0")+'</div>'
        +'<div class="cn-cell"><span class="cn-lbl">Temp \u00b7 year</span>'+fmtDep(c.t2.ok?c.t2.v:null,"\u00b0")+'</div>'
        +'<div class="cn-cell"><span class="cn-lbl">Precip \u00b7 month</span>'+fmtDep(c.p1.ok?c.p1.v:null,"\u2033")+'</div>'
        +'<div class="cn-cell"><span class="cn-lbl">Precip \u00b7 year</span>'+fmtDep(c.p2.ok?c.p2.v:null,"\u2033")+'</div>';
      if(showSnow) cells+='<div class="cn-cell"><span class="cn-lbl">Snow \u00b7 season</span>'+fmtDep(c.sn.ok?c.sn.v:null,"\u2033")+'</div>';
      grid.innerHTML=cells;
      // A dash must never be a mystery: name whose numbers these are, or say why there aren't any.
      var src=document.getElementById("cnSrc");
      if(src){
        if(borrowedFrom){
          src.innerHTML="Month &amp; year figures from <b>"+esc(shortStn(borrowedFrom))+"</b> \u2014 "
            +esc(shortStn(st.name||st.sid))+" has too many missing days";
        }else if(!climAllOK(c,showSnow)){
          src.innerHTML="Some figures unavailable \u2014 <b>"+esc(shortStn(st.name||st.sid))+"</b> has gaps in its record";
        }else src.innerHTML="";
      }
      renderVsNormal();
      renderCurrentCtx();
      renderContext();
    }
    return ask(st.sid).then(function(local){
      if(!fresh()) return;   // user moved while this was in flight
      climate.normHi=local.normHi; climate.normLo=local.normLo; climate.normDate=today;   // normals are gap-free \u2014 always local
      if(climAllOK(local,showSnow) || !deep || !deep.sid || deep.sid===st.sid){ paint(local,""); return; }
      // Local station is too gappy for the running totals. Month/year anomalies are broad-scale,
      // so a complete nearby record beats four dashes \u2014 borrowed as a COHERENT set from ONE
      // station (mixing sources per cell would be impossible to reason about) and attributed.
      return ask(deep.sid).then(function(dc){
        if(!fresh()) return;
        if(climAllOK(dc,showSnow)) paint(dc,deep.name||deep.sid);
        else paint(local,"");
      }).catch(function(){ if(fresh()) paint(local,""); });
    });
  }).catch(function(){
    if(!fresh()) return;   // a superseded request must not paint an error over the new place
    feedUpdate("climate","unavailable");
    climate.normHi=null; climate.normLo=null; renderVsNormal();
    grid.innerHTML='<div class="empty">Climate normals unavailable. <a href="https://xmacis.rcc-acis.org/" target="_blank" rel="noopener">xmACIS ↗</a></div>';
  });
}

function loadClimateContext(){
  deferredFeeds.context=true;
  var locationFresh=locGuard(), requestDate=ctxTodayKey();
  var generation=loadClimateContext.generation=(loadClimateContext.generation||0)+1;
  function fresh(){return locationFresh()&&generation===loadClimateContext.generation&&requestDate===ctxTodayKey();}
  try{ localStorage.removeItem("lsxCtx_v1"); localStorage.removeItem("lsxCtx_v2"); localStorage.removeItem("lsxCtx_v3"); }catch(e){}   // pre-split cache format
  return climStation(current.lat,current.lon).then(function(st){
   return deepStation(current.lat,current.lon).then(function(deep){
    // Depth vs locality: daily records/rankings come from the deep legacy station; monthly,
    // recent dailies, and normals stay on the NEAREST station, because those need locality.
    var rec=(deep&&deep.sid)?deep:st;
    if(!fresh()) return null;   // both station lookups are async — same trap as loadClimate
    var key=st.sid+"|"+rec.sid+"|"+ctxTodayKey();
    try{
      var c=JSON.parse(localStorage.getItem(CTX_KEY)||"null");
      // a cache HIT paints synchronously, so it needs the guard just as much as a fetch does
      if(c&&c.key===key&&c.ctx&&c.ctx.ready&&typeof c.checkedAt==="number"
        &&Date.now()>=c.checkedAt&&Date.now()-c.checkedAt<=FEEDS.context.age
        &&(c.status==="ready"||c.status==="partial")){ ctx=c.ctx;
        feedChecks.context={status:c.status,successAt:c.checkedAt,issuedAt:0,saved:false};
        delete savedParts.cnCtx; freshnessCheck();
        renderContext(); return null; }
    }catch(e){}
    var now=weatherParts(), y=now.year;
    var mm=("0"+(now.month+1)).slice(-2), dd=("0"+now.day).slice(-2);
    var today=y+"-"+mm+"-"+dd;
    var wkEnd=new Date(calendarDate(today).getTime()+6*86400000);
    var wkEndStr=wkEnd.toISOString().slice(0,10);
    var histStart=(y-2)+"-"+mm+"-"+(mm==="02"&&dd==="29"?"28":dd);
    var tomorrow=new Date(calendarDate(today).getTime()+86400000).toISOString().slice(0,10);
    return Promise.allSettled([
      acisPost("StnData",{sid:rec.sid,sdate:(mm==="02"&&dd==="29"?"1852-":"1850-")+mm+"-"+dd,edate:today,
        elems:[{name:"maxt",interval:[1,0,0],duration:1,reduce:"max"},
               {name:"mint",interval:[1,0,0],duration:1,reduce:"min"},
               {name:"pcpn",interval:[1,0,0],duration:1,reduce:"sum"}]}),
      acisPost("StnData",{sid:st.sid,sdate:"por",edate:"por",
        elems:[{name:"pcpn",interval:"mly",duration:"mly",reduce:"sum"},
               {name:"avgt",interval:"mly",duration:"mly",reduce:"mean"}]}),
      acisPost("StnData",{sid:st.sid,sdate:histStart,edate:today,
        elems:[{name:"maxt"},{name:"mint"},{name:"pcpn"}]}),
      acisPost("StnData",{sid:st.sid,sdate:today,edate:wkEndStr,
        elems:[{name:"maxt",normal:"1"},{name:"mint",normal:"1"}]}),
      acisPost("StnData",{sid:rec.sid,sdate:(tomorrow.slice(5)==="02-29"?"1852-":"1850-")+tomorrow.slice(5),edate:tomorrow,
        elems:[{name:"maxt",interval:[1,0,0],duration:1,reduce:"max"},
               {name:"mint",interval:[1,0,0],duration:1,reduce:"min"},
               {name:"pcpn",interval:[1,0,0],duration:1,reduce:"sum"}]})
    ]).then(function(rs){
      if(!fresh()) return;   // user moved while this was in flight
      function data(i){
        if(rs[i].status!=="fulfilled") return null;
        var v=rs[i].value;
        if(!v||v.error||!Array.isArray(v.data)) return null;
        return v.data;
      }
      var nctx={ready:false, recordDate:today, recHi:null, recLo:null, recPcp:null, doyHi:[], doyLo:[],
                monWet:[], monWarm:[], monMtd:null, monMean:null, monName:MONTHS[now.month],
                years:0, dry:null, hist:null, normWeek:{},
                recStation:(rec.sid!==st.sid)?(rec.name||rec.sid):""};
      // Fetch each calendar date independently; an unavailable date never borrows another's record.
      nctx.recordsByDate={};
      [today,tomorrow].forEach(function(date,index){
        var rows=data(index===0?0:4);
        if(!rows) return;
        rows=rows.filter(function(row){return String(row[0]).slice(5,10)===date.slice(5);});
        var hi=ctxNumPairs(rows,1,true), lo=ctxNumPairs(rows,2,false), pc=ctxNumPairs(rows,3,true);
        var record={recordDate:date,recHi:hi.best,recLo:lo.best,recPcp:pc.best,
                    doyHi:hi.sorted,doyLo:lo.sorted,years:hi.sorted.length};
        nctx.recordsByDate[date]=record;
        if(index===0) Object.assign(nctx,record);
      });
      // 2 — monthly totals, every year (current partial month kept separately)
      var mon=data(1);
      if(mon){
        var curPrefix=y+"-"+mm;
        mon.forEach(function(r){
          var ym=String(r[0]), p=acisNum(r[1]), t=acisNum(r[2]);
          if(ym.slice(5,7)!==mm) return;                       // same month-of-year only
          if(ym===curPrefix){ nctx.monMtd=p; nctx.monMean=t; return; }   // this year = partial
          if(p!=null) nctx.monWet.push(p);
          if(t!=null) nctx.monWarm.push(t);
        });
        nctx.monWet.sort(function(a,b){return a-b;});
        nctx.monWarm.sort(function(a,b){return a-b;});
      }
      // 3 — last two years of dailies → dry streak + compact series for "warmest since"
      var dly=data(2);
      if(dly&&dly.length){
        var maxt=[], mint=[], start=dly[0][0];
        dly.forEach(function(r){ maxt.push(acisNum(r[1])); mint.push(acisNum(r[2])); });
        nctx.hist={start:start, maxt:maxt, mint:mint};
        var days=0, lastRain=null;
        for(var i=dly.length-1;i>=0;i--){
          var p=acisNum(dly[i][3]);
          if(p==null) { if(i===dly.length-1) continue; else break; }   // today often still "M"
          if(p>=0.01){ lastRain={date:dly[i][0], amt:p}; break; }
          days++;
        }
        if(lastRain) nctx.dry={days:days, date:lastRain.date, amt:lastRain.amt};
      }
      // 4 — normals for the week ahead
      var nw=data(3);
      if(nw) nw.forEach(function(r){
        var h=acisNum(r[1]), l=acisNum(r[2]);
        if(h!=null||l!=null) nctx.normWeek[r[0]]={hi:h, lo:l};
      });
      nctx.ready=!!(nctx.recHi||nctx.recordsByDate[tomorrow]&&nctx.recordsByDate[tomorrow].recHi||nctx.monWet.length||nctx.hist);
      var complete=[0,1,2,3,4].every(function(i){var rows=data(i);return rows&&rows.length;});
      feedUpdate("context",nctx.ready?(complete?"ready":"partial"):"unavailable");
      ctx=nctx;
      if(ctx.ready){ try{ localStorage.setItem(CTX_KEY,JSON.stringify({key:key,ctx:ctx,status:feedChecks.context.status,checkedAt:feedChecks.context.successAt})); }catch(e){} }
      renderContext();
      return null;
    });
   });
  }).catch(function(){ if(fresh()){ feedUpdate("context","unavailable"); ctx.ready=false; renderContext(); } });
}

function loadUv(){
  var fresh=locGuard();
  return getJSON("https://api.open-meteo.com/v1/forecast?latitude="+current.lat+"&longitude="+current.lon
    +"&hourly=uv_index&daily=uv_index_max&forecast_days=7&timezone=America%2FChicago&timeformat=unixtime", null, locSignal()).then(function(d){
    if(!fresh()) return;   // user moved while this was in flight
    var h=d.hourly||{}, ts=h.time||[], vs=h.uv_index||[], now=Date.now(), best=null, cur=null, curGap=Infinity;
    for(var i=0;i<ts.length;i++){
      if(vs[i]==null) continue;
      var t=(typeof ts[i]==="number")?ts[i]*1000:(/Z$|[+-]\d\d:\d\d$/.test(ts[i])?Date.parse(ts[i]):NaN);
      if(!isFinite(t)) continue;
      var gap=Math.abs(t-now);
      // "now" is the nearest hourly sample, but only if one is actually near — never extrapolate
      if(gap<curGap && gap<=5400000){ curGap=gap; cur=vs[i]; }
      if(t<now-1800000||t>now+24*3600000) continue;    // peak across the next 24 h (useful in the evening too)
      if(!best||vs[i]>best.v) best={v:vs[i],t:t};
    }
    if(cur==null&&!best) throw new Error("UV samples unavailable");
    feedUpdate("uv",cur==null?"partial":"ready");
    uv.now=cur; uv.peak=best;
    var dd=d.daily||{}, dts=dd.time||[], dvs=dd.uv_index_max||[], map={};
    for(var j=0;j<dts.length;j++){ if(dvs[j]!=null) map[typeof dts[j]==="number"?weatherParts(dts[j]*1000).key:dts[j]]=dvs[j]; }
    uv.daily=map;
    renderUvNow();
    if(typeof renderTheCall==="function") renderTheCall();
    // The 7-day may already be on screen; repaint it so each day picks up its UV figure.
    if(typeof loadForecast._paint==="function") loadForecast._paint();
  }).catch(function(){
    if(!fresh()) return;
    feedUpdate("uv","unavailable");
    uv.now=null; uv.peak=null; uv.daily={}; renderUvNow();
    if(typeof renderTheCall==="function") renderTheCall();
  });
}

function loadQpf(){
  var fresh=locGuard();
  var chip=document.getElementById("qpf7"); if(!chip) return Promise.resolve();
  function findLayer(){
    if(qpfLayerId!==undefined) return Promise.resolve(qpfLayerId);
    return getJSON(QPF_URL+"?f=json").then(function(d){
      var best=null;
      (d.layers||[]).forEach(function(l){
        var n=String(l.name||"");
        if(/day\s*1\s*[-\u2013]\s*7|7[\s_-]*day|168/i.test(n)) best=l.id;
      });
      qpfLayerId=best;
      return best;
    });
  }
  return findLayer().then(function(id){
    if(id==null) throw new Error("no 7-day layer");
    return pointQuery(QPF_URL+"/",id,"*");
  }).then(function(d){
    var maxQ=null;
    if(!fresh()) return;   // user moved while this was in flight
    (d.features||[]).forEach(function(f){
      var at=f.attributes||{};
      for(var k in at){
        if(k.toLowerCase().indexOf("qpf")>=0){
          var v=+at[k];
          if(!isNaN(v)&&(maxQ==null||v>maxQ)) maxQ=v;
        }
      }
    });
    chip.innerHTML=(maxQ!=null)?(ic("rain")+"~"+(Math.round(maxQ*10)/10)+"\u2033 rain next 7 days"):"";
  }).catch(function(){ if(fresh()) chip.textContent=""; });
}

function loadStationPlot(){
  deferredFeeds.stations=true;
  // Data acquisition is independent of map initialization; renderStationLayer waits for the map.
  var c2f=function(c){return (c==null)?null:Math.round(c*9/5+32);};
  var checked=0;
  var jobs=STN_LIST.map(function(s){
    return getJSON(API+"/stations/"+s.id+"/observations/latest").then(function(d){
      var p=(d&&d.properties)||{};
      var tempF=c2f(p.temperature&&p.temperature.value), dewF=c2f(p.dewpoint&&p.dewpoint.value);
      var mph=(p.windSpeed&&p.windSpeed.value!=null)?Math.round(p.windSpeed.value*0.621371):null;
      var rh=(p.relativeHumidity&&p.relativeHumidity.value!=null)?Math.round(p.relativeHumidity.value):rhFromTd(tempF,dewF);
      var o={id:s.id,lat:s.lat,lon:s.lon,
        tempF:tempF, dewF:dewF, rh:rh,
        feelsF:feelsLikeF(tempF,rh,mph),
        windDir:(p.windDirection&&p.windDirection.value!=null)?Math.round(p.windDirection.value):null,
        windMph:mph,
        gustMph:(p.windGust&&p.windGust.value!=null)?Math.round(p.windGust.value*0.621371):null,
        ts:p.timestamp||null};
      if(currentObservationFresh(d,Date.now())) checked++;
      if(o.ts) _stnLast[s.id]=o;   // an ob with no timestamp could never age out — don't cache it
      return o;
    }).catch(function(){ return _stnLast[s.id]||null; });
  });
  return Promise.all(jobs).then(function(list){
    var now=Date.now();
    stnObs=list.map(function(o){
      if(!o) return null;
      var t=o.ts?(Date.parse(o.ts)||0):0;
      if(t&&now-t>STN_DEAD_MS){ delete _stnLast[o.id]; return null; }
      o.stale=!!t&&(now-t>STN_STALE_MS);
      return o;
    });
    feedUpdate("stations",checked===STN_LIST.length?"ready":checked?"partial":"unavailable");
    renderStationLayer();
    var age=document.getElementById("stnAge");
    if(age){
      /* The stamp used to show the NEWEST ob — the one number that can't indict the map, since a
         single fresh station vouched for fourteen. The OLDEST fresh ob is the honest summary:
         every full-strength marker is at most that old. Stale ones get counted, not averaged in. */
      var oldest=0, staleN=0, plotted=0;
      stnObs.forEach(function(o){
        if(!o) return;
        plotted++;
        if(o.stale){ staleN++; return; }
        var t=o.ts?(Date.parse(o.ts)||0):0;
        if(t&&(!oldest||t<oldest)) oldest=t;
      });
      var parts=[];
      if(oldest) parts.push("obs "+timeAgo(new Date(oldest).toISOString()));
      if(staleN) parts.push(staleN+" stale");
      /* Fifteen fetches all failing is a statement, not a blank — without it the card is a bare
         basemap quietly implying a stationless region rather than an unreachable API. */
      age.textContent=plotted?(parts.join(" · ")||"tap a station for detail")
                            :"no obs — NWS API isn't answering";
    }
  }).catch(function(){ feedUpdate("stations","unavailable"); });
}

function loadAFD(){
  return getJSON(API+"/products/types/AFD/locations/LSX",LD).then(function(list){
    var g=list["@graph"]||[];
    if(!g.length) throw new Error("no AFD");
    var latest=g[0], purl=latest["@id"]||(API+"/products/"+latest.id);
    return getJSON(purl,LD);
  }).then(function(prod){
    var sec=extractAFD(prod.productText||"");
    feedUpdate("afd",sec?"ready":"unavailable",prod.issuanceTime);
    renderAFD(sec, prod.issuanceTime);
  }).catch(function(){ feedUpdate("afd","unavailable"); renderAFD(null); });
}

function pointQuery(base,layer,fields){
  // every one of these is a point query against `current` — cancellable by definition
  return getJSON(base+layer+"/query?geometry="+current.lon+","+current.lat
    +"&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects"
    +"&outFields="+(fields||"*")+"&returnGeometry=false&f=json", null, locSignal()).then(function(d){
      if(!d||d.error||!Array.isArray(d.features)) throw new Error("Invalid ArcGIS point response");
      return d;
    });
}

function spcQuery(layer){
  return pointQuery(SPC_URL,layer,"dn").then(function(d){
    var maxdn=0;
    (d.features||[]).forEach(function(f){var dn=f.attributes&&f.attributes.dn;if(dn&&dn>maxdn)maxdn=dn;});
    return maxdn;
  }).catch(function(){return null;});
}

function eroQuery(layer){
  // Field names vary across NOAA services; scan all string attributes for category keywords
  return pointQuery(ERO_URL,layer,"*").then(function(d){
    var rank=0;
    (d.features||[]).forEach(function(f){
      var at=f.attributes||{};
      for(var k in at){
        var v=String(at[k]||"").toLowerCase();
        if(v.indexOf("high")>=0) rank=Math.max(rank,4);
        else if(v.indexOf("moderate")>=0) rank=Math.max(rank,3);
        else if(v.indexOf("slight")>=0) rank=Math.max(rank,2);
        else if(v.indexOf("marginal")>=0) rank=Math.max(rank,1);
      }
    });
    return rank;
  }).catch(function(){return null;});
}

/* WSSI "Overall Impact" polygons carry a string `impact` field: WINTER WEATHER AREA (snow on
   the map, nothing to act on — the TSTM of winter), then MINOR/MODERATE/MAJOR/EXTREME. Nested
   polygons can all cover one point, so the strongest wins, same as spcQuery. */
function wssiQuery(layer){
  var RANK={minor:1,moderate:2,major:3,extreme:4};
  return pointQuery(WSSI_URL,layer,"impact").then(function(d){
    var rank=0;
    (d.features||[]).forEach(function(f){
      var v=String((f.attributes||{}).impact||"").toLowerCase();
      if(RANK[v]) rank=Math.max(rank,RANK[v]);
    });
    return rank;
  }).catch(function(){return null;});   // a failed query cannot certify zero impact
}

function fireQuery(layer){
  return pointQuery(FIRE_URL,layer,"dn").then(function(d){
    var maxdn=0;
    (d.features||[]).forEach(function(f){var dn=f.attributes&&f.attributes.dn;if(dn&&dn>maxdn)maxdn=dn;});
    return maxdn;
  }).catch(function(){return null;});   // a failed query cannot certify zero risk
}

/* Day 3 fire has NO categorical "Outlook" layer — only two probabilistic leaves whose dn is a
   FRACTION (winds/low-RH: 0.40=Marginal, 0.70=Critical · dry t-storm: 0.10=Marginal, 0.40=Critical).
   Convert onto the categorical 5/8 scale so the pill renderer treats all three days alike.
   (Previously this queried layer 6 — a GROUP layer that always 400s — so day 3 showed "No Fire Risk" forever.) */
function fireDay3Query(){
  function probMax(layer){
    return pointQuery(FIRE_URL,layer,"dn").then(function(d){
      var mx=0;
      (d.features||[]).forEach(function(f){ var dn=+(f.attributes&&f.attributes.dn)||0; if(dn>mx) mx=dn; });
      return mx;
    }).catch(function(){return null;});
  }
  return Promise.all([probMax(RISK_LAYERS.fireD3.dry),probMax(RISK_LAYERS.fireD3.wind)]).then(function(r){
    if(r[1]>=0.70||r[0]>=0.40) return 8;   // Critical
    if(r[1]>=0.40||r[0]>=0.10) return 5;   // Elevated
    return r[0]==null||r[1]==null?null:0;
  });
}

function fetchSpcThreats(){
  var nowMs=Date.now();
  return Promise.all([1,2].map(function(day){
    if(!RISK_READY.spc||!RISK_READY.threats) return Promise.resolve(null);
    // The categorical product sets the expected issuance; each threat layer must match it.
    return getJSON(SPC_URL+RISK_LAYERS.spc[day-1]+"/query?where=1%3D1&outFields=valid,expire,issue&returnGeometry=false&resultRecordCount=1&f=json",null,locSignal())
      .then(function(d){
        if(!d||d.error||!Array.isArray(d.features)||!d.features.length) return null;
        var period=spcOutlookPeriod(d.features[0].attributes,day,nowMs); if(!period) return null;
        return Promise.all(["tornado","wind","hail"].map(function(kind){
          var layer=SPC_THREAT_LAYERS[day-1][kind];
          return pointQuery(SPC_URL,layer,"dn,valid,expire,issue").then(function(data){
            if(data.features.length) return spcThreatProbability(data,period);
            // Distinct timestamps also reject a layer mixing products during an update.
            // A globally empty layer cannot prove its issuance and stays unavailable.
            return getJSON(SPC_URL+layer+"/query?where=1%3D1&outFields=valid,expire,issue&returnDistinctValues=true&returnGeometry=false&f=json",null,locSignal())
              .then(function(product){return spcThreatProbability(data,period,product);});
          }).catch(function(){return null;});
        })).then(function(values){return {period:period,values:values};});
      }).catch(function(){return null;});
  }));
}

function acisPost(call,params){
  // every ACIS call is scoped to a station or bbox derived from `current` — cancellable by definition
  return requestJSON(ACIS+call,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},
    body:"params="+encodeURIComponent(JSON.stringify(params))
  },locSignal());
}

// Find the nearest station that actually reports TEMPERATURE (not a precip-only CoCoRaHS gauge).
// Cache per rounded location; fall back to KSTL (St. Louis Lambert) if nothing suitable is found.
function climStation(lat,lon){
  var key=lat.toFixed(1)+","+lon.toFixed(1);
  if(_climStationCache[key]) return Promise.resolve(_climStationCache[key]);
  var d=0.9, bbox=[lon-d, lat-d, lon+d, lat+d];
  // Require maxt+mint+pcpn so we only get full climate stations; valid_daterange lets us screen out inactive ones
  var p=acisPost("StnMeta",{bbox:bbox, elems:["maxt","mint","pcpn"], meta:["name","sids","ll","valid_daterange"]}).then(function(r){
    var now=new Date(), best=null, bestScore=-1;
    (r.meta||[]).forEach(function(s){
      if(!s.ll||!s.sids||!s.sids.length) return;
      // must have a temperature record that is still current (ends within the last ~2 years)
      var dr=s.valid_daterange||[];
      var tempRange=dr[0];               // first elem requested was maxt
      if(!tempRange||!tempRange[1]) return;
      var endYr=parseInt(String(tempRange[1]).slice(0,4),10);
      if(!endYr || (weatherParts(now).year-endYr)>2) return;   // skip stale/discontinued temp stations
      // score: closeness, but strongly prefer first-order (ICAO/WBAN) stations
      var dist=Math.sqrt(Math.pow(s.ll[0]-lon,2)+Math.pow(s.ll[1]-lat,2));
      var firstOrder=s.sids.some(function(x){var t=x.split(" ")[1];return t==="1"||t==="3";});
      var score=(firstOrder?1000:0) - dist*100;   // airports win, then nearest
      if(score>bestScore){ bestScore=score; best=s; }
    });
    if(!best) throw new Error("no temp station");
    var sid=null;
    best.sids.forEach(function(s){ var p=s.split(" "); if(p[1]==="3"&&!sid) sid=p[0]; }); // ICAO
    best.sids.forEach(function(s){ var p=s.split(" "); if(p[1]==="1"&&!sid) sid=p[0]; }); // WBAN
    best.sids.forEach(function(s){ var p=s.split(" "); if(p[1]==="2"&&!sid) sid=p[0]+" 2"; }); // COOP (needs type)
    if(!sid) sid=best.sids[0];
    var out={sid:sid, name:best.name||""};
    _climStationCache[key]=out;
    return out;
  }).catch(function(e){
    // An ABORT means the user moved, not that this place has no usable station — caching the KSTL
    // fallback under the abandoned key would make it permanently wrong if they came back.
    if(isAbort(e)){ delete _climStationCache[key]; throw e; }
    var fb={sid:"KSTL", name:"St. Louis Lambert"};
    _climStationCache[key]=fb;
    return fb;
  });
  // Cache the in-flight promise too: loadClimate and loadClimateContext both ask at once,
  // and without this each page load fires a duplicate StnMeta lookup.
  _climStationCache[key]=p;
  return p;
}

function deepStation(lat,lon){
  var key=lat.toFixed(1)+","+lon.toFixed(1);
  if(_deepCache[key]!==undefined) return Promise.resolve(_deepCache[key]);
  var d=1.8, bbox=[lon-d, lat-d, lon+d, lat+d];
  var p=acisPost("StnMeta",{bbox:bbox, elems:["maxt"], meta:["name","sids","ll","valid_daterange"]}).then(function(r){
    var now=new Date(), best=null, bestDist=1e9;
    (r.meta||[]).forEach(function(s){
      if(!s.ll||!s.sids||!s.sids.length) return;
      var dr=(s.valid_daterange||[])[0];
      if(!dr||!dr[0]||!dr[1]) return;
      var startYr=parseInt(String(dr[0]).slice(0,4),10), endYr=parseInt(String(dr[1]).slice(0,4),10);
      if(!startYr||!endYr) return;
      if(startYr>1965) return;                          // no legacy depth
      if((weatherParts(now).year-endYr)>2) return;           // discontinued
      var firstOrder=s.sids.some(function(x){ var t=x.split(" ")[1]; return t==="1"||t==="3"; });
      if(!firstOrder) return;                           // airports: continuous, quality-controlled
      var dist=Math.sqrt(Math.pow(s.ll[0]-lon,2)+Math.pow(s.ll[1]-lat,2));
      if(dist<bestDist){ bestDist=dist; best=s; }
    });
    if(!best){ _deepCache[key]=null; return null; }
    var sid=null;
    best.sids.forEach(function(s){ var q=s.split(" "); if(q[1]==="3"&&!sid) sid=q[0]; });
    best.sids.forEach(function(s){ var q=s.split(" "); if(q[1]==="1"&&!sid) sid=q[0]; });
    if(!sid) sid=best.sids[0].split(" ")[0];
    var out={sid:sid, name:best.name||sid};
    _deepCache[key]=out;
    return out;
  }).catch(function(){ delete _deepCache[key]; return null; });   // transient failure → retry next cycle
  _deepCache[key]=p;
  return p;
}

function observationStationsFor(lat,lon,maxMiles){
  return pointsFor(lat,lon).then(function(pt){
    return getJSON(pt.properties.observationStations,HEADERS,locSignal());
  }).then(function(s){
    if(s.features&&s.features.length){
      return s.features.map(function(f){
        var p=f.properties||{};
        if(p.stationIdentifier&&p.name) STN_NAMES[p.stationIdentifier]=p.name;
        if(maxMiles!=null){
          var c=f.geometry&&f.geometry.coordinates;
          if(!c||!isFinite(c[0])||!isFinite(c[1])||stationMiles(lat,lon,+c[1],+c[0])>maxMiles) return null;
        }
        return p.stationIdentifier;
      }).filter(Boolean);
    }
    // The URL-only form has no coordinates, so it cannot certify a nearby fallback.
    return maxMiles!=null?[]:(s.observationStations||[]).map(function(u){ return u.substring(u.lastIndexOf("/")+1); });
  });
}

function stationFor(lat,lon){
  return observationStationsFor(lat,lon).then(function(ids){ return ids[0]||null; });
}

/* One registry drives manual refresh, location changes, scheduling, freshness and snapshots.
   Service-specific loaders paint their own fallbacks. This boundary also contains unexpected
   rejections and marks them unverified without allowing an older location to overwrite a new one. */
function feedTasks(localOnly){
  return Object.keys(FEEDS).filter(function(k){var cfg=FEEDS[k];return cfg.load&&cfg.manual!==false&&(!localOnly||cfg.local);});
}

function feedFailure(key){
  var cfg=FEEDS[key];
  if(cfg.tracked!==false) feedUpdate(key,"unavailable");
  Object.keys(FEEDS).forEach(function(k){if(FEEDS[k].owner===key) feedUpdate(k,"unavailable");});
  if(cfg.failure==="retain-until-expiry") renderMcd(lastMcds.filter(function(m){return !m.end||m.end>Date.now();}));
}

function runFeed(key){
  var cfg=FEEDS[key], generation=locSeq;
  if(!feedRequested(key)) return Promise.resolve();
  return Promise.resolve().then(function(){return window[cfg.load]();}).catch(function(e){
    if(isAbort(e)||(cfg.local&&generation!==locSeq)) return;
    feedFailure(key);
  });
}
