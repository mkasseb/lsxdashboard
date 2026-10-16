/* ============ STATIC IMAGES ============ */
// ===== Station Plot: live surface obs (temp/dew/wind) on a St. Louis-region Leaflet map =====
// Curated regional ASOS/METAR stations around the LSX CWA
/* The regional plot's stations. `n` is each site's name as api.weather.gov gives it (only the
   stray title-case "Of" corrected) — read out of /stations/<id> once and written down here rather
   than fetched, because these fifteen ASOS sites are as fixed as their coordinates are and the
   table already carries those. A four-letter code is the whole identity of a station to somebody
   who knows the network and nothing at all to everybody else; the name is what makes "SAR 75°" a
   place rather than a serial number. */
var STN_LIST=[
  {id:"KSTL",lat:38.75,lon:-90.37,n:"St. Louis Lambert International Airport"},
  {id:"KSUS",lat:38.66,lon:-90.65,n:"St. Louis, Spirit of St. Louis Airport"},
  {id:"KCPS",lat:38.57,lon:-90.16,n:"St. Louis Downtown Airport"},
  {id:"KALN",lat:38.89,lon:-90.05,n:"St. Louis Regional Airport"},
  {id:"KSET",lat:38.93,lon:-90.43,n:"St. Charles, St. Charles County Smartt Airport"},
  {id:"KBLV",lat:38.54,lon:-89.84,n:"Belleville, Scott AFB/MidAmerica Airport"},
  {id:"KUIN",lat:39.94,lon:-91.19,n:"Quincy Regional Airport-Baldwin Field"},
  {id:"KCOU",lat:38.82,lon:-92.22,n:"Columbia, Columbia Regional Airport"},
  {id:"KJEF",lat:38.59,lon:-92.16,n:"Jefferson City, Jefferson City Memorial Airport"},
  {id:"KFAM",lat:37.76,lon:-90.43,n:"Farmington Airport"},
  {id:"KVIH",lat:38.13,lon:-91.76,n:"Rolla / Vichy, Rolla National Airport"},
  {id:"KSAR",lat:38.14,lon:-89.70,n:"Sparta Community-Hunter Field Airport"},
  {id:"KMDH",lat:37.78,lon:-89.25,n:"Southern Illinois Airport"},
  {id:"KPPQ",lat:39.63,lon:-90.78,n:"Pittsfield, Pittsfield Penstone Municipal Airport"},
  {id:"KSLO",lat:38.64,lon:-88.96,n:"Salem, Salem-Leckrone Airport"}
];
/* Whatever we know a station identifier's name to be. Seeded from the table above and topped up by
   stationFor(), which was already fetching the name and dropping it on the floor. A station we
   cannot name simply gets no tooltip — a guess would be worse than the code alone. */
