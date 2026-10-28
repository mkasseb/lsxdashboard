#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),{run}=require('./feed-health');
const recording=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(__dirname+'/fixtures/weather/nbm-quartile-'+name+'-recorded.json.gz')));
const daily=recording('daily'),hourly=recording('hourly'),H=3600000;
const now=Math.max(Date.parse(daily.retrievedAt),Date.parse(hourly.retrievedAt));
let active=0,peak=0;
function payload(url,at=now){
 const u=new URL(url),p=u.pathname,stamp=new Date(at).toISOString();
 if(p==='/data/nbm-range.json')return daily;
 if(p==='/data/nbm-hourly.json')return hourly;
 if(p.startsWith('/points/'))return {properties:{cwa:'LSX',timeZone:'America/Chicago',forecast:'https://api.weather.gov/gridpoints/LSX/1/forecast',forecastHourly:'https://api.weather.gov/gridpoints/LSX/1/forecast/hourly'}};
 if(p.includes('/gridpoints/'))return {properties:{updateTime:stamp,periods:[{name:'Today',startTime:stamp,endTime:new Date(at+H).toISOString(),temperature:0,temperatureUnit:'F',isDaytime:true,windSpeed:'0 mph',shortForecast:'Sunny'}]}};
 if(p.includes('/observations/'))return {properties:{timestamp:stamp,temperature:{value:0,unitCode:'wmoUnit:degC'}}};
 if(p.includes('/alerts/'))return {features:[]};
 if(p.includes('/products/types/'))return {'@graph':[{'@id':'https://api.weather.gov/products/abc',productCode:'AFD',issuingOffice:'KLSX',issuanceTime:stamp}]};
 if(p.includes('/products/'))return {productCode:'AFD',issuingOffice:'KLSX',issuanceTime:stamp,productText:'Discussion '.repeat(20)};
 if(u.hostname.startsWith('air-quality'))return {current:{us_aqi:0,time:at/1000}};
 if(u.hostname==='api.open-meteo.com')return {hourly:{time:[at/1000],uv_index:[0]}};
 if(p.includes('/gauges/'))return {status:{observed:{primary:0,primaryUnit:'ft',validTime:stamp}}};
 if(p.includes('/geoserver/'))return '<WMS_Capabilities><Layer><Name>klsx_sr_bref</Name><Name>klsx_sr_bvel</Name><Dimension>'+stamp+'</Dimension></Layer></WMS_Capabilities>';
 if(u.hostname==='tiles.openfreemap.org')return {version:8,sources:{},layers:[]};
 if(p.includes('SPC_wx'))return {layers:[1,2,3].map(d=>({name:'Day '+d+' Categorical Outlook'})).concat([1,2].flatMap(d=>['Tornado','Wind','Hail'].map(t=>({name:'Day '+d+' Probabilistic '+t+' Outlook'}))))};
 if(p.includes('wpc_qpf'))return {layers:[{name:'Day 1-7 (168 Hour)'}]};
 throw Error('Unexpected test request '+url);
}
async function fake(url){active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;
 const data=payload(url);return new Response(typeof data==='string'?data:JSON.stringify(data));}
