/* ============ SKY MAP (NWS radar + GOES satellite + warning polygons) ============ */
var rvMap=null, rvBase=null, rvMarker=null, nwsRadar=null, warnLayer=null, warnCase=null;
var satLayer=null, baseLabels=null;
var NWS_WMS="https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows";
var KLSX_WMS="https://opengeo.ncep.noaa.gov/geoserver/klsx/ows";
var RADAR_VIEW_KEY="lsxRadarView_v1", radarView={source:"klsx",product:"reflectivity"};
try{
  var savedRadarView=JSON.parse(localStorage.getItem(RADAR_VIEW_KEY)||"null");
  if(savedRadarView){
    radarView.source=savedRadarView.source==="regional"?"regional":"klsx";
    radarView.product=radarView.source==="klsx"&&savedRadarView.product==="velocity"?"velocity":"reflectivity";
  }
}catch(e){}
function radarProduct(){
  if(radarView.source==="regional") return {url:NWS_WMS,layer:"conus_bref_qcd",label:"Regional reflectivity"};
  return {url:KLSX_WMS,layer:radarView.product==="velocity"?"klsx_sr_bvel":"klsx_sr_bref",
    label:"KLSX "+(radarView.product==="velocity"?"velocity":"reflectivity")};
}
function createRadarLayer(time){
  var p=radarProduct(), options={layers:p.layer,format:"image/png",transparent:true,
    opacity:time?0:RADAR_OPACITY,version:"1.3.0",pane:"radarPane"};
  if(time) options.time=time;
  var layer=L.tileLayer.wms(p.url,options);
  bindSkyHealth(layer);
  return layer;
}
/* 0.9, not the 0.8 it launched with. The 0.8 was tuned when reflectivity sat straight on a dark
   basemap and needed to let the geography through; over the dimmed cloud shield the geography
   comes through the labels pane instead, and the extra tenth is what keeps LIGHT rain — the low,
   translucent end of the ramp — from vanishing into cloud texture. One constant because three
   call sites (the fallback layer, its refresh, and every pooled frame) must agree or a scrub
   would visibly change the weather's weight. */
var RADAR_OPACITY=0.9;
/* NASA GIBS serves GOES-East GeoColor as WMTS in the map's own projection (EPSG:3857), which is
   the whole reason the satellite can be a LAYER now instead of a separate view. The old source \u2014
   NESDIS's `SECTOR/umv/GEOCOLOR/600x600.jpg` \u2014 is a finished picture in a fixed frame: nothing in
   it says where its corners are, and its projection isn't the map's, so it could never be made to
   sit on top of the radar. This is the same imagery, tiled and georeferenced.

   Two details of the endpoint decide the code below:
   \u00b7 The path is {TileMatrix}/{TileRow}/{TileCol} \u2014 i.e. z/y/x, NOT Leaflet's usual z/x/y order.
   \u00b7 Leaving the time segment out ("\u2026/default/GoogleMapsCompatible_Level7/\u2026") resolves to the newest
     frame GIBS has, and it answers `no-store`. Asking for an explicit timestamp is worse on both
     counts: the archive has gaps (a missing 10-minute slot is a hard 404, so a computed "now minus
     latency" guess would blank the layer), and a dated URL is cacheable, which is the opposite of
     what a live panel wants. Undated + no-store means a fresh layer object always fetches current
     pixels with no cache-buster in the URL. */
var GIBS_SAT="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png";
/* GoogleMapsCompatible_Level7 means levels 0\u20137 exist; z8 and beyond answer HTTP 400. maxNativeZoom
   lets Leaflet upscale past that instead of requesting tiles that aren't there and leaving holes.
   Nothing is lost by stopping at 7: ABI GeoColor is 2 km data, and z7 is already finer than that. */
var SAT_MAX_NATIVE=7;
function effectiveLight(){
  // data-theme always holds the resolved theme; the "auto" pref never reaches the DOM
  return document.documentElement.getAttribute("data-theme")==="light";
}
/* CARTO's raster variants now require an API key. OpenFreeMap serves keyless vector styles, so
   split each style at its symbol layers: geometry stays below weather; place and road labels stay
   in labelPane above radar and satellite. The station plot uses the complete style. */
var mapStylePromises={};
function loadMapStyle(theme){
  if(!mapStylePromises[theme]){
    mapStylePromises[theme]=getJSON("https://tiles.openfreemap.org/styles/"+(theme==="light"?"positron":"dark"))
      .then(function(style){
        if(!WeatherContracts.mapStyle(style)) throw new Error("Invalid basemap style");
        return style;
      })
      .catch(function(e){ delete mapStylePromises[theme]; throw e; });
  }
  return mapStylePromises[theme];
}
function mapStylePart(style,part){
  var copy=JSON.parse(JSON.stringify(style));
  /* OpenFreeMap's dark style references circle-11 in three place layers, but that sprite is
     absent from the published sprite sheet. Names still render without the decorative icon. */
  copy.layers.forEach(function(l){
    if(l.layout && JSON.stringify(l.layout["icon-image"]||"").indexOf("circle-11")>=0) delete l.layout["icon-image"];
  });
  if(part!=="all") copy.layers=copy.layers.filter(function(l){
    return part==="labels" ? l.type==="symbol" : l.type!=="symbol";
  });
  if(part==="labels") copy.layers.forEach(function(l){
    if(l.layout && l.layout["text-field"]){
      l.paint=l.paint||{};
      l.paint["text-color"]="#fff";
      l.paint["text-halo-color"]="#152033";
      l.paint["text-halo-width"]=1.5;
    }
  });
  return copy;
}
var mapThemeSeq=0;
function updateRadarBase(){
  if(!rvBase||!baseLabels) return;
  var theme=effectiveLight()?"light":"dark", seq=++mapThemeSeq;
  loadMapStyle(theme).then(function(style){
    if(seq!==mapThemeSeq) return;
    rvBase.getMaplibreMap().setStyle(mapStylePart(style,"base"));
    baseLabels.getMaplibreMap().setStyle(mapStylePart(style,"labels"));
  }).catch(function(e){ console.warn("Basemap theme failed:",e); });
}
/* ---- Is the sky actually drawing? ---------------------------------------
   A tile layer that fails leaves the basemap showing, and a bare basemap under this card is
   exactly what a calm evening looks like. Every other feed on this page fails LOUDLY — the alert
   list says so, the metrics show a dash — but a dead radar renders as "no precipitation", which is
   the one wrong answer a weather dashboard must never give confidently. Nothing was watching:
   `.imgfail` covers only the case where Leaflet itself never loaded.

   Counting is PER LAYER, not per session, and that is the whole trick. A shared counter cannot
   work here because the loop POOLS layers: on a refresh, fourteen frames are already painted and
   silent (their tiles are cached <img>s that re-fire nothing), so a session counter reset each
   cycle would see one new frame's failures against zero fresh successes and cry outage while the
   map was drawing perfectly. Asking the newest layer about its OWN tiles has no such blind spot.

   "Down" is deliberately strict — errors AND not one tile through. Radar tiles 404 at the edges of
   the mosaic all the time, and a key that flickers to red on ordinary noise is worse than no key.
   Panned somewhere the layer requests nothing, both counters stay 0 and nothing is claimed. */
function bindSkyHealth(lyr){
  if(!lyr||lyr._hb) return;
  lyr._hb=1; lyr._ok=0; lyr._err=0;
  lyr.on("tileload", function(){ lyr._ok++;  syncSkyHealth(); });
  lyr.on("tileerror",function(){ lyr._err++; syncSkyHealth(); });
}
function layerDown(lyr){ return !!(lyr && lyr._err>0 && !lyr._ok); }
/* The newest frame is the one the badge is talking about, so it is the one asked. With no frame
   list (capabilities failed, or reflectivity just came back) the fallback layer is what's drawing. */
function radarDown(){
  if(!skyOn.radar) return false;
  return radarFrames.length ? layerDown(radarFrames[radarFrames.length-1].layer) : layerDown(nwsRadar);
}
function satDown(){ return !!skyOn.sat && layerDown(satLayer); }
/* Tile events fire per tile — dozens per pan — and both sinks below rewrite innerHTML. Redraw only
   when the ANSWER changes, not when the evidence does. */
