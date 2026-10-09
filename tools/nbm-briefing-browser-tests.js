#!/usr/bin/env node
'use strict';
// Explicit synthetic threshold cases prove quartiles cannot revive tail commentary.
const assert=require('assert/strict'),fs=require('fs');
const {chromium}=require('playwright'),{open,config,setBrowser}=require('./weather-stress-tests');
const native=JSON.parse(require('zlib').gunzipSync(fs.readFileSync('tools/fixtures/weather/nbm-quartile-hourly-recorded.json.gz'))),now=Date.parse(native.retrievedAt);
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});setBrowser(b);
try{for(const [temp,bounds] of [[36,[28,35,40]],[86,[82,87,94]]]){
 const s=await open(config('Synthetic removed threshold commentary',{now,temp,rh:20,wind:'1 mph',aqi:35}),390),p=s.page;
 try{
  const before=await p.evaluate(()=>({nws:document.getElementById('callCard').innerText,hourly:JSON.stringify(smart.hourlyAll),model:JSON.stringify(renderTheCall._nbmContext.model)}));
  const d=structuredClone(native);d.hours.forEach(h=>h.kelvin=h.kelvin.map(()=>bounds.map(f=>(f-32)/1.8+273.15)));
  await p.route('**/data/nbm-hourly.json',r=>r.fulfill({json:d}));await p.evaluate(()=>loadNbmHourly());
  assert.equal(await p.locator('.nbm-hourly-band').count(),1);assert.equal(await p.locator('#nbmBriefNote,#forecastTempContext').count(),0);
  assert.deepEqual(await p.evaluate(()=>({nws:document.getElementById('callCard').innerText,hourly:JSON.stringify(smart.hourlyAll),model:JSON.stringify(renderTheCall._nbmContext.model)})),before);
  await p.locator('#nbmHourlyToggle').uncheck();await p.locator('#nbmHourlyToggle').check();assert.equal(await p.locator('#nbmBriefNote').count(),0);
  assert.deepEqual(s.errors,[]);console.log('PASS no threshold commentary at synthetic NWS '+temp+'F');
 }finally{await s.context.close();}
}}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
