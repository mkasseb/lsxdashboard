/* ============ LOCATION (geolocation / search / presets, persisted) ============ */
var LOC_KEY="lsxLoc";
var FAVORITES_KEY="lsxFavorites_v1";


function saveLoc(l){ try{ localStorage.setItem(LOC_KEY,JSON.stringify(validLocation(l))); }catch(e){} }
function readLoc(){ try{ return validLocation(JSON.parse(localStorage.getItem(LOC_KEY)||"null")); }catch(e){ return null; } }
function readFavorites(){
  try{ var v=JSON.parse(localStorage.getItem(FAVORITES_KEY)||"[]");return Array.isArray(v)?v.map(validLocation).filter(Boolean).slice(0,20):[]; }catch(e){ return []; }
}
var favoriteLocations=readFavorites();
function saveFavorites(){ try{ localStorage.setItem(FAVORITES_KEY,JSON.stringify(favoriteLocations)); }catch(e){} }

function locationURL(l){
  var u=new URL(location.href);
  u.searchParams.set("lat",l.lat.toFixed(5));u.searchParams.set("lon",l.lon.toFixed(5));u.searchParams.set("place",l.name);
  u.searchParams.set("kind",l.precision==="representative"?"city":"point");u.hash="";
  return u.href;
}
function locationFeedback(text){ var el=document.getElementById("locFeedback");if(el) el.textContent=text; }
function syncLocationTools(){
  var toggle=document.getElementById("favoriteToggle"), select=document.getElementById("favoriteSelect");
  var found=favoriteLocations.some(function(l){return locationKey(l)===locationKey(current);});
  if(toggle){toggle.setAttribute("aria-pressed",String(found));toggle.textContent=found?"Remove this favorite":"Save this location";}
  if(select){
    var chosen=select.value;
    select.innerHTML='<option value="">Choose a saved location</option>'+favoriteLocations.map(function(l){return '<option value="'+locationKey(l)+'">'+esc(l.name)+'</option>';}).join("");
    select.value=favoriteLocations.some(function(l){return locationKey(l)===chosen;})?chosen:"";
    document.getElementById("favoriteRemove").disabled=!select.value;
  }
  var link=document.getElementById("locationLink");if(link) link.value=locationURL(current);
}
function chooseVerifiedLocation(loc,opts){
  var sequence=locSeq, geo=++geoSeq;
  locationFeedback("Checking "+loc.name+"…");
  return pointsFor(loc.lat,loc.lon).then(function(pt){
    if(sequence!==locSeq||geo!==geoSeq) return false;
    var cwa=pt&&pt.properties&&(pt.properties.cwa||pt.properties.gridId);
    if(typeof cwa!=="string"||!/^[A-Z]{3}$/.test(cwa)) throw new Error("Unverified forecast area");
    if(cwa!=="LSX"){
      locationFeedback("This point is outside the St. Louis (LSX) forecast area. The current location was kept.");return false;
    }
    setLocation(loc,opts||{save:true});locationFeedback("Forecast location: "+loc.name+".");return true;
  }).catch(function(){if(sequence===locSeq&&geo===geoSeq) locationFeedback("Couldn't verify this location. Try again when weather services are available.");return false;});
}
var TITLE_BASE="LSX Dashboard";
function updateLocNow(){
  var el=document.getElementById("locNow");
  if(el) el.innerHTML='<span class="locNow-label">Forecast for</span><span class="locNow-place">'
    +ic("pin")+'<strong>'+esc(current.name)+'</strong></span>';
  // A pinned tab should say WHOSE weather it is. Safe to write here rather than behind a
  // fresh() guard: this runs synchronously from setLocation with the location it just set,
  // never from a fetch that a later location could have superseded.
  var place=(current.name||"").replace(" (home)","");
  document.title=place?(place+" — "+TITLE_BASE):TITLE_BASE;
  // The hero band names the place too: a shared link should say whose weather this is without
  // the visitor having to find the location bar.
  var r=document.getElementById("railNowSub"); if(r) r.textContent=current.name.replace(" (home)","");
  var sticky=document.getElementById("stickyLocation");if(sticky){sticky.textContent=current.name;sticky.setAttribute("aria-label","Change forecast location: "+current.name);}
  var kind=document.getElementById("stickyKind");if(kind) kind.textContent=current.precision==="representative"?"Town point":current.precision==="device"?"Geolocated point":"Selected point";
  syncLocationTools();
}


/* ===== Location generation guard =====
   Every location-scoped fetch captures the generation it was issued under. If the user moves
   before it lands, the response is DISCARDED rather than painted: a slow forecast for the old
   town was otherwise overwriting the new one and sitting there under the new town's label. */