var STN_NAMES={};
STN_LIST.forEach(function(s){ STN_NAMES[s.id]=s.n; });
function stnName(id){ return STN_NAMES[id]||""; }
var stnMap=null, stnBase=null, stnLayer=null;
var stnObs=[], stnMode="temp";
function rhFromTd(tF,tdF){   // Magnus — lets us derive feels-like from what METAR actually reports
  if(tF==null||tdF==null) return null;
  var tC=(tF-32)/1.8, dC=(tdF-32)/1.8;
  var e=Math.exp((17.625*dC)/(243.04+dC)), es=Math.exp((17.625*tC)/(243.04+tC));
  return Math.max(1,Math.min(100,Math.round(100*e/es)));
}
function dewColor(d){
  if(d==null) return "#8a97a8";
  if(d<50) return "#7ec8ff";      // dry
  if(d<60) return "#3ecf8e";      // comfortable
  if(d<65) return "#e0b93a";      // sticky
  if(d<70) return "#ff9f43";      // humid
  return "#ff5a5f";               // oppressive
}
function windColor(m){
  if(m==null) return "#8a97a8";
  if(m<5) return "#8a97a8";
  if(m<12) return "#3ecf8e";
  if(m<20) return "#e0b93a";
  if(m<30) return "#ff9f43";
  return "#ff5a5f";
}
function stnValue(o,mode){
  if(mode==="dew") return o.dewF;
  if(mode==="feels") return o.feelsF;
  if(mode==="wind") return o.windMph;
  return o.tempF;
}
function stnColor(v,mode){
  if(mode==="dew") return dewColor(v);      // dew point and wind are different quantities —
  if(mode==="wind") return windColor(v);    // their own palettes are correct, not duplication
  return tChip(v);                          // temp & feels-like: the shared ramp
}
function stnMarkerHTML(o,mode,isExtreme){
  var v=stnValue(o,mode);
  if(v==null) return null;
  var id=o.id.replace(/^K/,""), col=stnColor(v,mode), inner;
  if(mode==="wind"){
    /* Speed without a direction is a VRB wind, not a calm one — METAR files VRB05KT when the
       direction is wandering, and the API hands that over as speed with a null direction. The
       chip shows the speed arrowless; only a true zero gets to say calm. */
    inner=(v>0)
      ? '<span class="stn2-w">'+(o.windDir!=null?'<span class="stn2-arrow" style="transform:rotate('+((o.windDir+180)%360)+'deg)">↑</span>':'')+v+'</span>'
      : "calm";
  }else{
    inner=v+"°";
  }
  return '<div class="stn2'+(isExtreme?" is-hi":"")+(o.stale?" is-old":"")+'" style="--c:'+col+'">'
    +'<div class="stn2-v">'+inner+'</div><div class="stn2-id">'+esc(id)+'</div></div>';
}
/* Code, then the place, then the readings, then WHEN — stacked lines rather than one run, because
   the name is the part a stranger needs and burying it mid-sentence between "KSTL" and "93° temp"
   would leave it as hard to find as it was to guess. The when-line is the qualifier for everything
   above it, and "stale" is the tooltip's word for a marker the map has already dimmed. */
/* One builder for the readings list, because it now has two readers: the hover/focus tooltip and
   the marker's aria-label. Two copies of "what counts as a reading" would drift the first time
   one of them learned a new field. */
