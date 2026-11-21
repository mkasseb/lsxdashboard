/* Optional context presentation and demand state, independent of weather decisions. */
var deferredFeeds={stations:false,context:false,winter:false};
function feedRequested(key){ return !Object.prototype.hasOwnProperty.call(deferredFeeds,key)||deferredFeeds[key]; }
function requestContext(key){
  if(feedRequested(key)) return Promise.resolve();
  deferredFeeds[key]=true;
  stampSched([key]);
  var job=runFeed(key);
  if(key==="stations") job=Promise.all([job,requestMaps()]);
  return job;
}
/* The forecast discussion is the longest block on the page and repeats the reasoning behind Key
   Messages beside it, so it starts folded. Its heading, the "Full discussion" link and any problem
   line (feed-status lines sit outside .context-body) stay visible while it is folded. */
var CONTEXT_START_COLLAPSED=["afdCard"];
function initContextView(){
  // Context cards keep individual disclosures, the PR-3 sources included.
  var ids=["afdCard","obsCard","climateCard","droughtCard","cpcCard","storyCard","rainCard","winterCard"];
  function expand(card,on){
    var body=card.querySelector('.context-body'), button=card.querySelector('.context-toggle');
    body.hidden=!on; button.setAttribute('aria-expanded',String(on));
    button.textContent=on?'Hide details':'Show details';
    if(on){
      if(card.id==='obsCard') requestContext('stations');
      if(card.id==='climateCard') requestContext('context');
      if(card.id==='obsCard'&&stnMap) setTimeout(function(){stnMap.invalidateSize();},0);
    }
    scheduleMasonry();
  }
  ids.forEach(function(id){
    var card=document.getElementById(id), heading=card.querySelector('h2');
    var body=document.createElement('div');body.className='context-body';body.id=id+'Body';
    while(heading.nextSibling) body.appendChild(heading.nextSibling);
    var button=document.createElement('button');button.type='button';button.className='context-toggle';
    button.setAttribute('aria-controls',body.id);button.setAttribute('aria-expanded','true');button.textContent='Hide details';
    button.addEventListener('click',function(){expand(card,body.hidden);});
    card.appendChild(button);card.appendChild(body);
    if(CONTEXT_START_COLLAPSED.indexOf(id)>=0){body.hidden=true;button.setAttribute('aria-expanded','false');button.textContent='Show details';}
  });
  document.getElementById('jumpNav').addEventListener('click',function(e){
    var link=e.target.closest('a[href^="#"]');if(!link)return;
    var card=document.querySelector(link.getAttribute('href'));
    if(card&&card.querySelector('.context-body')) expand(card,true);
    if(card&&card.id==='forecastCard') requestContext('context');
  });
  var cards={obsCard:'stations',climateCard:'context',forecastCard:'context'};
  if(!('IntersectionObserver' in window)){
    Object.keys(cards).forEach(function(id){requestContext(cards[id]);});return;
  }
  var observer=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting)return;
      var body=entry.target.querySelector('.context-body');
      if(!body||!body.hidden){requestContext(cards[entry.target.id]);observer.unobserve(entry.target);}
    });
  },{rootMargin:'300px'});
  Object.keys(cards).forEach(function(id){observer.observe(document.getElementById(id));});
}

/* ---- The outlook row ----
   One row answers "is anything coming, from today out to next season" by reading the same results
   the Risk, Hazards, Week Ahead and Drought cards paint. Each loader reports a summary through
   setOutlook(); nothing here fetches. A card whose every reading is verified and calm folds away,
   since its cell already says everything the card would. A gap, a failure or a saved-but-unverified
   repaint leaves the card open: an outage must never look like an all-clear. The Risk card never
   folds: its calm form is already one line plus the category explainer, and it is the card the
   calm rule promotes to #attention, so its cell only jumps to it. */
var OUTLOOK_CELLS=[
  {key:"risk",   feed:"risk",    card:"riskCard",    title:"Today–Day 3"},
  {key:"hz37",   feed:"hazards", card:"hazardsCard", title:"Days 3–7"},
  {key:"hz814",  feed:"hazards", card:"hazardsCard", title:"Days 8–14"},
  {key:"cpc",    feed:"cpc",     card:"cpcCard",     title:"6–14 day leaning"},
  {key:"drought",feed:"drought", card:"droughtCard", title:"Drought"}
];
var OUTLOOK_FOLDS=["hazardsCard","cpcCard","droughtCard"];
var outlookState={}, outlookOpened={};
/* state: "calm" | "elevated" | "info" | "partial" | "unavailable"; verified: every input answered. */
function setOutlook(key,info){
  outlookState[key]=info||null;
  renderOutlook();
}
function resetOutlook(){
  outlookState={}; outlookOpened={};
  renderOutlook();
}
/* A summary is only as good as its feed's last check. Once that check is overdue (or the page is
   showing saved data) the cell says so, and its card unfolds so the card's own warning is seen. */
