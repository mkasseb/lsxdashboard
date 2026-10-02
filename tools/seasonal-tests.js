#!/usr/bin/env node
'use strict';
// Deterministic cross-product of physically plausible and deliberately inconsistent source inputs.
const vm=require('vm'),fs=require('fs'),assert=require('node:assert/strict'),path=require('path');
const core={Intl,Date,URLSearchParams};vm.createContext(core);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/weather-core.js'),'utf8'),core);
const dates=['2026-01-15T18:00:00Z','2026-04-15T18:00:00Z','2026-07-15T18:00:00Z','2026-10-15T18:00:00Z','2026-03-08T06:00:00Z','2026-11-01T05:00:00Z','2026-12-31T23:00:00Z','2026-10-02T04:00:00Z'];
const conditions=['Clear','Thunderstorms','Sleet','Freezing Rain','Blizzard','Dense Fog'];
function hours(now,temp,rh,wind,condition){return core.bottomLineHours(Array.from({length:24},(_,i)=>({temperature:temp,relativeHumidity:{value:rh},windSpeed:wind==null?'':wind+' mph',shortForecast:condition,probabilityOfPrecipitation:{value:/storm|sleet|freezing|blizzard/i.test(condition)?80:0},startTime:new Date(+now+i*3600000).toISOString(),endTime:new Date(+now+(i+1)*3600000).toISOString(),isDaytime:core.weatherParts(+now+i*3600000).hour>=7&&core.weatherParts(+now+i*3600000).hour<19})));}
let cases=0;
for(const temp of [-40,-20,0,31,32,33,50,58,72,80,99,115])
for(const rh of [null,0,40,80,100])
for(const wind of [null,0,3,10,35,60])
for(const aqi of [null,50,100,101,150,151,300,301]){
  const now=new Date(dates[(cases+Math.floor(cases/8))%dates.length]),condition=conditions[(Math.floor(cases/8)+Math.floor(cases/48))%conditions.length];
  const H=hours(now,temp,rh,wind,condition),allowComfort=aqi!=null;
  const candidates=core.bottomLineHourlyCandidates(H,{now,aqi,allowComfort});
  const model=core.buildBottomLine(candidates,null),text=JSON.stringify(model);
  const label=JSON.stringify({temp,rh,wind,aqi,condition,date:now.toISOString()});
  assert(!/NaN|Infinity|undefined/.test(text),label);
  assert.equal(text,JSON.stringify(core.buildBottomLine(candidates.slice().reverse(),null)),'order independence '+label);
  if(aqi>100||aqi==null||/storm|sleet|freezing|blizzard|fog/i.test(condition))assert(!candidates.some(c=>c.tone==='good'),'no favorable exposure '+label);
  if(aqi>=301)assert.equal(model.lead.topic,'air','hazardous air precedence '+label);
  if(wind>=35)assert(candidates.some(c=>c.topic==='wind'),'high wind '+label);
  if(H[0].fl>=105)assert(candidates.some(c=>c.topic==='heat'&&c.tone==='danger'),'heat '+label);
  if(H[0].fl<=-20)assert(candidates.some(c=>c.topic==='cold'&&/Dangerous/.test(c.headline)),'wind chill '+label);
  if(/sleet|freezing|blizzard/i.test(condition))assert(candidates.some(c=>c.icon==='snow'),'winter type '+label);
  if(/fog/i.test(condition))assert(candidates.some(c=>c.topic==='fog'),'fog '+label);
  for(const h of H)assert(h.fl==null||Number.isFinite(h.fl)&&h.fl>=-150&&h.fl<=350,'bounded feels-like '+label);
  cases++;
}
// Explicit transitions probe phase/timing boundaries independently of the cross-product.
const now=new Date('2026-10-01T12:00:00Z');
for(const kind of ['Thunderstorms','Snow','Freezing Rain']){
  const H=hours(now,40,60,10,'Clear');
  H[1].pop=70;H[2].pop=70;
  for(let i=10;i<13;i++){H[i].pop=80;H[i].thund=kind==='Thunderstorms';H[i].wint=kind!=='Thunderstorms';}
  const cs=core.bottomLineHourlyCandidates(H,{now,aqi:35});
  assert(cs.some(c=>c.headline==='Rain likely'));
  assert(cs.some(c=>/later/.test(c.headline)&&c.topic===(kind==='Thunderstorms'?'storm':'winter')),'later '+kind);
}
const unknownWind=hours(new Date('2026-10-02T02:00:00Z'),60,40,null,'Clear');
assert(!core.bottomLineHourlyCandidates(unknownWind,{now:new Date('2026-10-02T02:00:00Z'),aqi:35}).some(c=>/window-opening/.test(c.action)));
const future=hours(new Date(+now+4*3600000),65,40,5,'Clear');
assert(!core.bottomLineHourlyCandidates(future,{now,aqi:35}).some(c=>c.tone==='good'));
const rainFuture=hours(new Date(+now+4*3600000),65,40,5,'Thunderstorms');
assert(!core.bottomLineHourlyCandidates(rainFuture,{now,aqi:35}).some(c=>/\bnow\b/.test(c.detail)));
const flash=hours(now,40,50,10,'Clear');flash[8].t=20;flash[8].fl=10;
assert(core.bottomLineHourlyCandidates(flash,{now,aqi:35}).some(c=>c.topic==='cold'&&/Freezing near/.test(c.headline)));
for(const event of ['High Wind Warning','Dense Smoke Advisory','Dense Fog Advisory','Air Quality Alert']){
 const cs=core.bottomLineHourlyCandidates(hours(now,65,40,5,'Clear'),{now,aqi:35});
 const model=core.buildBottomLine(cs,{event,family:core.eventFamily(event),level:/Warning/.test(event)?'warning':'advisory'});
 assert(!JSON.stringify(model).match(/Excellent outdoor|Good window-opening/),event);
}
console.log(`ok    seasonal: ${cases} deterministic combinations plus later precipitation, flash freeze, delayed coverage, missing wind and conflicting official-alert boundaries`);
