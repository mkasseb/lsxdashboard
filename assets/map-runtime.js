/* The DOM above is parsed; third-party downloads must never gate startup or context controls. */
var mapsCanStart=false, mapsInFlight=null, mapsRequested=false, mapApproach=null;
var mapBoot={phase:"waiting",started:Date.now(),events:[]};
function mapStage(detail){
  mapBoot.events.push(Math.round((Date.now()-mapBoot.started)/1000)+"s: "+detail);
  if(mapBoot.events.length>12)mapBoot.events.shift();
}
function mapDiagnosticsText(){
  return "Map bootstrap v1 · "+mapBoot.phase+" · document "+document.readyState+"\n"
    +"Libraries: Leaflet "+!!window.L+", MapLibre "+!!window.maplibregl+", adapter "+!!(window.L&&L.maplibreGL)+"\n"
    +"Radar: map "+!!rvMap+", panes "+document.querySelectorAll('#radar .leaflet-map-pane').length
    +", controls "+document.querySelectorAll('#radar .leaflet-control-zoom').length
    +", loaded tiles "+document.querySelectorAll('#radar .leaflet-tile-loaded').length+"\n"
    +mapBoot.events.join("\n");
}
/* Readers never need this; whoever is debugging map tiles adds ?debug to the URL. The boot log
   above still records every stage either way, so turning it on after a failure loses nothing. */
function mapDiagnosticsEnabled(search){
  try{ return new URLSearchParams(search==null?location.search:search).has("debug"); }catch(e){ return false; }
}
function initMapDiagnostics(){
  if(!mapDiagnosticsEnabled()) return;
  var panel=document.createElement("details");panel.className="map-diagnostics";
  panel.innerHTML='<summary>Map diagnostics</summary><pre></pre><small>Diagnostic text stays on this device.</small>';
  panel.addEventListener("toggle",function(){if(panel.open)panel.querySelector('pre').textContent=mapDiagnosticsText();});
  document.getElementById("radar").closest(".maplock-wrap").after(panel);
}

/* Replacing a map's placeholder or retry panel removes whatever control had focus. Callers check
   first and hand focus to a stable target, so a keyboard reader never lands on <body> (which would
   also escape the fullscreen dialog). */