function outlookFeedState(feed){
  if(typeof feedChecks==="undefined"||typeof feedState!=="function"||!feedChecks[feed]) return "ready";
  return feedState(feedChecks[feed],Date.now(),FEEDS[feed].age);
}
function outlookCurrent(c){
  var s=outlookState[c.key]; if(!s) return null;
  var f=outlookFeedState(c.feed);
  if(f==="stale") return {state:"partial",value:s.value,sub:"Check overdue",verified:false};
  if(f==="saved") return {state:"partial",value:s.value,sub:"Saved · re-checking",verified:false};
  if(f==="unavailable") return {state:"unavailable",value:s.value,sub:"Check failed",verified:false};
  if(f==="partial"&&s.verified) return {state:"partial",value:s.value,sub:"Some data unavailable",verified:false};
  return s;
}
function outlookCardFolds(card){
  if(OUTLOOK_FOLDS.indexOf(card)<0) return false;
  var cells=OUTLOOK_CELLS.filter(function(c){ return c.card===card; });
  return cells.every(function(c){
    var s=outlookCurrent(c);
    return !!s&&s.verified&&(s.state==="calm"||s.state==="info");
  });
}
function renderOutlook(){
  var row=document.getElementById("outlookCells"); if(!row) return;
  if(!row.children.length){
    OUTLOOK_CELLS.forEach(function(c){
      var b=document.createElement("button");
      b.type="button"; b.className="ol-cell"; b.id="ol-"+c.key;
      b.setAttribute("aria-controls",c.card);
      b.innerHTML='<span class="ol-t"></span><span class="ol-v"></span><span class="ol-s"></span>';
      b.querySelector(".ol-t").textContent=c.title;
      b.addEventListener("click",function(){ outlookOpen(c.card); });
      row.appendChild(b);
    });
  }
  var folded=0;
  OUTLOOK_CELLS.forEach(function(c){
    var s=outlookCurrent(c), b=document.getElementById("ol-"+c.key);
    var state=s?s.state:"loading";
    b.setAttribute("data-state",state);
    var v=s?s.value:"Checking…", sub=s?(s.sub||""):"";
    b.querySelector(".ol-v").textContent=v;
    b.querySelector(".ol-s").textContent=sub;
    var foldable=outlookCardFolds(c.card), open=!foldable||!!outlookOpened[c.card];
    b.setAttribute("aria-expanded",String(open));
    // No aria-label: the visible title, reading and "Show card" are the accessible name.
  });
  var changed=false;
  OUTLOOK_FOLDS.forEach(function(id){
    var card=document.getElementById(id); if(!card) return;
    var fold=outlookCardFolds(id)&&!outlookOpened[id];
    if(fold) folded++;
    if(card.hidden!==fold){ card.hidden=fold; card.classList.toggle("outlook-folded",fold); changed=true; }
  });
  var note=document.getElementById("outlookNote");
  if(note) note.textContent=folded?"Calm outlooks are folded into this row. Select one for its full card.":"";
  if(changed&&typeof scheduleMasonry==="function") scheduleMasonry();
}
function outlookOpen(id){
  var card=document.getElementById(id); if(!card) return;
  var was=card.hidden;
  if(was){ outlookOpened[id]=true; renderOutlook(); }
  // In the storm layout the whole context pack may be folded; open it first or the card stays unreachable.
  if(card.closest("#contextPack")&&typeof showFolded==="function") showFolded("context",false);
  if(typeof layoutMasonry==="function") layoutMasonry();
  card.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
  var h=card.querySelector("h2");
  if(h){ if(!h.hasAttribute("tabindex")) h.setAttribute("tabindex","-1"); h.focus({preventScroll:true}); }
}

