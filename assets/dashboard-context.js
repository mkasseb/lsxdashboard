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
  // The desktop band owns its lower cards too, so no shared grid row can hold them back.
  [document.querySelector('.railhead'),document.querySelector('.masonry')].forEach(function(element){
    var slot=document.createComment(element.className+' mobile position');
    element.parentNode.insertBefore(slot,element);homes.push({card:element,slot:slot,column:planning});
  });
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
  // A forecast/detail/feed can change the occupied space above the lower cards.
  if(window.ResizeObserver){var sizes=new ResizeObserver(scheduleMasonry);sizes.observe(main);sizes.observe(support);}
  if(window.MutationObserver){
    var changes=new MutationObserver(function(records){
      // Forecast rows expand through a class. Ignore map/date-fit class churn.
      if(records.some(function(r){return r.type!=='attributes'||r.attributeName!=='class'||r.target.classList.contains('day-item');}))layoutMasonry();
    });
    [main,support].forEach(function(column){changes.observe(column,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['open','hidden','class']});});
  }
  sync();
}

/* Fill the space below each planning column without covering its remaining cards.
   Keep the existing mobile packer, card nodes, priority tiers and visual DOM order. */
function layoutPlanningContext(m,rank){
  var planning=document.querySelector('.planning-grid'),heading=document.querySelector('.railhead');
  if(!planning||!heading)return false;
  if(!planning.classList.contains('desktop-planning')||!window.matchMedia('(min-width:1001px)').matches){
    planning.style.removeProperty('height');
    [heading,m].forEach(function(element){['top','left','width'].forEach(function(prop){element.style.removeProperty(prop);});});
    return false;
  }
  if(radarFull)return true; // Background geometry stays fixed until the modal closes.
  fitDayDates();
  var primary=planning.querySelector('.planning-primary').getBoundingClientRect();
  var support=planning.querySelector('.planning-support').getBoundingClientRect();
  var short=primary.bottom<=support.bottom?primary:support,origin=planning.getBoundingClientRect();
  heading.style.top=(short.bottom-origin.top+24)+'px';
  heading.style.width=short.width+'px';heading.style.left=(short.left-origin.left)+'px';
  var masonryTop=heading.getBoundingClientRect().bottom-origin.top+16;
  m.style.top=masonryTop+'px';
  // Wide screens retain three context lanes; narrower desktops use two readable lanes.
  var lanes=window.matchMedia('(min-width:1241px)').matches?
    [{left:0,width:(primary.width-16)/2,bottom:primary.bottom},{left:(primary.width+16)/2,width:(primary.width-16)/2,bottom:primary.bottom},{left:support.left-origin.left,width:support.width,bottom:support.bottom}]:
    [{left:0,width:primary.width,bottom:primary.bottom},{left:support.left-origin.left,width:support.width,bottom:support.bottom}];
  var top=m.getBoundingClientRect().top;
  var occupied=lanes.map(function(lane){return Math.max(0,lane.bottom+16-top);});
  var cards=[].slice.call(m.children).filter(function(card){return card.classList.contains('card');});
  if(_mObs)_mObs.disconnect();
  m.classList.add('mready');
  var data=cards.map(function(card,index){
    var span=card.classList.contains('wide')?Math.min(2,lanes.length):1;
    var widths=[],heights=[];
    // Heights depend on the actual lane width, including wrapped prose/disclosures.
    for(var start=0;start+span<=lanes.length;start++){
      var end=lanes[start+span-1],width=end.left+end.width-lanes[start].left;
      widths.push(width);card.style.width=width+'px';heights.push(card.offsetHeight);
    }
    return {c:card,span:span,widths:widths,heights:heights,h:Math.max.apply(null,heights),index:index};
  });
  data.sort(function(a,b){return rank(a.c.id)-rank(b.c.id)||b.h-a.h||a.index-b.index;});
  data.forEach(function(d){
    var best=0,bestTop=Infinity;
    for(var start=0;start+d.span<=lanes.length;start++){
      var candidate=Math.max.apply(null,occupied.slice(start,start+d.span));
      if(candidate<bestTop-.5){best=start;bestTop=candidate;}
    }
    d.left=lanes[best].left;d.top=bestTop;
    d.c.style.width=d.widths[best]+'px';d.c.style.left=d.left+'px';d.c.style.top=d.top+'px';
    if(d.heights[best])for(var col=best;col<best+d.span;col++)occupied[col]=bestTop+d.heights[best]+16;
  });
  var station=document.getElementById('stnmap');
  if(stnMap&&station.clientWidth&&station.clientHeight){var size=stnMap.getSize();if(size.x!==station.clientWidth||size.y!==station.clientHeight)stnMap.invalidateSize({animate:false});}
  m.style.height=Math.max.apply(null,occupied)+'px';
  planning.style.height=(masonryTop+Math.max.apply(null,occupied))+'px';
  reorderMasonryDOM(m,data);if(_mObs)_mObs.observe(m,_mObsOpts);
  document.dispatchEvent(new Event('lsxlayout'));
  return true;
}
