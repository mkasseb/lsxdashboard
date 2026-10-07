#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sandbox={Intl,Date,URLSearchParams};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/forecast-range.js'),'utf8'),sandbox);
const {validate,local}=sandbox.NbmRange;
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-qmd-recorded.json')));
const now=Date.parse(data.retrievedAt),point=data.requestedPoint,H=3600000;
assert.equal(validate(data,point,now).status,'ready');
assert.equal(validate(data,point,Date.parse(data.run)+24*H+1).status,'stale');
assert.equal(validate(data,{lat:39,lon:-90},now).status,'missing');
// Deliberate fixture mutations test rejection; never used as live data.
for(const mutate of [
 d=>d.units='K',d=>d.run='2099-01-01T00:00:00Z',d=>d.retrievedAt='2099-01-01T00:00:00Z',
 d=>d.periods[0].members[0].run='2026-10-07T00:00:00Z',
 d=>d.periods[0].members[1].cell.index++,d=>d.periods[0].members[0].kelvin=null,
 d=>d.periods[0].members[0].statistic=3,d=>d.periods[0].members[0].percentile=90,
 d=>d.periods[0].members[1].etag='different',d=>d.periods[0].p10=d.periods[0].p90+1,
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
assert.match(local('2026-10-09T06:00:00Z'),/Oct 9, 1:00 AM CDT/);
console.log('PASS NBM authentic replay, provenance/units/order rejection, age, missing/partial, DST endpoints');
const region=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-regional-recorded.json.gz'))));
const at=Date.parse(region.retrievedAt);
for(const point of [{lat:38.8,lon:-90.79},{lat:38.63,lon:-90.2},{lat:38.52,lon:-89.98},{lat:38.81,lon:-89.95},{lat:38.56,lon:-91.01},
 {lat:38.2,lon:-91.1},{lat:39.2,lon:-89.5},{lat:38.2,lon:-89.5},{lat:39.2,lon:-91.1}]){
 const result=validate(region,point,at);assert.equal(result.status,'ready');assert(result.cell.distance<=3);
}
const match=validate(region,point,at);
assert.equal(match.cell.index,data.cell.index);
for(let i=0;i<6;i++)for(const key of ['p10','p50','p90'])assert(Math.abs(match.periods[i][key]-data.periods[i][key])<1e-5,'Regional extraction matches independent original point capture');
assert.equal(validate(region,{lat:40,lon:-90},at).status,'missing');
assert.equal(validate(region,point,Date.parse(region.run)+25*H).status,'stale');
for(const mutate of [d=>d.coverage.maxDistanceKm=99,d=>d.cells[0][1]=0,d=>d.cells.push(d.cells[0]),
 d=>d.periods[0].members[0].gridHash='different',d=>d.periods[0].members[0].units='degF',d=>d.periods[0].kelvin=[]]){
 const d=structuredClone(region);mutate(d);assert.equal(validate(d,point,at).status,'unavailable');
}
console.log('PASS authentic regional parity, towns/boundaries, unsupported geography, stale and malformed coverage');
