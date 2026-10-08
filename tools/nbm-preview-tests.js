#!/usr/bin/env node
'use strict';
// Hosted preview only. Live browser checks use default TLS and unmodified network responses.
// Controlled edge cases run afterwards in a separate context and are labeled in the audit.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium,request}=require('playwright');
const root=path.join(__dirname,'..'),out=process.argv[2];
fs.mkdirSync(out,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const audit={startedAt:new Date().toISOString(),commit:process.env.EXPECTED_SHA,live:[],controlled:[],assets:[],runtimeErrors:[],networkFailures:[],httpErrors:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function preview(){
 if(process.env.PREVIEW_URL)return process.env.PREVIEW_URL;
 assert(/^[a-f0-9]{40}$/.test(audit.commit),'Expected full commit SHA');
 for(let i=0;i<24;i++){
  const r=await fetch('https://api.github.com/repos/mkasseb/lsxdashboard/commits/'+audit.commit+'/check-runs',{headers:{Accept:'application/vnd.github+json'}});
  assert(r.ok(),'Public deployment metadata HTTP '+r.status);
  const checks=(await r.json()).check_runs;
  const check=checks.find(c=>c.name==='Cloudflare Pages'&&c.conclusion==='success');
  const url=check?.output?.summary?.match(/https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev/);
  if(url)return url[0];
  await pause(10000);
 }
 throw Error('No successful immutable preview deployment for this exact commit');
}
async function shot(page,name){
 // Full-page captures preserve actual page navigation; card-only captures suppress only page chrome.
 await page.screenshot({path:path.join(out,name+'-page.png'),fullPage:true});
 await page.locator('#forecastCard').screenshot({path:path.join(out,name+'-forecast.png'),style:'.jump-wrap,.skip{visibility:hidden !important}'});
}
async function settled(page){
 await page.waitForFunction(()=>typeof feedChecks!=='undefined'&&['ready','partial','unavailable'].includes(feedChecks.daily?.status)&&feedChecks.nbmRange?.status!=='loading',null,{timeout:90000});
}
async function compare(page,data){
 const result=await page.evaluate(data=>{
  const r=NbmRange.validate(data,current,Date.now());
  const a=NbmRange.align(smart.days,r.periods||[],Date.now());
  return {location:{name:current.name,lat:current.lat,lon:current.lon},nwsStatus:feedChecks.daily.status,sourceAgeHours:(Date.now()-Date.parse(data.run))/3600000,status:r.status,cell:r.cell,official:smart.days,matches:a.matches.map(m=>({
   official:'NWS '+(m.part==='day'?'high ':'low ')+m.nws.temperature+'°F · '+NbmRange.local(m.nws.startTime)+' – '+NbmRange.local(m.nws.endTime),
   model:'NBM '+(m.part==='day'?'maximum':'minimum')+' · P10 '+Math.round(m.nbm.p10)+'°F · P50 '+Math.round(m.nbm.p50)+'°F · P90 '+Math.round(m.nbm.p90)+'°F',
   interval:(m.exact?'Same interval: ':'Different interval (18 hours): ')+NbmRange.local(m.nbm.start)+' – '+NbmRange.local(m.nbm.end)
  })),actual:Array.from(document.querySelectorAll('.nbm-comparison'),r=>({official:r.children[0].textContent,model:r.children[1].textContent,interval:r.children[2].textContent}))};
 },data);
 assert(['ready','partial'].includes(result.nwsStatus),'Live NWS forecast must load');
 assert.deepEqual(result.actual,result.matches,'Rendered comparison matches selected live NWS and native NBM windows');
 if(result.status==='ready'||result.status==='partial'){
  assert(result.matches.length>0,'Fresh model and NWS should have overlapping periods');
  assert((await page.locator('#nbmInfoBody').textContent()).includes(result.cell.lat.toFixed(3)+', '+result.cell.lon.toFixed(3)));
 }else{assert.equal(result.status,'stale');assert.equal(result.actual.length,0);assert.match(await page.locator('#nbmStatus').innerText(),/over 24 hours/);}
 delete result.actual;return result;
}
async function main(){
 const origin=await preview();assert(/^https:\/\/[a-z0-9-]+\.lsxdashboard2\.pages\.dev$/.test(origin));audit.origin=origin;
 const original='https://b832c786.lsxdashboard2.pages.dev';audit.originalPreview=original;
 const api=await request.newContext();let data;
 try{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const files=['index.html',...Array.from(html.matchAll(/(?:src|href)="\/?(assets\/[^"?]+)\?v=[a-f0-9]+/g),m=>m[1]),'data/nbm-range.json','data/nbm-receipt.json'];
  for(const verifiedOrigin of [origin,original])for(const file of [...new Set(files)]){
   const r=await api.get(verifiedOrigin+'/'+file);assert(r.ok(),file+' HTTP '+r.status());const bytes=await r.body();
   assert.equal(hash(bytes),hash(fs.readFileSync(path.join(root,file))),file+' differs from checkout');
   audit.assets.push({origin:verifiedOrigin,file,sha256:hash(bytes)});if(file==='data/nbm-range.json')data=JSON.parse(bytes);
  }
  assert.equal(hash(Buffer.from(JSON.stringify(data))),hash(Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'data/nbm-range.json')))))));
  const receipt=JSON.parse(fs.readFileSync(path.join(root,'data/nbm-receipt.json')));
  assert.equal(receipt.sha256,audit.assets.find(x=>x.file==='data/nbm-range.json').sha256);audit.receipt=receipt;
 }finally{await api.dispose();}
 const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
 try{
  // Also open the user's exact original immutable URL, whose app/data bytes match this checkout.
  const originalContext=await browser.newContext({viewport:{width:390,height:1000},timezoneId:'America/Chicago'});
  try{
   const p=await originalContext.newPage();p.on('pageerror',e=>audit.runtimeErrors.push({phase:'original-preview',message:e.message}));
   assert((await p.goto(original,{waitUntil:'domcontentloaded',timeout:60000})).ok());await settled(p);
   audit.live.push({origin:original,width:390,test:'Original requested preview real feeds',...await compare(p,data)});
   await shot(p,'original-preview-live-390');
  }finally{await originalContext.close();}
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},timezoneId:width===390?'America/Chicago':'Asia/Tokyo'});
   const page=await context.newPage();
   page.on('pageerror',e=>audit.runtimeErrors.push({phase:'live',width,message:e.message}));
   page.on('requestfailed',r=>audit.networkFailures.push({phase:'live',width,url:r.url().split('?')[0],error:r.failure()?.errorText}));
   page.on('response',r=>{if(r.status()>=400)audit.httpErrors.push({phase:'live',width,url:r.url().split('?')[0],status:r.status()});});
   try{
    const response=await page.goto(origin+'/?live-verification=1',{waitUntil:'domcontentloaded',timeout:60000});assert(response.ok());await settled(page);
    assert.equal(await page.locator('#nbmRangeCard').count(),0);assert.equal(await page.locator('#nbmInfo details').getAttribute('open'),null);
    const first=await compare(page,data);audit.live.push({width,test:'Initial real feeds',...first});
    const day=page.locator('#daily .day').first();await day.focus();await day.press('Enter');assert.equal(await day.getAttribute('aria-expanded'),'true');
    await day.press('Enter');assert.equal(await day.getAttribute('aria-expanded'),'false');await day.press('Enter');
    const summary=page.locator('#nbmInfo summary');await summary.focus();await summary.press('Enter');assert(await page.locator('#nbmInfo details').evaluate(e=>e.open));
    for(const theme of ['light','dark']){
     await page.evaluate(t=>applyTheme(t),theme);await pause(500);
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     await shot(page,'live-'+width+'-'+theme);
    }
    // Real location changes exercise the app's normal generation and cancellation paths.
    const town={name:'Belleville, IL',lat:38.52,lon:-89.98,precision:'representative',station:null};
    await page.evaluate(town=>{setLocation({...town,name:'Intermediate point',lat:38.7,lon:-90.3},{save:true});setLocation(town,{save:true});},town);
    await settled(page);const changed=await compare(page,data);assert.equal(changed.location.lat,town.lat);assert.equal(changed.location.lon,town.lon);
    audit.live.push({width,test:'Rapid real location changes',...changed});
    // Save and reload real browser storage. Delayed-source isolation is tested below with controlled responses.
    await page.waitForFunction(()=>snapSafeSeq===locSeq,null,{timeout:90000});
    const snapshot=await page.evaluate(()=>{saveSnapshot();return JSON.parse(localStorage.getItem(SNAP_KEY));});
    assert(snapshot.parts.daily);assert(!snapshot.parts.daily.includes('nbm-'));
    await page.reload({waitUntil:'domcontentloaded'});await settled(page);
    const reloaded=await compare(page,data);assert.equal(reloaded.location.lat,town.lat);audit.live.push({width,test:'Real saved reload',...reloaded});
    await page.evaluate(()=>setLocation({name:'Outside NBM coverage',lat:39.4,lon:-90.79,precision:'representative',station:null},{save:true}));
    await settled(page);assert.equal(await page.locator('.nbm-inline').count(),0);assert.match(await page.locator('#nbmStatus').innerText(),/Outside the supported/);
    await shot(page,'live-'+width+'-outside-coverage');audit.live.push({width,test:'Unsupported NBM location',status:await page.locator('#nbmStatus').innerText()});
   }finally{await context.close();}
  }
  // These are controlled browser edge cases on hosted code, never presented as observed live weather.
  const recorded=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-nws-pairing-recorded.json')));
  const pointData=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-qmd-recorded.json')));
  const context=await browser.newContext({viewport:{width:390,height:1000},timezoneId:'America/Chicago'}),page=await context.newPage();
  try{
   await page.clock.install({time:new Date(recorded.retrievedAt)});
   await page.route('**/forecast',r=>r.fulfill({json:recorded.forecast}));
   let payload=pointData;
   await page.route('**/data/nbm-range.json',r=>r.fulfill({json:payload}));
   await page.goto(origin+'/?controlled-verification=1',{waitUntil:'domcontentloaded'});await settled(page);
   // Explicitly bind the recorded point, without changing the hosted source files.
   await page.evaluate(f=>{locSeq++;current={...current,lat:38.8,lon:-90.79};resetLocationState();clearLocationUI();renderDailyForecast(f,null);},recorded.forecast);
   payload=structuredClone(pointData);payload.periods.filter(p=>p.kind==='TMAX').forEach(p=>{p.p10=p.p50=p.p90=0;p.members.forEach(m=>{m.kelvin=(0-32)*5/9+273.15;m.fahrenheit=0;});});
   const zero=structuredClone(recorded.forecast);zero.properties.periods.find(p=>p.isDaytime).temperature=0;
   await page.evaluate(async f=>{renderDailyForecast(f,null);await loadNbmRange();},zero);
   assert.match(await page.locator('#daily').textContent(),/NWS high 0°F/);assert.match(await page.locator('#daily').textContent(),/P50 0°F/);audit.controlled.push('Valid 0°F values retained, with consistent Kelvin conversion');
   payload={};await page.evaluate(()=>loadNbmRange());assert.equal(await page.locator('.nbm-inline').count(),0);assert.match(await page.locator('#nbmStatus').innerText(),/failed validation/);audit.controlled.push('Malformed/missing data withheld');
   payload=pointData;await page.clock.setFixedTime(new Date(Date.parse(pointData.run)+25*3600000));await page.evaluate(()=>loadNbmRange());assert.equal(await page.locator('.nbm-inline').count(),0);assert.match(await page.locator('#nbmStatus').innerText(),/over 24 hours/);audit.controlled.push('25-hour source cycle withheld');
   await shot(page,'controlled-stale-390');
   await page.clock.setFixedTime(new Date(recorded.retrievedAt));
   await page.evaluate(async f=>{renderDailyForecast(f,null);feedUpdate('daily','ready',f.properties.updateTime);await loadNbmRange();snapSafeSeq=locSeq;saveSnapshot();},recorded.forecast);
   await page.unroute('**/forecast');
   let resumeForecast;const hold=new Promise(resolve=>{resumeForecast=resolve;});
   await page.route('**/forecast',async r=>{await hold;await r.fulfill({json:recorded.forecast});});
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>typeof snapRestored!=='undefined'&&snapRestored);
   await page.evaluate(()=>loadNbmRange());
   assert((await page.locator('#daily .day-item').count())>0);assert.equal(await page.locator('.nbm-inline').count(),0);
   resumeForecast();await page.waitForFunction(()=>document.querySelectorAll('.nbm-inline').length>0);
   audit.controlled.push('Saved official rows cannot pair until the delayed current NWS response arrives');
  }finally{await context.close();}
 }finally{await browser.close();}
 assert.deepEqual(audit.runtimeErrors,[],'Live page JavaScript errors');audit.status='passed';
}
main().catch(e=>{audit.status='failed';audit.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>{audit.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'live-preview-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify({status:audit.status,origin:audit.origin,commit:audit.commit,liveChecks:audit.live.length,controlledChecks:audit.controlled.length,runtimeErrors:audit.runtimeErrors.length,httpErrors:audit.httpErrors.length,networkFailures:audit.networkFailures.length}));});
