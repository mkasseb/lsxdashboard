/* Opt-in research prototype. No values enter NWS forecasts, headlines or risk decisions. */
var NbmRange=(function(){
  'use strict';
  var H=3600000, MAX_AGE=24*H;
  function finite(v){return typeof v==='number'&&Number.isFinite(v);}
  function time(s){return typeof s==='string'?Date.parse(s):NaN;}
  function same(a,b){return a&&b&&['index','lat','lon','gridHash'].every(function(k){return a[k]===b[k];});}
  function validate(d,point,now){
    function bad(){return {status:'unavailable',reason:'Range data failed validation.'};}
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
  function paint(result){
    var body=document.getElementById('nbmRange'),status=document.getElementById('nbmStatus');
    if(!body||!status)return;
    body.replaceChildren();
    status.textContent=result.run?'QMD cycle '+new Date(result.run).toISOString().slice(0,16).replace('T',' ')+' UTC · '+age(result.run,Date.now())+' old':result.reason;
    function add(tag,text,parent){var el=document.createElement(tag);el.textContent=text;(parent||body).appendChild(el);return el;}
    if(!result.periods){add('p',result.reason);return;}
    if(result.status==='partial')add('p','Partial data: some requested native intervals are missing.');
    add('p','Supplemental model guidance. NWS forecasts and warnings above remain primary. The P10–P90 band contains the central 80% of the modeled distribution; outcomes outside it remain possible. P50 is the median, not the official NWS forecast.');
    add('p','Native 18-hour extrema windows, not local calendar-day highs and lows. Times use America/Chicago; daylight-saving offsets follow each endpoint.');
    var table=add('table','');table.className='nbm-table';
    add('caption','Temperature percentiles (°F)',table);
    var tr=add('tr','',add('thead','',table));
    ['Native window','P10','P50','P90'].forEach(function(label){var th=add('th',label,tr);th.scope='col';});
    var tb=add('tbody','',table);
    result.periods.forEach(function(p){
      var row=add('tr','',tb),th=add('th',(p.kind==='TMAX'?'Maximum':'Minimum')+' · '+local(p.start)+' – '+local(p.end),row);th.scope='row';
      [p.p10,p.p50,p.p90].forEach(function(v){add('td',Math.round(v)+'°',row);});
    });
    add('p','NOAA NBM QMD · nearest GRIB cell '+result.cell.lat.toFixed(3)+', '+result.cell.lon.toFixed(3)+' · '+result.cell.distance.toFixed(2)+' km from the requested point. One run, cell and native interval per percentile group.');
    add('p','Local prototype: extracted file updates only when the extraction command runs. A successful refresh does not renew the model cycle age. Values are withheld after 24 hours (prototype freshness limit).');
  }
  function load(){
    var fresh=locGuard(),point={lat:current.lat,lon:current.lon};
    return getJSON('/data/nbm-range.json',null,locSignal()).then(function(d){
      if(!fresh())return;
      var result=validate(d,point,Date.now());paint(result);
      feedUpdate('nbmRange',['ready','partial'].includes(result.status)?result.status:'unavailable',d.run);
    }).catch(function(){
      if(!fresh())return;
      paint({status:'unavailable',reason:'Forecast range unavailable. No current extracted NBM file could be loaded.'});
      feedUpdate('nbmRange','unavailable');
    });
  }
  function init(){
    if(new URLSearchParams(location.search).get('nbm')!=='1')return;
    var card=document.createElement('section');card.className='card';card.id='nbmRangeCard';
    card.innerHTML='<h2>Forecast range <span class="sub">Temperature · prototype</span></h2><p id="nbmStatus" role="status">Checking NBM range…</p><details><summary>Temperature range details</summary><div id="nbmRange"></div></details>';
    document.querySelector('.masonry').appendChild(card);
    card.querySelector('details').addEventListener('toggle',function(){if(typeof scheduleMasonry==='function')scheduleMasonry();});
    FEEDS.nbmRange={label:'NBM range',card:'nbmRangeCard',load:'loadNbmRange',every:15*60000,age:30*60000,local:true,failure:'unavailable',reset:{nbmStatus:'Checking NBM range…',nbmRange:''}};
    feedChecks.nbmRange={status:'loading',successAt:0,issuedAt:0,saved:false};
  }
  return {validate:validate,local:local,load:load,init:init};
})();
function loadNbmRange(){return NbmRange.load();}
if(typeof document!=='undefined')NbmRange.init();