var locSeq=0, snapSafeSeq=0, geoSeq=0;
var locRequests={};
/* Packages the capture half of that guard. Call it once at the top of a location-scoped loader,
   then call the returned fresh() immediately before any DOM write:

     function loadThing(){
       var fresh=locGuard();
       return getJSON(url).then(function(d){ if(!fresh()) return; paint(d); });
     }

   This is deliberately not a full wrapper. Loaders paint from inside their own promise chains —
   several from two or three different branches — so there is no single return value a wrapper
   could gate on, and converting them all to hand a paint closure back would be a large rewrite of
   safety-critical code. What it does remove is the half that was quietly easy to get wrong:
   capturing locSeq at the wrong moment, or comparing against the wrong variable. */
// Named guards also reject older refreshes for the same feed and location. Manual
// refresh can overlap scheduled work even when the location generation stays put.
function locGuard(key){
  var g=locSeq, request=key?(locRequests[key]||0)+1:0;
  if(key) locRequests[key]=request;
  return function(){ return g===locSeq&&(!key||locRequests[key]===request); };
}
/* The guard above discards a stale RESULT; this cancels the stale REQUEST. Without it, switching
   towns a few times leaves every superseded fetch running to completion, competing for the browser's
   handful of per-host connections with the ones the user is actually waiting on.
   Only feeds that describe A PLACE carry this signal. The CWA-wide alert list, the fixed river
   gauges, the regional station plot and the one-shot service-metadata lookups deliberately
   do not — aborting those would paint their error states every time the user moved. */
var locAbort=null;
function locSignal(){ if(!locAbort) locAbort=new AbortController(); return locAbort.signal; }
/* Derived state is cleared on every change so a render can never MIX two places -- e.g. the new
   town's forecast high ranked against the old town's 96-year record. */
function resetLocationState(){
  nwsMessages=null; nwsLocalForecast=null;
  if(typeof NbmRange!=="undefined") NbmRange.reset();
  if(typeof NbmHourly!=="undefined") NbmHourly.reset();
  lastAlertData=null; alertsRetained=false; retainedAlertKey=""; alertUpdateNotice();
  Object.keys(FEEDS).forEach(function(k){if(FEEDS[k].local&&FEEDS[k].tracked!==false) feedChecks[k]={status:"loading",successAt:0,issuedAt:0,saved:false};});
  savedParts={}; freshnessCheck();
  climate.normHi=null; climate.normLo=null; climate.normDate=null; climate.fcHi=null; climate.fcLo=null; climate.fcHiDate=null; climate.fcLoDate=null;
  climate.fcHiLabel=""; climate.station=null; climate.stationName="";
  ctx={ready:false, recHi:null, recLo:null, recPcp:null, doyHi:[], doyLo:[],
       monWet:[], monWarm:[], monMtd:null, monMean:null, monName:"", years:0,
       dry:null, hist:null, normWeek:{}, recStation:""};
  uv={now:null, peak:null, daily:{}};
  smart.hourly=[]; smart.hourlyAll=[]; smart.days=[]; smart.weekDays=[];
  forecastGrid={status:"loading",properties:null,gusts:[]};
  heroNow.temp=null;   // the old city's reading must not mark the new city's range
  aqiState={val:null, pm:null, err:false}; callAqi=null; callRisk=null; callLocalAlert=null; callAlertGroups=[];
  lastMcds=[];   // "inside this area" was ray-cast against the OLD point; loadMcd re-answers
  userZones={county:"",forecast:"",fire:""};
  renderHourly24._hrs=null; renderHourly24._cursor=0; renderHourly24._selectedTime=null; loadForecast._paint=null;
}
/* ...and the on-screen numbers go back to a loading state, so nothing false is legible while
   the new place loads. */
