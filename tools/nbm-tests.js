#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sandbox={Intl,Date,URLSearchParams};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/forecast-range.js'),'utf8'),sandbox);
const {validate,local}=sandbox.NbmRange;
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-point-recorded.json')));
const now=Date.parse(data.retrievedAt),point=data.requestedPoint,H=3600000;
assert.equal(validate(data,point,now).status,'ready');
assert.equal(validate(data,point,Date.parse(data.run)+24*H+1).status,'stale');
assert.equal(validate(data,{lat:39,lon:-90},now).status,'missing');
// Deliberate fixture mutations test rejection; never used as live data.
for(const mutate of [
 d=>d.units='K',d=>d.run='2099-01-01T00:00:00Z',d=>d.retrievedAt='2099-01-01T00:00:00Z',
 d=>d.periods[0].members[0].run='2026-10-07T00:00:00Z',
 d=>d.periods[0].members[1].cell.index++,d=>d.periods[0].members[0].kelvin=null,
 d=>d.periods[0].members[0].statistic=2,d=>d.periods[0].members[0].percentile=90,
 d=>d.periods[0].members[1].etag='different',d=>d.periods[0].p25=d.periods[0].p75+1,
 d=>d.periods[0].end='2026-10-09T00:00:00Z',d=>d.periods[0].members[0].start=d.periods[0].end,
 d=>d.periods[0].members.pop(),d=>d.periods.push(d.periods[0]),d=>d.periods[0].p50=NaN,
 d=>d.cell.distance=6,d=>d.periods[0].members[0].publishedAt='2026-10-07T11:00:00Z'
]){const d=structuredClone(data);mutate(d);assert.equal(validate(d,point,now).status,'unavailable');}
const partial=structuredClone(data);partial.missingHours=[90];assert.equal(validate(partial,point,now).status,'partial');
// Endpoint mapping must not depend on the browser timezone or a fixed UTC offset.
assert.match(local('2026-03-08T07:00:00Z'),/Mar 8, 1:00 AM CST/);
assert.match(local('2026-03-08T08:00:00Z'),/Mar 8, 3:00 AM CDT/);
assert.match(local('2026-11-01T06:00:00Z'),/Nov 1, 1:00 AM CDT/);
assert.match(local('2026-11-01T07:00:00Z'),/Nov 1, 1:00 AM CST/);
assert.match(local('2026-10-10T06:00:00Z'),/Oct 10, 1:00 AM CDT/);
console.log('PASS NBM authentic replay, provenance/units/order rejection, age, missing/partial, DST endpoints');
const region=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-daily-short-recorded.json.gz'))));
const at=Date.parse(region.retrievedAt);
for(const point of [{lat:38.8,lon:-90.79},{lat:38.63,lon:-90.2},{lat:38.52,lon:-89.98},{lat:38.81,lon:-89.95},{lat:38.56,lon:-91.01},
 {lat:38.2,lon:-91.1},{lat:39.2,lon:-89.5},{lat:38.2,lon:-89.5},{lat:39.2,lon:-91.1}]){
 const result=validate(region,point,at);assert.equal(result.status,'ready');assert(result.cell.distance<=3);
}
const match=validate(region,point,at);
assert.equal(match.cell.index,data.cell.index);
for(let i=0;i<6;i++)for(const key of ['p25','p50','p75'])assert(Math.abs(match.periods[i][key]-data.periods[i][key])<1e-5,'Regional and derived point consumer parity');
assert.equal(validate(region,{lat:40,lon:-90},at).status,'missing');
assert.equal(validate(region,point,Date.parse(region.run)+25*H).status,'stale');
for(const mutate of [d=>d.coverage.maxDistanceKm=99,d=>d.cells[0][1]=0,d=>d.cells.push(d.cells[0]),
 d=>d.periods[0].members[0].gridHash='different',d=>d.periods[0].members[0].units='degF',d=>d.periods[0].kelvin=[]]){
 const d=structuredClone(region);mutate(d);assert.equal(validate(d,point,at).status,'unavailable');
}
console.log('PASS authentic regional parity, towns/boundaries, unsupported geography, stale and malformed coverage');
{
// Authentic current NWS periods are recorded separately; matching does not rewrite either source.
const nwsCapture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-nws-recorded.json')));
const nwsPeriods=nwsCapture.forecast.properties.periods;
const days=nwsPeriods.map(p=>({[p.isDaytime?'day':'night']:p}));
const at=Date.parse(nwsCapture.retrievedAt);
const model=validate(region,{lat:38.8,lon:-90.79},at);
const pairing=sandbox.NbmRange.align(days,model.periods,at);
assert.equal(pairing.matches.length,5);assert.equal(pairing.unmatched.length,1);
assert(pairing.matches.every(m=>!m.exact));
const high=pairing.matches.find(m=>m.part==='day');
assert.equal(high.nws.startTime,nwsPeriods.find(p=>p.isDaytime).startTime);
assert.equal(high.nbm.start,'2026-10-09T12:00:00Z'); // 07:00 CDT, one hour after NWS start
assert.equal(high.nbm.end,'2026-10-10T06:00:00Z');   // 01:00 CDT next day
const align=sandbox.NbmRange.align,interval=high.nbm;
function day(n){return [{day:n}];}
const zero={...high.nws,temperature:0};
assert.equal(align(day(zero),[interval],at).matches[0].nws.temperature,0);
for(const temperature of [null,undefined,NaN])assert.equal(align(day({...zero,temperature}),[interval],at).matches.length,0);
assert.equal(align(day({...zero,temperatureUnit:'C'}),[interval],at).matches.length,0);
assert.equal(align(day(zero),[interval,interval],at).matches.length,0,'ambiguous overlapping model windows');
assert.equal(align([{day:zero},{day:zero}],[interval],at).matches.length,0,'model window cannot attach twice');
assert.equal(align(day({...zero,startTime:'2026-10-09T00:00:00Z',endTime:'2026-10-09T14:00:00Z'}),[interval],at).matches.length,0,'weak overlap');
assert.equal(align(day(zero),[{...interval,kind:'TMIN'}],at).matches.length,0,'same kind required');
assert.equal(align(day({...zero,startTime:interval.start,endTime:interval.end}),[interval],at).matches[0].exact,true);
assert.equal(align(day(zero),[interval],Date.parse(interval.end)).matches.length,0,'expired windows');
// Local midnight and DST use instants, never browser date names or assumed 24-hour days.
for(const [start,end,nbmStart,nbmEnd] of [
 ['2026-11-01T00:00:00-05:00','2026-11-01T12:00:00-06:00','2026-11-01T04:00:00Z','2026-11-01T22:00:00Z'],
 ['2026-03-08T00:00:00-06:00','2026-03-08T12:00:00-05:00','2026-03-08T05:00:00Z','2026-03-08T23:00:00Z']
])assert.equal(align(day({...zero,startTime:start,endTime:end}),[{...interval,start:nbmStart,end:nbmEnd}],Date.parse(start)-H).matches.length,1);
console.log('PASS native/NWS overlap, ambiguity, zero/missing, expired, timezone/DST and authentic different-window pairing');

}
// Longer horizon is authentic GRIB data; edge cases below mutate only test inputs.
{
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/weather-core.js'),'utf8'),sandbox);
const full=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-daily-recorded.json.gz'))));
const capture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-nws-recorded.json')));
const at=Math.max(Date.parse(full.retrievedAt),Date.parse(capture.retrievedAt));
const model=validate(full,point,at);assert.equal(model.status,'ready');assert.equal(full.periods.length,18);
const ps=capture.forecast.properties.periods;
for(const periods of [ps,ps.slice(1),ps.slice(0,-1)]){
 const days=sandbox.pairForecastPeriods(periods).slice(0,7),paired=sandbox.NbmRange.align(days,model.periods,at);
 assert.equal(days.length,7);assert.equal(new Set(paired.matches.map(m=>m.row)).size,7,'Every issued row has authentic guidance');
 assert.equal(paired.matches.length,periods.length,'Only issued first/last day/night parts are paired');
 assert.equal(new Set(paired.matches.map(m=>m.nbm.kind+m.nbm.start)).size,paired.matches.length,'No duplicate use');
}
const clipped=structuredClone(ps);clipped[0].startTime=new Date(Date.parse(clipped[0].endTime)-2*H).toISOString();
assert.equal(sandbox.NbmRange.align(sandbox.pairForecastPeriods(clipped),model.periods,at).matches.length,ps.length,'Partial first NWS interval keeps its exact timing');
for(const mutate of [d=>d.periods.pop(),d=>d.periods.push(d.periods[0]),d=>d.periods.reverse(),d=>d.periods[10]=d.periods[11]]){
 const d=structuredClone(full);mutate(d);assert.equal(validate(d,point,at).status,'unavailable','Incomplete, duplicate or reordered native horizon is rejected');
}
// A <=24h-old cycle still covers seven days through either DST transition.
for(const [cycle,date,before,after,transition] of [
 ['2026-03-07T00:00:00Z','2026-03-07','-06:00','-05:00','2026-03-08'],
 ['2026-10-31T00:00:00Z','2026-10-31','-05:00','-06:00','2026-11-01']
]){
 const run=Date.parse(cycle),periods=Array.from({length:18},(_,i)=>{const end=run+(18+12*i)*H;return {kind:new Date(end).getUTCHours()===6?'TMAX':'TMIN',start:new Date(end-18*H).toISOString(),end:new Date(end).toISOString()};});
 const days=Array.from({length:7},(_,i)=>{const d=new Date(Date.parse(date+'T00:00Z')+i*24*H).toISOString().slice(0,10),next=new Date(Date.parse(d+'T00:00Z')+24*H).toISOString().slice(0,10),offset=d<transition?before:after,nextOffset=next<transition?before:after;
  return {day:{temperature:50,temperatureUnit:'F',isDaytime:true,startTime:d+'T06:00:00'+offset,endTime:d+'T18:00:00'+offset},night:{temperature:40,temperatureUnit:'F',isDaytime:false,startTime:d+'T18:00:00'+offset,endTime:next+'T06:00:00'+nextOffset}};});
 const a=sandbox.NbmRange.align(days,periods,run+12*H);assert.equal(a.matches.length,14,'Full horizon and changing DST offsets');
}
console.log('PASS authentic full seven-day coverage, partial endpoints, bounded native horizon and full-week DST transitions');
}

// Historical P10/P50/P90 recordings remain immutable negative controls.
for(const filename of ['nbm-regional-recorded.json.gz','nbm-regional-full-recorded.json.gz']){
 const old=JSON.parse(require('zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather',filename))));
 assert.equal(validate(old,point,Date.parse(old.retrievedAt)).status,'unavailable');
 const mixed=structuredClone(old);mixed.schema=3;mixed.percentiles=[25,50,75];
 assert.equal(validate(mixed,point,Date.parse(mixed.retrievedAt)).status,'unavailable','Old member percentiles cannot acquire new labels');
}
for(const mutate of [d=>d.schema=1,d=>d.schema=2,d=>delete d.percentiles,d=>d.percentiles=[10,50,90],d=>d.periods[0].members[2].percentile=90,d=>d.periods[0].p10=0,d=>d.periods[0]=null,d=>d.periods[0].kelvin[0]=[290,280,300],d=>d.periods[0].kelvin[0].push(310)]){
 const d=structuredClone(region);mutate(d);assert.equal(validate(d,point,at).status,'unavailable');
}
assert.equal(validate(data,point,Date.parse(data.run)+24*H).status,'stale');
console.log('PASS old schemas, mixed percentile identities, off-point malformed rows and exact expiry rejected');