function withModels({day=daily,hour=hourly,at=now}={}){
 return async url=>{
  const p=new URL(url).pathname,data=p==='/data/nbm-range.json'?day:p==='/data/nbm-hourly.json'?hour:payload(url,at);
  return new Response(typeof data==='string'?data:JSON.stringify(data));
 };
}
const result=(report,kind)=>report.results.find(r=>r.name==='Deployed NBM '+kind);
// Shift daily metadata for controlled age scenarios; these are not new NOAA recordings.
function shiftDaily(days){
 const d=structuredClone(daily),shift=s=>new Date(Date.parse(s)+days*24*H).toISOString();
 const oldDate=d.run.slice(0,10).replaceAll('-',''),newDate=shift(d.run).slice(0,10).replaceAll('-','');
 d.run=shift(d.run);d.retrievedAt=shift(d.retrievedAt);
 for(const p of d.periods){
  for(const field of ['start','end','localStart','localEnd'])p[field]=shift(p[field]);
  for(const m of p.members){
   for(const field of ['run','start','end','localStart','localEnd'])m[field]=shift(m[field]);
   m.publishedAt=new Date(Date.parse(m.publishedAt)+days*24*H).toUTCString();
   m.url=m.url.replace('blend.'+oldDate,'blend.'+newDate);
  }
 }
 return d;
}
(async()=>{
 const good=await run({fetchImpl:fake,now});assert(good.results.every(r=>r.status==='pass'),JSON.stringify(good));assert.equal(good.requests,16);assert(peak<=3);
 assert.equal(result(good,'daily').nativePeriods,18);assert.equal(result(good,'hourly').matchedHours,24);
 const today=await run({fetchImpl:withModels({day:shiftDaily(1),at:now+24*H}),now:now+24*H});
 assert.equal(result(today,'daily').status,'pass');assert.match(result(today,'hourly').error,/stale.*24 hours/);
 assert.equal(today.results.filter(r=>r.status==='fail').length,1,'Fresh daily and other feeds cannot hide yesterday\'s expired hourly cycle');
 const olderDaily=await run({fetchImpl:withModels({day:shiftDaily(-1)}),now});
 assert.match(result(olderDaily,'daily').error,/stale/);assert.equal(result(olderDaily,'hourly').status,'pass');
 const expiredBoundary=Date.parse(hourly.run)+24*H;
 const boundary=await run({fetchImpl:fake,now:expiredBoundary});assert.match(result(boundary,'hourly').error,/stale/);
 const lastMinute=await run({fetchImpl:fake,now:expiredBoundary-1});assert.equal(result(lastMinute,'hourly').status,'pass');
 for(const mutate of [
  d=>d.hours.splice(20,1),
  d=>d.hours[20].kelvin[0][0]=null,
  d=>d.hours[20].validTime=d.hours[21].validTime,
  d=>d.coverage.west=-90.7,
  d=>d.run='2099-01-01T00:00:00Z'
 ]){
  const d=structuredClone(hourly);mutate(d);const report=await run({fetchImpl:withModels({hour:d}),now});
  assert.equal(result(report,'hourly').status,'fail');assert.equal(result(report,'daily').status,'pass');
 }
 for(const mutate of [d=>d.periods.splice(6),d=>d.periods[0].kelvin[0][0]=null,d=>d.missingHours.push(42)]){
  const d=structuredClone(daily);mutate(d);const report=await run({fetchImpl:withModels({day:d}),now});
  assert.equal(result(report,'daily').status,'fail');assert.equal(result(report,'hourly').status,'pass');
 }
 // A structurally valid full cycle with no current f000 cannot cover the rolling 24h window.
 const first=structuredClone(hourly);first.retrievedAt=first.run;
 first.hours.forEach(h=>h.publication.publishedAt=first.run);
 const initial=await run({fetchImpl:withModels({hour:first}),now:Date.parse(first.run)});
 assert.match(result(initial,'hourly').error,/covers 23\/24/);
 const modelOutage=await run({fetchImpl:async(url,options)=>url.includes('/data/nbm-hourly.json')?new Response('{}',{status:503}):fake(url,options),now});
 assert.equal(modelOutage.results.filter(r=>r.status==='fail').length,1);assert.equal(result(modelOutage,'daily').status,'pass');
 const outage=await run({fetchImpl:async(url,options)=>url.includes('/observations/')?new Response('{}',{status:503}):fake(url,options),now});
 assert.equal(outage.results.filter(r=>r.status==='fail').length,1);assert.match(outage.results.find(r=>r.status==='fail').error,/503/);
 const nwsOutage=await run({fetchImpl:async(url,options)=>url.includes('/gridpoints/')?new Response('{}',{status:503}):fake(url,options),now});
 assert.equal(result(nwsOutage,'daily').status,'pass');assert.equal(result(nwsOutage,'hourly').status,'pass');
 const stale=await run({fetchImpl:fake,now:now+25*3600000});assert(stale.results.some(r=>r.name.includes('observation')&&r.status==='fail'));
 const oversized=await run({fetchImpl:async()=>new Response('x'.repeat(100)),maxBytes:10,now});assert(oversized.results.every(r=>r.status==='fail'&&/byte budget/.test(r.error)));
 const timeout=await run({fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error(),{name:'AbortError'})))),timeoutMs:5,now});
 assert(timeout.results.every(r=>r.status==='fail'&&/timed out/.test(r.error)));
 const budget=await run({fetchImpl:fake,maxRequests:1,now});assert(budget.results.some(r=>/request budget/.test(r.error||'')));
 console.log('PASS read-only feed health: shapes/units/zero, stale sources, isolated HTTP failure, body/request/time budgets and concurrency');
 console.log('PASS deployed NBM: native quartiles and coverage, rolling 24 UTC hours, exact expiry, fresh daily with expired hourly and independent failures');
})().catch(e=>{console.error(e);process.exitCode=1;});