/* Pure summaries, one per feed, so the decision can be tested without a browser. */
var OUTLOOK_DAYS=["today","tomorrow","day 3"];
function outlookRiskSummary(r,threats){
  if(!r) return {state:"unavailable",value:"Unavailable",sub:"Storm, flood & fire outlooks",verified:false};
  var known=r.slice(0,9).filter(function(v){return v!=null;}).length;
  if(!known) return {state:"unavailable",value:"Unavailable",sub:"Storm, flood & fire outlooks",verified:false};
  var best=null;
  for(var i=0;i<3;i++){
    [["storms",spcRisk(r[i]),5],["flash flood",eroRisk(r[3+i]),4],["fire",fireRisk(r[6+i]),3]].forEach(function(x){
      var info=x[1];
      if(info.lvl>0){
        var score=info.lvl/x[2];
        if(!best||score>best.score) best={score:score,text:info.t.replace(/ Risk$/,"")+" "+(x[0]==="fire"?"fire risk":x[0]==="storms"?"storm risk":"flood risk"),day:OUTLOOK_DAYS[i]};
      }
    });
  }
  threats=threats||[];
  var probs=threats.some(function(day){return day&&day.values.some(function(v){return v>0;});});
  var complete=known===9&&threats.length===2&&threats.every(function(day){return day&&day.values.every(function(v){return v!=null;});});
  if(best) return {state:"elevated",value:best.text,sub:"Highest "+best.day,verified:complete};
  if(probs) return {state:"elevated",value:"Low severe chances",sub:"Tornado, wind or hail above zero",verified:complete};
  var general=[0,1,2].some(function(i){return r[i]===2;});
  if(complete&&r.slice(0,9).every(function(v){return v===0;})) return {state:"calm",value:"Nothing elevated",sub:"Storms, flood & fire",verified:true};
  return {state:"partial",value:"Nothing elevated",sub:general?"General storms possible":"Some outlooks missing",verified:false};
}
function outlookHazardSummary(list,complete,answered,source){
  source=source||"Hazards outlook";
  if(list&&list.length){
    var names=list.map(function(h){return h.label;});
    var r=hazRange(list[0].start,list[0].end);
    return {state:"elevated",value:names.slice(0,2).join(", ")+(names.length>2?" +"+(names.length-2):""),sub:r||source,verified:complete};
  }
  if(complete) return {state:"calm",value:"No hazards",sub:source,verified:true};
  return {state:answered?"partial":"unavailable",value:answered?"Partly checked":"Unavailable",sub:source,verified:false};
}
function outlookLean(kind,r){
  if(!r||!r.cat) return null;
  if(/equal|^EC$/i.test(r.cat)&&!/above|below/i.test(r.cat)) return kind==="t"?"Temp even odds":"Precip even odds";
  if(!/above|below|^[AB]$/i.test(r.cat)) return kind==="t"?"Near-normal temp":"Near-normal precip";
  var above=/above|^A$/i.test(r.cat);
  var word=kind==="t"?(above?"Warm":"Cool"):(above?"Wet":"Dry");
  return word+(r.prob!=null&&!isNaN(r.prob)?" "+Math.round(r.prob)+"%":"");
}
function outlookCpcSummary(values){
  values=values||[];
  var known=values.filter(Boolean).length;
  if(!known) return {state:"unavailable",value:"Unavailable",sub:"CPC outlooks",verified:false};
  function pair(a,b){
    var x=outlookLean("t",values[a]), y=outlookLean("p",values[b]);
    return [x||"—",y||"—"].join(" · ");
  }
  return {state:known===4?"info":"partial",value:pair(0,1),sub:"8–14 days: "+pair(2,3),verified:known===4};
}
function outlookDroughtSummary(now,month,season){
  /* now: max DM (-1 none, null unknown); month/season: outlook label, "" none, null unknown. */
  var cat=now!=null&&now>=0?droughtCat(now):null;
  if(cat) return {state:"elevated",value:cat.t,sub:"Drought Monitor now",verified:month!=null&&season!=null};
  var o=month?["Month ahead",outlookCat(month)]:season?["Season",outlookCat(season)]:null;
  if(o&&o[1]) return {state:"elevated",value:o[1].t,sub:o[0],verified:now!=null};
  if(now==null&&month==null&&season==null) return {state:"unavailable",value:"Unavailable",sub:"Drought Monitor & CPC",verified:false};
  if(now!=null&&month!=null&&season!=null) return {state:"calm",value:"No drought",sub:"None expected this season",verified:true};
  // An unanswered monitor query is not a negative: only a verified reading may say "no drought".
  if(now==null) return {state:"partial",value:"Current drought unknown",sub:"Drought Monitor unavailable",verified:false};
  return {state:"partial",value:"No drought now",sub:"Some outlooks missing",verified:false};
}

renderOutlook();   // scripts load at the end of <body>, so the row exists; cells read "Checking…"

/* ---- Storm layout controller ----
   activeModeNext() (weather-core.js) decides; this only applies the decision. The order of things
   on the page is kept: radar moves ahead of Now, storm reports appear beside Now, and the 7-day,
   outlook row and context pack fold to one strip of buttons. Hourly, NWS text, alerts and any
   card the calm rule promoted stay where they are. The reader can switch back to the usual layout
   for the rest of the episode; the next warning re-arms it. */
deferredFeeds.reports=false;
var activeState={active:false,lastHit:0,event:"",optOut:false,until:0,unverified:false};
var ACTIVE_SHOW=["forecast","outlook","context"];
function syncActiveMode(){
  var now=Date.now(), healthy=true;
  if(typeof feedChecks!=="undefined"&&feedChecks.alerts&&typeof feedState==="function"){
    var st=feedState(feedChecks.alerts,now,FEEDS.alerts.age);
    healthy=st==="ready"||st==="partial";
  }
  var local=typeof callLocalAlert!=="undefined"?callLocalAlert:null;
  var next=activeModeNext(activeState,local,now,healthy);
  if(!next.active) activeState.optOut=false;
  activeState.active=next.active; activeState.lastHit=next.lastHit; activeState.event=next.event;
  activeState.until=next.until||0; activeState.unverified=!!next.unverified;
  applyActiveMode();
  // Every alert repaint (new alerts, expiry, outage) ends in syncActiveMode, after callLocalAlert
  // is current. feedUpdate("alerts") runs before that, so the calm radar re-checks here too.
  if(typeof syncRadarCalm==="function") syncRadarCalm();
  syncRoadLinks();
  syncWinterDemand();   // callRisk (WSSI) is current here too: loadSpc ends in renderTheCall
}
/* Storm camera. Entering the storm layout zooms the radar to roughly county scale around the
   selected point: the largest zoom at which the map's shorter side still covers STORM_CAMERA_KM
   (about one county; zoom 9 on a phone, 10 on a desktop), so storm-report dots near the location
   are not hidden under the "you" pin. It happens once per entry, with no
   animation and no loop playback. Leaving restores the earlier view, but only if the reader has
   not moved the map since: an explored camera is theirs. */
