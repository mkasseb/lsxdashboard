/* Supplemental regional guidance. No values enter NWS forecasts, headlines or risk decisions. */
var NbmRange=(function(){
  'use strict';
  var H=3600000, MAX_AGE=24*H;
  function finite(v){return typeof v==='number'&&Number.isFinite(v);}
  function time(s){return typeof s==='string'?Date.parse(s):NaN;}
  function same(a,b){return a&&b&&['index','lat','lon','gridHash'].every(function(k){return a[k]===b[k];});}
  function distance(a,b){
    var r=Math.PI/180,x=(b.lat-a.lat)*r,y=(b.lon-a.lon)*r;
    var h=Math.sin(x/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(y/2)**2;
    return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
  }
  function regionalPoint(d,point){
    var c=d.coverage;
    if(d.units!=='K'||!c||c.south!==38.2||c.north!==39.2||c.west!==-91.1||c.east!==-89.5||c.maxDistanceKm!==3||
       !Array.isArray(d.cells)||d.cells.length<100||d.cells.length>5000||!Array.isArray(d.periods)||![6,18].includes(d.periods.length)||
       typeof d.gridHash!=='string'||!/^[a-f0-9]{32}$/.test(d.gridHash)||!finite(point.lat)||!finite(point.lon))throw new Error('Invalid regional coverage');
    if(point.lat<c.south||point.lat>c.north||point.lon<c.west||point.lon>c.east)return null;
    var chosen=-1,km=Infinity,seen={};
    d.cells.forEach(function(cell,i){
      if(!Array.isArray(cell)||cell.length!==3||!Number.isInteger(cell[0])||cell[0]<0||seen[cell[0]]||
         !finite(cell[1])||!finite(cell[2])||cell[1]<c.south-.05||cell[1]>c.north+.05||cell[2]<c.west-.05||cell[2]>c.east+.05)throw new Error('Invalid grid cell');
      seen[cell[0]]=true;
      var k=distance(point,{lat:cell[1],lon:cell[2]});if(k<km){km=k;chosen=i;}
    });
    if(km>c.maxDistanceKm)return null;
    var cell={index:d.cells[chosen][0],lat:d.cells[chosen][1],lon:d.cells[chosen][2],distance:km,gridHash:d.gridHash};
    var firstEnd=Math.ceil((time(d.run)+12*H)/(12*H))*12*H+6*H;
    var periods=d.periods.map(function(p,i){
      if(time(p.end)!==firstEnd+i*12*H||p.kind!==(new Date(time(p.end)).getUTCHours()===6?'TMAX':'TMIN'))throw new Error('Incomplete native horizon');
      if(!Array.isArray(p.kelvin)||p.kelvin.length!==d.cells.length||
         !Array.isArray(p.members)||p.members.length!==3)throw new Error('Missing native interval values');
      p.kelvin.forEach(function(k){if(!Array.isArray(k)||k.length!==3||!k.every(function(v){return finite(v)&&v>=180&&v<=340;})||k[0]>k[1]||k[1]>k[2])throw new Error('Invalid quartile row');});
      var values=p.kelvin[chosen],f=values.map(function(k){if(!finite(k))throw new Error('Invalid Kelvin');return (k-273.15)*9/5+32;});
      var members=p.members.map(function(m,i){
        if(m.gridHash!==d.gridHash||m.units!=='K')throw new Error('Mixed regional grid or units');
        return Object.assign({},m,{cell:cell,kelvin:values[i],fahrenheit:f[i]});
      });
      return Object.assign({},p,{p25:f[0],p50:f[1],p75:f[2],members:members});
    });
    return Object.assign({},d,{schema:4,units:'degF',requestedPoint:point,cell:cell,periods:periods});
  }
  function validate(d,point,now){
    function bad(){return {status:'unavailable',reason:'Range data failed validation.'};}
    try{
    if(!d||JSON.stringify(d.percentiles)!=='[25,50,75]')return bad();
    if(d.schema===3){
      try{d=regionalPoint(d,point);}catch(e){return bad();}
      if(!d)return {status:'missing',reason:'Outside the supported St. Louis metro range coverage (38.2–39.2°N, 91.1–89.5°W), or no grid cell within 3 km.'};
    }
    if(!d||d.schema!==4||d.source!=='NOAA NBM QMD GRIB2'||d.units!=='degF'||d.timezone!=='America/Chicago'||
       !d.requestedPoint||!finite(d.requestedPoint.lat)||!finite(d.requestedPoint.lon))return bad();
    if(Math.abs(d.requestedPoint.lat-point.lat)>0.000001||Math.abs(d.requestedPoint.lon-point.lon)>0.000001)
      return {status:'missing',reason:'No extracted NBM range for this selected point.'};
    var run=time(d.run),retrieved=time(d.retrievedAt);
    if(!finite(run)||!finite(retrieved)||run>now||retrieved>now+5*60000||retrieved<run||!d.cell||
       !Number.isInteger(d.cell.index)||!finite(d.cell.lat)||!finite(d.cell.lon)||
       !finite(d.cell.distance)||d.cell.distance<0||d.cell.distance>5||typeof d.cell.gridHash!=='string'||
       !Array.isArray(d.periods)||!d.periods.length||!Array.isArray(d.missingHours))return bad();
    if(now-run>=MAX_AGE)return {status:'stale',reason:'NBM source cycle is 24 hours old or older; values withheld.',run:run};
    var seen={},periods=[];
    for(var p of d.periods){
      var start=time(p.start),end=time(p.end),kind=p.kind,key=kind+':'+p.start+':'+p.end;
      if(!['TMAX','TMIN'].includes(kind)||!finite(start)||!finite(end)||end-start!==18*H||start<run||seen[key]||
         'p10' in p||'p90' in p||![p.p25,p.p50,p.p75].every(finite)||p.p25>p.p50||p.p50>p.p75||!Array.isArray(p.members)||p.members.length!==3)return bad();
      seen[key]=true;
      for(var i=0;i<3;i++){
        var m=p.members[i],v=[p.p25,p.p50,p.p75][i],published=time(m.publishedAt);
        if(m.percentile!==[25,50,75][i]||m.template!==10||m.statistic!==(kind==='TMAX'?2:3)||
           m.run!==d.run||m.kind!==kind||m.start!==p.start||m.end!==p.end||!same(m.cell,d.cell)||!finite(m.kelvin)||
           m.kelvin<180||m.kelvin>340||!finite(m.fahrenheit)||Math.abs(m.fahrenheit-v)>1e-7||
           Math.abs((m.kelvin-273.15)*9/5+32-v)>1e-7||!finite(published)||published<run||published>retrieved+60000||
           !m.etag||m.etag!==p.members[0].etag||m.publishedAt!==p.members[0].publishedAt)return bad();
      }
      if(end>now)periods.push(p);
    }
    if(!periods.length)return {status:'missing',reason:'No unexpired native temperature intervals.',run:run};
    periods.sort(function(a,b){return time(a.end)-time(b.end);});
    return {status:d.missingHours.length?'partial':'ready',run:run,periods:periods,cell:d.cell};
    }catch(e){return bad();}
  }
  function local(s){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(s));}
  function age(run,now){return ((now-run)/H).toFixed(1)+' hours';}
  // Pair only a unique same-kind overlap covering >=75% of a valid NWS period.
  // It is a placement rule, never a claim that the two extrema windows are equivalent.
  function align(days,periods,now){
    var entries=[];
    (days||[]).forEach(function(d,row){['day','night'].forEach(function(part){
      var n=d[part],a=n&&time(n.startTime),b=n&&time(n.endTime);
      if(!n||!finite(n.temperature)||n.temperatureUnit!=='F'||!finite(a)||!finite(b)||b<=now||b<=a||b-a>18*H||n.isDaytime!==(part==='day'))return;
      entries.push({row:row,part:part,nws:n,choices:[]});
    });});
    var uses=periods.map(function(){return 0;});
    entries.forEach(function(e){periods.forEach(function(p,i){
      var a=time(e.nws.startTime),b=time(e.nws.endTime),s=time(p.start),t=time(p.end);
      if(p.kind!==(e.part==='day'?'TMAX':'TMIN')||t<=now)return;
      if(Math.max(0,Math.min(b,t)-Math.max(a,s))/(b-a)>=.75){e.choices.push(i);uses[i]++;}
    });});
    var matches=[],used={};
    entries.forEach(function(e){
      if(e.choices.length!==1||uses[e.choices[0]]!==1)return;
      var i=e.choices[0],p=periods[i];used[i]=true;
      matches.push({row:e.row,part:e.part,nws:e.nws,nbm:p,exact:time(e.nws.startTime)===time(p.start)&&time(e.nws.endTime)===time(p.end)});
    });
    return {matches:matches,unmatched:periods.filter(function(p,i){return !used[i];})};
  }
  var raw=null,storedPoint=null,storedSeq=-1,days=[],forecastPoint=null,forecastSeq=-1,requestSeq=0;
  var viewScope='',openViews={};
  var failure='Checking NBM model guidance…';
  function enabled(){return typeof FEEDS!=='undefined'&&!!FEEDS.nbmRange;}
  function add(tag,text,parent,cls){var el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;parent.appendChild(el);return el;}
  function bounds(p){return Math.round(p.p25)+'–'+Math.round(p.p75)+'°F';}
  function windowText(a,b){return local(a)+' – '+local(b);}
  function scope(){return locSeq+'|'+current.lat+','+current.lon;}
  function rowKey(day){return JSON.stringify([forecastCalendarKey(day.day||day.night),
    day.day&&[day.day.startTime,day.day.endTime],day.night&&[day.night.startTime,day.night.endTime]]);}
  var activation=null,pendingPaint=null,pendingRender=false,activationTimer=null,visible={};
  function canDefer(nextDays){
    if(!activation||activation.scope!==scope()||!activation.node.isConnected||!raw||storedSeq!==locSeq||
       !storedPoint||storedPoint.lat!==current.lat||storedPoint.lon!==current.lon||forecastSeq!==locSeq||
       !forecastPoint||forecastPoint.lat!==current.lat||forecastPoint.lon!==current.lon)return false;
    var now=Date.now(),ends=visible.windows&&visible.windows[activation.row];
    if(visible.scope!==scope()||!finite(visible.run)||now-visible.run>=MAX_AGE||!ends||!ends.every(function(end){return end>now;}))return false;
    var result=validate(raw,storedPoint,now),candidates=nextDays||days;
    if(JSON.stringify(candidates.map(rowKey))!==JSON.stringify(visible.keys))return false;
    return !!result.periods&&align(candidates,result.periods,now).matches.some(function(m){return rowKey(candidates[m.row])===activation.row;});
  }
  // Keep a pressed native summary connected until its click default action completes.
  // Only unchanged, currently usable intervals may wait; invalid/date/location changes
  // bypass the hold. Coalesce refreshes and repaint from their latest source inputs.
  function finishActivation(){
    var held=activation;if(!held||held.finishing)return;held.finishing=true;
    clearTimeout(activationTimer);
    setTimeout(function(){
      if(activation!==held)return;
      activation=null;
      var paint=pendingPaint,again=pendingRender;pendingPaint=null;pendingRender=false;
      if(paint&&paint.scope===scope())paint.callback();else if(again)render();
    },0);
  }
  function recoverActivation(held){
    if(activation!==held)return;
    if(!held.node.isConnected||!held.node.matches(':active'))finishActivation();
    else activationTimer=setTimeout(function(){recoverActivation(held);},5000);
  }
  function deferPaint(callback,nextDays,forecastUpdate){
    if(canDefer(nextDays)){
      if(forecastUpdate||!pendingPaint||!pendingPaint.forecastUpdate)pendingPaint={scope:scope(),callback:callback,forecastUpdate:forecastUpdate};
      return true;
    }
    pendingPaint=null;return false;
  }
  function forecastPending(){return !!pendingPaint&&pendingPaint.forecastUpdate&&pendingPaint.scope===scope();}
  function beginActivation(event){
    var summary=event.target.closest&&event.target.closest('.nbm-timing > summary');
    if(!summary||activation||event.type==='pointerdown'&&(event.button!==0||event.isPrimary===false)||
       event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
    activation={node:summary,scope:scope(),row:summary.parentElement.dataset.nbmKey,type:event.type,
      pointer:event.pointerId,key:event.key};
    var held=activation;activationTimer=setTimeout(function(){recoverActivation(held);},5000);
  }
  // Disclosure state belongs to this location and the actual NWS periods, not a row
  // index, weekday label or model cycle. A new model run may update the same open view.
  function captureView(){
    var currentScope=scope(),focus=null;
    if(viewScope!==currentScope){viewScope=currentScope;openViews={};}
    document.querySelectorAll('#daily .nbm-timing').forEach(function(timing){
      if(timing.dataset.nbmScope!==currentScope)return;
      openViews[timing.dataset.nbmKey]=timing.open;
      if(timing.contains(document.activeElement))focus={scope:currentScope,key:timing.dataset.nbmKey,date:timing.dataset.nbmDate};
    });
    return focus;
  }
  function restoreViewFocus(view){
    if(!view||view.scope!==scope())return false;
    var timing=[].slice.call(document.querySelectorAll('#daily .nbm-timing')).find(function(t){return t.dataset.nbmScope===view.scope&&t.dataset.nbmKey===view.key;});
    var item=timing?timing.closest('.day-item'):[].slice.call(document.querySelectorAll('#daily .day-item')).find(function(row){return row.dataset.forecastDate===view.date;});
    if(!item)return false;
    var day=item.querySelector('.day'),target=timing?timing.querySelector('summary'):day;
    if(!target)return false;
    setOpen(item,day,true);target.focus({preventScroll:true});return true;
  }
  function render(){
    if(!enabled())return;
    var status=document.getElementById('nbmStatus'),body=document.getElementById('nbmInfoBody'),daily=document.getElementById('daily');
    if(!status||!body||!daily)return;
    var currentData=raw&&storedSeq===locSeq&&storedPoint.lat===current.lat&&storedPoint.lon===current.lon;
    var result=currentData?validate(raw,storedPoint,Date.now()):{status:'unavailable',reason:failure};
    if(canDefer(days)){pendingRender=true;return;}
    pendingRender=false;if(activation)finishActivation();
    var focus=captureView();
    daily.querySelectorAll('.nbm-inline,.nbm-unavailable,.nbm-period-detail').forEach(function(el){el.remove();});
    body.replaceChildren();
    status.textContent=result.periods?'NBM model guidance · QMD cycle '+new Date(result.run).toISOString().slice(0,16).replace('T',' ')+' UTC · '+age(result.run,Date.now())+' old':result.reason;
    add('p','NWS temperatures are the official forecast. The NBM model range spans native NOAA NBM P25 to P75, the middle 50% of modeled outcomes. Roughly 25% of modeled outcomes lie below it and 25% above it; outcomes outside remain possible. This applies to each native temperature interval, not to the whole forecast staying inside. The bounds are P25 and P75; P50 is the median (middle estimate). Model values never replace the NWS forecast.',body);
    add('p','NBM maximum/minimum temperatures cover native 18-hour windows, not calendar-day highs/lows. A range appears alongside a day or night only when there is one unambiguous overlapping window. Expand the NWS row to compare both intervals. Rows without a range have no unique, currently usable NBM window. All times are Central, with daylight-saving offsets at each endpoint.',body);
    var currentForecast=forecastSeq===locSeq&&forecastPoint&&forecastPoint.lat===current.lat&&forecastPoint.lon===current.lon;
    var shownDays=currentForecast?days:[],pairing=align(shownDays,result.periods||[],Date.now()),items=daily.querySelectorAll('.day-item'),validKeys={};
    shownDays.forEach(function(day){validKeys[rowKey(day)]=true;});
    Object.keys(openViews).forEach(function(key){if(!validKeys[key])delete openViews[key];});
    var groups={};pairing.matches.forEach(function(m){(groups[m.row]||(groups[m.row]=[])).push(m);});
    visible={scope:scope(),run:result.run,keys:shownDays.map(rowKey),windows:{}};
    pairing.matches.forEach(function(m){var key=rowKey(shownDays[m.row]);(visible.windows[key]||(visible.windows[key]=[])).push(Math.min(time(m.nws.endTime),time(m.nbm.end)));});
    shownDays.forEach(function(day,index){
      var item=items[index];if(!item)return;
      var matches=groups[index]||[],missing=['day','night'].filter(function(part){return day[part]&&time(day[part].endTime)>Date.now()&&!matches.some(function(m){return m.part===part;});});
      var detail=document.createElement('div');detail.className='nbm-period-detail';
      var grid=item.querySelector('.dd-grid');grid.before(detail);
      var line=document.createElement('div');line.className=matches.length?'nbm-inline':'nbm-unavailable';
      add('span','NBM model range',line,'nbm-label');
      item.querySelector('.day').after(line);
      if(!matches.length){
        var availability=result.status==='stale'?'Unavailable · data expired':result.periods?'Unavailable · no matching period':
          !currentData&&failure==='Checking NBM model guidance…'?'Checking data…':'Unavailable';
        add('span',availability,line,'nbm-band');
        add('p',result.periods?'Model range unavailable for this day: no matching model period.':'Model range unavailable. '+result.reason,detail,'nbm-range-note');return;
      }
      matches.forEach(function(m){add('span',(m.part==='day'?'High ':'Low ')+bounds(m.nbm),line,'nbm-band');});
      missing.forEach(function(part){add('span',(part==='day'?'High':'Low')+' unavailable',line,'nbm-band');});
      add('p','The range shows the middle 50% of modeled high/low outcomes. Higher or lower outcomes remain possible.',detail,'nbm-range-note');
      var different=matches.filter(function(m){return !m.exact;}).length;
      if(different)add('p',different===matches.length?'NBM uses different 18-hour periods from the NWS forecast.':'Some NBM periods differ from the NWS forecast.',detail,'nbm-period-note');
      missing.forEach(function(part){add('p',(part==='day'?'High':'Low')+' model range unavailable: no matching model period.',detail,'nbm-range-note');});
      var timing=add('details','',detail,'nbm-timing'),key=rowKey(day);
      timing.dataset.nbmScope=viewScope;timing.dataset.nbmKey=key;timing.dataset.nbmDate=forecastCalendarKey(day.day||day.night);
      timing.open=!!openViews[key];add('summary','Timing & model details',timing);
      timing.addEventListener('toggle',function(){if(typeof scheduleMasonry==='function')scheduleMasonry();});
      matches.forEach(function(m){
        var group=add('div','',timing,'nbm-comparison');
        add('p','NWS '+(m.part==='day'?'high ':'low ')+m.nws.temperature+'°F · '+windowText(m.nws.startTime,m.nws.endTime),group,'nbm-official');
        add('p','NBM '+(m.part==='day'?'maximum':'minimum')+' · P25 '+Math.round(m.nbm.p25)+'°F · median (P50) '+Math.round(m.nbm.p50)+'°F · P75 '+Math.round(m.nbm.p75)+'°F',group,'nbm-model');
        add('p',(m.exact?'Same interval: ':'Different interval (18 hours): ')+windowText(m.nbm.start,m.nbm.end),group,'nbm-window-note');
      });
    });
    restoreViewFocus(focus);
    if(!result.periods)return;
    if(result.status==='partial')add('p','Partial NBM data: some native windows are missing.',body);
    add('p','Nearest native GRIB cell '+result.cell.lat.toFixed(3)+', '+result.cell.lon.toFixed(3)+' · '+result.cell.distance.toFixed(2)+' km from the selected location. Each percentile group shares one run, cell and interval. Data older than 24 hours is withheld; coverage is limited to the St. Louis metro region.',body);
    if(pairing.unmatched.length){
      add('h3','Unpaired model windows',body);
      add('p','These windows have no unique matching NWS day/night entry with sufficient overlap. They are not paired comparisons or replacements for missing official temperatures.',body);
      var list=add('ul','',body);
      pairing.unmatched.forEach(function(p){add('li',(p.kind==='TMAX'?'Maximum':'Minimum')+' · '+windowText(p.start,p.end)+' · NBM model range '+bounds(p)+' · P50 '+Math.round(p.p50)+'°F',list);});
    }
  }
  function forecast(value){days=value;if(!days.length)pendingPaint=null;forecastPoint={lat:current.lat,lon:current.lon};forecastSeq=locSeq;render();}
  function reset(){raw=null;storedPoint=null;storedSeq=-1;days=[];forecastPoint=null;forecastSeq=-1;requestSeq++;openViews={};viewScope='';clearTimeout(activationTimer);activation=null;pendingPaint=null;pendingRender=false;visible={};failure='Checking NBM model guidance…';render();}
  function load(){
    var fresh=locGuard(),point={lat:current.lat,lon:current.lon},seq=++requestSeq;
    return getJSON('/data/nbm-range.json',null,locSignal()).then(function(d){
      if(!fresh()||seq!==requestSeq||point.lat!==current.lat||point.lon!==current.lon)return;
      raw=d;storedPoint=point;storedSeq=locSeq;
      var result=validate(d,point,Date.now());render();
      feedUpdate('nbmRange',['ready','partial'].includes(result.status)?result.status:'unavailable',d.run);
    }).catch(function(){
      if(!fresh()||seq!==requestSeq)return;
      raw=null;failure='NBM model guidance unavailable. NWS forecasts remain primary.';render();
      feedUpdate('nbmRange','unavailable');
    });
  }
  function init(){
    if(new URLSearchParams(location.search).get('nbm')==='0')return;
    var section=document.getElementById('forecastCard'),info=document.createElement('div');info.id='nbmInfo';
    info.innerHTML='<p id="nbmWindowHelp">NBM uses 18-hour windows; expand a day for timing and model details.</p><p id="nbmStatus" role="status">Checking NBM model guidance…</p><details><summary>About NBM ranges &amp; unmatched windows</summary><div id="nbmInfoBody"></div></details>';
    section.appendChild(info);
    document.addEventListener('pointerdown',beginActivation,true);
    document.addEventListener('keydown',beginActivation,true);
    document.addEventListener('pointerup',function(e){if(activation&&activation.type==='pointerdown'&&activation.pointer===e.pointerId)finishActivation();},true);
    document.addEventListener('keyup',function(e){if(activation&&activation.type==='keydown'&&activation.key===e.key)finishActivation();},true);
    document.addEventListener('pointercancel',function(e){if(activation&&activation.pointer===e.pointerId)finishActivation();},true);
    document.addEventListener('pointermove',function(e){if(activation&&activation.type==='pointerdown'&&e.buttons===0)finishActivation();},true);
    document.addEventListener('click',function(e){if(activation&&activation.node.contains(e.target))finishActivation();},true);
    document.addEventListener('visibilitychange',function(){if(document.hidden)finishActivation();});
    window.addEventListener('blur',finishActivation);
    info.querySelector('details').addEventListener('toggle',function(){if(typeof scheduleMasonry==='function')scheduleMasonry();});
    FEEDS.nbmRange={label:'NBM range',load:'loadNbmRange',every:15*60000,age:30*60000,local:true,failure:'unavailable'};
    feedChecks.nbmRange={status:'loading',successAt:0,issuedAt:0,saved:false};
  }
  return {validate:validate,local:local,align:align,load:load,init:init,forecast:forecast,reset:reset,captureView:captureView,restoreViewFocus:restoreViewFocus,deferPaint:deferPaint,forecastPending:forecastPending};
})();
function loadNbmRange(){return NbmRange.load();}
if(typeof document!=='undefined')NbmRange.init();
