/* ============ INSTANT PAINT (snapshot → localStorage → restore before any fetch) ============
   Return visits paint in one synchronous step, before a single network request. Cards are stored
   as already-rendered HTML, so there's no re-render cost either.
   Honesty rules, since this is weather data:
     · every fragment carries a TTL measured from its last successful weather check, not the save;
     · alerts, short-fused discussions and current observations are NEVER restored, so they only
       ever comes from a live fetch;
     · a snapshot is only reused for the same location it was taken at;
     · saved fragments and their cards stay labeled until that specific feed is verified or cleared. */
/* The key carries a version because a snapshot is RESTORED MARKUP, not data: it is painted under
   whatever stylesheet ships today. When the hero's footer became a tile pair, a v1 snapshot's old
   rows picked up the new tile chrome without their grid parent and the old context line — now a
   flex row — spread its words across the card. Reshape the markup, bump the key. One cold paint
   for a returning visitor beats a deployment's worth of visibly wrong first paints. */
// v3: emoji became <svg class="ic"> and the alert card's severity classes became one lv-* ramp.
// A v2 snapshot is markup that today's stylesheet has no rules for, so it must not be restored.
// v4: The Pulse moved above the hero band and gained its clamp, so #afd's markup carried an
// expander button. v5: the clamp came back out (measurement said it was guarding nothing — see
// the note in the CSS), so #afd is plain body-and-credit again. A v4 snapshot still holds that
// button, and nothing styles it any more: it would restore wearing the default 44px button skin
// with BOTH of its labels showing, reading "Read the full discussionShow less". Exactly the class
// of visibly-wrong first paint this version gate exists for, and it only reached real devices
// because the preview deploys were opened on one.
// v6: the "N alerts elsewhere" fold became an always-visible compact list, so #alerts no longer
// holds that <button> and #alertsElse is no longer display:none. A v5 snapshot restores both — a
// dashed toggle wearing the default button skin, above a block of cards nothing collapses, sitting
// where the local alerts belong. Same class of wrong first paint as v4's orphaned expander.
// v7: coverage alone decides which section a card sits in now, so a v6 snapshot of #alerts restores
// the OLD split — a distant tornado warning back in the local list, above the "elsewhere" heading,
// wearing an "Elsewhere in LSX" badge whose class no longer has a single rule behind it (measured:
// zero matching selectors, so it paints as bare inline text in the banner's flex row). Both halves
// of the contradiction this version was cut to remove, restored together. #alerts is the
// safety-critical part on the shortest leash, which makes it the worst one to be wrong on first
// paint — a reader who opens the page to check on a warning is the reader who gets the stale answer.
// v8: #daily gained the week summary/scale and its rows changed shape: compact condition text,
// visible H/L labels in high-first order, and rounded precipitation in the collapsed scan. A v7
// snapshot restores the old six-column row under the new fixed-width grid and silently loses the
// new answer-first context, so it needs one cold paint rather than a malformed first impression.
// v9: the fixed list of peak/rain/coolest facts became a headline plus supporting insights, and
// the weekly range endpoints gained their day labels. A v8 snapshot restores the old summary DOM
// under the new hierarchy and leaves the endpoint grid without its .fc-end wrappers.
// v10: the shared temperature bar gained a visible "7-day temperature scale · low → high"
// label. A v9 snapshot would restore the exact unlabeled bar this release is meant to clarify.
// v11: the shared weekly temperature bar was removed. A v10 snapshot would restore the rejected
// element even though today's renderer no longer creates it.
// v12: the loose summary sentences became a tone icon, labeled fact grid and separated source
// footer. A v11 snapshot would restore the old floating text under the new summary styles.
// v13: #callRow changed from an equal-weight pill cloud to a lead briefing plus semantic support
// list. A v12 snapshot would restore the old pills under rules that deliberately no longer exist.
// v14: outage-aware risk, rain and current-observation markup must replace old reassuring cards.
// Current readings, risk outlooks and the Bottom Line are fetched fresh on every open: their
// rendered timestamps and conclusions cannot be revalidated from a saved HTML snapshot.
// v15: #daily no longer includes the forecast overview. A v14 snapshot would restore that
// duplicate summary without its removed styles before the fresh forecast arrives.
// v16: the hourly chart has duration controls, day boundaries and an accessible detail slider.
// v17: saved fragments carry their original validated check times and Central Time labels.
// v18: the feed registry owns cached fragments; river rows include persistent pin controls.
// v19: time-scaled hourly gaps, dated climate comparisons and verified gauge timestamps.
// v21: CPC tiles and hazards periods now contain official source anchors.
// v22: native P25/P50/P75 labels and removal of tail-based threshold commentary.
// v23: airport record rows are revalidated independently of saved NWS markup.
var SNAP_KEY="lsxSnap_v23", snapRestored=false;
try{ ["lsxSnap_v1","lsxSnap_v3","lsxSnap_v4","lsxSnap_v5","lsxSnap_v6","lsxSnap_v7","lsxSnap_v8","lsxSnap_v9","lsxSnap_v10","lsxSnap_v11","lsxSnap_v12","lsxSnap_v13","lsxSnap_v14","lsxSnap_v15","lsxSnap_v16","lsxSnap_v17","lsxSnap_v18","lsxSnap_v19","lsxSnap_v20","lsxSnap_v21","lsxSnap_v22"].forEach(function(k){ localStorage.removeItem(k); }); }catch(e){}   // don't let dead snapshots crowd the live one
var SNAP_PARTS=Object.keys(FEEDS).reduce(function(parts,k){return parts.concat((FEEDS[k].snapshot||[]).map(function(p){return Object.assign({feed:k},p);}));},[]);
function saveSnapshot(){
  // Mid-transition the DOM still shows the OLD place while `current` is already the new one --
  // saving then would file the old cards under the new name. setLocation marks the generation
  // safe only once its loaders settle.
  if(locSeq!==snapSafeSeq) return;
  // Snapshots are keyed by COORDINATES, not the display name: geolocation always calls itself
  // "My Location", so a name-only match served the previous city's cards after you moved.
  var snap={t:Date.now(), loc:(current&&current.name)||"",
            lat:(current&&current.lat!=null)?+current.lat.toFixed(3):null,
            lon:(current&&current.lon!=null)?+current.lon.toFixed(3):null,
            wx:document.body.getAttribute("data-wx")||"", parts:{},feeds:{}};
  SNAP_PARTS.forEach(function(p){
    var c=feedChecks[p.feed];
    if(!c||!c.successAt||(!c.saved&&c.status!=="ready"&&c.status!=="partial")||Date.now()-c.successAt>p.ttl) return;
    var el=document.getElementById(p.id);
    if(!el) return;
    // NBM is revalidated from its own source; never persist it inside the NWS HTML snapshot.
    if(p.id==="hourly24"&&el.querySelector(".nbm-hourly-band,.nbm-hourly-detail"))return;
    var snapshotEl=el;
    if(p.id==="daily"){
      // A newer checked NWS package is waiting for a native activation to finish.
      // Do not renew the still-visible older rows with its new check timestamp.
      if(typeof NbmRange!=="undefined"&&NbmRange.forecastPending())return;
      snapshotEl=el.cloneNode(true);
      removeLegacyNormalComparisons(snapshotEl);
      removeForecastUv(snapshotEl); // UV has its own feed/check time; a saved NWS row cannot verify it.
      snapshotEl.querySelectorAll(".nbm-inline,.nbm-unavailable,.nbm-period-detail,.record-inline,.record-detail,.normal-inline,.normal-detail,.normal-comparison").forEach(function(node){node.remove();});
    }
    var h=snapshotEl.innerHTML;
    if(!h||/class="loading"/.test(h)) return;   // never cache a spinner
    snap.parts[p.id]=h;
    snap.feeds[p.feed]={status:c.status,successAt:c.successAt,issuedAt:c.issuedAt};
  });
  if(!Object.keys(snap.parts).length) return;
  function put(){ localStorage.setItem(SNAP_KEY,JSON.stringify(snap)); }
  try{ put(); }
  catch(e){
    try{ delete snap.parts.hourly24; put(); }              // the SVG chart is far the biggest part
    catch(e2){ try{ localStorage.removeItem(SNAP_KEY); }catch(e3){} }
  }
}
/* Serialising ~22 cards of rendered HTML is real main-thread work. Two callers, two urgencies:
   the periodic save and the post-refresh save can wait for an idle moment, but the
   visibilitychange save CANNOT — the page may be frozen or discarded the instant after, so that
   one stays synchronous and accepts the hitch. */