var STORM_CAMERA_KM=40, STORM_CAMERA_ZOOMS=[9,11];
/* Pure: Web Mercator metres per pixel at zoom 0 is 156543 at the equator, scaled by cos(latitude). */
function stormCameraZoom(lat,shortSidePx){
  if(!isFinite(lat)||!(shortSidePx>0)) return STORM_CAMERA_ZOOMS[0];
  var needed=STORM_CAMERA_KM*1000/shortSidePx, z=Math.floor(Math.log2(156543.03*Math.cos(lat*Math.PI/180)/needed));
  return Math.max(STORM_CAMERA_ZOOMS[0],Math.min(STORM_CAMERA_ZOOMS[1],z));
}
var stormCamera={pending:false,before:null,applied:null};
function stormCameraView(){
  if(typeof rvMap==="undefined"||!rvMap) return null;
  var c=rvMap.getCenter(); return {lat:c.lat,lng:c.lng,zoom:rvMap.getZoom()};
}
/* Same view as far as a reader can tell: same zoom, centre within a few screen pixels. Resizes
   re-centre with sub-pixel rounding, which is not the reader moving the map. */
function sameCameraView(a,b){
  if(!a||!b||a.zoom!==b.zoom||typeof rvMap==="undefined"||!rvMap) return false;
  return rvMap.project([a.lat,a.lng],a.zoom).distanceTo(rvMap.project([b.lat,b.lng],b.zoom))<3;
}
function enterStormCamera(){
  if(typeof rvMap==="undefined"||!rvMap||typeof L==="undefined"||!current) return;
  stormCamera.pending=false;
  stormCamera.before=stormCameraView();
  rvMap.invalidateSize({animate:false});
  var size=rvMap.getSize();
  rvMap.setView([current.lat,current.lon],stormCameraZoom(current.lat,Math.min(size.x,size.y)),{animate:false});
  stormCamera.applied=stormCameraView();
}
function leaveStormCamera(){
  var before=stormCamera.before, applied=stormCamera.applied;
  stormCamera={pending:false,before:null,applied:null};
  if(!before||!applied||!sameCameraView(stormCameraView(),applied)) return;
  rvMap.invalidateSize({animate:false});
  rvMap.setView([before.lat,before.lng],before.zoom,{animate:false});
}
function resetActiveMode(){
  stormCamera={pending:false,before:null,applied:null};   // the old place's view is not worth restoring
  activeState={active:false,lastHit:0,event:"",optOut:false,until:0,unverified:false};
  applyActiveMode();
  if(typeof renderStormReports==="function") renderStormReports(null);   // the old place's reports and dots
}
function activeBarText(){
  if(!activeState.active) return "";
  var ev=activeState.event||"A warning";
  if(activeState.unverified) return "Storm layout kept: alert updates are unavailable, so the end of the "+ev+" cannot be confirmed.";
  if(activeState.until){
    var t=typeof weatherTime==="function"?weatherTime(activeState.until,{hour:"numeric",minute:"2-digit"})+" CT":"shortly";
    return "The "+ev+" has ended. The storm layout stays until "+t+" in case it is reissued.";
  }
  return activeState.optOut?"Usual layout. A "+ev+" covers this location."
    :"Storm layout: radar and storm reports come first while a "+ev+" covers this location.";
}
function applyActiveMode(){
  var root=document.documentElement, on=activeState.active&&!activeState.optOut;
  var bar=document.getElementById("activeBar"), text=document.getElementById("activeBarText"),
      toggle=document.getElementById("activeToggle"), fold=document.getElementById("activeFold"),
      reports=document.getElementById("reportsCard");
  if(!bar) return;
  bar.hidden=!activeState.active;
  var words=activeBarText(); if(text.textContent!==words) text.textContent=words;
  toggle.textContent=on?"Show the usual layout":"Show the storm layout";
  if(reports) reports.hidden=!on;
  if(fold) fold.hidden=!on;
  var was=root.classList.contains("lsx-active");
  placeRadar(on);
  if(on===was){ syncFoldChips(); return; }
  root.classList.toggle("lsx-active",on);
  if(!on) ACTIVE_SHOW.forEach(function(k){ root.classList.remove("show-"+k); });
  if(on){
    if(typeof requestContext==="function") requestContext("reports");
    stormCamera.pending=true;
    // The map may still be loading. Re-check the layout after the wait: it can end first.
    if(typeof requestMaps==="function") requestMaps().then(function(){
      if(stormCamera.pending&&document.documentElement.classList.contains("lsx-active")) enterStormCamera();
    });
  }else{
    deferredFeeds.reports=false;   // stop polling; the footer lists it as on demand again
    if(typeof renderStormReports==="function") renderStormReports(null);
  }
  syncFoldChips();
  if(typeof rvMap!=="undefined"&&rvMap){ rvMap.invalidateSize(); setTimeout(function(){ if(rvMap) rvMap.invalidateSize(); },260); }
  if(on&&stormCamera.pending) enterStormCamera(); else if(!on) leaveStormCamera();
  // Pack now, not next frame: the context pack just reappeared and must not show a frame unpacked.
  if(!on&&typeof layoutMasonry==="function") layoutMasonry();
  else if(typeof scheduleMasonry==="function") scheduleMasonry();
  if(typeof freshnessCheck==="function") freshnessCheck();
}
/* Radar ahead of Now in the DOM, not only on screen, so reading and tab order follow the picture.
   Moving the card keeps the Leaflet instance; fullscreen is fixed-position, so wait it out. */