function clearLocationUI(){
  Object.keys(FEEDS).forEach(function(k){
    var cfg=FEEDS[k];if(!cfg.local) return;
    Object.keys(cfg.reset||{}).forEach(function(id){
      var el=document.getElementById(id), text=cfg.reset[id];
      if(el) el.innerHTML=text?'<div class="loading">'+esc(text)+'</div>':"";
    });
  });
  // The registry replaced the alert markup. An unchanged feed still needs a fresh paint here.
  alertsHTML=null;
  var ac=document.getElementById("alertsCard"); if(ac) ac.classList.remove("calm");
  var scope=document.getElementById("alertsScope"); if(scope) scope.textContent=current.name.replace(" (home)","");
  var station=document.getElementById("ccStation");
  if(station){ station.textContent="\u2014"; station.removeAttribute("title"); station.classList.remove("has-hint"); }
  syncHourlyControls();
  renderNwsMessages(); renderAFD(null);
  var aq=document.getElementById("aqiCard"); if(aq) aq.classList.remove("show");
  var cs=document.getElementById("cnStation"); if(cs) cs.textContent="\u2026";
  drawMcdPolygons();   // lastMcds was just reset; take the old place's outline off the map with it
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
function setLocation(loc,opts){
  opts=opts||{};
  geoSeq++;                       // a search selection supersedes geolocation still resolving
  var g=++locSeq;              // anything already in flight for the old place is now stale
  if(locAbort) locAbort.abort();          // …so stop paying for it
  locAbort=new AbortController();         // this generation's fetches hang off a fresh signal
  current=loc;
  resetLocationState();
  clearLocationUI();
  updateLocNow();
  if(opts.save) saveLoc(loc);
  if(opts.url!==false){ try{ history.replaceState(null,"",locationURL(loc)); }catch(e){} }
  var keys=feedTasks(true);stampSched(keys);
  var jobs=keys.map(runFeed);
  loadRadar();      // discovers a missing station itself, and retries on later cycles
  // Only once everything has settled for THIS generation is the screen safe to snapshot --
  // otherwise a scheduled save could store the old town's cards under the new town's name.
  Promise.allSettled(jobs).then(function(){ if(g===locSeq) snapSafeSeq=g; });
}
function useMyLocation(explicit){
  var btn=document.getElementById("geoBtn");
  var seq=++geoSeq, locAtStart=locSeq;
  // Write the label into .g-txt, never over the button: the phone layout hides that span to get
  // the geolocate control down to its icon, and a textContent assignment would delete it.
  function active(){ return seq===geoSeq&&locAtStart===locSeq; }
  function label(t){
    if(!active()) return;
    var s=btn&&btn.querySelector(".g-txt");if(s)s.textContent=t;
    if(btn)btn.setAttribute('aria-label',t.trim()+' — use current location');
  }
  if(!navigator.geolocation){ if(explicit) alert("Geolocation isn't available on this device/browser."); return; }
  label(" Locating…");
  navigator.geolocation.getCurrentPosition(function(pos){
    if(!active()) return;
    label(" My location");
    var lat=pos.coords.latitude, lon=pos.coords.longitude;
    // Only adopt the fix if it falls inside the LSX forecast area.
    pointsFor(lat,lon).then(function(pt){
      if(!active()) return;
      var cwa=pt&&pt.properties&&(pt.properties.cwa||pt.properties.gridId);
      if(cwa!=="LSX"){
        if(explicit) alert(cwa
          ?"Your current location is outside the St. Louis (LSX) forecast area, so it isn't shown on this dashboard."
          :"Couldn't verify that your location is inside the St. Louis (LSX) forecast area. Your current dashboard location was kept.");
        return;   // keep the existing in-area location
      }
      /* The same response that vouched for the CWA names the place: /points carries the nearest
         town as relativeLocation. Showing it beats the literal "My Location" the header used to
         echo — "Wentzville, MO" tells you which forecast you are actually reading, and costs no
         second request. The literal stays as the fallback when the field is missing. */
      var rl=pt&&pt.properties&&pt.properties.relativeLocation&&pt.properties.relativeLocation.properties;
      var nm=rl&&rl.city?rl.city+(rl.state?", "+rl.state:""):"My Location";
      setLocation({name:nm,lat:lat,lon:lon,station:null,precision:"device"},{save:true});
    }).catch(function(e){
      if(isAbort(e)||!active()) return;
      if(explicit) alert("Couldn't verify that your location is inside the St. Louis (LSX) forecast area. Your current dashboard location was kept.");
    });
  },function(){
    if(!active()) return;
    label(" My location");
    if(explicit) alert("Couldn't get your location. Make sure location access is allowed for this site.");
  },{enableHighAccuracy:true,timeout:9000,maximumAge:600000});
}
/* Type-ahead location search (Open-Meteo geocoder, restricted to the LSX CWA) */
var sugTimer=null, sugItems=[], sugSeq=0, sugHot=-1;

/* ===== LSX County Warning Area restriction =====
   The dashboard only searches places inside the St. Louis (LSX) forecast area.
   The county whitelist is built once from the authoritative NWS zone data
   (api.weather.gov) and cached; a hardcoded list is the fallback if that fails. */
var LSX_CC_KEY="lsxCwaCounties_v2";
var LSX_FALLBACK={
  "MO":["audrain","bollinger","boone","callaway","cole","crawford","dent","franklin","gasconade","iron","jefferson","lewis","lincoln","madison","maries","marion","moniteau","monroe","montgomery","osage","perry","phelps","pike","ralls","reynolds","st charles","st francois","st louis","ste genevieve","shannon","shelby","warren","washington","wayne"],
  "IL":["adams","bond","brown","calhoun","clinton","greene","jersey","macoupin","madison","monroe","montgomery","pike","randolph","st clair","washington"]
};
function normCounty(s){
  s=String(s||"").toLowerCase();
  s=s.replace(/[.’']/g,"").replace(/,/g," ");
  s=s.replace(/\(city\)/g," ").replace(/\bcounty\b/g," ").replace(/\bcity\b/g," ").replace(/\bparish\b/g," ");
  s=s.replace(/\bsainte\b/g,"ste").replace(/\bsaint\b/g,"st");
  return s.replace(/\s+/g," ").trim();
}
var LSX_COUNTIES=null;                 // {MO:Set, IL:Set} once resolved
function lsxSetsFrom(obj){
  var out={}; Object.keys(obj).forEach(function(k){ out[k]=new Set((obj[k]||[]).map(normCounty)); }); return out;
}
function buildLsxCounties(){
  try{ var c=localStorage.getItem(LSX_CC_KEY); if(c){ var p=JSON.parse(c); if(p&&(p.MO||p.IL)) return Promise.resolve(lsxSetsFrom(p)); } }catch(e){}
  function zurl(st){ return API+"/zones?area="+st+"&type=county&include_geometry=false"; }
  return Promise.all([getJSON(zurl("MO"),HEADERS),getJSON(zurl("IL"),HEADERS)]).then(function(rs){
    var acc={MO:[],IL:[]};
    rs.forEach(function(fc){
      (fc.features||[]).forEach(function(f){
        var pr=f.properties||{}, cwa=pr.cwa;
        var isLsx=Array.isArray(cwa)?cwa.indexOf("LSX")>=0:cwa==="LSX";
        if(isLsx&&(pr.state==="MO"||pr.state==="IL")&&pr.name) acc[pr.state].push(pr.name);
      });
    });
    if(!acc.MO.length&&!acc.IL.length) throw new Error("no LSX zones");
    try{ localStorage.setItem(LSX_CC_KEY,JSON.stringify(acc)); }catch(e){}
    return lsxSetsFrom(acc);
  }).catch(function(){ return lsxSetsFrom(LSX_FALLBACK); });
}
function ensureLsxCounties(){
  if(LSX_COUNTIES) return Promise.resolve(LSX_COUNTIES);
  return buildLsxCounties().then(function(m){ LSX_COUNTIES=m; return m; });
}
function inLsx(admin1,admin2){
  if(!LSX_COUNTIES) return null;
  var set=LSX_COUNTIES[abbrState(admin1)];
  return set?set.has(normCounty(admin2)):false;
}
/* ===== Writing the query the way the index spelled it =====
   The Open-Meteo geocoder does no fuzzy matching whatsoever: a name that doesn't match the stored
   spelling character-for-character returns an empty list, not a near miss. That is a problem in a
   forecast area this full of saints, because the index is not consistent about them — it holds
   "Lake Saint Louis", "East Saint Louis", "Saint Ann" and "City of Saint Peters" spelled out, but
   "St. Louis" and "Mt. Vernon" abbreviated. Typed the way everyone here writes them, "Lake St.
   Louis", "East St. Louis", "St. Ann" and "Ste. Genevieve" all came back with nothing at all, and
   "St. Charles" came back as an airport plus a town in Kane County, Illinois.

   So the search no longer asks one question. It rewrites what was typed into every spelling the
   index might be using, asks for all of them at once, merges the answers, and ranks them by how
   well they actually match what the visitor typed — abbreviation, apostrophe and case aside. */
var ABBR_LONG={st:"saint",ste:"sainte",mt:"mount",mtn:"mountain",ft:"fort",pt:"point",
               hts:"heights",spgs:"springs",jct:"junction",n:"north",s:"south",e:"east",w:"west"};
var ABBR_SHORT={saint:"st",sainte:"ste",mount:"mt",mountain:"mtn",fort:"ft",point:"pt",
                heights:"hts",springs:"spgs",junction:"jct"};
/* Rewrites whole words only, so "Street" is never mistaken for "St" and a ZIP code (digits) is
   passed through untouched. A trailing period is part of the word being replaced. */
function abbrSwap(s,map){
  return s.replace(/[A-Za-z]+\.?/g,function(w){
    var bare=w.replace(/\.$/,"").toLowerCase();
    return Object.prototype.hasOwnProperty.call(map,bare)?map[bare]:w;
  });
}
/* "Wentzville, MO" and "Columbia IL" both returned nothing — the geocoder matches the place name
   alone and treats the state as part of it. Peel it off and keep it as a ranking hint instead,
   which is exactly what it is worth: it settles Columbia, IL vs. Columbia, MO. */
var STATE_HINT={mo:"Missouri",missouri:"Missouri",il:"Illinois",ill:"Illinois",illinois:"Illinois"};
function splitState(q){
  var m=/^(.*[^,\s])[,\s]\s*([A-Za-z]{2,8})\.?$/.exec(q);
  if(m){
    var st=STATE_HINT[m[2].toLowerCase()];
    if(st && m[1].trim().length>=2) return {text:m[1].trim(), state:st};
  }
  return {text:q, state:null};
}
var MAX_VARIANTS=6;
function queryVariants(q){
  var out=[], seen={};
  function add(s){
    s=String(s||"").replace(/\s+/g," ").trim();
    if(s.length<2) return;
    var k=s.toLowerCase();
    if(!seen[k]){ seen[k]=1; out.push(s); }
  }
  var base=q.replace(/[‘’]/g,"'").replace(/^(?:city|town|village)\s+of\s+/i,"").replace(/\s+/g," ").trim();
  /* The apostrophe forms, unchanged: "O Fallon" and "OFallon" return NOTHING while "O'Fallon"
     matches, and iOS smart punctuation turns a typed straight quote into a curly one. */
  var forms=[base,
             base.replace(/\b([OoDd])\s+(?=[A-Za-z]{2})/g,"$1'"),
             base.replace(/\b([OD])(?=[a-z]{2})/g,"$1'"),
             base.replace(/'/g,"")];
  if(/&/.test(base)) forms.push(base.replace(/\s*&\s*/g," and "));
  else if(/\band\b/i.test(base)) forms.push(base.replace(/\band\b/ig,"&"));
  forms.forEach(function(f){
    add(f);
    add(abbrSwap(f,ABBR_LONG));
    add(abbrSwap(f,ABBR_SHORT));
    add(f.replace(/\./g,""));
    add(abbrSwap(f,ABBR_LONG).replace(/\./g,""));
  });
  add(base.replace(/\b(county|parish)\b/ig,""));
  return out.slice(0,MAX_VARIANTS);
}
/* One spelling of a name compared to another, with everything the two indexes disagree about
   flattened away: case, punctuation, the saint/st and mount/mt pairs, and the "City of" prefix
   the geocoder puts on some incorporated places but not others. */
function normName(s){
  return String(s||"").toLowerCase()
    .replace(/[‘’]/g,"'")
    .replace(/^(?:city|town|village)\s+of\s+/,"")
    .replace(/\bsainte\b/g,"ste").replace(/\bsaint\b/g,"st")
    .replace(/\bmount\b/g,"mt").replace(/\bfort\b/g,"ft")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
/* Locals write St. and Ste., and so does the NWS. The geocoder's spelled-out form is the same
   place, so print the one the area actually uses. */
function prettyPlace(s){
  return String(s||"").replace(/^(?:City|Town|Village)\s+of\s+/i,"")
    .replace(/\bSainte\b/g,"Ste.").replace(/\bSaint\b/g,"St.")
    .replace(/\bSte\b(?!\.)/g,"Ste.").replace(/\bSt\b(?!\.)/g,"St.").trim();
}
/* Dice coefficient on character bigrams — the only fuzziness in the pipeline, and it is used
   solely to rescue a typo AFTER every exact spelling has come back empty. Never to reorder
   results that did match, where it would happily rank a wrong town above a right one. */
function nameSimil(a,b){
  if(a===b) return 1;
  if(a.length<2||b.length<2) return 0;
  var pool={}, hit=0, i;
  for(i=0;i<a.length-1;i++){ var g=a.substr(i,2); pool[g]=(pool[g]||0)+1; }
  for(i=0;i<b.length-1;i++){ var h=b.substr(i,2); if(pool[h]>0){ pool[h]--; hit++; } }
  return (2*hit)/((a.length-1)+(b.length-1));
}
/* How well a candidate answers what was typed. Ranked ahead of population, because the visitor
   who typed six characters of a small town's name meant that town, not the metro area. */
function matchScore(cand,keys){
  var best=0;
  keys.forEach(function(k){
    var s;
    if(cand===k) s=100;
    else if(cand.indexOf(k+" ")===0) s=72;                 // "st charles" → "st charles county smartt airport"
    else if(cand.indexOf(k)===0) s=66;                     // still typing: "wentz" → "wentzville"
    else if(k.indexOf(cand+" ")===0) s=56;                 // typed more than the place is called
    else if((" "+cand+" ").indexOf(" "+k+" ")>=0) s=44;
    else s=Math.round(nameSimil(cand,k)*42);
    if(s>best) best=s;
  });
  return best;
}
/* A geocoder "result" is not necessarily a place anyone lives: searching Ste. Genevieve turns up
   a flying club, and Lake St. Louis turns up its dam. Populated places win by a wide margin. */
function featureScore(code){
  code=String(code||"");
  if(code.indexOf("PPL")===0) return 40;
  if(code.indexOf("ADM")===0) return 8;
  return -30;
}
function geoScore(r,ask){
  var s=matchScore(normName(r.name),ask.keys)+featureScore(r.feature_code);
  s+=Math.min(18,Math.log10((r.population||0)+1)*4.5);     // mild big-city tiebreak, never the lead
  if(ask.state) s+=(r.admin1===ask.state)?14:-26;
  return s;
}
function sugLabel(r){
  var name=prettyPlace(r.name);
  var co=prettyPlace(String(r.admin2||"").replace(/\s+(?:County|Parish)$/i,""));
  var where=[];
  // The county only earns its place when it isn't just the town's name again (St. Louis, St. Charles).
  if(co && normName(co)!==normName(name)) where.push(co+" Co.");
  where.push(abbrState(r.admin1));
  return {name:name, where:where.join(", ")};
}
/* The input is a combobox, so the list being open and which row is highlighted have to be said out
   loud, not just drawn. Without this the arrow keys move a background colour that a screen reader
   never hears about. */
function sugAria(open,active){
  var inp=document.getElementById("locSearch"); if(!inp) return;
  inp.setAttribute("aria-expanded",open?"true":"false");
  if(active) inp.setAttribute("aria-activedescendant",active); else inp.removeAttribute("aria-activedescendant");
}
function hideSug(){
  clearTimeout(sugTimer); sugSeq++;
  var b=document.getElementById("locSug");
  b.classList.remove("show"); b.innerHTML=""; sugItems=[]; sugHot=-1; sugAria(false,null);
}
function showSugNote(msg){
  var b=document.getElementById("locSug");
  b.innerHTML='<div class="sug-note">'+msg+'</div>';
  b.classList.add("show"); sugItems=[]; sugHot=-1;
  sugAria(false,null);   // a note is not a list of options to arrow through
}
/* Per-session memo, keyed by the exact string sent, so backspacing a character costs nothing.
   Bounded, because every prefix of every word typed is its own key holding up to 100 records —
   an afternoon of searching would otherwise accumulate a few thousand of them. Oldest key out
   first: the visitor is refining the word in front of them, not returning to one from an hour ago. */
var geoCache={}, geoCacheKeys=[], GEO_CACHE_MAX=80;
function geoFetch(q){
  var k=q.toLowerCase();
  if(geoCache[k]) return geoCache[k];
  var p=getJSON("https://geocoding-api.open-meteo.com/v1/search?count=100&countryCode=US&language=en&format=json&name="+encodeURIComponent(q))
    .then(function(d){ return d.results||[]; })
    .catch(function(e){                                    // a dropped connection must not be cached as "no such place"
      delete geoCache[k];
      var at=geoCacheKeys.indexOf(k); if(at>=0) geoCacheKeys.splice(at,1);
      throw e;
    });
  geoCache[k]=p;
  geoCacheKeys.push(k);
  while(geoCacheKeys.length>GEO_CACHE_MAX){ delete geoCache[geoCacheKeys.shift()]; }
  return p;
}
/* Ask for every spelling at once and merge by geoname id. One variant failing is not the search
   failing — only every variant failing is, and that is a connection problem worth saying out loud. */
function geoLookup(variants){
  var dead=0;
  return Promise.all(variants.map(function(v){
    return geoFetch(v).catch(function(){ dead++; return []; });
  })).then(function(lists){
    if(dead===variants.length) throw new Error("geocoder unreachable");
    var seen={}, out=[];
    lists.forEach(function(rs){
      rs.forEach(function(r){
        var id=(r.id!=null)?("#"+r.id):(r.name+"@"+r.latitude+","+r.longitude);
        if(!seen[id]){ seen[id]=1; out.push(r); }
      });
    });
    return out;
  });
}
function inArea(r){
  return r.country_code==="US" && (r.admin1==="Missouri"||r.admin1==="Illinois")
      && !!r.admin2 && inLsx(r.admin1,r.admin2)===true;
}
/* The index matches historical alternate names it doesn't hand back, so a search for Springfield
   returns Palmyra (Marion County, and therefore in area) alongside the Springfields that aren't.
   Left alone that made Palmyra the ONE suggestion for "Springfield" — the right answer being out
   of area is not the same as this being the right answer.

   The test is comparative: only once something in the full result set really is named what was
   typed does a coincidental hit have to clear the bar for "matches the name at all" — a prefix,
   which is what half-typed type-ahead looks like, or better. If nothing anywhere matches by name,
   the index matched on a name we can't see (a neighbourhood, an old name), and the only sane move
   is to trust it — pruning would leave the visitor with nothing at all. */
var RELEVANT=40;
function pruneWeak(hits,all,ask){
  var best=0;
  all.forEach(function(r){ var m=matchScore(normName(r.name),ask.keys); if(m>best) best=m; });
  if(best<44) return hits;
  return hits.filter(function(r){ return matchScore(normName(r.name),ask.keys)>=RELEVANT; });
}
/* Last resort, and only once every exact spelling has come back empty: the geocoder matches on a
   name PREFIX, so a query with a typo in its tail ("Chesterfeild", "Edwardsvile") still shares a
   good prefix with the real name. Ask for that prefix, then keep only candidates that a bigram
   comparison says are genuinely close to what was typed. */
var FUZZ_FLOOR=0.66;
function fuzzyRescue(variants,ask){
  var stems=[], seen={};
  variants.slice(0,3).forEach(function(v){
    var stem=v.slice(0,Math.max(4,Math.ceil(v.length*0.62))).trim();
    var k=stem.toLowerCase();
    if(stem.length>=4 && stem.length<v.length && !seen[k]){ seen[k]=1; stems.push(stem); }
  });
  if(!stems.length) return Promise.resolve([]);
  return geoLookup(stems.slice(0,2)).then(function(rs){
    return rs.filter(function(r){
      if(String(r.feature_code||"").indexOf("PPL")!==0 || !inArea(r)) return false;
      var n=normName(r.name);
      return ask.keys.some(function(k){ return nameSimil(n,k)>=FUZZ_FLOOR; });
    });
  }).catch(function(){ return []; });
}
function renderSuggestions(res,ask){
  // Once a real town has matched, the dam and the flying club named after it are noise in a list
  // of six. They stay only when nothing populated matched at all, where a lake or a park is
  // plausibly the place the visitor wants a forecast for.
  var ppl=res.filter(function(r){ return String(r.feature_code||"").indexOf("PPL")===0; });
  if(ppl.length) res=ppl;
  res.sort(function(a,b){ return geoScore(b,ask)-geoScore(a,ask); });
  // Collapse true duplicates (the same town returned under two spellings) while keeping the two
  // different O'Fallons, which differ by county. Sorted first, so the survivor is the best-scored.
  var seen={};
  res=res.filter(function(r){
    var k=normName(r.name)+"|"+r.admin1+"|"+normCounty(r.admin2);
    if(seen[k]) return false;
    seen[k]=1; return true;
  }).slice(0,6);
  sugItems=res.map(function(r){
    var l=sugLabel(r);
    return {name:l.name+", "+abbrState(r.admin1), lat:r.latitude, lon:r.longitude, label:l};
  });
  sugHot=-1;
  var b=document.getElementById("locSug");
  b.innerHTML=sugItems.map(function(s,i){
    return '<div class="sug" role="option" id="locSugOpt'+i+'" aria-selected="false" data-i="'+i+'"><span class="sname">'+esc(s.label.name)+'</span><span class="swhere">'+esc(s.label.where)+'</span></div>';
  }).join("");
  b.classList.add("show");
  sugAria(true,null);
}
/* Nothing in the area matched. Say which of the two things went wrong, because they need
   different responses from the visitor: a place that exists but sits outside the CWA is the
   dashboard's limit, while no place at all is a spelling to fix. */
function noMatchNote(q,all,ask){
  // Naming the out-of-area town takes the whole name, not a shared opening: three characters into
  // "Ste. Genevieve" the index offers Ste. Marie, Illinois, and "Ste. Marie, IL is outside the
  // area" is a confusing thing to read while still typing the town that isn't.
  var out=all.filter(function(r){ return String(r.feature_code||"").indexOf("PPL")===0 && matchScore(normName(r.name),ask.keys)===100; });
  if(out.length){
    // Prefer a two-state answer when the name is shared nationally: "Mount Vernon, IL is outside
    // the area" tells a visitor here something; the bigger one in Washington does not.
    function near(r){ return (r.admin1==="Missouri"||r.admin1==="Illinois")?1:0; }
    out.sort(function(a,b){ return (near(b)-near(a))||(geoScore(b,ask)-geoScore(a,ask)); });
    var best=out[0];
    showSugNote(esc(prettyPlace(best.name)+", "+abbrState(best.admin1))+" is outside the St. Louis (LSX) forecast area, which is all this dashboard covers.");
  }else{
    showSugNote('No LSX-area city or town matches "'+esc(q)+'".');
  }
}
function fetchSuggestions(q){
  var seq=++sugSeq;   // guard against out-of-order responses (a slow reply for an old query must not clobber newer results)
  var parsed=splitState(q);
  var variants=queryVariants(parsed.text);
  if(!variants.length){ hideSug(); return; }
  // Every spelling we are willing to accept as "what the visitor meant", normalised for comparison.
  var ask={state:parsed.state, keys:variants.map(normName).filter(function(k,i,a){ return k && a.indexOf(k)===i; })};
  if(!sugItems.length) showSugNote("Searching…");
  ensureLsxCounties().then(function(){
    return geoLookup(variants).then(function(all){
      var hits=pruneWeak(all.filter(inArea),all,ask);
      if(hits.length) return {hits:hits, all:all};
      return fuzzyRescue(variants,ask).then(function(f){ return {hits:f, all:all}; });
    });
  }).then(function(r){
    if(seq!==sugSeq) return;
    if(r.hits.length) renderSuggestions(r.hits,ask);
    else noMatchNote(q,r.all,ask);
  }).catch(function(){ if(seq===sugSeq) showSugNote("Search failed — check your connection and try again."); });
}
var STATE_ABBR={"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"};
function abbrState(s){ return STATE_ABBR[s]||s; }
function cleanPlace(s){ return String(s||"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,80); }
function pickSuggestion(i){
  var s=sugItems[i]; if(!s) return;
  hideSug();
  var inp=document.getElementById("locSearch");
  inp.value=""; inp.blur();
  setLocation({name:cleanPlace(s.name),lat:s.lat,lon:s.lon,station:null,precision:"representative"},{save:true});
}
/* The .hot style was in the sheet from the start with nothing ever applying it — the list could
   only be clicked. Arrow keys move it, Enter takes it, and the row scrolls itself into view for
   the short list the phone layout shows. */
function moveHot(d){
  if(!sugItems.length) return;
  sugHot=(sugHot+d+sugItems.length)%sugItems.length;
  var rows=document.getElementById("locSug").querySelectorAll(".sug");
  for(var i=0;i<rows.length;i++){
    var on=(i===sugHot);
    rows[i].classList.toggle("hot",on);
    rows[i].setAttribute("aria-selected",on?"true":"false");
    if(on&&rows[i].scrollIntoView) rows[i].scrollIntoView({block:"nearest"});
  }
  sugAria(true,"locSugOpt"+sugHot);
}
function initLocationUI(){
  var inp=document.getElementById("locSearch"), form=document.getElementById("locForm"), box=document.getElementById("locSug");
  ensureLsxCounties();   // warm the LSX county whitelist so the first search is instant
  document.getElementById("geoBtn").addEventListener("click",function(){ useMyLocation(true); });
  document.getElementById("stickyLocation").addEventListener("click",function(e){e.preventDefault();inp.scrollIntoView({block:"center"});inp.focus({preventScroll:true});});
  document.getElementById("favoriteToggle").addEventListener("click",function(){
    var key=locationKey(current), found=favoriteLocations.some(function(l){return locationKey(l)===key;});
    if(found) favoriteLocations=favoriteLocations.filter(function(l){return locationKey(l)!==key;});
    else if(favoriteLocations.length<20) favoriteLocations.push(validLocation(current));
    else{locationFeedback("Remove a favorite before saving another; up to 20 are supported.");return;}
    saveFavorites();syncLocationTools();locationFeedback(found?"Favorite removed.":"Location saved to favorites.");
  });
  document.getElementById("favoriteSelect").addEventListener("change",function(){
    var key=this.value;document.getElementById("favoriteRemove").disabled=!key;
    var loc=favoriteLocations.filter(function(l){return locationKey(l)===key;})[0];if(loc) chooseVerifiedLocation(loc,{save:true});
  });
  document.getElementById("favoriteRemove").addEventListener("click",function(){
    var key=document.getElementById("favoriteSelect").value;
    favoriteLocations=favoriteLocations.filter(function(l){return locationKey(l)!==key;});saveFavorites();syncLocationTools();locationFeedback("Favorite removed.");
  });
  document.getElementById("shareLocation").addEventListener("click",function(){
    var link=document.getElementById("locationLink"), url=locationURL(current);link.value=url;
    function manual(){link.focus();link.select();locationFeedback("Select and copy the location link.");}
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function(){locationFeedback("Location link copied.");}).catch(manual);
    else manual();
  });
  inp.addEventListener("input",function(){
    hideSug();   // Old results and pending replies stop belonging to the edited query immediately.
    var q=inp.value.trim();
    if(q.length<2) return;
    sugTimer=setTimeout(function(){ fetchSuggestions(q); },300);
  });
  form.addEventListener("submit",function(e){   // iOS "search"/"go" key lands here reliably
    e.preventDefault();
    if(sugItems.length){ pickSuggestion(sugHot>=0?sugHot:0); }
    else{
      var q=inp.value.trim();
      if(q.length>=2){ clearTimeout(sugTimer); fetchSuggestions(q); }
    }
  });
  box.addEventListener("mousedown",function(e){ // mousedown beats input blur
    var s=e.target.closest(".sug");
    if(s){ e.preventDefault(); pickSuggestion(+s.dataset.i); }
  });
  inp.addEventListener("keydown",function(e){
    if(e.key==="Escape"){ hideSug(); return; }
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault(); moveHot(e.key==="ArrowDown"?1:-1); }
  });
  inp.addEventListener("blur",function(){ setTimeout(hideSug,250); });
}
function initLocation(){
  var saved=readLoc(), shared=sharedLocation(location.search);
  if(shared){updateLocNow();chooseVerifiedLocation(shared,{save:true});return;}
  if(new URLSearchParams(location.search).has("lat")||new URLSearchParams(location.search).has("lon")) locationFeedback("The shared location link is invalid. Showing your saved or default location.");
  updateLocNow();                 // shows the default preset while we ask
  // Stored coordinates need the same LSX check as a shared link or favorite. Keep the
  // known local default (including snapshot/alert scope) until verification succeeds;
  // chooseVerifiedLocation also discards replies superseded by another selection.
  if(saved){chooseVerifiedLocation(saved,{save:false});return;}
  useMyLocation(false);           // silent attempt; falls back to default if denied
}
