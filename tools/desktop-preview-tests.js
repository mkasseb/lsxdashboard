#!/usr/bin/env node
'use strict';
// Read-only live preview evidence. The preceding hosted verifier proves all served app/data bytes.
// Keep the actual weather, timestamps and map layers, with default TLS and no response fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require('playwright');
const {planningGapGeometry,assertPlanningGap}=require('./planning-gap-contract');
const root=path.join(__dirname,'..'),out=process.argv[2]||'/tmp/desktop-hosted',sha=process.env.EXPECTED_SHA;
const audit={startedAt:new Date().toISOString(),commit:sha,tls:'Default certificate validation; no bypass',live:[],runtimeErrors:[],networkFailures:[]};
async function geometry(page){return page.evaluate(()=>{
 const ids=['h24Card','forecastCard','radarCard','riskCard','riversCard'];
 const boxes=Object.fromEntries(ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[id,{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}];}));
 return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,desktop:document.querySelector('.planning-grid').classList.contains('desktop-planning'),boxes,map:{width:radar.clientWidth,height:radar.clientHeight,size:rvMap&&[rvMap.getSize().x,rvMap.getSize().y]},primary:[...document.querySelectorAll('.planning-primary>.card')].map(e=>e.id),support:[...document.querySelectorAll('.planning-support>.card')].map(e=>e.id),mobile:[...document.querySelectorAll('.planning-grid>.card')].map(e=>e.id)};
});}
async function settled(page){
 await page.waitForFunction(()=>rvMap&&rvBase&&rvBase.getMaplibreMap().isStyleLoaded()&&radar.clientWidth===rvMap.getSize().x&&radar.clientHeight===rvMap.getSize().y,null,{timeout:60000});
 // Allow the real map's native resize and tile paint, without correcting its camera.
 await page.waitForTimeout(700);
}
function verifyGeometry(g){
 assert(g.scrollWidth<=g.width+1,'Page overflow '+JSON.stringify(g));
 assert.equal(g.desktop,g.width>1000);
 if(g.desktop){
  assert.deepEqual(g.primary,['h24Card','forecastCard']);assert.deepEqual(g.support,['radarCard','riskCard','riversCard']);
  const b=g.boxes;assert(Math.abs(b.h24Card.y-b.radarCard.y)<2);
  assert(Math.abs(b.h24Card.width/(b.h24Card.width+b.radarCard.width)-.6)<.01);
  assert(Math.abs(b.forecastCard.y-b.h24Card.bottom-18)<2);assert(Math.abs(b.forecastCard.x-b.h24Card.x)<2);
  assert(Math.abs(b.riskCard.y-b.radarCard.bottom-18)<2);assert(Math.abs(b.riversCard.y-b.riskCard.bottom-18)<2);
  assert(Math.abs(g.map.height-(g.width<=1240?350:380))<2);
 }else assert.deepEqual(g.mobile,['h24Card','radarCard','forecastCard']);
 assert.deepEqual(g.map.size,[g.map.width,g.map.height],'Map geometry follows its rendered viewport');
}
async function main(){
 assert(/^[a-f0-9]{40}$/.test(sha||''));assert.equal(cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sha);
 const verified=JSON.parse(fs.readFileSync(path.join(out,'..','verification.json'),'utf8'));
 assert.equal(verified.result,'passed');assert.equal(verified.commit,sha);assert.equal(verified.target,'preview');
 assert(verified.assets.length>=14,'Exact app and model byte verification required');
 const origin=verified.origin;assert(/^https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev$/.test(origin));
 audit.origin=origin;audit.assetEvidence='../verification.json';audit.assets=verified.assets;
 const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']}:{});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Chicago'}),page=await context.newPage();
 page.on('pageerror',e=>audit.runtimeErrors.push(e.message));
 page.on('requestfailed',r=>audit.networkFailures.push({url:r.url().split('?')[0],error:r.failure()?.errorText}));
 try{
  const response=await page.goto(origin+'/?desktop-preview='+sha,{waitUntil:'domcontentloaded',timeout:60000});assert(response.ok());
  await page.waitForFunction(()=>typeof refreshInFlight!=='undefined'&&refreshInFlight===null&&smart.days.length===7&&feedChecks.daily.status==='ready'&&feedChecks.hourly.status==='ready',null,{timeout:90000});
  await settled(page);
  await page.locator('#forecastCard').scrollIntoViewIfNeeded();await page.evaluate(()=>requestContext('context'));
  await page.waitForFunction(()=>['ready','partial','unavailable'].includes(feedChecks.context.status),null,{timeout:125000});
  await page.evaluate(()=>requestContext('stations'));await page.waitForFunction(()=>stnMap&&['ready','partial','unavailable'].includes(feedChecks.stations.status),null,{timeout:90000});
  await page.evaluate(()=>{window.previewCards=['h24Card','forecastCard','radarCard','riskCard','riversCard'].map(id=>document.getElementById(id));window.previewMap=rvMap;window.previewDays=JSON.stringify(smart.days);});
  for(const width of [1180,1440,1920,390,768,1000,1001]){
   await page.setViewportSize({width,height:1000});await settled(page);const g=await geometry(page);verifyGeometry(g);
   assert(await page.evaluate(()=>previewMap===rvMap&&previewCards.every(card=>card===document.getElementById(card.id))&&previewDays===JSON.stringify(smart.days)),'Responsive placement preserves actual cards, map and forecast');
   assert.equal(await page.locator('#daily .record-inline').count(),7);
   assert(await page.locator('.record-inline').evaluateAll(rows=>rows.every(e=>e.previousElementSibling.classList.contains('nbm-inline')||e.previousElementSibling.classList.contains('day'))),'Each record row stays beneath its own NBM or NWS row');
   const primary=await page.locator('#daily .day').allTextContents(),records=await page.locator('.record-inline').allTextContents();
   for(const theme of ['light','dark']){
    await page.evaluate(t=>applyTheme(t),theme);await settled(page);verifyGeometry(await geometry(page));
    if(width>1000)assertPlanningGap(await page.evaluate(planningGapGeometry));
    assert.deepEqual(await page.locator('#daily .day').allTextContents(),primary);assert.deepEqual(await page.locator('.record-inline').allTextContents(),records);
    if([1180,1440,1920,390,768].includes(width)){
     await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,`live-${width}-${theme}-page.png`),fullPage:true});
     if(width>1000)await page.locator('.planning-grid').screenshot({path:path.join(out,`live-${width}-${theme}-planning.png`),style:'.jump-wrap,.skip{visibility:hidden !important}'});
     await page.locator('#forecastCard').screenshot({path:path.join(out,`live-${width}-${theme}-week.png`),style:'.jump-wrap,.skip{visibility:hidden !important}'});
    }
   }
   audit.live.push({width,geometry:g,records,station:await page.locator('#forecastRecordStation').textContent(),checks:await page.evaluate(()=>Object.fromEntries(Object.entries(feedChecks).map(([key,value])=>[key,value.status]))),mapDiagnostics:await page.evaluate(()=>mapDiagnosticsText())});
  }
  await page.setViewportSize({width:1440,height:1000});await settled(page);
  audit.gapStates=[];
  async function checkGapState(state){await settled(page);const g=await page.evaluate(planningGapGeometry);audit.gapStates.push({state,...assertPlanningGap(g),geometry:g});await page.locator('.planning-grid').screenshot({path:path.join(out,'live-gap-'+state+'.png'),style:'.jump-wrap,.skip{visibility:hidden !important}'});}
  await checkGapState('loaded');
  await page.locator('#riskHelp > summary').click();await checkGapState('risk-expanded');
  const lastPin=page.locator('#rivers [data-pin-gauge]').last(),pinId=await lastPin.getAttribute('data-pin-gauge');await lastPin.scrollIntoViewIfNeeded();
  assert(await lastPin.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Lower river controls remain reachable through unused packing space');
  await lastPin.click();assert.equal(await page.locator(`[data-pin-gauge="${pinId}"]`).getAttribute('aria-pressed'),'true');await page.locator(`[data-pin-gauge="${pinId}"]`).click();
  await page.locator('#riskHelp > summary').click();
  for(const day of await page.locator('#daily .day').all())await day.click();await page.locator('#forecastRecordSource > summary').click();await checkGapState('forecast-expanded');
  for(const day of await page.locator('#daily .day').all())await day.click();await page.locator('#forecastRecordSource > summary').click();
  for(const toggle of await page.locator('.context-toggle').all())await toggle.click();await checkGapState('context-collapsed');
  for(const toggle of await page.locator('.context-toggle').all())await toggle.click();await checkGapState('context-expanded');
  const day=page.locator('#daily .day').first();await day.focus();await day.press('Enter');assert.equal(await day.getAttribute('aria-expanded'),'true');
  const risk=page.locator('#riskHelp > summary');await risk.focus();await risk.press('Enter');assert(await page.locator('#riskHelp').evaluate(e=>e.open));
  await page.setViewportSize({width:390,height:844});await settled(page);assert(await risk.evaluate(e=>e===document.activeElement));
  assert.equal(await day.getAttribute('aria-expanded'),'true');assert(await page.locator('#riskHelp').evaluate(e=>e.open));
  await page.setViewportSize({width:1440,height:1000});await settled(page);
  await page.locator('#hourlyOptions [data-hours="72"]').click();await page.locator('#hourlyCursor').focus();await page.locator('#hourlyCursor').press('ArrowRight');
  const selected=await page.evaluate(()=>renderHourly24._selectedTime);await page.setViewportSize({width:390,height:844});await settled(page);
  assert.equal(await page.evaluate(()=>renderHourly24._selectedTime),selected);assert.equal(await page.evaluate(()=>document.activeElement.id),'hourlyCursor');
  await page.setViewportSize({width:1440,height:1000});await settled(page);
  await page.locator('#rsFull').click();await settled(page);assert.equal(await page.locator('#radarCard').getAttribute('aria-modal'),'true');
  await page.setViewportSize({width:390,height:844});await settled(page);
  assert(await page.locator('header').evaluate(e=>e.inert));assert(await page.locator('#radarCard').evaluate(e=>!e.closest('[inert]')));
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>radarCard.contains(document.activeElement)));
  await page.screenshot({path:path.join(out,'live-fullscreen-mobile.png')});await page.keyboard.press('Escape');await settled(page);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'rsFull');assert(!(await page.locator('header').evaluate(e=>e.inert)));verifyGeometry(await geometry(page));
  await page.setViewportSize({width:1440,height:1000});await settled(page);verifyGeometry(await geometry(page));
  audit.interactions='Native daily/risk disclosures, hourly 72-hour slider and breakpoint focus, fullscreen resize/inert/Tab/Escape/focus passed';
  audit.sourceState=await page.evaluate(()=>({location:current,checkedAt:new Date().toISOString(),context:feedChecks.context,records:ctx.recordsByDate,forecastIssuedAt:feedChecks.daily.issuedAt,model:feedChecks.nbmRange,hourlyModel:feedChecks.nbmHourly}));
  assert.deepEqual(audit.runtimeErrors,[]);audit.result='passed';
 }finally{await context.close();await browser.close();}
}
fs.mkdirSync(out,{recursive:true});main().catch(e=>{audit.result='failed';audit.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>{
 audit.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(audit,null,2));
 console.log(JSON.stringify({result:audit.result,commit:sha,origin:audit.origin,widths:audit.live.map(x=>x.width),interactions:audit.interactions,context:audit.sourceState?.context}));
});