function placeRadar(on){
  if(typeof radarFull!=="undefined"&&radarFull) return;
  var radar=document.getElementById("radarCard"), band=radar&&radar.parentNode,
      stack=band&&band.querySelector(".now-stack");
  if(!stack) return;
  var ahead=radar.nextElementSibling===stack;
  if(ahead===on) return;
  var focused=document.activeElement, keep=focused&&radar.contains(focused);
  band.insertBefore(radar,on?stack:stack.nextSibling);
  if(keep&&document.activeElement!==focused) focused.focus({preventScroll:true});
}
function syncFoldChips(){
  var o=document.getElementById("foldOutlook");
  if(o){
    // The same freshness-aware reading the hidden cell would show, qualifier included.
    var cell=OUTLOOK_CELLS[0], r=outlookCurrent(cell), words=r?r.value+(r.state==="partial"||r.state==="unavailable"?" ("+(r.sub||"unverified").toLowerCase()+")":""):"";
    if(o.textContent!==words) o.textContent=words;
  }
  document.querySelectorAll("#activeFoldChips .fold-chip").forEach(function(b){
    var shown=document.documentElement.classList.contains("show-"+b.getAttribute("data-show"));
    b.setAttribute("aria-expanded",String(shown));
  });
}
function showFolded(key,scroll){
  var root=document.documentElement; if(!root.classList.contains("lsx-active")) return;
  root.classList.add("show-"+key);
  syncFoldChips();
  if(key==="context"&&typeof layoutMasonry==="function") layoutMasonry();
  else if(typeof scheduleMasonry==="function") scheduleMasonry();
  var target=document.getElementById(key==="forecast"?"forecastCard":key==="outlook"?"outlookCard":"contextPack");
  if(scroll&&target){
    target.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
    // Move focus with the view, so Tab continues through what was just revealed.
    var h=key==="context"?document.querySelector(".railhead"):target.querySelector("h2");
    if(h){ if(!h.hasAttribute("tabindex")) h.setAttribute("tabindex","-1"); h.focus({preventScroll:true}); }
  }
}
(function initActiveMode(){
  var toggle=document.getElementById("activeToggle");
  if(toggle) toggle.addEventListener("click",function(){
    activeState.optOut=!activeState.optOut; applyActiveMode();
    if(!activeState.optOut){ var r=document.getElementById("radarCard"); if(r) r.scrollIntoView({block:"start"}); }
  });
  document.addEventListener("radarfullscreenchange",function(){
    if(typeof radarFull!=="undefined"&&!radarFull){
      placeRadar(document.documentElement.classList.contains("lsx-active"));
      if(typeof rvMap!=="undefined"&&rvMap) setTimeout(function(){ if(rvMap) rvMap.invalidateSize(); },0);
    }
  });
  var chips=document.getElementById("activeFoldChips");
  if(chips) chips.addEventListener("click",function(e){
    var b=e.target.closest(".fold-chip"); if(b) showFolded(b.getAttribute("data-show"),true);
  });
  // A jump link into a folded section puts that section back before the browser scrolls to it.
  var nav=document.getElementById("jumpNav");
  if(nav) nav.addEventListener("click",function(e){
    var link=e.target.closest('a[href^="#"]'); if(!link) return;
    var t=document.querySelector(link.getAttribute("href")); if(!t) return;
    if(t.id==="forecastCard") showFolded("forecast",false);
    else if(t.closest("#contextPack")) showFolded("context",false);
  },true);
})();

/* ---- Calm-day radar ----
   On a phone or tablet the radar stacks under Now, so a full-size empty map pushes the forecasts
   down. It shrinks only on positive evidence that no precipitation is near, read from data the page
   already has, never from radar pixels (a dead tile layer looks exactly like a clear sky):
   - the hourly feed is verified (not partial, saved, loading, stale or unavailable);
   - every one of the next RADAR_CALM_HOURS hours is covered, with no gap, by a period whose rain
     chance is known and below RADAR_CALM_POP, and whose wording names no precipitation;
   - the alert feed is verified and nothing covers this location;
   - the storm layout is off.
   Anything missing or uncertain keeps the full-size radar. */
