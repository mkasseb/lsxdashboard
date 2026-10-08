'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const s={Intl,Date,URLSearchParams};vm.createContext(s);vm.runInContext(fs.readFileSync('assets/hourly-range.js','utf8'),s);
const N=s.NbmHourly,H=3600000,clone=x=>JSON.parse(JSON.stringify(x));
const data=JSON.parse(require('zlib').gunzipSync(fs.readFileSync('tools/fixtures/weather/nbm-hourly-full-recorded.json.gz'))),now=Date.parse(data.retrievedAt),point={lat:38.8,lon:-90.79};
const result=N.validate(data,point,now);assert.equal(result.status,'ready');
for(const lat of [38.2,38.7,39.2])for(const lon of [-91.1,-90.3,-89.5])assert.equal(N.validate(data,{lat,lon},now).status,'ready');
assert.equal(N.validate(data,{lat:40,lon:-90},now).status,'missing');
assert.equal(N.validate(data,point,Date.parse(data.run)+24*H).status,'stale');
const start=Math.floor(now/H)*H;
const hours=Array.from({length:24},(_,i)=>({startTime:new Date(start+i*H).toISOString(),endTime:new Date(start+(i+1)*H).toISOString(),temperature:0,temperatureUnit:'F'}));
assert.equal(N.align(result,hours,now).filter(Boolean).length,24);
// All valid source ages preserve a complete rolling24h window, including last valid minute.
for(const age of [7,13,23.999]){const t=Date.parse(data.run)+age*H,first=Math.floor(t/H)*H;
 const hs=hours.map((h,i)=>({...h,startTime:new Date(first+i*H).toISOString(),endTime:new Date(first+(i+1)*H).toISOString()}));const d=clone(data);d.retrievedAt=new Date(t).toISOString();d.hours.forEach(h=>h.publication.publishedAt=new Date(Date.parse(d.run)+6*H).toISOString());assert.equal(N.align(N.validate(d,point,t),hs,t).filter(Boolean).length,24);}
for(const mutate of [d=>d.hours[0].template=10,d=>d.hours[0].stepType='max',d=>d.hours[0].level=10,d=>d.units='F',d=>d.hours[0].validTime=d.hours[1].validTime,d=>d.hours.reverse(),d=>d.hours[0].kelvin[0]=[300,290,310],d=>d.hours[0].kelvin[0][0]=null,d=>d.cells[0]=d.cells[1],d=>d.hours[0].sourceUrl='https://example.com/wrong',d=>d.hours[0].publication.publishedAt='2099-01-01T00:00:00Z']){
 const d=clone(data);mutate(d);assert.equal(N.validate(d,point,now).status,'unavailable');}
const gap=clone(data);gap.hours=gap.hours.filter(h=>Date.parse(h.validTime)!==start+5*H);const partial=N.validate(gap,point,now);assert.equal(partial.status,'partial');assert.equal(N.align(partial,hours,now)[5],null);
const ambiguous=clone(hours);ambiguous.push(hours[0]);assert.equal(N.align(result,ambiguous,now)[0],null);
const shifted=clone(hours);shifted[0].startTime=new Date(start+1).toISOString();assert.equal(N.align(result,shifted,now)[0],null);
const celsius=clone(hours);celsius[0].temperatureUnit='C';assert.equal(N.align(result,celsius,now)[0],null);
// Exact UTC keys keep repeated fall-back local hours distinct; spring missing wall hour is not synthesized.
for(const times of [['2026-11-01T01:00:00-05:00','2026-11-01T01:00:00-06:00'],['2026-03-08T01:00:00-06:00','2026-03-08T03:00:00-05:00']]){
 const hs=times.map(t=>({startTime:t,endTime:new Date(Date.parse(t)+H).toISOString(),temperature:0,temperatureUnit:'F'}));
 const r={values:{}};times.forEach((t,i)=>r.values[Date.parse(t)]={p10:i,p50:i+1,p90:i+2});
 const a=N.align(r,hs,Date.parse(times[0]));assert.equal(a[0].p10,0);assert.equal(a[1].p10,1);
}
console.log('PASS authentic hourly provenance, all region edges, exact UTC/DST, partial gaps, zero, malformed data and freshness boundary');
