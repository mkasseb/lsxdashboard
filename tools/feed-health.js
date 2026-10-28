#!/usr/bin/env node
'use strict';
// Read-only, keyless upstream smoke checks. No extraction, publication or writes to feeds.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),C=require('../assets/weather-contracts');
const API='https://api.weather.gov',MAP='https://mapservices.weather.noaa.gov/vector/rest/services/',SITE='https://lsxdashboard.com';
const allowed=new Set(['api.weather.gov','api.water.noaa.gov','mapservices.weather.noaa.gov','api.open-meteo.com',
  'air-quality-api.open-meteo.com','opengeo.ncep.noaa.gov','tiles.openfreemap.org','lsxdashboard.com']);
// Run the same validators as the dashboard, without initializing any UI or fetching GRIBs.
const models={Intl,Date,URLSearchParams,WeatherContracts:C},point={lat:38.8,lon:-90.79},H=3600000;
vm.createContext(models);
for(const file of ['forecast-range.js','hourly-range.js'])
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets',file),'utf8'),models,{filename:file});
function demand(ok,message){if(!ok)throw new Error(message);}
function fresh(value,now,age,label){demand(C.sourceState(value,now,age).state==='ready',label+' is missing, stale or in the future');}
function nwsLink(value,path){const u=new URL(value);demand(u.origin===API&&u.pathname.startsWith(path),'Unexpected NWS source URL');return u.href;}
function nbmCoverage(data,kind,now){
 const result=(kind==='daily'?models.NbmRange:models.NbmHourly).validate(data,point,now);
 demand(result.status==='ready','NBM '+kind+' '+result.status+': '+(result.reason||'Incomplete model snapshot'));
 const details={run:data.run,sourceAgeHours:(now-result.run)/H,point};
 if(kind==='daily'){
  demand(data.schema===3&&data.periods.length===18,'NBM daily native horizon is incomplete');
  // Native extrema intervals differ from NWS day/night windows; an absent join is legitimate.
  return {...details,nativePeriods:data.periods.length,unexpiredPeriods:result.periods.length};
 }
 const start=Math.floor(now/H)*H;
 const matched=Array.from({length:24},(_,i)=>result.values[start+i*H]).filter(Boolean).length;
 demand(matched===24,'NBM hourly covers '+matched+'/24 current UTC hours');
 return {...details,nativeHours:data.hours.length,matchedHours:matched,
  windowStart:new Date(start).toISOString(),windowEnd:new Date(start+24*H).toISOString()};
}
async function run({fetchImpl=fetch,now=Date.now(),timeoutMs=C.policy.requestTimeout,maxBytes=5*1024*1024,maxRequests=18}={}){
 let requests=0;const results=[],started=Date.now();
 async function request(url,asText=false){
  const u=new URL(url);demand(u.protocol==='https:'&&allowed.has(u.hostname),'Unexpected feed origin');
  demand(requests<maxRequests,'Feed request budget exceeded');requests++;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetchImpl(url,{signal:controller.signal,redirect:'error',headers:{
    'Accept':'application/ld+json, application/json, text/xml, */*',
    'User-Agent':'LSX-Dashboard-feed-health/1.0 (+https://github.com/mkasseb/lsxdashboard)'}});
   demand(response.ok,'HTTP '+response.status);
   demand(Number(response.headers.get('content-length')||0)<=maxBytes,'Feed body exceeds byte budget');
   const chunks=[];let size=0;
   if(response.body)for await(const chunk of response.body){size+=chunk.byteLength;
    if(size>maxBytes){controller.abort();throw new Error('Feed body exceeds byte budget');}chunks.push(Buffer.from(chunk));}
   const text=Buffer.concat(chunks).toString('utf8');return asText?text:JSON.parse(text);
  }catch(error){if(controller.signal.aborted&&error.name==='AbortError')throw new Error('Feed request timed out');throw error;}
  finally{clearTimeout(timer);}
 }
 const tasks=[
  ['NWS point / daily / hourly',async()=>{
   const point=await request(API+'/points/38.80,-90.79'),p=point.properties;
   demand(p&&p.cwa==='LSX'&&p.timeZone==='America/Chicago','Point metadata changed');
   for(const [key,label] of [['forecast','Daily forecast'],['forecastHourly','Hourly forecast']]){
    const data=await request(nwsLink(p[key],'/gridpoints/LSX/'));
    demand(C.forecast(data,now),label+' has no usable unexpired periods');
    fresh(data.properties.updateTime||data.properties.generatedAt,now,C.policy.localForecastAge,label);
   }
  }],
  ['Deployed NBM daily',async()=>nbmCoverage(await request(SITE+'/data/nbm-range.json'),'daily',now)],
  ['Deployed NBM hourly',async()=>nbmCoverage(await request(SITE+'/data/nbm-hourly.json'),'hourly',now)],
  ['NWS KSUS observation',async()=>demand(C.observation(await request(API+'/stations/KSUS/observations/latest'),now,null,true),'Observation temperature/units/time unavailable')],
  ['NWS alerts',async()=>{
   const data=await request(API+'/alerts/active?area=MO,IL');
   demand(Array.isArray(data.features)&&data.features.every(f=>f&&f.properties&&typeof f.properties.event==='string'),'Invalid alerts collection');
   // An empty successful collection is a valid no-alert result.
  }],
  ['NWS LSX discussion',async()=>{
   const list=await request(API+'/products/types/AFD/locations/LSX');
   const latest=(Array.isArray(list['@graph'])?list['@graph']:[]).filter(p=>p.productCode==='AFD'&&p.issuingOffice==='KLSX')
    .sort((a,b)=>Date.parse(b.issuanceTime)-Date.parse(a.issuanceTime))[0];
   demand(latest,'No LSX discussion');
   const product=await request(nwsLink(latest['@id']||API+'/products/'+latest.id,'/products/'));
   demand(product.productCode==='AFD'&&product.issuingOffice==='KLSX'&&typeof product.productText==='string'&&product.productText.length>100,'Invalid LSX discussion');
   fresh(product.issuanceTime,now,C.policy.messagesAge,'Discussion');
  }],
  ['Open-Meteo air quality',async()=>demand(C.airQuality(await request('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=38.8&longitude=-90.79&current=us_aqi,pm2_5,pm10&timeformat=unixtime'),now),'Air quality values/time unavailable')],
  ['Open-Meteo UV',async()=>demand(C.uv(await request('https://api.open-meteo.com/v1/forecast?latitude=38.8&longitude=-90.79&hourly=uv_index&daily=uv_index_max&forecast_days=7&timezone=America%2FChicago&timeformat=unixtime'),now),'UV samples unavailable')],
  ['NWPS St. Louis gauge',async()=>{
   const d=await request('https://api.water.noaa.gov/nwps/v1/gauges/EADM7'),ob=d.status&&d.status.observed;
   demand(ob&&C.number(ob.primary,-499)!=null&&ob.primaryUnit==='ft','Gauge measurement/units unavailable');
   fresh(ob.validTime,now,C.policy.riverObservationAge,'Gauge observation');
  }],
  ['KLSX radar capabilities',async()=>{
   const xml=await request('https://opengeo.ncep.noaa.gov/geoserver/klsx/ows?service=WMS&version=1.3.0&request=GetCapabilities',true);
   for(const name of ['klsx_sr_bref','klsx_sr_bvel'])demand(new RegExp('<(?:\\w+:)?Name>\\s*'+name+'\\s*</').test(xml),'Radar product '+name+' unavailable');
   const times=xml.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g)||[];
   demand(times.some(t=>C.sourceState(t,now,C.policy.observationAge).state==='ready'),'Radar has no recent time dimension');
  }],
  ['OpenFreeMap style',async()=>demand(C.mapStyle(await request('https://tiles.openfreemap.org/styles/positron')),'Invalid vector map style')],
  ['SPC named layers',async()=>{
   const d=await request(MAP+'outlooks/SPC_wx_outlks/MapServer?f=json');
   demand(!d.error&&Array.isArray(d.layers),'Invalid SPC metadata');
   for(const day of [1,2,3])demand(d.layers.some(l=>new RegExp('^Day\\s*'+day+'\\s+Categorical','i').test(l.name)),'Missing SPC categorical day '+day);
   for(const day of [1,2])for(const threat of ['Tornado','Wind','Hail'])demand(d.layers.some(l=>new RegExp('^Day\\s*'+day+'\\s+Probabilistic\\s+'+threat+'\\s+Outlook$','i').test(l.name)),'Missing SPC '+threat+' day '+day);
  }],
  ['WPC rainfall metadata',async()=>{
   const d=await request(MAP+'precip/wpc_qpf/MapServer?f=json');
   demand(!d.error&&Array.isArray(d.layers)&&d.layers.some(l=>/day\s*1\s*[-–]\s*7|7[\s_-]*day|168/i.test(l.name)),'Seven-day rainfall layer unavailable');
  }]
 ];
 let index=0;
 async function work(){while(index<tasks.length){const [name,test]=tasks[index++],t=Date.now();
  try{const details=await test();results.push({name,status:'pass',ms:Date.now()-t,...details});}
  catch(error){results.push({name,status:'fail',ms:Date.now()-t,error:error.message});}
 }}
 await Promise.all([work(),work(),work()]);
 return {checkedAt:new Date(now).toISOString(),durationMs:Date.now()-started,requests,limits:{maxRequests,maxBytes,timeoutMs,concurrency:3},results};
}
module.exports={run};
if(require.main===module)run().then(report=>{
 const file=process.argv[2]||'/tmp/lsx-feed-health.json';fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 for(const r of report.results)console.log(r.status.toUpperCase()+' '+r.name+(r.error?': '+r.error:''));
 console.log(report.requests+' read-only requests; report '+file);
 if(report.results.some(r=>r.status==='fail'))process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
