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
      if(!Array.isArray(p.kelvin)||p.kelvin.length!==d.cells.length||!Array.isArray(p.kelvin[chosen])||p.kelvin[chosen].length!==3||
         !Array.isArray(p.members)||p.members.length!==3)throw new Error('Missing native interval values');
      var values=p.kelvin[chosen],f=values.map(function(k){if(!finite(k))throw new Error('Invalid Kelvin');return (k-273.15)*9/5+32;});
      var members=p.members.map(function(m,i){
        if(m.gridHash!==d.gridHash||m.units!=='K')throw new Error('Mixed regional grid or units');
        return Object.assign({},m,{cell:cell,kelvin:values[i],fahrenheit:f[i]});
      });
      return Object.assign({},p,{p10:f[0],p50:f[1],p90:f[2],members:members});
    });
    return Object.assign({},d,{schema:1,units:'degF',requestedPoint:point,cell:cell,periods:periods});
  }
  function validate(d,point,now){
    function bad(){return {status:'unavailable',reason:'Range data failed validation.'};}
    if(d&&d.schema===2){
      try{d=regionalPoint(d,point);}catch(e){return bad();}
      if(!d)return {status:'missing',reason:'Outside the supported St. Louis metro range coverage (38.2–39.2°N, 91.1–89.5°W), or no grid cell within 3 km.'};
    }
    if(!d||d.schema!==1||d.source!=='NOAA NBM QMD GRIB2'||d.units!=='degF'||d.timezone!=='America/Chicago'||
       !d.requestedPoint||!finite(d.requestedPoint.lat)||!finite(d.requestedPoint.lon))return bad();
    if(Math.abs(d.requestedPoint.lat-point.lat)>0.000001||Math.abs(d.requestedPoint.lon-point.lon)>0.000001)
      return {status:'missing',reason:'No extracted NBM range for this selected point.'};
    var run=time(d.run),retrieved=time(d.retrievedAt);
    if(!finite(run)||!finite(retrieved)||run>now||retrieved>now+5*60000||retrieved<run||!d.cell||
       !Number.isInteger(d.cell.index)||!finite(d.cell.lat)||!finite(d.cell.lon)||
       !finite(d.cell.distance)||d.cell.distance<0||d.cell.distance>5||typeof d.cell.gridHash!=='string'||
       !Array.isArray(d.periods)||!d.periods.length||!Array.isArray(d.missingHours))return bad();
    if(now-run>MAX_AGE)return {status:'stale',reason:'NBM source cycle is over 24 hours old; values withheld.',run:run};
    var seen={},periods=[];
    for(var p of d.periods){
      var start=time(p.start),end=time(p.end),kind=p.kind,key=kind+':'+p.start+':'+p.end;
      if(!['TMAX','TMIN'].includes(kind)||!finite(start)||!finite(end)||end-start!==18*H||start<run||seen[key]||
         ![p.p10,p.p50,p.p90].every(finite)||p.p10>p.p50||p.p50>p.p90||!Array.isArray(p.members)||p.members.length!==3)return bad();
      seen[key]=true;
      for(var i=0;i<3;i++){
        var m=p.members[i],v=[p.p10,p.p50,p.p90][i],published=time(m.publishedAt);
        if(m.percentile!==[10,50,90][i]||m.template!==10||m.statistic!==(kind==='TMAX'?2:3)||
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
  var failure='Checking NBM model guidance…';
  function enabled(){return typeof FEEDS!=='undefined'&&!!FEEDS.nbmRange;}
  function add(tag,text,parent,cls){var el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;parent.appendChild(el);return el;}
  function bounds(p){return Math.round(p.p10)+'–'+Math.round(p.p90)+'°F';}
  function windowText(a,b){return local(a)+' – '+local(b);}
  function render(){
    if(!enabled())return;
    var status=document.getElementById('nbmStatus'),body=document.getElementById('nbmInfoBody'),daily=document.getElementById('daily');
    if(!status||!body||!daily)return;
    daily.querySelectorAll('.nbm-inline,.nbm-period-detail').forEach(function(el){el.remove();});
    body.replaceChildren();
    var currentData=raw&&storedSeq===locSeq&&storedPoint.lat===current.lat&&storedPoint.lon===current.lon;
    var result=currentData?validate(raw,storedPoint,Date.now()):{status:'unavailable',reason:failure};
    status.textContent=result.periods?'NBM model guidance · QMD cycle '+new Date(result.run).toISOString().slice(0,16).replace('T',' ')+' UTC · '+age(result.run,Date.now())+' old':result.reason;
    add('p','NWS temperatures are the official forecast. NBM is separate model guidance: P10–P90 is the central 80% modeled range, with outcomes outside it possible; P50 is the median. No values are averaged or substituted.',body);
    add('p','NBM maximum/minimum temperatures cover native 18-hour windows, not calendar-day highs/lows. A range appears alongside a day or night only when there is one unambiguous overlapping window. Expand the NWS row to compare both intervals. Rows without a range have no unique, currently usable NBM window. All times are Central, with daylight-saving offsets at each endpoint.',body);
    if(!result.periods)return;
    var pairing=align(forecastSeq===locSeq&&forecastPoint&&forecastPoint.lat===current.lat&&forecastPoint.lon===current.lon?days:[],result.periods,Date.now()),items=daily.querySelectorAll('.day-item');
    var groups={};pairing.matches.forEach(function(m){(groups[m.row]||(groups[m.row]=[])).push(m);});
    Object.keys(groups).forEach(function(index){
      var item=items[index];if(!item)return;
      var matches=groups[index],line=document.createElement('div');line.className='nbm-inline';
      add('span','NBM P10–P90',line,'nbm-label');
      matches.forEach(function(m){add('span',(m.part==='day'?'High ':'Low ')+bounds(m.nbm),line,'nbm-band');});
      item.querySelector('.day').after(line);
      var detail=document.createElement('div');detail.className='nbm-period-detail';
      add('h3','Temperature guidance',detail);
      matches.forEach(function(m){
        var group=add('div','',detail,'nbm-comparison');
        add('p','NWS '+(m.part==='day'?'high ':'low ')+m.nws.temperature+'°F · '+windowText(m.nws.startTime,m.nws.endTime),group,'nbm-official');
        add('p','NBM '+(m.part==='day'?'maximum':'minimum')+' · P10 '+Math.round(m.nbm.p10)+'°F · P50 '+Math.round(m.nbm.p50)+'°F · P90 '+Math.round(m.nbm.p90)+'°F',group);
        add('p',(m.exact?'Same interval: ':'Different interval (18 hours): ')+windowText(m.nbm.start,m.nbm.end),group,'nbm-window-note');
      });
      var grid=item.querySelector('.dd-grid');grid.before(detail);
    });
    if(result.status==='partial')add('p','Partial NBM data: some native windows are missing.',body);
    add('p','Nearest native GRIB cell '+result.cell.lat.toFixed(3)+', '+result.cell.lon.toFixed(3)+' · '+result.cell.distance.toFixed(2)+' km from the selected location. Each percentile group shares one run, cell and interval. Data older than 24 hours is withheld; coverage is limited to the St. Louis metro region.',body);
    if(pairing.unmatched.length){
      add('h3','Unpaired model windows',body);
      add('p','These windows have no unique matching NWS day/night entry with sufficient overlap. They are not paired comparisons or replacements for missing official temperatures.',body);
      var list=add('ul','',body);
      pairing.unmatched.forEach(function(p){add('li',(p.kind==='TMAX'?'Maximum':'Minimum')+' · '+windowText(p.start,p.end)+' · P10–P90 '+bounds(p)+' · P50 '+Math.round(p.p50)+'°F',list);});
    }
  }
  function forecast(value){days=value;forecastPoint={lat:current.lat,lon:current.lon};forecastSeq=locSeq;render();}
  function reset(){raw=null;storedPoint=null;storedSeq=-1;days=[];forecastPoint=null;forecastSeq=-1;requestSeq++;failure='Checking NBM model guidance…';render();}
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
    info.innerHTML='<p id="nbmWindowHelp">NBM uses 18-hour windows; expand a day to compare timing and percentiles.</p><p id="nbmStatus" role="status">Checking NBM model guidance…</p><details><summary>About NBM ranges &amp; unmatched windows</summary><div id="nbmInfoBody"></div></details>';
    section.appendChild(info);
    info.querySelector('details').addEventListener('toggle',function(){if(typeof scheduleMasonry==='function')scheduleMasonry();});
    FEEDS.nbmRange={label:'NBM range',load:'loadNbmRange',every:15*60000,age:30*60000,local:true,failure:'unavailable'};
    feedChecks.nbmRange={status:'loading',successAt:0,issuedAt:0,saved:false};
  }
  return {validate:validate,local:local,align:align,load:load,init:init,forecast:forecast,reset:reset};
})();
function loadNbmRange(){return NbmRange.load();}
if(typeof document!=='undefined')NbmRange.init();
