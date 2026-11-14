/* Optional context presentation and demand state, independent of weather decisions. */
var deferredFeeds={stations:false,context:false};
function feedRequested(key){ return !Object.prototype.hasOwnProperty.call(deferredFeeds,key)||deferredFeeds[key]; }
function requestContext(key){
  if(feedRequested(key)) return Promise.resolve();
  deferredFeeds[key]=true;
  stampSched([key]);
  var job=runFeed(key);
  if(key==="stations") job=Promise.all([job,requestMaps()]);
  return job;
}
function initContextView(){
  var ids=["afdCard","obsCard","climateCard","droughtCard","cpcCard"];
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
  });
  document.getElementById('jumpNav').addEventListener('click',function(e){
    var link=e.target.closest('a');if(!link)return;
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
  return {state:"partial",value:"No drought now",sub:"Some outlooks missing",verified:false};
}

renderOutlook();   // scripts load at the end of <body>, so the row exists; cells read "Checking…"