var RADAR_CALM_HOURS=6, RADAR_CALM_POP=20;
var RADAR_CALM_WORDS=/rain|shower|storm|thunder|drizzle|snow|flurr|sleet|freezing|ice|hail|wintry|precip/i;
function radarCalm(periods,nowMs,o){
  o=o||{};
  if(o.stormLayout) return {calm:false,reason:"storm layout"};
  if(o.hourlyState!=="ready") return {calm:false,reason:"hourly forecast not verified"};
  if(o.alertsState!=="ready") return {calm:false,reason:"alerts not verified"};
  if(o.localAlert) return {calm:false,reason:"an alert covers this location"};
  var end=nowMs+RADAR_CALM_HOURS*3600000, win=[];
  (Array.isArray(periods)?periods:[]).forEach(function(p){
    if(!p) return;
    var a=Date.parse(p.startTime), b=Date.parse(p.endTime);
    if(!isFinite(a)||!isFinite(b)||b<=a) return;
    if(b>nowMs&&a<end) win.push({a:a,b:b,p:p});
  });
  win.sort(function(x,y){return x.a-y.a;});
  if(!win.length||win[0].a>nowMs) return {calm:false,reason:"the next hours are not covered"};
  for(var i=0;i<win.length;i++){
    if(i&&win[i].a!==win[i-1].b) return {calm:false,reason:"a gap in the next hours"};
    var pop=win[i].p.probabilityOfPrecipitation, v=pop&&typeof pop==="object"?pop.value:pop;
    if(v==null||v===""||!isFinite(Number(v))) return {calm:false,reason:"an unknown rain chance"};
    if(Number(v)>=RADAR_CALM_POP) return {calm:false,reason:"a rain chance of "+Number(v)+"%"};
    if(RADAR_CALM_WORDS.test(String(win[i].p.shortForecast||""))) return {calm:false,reason:"precipitation in the wording"};
  }
  if(win[win.length-1].b<end) return {calm:false,reason:"the next hours are not covered"};
  return {calm:true,reason:"no precipitation in the next "+RADAR_CALM_HOURS+" hours"};
}
function syncRadarCalm(){
  if(typeof feedChecks==="undefined"||typeof feedState!=="function") return;
  var now=Date.now();
  var verdict=radarCalm(typeof smart!=="undefined"?smart.hourlyAll:[],now,{
    hourlyState:feedState(feedChecks.hourly,now,FEEDS.hourly.age),
    alertsState:feedState(feedChecks.alerts,now,FEEDS.alerts.age),
    localAlert:typeof callLocalAlert!=="undefined"?callLocalAlert:null,
    stormLayout:document.documentElement.classList.contains("lsx-active")
  });
  document.documentElement.classList.toggle("radar-calm",verdict.calm);
  document.documentElement.setAttribute("data-radar-calm",verdict.reason);
}


/* ---- Weather Story (NWS St. Louis graphicast XML) ----
   The office publishes its Weather Story as XML: each graphic has a start and end time, a title,
   a caption and an image. Only graphics valid now are shown, in the office's order. The image
   slots are reused, so a fixed image URL alone can be a week old; the times are the evidence.
   An entry with an unreadable time, a missing title or an image outside the office's own path is
   counted, not dropped: any of those makes the feed partial, and nothing readable is a gap. */
var WXSTORY_IMAGE=/^https:\/\/www\.weather\.gov\/images\/lsx\/wxstory\/[A-Za-z0-9_-]+\.(png|jpg|gif)$/;
function currentStories(items,nowMs){
  if(!Array.isArray(items)) return null;
  var out=[], invalid=0, nowS=nowMs/1000;
  items.forEach(function(it){
    // An empty or missing time would become Number("")=0 and pass as a real instant.
    var rawStart=String(it&&it.start!=null?it.start:"").trim(), rawEnd=String(it&&it.end!=null?it.end:"").trim();
    var start=rawStart?Number(rawStart):NaN, end=rawEnd?Number(rawEnd):NaN, title=String(it&&it.title||"").trim();
    var image=String(it&&it.image||"").trim();
    if(!isFinite(start)||!isFinite(end)||end<start||!title||!WXSTORY_IMAGE.test(image)){ invalid++; return; }
    if(start<=nowS&&nowS<end) out.push({start:start*1000,end:end*1000,order:Number(it.order)||0,title:title,
      description:String(it.description||"").trim(),image:image});
  });
  out.sort(function(a,b){return a.order-b.order;});
  out.invalid=invalid; out.total=items.length;
  return out;
}

/* ---- Observed rainfall (RFC QPE: gauge-corrected multi-sensor analysis) ----
   One identify answers the 24-hour, 3-day and 7-day windows at the point. Each window carries its
   own reference time (its end): 24 h is refreshed hourly; 3 and 7 days once a day, ending 12Z.
   A window is usable only with a finite, non-negative value and a reference time inside its age
   limit; a missing, NoData, unreadable or stale window is a gap, never 0.00". */
var RAIN_WINDOWS=[
  {key:"h24",label:"Last 24 hours",subset:"nws_precip_last24hours_conus",maxAge:4*3600000},
  {key:"d3",label:"Last 3 days",subset:"nws_precip_last3days_conus",maxAge:36*3600000},
  {key:"d7",label:"Last 7 days",subset:"nws_precip_last7days_conus",maxAge:36*3600000}
];
/* "11/15/2026 2:00:00 AM" (UTC, as the service formats footprint dates) or epoch milliseconds. */
function rfcTime(v){
  if(typeof v==="number") return isFinite(v)?v:NaN;
  var m=/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(String(v||"").trim());
  if(!m) return NaN;
  var h=Number(m[4])%12+(m[7]==="PM"?12:0);
  return Date.UTC(Number(m[3]),Number(m[1])-1,Number(m[2]),h,Number(m[5]),Number(m[6]));
}
function rainfallFromIdentify(results,nowMs){
  if(!Array.isArray(results)) return null;
  var issued={}, value={};
  results.forEach(function(r){
    var a=(r&&r.attributes)||{}, subset=String(a.idp_subset||a.name||"");
    if(a.idp_issueddate!=null&&a.idp_subset) issued[subset]=rfcTime(a.idp_issueddate);
    if(a["Service Pixel Value"]!=null&&a.name) value[String(a.name)]=a["Service Pixel Value"];
  });
  var out={windows:[],known:0};
  RAIN_WINDOWS.forEach(function(w){
    var t=issued[w.subset], raw=value[w.subset], v=(raw==null||raw===""||/nodata/i.test(String(raw)))?NaN:Number(raw);
    var ok=isFinite(v)&&v>=0&&v<100&&isFinite(t)&&t<=nowMs+10*60000&&nowMs-t<=w.maxAge;
    out.windows.push({key:w.key,label:w.label,inches:ok?v:null,through:isFinite(t)?t:null,
      reason:ok?"":(!isFinite(t)?"no reference time":nowMs-t>w.maxAge?"analysis is out of date":"no value at this point")});
    if(ok) out.known++;
  });
  return out;
}

