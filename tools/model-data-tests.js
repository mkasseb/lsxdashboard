#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {performance}=require('node:perf_hooks');
const scope={Intl,Date,URLSearchParams};vm.createContext(scope);
for(const file of ['weather-contracts','forecast-range','hourly-range','model-data'])vm.runInContext(fs.readFileSync('assets/'+file+'.js','utf8'),scope);
const point={lat:38.8,lon:-90.79},H=3600000,profile=[];
for(const kind of ['daily','hourly']){
  const bytes=zlib.gunzipSync(fs.readFileSync('tools/fixtures/weather/nbm-quartile-'+kind+'-recorded.json.gz'));
  const data=JSON.parse(bytes),now=Date.parse(data.retrievedAt),validator=kind==='daily'?scope.NbmRange:scope.NbmHourly;
  const expected=validator.validate(data,point,now),cache=scope.ModelData.compile(data,kind,point,now);
  assert.equal(cache.result.status,'ready');
  if(kind==='daily'){
    assert.equal(cache.result.periods.length,expected.periods.length);
    assert(cache.result.periods.every((p,i)=>p.p25===expected.periods[i].p25&&p.p75===expected.periods[i].p75&&!('kelvin' in p)));
    const end=Date.parse(cache.result.periods[0].end);
    if(end<Date.parse(data.run)+24*H)assert(scope.ModelData.current(cache,kind,end).periods.every(p=>Date.parse(p.end)>end));
  }else assert.equal(JSON.stringify(cache.result.values),JSON.stringify(expected.values));
  const start=performance.now();for(let i=0;i<20;i++)validator.validate(data,point,now);
  const validationMs=(performance.now()-start)/20;
  // A repaint must not walk all regional cells again, even when the public validator changes.
  validator.validate=()=>{throw new Error('Repeated full model validation');};
  const cachedStart=performance.now();for(let i=0;i<1000;i++)scope.ModelData.current(cache,kind,now);
  const currentMs=(performance.now()-cachedStart)/1000;
  assert.equal(scope.ModelData.current(cache,kind,Date.parse(data.run)+24*H-1).status,'ready');
  assert.equal(scope.ModelData.current(cache,kind,Date.parse(data.run)+24*H).status,'stale');
  assert.equal(scope.ModelData.current(cache,kind,Date.parse(data.run)-1).status,'unavailable');
  const later={...cache,retrievedAt:new Date(now+300001).toISOString()};
  assert.equal(scope.ModelData.current(later,kind,now).status,'unavailable');
  const size=Buffer.byteLength(JSON.stringify(cache));assert(size<bytes.length/100,'Only point-specific data crosses worker boundary');
  profile.push({kind,regionalBytes:bytes.length,selectedBytes:size,validationMs,currentMs});
}
console.log('PASS cached model parity, no repeated regional validation, source-clock rollback and exact 24-hour expiry');
console.log(JSON.stringify(profile,null,2));
if(process.env.MODEL_PROFILE_REPORT)fs.writeFileSync(process.env.MODEL_PROFILE_REPORT,JSON.stringify(profile,null,2)+'\n');
