'use strict';
// Synthetic temperature scenarios on the actual app; these are not observed live forecasts.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright'),{open,config,setBrowser}=require('./weather-stress-tests');
const original=JSON.parse(require('zlib').gunzipSync(fs.readFileSync('tools/fixtures/weather/nbm-hourly-full-recorded.json.gz'))),now=Date.parse(original.retrievedAt),H=3600000,route='**/data/nbm-hourly.json';
function payload(bounds){const d=structuredClone(original);d.hours.forEach(h=>h.kelvin=h.kelvin.map(()=>bounds.map(f=>(f-32)/1.8+273.15)));return d;}
async function model(p,d){await p.unroute(route);await p.route(route,r=>r.fulfill({json:d}));await p.evaluate(()=>loadNbmHourly());}
async function baseline(p){return p.evaluate(()=>({model:JSON.stringify(renderTheCall._nbmContext.model),hourly:JSON.stringify(smart.hourlyAll),risk:JSON.stringify(callRisk),alerts:JSON.stringify(callLocalAlert)}));}
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});setBrowser(b);
try{for(const width of [320,390,1440])for(const timezone of ['America/Chicago','Asia/Tokyo']){
 const s=await open(config('Controlled NBM temperature context',{now,temp:36,rh:20,wind:'1 mph',aqi:35,timezone,touch:width<500}),width),p=s.page;
 try{
  const before=await baseline(p);await model(p,payload([28,35,40]));
  assert.equal(await p.locator('#nbmBriefNote').count(),1);assert.deepEqual(await baseline(p),before,'Official selection and forecast state unchanged');
  assert.match(await p.locator('#nbmBriefText').innerText(),/Oct 8.*CDT: NWS 36°F; NOAA NBM’s central 80% model range of 28–40°F includes freezing/);
  assert.equal(await p.locator('#nbmBriefNote details').evaluate(e=>e.open),false);
  const summary=p.locator('#nbmBriefNote summary');if(width<500)await summary.tap();else{await summary.focus();await summary.press('Enter');}
  assert.match(await p.locator('#nbmBriefSource').innerText(),/not guaranteed limits/);
  assert.equal(await p.locator('#nbmBriefNote details').evaluate(e=>e.open),true);
  await summary.focus();await p.evaluate(()=>renderTheCall());assert.equal(await p.locator('#nbmBriefNote details').evaluate(e=>e.open),true,'Official repaint preserves expanded disclosure');assert(await summary.evaluate(e=>e===document.activeElement),'Official repaint preserves focused disclosure');
  const box=await summary.boundingBox();assert(box.height>=44);
  await p.evaluate(()=>freshnessCheck());assert.equal(await p.locator('#nbmBriefNote details').evaluate(e=>e.open),true,'Freshness repaint preserves disclosure');
  for(const theme of ['light','dark']){await p.evaluate(t=>{applyTheme(t);layoutMasonry();},theme);await p.clock.runFor(500);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(process.env.NBM_ARTIFACTS){fs.mkdirSync(process.env.NBM_ARTIFACTS,{recursive:true});await p.locator('#callCard').screenshot({path:path.join(process.env.NBM_ARTIFACTS,`brief-${width}-${timezone.replace('/','-')}-${theme}.png`)});}}
  await p.locator('#nbmHourlyToggle').uncheck();assert.equal(await p.locator('#nbmBriefNote').count(),0);await p.locator('#nbmHourlyToggle').check();assert.equal(await p.locator('#nbmBriefNote').count(),1);
  if(width===390&&timezone==='America/Chicago'){
   // Every competing warning/danger candidate blocks, even when hidden by selector limits.
   for(const c of [{topic:'storm',tone:'warning'},{topic:'cold',tone:'danger'},{topic:'uv',tone:'warning'},{topic:'flood',tone:'danger'}]){
    await p.evaluate(c=>{renderTheCall._nbmContext.candidates.push(c);renderNbmBriefing();},c);assert.equal(await p.locator('#nbmBriefNote').count(),0);await p.evaluate(()=>renderTheCall());assert.equal(await p.locator('#nbmBriefNote').count(),1);
   }
   await p.locator('#nbmBriefNote summary').focus();
   await p.evaluate(()=>{callLocalAlert={event:'Frost Advisory',level:'advisory',family:'cold'};renderTheCall();});assert.equal(await p.locator('#nbmBriefNote').count(),0);assert(await p.locator('#briefWhy summary').evaluate(e=>e===document.activeElement),'Hazard removal leaves focus on stable briefing disclosure');
   await p.evaluate(()=>{callLocalAlert=null;renderTheCall();});assert.equal(await p.locator('#nbmBriefNote').count(),1);
   for(const key of ['hourly','nbmHourly','alerts'])for(const status of ['unavailable','saved','stale']){
    await p.evaluate(({key,status})=>{window.backupCheck={...feedChecks[key]};if(status==='saved')feedChecks[key].saved=true;else feedChecks[key].status=status;freshnessCheck();},{key,status});assert.equal(await p.locator('#nbmBriefNote').count(),0);
    await p.evaluate(key=>{feedChecks[key]=window.backupCheck;freshnessCheck();},key);assert.equal(await p.locator('#nbmBriefNote').count(),1);
   }
   await p.evaluate(()=>{window.oldIssued=feedChecks.hourly.issuedAt;feedChecks.hourly.issuedAt=Date.now()-13*3600000;freshnessCheck();});assert.equal(await p.locator('#nbmBriefNote').count(),0);
   await p.evaluate(()=>{feedChecks.hourly.issuedAt=window.oldIssued;freshnessCheck();});
   await model(p,payload([34,36,38]));assert.equal(await p.locator('#nbmBriefNote').count(),0,'Narrow noncrossing range');
   await model(p,payload([20,25,30]));assert.equal(await p.locator('#nbmBriefNote').count(),0,'Official forecast outside range');
   await model(p,payload([28,35,40]));
   // Real failed refresh removes only the optional sentence, even when the chart retains old data.
   await p.unroute(route);await p.route(route,r=>r.fulfill({status:503,json:{}}));await p.evaluate(()=>loadNbmHourly());assert.equal(await p.locator('#nbmBriefNote').count(),0);assert.equal(await p.locator('.nbm-hourly-band').count(),1);
   await model(p,payload([28,35,40]));
   await p.evaluate(()=>{NbmHourly.reset();});assert.equal(await p.locator('#nbmBriefNote').count(),0);await model(p,payload([28,35,40]));assert.equal(await p.locator('#nbmBriefNote').count(),0,'Model alone cannot pair with saved/unbound official hours');
   await p.evaluate(()=>loadForecast());assert.equal(await p.locator('#nbmBriefNote').count(),1);
   // Saved official HTML cannot authorize the note before the real delayed hourly fetch resolves.
   const nws=await p.evaluate(()=>{snapSafeSeq=locSeq;saveSnapshot();return {properties:{updateTime:new Date(feedChecks.hourly.issuedAt).toISOString(),periods:smart.hourlyAll}};});
   let releaseNws;const waitNws=new Promise(r=>releaseNws=r);await p.route('**/forecast/hourly',async r=>{await waitNws;await r.fulfill({json:nws});});
   await p.reload({waitUntil:'domcontentloaded'});await p.evaluate(()=>loadNbmHourly());assert.equal(await p.locator('#nbmBriefNote').count(),0);releaseNws();await p.waitForSelector('#nbmBriefNote');await p.unroute('**/forecast/hourly');
   // Late prior-location reply cannot repopulate the cleared note.
   let release;await p.unroute(route);await p.route(route,r=>new Promise(done=>{release=async()=>{await r.fulfill({json:payload([28,35,40])});done();};}));
   await Promise.all([p.waitForRequest(route),p.evaluate(()=>{window.pendingNote=loadNbmHourly();})]);
   await p.evaluate(()=>{locSeq++;current={...current,lat:39.4};NbmHourly.reset();});assert.equal(await p.locator('#nbmBriefNote').count(),0);await release();await p.evaluate(()=>window.pendingNote);assert.equal(await p.locator('#nbmBriefNote').count(),0);
   await model(p,payload([28,35,40]));assert.equal(await p.locator('#nbmBriefNote').count(),0,'Unsupported location');
  }
  assert.deepEqual(s.errors,[]);console.log('PASS controlled note',width,timezone);
 }finally{await s.context.close();}
 }
 const s=await open(config('Controlled warm threshold',{now,temp:86,rh:20,wind:'1 mph',aqi:35}),390);try{
  const p=s.page,before=await baseline(p);await model(p,payload([82,87,94]));assert.equal(await p.locator('#nbmBriefNote').count(),1);assert.match(await p.locator('#nbmBriefText').innerText(),/extends above 90°F/);assert.deepEqual(await baseline(p),before);
  await p.clock.setFixedTime(new Date(Date.parse(original.run)+24*H));await p.evaluate(()=>{['hourly','nbmHourly','alerts'].forEach(k=>feedChecks[k].successAt=Date.now());feedChecks.hourly.issuedAt=Date.now();freshnessCheck();});assert.equal(await p.locator('#nbmBriefNote').count(),0,'Source cycle expires even with new check times');
 }finally{await s.context.close();}
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