/* ---- WPC winter guidance (probabilistic snow and ice, days 1-3) ----
   Asked for only in the cool season (November through March, Central dates) or while WSSI shows a
   winter impact for today or tomorrow. A point inside a WPC polygon takes its category. A point
   outside every polygon reads "below 10%" only when that layer's own issuance is verified current;
   a layer with nothing issued anywhere, or an old issuance, cannot certify it and stays unknown. */
var WINTER_DAYS=[
  {day:1,snow:[1,2,3],ice:4},{day:2,snow:[6,7,8],ice:9},{day:3,snow:[11,12,13],ice:14}
];
var WINTER_THRESHOLDS=[4,8,12];
function winterDemand(nowMs,wssi){
  var month=weatherParts(new Date(nowMs)).month;   // 0-11, Central
  if(month>=10||month<=2) return true;              // November through March
  return Array.isArray(wssi)&&wssi.some(function(v){return v!=null&&v>0;});
}
/* "2026-11-14 20:06:24" (UTC). */
function wpcTime(v){
  var m=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(v||"").trim());
  return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]):NaN;
}
function winterIssuanceOk(meta,nowMs){
  if(!meta) return false;
  var issued=wpcTime(meta.issue), end=wpcTime(meta.end);
  return isFinite(issued)&&isFinite(end)&&issued<=nowMs+10*60000&&nowMs-issued<=36*3600000&&end>nowMs;
}
/* Layer ids on NOAA's map services have been renumbered before (SPC uses discovery for that reason),
   and a renumbered id here would put a 12-inch polygon under a 4-inch label: a wrong answer, not a
   gap. So each id is trusted only when the service's own layer list names it as expected. Returns
   the set of verified ids. */
function winterLayerCheck(layers){
  var named={}, ok={};
  (Array.isArray(layers)?layers:[]).forEach(function(l){ if(l&&isFinite(Number(l.id))) named[Number(l.id)]=String(l.name||"").trim(); });
  WINTER_DAYS.forEach(function(d){
    d.snow.forEach(function(id,i){
      var re=new RegExp("^Day "+d.day+" probability of at least "+WINTER_THRESHOLDS[i]+" inches of snow$","i");
      if(re.test(named[id]||"")) ok[id]=true;
    });
    if(new RegExp("^Day "+d.day+" probability of icing >0\\.25 inches$","i").test(named[d.ice]||"")) ok[d.ice]=true;
  });
  return ok;
}
/* hits: identify results at the point; meta: {layerId:{issue,start,end}} for each day's 4-inch and
   ice layers (the 8- and 12-inch layers are issued with the 4-inch one). Per day, snow is one
   category per threshold (4, 8, 12 inches) and ice one category, or null when unverifiable. */
function winterGuidance(hits,meta,nowMs,verified){
  if(!Array.isArray(hits)||!meta||!verified) return null;
  var byLayer={};
  hits.forEach(function(h){
    var at=(h&&h.attributes)||{}, id=Number(h&&h.layerId);
    var dn=Number(at["Probability Code"]!=null?at["Probability Code"]:at.dn);
    if(isFinite(id)&&isFinite(dn)) byLayer[id]=Math.max(byLayer[id]||0,dn);
  });
  var known=0;
  var days=WINTER_DAYS.map(function(d){
    var snowMeta=meta[d.snow[0]], iceMeta=meta[d.ice];
    var snowOk=d.snow.every(function(id){return verified[id];})&&winterIssuanceOk(snowMeta,nowMs);
    var iceOk=!!verified[d.ice]&&winterIssuanceOk(iceMeta,nowMs);
    if(snowOk) known++; if(iceOk) known++;
    return {day:d.day,
      snow:snowOk?d.snow.map(function(id){return byLayer[id]||0;}):null,
      ice:iceOk?(byLayer[d.ice]||0):null,
      end:snowOk?wpcTime(snowMeta.end):iceOk?wpcTime(iceMeta.end):null};
  });
  return {days:days,known:known,total:WINTER_DAYS.length*2};
}
function winterCategory(dn){ return ["Below 10%","Slight (10–39%)","Moderate (40–69%)","High (70–100%)"][dn]||"Unknown"; }

/* ---- Rendering for the Weather Story, observed rainfall and winter guidance ---- */
function storyHtml(s){
  return '<figure class="story-item"><img src="'+esc(s.image)+'" alt="NWS St. Louis Weather Story: '+esc(s.title)+'" loading="lazy" decoding="async">'
    +'<figcaption><strong>'+esc(s.title)+'</strong>'+(s.description?' '+esc(s.description):'')
    +'<span class="story-valid">Valid until '+esc(weatherTime(s.end,{weekday:"short",hour:"numeric",minute:"2-digit"}))+' CT</span></figcaption></figure>';
}
/* Validity is re-checked on the freshness tick (every 30 seconds), not only when the feed reloads:
   a graphic must leave the page when its end time passes, and an upcoming one appears on time. */