function saveSnapshotIdle(){
  if(window.requestIdleCallback) requestIdleCallback(function(){ saveSnapshot(); },{timeout:2000});
  else setTimeout(saveSnapshot,0);
}
function showSnapBar(t){
  var bar=document.getElementById("snapBar"), txt=document.getElementById("snapBarText");
  if(!bar||!txt) return;
  txt.textContent="Saved view from "+new Date(t).toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric",minute:"2-digit"})+" · fetching live data…";
  bar.classList.add("show");
}
function resolveSnapBar(){
  var bar=document.getElementById("snapBar"), txt=document.getElementById("snapBarText");
  if(!bar||!bar.classList.contains("show")) return;
  if(!Object.keys(savedParts).length){ bar.classList.remove("show","offline"); return; }
  var failed=Object.keys(feedChecks).some(function(k){return feedChecks[k].status==="unavailable";});
  if(failed&&txt){
    bar.classList.add("offline");
    txt.textContent="Some saved data remain unverified. Check each card's timestamp; current weather services are partly unavailable.";
  }
}
function restoreSnapshot(){
  var snap=null;
  try{ var s=localStorage.getItem(SNAP_KEY); snap=s?JSON.parse(s):null; }catch(e){ return false; }
  if(!snap||!snap.t||!snap.parts||!snap.feeds) return false;
  var age=Date.now()-snap.t;
  if(age<0||age>48*3600000) return false;                       // clock moved or far too old
  if(snap.loc&&current&&snap.loc!==current.name) return false;  // numbers would describe another place
  if(current&&snap.lat!=null&&snap.lon!=null){                 // and same name != same place
    if(Math.abs(snap.lat-current.lat)>0.02||Math.abs(snap.lon-current.lon)>0.02) return false;
  }
  var n=0;
  SNAP_PARTS.forEach(function(p){
    var h=snap.parts[p.id];
    var c=snap.feeds[p.feed], checkedAge=c?Date.now()-c.successAt:Infinity;
    if(!h||!c||!c.successAt||checkedAge<0||checkedAge>p.ttl||(c.status!=="ready"&&c.status!=="partial")) return;
    var el=document.getElementById(p.id);
    if(!el) return;
    el.innerHTML=h;
    if(p.id==="daily") removeForecastUv(el); // Retire untagged UV cells from older v23 snapshots too.
    n++; savedParts[p.id]=p.feed;
    feedChecks[p.feed]={status:c.status,successAt:c.successAt,issuedAt:c.issuedAt||0,saved:true};
  });
  if(!n) return false;
  var riverEl=document.getElementById("rivers");
  if(riverEl){RIVERS.forEach(function(r){var a=riverEl.querySelector('[data-gauge="'+r.id+'"] a');if(a) riverRows[r.id]=a.outerHTML;});if(Object.keys(riverRows).length) renderRiverRows();}
  if(snap.wx) document.body.setAttribute("data-wx",snap.wx);
  var hourlyWrap=document.querySelector("#hourly24 .h24-wrap"), restoredHours=hourlyWrap?Number(hourlyWrap.getAttribute("data-hours")):24;
  if([24,48,72].indexOf(restoredHours)>=0) hourlyHours=restoredHours;
  var restoredCursor=document.getElementById("hourlyCursor"); if(restoredCursor) restoredCursor.disabled=true;
  syncHourlyControls();
  snapRestored=true;
  showSnapBar(snap.t); freshnessCheck();
  if(typeof scheduleMasonry==="function") scheduleMasonry();
  return true;
}