function stnReadings(o){
  var b=[];
  if(o.tempF!=null) b.push(o.tempF+"° temp");
  if(o.feelsF!=null&&o.tempF!=null&&Math.abs(o.feelsF-o.tempF)>=2) b.push("feels "+o.feelsF+"°");
  if(o.dewF!=null) b.push(o.dewF+"° dew");
  if(o.rh!=null) b.push(o.rh+"% RH");
  // A moving wind with no direction is VRB, not calm — the compass part simply goes unsaid.
  if(o.windMph!=null) b.push(o.windMph>0?((o.windDir!=null?degToCompass(o.windDir)+" ":"")+o.windMph+" mph"):"calm");
  if(o.gustMph!=null&&o.gustMph>0) b.push("gusts "+o.gustMph);
  return b;
}
function stnAria(o){
  var nm=stnName(o.id);
  return o.id+(nm?", "+nm:"")+": "+stnReadings(o).join(", ")
    +(o.ts?", observed "+timeAgo(o.ts)+(o.stale?" (stale)":""):"");
}
function stnTip(o){
  var nm=stnName(o.id), b=stnReadings(o);
  return '<b>'+esc(o.id)+'</b>'
    +(nm?'<span class="stn-nm">'+esc(nm)+'</span>':'')
    +(b.length?'<span class="stn-rd">'+b.join(" · ")+'</span>':'')
    +(o.ts?'<span class="stn-when">'+(o.stale?"stale · ":"")+"observed "+timeAgo(o.ts)+'</span>':'');
}
function renderStnExtremes(){
  var el=document.getElementById("stnEx"); if(!el) return;
  // Stale obs plot (dimmed) but don't compete: "Warmest" from a three-hour-old reading is a
  // record of when the station broke, not of where it is hottest now.
  var list=stnObs.filter(function(o){ return o&&!o.stale&&stnValue(o,stnMode)!=null; });
  if(!list.length){ el.innerHTML=""; return; }
  function best(dir){
    var b=null;
    list.forEach(function(o){
      var v=stnValue(o,stnMode);
      if(!b||(dir>0?v>stnValue(b,stnMode):v<stnValue(b,stnMode))) b=o;
    });
    return b;
  }
  var hi=best(1), lo=best(-1), chips=[], unit=(stnMode==="wind")?" mph":"°";
  function chip(lbl,o){ if(o) chips.push('<span class="sx"><b>'+lbl+'</b> '+esc(o.id.replace(/^K/,""))+" "+stnValue(o,stnMode)+unit+'</span>'); }
  if(stnMode==="wind"){
    /* Only the windy end is a story here, so only hi competes for the marker ring — lo used to
       ride along into stnExtremeIds and put a ring on the calmest station that no chip ever
       explained. And "Windiest SUS 0 mph" on a still evening is the superlative outliving the
       thing it measures: a max of zero means calm IS the regional fact, so one chip says that. */
    lo=null;
    if(hi&&stnValue(hi,stnMode)===0){ hi=null; chips.push('<span class="sx">all stations calm</span>'); }
    chip("Windiest",hi);
    var g=null; stnObs.forEach(function(o){ if(o&&!o.stale&&o.gustMph!=null&&(!g||o.gustMph>g.gustMph)) g=o; });
    if(g&&g.gustMph>0) chips.push('<span class="sx"><b>Top gust</b> '+esc(g.id.replace(/^K/,""))+" "+g.gustMph+' mph</span>');
  }else if(stnMode==="dew"){
    chip("Muggiest",hi); chip("Driest",lo);
  }else{
    // "Warmest" is a claim about air temperature, and in Feels mode that isn't what's ranked.
    var fl=(stnMode==="feels");
    chip(fl?"Feels hottest":"Warmest",hi); chip(fl?"Feels coolest":"Coolest",lo);
    var spread=stnValue(hi,stnMode)-stnValue(lo,stnMode);
    if(spread>0) chips.push('<span class="sx"><b>Spread</b> '+spread+'°</span>');
  }
  var staleN=0; stnObs.forEach(function(o){ if(o&&o.stale) staleN++; });
  chips.push('<span class="sx sx-n">'+list.length+' stations'+(staleN?' · '+staleN+' stale':'')+'</span>');
  el.innerHTML=chips.join("");
  stnExtremeIds=[hi&&hi.id, lo&&lo.id];
}
var stnExtremeIds=[];
function renderStationLayer(){
  if(!stnMap||typeof L==="undefined") return;
  renderStnExtremes();                                  // sets stnExtremeIds, so markers can highlight them
  if(stnLayer){ stnMap.removeLayer(stnLayer); stnLayer=null; }
  var pairs=[];
  stnObs.forEach(function(o){
    if(!o) return;
    var html=stnMarkerHTML(o,stnMode,stnExtremeIds.indexOf(o.id)>=0);
    if(!html) return;
    var m=L.marker([o.lat,o.lon],{
      icon:L.divIcon({className:"stn-divicon",html:html,iconSize:[0,0],iconAnchor:[0,0]}),
      keyboard:true, riseOnHover:true
    });
    m.bindTooltip(stnTip(o),{className:"stn-tip",direction:"top",offset:[0,-16],sticky:false});
    pairs.push({m:m,o:o});
  });
  stnLayer=L.layerGroup(pairs.map(function(p){ return p.m; })).addTo(stnMap);
  /* keyboard:true above makes the chips tabbable, but that is only half a keyboard path —
     Leaflet 1.9's focus-opens-the-tooltip accessibility never fires for divIcon markers
     (verified against 1.9.4), so Tab landed on a chip and learned nothing. The two halves are
     wired by hand: the tooltip for eyes on focus, and an aria-label carrying the same facts for
     a screen reader, which won't reliably read a floating tooltip it isn't described by. This
     runs after addTo() because getElement() has nothing to return before the icon exists.
     The focus ring is CSS's problem: see .stn-divicon:focus-visible. */
  pairs.forEach(function(p){
    var el=p.m.getElement&&p.m.getElement(); if(!el) return;
    el.setAttribute("role","img");
    el.setAttribute("aria-label",stnAria(p.o));
    el.addEventListener("focus",function(){ p.m.openTooltip(); });
    el.addEventListener("blur",function(){ p.m.closeTooltip(); });
  });
}
function initStnTools(){
  var t=document.getElementById("stnTools"); if(!t) return;
  t.addEventListener("click",function(e){
    var b=e.target.closest("button[data-m]"); if(!b) return;
    stnMode=b.getAttribute("data-m");
    [].forEach.call(t.querySelectorAll("button"),function(x){ x.classList.toggle("on",x===b); });
    renderStationLayer();
  });
}
function initStationMap(style){
  var el=document.getElementById("stnmap");
  if(typeof L==="undefined"||!L.maplibreGL||!el){
    if(el) el.innerHTML='<div class="imgfail">Map didn\u2019t load. <a href="https://www.weather.gov/wrh/timeseries?site=KSTL" target="_blank" rel="noopener">Open NWS obs \u2197</a></div>';
    return;
  }
  // Frame the station network itself (not the user's saved location, which may be far away).
  // fitBounds rather than a fixed zoom: the card's width changes with the masonry, and a fixed
  // zoom clipped the outer stations off the edges.
  var _cLat=0,_cLon=0; STN_LIST.forEach(function(s){_cLat+=s.lat;_cLon+=s.lon;}); _cLat/=STN_LIST.length; _cLon/=STN_LIST.length;
  stnMap=L.map(el,{zoomControl:true,attributionControl:true,scrollWheelZoom:false,minZoom:5,maxZoom:10}).setView([_cLat,_cLon],7);
  stnMap.attributionControl.setPrefix(false);
  var stnBounds=L.latLngBounds(STN_LIST.map(function(s){ return [s.lat,s.lon]; }));
  // Initial/settled framing is geometry, not a gesture. A same-zoom animated pan can
  // outlive a failed GL initialization and interrupt Leaflet's partial-map teardown.
  function fitStations(){ if(stnMap) stnMap.fitBounds(stnBounds,{padding:[30,26],animate:false}); }
  fitStations();
  stnBase=L.maplibreGL({style:mapStylePart(style,"all"),attributionControl:false}).addTo(stnMap);
  stnMap.attributionControl.addAttribution('&copy; <a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  setTimeout(function(){ if(stnMap){ stnMap.invalidateSize(); fitStations(); } },250);
  setTimeout(function(){ if(stnMap){ stnMap.invalidateSize(); fitStations(); } },1200);  // after masonry settles the card width
  initStnTools();
  // no loadStationPlot() here — refreshAll() runs right after init and fetches the obs once
}
var stationThemeSeq=0;
function updateStationBase(){
  if(!stnBase) return;
  var theme=effectiveLight()?"light":"dark", seq=++stationThemeSeq;
  loadMapStyle(theme).then(function(style){
    if(seq===stationThemeSeq) stnBase.getMaplibreMap().setStyle(mapStylePart(style,"all"));
  }).catch(function(e){ console.warn("Station basemap theme failed:",e); });
}
/* Staleness cutoffs. /observations/latest never admits how old "latest" is — a wedged ASOS keeps
   serving its final report, and it plotted here with the same standing as a five-minute-old ob,
   eligible to win "Warmest". Two hours (a missed hourly cycle, plus slack for the specials-only
   quiet stretches) demotes an ob to stale: still drawn, but dimmed and barred from the extremes.
   Six hours removes it — by then the number is trivia about the station, not weather. */
var STN_STALE_MS=WeatherContracts.policy.observationAge, STN_DEAD_MS=WeatherContracts.policy.stationRetention;
/* Last good ob per station. api.weather.gov throws intermittent 5xx, and catch→null traded a
   ten-minute-old reading for a hole in the map until the next 12-minute cycle. A failed fetch
   now falls back to this cache; the cutoffs above are what keep the fallback honest — a cached
   ob ages into stale and then off the map exactly like a served one. */
var _stnLast={};