function focusInside(el){
  return !!(el&&document.activeElement&&document.activeElement!==el&&el.contains(document.activeElement));
}
function focusRadarControl(){
  // The radar map is built with keyboard:false, so its container is not focusable. The first visible
  // control in the radar view outside the map (map lock, loop, scrubber) is the stable target.
  var view=document.getElementById("rsRadar"), radar=document.getElementById("radar");
  var target=[].slice.call(view.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]'))
    .filter(function(n){return !radar.contains(n)&&n.getClientRects().length;})[0]||document.getElementById("rsFull");
  if(target) target.focus({preventScroll:true});
}
function mapFallback(id){
  var el=document.getElementById(id);
  if(el&&el.closest(".maplock-wrap"))el.closest(".maplock-wrap").classList.add("map-unavailable");
  var href=id==="radar"?"https://radar.weather.gov/station/KLSX/standard":"https://www.weather.gov/wrh/timeseries?site=KSTL";
  if(!el) return;
  // Rebuilding the panel replaces the focused retry button; hand focus to its replacement.
  var hadFocus=focusInside(el);
  el.innerHTML='<div class="imgfail">Map didn’t load. <button type="button" data-retry-maps>Retry maps</button> <a href="'+href+'" target="_blank" rel="noopener">'+(id==="radar"?"Open NWS radar":"Open NWS obs")+' ↗</a></div>';
  if(hadFocus) el.querySelector('[data-retry-maps]').focus({preventScroll:true});
}
function ensureMapLibraries(){
  var libraries=[
    {part:"leaflet/1.9.4/",ready:function(){return !!window.L;}},
    {part:"maplibre-gl@5.24.0/",ready:function(){return !!window.maplibregl;}},
    {part:"maplibre-gl-leaflet@",ready:function(){return !!(window.L&&L.maplibreGL);}}
  ];
  var retryStyles=libraries.some(function(lib){return !lib.ready();});
  return libraries.reduce(function(chain,lib){return chain.then(function(){
    if(lib.ready()) return;
    var original=[].slice.call(document.querySelectorAll("script[data-map-src]")).filter(function(node){return node.getAttribute("data-map-src").indexOf(lib.part)>=0;})[0];
    if(!original) throw new Error("Map dependency unavailable");
    return new Promise(function(resolve,reject){
      var url=original.getAttribute("data-map-src"),controller=new AbortController(),settled=false;
      var label=lib.part+" ["+url+"]";
      mapStage("Requesting "+label);
      function done(err){
        if(settled)return;settled=true;clearTimeout(timer);
        mapStage(label+": "+(err?err.message:"ready"));
        if(err)reject(err);else resolve();
      }
      var timer=setTimeout(function(){done(new Error("Download timed out after 20s"));controller.abort();},20000);
      // Abort before execution: removing a script element alone does not reliably cancel its download.
      // Fetch enforces the descriptor's SRI; existing CSP permits inline execution of verified bytes.
      fetch(url,{mode:"cors",integrity:original.getAttribute("integrity")||"",signal:controller.signal})
        .then(function(response){if(!response.ok)throw new Error("HTTP "+response.status);return response.text();})
        .then(function(source){
          if(settled)return;
          var script=document.createElement("script");script.textContent=source;
          try{document.head.appendChild(script);done(lib.ready()?null:new Error("Library did not initialize"));}
          finally{script.remove();}
        }).catch(function(error){done(new Error("Download/integrity/CORS failure: "+error.message));});
    });
  });},Promise.resolve()).then(function(){
    // A CDN outage can also leave the map stylesheets unloaded.
    return Promise.all([].slice.call(document.querySelectorAll('link[data-map-style]')).filter(function(node){
      return /leaflet\/1\.9\.4\/|maplibre-gl@5\.24\.0\//.test(node.href)&&(retryStyles||!node.sheet||node.media==="print");
    }).map(function(original){
      return new Promise(function(resolve,reject){
        var link=document.createElement("link"),timer;
        mapStage("Loading CSS "+new URL(original.href).hostname+new URL(original.href).pathname);
        [].forEach.call(original.attributes,function(attr){link.setAttribute(attr.name,attr.value);});
        link.rel="stylesheet";
        function done(err){
          clearTimeout(timer);link.onload=null;link.onerror=null;
          if(err){link.remove();reject(err);}else{original.remove();resolve();}
        }
        link.onload=function(){link.media="all";done();};link.onerror=function(){done(new Error("Map stylesheet unavailable"));};
        timer=setTimeout(function(){done(new Error("Map stylesheet timed out"));},20000);
        document.head.appendChild(link);
      });
    }));
  });
}
function removePartialMap(map){
  // MapLibre may throw before creating its GL map; the Leaflet adapter's onRemove then throws
  // too. Teardown must not prevent the fallback or leave a failed map eligible for reuse.
  try{if(map) map.remove();}catch(e){}
}
function ensureMaps(){
  if(!mapsCanStart||!mapsRequested||rvMap&&(stnMap||!feedRequested("stations"))) return Promise.resolve();
  if(mapsInFlight) return mapsInFlight;
  var theme=effectiveLight()?"light":"dark";
  mapBoot.phase="loading";mapStage("Starting maps");
  if(!rvMap){
    var radarEl=document.getElementById("radar"), retry=radarEl.querySelector('[data-retry-maps]');
    radarEl.closest(".maplock-wrap").classList.add("map-unavailable");
    // Approaching the station context can retry dependencies after a radar failure. Keep the
    // compact error layout and official link until recovery succeeds; replacing Retry with the
    // initial loading panel expands the planning grid underneath a pressed context disclosure.
    // aria-disabled, not disabled: a focused button that becomes disabled drops focus to <body>,
    // which strands a keyboard user (and escapes the fullscreen dialog) whenever an automatic
    // retry starts. A click while busy is harmless: ensureMaps() returns the attempt in flight.
    if(retry){retry.textContent="Retrying maps…";retry.setAttribute("aria-disabled","true");radarEl.setAttribute("aria-busy","true");}
    else radarEl.innerHTML='<div class="imgfail" role="status">Loading map…</div>';
  }
  if(!stnMap&&feedRequested("stations")){
    var stnEl=document.getElementById("stnmap"), stnLoad=stnEl&&stnEl.querySelector('[data-load-stations]');
    // A focused Load button stays in place as a busy button; removing it would drop focus.
    if(stnLoad&&stnLoad===document.activeElement){stnLoad.textContent="Loading station map…";stnLoad.setAttribute("aria-disabled","true");stnEl.setAttribute("aria-busy","true");}
    else if(stnEl&&!stnEl.querySelector('[data-retry-maps]')) stnEl.innerHTML='<div class="imgfail" role="status">Loading station map…</div>';
  }
  syncRadarBadge();syncSkyMeta();
  mapsInFlight=ensureMapLibraries().then(function(){mapStage("Requesting basemap style (tiles.openfreemap.org)");return loadMapStyle(theme);}).then(function(style){
    if(!rvMap){
      var radarFocus=focusInside(document.getElementById("radar"));
      try{document.getElementById("radar").innerHTML="";initRadarMap(style);document.getElementById("radar").closest(".maplock-wrap").classList.remove("map-unavailable");
        if(radarFocus) focusRadarControl();}
      catch(e){
        var failedRadar=rvMap;rvMap=null;rvBase=null;baseLabels=null;
        removePartialMap(failedRadar);mapBoot.phase="error";mapStage("Radar initialization: "+e.message);mapFallback("radar");
      }
    }
    if(!stnMap&&feedRequested("stations")){
      var stnFocus=focusInside(document.getElementById("stnmap"));
      try{document.getElementById("stnmap").innerHTML="";document.getElementById("stnmap").removeAttribute("aria-busy");initStationMap(style);renderStationLayer();
        // Leaflet makes the station map container focusable (keyboard navigation is on).
        if(stnFocus) document.getElementById("stnmap").focus({preventScroll:true});}
      catch(e){
        var failedStation=stnMap;stnMap=null;stnBase=null;
        removePartialMap(failedStation);mapStage("Station initialization: "+e.message);mapFallback("stnmap");
      }
    }
    if((effectiveLight()?"light":"dark")!==theme){updateRadarBase();updateStationBase();}
  }).catch(function(error){
    mapBoot.phase="error";mapStage("Startup failed: "+error.message);
    if(!rvMap)mapFallback("radar");
    if(!stnMap&&feedRequested("stations"))mapFallback("stnmap");
  }).finally(function(){
    mapsInFlight=null;if(rvMap)mapBoot.phase="ready";
    var radarEl=document.getElementById("radar"), retry=radarEl.querySelector('[data-retry-maps]');
    radarEl.removeAttribute("aria-busy");
    if(retry){retry.textContent="Retry maps";retry.removeAttribute("aria-disabled");}
    syncRadarBadge();syncSkyMeta();
  });
  return mapsInFlight;
}
function requestMaps(){
  mapsRequested=true;
  if(mapApproach){mapApproach.disconnect();mapApproach=null;}
  return ensureMaps();
}
function startMapRuntime(){
  mapsCanStart=true;
  queueMicrotask(function(){
    initMapDiagnostics();initContextView();initMeteogramPreview();
    var card=document.getElementById('radarCard');
    document.getElementById('radar').innerHTML='<div class="imgfail">Radar loads when this section approaches. <button type="button" data-load-maps>Load radar</button></div>';
    syncRadarBadge();
    if(mapsRequested||location.hash==='#radarCard'||!('IntersectionObserver' in window)){requestMaps();return;}
    mapApproach=new IntersectionObserver(function(entries){
      if(entries.some(function(entry){return entry.isIntersecting;})) requestMaps();
    },{rootMargin:'300px'});
    mapApproach.observe(card);
  });
}
document.addEventListener("click",function(e){
  if(e.target.closest('[data-retry-maps],[data-load-maps],#rsTabs,#rsFull,[data-radar-source],#jumpNav a[href="#radarCard"]')) requestMaps();
});
document.addEventListener('change',function(e){if(e.target.id==='radarProduct')requestMaps();});
document.addEventListener("click",function(e){if(e.target.closest('[data-load-stations]'))requestContext("stations");});
