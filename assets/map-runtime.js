/* The DOM above is parsed; third-party downloads must never gate startup or context controls. */
var mapsCanStart=false, mapsInFlight=null;
var mapBoot={phase:"loading",started:Date.now(),events:[]};
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
function initMapDiagnostics(){
  var panel=document.createElement("details");panel.className="map-diagnostics";
  panel.innerHTML='<summary>Map diagnostics</summary><pre></pre><small>Diagnostic text stays on this device.</small>';
  panel.addEventListener("toggle",function(){if(panel.open)panel.querySelector('pre').textContent=mapDiagnosticsText();});
  document.getElementById("radar").closest(".maplock-wrap").after(panel);
}

function mapFallback(id){
  var el=document.getElementById(id);
  if(el&&el.closest(".maplock-wrap"))el.closest(".maplock-wrap").classList.add("map-unavailable");
  var href=id==="radar"?"https://radar.weather.gov/station/KLSX/standard":"https://www.weather.gov/wrh/timeseries?site=KSTL";
  if(el) el.innerHTML='<div class="imgfail">Map didn’t load. <button type="button" data-retry-maps>Retry maps</button> <a href="'+href+'" target="_blank" rel="noopener">'+(id==="radar"?"Open NWS radar":"Open NWS obs")+' ↗</a></div>';
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
    return Promise.all([].slice.call(document.querySelectorAll('link[rel="stylesheet"]')).filter(function(node){
      return /leaflet\/1\.9\.4\/|maplibre-gl@5\.24\.0\//.test(node.href)&&(retryStyles||!node.sheet||node.media==="print");
    }).map(function(original){
      return new Promise(function(resolve,reject){
        var link=document.createElement("link"),timer;
        mapStage("Loading CSS "+new URL(original.href).hostname+new URL(original.href).pathname);
        [].forEach.call(original.attributes,function(attr){link.setAttribute(attr.name,attr.value);});
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
  if(!mapsCanStart||rvMap&&(stnMap||!feedRequested("stations"))) return Promise.resolve();
  if(mapsInFlight) return mapsInFlight;
  var theme=effectiveLight()?"light":"dark";
  mapBoot.phase="loading";mapStage("Starting maps");
  if(!rvMap){
    var radarEl=document.getElementById("radar"), retry=radarEl.querySelector('[data-retry-maps]');
    radarEl.closest(".maplock-wrap").classList.add("map-unavailable");
    // Approaching the station context can retry dependencies after a radar failure. Keep the
    // compact error layout and official link until recovery succeeds; replacing Retry with the
    // initial loading panel expands the planning grid underneath a pressed context disclosure.
    if(retry){retry.textContent="Retrying maps…";retry.disabled=true;radarEl.setAttribute("aria-busy","true");}
    else radarEl.innerHTML='<div class="imgfail" role="status">Loading map…</div>';
  }
  syncRadarBadge();syncSkyMeta();
  mapsInFlight=ensureMapLibraries().then(function(){mapStage("Requesting basemap style (tiles.openfreemap.org)");return loadMapStyle(theme);}).then(function(style){
    if(!rvMap){
      try{document.getElementById("radar").innerHTML="";initRadarMap(style);document.getElementById("radar").closest(".maplock-wrap").classList.remove("map-unavailable");}
      catch(e){
        var failedRadar=rvMap;rvMap=null;rvBase=null;baseLabels=null;
        removePartialMap(failedRadar);mapBoot.phase="error";mapStage("Radar initialization: "+e.message);mapFallback("radar");
      }
    }
    if(!stnMap&&feedRequested("stations")){
      try{document.getElementById("stnmap").innerHTML="";initStationMap(style);renderStationLayer();}
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
    if(retry){retry.textContent="Retry maps";retry.disabled=false;}
    syncRadarBadge();syncSkyMeta();
  });
  return mapsInFlight;
}
function startMapRuntime(){
  mapsCanStart=true;
  queueMicrotask(function(){initMapDiagnostics();initContextView();ensureMaps();});
}
document.addEventListener("click",function(e){if(e.target.closest("[data-retry-maps]"))ensureMaps();});
