/* Optional context presentation and demand state, independent of weather decisions. */
var deferredFeeds={stations:false,context:false};
function feedRequested(key){ return !Object.prototype.hasOwnProperty.call(deferredFeeds,key)||deferredFeeds[key]; }
function requestContext(key){
  if(feedRequested(key)) return Promise.resolve();
  deferredFeeds[key]=true;
  stampSched([key]);
  var job=runFeed(key);
  if(key==="stations") job=Promise.all([job,ensureMaps()]);
  return job;
}
function initContextView(){
  initPlanningLayout();
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

/* Reuse the same cards in independent desktop columns; keep the original mobile DOM homes.
   Reparenting retains disclosures, map instances, source state and event handlers. */
function initPlanningLayout(){
  var planning=document.querySelector('.planning-grid');
  if(!planning||planning.querySelector('.planning-column')||!window.matchMedia)return;
  var main=document.createElement('div'),support=document.createElement('div');
  main.className='planning-column planning-primary';
  support.className='planning-column planning-support';
  var groups=[{column:main,ids:['h24Card','forecastCard']},{column:support,ids:['radarCard','riskCard','riversCard']}];
  var homes=[];
  groups.forEach(function(group){group.ids.forEach(function(id){
    var card=document.getElementById(id),slot=document.createComment(id+' mobile position');
    card.parentNode.insertBefore(slot,card);homes.push({card:card,slot:slot,column:group.column});
  });});
  planning.appendChild(main);planning.appendChild(support);
  var query=window.matchMedia('(min-width:1001px)'),wide=null,pressed=false;
  function sync(){
    // Keep a fullscreen dialog's inert ancestry until Close/Escape has restored it.
    // A native click also finishes before a breakpoint move can detach its pressed target.
    if(pressed||masonryPointerActive||(typeof radarFull!=='undefined'&&radarFull)||wide===query.matches)return;
    wide=query.matches;
    var focused=document.activeElement;
    if(_mObs)_mObs.disconnect();
    homes.forEach(function(home){
      if(wide)home.column.appendChild(home.card);
      else home.slot.parentNode.insertBefore(home.card,home.slot.nextSibling);
      ['left','top','width'].forEach(function(prop){home.card.style.removeProperty(prop);});
    });
    planning.classList.toggle('desktop-planning',wide);
    if(focused&&focused.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
    layoutMasonry();renderHourly24();
    // A pack can leave DOM order unchanged and return without restoring this observer.
    if(_mObs){var masonry=document.querySelector('.masonry');if(masonry)_mObs.observe(masonry,_mObsOpts);}
  }
  if(query.addEventListener)query.addEventListener('change',sync);
  else if(query.addListener)query.addListener(sync);
  document.addEventListener('radarfullscreenchange',sync);
  document.addEventListener('pointerdown',function(e){
    pressed=homes.some(function(home){return home.card.contains(e.target);});
  },true);
  function release(){requestAnimationFrame(function(){pressed=false;sync();});}
  document.addEventListener('pointerup',release,true);
  document.addEventListener('pointercancel',release,true);
  window.addEventListener('blur',release);
  sync();
}
