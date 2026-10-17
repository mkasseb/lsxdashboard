#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),{run}=require('./feed-health');
const now=Date.parse('2026-10-16T18:00:00Z'),stamp=new Date(now).toISOString();
let active=0,peak=0;
function payload(url){
 const u=new URL(url),p=u.pathname;
 if(p.startsWith('/points/'))return {properties:{cwa:'LSX',timeZone:'America/Chicago',forecast:'https://api.weather.gov/gridpoints/LSX/1/forecast',forecastHourly:'https://api.weather.gov/gridpoints/LSX/1/forecast/hourly'}};
 if(p.includes('/gridpoints/'))return {properties:{updateTime:stamp,periods:[{name:'Today',startTime:stamp,endTime:new Date(now+3600000).toISOString(),temperature:0,temperatureUnit:'F',isDaytime:true,windSpeed:'0 mph',shortForecast:'Sunny'}]}};
 if(p.includes('/observations/'))return {properties:{timestamp:stamp,temperature:{value:0,unitCode:'wmoUnit:degC'}}};
 if(p.includes('/alerts/'))return {features:[]};
 if(p.includes('/products/types/'))return {'@graph':[{'@id':'https://api.weather.gov/products/abc',productCode:'AFD',issuingOffice:'KLSX',issuanceTime:stamp}]};
 if(p.includes('/products/'))return {productCode:'AFD',issuingOffice:'KLSX',issuanceTime:stamp,productText:'Discussion '.repeat(20)};
 if(u.hostname.startsWith('air-quality'))return {current:{us_aqi:0,time:now/1000}};
 if(u.hostname==='api.open-meteo.com')return {hourly:{time:[now/1000],uv_index:[0]}};
 if(p.includes('/gauges/'))return {status:{observed:{primary:0,primaryUnit:'ft',validTime:stamp}}};
 if(p.includes('/geoserver/'))return '<WMS_Capabilities><Layer><Name>klsx_sr_bref</Name><Name>klsx_sr_bvel</Name><Dimension>'+stamp+'</Dimension></Layer></WMS_Capabilities>';
 if(u.hostname==='tiles.openfreemap.org')return {version:8,sources:{},layers:[]};
 if(p.includes('SPC_wx'))return {layers:[1,2,3].map(d=>({name:'Day '+d+' Categorical Outlook'})).concat([1,2].flatMap(d=>['Tornado','Wind','Hail'].map(t=>({name:'Day '+d+' Probabilistic '+t+' Outlook'}))))};
 if(p.includes('wpc_qpf'))return {layers:[{name:'Day 1-7 (168 Hour)'}]};
 throw Error('Unexpected test request '+url);
}
async function fake(url){active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;
 const data=payload(url);return new Response(typeof data==='string'?data:JSON.stringify(data));}
(async()=>{
 const good=await run({fetchImpl:fake,now});assert(good.results.every(r=>r.status==='pass'),JSON.stringify(good));assert.equal(good.requests,14);assert(peak<=3);
 const outage=await run({fetchImpl:async(url,options)=>url.includes('/observations/')?new Response('{}',{status:503}):fake(url,options),now});
 assert.equal(outage.results.filter(r=>r.status==='fail').length,1);assert.match(outage.results.find(r=>r.status==='fail').error,/503/);
 const stale=await run({fetchImpl:fake,now:now+25*3600000});assert(stale.results.some(r=>r.name.includes('observation')&&r.status==='fail'));
 const oversized=await run({fetchImpl:async()=>new Response('x'.repeat(100)),maxBytes:10,now});assert(oversized.results.every(r=>r.status==='fail'&&/byte budget/.test(r.error)));
 const timeout=await run({fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error(),{name:'AbortError'})))),timeoutMs:5,now});
 assert(timeout.results.every(r=>r.status==='fail'&&/timed out/.test(r.error)));
 const budget=await run({fetchImpl:fake,maxRequests:1,now});assert(budget.results.some(r=>/request budget/.test(r.error||'')));
 console.log('PASS read-only feed health: shapes/units/zero, stale sources, isolated HTTP failure, body/request/time budgets and concurrency');
})().catch(e=>{console.error(e);process.exitCode=1;});