function syncStoryClock(){
  if(!renderStory._items) return;
  renderStory(currentStories(renderStory._items,Date.now()));
}
function renderStory(stories){
  var el=document.getElementById("story"), link=document.getElementById("olStory");
  renderStory._current=stories&&stories.length?stories[0]:null;
  if(el){
    var html=stories==null
      ?'<p class="empty">The Weather Story could not be read. <a href="https://www.weather.gov/lsx/weatherstory" target="_blank" rel="noopener">Open it at NWS St. Louis ↗</a></p>'
      :stories.length?stories.map(storyHtml).join("")
      :'<p class="story-none">No Weather Story graphic is current right now. <a href="https://www.weather.gov/lsx/weatherstory" target="_blank" rel="noopener">NWS St. Louis ↗</a></p>';
    if(el.innerHTML!==html) el.innerHTML=html;
  }
  if(link){
    var cur=renderStory._current;
    link.hidden=!cur;
    var a=link.querySelector("a"); if(a&&cur) a.textContent=cur.title;
  }
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
function rainAmount(v){ return v==null?null:(v<0.005?"0.00":v.toFixed(2))+"″"; }
function renderRainfall(r){
  var el=document.getElementById("rain"); if(!el) return;
  var html;
  if(!r) html='<p class="empty">Observed rainfall is unavailable. <a href="https://water.noaa.gov/" target="_blank" rel="noopener">NWPS precipitation ↗</a></p>';
  else html='<div class="rain-grid">'+r.windows.map(function(w){
    return '<div class="rain-item"><div class="k">'+esc(w.label)+'</div>'
      +(w.inches!=null?'<div class="v">'+rainAmount(w.inches)+'</div><div class="s">through '+esc(weatherTime(w.through,{weekday:"short",hour:"numeric"}))+' CT</div>'
        :'<div class="v cc-gap">—</div><div class="s">'+esc(w.reason)+'</div>')+'</div>';
  }).join("")+'</div>';
  if(el.innerHTML!==html) el.innerHTML=html;
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
function renderWinter(g){
  var el=document.getElementById("winter"); if(!el) return;
  var html;
  if(!g) html='<p class="empty">WPC winter guidance is unavailable. <a href="https://www.wpc.ncep.noaa.gov/pwpf/wwd_accum_probs.php" target="_blank" rel="noopener">Open WPC ↗</a></p>';
  else html='<div class="winter-rows">'+g.days.map(function(d){
    // WPC days run 00Z-00Z, so a start reads as the previous evening in Central time; name the end.
    var when="Day "+d.day+(d.end?" · until "+weatherTime(d.end,{weekday:"short",hour:"numeric"})+" CT":"");
    var snow=d.snow?WINTER_THRESHOLDS.map(function(t,i){return d.snow[i]>0||i===0?'≥'+t+'″ '+winterCategory(d.snow[i]):'';}).filter(Boolean).join(' · '):'Unverified';
    var ice=d.ice==null?'Unverified':'≥0.25″ '+winterCategory(d.ice);
    return '<div class="winter-row"><span class="winter-day">'+esc(when)+'</span><span><b>Snow</b> '+esc(snow)+'</span><span><b>Ice</b> '+esc(ice)+'</span></div>';
  }).join("")+'</div>';
  if(el.innerHTML!==html) el.innerHTML=html;
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
/* Winter guidance is asked for only in season or with a WSSI impact; leaving both stops polling,
   hides the card and drops any response still in flight (loadWinter re-checks demand). */
function syncWinterDemand(){
  var want=winterDemand(Date.now(),typeof callRisk!=="undefined"&&callRisk?callRisk.wssi:null);
  var card=document.getElementById("winterCard");
  if(card&&card.hidden===want){ card.hidden=!want; if(typeof scheduleMasonry==="function") scheduleMasonry(); }
  if(want&&!feedRequested("winter")&&typeof requestContext==="function") requestContext("winter");
  else if(!want&&deferredFeeds.winter) deferredFeeds.winter=false;
}
/* Road conditions matter during the storm layout and under a covering winter alert. */
/* Any covering, unexpired winter-precipitation warning counts, not only the single strongest alert:
   a Flood Warning can outrank a Winter Storm Warning in callLocalAlert and still leave roads icy.
   Walks the same groups and phases bottomLineLocalAlert does. The event list is explicit because
   eventFamily()'s "winter" also holds Freeze, Frost and Wind Chill warnings, which are not road
   hazards. */
var ROAD_WINTER_EVENTS=/winter storm|blizzard|ice storm|snow squall|heavy snow|lake effect snow|freezing rain/i;
function winterWarningCovers(groups,nowMs){
  return (groups||[]).some(function(g){
    if(!g||g.scope==="away") return false;
    var phases=g.phases&&g.phases.length?g.phases:[g];
    return phases.some(function(p){
      if(!p||p.latest>0&&p.latest<=nowMs) return false;
      var level=p.lv&&p.lv.k;
      return ROAD_WINTER_EVENTS.test(String(p.ev||""))&&(level==="warning"||level==="emergency");
    });
  });
}
function syncRoadLinks(){
  var el=document.getElementById("roadLinks"); if(!el) return;
  var groups=typeof callAlertGroups!=="undefined"?callAlertGroups:[];
  var show=document.documentElement.classList.contains("lsx-active")||winterWarningCovers(groups,Date.now());
  if(el.hidden===show) el.hidden=!show;
}
