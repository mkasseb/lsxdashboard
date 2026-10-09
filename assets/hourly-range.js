/* Optional instant-temperature guidance, isolated from official NWS/risk state. */
var NbmHourly=(function(){
'use strict';
var H=3600000,raw=null,seq=0,point=null,generation=-1,officialGeneration=-1,official=null,failure='Checking model range…',lastFailed=false;
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function time(s){return typeof s==='string'?Date.parse(s):NaN;}
function distance(a,b){var r=Math.PI/180,x=(b.lat-a.lat)*r,y=(b.lon-a.lon)*r;return 12742*Math.asin(Math.sqrt(Math.min(1,Math.sin(x/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(y/2)**2)));}
function validate(d,p,now){
 var bad={status:'unavailable',reason:'Model range unavailable.'};
 try{
  if(!d||d.schema!==2||d.source!=='NOAA NBM QMD NOMADS subset'||d.units!=='K'||d.timezone!=='America/Chicago'||JSON.stringify(d.percentiles)!=='[25,50,75]'||
     !finite(p.lat)||!finite(p.lon)||!d.coverage||d.coverage.south!==38.2||d.coverage.north!==39.2||d.coverage.west!==-91.1||d.coverage.east!==-89.5||d.coverage.maxDistanceKm!==3||
     !Array.isArray(d.cells)||d.cells.length<2500||d.cells.length>4000||!Array.isArray(d.hours)||!d.hours.length||d.hours.length>48||!/^[a-f0-9]{32}$/.test(d.gridHash))return bad;
  var run=time(d.run),retrieved=time(d.retrievedAt);
  if(!finite(run)||run%H||new Date(run).getUTCHours()%6||run>now||!finite(retrieved)||retrieved<run||retrieved>now+300000)return bad;
  if(now-run>=24*H)return {status:'stale',reason:'Range expired: model run is 24 hours old or older.'};
  if(p.lat<38.2||p.lat>39.2||p.lon<-91.1||p.lon>-89.5)return {status:'missing',reason:'Model range is not available for this location.'};
  var seen={},chosen=-1,km=Infinity;
  d.cells.forEach(function(c,i){
   if(!Array.isArray(c)||c.length!==3||!Number.isInteger(c[0])||c[0]<0||seen[c[0]]||!finite(c[1])||!finite(c[2])||c[1]<38.15||c[1]>39.25||c[2]<-91.15||c[2]>-89.45)throw Error();
   seen[c[0]]=true;var k=distance(p,{lat:c[1],lon:c[2]});if(k<km){km=k;chosen=i;}
  });
  if(km>3)return {status:'missing',reason:'No model range close enough to this location.'};
  var last=0,values={};
  d.hours.forEach(function(h){
   var f=h.forecastHour,t=time(h.validTime),published=h.publication&&time(h.publication.publishedAt);
   var stamp=new Date(run).toISOString().replace(/[-:TZ]/g,'').slice(0,10),base='https://nomads.ncep.noaa.gov/pub/data/nccf/com/blend/prod/blend.'+stamp.slice(0,8)+'/'+stamp.slice(8)+'/qmd/blend.t'+stamp.slice(8)+'z.qmd.f'+String(f).padStart(3,'0')+'.co.grib2';
   var expectedSubset='https://nomads.ncep.noaa.gov/cgi-bin/filter_blend.pl?'+new URLSearchParams({dir:'/blend.'+stamp.slice(0,8)+'/'+stamp.slice(8)+'/qmd',file:base.split('/').pop(),var_TMP:'on',lev_2_m_above_ground:'on',subregion:'',leftlon:'-91.18',rightlon:'-89.42',toplat:'39.28',bottomlat:'38.12'}).toString();
   if(!Number.isInteger(f)||f<1||f>48||f<=last||t!==run+f*H||h.template!==6||h.stepType!=='instant'||h.level!==2||JSON.stringify(h.percentiles)!=='[25,50,75]'||
      h.sourceUrl!==base||h.subsetUrl!==expectedSubset||!/^[a-f0-9]{64}$/.test(h.sha256)||
      !finite(published)||published<run||published>retrieved||!Number.isInteger(h.publication.contentLength)||h.publication.contentLength<1000||
      !Array.isArray(h.kelvin)||h.kelvin.length!==d.cells.length)throw Error();
   h.kelvin.forEach(function(k){if(!Array.isArray(k)||k.length!==3||!k.every(function(v){return finite(v)&&v>=180&&v<=340;})||k[0]>k[1]||k[1]>k[2])throw Error();});
   var v=h.kelvin[chosen].map(function(k){return (k-273.15)*1.8+32;});
   values[t]={validTime:t,p25:v[0],p50:v[1],p75:v[2]};last=f;
  });
  return {status:d.hours.length===48?'ready':'partial',run:run,values:values,cell:{index:d.cells[chosen][0],lat:d.cells[chosen][1],lon:d.cells[chosen][2],distance:km,gridHash:d.gridHash}};
 }catch(e){return bad;}
}
function align(result,hrs,now){
 var counts={};hrs.forEach(function(h){var t=time(h.startTime);counts[t]=(counts[t]||0)+1;});
 return hrs.map(function(h){var t=time(h.startTime);return result.values&&counts[t]===1&&time(h.endTime)-t===H&&time(h.endTime)>now&&h.temperatureUnit==='F'&&finite(h.temperature)?result.values[t]||null:null;});
}
function selected(){var e=document.getElementById('nbmHourlyToggle');return !!(e&&e.checked);}
function presentation(hrs,duration,now){
 var status=document.getElementById('nbmHourlyStatus'),toggle=document.getElementById('nbmHourlyToggle');
 if(!status||!toggle)return [];
 ['nbmHourlySource','nbmHourlyPercentiles'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent='';});
 toggle.disabled=duration!==24;
 if(duration!==24){status.textContent='Model range is available in the 24-hour view.';return [];}
 if(!selected()){status.textContent='NWS forecast shown. Model range is off.';return [];}
 var r=raw&&generation===locSeq&&point&&point.lat===current.lat&&point.lon===current.lon?validate(raw,point,now):{status:'unavailable',reason:failure};
 if(!r.values){status.textContent=r.reason;return [];}
 if(officialGeneration!==locSeq||!official){status.textContent='Waiting for the current NWS hourly forecast.';return [];}
 var points=align(r,hrs,now),count=points.filter(Boolean).length;
 status.textContent=(lastFailed?'Latest check failed; previous range shown. ':'')+'Model run '+((now-r.run)/H).toFixed(1)+' hours old · '+count+'/'+hrs.length+' hours matched.';
 var source=document.getElementById('nbmHourlySource');if(source)source.textContent='NOAA NBM QMD · run '+new Date(r.run).toISOString().slice(0,16).replace('T',' ')+' UTC. Native 2 m temperature at each valid hour, shown in °F. Missing hours stay blank. Range expires at 24 hours of source age.';
 return points;
}
function describe(p){
 var detail=document.getElementById('nbmHourlyPercentiles');
 if(detail)detail.textContent=p?'Selected hour: P25 '+Math.round(p.p25)+'°F · P50 '+Math.round(p.p50)+'°F · P75 '+Math.round(p.p75)+'°F.':'No model percentiles for the selected hour.';
 return p?'<span class="nbm-hourly-detail">NBM model range '+Math.round(p.p25)+'–'+Math.round(p.p75)+'°F · middle estimate '+Math.round(p.p50)+'°F · '+new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(p.validTime))+'</span>':'<span class="nbm-hourly-detail">Model range unavailable for this hour.</span>';
}
function forecast(hrs){official=hrs;officialGeneration=locSeq;}
function repaint(){if(typeof renderHourly24==='function'&&renderHourly24._hrs)renderHourly24();}
function reset(){raw=null;point=null;generation=-1;official=null;officialGeneration=-1;seq++;lastFailed=false;failure='Checking model range…';

 if(typeof document!=='undefined'){document.querySelectorAll('.nbm-hourly-band,.nbm-hourly-detail,#nbmBriefNote').forEach(function(e){e.remove();});var status=document.getElementById('nbmHourlyStatus');if(status)status.textContent=failure;['nbmHourlySource','nbmHourlyPercentiles'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent='';});}
}
function load(){
 var fresh=locGuard(),n=++seq,p={lat:current.lat,lon:current.lon};
 return getJSON('/data/nbm-hourly.json',null,locSignal()).then(function(d){
  if(!fresh()||n!==seq)return;
  var r=validate(d,p,Date.now());if(r.status==='unavailable'||r.status==='stale')throw Object.assign(Error('Invalid or expired model range'),{rangeReason:r.reason});
  raw=d;point=p;generation=locSeq;lastFailed=false;feedUpdate('nbmHourly',['ready','partial'].includes(r.status)?r.status:'unavailable',d.run);repaint();
 }).catch(function(error){if(!fresh()||n!==seq)return;lastFailed=true;failure=error.rangeReason||'Model range unavailable. NWS forecast shown.';feedUpdate('nbmHourly','unavailable');repaint();});
}
function init(){
 if(new URLSearchParams(location.search).get('nbm')==='0')return;
 var box=document.createElement('div');box.className='nbm-hourly-controls';
 box.innerHTML='<span class="nbm-hourly-nws-key">NWS temperature line</span><label><input id="nbmHourlyToggle" type="checkbox" checked> Show NBM model range</label><p id="nbmHourlyStatus" role="status">Checking model range…</p><details id="nbmHourlyInfo"><summary>About this range</summary><p id="nbmHourlyMeaning">The shaded NBM model range shows the middle 50% of modeled outcomes using native NOAA NBM quartiles. Roughly 25% of modeled outcomes lie below it and 25% above it; outcomes outside remain possible. This describes each hour separately, not the chance that the whole forecast stays inside. The NWS forecast line can fall outside the band.</p><p>The bounds are the 25th and 75th percentiles (P25 and P75). The middle estimate is the median (P50), not the midpoint of the bounds.</p><p id="nbmHourlyPercentiles"></p><p id="nbmHourlySource"></p></details>';
 document.getElementById('hourly24').before(box);
 box.querySelector('input').addEventListener('change',repaint);
 FEEDS.nbmHourly={label:'Hourly NBM',load:'loadNbmHourly',every:15*60000,age:30*60000,local:true,failure:'unavailable'};
 feedChecks.nbmHourly={status:'loading',successAt:0,issuedAt:0,saved:false};
}
return {validate:validate,align:align,presentation:presentation,describe:describe,forecast:forecast,reset:reset,load:load,init:init};
})();
function loadNbmHourly(){return NbmHourly.load();}
if(typeof document!=='undefined')NbmHourly.init();