var skyHealth={radar:null, sat:null};
function syncSkyHealth(){
  var r=radarDown(), s=satDown();
  if(r===skyHealth.radar && s===skyHealth.sat) return;
  skyHealth.radar=r; skyHealth.sat=s;
  syncRadarBadge();
  syncSkyMeta();
}
function initRadarMap(style){
  var el=document.getElementById("radar");
  if(typeof L==="undefined"||!L.maplibreGL||!el){
    if(el) el.innerHTML='<div class="imgfail">Map didn\u2019t load. <a href="https://radar.weather.gov/station/KLSX/standard" target="_blank" rel="noopener">Open KLSX radar \u2197</a></div>';
    return;
  }
  rvMap=L.map(el,{zoomControl:true,attributionControl:true,scrollWheelZoom:true,minZoom:4,maxZoom:12}).setView([current.lat,current.lon],7);
  rvMap.attributionControl.setPrefix(false);
  /* Reflectivity gets its own pane purely for STACKING (visibility is handled by adding and
     removing the layers \u2014 see detachRadarLayers). It sits above the tiles at 200 and below the
     overlays at 400, which is exactly where it belongs visually: on the clouds, under the warning
     polygons. A pane rather than another zIndex on each layer, because the loop creates ~10 of
     them at runtime and they would all have to agree with whatever the satellite is using.
     Warnings deliberately do NOT toggle with reflectivity \u2014 someone who turns it off to look at
     the cloud shield still needs to see where the warning is. */
  rvMap.createPane("radarPane").style.zIndex=350;
  /* The satellite gets a pane of its own for a different reason than the radar did: not stacking
     order (a zIndex on the layer handled that for years) but so CSS can reach the IMAGERY alone.
     The sat-dim filter — see the rule on #radar.sat-dim — must darken the cloud tops without
     touching the place names. 250 keeps the imagery above the basemap tiles (200) and under
     reflectivity (350). The LABELS go above the reflectivity too — 375, under the overlays at 400
     — because a name legible only in clear air answers no question anyone asks a radar: "is that
     cell over Springfield" is exactly the moment the name must survive. Warning polygons still
     out-rank the labels; a label the storm can't bury, a box nothing can. */
  rvMap.createPane("satPane").style.zIndex=250;
  rvMap.createPane("labelPane").style.zIndex=375;
  rvBase=L.maplibreGL({style:mapStylePart(style,"base"),attributionControl:false,
    /* Only the BASEMAP is credited here. The NOAA and NASA lines used to ride along, and on a
       375px phone the four of them wrapped to three lines — 46px over a 236px map, a fifth of the
       picture, sitting on top of southern Missouri. They were never load-bearing: #rsCap under the
       map names every source that is drawing, and the footer links all of them. Basemap credits stay
       on the map itself; NOAA imagery is public domain and NASA
       GIBS asks for acknowledgement, which the caption gives. Every source is still credited on
       the page — the credits just stopped being drawn over the weather. */
    pane:"tilePane"}).addTo(rvMap);
  rvMap.attributionControl.addAttribution('&copy; <a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  satLayer=L.tileLayer(GIBS_SAT,{maxZoom:12,maxNativeZoom:SAT_MAX_NATIVE,pane:"satPane"});
  bindSkyHealth(satLayer);
  /* Added unconditionally, not tied to the satellite the way it used to be: the nolabels basemap
     carries no names of its own, so this layer is the map's ONLY geography text now and every
     combination of toggles needs it. */
  baseLabels=L.maplibreGL({style:mapStylePart(style,"labels"),pane:"labelPane",attributionControl:false}).addTo(rvMap);
  /* Added straight away, not left for the catch in refreshRadarLayer(): the capabilities fetch
     takes a moment, and this paints reflectivity NOW rather than showing an empty map until the
     frame list resolves. The success path removes it once the pooled frames can drive.
     Constructed either way, added only if reflectivity is on — addTo() starts fetching tiles the
     moment it runs, and a visitor who left the layer off last time should not pay for a sweep the
     next line would immediately take away again. */
  nwsRadar=createRadarLayer();
  if(skyOn.radar) nwsRadar.addTo(rvMap);
  /* A divIcon rather than a circleMarker so the mark can be MORE than a disc — the .me-pin CSS
     owns its look (halo, pulse) for the reasons given there. markerPane sits at 600, over the
     warning polygons: being findable inside a warning is the moment the pin earns its keep. */
  rvMarker=L.marker([current.lat,current.lon],{
    icon:L.divIcon({className:"me-pin",iconSize:[16,16],iconAnchor:[8,8]}),
    interactive:false,keyboard:false
  }).addTo(rvMap);
  applySkyLayers(true);
  setTimeout(function(){ if(rvMap) rvMap.invalidateSize(); },250);
  /* The radar now stretches to whatever height the hero column ends up at, and that height moves
     as feeds land — not only on window resize, which is the only thing Leaflet watches by itself.
     Without this the map keeps its first-measured size and renders into a stale viewport. */
  if(window.ResizeObserver){
    var rvRO=new ResizeObserver(function(){ if(rvMap) rvMap.invalidateSize(false); });
    rvRO.observe(el);
  }
  /* zoomend, not zoomstart: the target zoom is only settled once the animation lands, and the
     budget is a function of it. The surplus layers come off a beat after the gesture rather than
     before it, which costs one round of tiles on the way out and saves every pan afterwards. */
  rvMap.on("zoomend",rebuildRadarFramesForView);
  initRadarCtl();
  refreshRadarLayer();
  loadWarnPolygons(undefined);  // draw from cache if alerts already arrived
  drawMcdPolygons();            // same deal for any mesoscale discussion that beat the map here
  drawWatchPolygons();          // …and any watch fills
}
/* ---- RADAR LOOP ----------------------------------------------------------
   The WMS advertises ~2 h of past sweeps in its time dimension, and honours a
   `time` param on GetMap, so a loop is just N stacked layers we cross-fade by
   opacity. Frames are POOLED by timestamp: a refresh reuses the layers it already
   has and only fetches the genuinely new sweep, instead of re-downloading the set.
   If the capabilities fetch fails we fall back to the plain "latest" layer. */
/* How much history the loop should COVER, and separately how many frames we will spend covering
   it. Two numbers, because the cadence is not ours to choose: NWS publishes conus_bref_qcd every
   ~2 minutes today, and "the last N sweeps" silently means whatever that cadence happens to be.
   Ten sweeps read as a 30-minute loop in the button's tooltip and measured 18 (10 on a phone,
   at six) — long enough to prove a storm exists, far too short to show where it is going, which
   is the only question a loop answers. An hour is the useful unit and 60 fits comfortably inside
   the ~118 minutes the time dimension advertises. Thinning to fit keeps the number honest if NWS
   ever changes the cadence again; nothing downstream hard-codes a duration. */
var RADAR_SPAN_MIN=60;
/* The third budget is about ZOOM, not screen size, and it is the one that was missing. Every pooled
   frame refetches on a view change, and at low zoom each GetMap covers far more ground — measured
   against the live WMS, a median 5.9s per tile at z4 (p95 10.1s) against 120 requests for fifteen
   frames, ~8 seconds before the set was whole again. The loop meanwhile kept stepping on its 450ms
   timer onto frames whose tiles had not arrived, which paints nothing and reads as "the loop
   broke". Detail is not what a z4 view is for anyway: seven frames still show an hour of motion at
   synoptic scale, for roughly half the requests. */
var RADAR_N_DESK=15, RADAR_N_PHONE=8, RADAR_N_WIDE=7, RADAR_WIDE_ZOOM=5;
var radarFrames=[], radarPool={}, radarIdx=-1, radarBuildGen=0, radarRequestGen=0;
var radarPlaying=false, radarTimer=null, radarUserPaused=false;
function radarFrameCount(){
  if(rvMap && rvMap.getZoom()<=RADAR_WIDE_ZOOM) return RADAR_N_WIDE;
  return (window.innerWidth<=680)?RADAR_N_PHONE:RADAR_N_DESK;
}
/* The frame list is rebuilt on zoom, not only on the 4-minute refresh. A zoom-dependent budget that
   waited for the next refresh would leave fifteen layers refetching across a continent-wide view
   for up to four minutes — precisely the stampede the budget exists to prevent. Cached times rather
   than a fresh capabilities fetch: this fires on a gesture, and the sweep list has not changed. */
var radarTimesCache=[];
function rebuildRadarFramesForView(){
  if(!rvMap||!skyOn.radar||!radarTimesCache.length) return;
  // Same budget as last time means pickRadarTimes returns the same set; touching the pool would
  // tear down layers only to rebuild them identically.
  if(pickRadarTimes(radarTimesCache).length===radarFrames.length) return;
  var wasLatest=(radarIdx<0)||(radarIdx>=radarFrames.length-1);
  buildRadarFrames(radarTimesCache);   // drops the surplus layers off the map along the way
  showRadarFrame(wasLatest?radarFrames.length-1:Math.min(radarIdx,radarFrames.length-1));
  updateRadarCtl();
}
/* Thin an hour of 2-minute sweeps down to a frame budget, on a grid anchored to the EPOCH.
   The epoch anchoring is the load-bearing part and it is not obvious. radarPool keys on the
   timestamp string, so pooling only pays off if a refresh asks for the same timestamps it asked
   for last time. Striding backwards from "now" — the obvious implementation — fails exactly that
   test: two fresh sweeps land, every stride lands two slots earlier, and all fifteen frames miss
   the pool and re-download. Against a fixed grid the same wall-clock instants keep resolving to
   the same sweeps, so a refresh costs the one genuinely new frame, which is what the pool was
   built to do. Snapping is bounded to half a step so a gap in the archive drops a frame rather
   than silently substituting a sweep from the wrong end of the window. */
function pickRadarTimes(times){
  var n=radarFrameCount();
  // Station scans have a different cadence and a two-hour archive. Trim BEFORE the budget
  // shortcut, or a phone can accidentally label the whole archive as a one-hour loop.
  var cutoff=Date.parse(times[times.length-1])-RADAR_SPAN_MIN*60000;
  times=times.filter(function(t){ return Date.parse(t)>=cutoff; });
  if(times.length<=n) return times.slice();
  var ms=times.map(function(t){ return +new Date(t); });
  var newest=ms[ms.length-1], oldest=newest-RADAR_SPAN_MIN*60000;
  var step=Math.max(1,Math.round(RADAR_SPAN_MIN/(n-1)))*60000, half=step/2;
  var want=[], seen={};
  for(var g=Math.floor(newest/step)*step; g>=oldest && want.length<n-1; g-=step){
    var best=-1, bd=half;
    for(var i=0;i<ms.length;i++){
      var d=Math.abs(ms[i]-g);
      if(d<=bd){ bd=d; best=i; }
    }
    // The newest sweep is appended below no matter what; picking it here too would spend a slot.
    if(best>=0 && ms[best]!==newest && !seen[times[best]]){ seen[times[best]]=1; want.push(times[best]); }
  }
  want.push(times[times.length-1]);   // "now" is always present and always last — the scrubber's right edge is it
  want.sort(function(a,b){ return new Date(a)-new Date(b); });
  return want;
}
/* What the frame list actually spans, in minutes. Every duration shown to a visitor is derived
   from this rather than asserted, which is the fix for a tooltip that spent two years describing
   a loop the page was not building. */
function radarSpanMin(){
  if(radarFrames.length<2) return 0;
  return Math.round((new Date(radarFrames[radarFrames.length-1].time)-new Date(radarFrames[0].time))/60000);
}
function fetchRadarTimes(product){
  product=product||radarProduct();
  return getText(product.url+"?service=WMS&version=1.3.0&request=GetCapabilities")
    .then(function(xml){
      // The station workspace advertises several products with independent scan histories.
      // Read the selected layer's dimension, never the first time dimension in the document.
      var doc=new DOMParser().parseFromString(xml,"text/xml"), dimension=null;
      var layers=doc.getElementsByTagNameNS("*","Layer");
      for(var i=0;i<layers.length;i++){
        var children=layers[i].children, name=null, time=null;
        for(var j=0;j<children.length;j++){
          if(children[j].localName==="Name") name=children[j].textContent.trim();
          if(children[j].localName==="Dimension"&&children[j].getAttribute("name")==="time") time=children[j];
        }
        if(name&&name.split(":").pop()===product.layer){ dimension=time; break; }
      }
      if(!dimension) throw new Error("no selected radar time dimension");
      var list=dimension.textContent.split(",").map(function(s){return s.trim();})
        .filter(function(s){return /^\d{4}-\d\d-\d\dT/.test(s)&&isFinite(Date.parse(s));});
      list=list.filter(function(t,i){return list.indexOf(t)===i;}).sort(function(a,b){return Date.parse(a)-Date.parse(b);});
      if(!list.length) throw new Error("empty time list");
      return list;
    });
}
/* Add the newest sweep first, then admit at most two historical frames at a time. A cold load used
   to add every selected WMS layer in one synchronous loop: fifteen layers times the visible tile
   grid could occupy the host connection pool before the rest of the dashboard had painted. The
   pool still owns every selected timestamp immediately, but its network work is staged. */
function preloadRadarFrames(layers,gen){
  var q=(layers||[]).filter(function(lyr){ return !rvMap.hasLayer(lyr); }).reverse();
  if(!q.length||gen!==radarBuildGen) return;
  function add(lyr,done){
    if(gen!==radarBuildGen||!skyOn.radar){ done(); return; }
    if(rvMap.hasLayer(lyr)){ done(); return; }
    var released=false, timer=null;
    function release(){
      if(released) return; released=true;
      if(timer) clearTimeout(timer);
      lyr.off("load",release);
      updateRadarCtl();
      done();
    }
    lyr.once("load",release);
    timer=setTimeout(release,9000);   // one broken layer cannot stop the queue forever
    lyr.addTo(rvMap);
  }
  function pump(){
    if(gen!==radarBuildGen||!skyOn.radar||!q.length) return;
    add(q.shift(),pump);
  }
  // The current picture goes first. Historical preloads start only after it settles.
  add(q.shift(),function(){ pump(); pump(); });
}
function buildRadarFrames(times){
  var gen=++radarBuildGen;
  var want=pickRadarTimes(times), keep={};
  radarFrames=want.map(function(t){
    keep[t]=1;
    var lyr=radarPool[t];
    if(!lyr){
      lyr=createRadarLayer(t);
      lyr.on("load",function(){ lyr._ready=1; updateRadarCtl(); });
      radarPool[t]=lyr;
    }
    return {time:t, layer:lyr};
  });
  Object.keys(radarPool).forEach(function(t){   // release sweeps that aged out of the window
    if(!keep[t]){ if(rvMap.hasLayer(radarPool[t])) rvMap.removeLayer(radarPool[t]); delete radarPool[t]; }
  });
  preloadRadarFrames(radarFrames.map(function(f){ return f.layer; }),gen);
  syncSkyHealth(); // The newest layer is new evidence, even if the previous layer was down.
}
/* A sweep this old is not "now" no matter what the clock face says. Three missed cycles: the
   scheduler re-reads the time dimension every 4 minutes, so anything past ~15 means the feed has
   genuinely stalled rather than that one refresh was unlucky. */
var RADAR_STALE_MIN=15;
var radarFallback=false;   // capabilities failed; the plain "latest" layer is carrying the card
/* One owner for the badge. It used to be written from two places that knew different things —
   showRadarFrame() had the timestamp, the catch in refreshRadarLayer() had the failure — and
   neither could say the thing that actually matters, which is whether what you are looking at is
   current. Everything it needs is module state, so every caller just says "re-decide". */
function syncRadarBadge(){
  var lbl=document.getElementById("radarTime");
  if(!lbl) return;
  lbl.className="radar-time";
  if(!rvMap){lbl.textContent=typeof mapBoot!=="undefined"&&mapBoot.phase==="error"?"map unavailable":"loading map…";return;}
  if(!skyOn.radar){ lbl.textContent=""; return; }
  if(radarDown()){ lbl.textContent="radar unavailable"; lbl.classList.add("down"); return; }
  if(!radarFrames.length){
    // No frame list, but the fallback layer is painting: say it is live without inventing a time.
    lbl.textContent=radarFallback?"latest sweep":"";
    return;
  }
  var i=Math.max(0,Math.min(radarFrames.length-1,radarIdx));
  var t=new Date(radarFrames[i].time), latest=(i===radarFrames.length-1);
  var hhmm=t.toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric",minute:"2-digit"});
  var age=Math.round((Date.now()-new Date(radarFrames[radarFrames.length-1].time))/60000);
  if(latest && age>=RADAR_STALE_MIN){
    // The dangerous case: a real sweep, drawn correctly, quietly an hour out of date.
    lbl.textContent="sweep "+hhmm+" · "+age+" min old";
    lbl.classList.add("down");
    return;
  }
  lbl.textContent=(latest?"sweep ":"")+hhmm;
  if(!latest) lbl.classList.add("past");
}
function showRadarFrame(i){
  if(!radarFrames.length) return;
  i=Math.max(0,Math.min(radarFrames.length-1,i));
  radarIdx=i;
  radarFrames.forEach(function(f,k){ f.layer.setOpacity(k===i?RADAR_OPACITY:0); });
  var t=new Date(radarFrames[i].time), latest=(i===radarFrames.length-1);
  syncRadarBadge();
  var ft=document.getElementById("radarFrameTime");
  if(ft){
    var mins=Math.round((new Date(radarFrames[radarFrames.length-1].time)-t)/60000);
    ft.textContent=latest?"now":("−"+mins+" min");
  }
  var sl=document.getElementById("radarSlider");
  if(sl && +sl.value!==i) sl.value=i;
  syncSatToRadar();   // the cloud shield follows the moment the radar is showing
}
function radarFramesReady(){
  return radarFrames.length>1 && radarFrames.every(function(f){ return f.layer._ready; });
}
function radarFramesAttached(){
  return !!rvMap && radarFrames.length>1 && radarFrames.every(function(f){ return rvMap.hasLayer(f.layer); });
}
function updateRadarCtl(){
  var ctl=document.getElementById("radarCtl"), sl=document.getElementById("radarSlider");
  if(!ctl||!sl) return;
  if(radarFrames.length>1){
    ctl.classList.add("ready");
    sl.max=radarFrames.length-1;
    if(radarIdx>=0) sl.value=Math.min(radarIdx,radarFrames.length-1);
    sl.disabled=!radarFramesAttached();
  }else{
    ctl.classList.remove("ready");
    sl.disabled=true;
  }
  setRadarBtn();   // the span the button advertises changes with the frame list, so re-derive it here
}
function setRadarBtn(){
  var b=document.getElementById("radarPlay");
  if(!b) return;
  /* The duration comes off the frame list every time rather than from a constant. A screen reader
     gets it too — the tooltip is mouse-only, and "how far back does this go" is not a sighted-user
     question. Before frames land there is no honest number, so it says nothing instead. */
  var span=radarSpanMin(), of=span?(" — last "+span+" minutes"):"";
  b.innerHTML=radarPlaying?ic("pause")+"Pause":ic("play")+"Loop";
  b.disabled=radarFrames.length>1&&!radarFramesAttached();
  b.setAttribute("aria-label",(radarPlaying?"Pause radar loop":"Play radar loop")+of);
  b.title=span?("Play the last "+span+" minutes"):"Play the radar loop";
}
/* "Every frame has its tiles for the CURRENT view", which is a different question from _ready —
   that flag is set by the first load ever and never cleared, so it stays true through a zoom that
   has invalidated every tile behind it. Leaflet's own _loading is the live answer. */
function radarFramesPainted(){
  return radarFrames.length>1 && radarFrames.every(function(f){
    return rvMap.hasLayer(f.layer)&&!f.layer._loading;
  });
}
var radarHoldSince=0, RADAR_HOLD_MAX=9000;
function setRadarLoading(on){
  var el=document.getElementById("radarLoad");
  if(el) el.textContent=on?"loading frames…":"";
}
function radarStep(){
  if(!radarPlaying||!radarFrames.length) return;
  /* A view change makes every pooled frame refetch at once. Advancing through frames whose tiles
     have not landed draws blank sweeps at 450ms apiece, which looks like a broken loop rather than
     a busy one — the bug report that prompted this was exactly that. Hold on the frame that IS
     painted and say why.
     Bounded, though: a frame that never finishes must not freeze the loop for good. Leaflet clears
     _loading on tile ERRORS too, so this should not trigger in practice — it is here because
     "should not" is not a guarantee to hand a control the visitor is watching. */
  if(!radarFramesPainted()){
    if(!radarHoldSince) radarHoldSince=Date.now();
    if(Date.now()-radarHoldSince < RADAR_HOLD_MAX){
      setRadarLoading(true);
      radarTimer=setTimeout(radarStep,400);
      return;
    }
  }
  radarHoldSince=0;
  setRadarLoading(false);
  var next=(radarIdx+1)%radarFrames.length;
  showRadarFrame(next);
  radarTimer=setTimeout(radarStep, next===radarFrames.length-1?1400:450);  // hold on the newest sweep
}
function radarPlayLoop(){
  if(radarPlaying||radarFrames.length<2) return;
  radarPlaying=true; setRadarBtn();
  if(radarIdx>=radarFrames.length-1) showRadarFrame(0);
  radarTimer=setTimeout(radarStep,450);
}
function radarPauseLoop(){
  radarPlaying=false;
  if(radarTimer){ clearTimeout(radarTimer); radarTimer=null; }
  radarHoldSince=0; setRadarLoading(false);   // nothing is waiting on tiles once nothing is stepping
  setRadarBtn();
  /* Playback skipped every sync on purpose; stopping is the moment the visitor started looking, so
     the satellite catches up to wherever they landed. */
  syncSatToRadar();
}
function initRadarCtl(){
  var b=document.getElementById("radarPlay"), sl=document.getElementById("radarSlider");
  if(b) b.addEventListener("click",function(){
    if(radarPlaying){ radarUserPaused=true; radarPauseLoop(); }
    else { radarUserPaused=false; radarPlayLoop(); }
  });
  if(sl) sl.addEventListener("input",function(){
    radarUserPaused=true; radarPauseLoop();     // scrubbing means "I'm driving"
    showRadarFrame(+sl.value);
  });
}
function refreshRadarLayer(){
  if(!rvMap) return ensureMaps();
  if(!skyOn.radar) return;   // layer switched off fetches nothing; applySkyLayers refreshes on the way back
  var request=++radarRequestGen, product=radarProduct();
  return fetchRadarTimes(product).then(function(times){
    if(request!==radarRequestGen||!skyOn.radar) return;
    var wasLatest=(radarIdx<0)||(radarIdx>=radarFrames.length-1);
    radarFallback=false;
    radarTimesCache=times;   // lets a zoom re-pick the frame set without another capabilities fetch
    buildRadarFrames(times);
    if(nwsRadar&&rvMap.hasLayer(nwsRadar)) rvMap.removeLayer(nwsRadar);   // frames drive from here
    showRadarFrame(wasLatest?radarFrames.length-1:radarIdx);              // don't yank a scrubbing user to "now"
    updateRadarCtl();
  }).catch(function(){
    if(request!==radarRequestGen||!skyOn.radar) return;
    // No usable time list → behave exactly like the pre-loop dashboard: single latest layer, no fake time
    radarFallback=true;
    if(nwsRadar){
      if(!rvMap.hasLayer(nwsRadar)) nwsRadar.addTo(rvMap);
      nwsRadar.setOpacity(RADAR_OPACITY); nwsRadar.setParams({_t:Date.now()});
    }
    /* This used to blank the badge, which left a live map with nothing on it saying so — and left
       a DEAD map looking identical. syncRadarBadge() distinguishes the two: "latest sweep" while
       the fallback is painting, "radar unavailable" once its tiles start failing. Frames are NOT
       cleared here: one unlucky capabilities fetch should not demolish a loop that is already
       built and still current. If the outage persists the frames simply age, and the staleness
       rule in syncRadarBadge() says so on its own.
       updateRadarCtl() rather than dropping .ready by hand — with frames still standing the
       scrubber is still meaningful, and unconditionally hiding it stranded a working loop. */
    syncRadarBadge();
    updateRadarCtl();
  });
}
/* Weights and fills re-tuned against the bright satellite, not the dark basemap they were born
   on: a shade heavier, a shade fuller, ordered so the deadliest boxes read first. The tornado
   entry alone carries a className — see .warn-tor for what it buys and who it excludes. */
function warnStyle(ev){
  ev=(ev||"").toLowerCase();
  if(ev.indexOf("tornado")>=0)            return {color:"#ff2d55",weight:3,fillColor:"#ff2d55",fillOpacity:.20,className:"warn-tor"};
  if(ev.indexOf("severe thunderstorm")>=0)return {color:"#ffb020",weight:3,fillColor:"#ffb020",fillOpacity:.18};
  if(ev.indexOf("flash flood")>=0)        return {color:"#3ecf8e",weight:3,fillColor:"#3ecf8e",fillOpacity:.18};
  if(ev.indexOf("flood")>=0)              return {color:"#2e8b57",weight:2.5,fillColor:"#2e8b57",fillOpacity:.14};
  if(ev.indexOf("special marine")>=0||ev.indexOf("special weather")>=0) return {color:"#4aa3ff",weight:2.5,fillColor:"#4aa3ff",fillOpacity:.10};
  return {color:"#c17bff",weight:2.5,fillColor:"#c17bff",fillOpacity:.14};
}
var lastWarnFeats=[];
/* One predicate for "this alert is drawn on the radar", shared by the map and by the card's
   "Show on radar" button — so the button can never point at something that isn't there. */
function isMappedAlert(f){
  return !!(f && f.geometry && ((f.properties&&f.properties.event)||"").toLowerCase().indexOf("warning")>=0);
}
function normFeature(f){ return {type:"Feature", geometry:f.geometry, properties:f.properties||{}}; }
function loadWarnPolygons(feats){
  if(feats!==undefined) lastWarnFeats=feats||[];
  if(!rvMap) return;
  var polys=lastWarnFeats.filter(isMappedAlert);
  if(warnLayer){ rvMap.removeLayer(warnLayer); warnLayer=null; }
  if(warnCase){ rvMap.removeLayer(warnCase); warnCase=null; }
  if(!polys.length){ syncWarnKey(); return; }
  // Drawing is best-effort: this runs before the alert LIST renders, so a single malformed
  // geometry must not be able to take down the safety-critical list with it.
  try{
    /* Casing: every warning drawn twice, a dark wide stroke under the coloured one — the road-map
       trick, and the only treatment that keeps a coloured line legible over ANY background. No
       single stroke colour can: over the dark basemap the old lines read fine, over white cloud
       tops the yellow ones all but dissolved. Added first so it stays underneath; not interactive,
       so every tap still lands on the coloured layer that owns the tooltips and card links. */
    warnCase=L.geoJSON({type:"FeatureCollection",features:polys.map(normFeature)},{
      style:{color:"#0b0f16",weight:5.5,opacity:.65,fill:false},
      pane:"overlayPane",interactive:false
    }).addTo(rvMap);
    warnLayer=L.geoJSON({type:"FeatureCollection",features:polys.map(normFeature)},{
      style:function(f){ return warnStyle(f.properties.event); },
      pane:"overlayPane",
      onEachFeature:function(f,layer){
        var ev=(f.properties&&f.properties.event)||"";
        layer.bindTooltip(esc(ev)+" — tap for details",{className:"stn-tip",direction:"top",sticky:true});
        // Which of the event's two possible cards this is — through the same pair of functions the
        // card writes its data-scope with, so the two ends of the link cannot answer differently.
        // This end used to hard-code "here"/"away" and so guessed confidently in the flat mode,
        // where the cards carry no scope at all and the lookup has to fall back to the name.
        var scope=scopeAttr(alertCoversMe(f),zonesResolved());
        layer.on("click",function(e){
          if(e.originalEvent) e.originalEvent.stopPropagation();
          focusAlertCard(ev,scope);
        });
      }
    }).addTo(rvMap);
  }catch(e){
    if(warnCase){ rvMap.removeLayer(warnCase); }   // a casing with no coloured line over it is just a smudge
    warnCase=null; warnLayer=null;
  }
  syncWarnKey();
}
function loadRadar(){  // recenter on location change
  if(!rvMap) return;
  // Forecast reset/repaint resizes the stretched desktop map during this same turn.
  // An animated pan keeps its old pixel destination and can finish off-center after resize.
  // A location selection is the only recenter trigger; ordinary resize preserves a user's view.
  // Keep ResizeObserver's last stable size here: the synchronous forecast reset can
  // shrink and restore the DOM before the observer sees any net size change.
  rvMap.setView([current.lat,current.lon], rvMap.getZoom()||7, {animate:false});
  if(rvMarker) rvMarker.setLatLng([current.lat,current.lon]);
}

/* ===== Convective watches on the radar =====
   Watches arrive from api.weather.gov with geometry:null — they're zone-based, which is why the
   warning layer has never had anything to draw for one. The event-driven WWA map service carries
   the same products WITH their county polygons, so the alerts feed stays the one source of truth
   for WHETHER a watch is out (and owns the card a tap jumps to) and the map service only supplies
   the shapes. Convective watches only (TO/SV): a Flash Flood or Winter Storm Watch runs a day or
   more and would shade the whole map for its whole life — the radar is a storm map, and the SPC
   watch box is the thing it was missing. */
var WWA_URL="https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/";
/* The region the radar practically shows at its zoom range. The watch query is envelope-clipped
   so a ten-watch outbreak on the Plains doesn't ship its every county here, and loadMcd uses the
   same box to budget its text fetches; the cost is that panning far outside the CWA runs out of
   watch fills, same as it runs out of relevant warnings. */
var WWA_ENV={xmin:-96.5,ymin:34,xmax:-85,ymax:43};


var watchFeats=[], watchKey="", watchAt=0, watchLayer=null, watchOutline=null;
function isWatchEvent(ev){
  ev=(ev||"").toLowerCase();
  return ev.indexOf("tornado watch")>=0||ev.indexOf("severe thunderstorm watch")>=0;
}
function watchStyle(ev){
  /* radar.weather.gov's colours, so a reader coming from the official map keeps their bearings:
     tornado watch yellow, severe thunderstorm watch pink. The FILL stays stroke-free — the product
     is county-based, and stroking these shapes would draw every internal county line. The outline
     a watch deserves is drawn separately, from watchBoundary()'s dissolve of those same counties,
     so the perimeter can be crisp without the seams. */
  /* .22, up from .16 — yellow at 16% over white cloud tops was close to invisible once the
     satellite joined the stack. The dimmed imagery carries most of the recovery; this carries
     the rest without shading the geography away, which is what the fill-only choice protects. */
  if((ev||"").toLowerCase().indexOf("tornado")>=0) return {stroke:false,fillColor:"#ffe14d",fillOpacity:.22};
  return {stroke:false,fillColor:"#db7093",fillOpacity:.22};
}
// Whether the card's "Show on radar" button has something to frame — the watch analogue of isMappedAlert.
function watchOnRadar(ev){
  return isWatchEvent(ev)&&watchFeats.some(function(f){ return ((f.properties||{}).prod_type||"")===ev; });
}
function loadWatchPolygons(feats){
  var active=(feats||[]).filter(function(f){ return isWatchEvent((f.properties||{}).event); });
  if(!active.length){
    watchFeats=[]; watchKey=""; drawWatchPolygons();   // the all-clear must clear the map too
    return;
  }
  /* Gated on the alert list, throttled on its ids: the alerts poll runs every minute, but a
     watch's shape only changes when the SET of watches does — same ids within 10 minutes means
     the counties on screen are still the counties. */
  var key=active.map(function(f){ return (f.properties&&f.properties.id)||f.id||""; }).sort().join("|");
  if(key===watchKey&&watchFeats.length&&Date.now()-watchAt<10*60000) return;
  // Which watch TYPES the alert list vouches for right now — the service's ingest can lag the
  // feed by minutes, and this is what keeps a just-cancelled Tornado Watch's counties from
  // riding along with a Severe Thunderstorm Watch that really is out.
  var vouched={};
  active.forEach(function(f){ vouched[(f.properties||{}).event]=1; });
  var before=watchEvSet();
  resolveRiskLayers().then(function(){
    return getJSON(WWA_URL+RISK_LAYERS.wwa+"/query?where="+encodeURIComponent("sig='A' AND phenom IN ('TO','SV')")
      +"&geometry="+WWA_ENV.xmin+","+WWA_ENV.ymin+","+WWA_ENV.xmax+","+WWA_ENV.ymax
      +"&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects"
      +"&outFields=prod_type,ends,expiration&returnGeometry=true&geometryPrecision=3&f=geojson");
  }).then(function(fc){
    var now=Date.now();
    watchFeats=((fc&&fc.features)||[]).filter(function(f){
      var p=f.properties||{};
      var end=Date.parse(p.ends||p.expiration||"")||0;
      return f.geometry&&(!end||end>now)     // the service can hold a cancelled watch briefly
        &&vouched[p.prod_type];              // …and only types the live alert list stands behind
    });
    watchKey=key; watchAt=now;
    drawWatchPolygons();
    /* The list renders its "Show on radar" buttons from watchOnRadar(), which was still false
       while these fills were in flight — without this, the first render after a watch is issued
       goes a minute buttonless. One re-render when drawability actually changed closes the
       window, and the id throttle above is what keeps the round trip from ever looping. */
    if(watchEvSet()!==before) loadAlerts();
  }).catch(function(){});   // keep whatever is drawn; the alert LIST is the safety-critical view
}
// The drawable watch types, as a comparable key — order-free so a re-fetch that reshuffles
// records doesn't read as a change.
function watchEvSet(){
  var s={};
  watchFeats.forEach(function(f){ s[(f.properties||{}).prod_type||""]=1; });
  return Object.keys(s).sort().join("|");
}

function drawWatchPolygons(){
  if(!rvMap) return;
  if(watchLayer){ rvMap.removeLayer(watchLayer); watchLayer=null; }
  if(watchOutline){ rvMap.removeLayer(watchOutline); watchOutline=null; }
  if(!watchFeats.length){ syncWarnKey(); return; }
  try{
    watchLayer=L.geoJSON({type:"FeatureCollection",features:watchFeats.map(normFeature)},{
      style:function(f){ return watchStyle((f.properties||{}).prod_type); },
      pane:"overlayPane",
      onEachFeature:function(f,layer){
        var ev=(f.properties&&f.properties.prod_type)||"Watch";
        layer.bindTooltip(esc(ev)+" — tap for details",{className:"stn-tip",direction:"top",sticky:true});
        layer.on("click",function(e){
          if(e.originalEvent) e.originalEvent.stopPropagation();
          /* No scope: the county under the tap doesn't say which of the event's two possible
             cards this is, and findAlertCard's no-scope fallback already prefers the local one. */
          focusAlertCard(ev,null);
        });
      }
    }).addTo(rvMap);
    watchLayer.bringToBack();   // fills under every outline: warnings and MDs both out-rank a watch shade
    /* The perimeter the fill was too shy to show: a thin solid line inside a wide, faint halo of
       its own colour. The halo is what earns the line its legibility over bright cloud — it widens
       the stroke's footprint without adding a second pattern, where the first cut of this (dark
       casing under dashes, the warnings' treatment scaled up) read as hazard tape. The watch stays
       distinguishable from the warnings by everything else: huge where they are small, smooth
       where they are sharp, glowing where they are cased. Lines are not interactive — the county
       fills underneath own the tooltip and the card link, and the key under the map names the
       colour. */
    var byType={};
    watchFeats.forEach(function(f){
      var ev=(f.properties||{}).prod_type||"";
      (byType[ev]=byType[ev]||[]).push(f);
    });
    var parts=[];
    Object.keys(byType).forEach(function(ev){
      var rings=watchBoundary(byType[ev]).map(function(r){ return chaikinRing(r,2); });
      if(!rings.length) return;
      var c=watchStyle(ev).fillColor;
      parts.push(L.polyline(rings,{color:c,weight:10,opacity:.16,pane:"overlayPane",interactive:false}));
      parts.push(L.polyline(rings,{color:c,weight:2,opacity:.9,pane:"overlayPane",interactive:false}));
    });
    if(parts.length) watchOutline=L.layerGroup(parts).addTo(rvMap);
  }catch(e){
    watchLayer=null;
    if(watchOutline){ rvMap.removeLayer(watchOutline); watchOutline=null; }
  }
  syncWarnKey();
}
/* ===== Hazard key =====
   One chip per hazard TYPE the map is drawing right now, written into #rsWarnKey under the
   reflectivity key. Everything about it is derived, nothing asserted: the set comes from the same
   feature lists the two draw functions just painted (gated on their layers actually standing, so
   a failed draw advertises nothing), and each chip's colour comes out of the same style function
   that coloured the shape. Both draw paths call this on every outcome — draw, clear, and failure —
   so the key can neither outlive its shapes nor lag them. */
function syncWarnKey(){
  var el=document.getElementById("rsWarnKey");
  if(!el) return;
  var seen={}, chips=[];
  if(warnLayer) lastWarnFeats.filter(isMappedAlert).forEach(function(f){
    var ev=(f.properties&&f.properties.event)||"";
    if(!ev||seen[ev]) return;
    seen[ev]=1;
    chips.push({ev:ev,c:warnStyle(ev).color});
  });
  if(watchLayer) watchFeats.forEach(function(f){
    var ev=(f.properties||{}).prod_type||"";
    if(!ev||seen[ev]) return;
    seen[ev]=1;
    chips.push({ev:ev,c:watchStyle(ev).fillColor});
  });
  el.innerHTML=chips.map(function(k){
    return '<span class="rw-chip"><i style="background:'+k.c+'"></i>'+esc(k.ev)+'</span>';
  }).join("");
}

/* ===== Two-way linking between the radar polygons and the alert cards =====
   The list groups by event type AND coverage (all "Severe Thunderstorm Warning" segments that
   cover this location share one card; the ones that don't share another), while the map draws one
   polygon per segment — so a card maps to N polygons and every polygon maps back to exactly one
   card. Both directions resolve through the event name PLUS the scope, because the name alone can
   now name two cards; a FOLDED card (several products of one hazard family) lists every name it
   answers to in data-evs, "|"-separated. Scope is a preference rather than a filter: a card is
   better than no card if a coverage test somehow disagrees between the two calls. */
function findAlertCard(ev,scope){
  var cards=document.querySelectorAll("#alerts .alert"), any=null;
  for(var i=0;i<cards.length;i++){
    // data-aid was written HTML-escaped; getAttribute hands it back decoded, so compare raw
    var evs=cards[i].getAttribute("data-evs");
    var named=cards[i].getAttribute("data-aid")===ev || (evs&&evs.split("|").indexOf(ev)>=0);
    if(!named) continue;
    if(!scope||cards[i].getAttribute("data-scope")===scope) return cards[i];
    if(!any) any=cards[i];
  }
  return any;
}
function focusAlertCard(ev,scope){
  var card=findAlertCard(ev,scope);
  if(!card) return;
  var hint=card.querySelector(".ab-head");   // the banner head owns aria-expanded
  if(hint) setOpen(card,hint,true);
  if(card.querySelector(".a2-more")) card.classList.add("areas-all");
  card.classList.remove("flash");
  void card.offsetWidth;                            // restart the animation if it's already running
  card.classList.add("flash");
  try{ card.scrollIntoView({behavior:"smooth", block:"center"}); }catch(e){ card.scrollIntoView(); }
  if(typeof scheduleMasonry==="function") scheduleMasonry();
  setTimeout(function(){ card.classList.remove("flash"); },2200);
}
var flashLayer=null, flashTimer=null;
function showAlertOnRadar(ev,scope){
  if(!rvMap) return;
  var evs=String(ev||"").split("|");   // a folded card sends every product it holds
  /* Scoped to the card that asked. Without this, "Show on radar" on the Severe Thunderstorm Warning
     over this location would fit the map to every severe thunderstorm in the office's area — zooming
     the reader out and away from the one polygon they tapped the button to look at. */
  var feats=lastWarnFeats.filter(function(f){
    if(!isMappedAlert(f) || evs.indexOf((f.properties&&f.properties.event)||"")<0) return false;
    if(!scope) return true;
    return (scope==="here")===!!alertCoversMe(f);
  });
  /* Watches live in their own cache: zone-based products have no geometry in lastWarnFeats, and
     their county fills are what the button should frame. Scope is dropped on purpose — a watch is
     one product, and framing all of it beats framing the LSX slice of it. */
  if(!feats.length) feats=watchFeats.filter(function(f){
    return evs.indexOf((f.properties&&f.properties.prod_type)||"")>=0;
  });
  if(!feats.length) return;
  if(flashTimer){ clearTimeout(flashTimer); flashTimer=null; }
  if(flashLayer){ rvMap.removeLayer(flashLayer); flashLayer=null; }
  try{
    flashLayer=L.geoJSON({type:"FeatureCollection",features:feats.map(normFeature)},{
      style:{color:"#ffffff",weight:4,opacity:.95,fill:false,dashArray:"7 5"},
      interactive:false, pane:"overlayPane"
    }).addTo(rvMap);
    rvMap.fitBounds(flashLayer.getBounds(),{padding:[34,34],maxZoom:10});
  }catch(e){ flashLayer=null; }
  var rc=document.getElementById("radarCard");
  if(rc){ try{ rc.scrollIntoView({behavior:"smooth",block:"center"}); }catch(e2){ rc.scrollIntoView(); } }
  flashTimer=setTimeout(function(){
    if(flashLayer&&rvMap){ rvMap.removeLayer(flashLayer); flashLayer=null; }
  },2800);
}

/* Show the row dates only where the day-name column can actually hold them. Measured, not
   media-queried: the masonry hands this card ~a third of a desktop but the full width of a phone,
   so column width moves the OPPOSITE way from viewport width, and the card's width isn't even
   settled until layoutMasonry has run — which is why that function is the ONE caller, at its end.
   Every path that could change the answer (initial pack, resize, any card repaint the observer
   sees) already funnels through it. All-or-nothing across the widget — seven rows where some have
   dates and some don't reads as a bug, not a compromise. The +2 slack absorbs the 1px
   screen-reader twin, which sits out of flow at the content edge and leaks into scrollWidth.
   The observer pause is load-bearing, same as reorderMasonryDOM's: the masonry observer watches
   class mutations, and an un-paused remove/re-add here would schedule a fresh pack that lands
   right back in this function, rAF after rAF, forever. Hiding the date changes no card's height,
   so the pack has nothing to learn from the toggle and drops nothing by not seeing it. */
/* ---- Sky layer toggles ----
   Radar and satellite stack on one map now, and each button is an independent on/off. They were
   TABS, which is the right control for two views that cannot coexist and the wrong one the moment
   they can: a tablist tells a screen reader "pick exactly one of these", which stopped being true
   when the satellite became a layer. Two <button aria-pressed> say what is actually on offer.
   Both on is the default and the whole point of the card.

   A switched-off layer leaves the map rather than merely hiding, so it costs nothing: no tiles,
   and for the radar no capabilities fetch either. Reflectivity is the exception in HOW it hides —
   the loop keeps ~10 pooled frames alive and drives them by opacity, so giving opacity a second
   meaning (off vs. not-the-current-frame) would have the layer reappear on the next sweep. It is
   torn down instead — see detachRadarLayers().

   Hiding is NOT enough for either layer, which is worth stating because the first cut of this got
   it wrong: a Leaflet layer that is merely invisible is still on the map, and GridLayer requests
   tiles for the current view on every moveend regardless of whether anything can see them. With
   the radar pane set to display:none, one pan across the state still pulled ~90 reflectivity
   tiles. Off has to mean off the map. */
var skyOn={radar:true, sat:true};
var SKY_KEY="lsxSky_v1";
try{
  var _sk=JSON.parse(localStorage.getItem(SKY_KEY)||"null");
  /* Both-off is a legal thing to click your way into but a broken thing to LAND on: the card would
     restore as a bare basemap with nothing on screen explaining why. Persist it, don't restore it. */
  if(_sk&&(_sk.radar||_sk.sat)){ skyOn.radar=!!_sk.radar; skyOn.sat=!!_sk.sat; }
}catch(e){}

/* The caption names what is actually drawn, so it can never promise a satellite that is switched
   off. The ↗ link follows the same rule; radar wins when both are on, because the loop and the
   warning polygons are its. */
function syncSkyMeta(){
  var lk=document.getElementById("rsLink");
  if(lk) lk.innerHTML = skyOn.radar
    ? (radarView.source==="klsx"
      ? '<a href="https://radar.weather.gov/station/KLSX/standard" target="_blank" rel="noopener">Official KLSX ↗</a>'
      : '<a href="https://radar.weather.gov/" target="_blank" rel="noopener">Official radar ↗</a>')
    : '<a href="https://www.star.nesdis.noaa.gov/GOES/sector.php?sat=G19&amp;sector=umv" target="_blank" rel="noopener">GOES loop ↗</a>';
  var bits=[];
  /* "Names what is actually drawn" has to survive a layer that is switched ON and failing, or the
     caption goes from honest to actively misleading — crediting NOAA for reflectivity nobody
     received. A down layer says so where it used to advertise itself. */
  if(skyOn.radar) bits.push(radarDown()
    ? '<b>'+esc(radarProduct().label)+' unavailable</b> — try '+(radarView.source==="klsx"?'Regional':'Local KLSX')
    : 'NOAA/NWS '+esc(radarProduct().label)+' &middot; tap a <b>warning or watch</b> to jump to its alert');
  /* A pinned satellite says WHICH moment it is showing. Left as the plain credit it would quietly
     claim to be current while displaying an hour-old cloud shield — the same lie the radar badge's
     stale state exists to prevent, arriving through the other layer. */
  if(skyOn.sat) bits.push(satDown()
    ? '<b>Satellite unavailable</b> — no GOES imagery from NASA GIBS right now'
    : (satPinned
        ? 'GOES-19 GeoColor at <b>'+esc(satClock(satPinned))+'</b>, following the radar'
        : 'GOES-19 GeoColor via NASA GIBS'));
  if(!bits.length) bits.push('Both layers are off — the buttons above bring them back');
  bits.push('OpenFreeMap basemap');
  var note=skyOn.radar?'radar every ~4 min':(skyOn.sat?'satellite every ~10 min':'');
  var cap=document.getElementById("rsCap");
  if(cap) cap.innerHTML='<span>'+bits.join(' &middot; ')+'</span><span>'+note+'</span>';
  /* The key belongs to reflectivity, so it lives and dies with it — and it goes away when the
     layer is down too, because a guide to colours the map is not painting is just clutter. */
  var lg=document.getElementById("rsLegend");
  if(lg) lg.classList.toggle("on", !!rvMap && !!skyOn.radar && !radarDown());
  syncRadarProductUI();
  [].slice.call(document.querySelectorAll("#rsTabs .rs-tab")).forEach(function(b){
    var on=!!skyOn[b.getAttribute("data-l")];
    b.disabled=!rvMap;
    b.classList.toggle("on",on&&!!rvMap);
    b.setAttribute("aria-pressed",on?"true":"false");
  });
}
/* Take reflectivity off the map completely: the fallback layer, every pooled sweep, and the loop
   state that indexes them. The pool is CLEARED rather than parked, because buildRadarFrames() only
   calls addTo() for timestamps it hasn't seen — a pool full of detached layers would be reused on
   the way back and draw nothing. Rebuilding costs one capabilities fetch, and the sweeps would be
   stale by then anyway. */
function detachRadarLayers(){
  radarRequestGen++; // an in-flight response must not resurrect a hidden or replaced product
  radarBuildGen++;   // cancel any staged historical-frame queue before it adds another layer
  radarPauseLoop();
  if(!rvMap) return;
  if(nwsRadar&&rvMap.hasLayer(nwsRadar)) rvMap.removeLayer(nwsRadar);
  Object.keys(radarPool).forEach(function(t){
    if(rvMap.hasLayer(radarPool[t])) rvMap.removeLayer(radarPool[t]);
    delete radarPool[t];
  });
  radarFrames=[]; radarIdx=-1;
  radarTimesCache=[];
  /* The pool is gone, so every per-layer tile tally went with it. Reset the cached verdict too, or
     syncSkyHealth() compares against a stale "was down" and skips the redraw that clears the badge
     when reflectivity comes back. */
  radarFallback=false; skyHealth.radar=null;
  syncRadarBadge();   // skyOn.radar is already false here, so this empties the badge
  updateRadarCtl();   // empty frame list drops .ready, so the scrubber can't outlive its frames
  /* A pinned satellite outliving the frame list would strand the card on an hour-old cloud shield
     with nothing left on screen explaining which moment it belongs to. Empty frames means unpin. */
  syncSatToRadar();
}
function loadRadarLegend(img,url,retry){
  var button=document.getElementById("radarLegendRetry");
  if(!img._legendBound){
    img._legendBound=true;
    img.addEventListener("error",function(){
      img._legendFailed=true;img.hidden=true;
      if(button) button.hidden=false;
    });
    img.addEventListener("load",function(){
      img._legendFailed=false;img.hidden=false;
      if(button) button.hidden=true;
    });
  }
  if(img._legendURL!==url||retry&&img._legendFailed){
    var failed=img._legendFailed;
    img._legendURL=url;img._legendFailed=false;img.hidden=false;
    if(button) button.hidden=true;
    // A retry must make a fresh request even if the browser cached an error for this URL.
    img.src=url+(failed?"&_legendRetry="+Date.now():"");
  }
}
function syncRadarProductUI(retryLegend){
  var station=radarView.source==="klsx", velocity=station&&radarView.product==="velocity";
  document.querySelectorAll("[data-radar-source]").forEach(function(b){
    var on=b.getAttribute("data-radar-source")===radarView.source;
    b.classList.toggle("on",on);
    b.setAttribute("aria-pressed",on?"true":"false");
  });
  var select=document.getElementById("radarProduct");
  if(select){ select.value=radarView.product; select.disabled=!station; }
  var regional=document.getElementById("regionalRadarScale"), local=document.getElementById("stationRadarScale");
  if(regional) regional.hidden=station;
  if(local) local.hidden=!station;
  var title=document.getElementById("stationLegendTitle"), img=document.getElementById("stationLegendImage");
  if(title) title.textContent=velocity?"Radial velocity · knots":"Reflectivity · dBZ";
  if(img&&station){
    var url=KLSX_WMS+"?service=WMS&request=GetLegendGraphic&format=image/png&layer="+radarProduct().layer;
    loadRadarLegend(img,url,!!retryLegend);
    img.alt=velocity?"KLSX velocity scale: negative values toward the radar, positive values away, in knots"
      :"KLSX reflectivity scale in dBZ; higher values indicate stronger echoes";
  }
  var note=document.getElementById("radarProductNote");
  if(note) note.textContent=station
    ? (velocity?"Green: toward KLSX · Red: away. Wind along the radar beam, not surface wind.":"KLSX station coverage only. Use Regional for the surrounding radar network.")
    : "Regional combines multiple radars. Velocity is available in Local KLSX.";
}
function setRadarView(source,product){
  if(source!=="klsx"&&source!=="regional") return;
  product=source==="klsx"&&product==="velocity"?"velocity":"reflectivity";
  if(source===radarView.source&&product===radarView.product) return;
  // Keep the map, camera, satellite and warning layers; replace only the radar's entire pool.
  detachRadarLayers();
  radarView={source:source,product:product};
  try{ localStorage.setItem(RADAR_VIEW_KEY,JSON.stringify(radarView)); }catch(e){}
  if(rvMap){
    nwsRadar=createRadarLayer();
    if(skyOn.radar) nwsRadar.addTo(rvMap);
  }
  syncSkyMeta();
  syncRadarProductUI(true);
  syncRadarBadge();
  if(rvMap&&skyOn.radar) refreshRadarLayer();
}
function applySkyLayers(first){
  syncSkyMeta();
  if(!rvMap) return;
  /* Dimmed only while BOTH layers stack — the whole point is giving reflectivity contrast over
     the cloud tops. Radar off, the satellite is the product and gets its full brightness back. */
  rvMap.getContainer().classList.toggle("sat-dim",!!(skyOn.radar&&skyOn.sat));
  if(!skyOn.radar) detachRadarLayers();
  // The scrubber drives frames nobody can see; it goes with them. (Class-driven display otherwise
  // — clearing the inline value hands it back to .radar-ctl.ready rather than forcing it open.)
  var ctl=document.getElementById("radarCtl");
  if(ctl) ctl.style.display=skyOn.radar?"":"none";
  // Only the imagery toggles; the labels stay put — they are the map's whole supply of geography
  // text now that the basemap geometry layer has no labels (see mapStylePart()).
  if(satLayer){
    if(skyOn.sat&&!rvMap.hasLayer(satLayer)) satLayer.addTo(rvMap);
    else if(!skyOn.sat&&rvMap.hasLayer(satLayer)) rvMap.removeLayer(satLayer);
  }
  /* Switched back on while the radar is parked in the past, the satellite would return as the LIVE
     frame — the exact mismatch the time track exists to close, reachable by a route that never
     touches the scrubber. Re-ask where the radar is standing. */
  if(!first&&skyOn.sat) syncSatToRadar();
  /* Back on, everything reflectivity had was torn down, so rebuild. nwsRadar goes back first for
     the same reason it is added at init: the capabilities fetch takes a moment, and this paints a
     sweep NOW instead of leaving an empty map until the frame list resolves. refreshRadarLayer()
     removes it again once the pooled frames can drive. */
  if(!first&&skyOn.radar){
    if(nwsRadar&&!rvMap.hasLayer(nwsRadar)) nwsRadar.addTo(rvMap);
    refreshRadarLayer();
  }
}
function setSkyLayer(name,on){
  if(name!=="radar"&&name!=="sat") return;
  skyOn[name]=!!on;
  try{ localStorage.setItem(SKY_KEY,JSON.stringify(skyOn)); }catch(e){}
  applySkyLayers(false);
}
document.addEventListener("click",function(e){
  var source=e.target.closest?e.target.closest("[data-radar-source]"):null;
  if(source){ setRadarView(source.getAttribute("data-radar-source"),radarView.product); return; }
  var b=e.target.closest?e.target.closest("#rsTabs .rs-tab"):null;
  if(!b) return;
  var n=b.getAttribute("data-l");
  setSkyLayer(n,!skyOn[n]);
});
document.getElementById("radarProduct").addEventListener("change",function(e){
  setRadarView(radarView.source,e.target.value);
});
document.getElementById("radarLegendRetry").addEventListener("click",function(){syncRadarProductUI(true);});
/* ============ SATELLITE TIME TRACK ============
   Scrubbing the radar back an hour used to leave the cloud shield sitting at "now" — the storm in
   the past and the system carrying it in the present, drawn as one picture. That is precisely what
   stacking the two layers was supposed to stop.

   GIBS has always exposed a time dimension, and the reason this waited is not the one the README
   used to give. The archive's gaps are real: measured across three hours, only 11 of 18 nominal
   10-minute slots existed, and a slot that does not exist is a hard 404, so the moments have to be
   DISCOVERED rather than computed. But that turns out to be the cheap part — DescribeDomains
   bounded to a few hours answers in ~350 bytes. (Unbounded it returns the whole archive back to
   2021, about 1 MB, which is what made this look impractical for so long.)

   The expensive part is the imagery, and it is what shapes everything below. A reflectivity tile is
   a sparse transparent PNG — measured, 1,980 bytes. A GeoColor tile is opaque full colour: 113,601
   bytes, 57x bigger. That single ratio is why the radar keeps ~15 frames alive and the satellite
   keeps exactly ONE. Nothing here preloads a parallel stack; it re-points one layer at whatever
   moment the visitor stopped on. Playback is exempt for the same reason — see syncSatToRadar. */
var SAT_DOMAIN="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/DescribeDomains";
var satTimes=[], satTimesPending=null, satPinned=null, satPending=null, satSwapGen=0, satSyncTimer=null;
/* The time is a segment of its own, AFTER the style — not in place of it. Dropping it where
   `default` sits looks right and answers 400 for every tile. */
function satUrl(t){ return t ? GIBS_SAT.replace("/default/","/default/"+t+"/") : GIBS_SAT; }
function isoZ(ms){ return new Date(ms).toISOString().replace(/\.\d+Z$/,"Z"); }
function iso8601Ms(d){
  var m=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec((d||"").trim());
  return m ? ((+m[1]||0)*86400+(+m[2]||0)*3600+(+m[3]||0)*60+(+m[4]||0))*1000 : 0;
}
/* The domain is a comma-separated list of START/END/PERIOD *intervals*, not a list of instants —
   that is exactly how the gaps are expressed, and expanding it is what turns "which slots exist"
   into something we can snap a radar timestamp onto. */
function expandSatDomain(s){
  var out=[];
  s.split(",").forEach(function(chunk){
    var p=chunk.trim().split("/");
    var start=Date.parse(p[0]);
    if(isNaN(start)) return;
    var end=(p.length>1)?Date.parse(p[1]):start;
    var step=iso8601Ms(p[2]);
    if(!step||isNaN(end)||end<start){ out.push(p[0].trim()); return; }
    for(var t=start; t<=end && out.length<400; t+=step) out.push(isoZ(t));
  });
  return out.sort();
}
function fetchSatTimes(){
  var now=Date.now();
  // Only as wide as the loop can reach. Unbounded is ~1 MB; this is a few hundred bytes.
  var url=SAT_DOMAIN+"?SERVICE=WMTS&VERSION=1.0.0&REQUEST=DescribeDomains"
    +"&layer=GOES-East_ABI_GeoColor&tileMatrixSet=GoogleMapsCompatible_Level7&domains=time"
    +"&time="+isoZ(now-(RADAR_SPAN_MIN+30)*60000)+"/"+isoZ(now+10*60000);
  return getText(url).then(function(xml){
    var m=xml.match(/<Domain>([\s\S]*?)<\/Domain>/i);
    if(!m) throw new Error("no domain");
    var list=expandSatDomain(m[1]);
    if(!list.length) throw new Error("empty domain");
    satTimes=list;
    return list;
  });
}
/* Newest satellite frame at or before the radar's moment. GOES publishes every ~10 minutes and the
   loop steps every ~4, so several radar frames legitimately share one image — the cloud shield
   really did not move in between, and pretending otherwise would be inventing data. */
function satTimeFor(ms){
  for(var i=satTimes.length-1;i>=0;i--){ if(Date.parse(satTimes[i])<=ms) return satTimes[i]; }
  return satTimes.length?satTimes[0]:null;   // radar frame predates anything GIBS still holds
}
function scheduleSatSwap(){
  clearTimeout(satSyncTimer);
  // Coalesce a drag: crossing an hour coincides with ~6 satellite frames, and the visitor only
  // ever looks at the one they stop on. The caption updates immediately; the bytes wait.
  satSyncTimer=setTimeout(function(){ swapSatLayer(satUrl(satPinned)); },180);
}
function unpinSat(){
  if(!satPinned) return;
  satPinned=null;
  scheduleSatSwap();
  syncSkyMeta();
}
/* Called whenever the radar's displayed moment changes. PLAYBACK IS DELIBERATELY EXEMPT: a
   GeoColor frame is ~450 KB for this map, and fetching that every 450ms would stall the loop
   rather than enrich it. Pausing or scrubbing means the visitor has stopped on a moment and is
   actually looking at it — that is when the cloud shield is worth the bytes. */
function syncSatToRadar(){
  if(!rvMap||!skyOn.sat||radarPlaying) return;
  if(!radarFrames.length){ unpinSat(); return; }
  var i=Math.max(0,Math.min(radarFrames.length-1,radarIdx));
  if(i===radarFrames.length-1){ unpinSat(); return; }   // back at now → the live, undated layer
  if(!satTimes.length){
    // First scrub since the window last moved: discover the valid slots, then re-enter with them.
    if(!satTimesPending){
      satTimesPending=fetchSatTimes().then(function(){ satTimesPending=null; syncSatToRadar(); })
        .catch(function(){ satTimesPending=null; });   // no domain → the satellite simply stays live
    }
    return;
  }
  var want=satTimeFor(Date.parse(radarFrames[i].time));
  if(!want||want===satPinned) return;   // ~15 radar steps over ~6 satellite frames: mostly a no-op
  satPinned=want;
  scheduleSatSwap();
  syncSkyMeta();
}
function satClock(iso){
  var d=new Date(iso);
  return isNaN(d)?"":d.toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric",minute:"2-digit"});
}
/* GIBS posts a new GeoColor frame every ~10 minutes, and Leaflet caches its tile <img>s in the DOM
   — nothing re-fetches on its own. redraw() would do it, but it drops every tile first and leaves
   a hole in the map while the replacements load. Build the new layer, swap once it has painted,
   and the change is invisible. For the LIVE frame old and new URLs are identical: the endpoint
   answers `no-store`, so the browser really does re-request instead of serving the frame we
   already have, which is why there is no cache-buster here. A pinned frame is a different URL and
   is cacheable on purpose — scrubbing back over ground you already covered should cost nothing. */
function swapSatLayer(url){
  if(!rvMap||!satLayer||!skyOn.sat) return;
  /* A swap already in flight is now aimed at the wrong minute. Drop it before starting another, or
     dragging the scrubber across an hour stacks half a dozen opaque layers all waiting to paint. */
  if(satPending&&satPending!==satLayer&&rvMap.hasLayer(satPending)) rvMap.removeLayer(satPending);
  var gen=++satSwapGen, old=satLayer, swapped=false;
  var next=L.tileLayer(url,{maxZoom:12,maxNativeZoom:SAT_MAX_NATIVE,zIndex:5});
  satPending=next;
  bindSkyHealth(next);   // satDown() asks whichever layer is current, and that is about to be this one
  function swap(){
    if(swapped) return; swapped=true;
    /* Tiles do not necessarily come back in the order they were asked for. Without this, a slow
       early scrub could paint last and leave the map showing a minute the visitor already left. */
    if(gen!==satSwapGen){ if(next!==satLayer&&rvMap.hasLayer(next)) rvMap.removeLayer(next); return; }
    satPending=null;
    if(satLayer===old&&rvMap.hasLayer(old)) rvMap.removeLayer(old);
    // A toggle-off mid-swap wins: never resurrect a layer the visitor just switched away from.
    if(skyOn.sat) satLayer=next;
    else if(rvMap.hasLayer(next)) rvMap.removeLayer(next);
    /* The verdict now refers to a different object with different tallies. Re-ask, or a caption
       that said "unavailable" for the old layer never comes back when the new one paints. */
    syncSkyHealth();
  }
  next.once("load",swap);
  /* If every tile errors "load" never fires, and without this the old layer would stay pinned
     behind a detached one forever. Swapping anyway makes the failure visible instead of leaving
     an hour-old frame on screen looking current. */
  setTimeout(swap,20000);
  next.addTo(rvMap);
}
function refreshSatLayer(){
  /* The discovery window has moved on; make the next scrub re-ask rather than snap to slots that
     have since aged out of it. Cleared even while pinned — the pinned frame stays on screen, and
     the list it came from is what goes stale. */
  satTimes=[];
  if(!rvMap||!satLayer||!skyOn.sat) return;
  // Scrubbed back on purpose: a live refresh here would yank the visitor to "now" mid-look.
  if(satPinned) return;
  swapSatLayer(satUrl(null));
}
/* The jump nav needs no script: every link points at a section that is always on the page, and the
   browser does the scrolling. */

/* ---- Sky fullscreen ----
   The inline map is a peek; this is the "where exactly, and when" view. The card itself goes
   fixed-position rather than cloning anything, so the Leaflet instance, the loop, the layer
   toggles and the warning polygons survive the transition untouched — only the box changes size.
   Leaflet has to be told, twice: once when the layout has settled and once after the CSS
   transition, or it renders tiles for the old viewport. */
var radarFull=false, radarFullPrevFocus=null, radarInert=[];
function setRadarFull(on){
  var card=document.getElementById("radarCard"), btn=document.getElementById("rsFull");
  if(!card||radarFull===on) return;
  radarFull=on;
  document.body.classList.toggle("radar-full",on);
  if(btn){
    btn.setAttribute("aria-expanded",on?"true":"false");
    btn.setAttribute("aria-label",on?"Close radar fullscreen":"Open radar fullscreen");
    var t=btn.querySelector(".rsf-t"); if(t) t.textContent=on?"Close":"Fullscreen";
    // The icon is not swapped here — body.radar-full picks which of the button's two marks shows.
  }
  if(on){
    radarFullPrevFocus=document.activeElement;
    card.setAttribute("role","dialog");card.setAttribute("aria-modal","true");card.setAttribute("aria-labelledby","skyTitle");
    var branch=card;
    while(branch.parentElement){
      [].forEach.call(branch.parentElement.children,function(sibling){
        if(sibling!==branch&&!sibling.inert){sibling.inert=true;radarInert.push(sibling);}
      });
      branch=branch.parentElement;if(branch===document.body)break;
    }
    if(btn) btn.focus();
  }else{
    radarInert.forEach(function(node){node.inert=false;});radarInert=[];
    card.removeAttribute("role");card.removeAttribute("aria-modal");card.removeAttribute("aria-labelledby");
    // Return focus where it came from; a keyboard user must not be dumped at the top of the page.
    if(radarFullPrevFocus&&radarFullPrevFocus.focus) radarFullPrevFocus.focus();
    radarFullPrevFocus=null;
  }
  if(rvMap){ rvMap.invalidateSize(); setTimeout(function(){ if(rvMap) rvMap.invalidateSize(); },260); }
  document.dispatchEvent(new Event('radarfullscreenchange'));
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
document.addEventListener("click",function(e){
  if(e.target.closest&&e.target.closest("#rsFull")) setRadarFull(!radarFull);
});
document.addEventListener("keydown",function(e){
  if(!radarFull) return;
  if(e.key==="Escape"){e.preventDefault();setRadarFull(false);return;}
  if(e.key==="Tab"){
    var card=document.getElementById("radarCard");
    var controls=[].slice.call(card.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(function(node){return !node.closest("[inert]")&&node.getClientRects().length;});
    if(!controls.length){e.preventDefault();return;}
    var first=controls[0],last=controls[controls.length-1],active=document.activeElement;
    if(!card.contains(active)||e.shiftKey&&active===first||!e.shiftKey&&active===last){
      e.preventDefault();(e.shiftKey?last:first).focus();
    }
  }
});
