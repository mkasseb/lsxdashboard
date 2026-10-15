#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-point-recorded.json')));
const regional=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-daily-short-recorded.json.gz'))));
const capture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-nws-recorded.json'))),now=Date.parse(capture.retrievedAt);
const full=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-daily-recorded.json.gz'))));
const fullCapture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-nws-recorded.json')));
const modelRoute='**/data/nbm-range.json';
async function nws(page,f=capture.forecast){await page.evaluate(f=>{renderDailyForecast(f,null);feedUpdate('daily','ready',f.properties.updateTime);},f);}
async function model(page,data=regional){await page.unroute(modelRoute);await page.route(modelRoute,r=>r.fulfill({json:data}));await page.evaluate(()=>loadNbmRange());}
async function primary(page){return page.evaluate(()=>({days:JSON.stringify(smart.days),call:document.getElementById('callCard').innerText,rows:Array.from(document.querySelectorAll('#daily .day'),x=>x.textContent),detail:Array.from(document.querySelectorAll('#daily .dd-text'),x=>x.textContent)}));}
async function expandDay(page,index=0){const day=page.locator('#daily .day').nth(index);if(await day.getAttribute('aria-expanded')!=='true')await day.click();}
async function expandTiming(page,index=0){await expandDay(page,index);const timing=page.locator('.nbm-timing').nth(index),summary=timing.locator('summary');await summary.focus();if(!await timing.evaluate(e=>e.open))await summary.press('Enter');}
async function main(){
 const engine=process.env.WEATHER_BROWSER||'chromium';
 const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}: {})});setBrowser(browser);
 try{
  for(const width of [320,390,1440])for(const timezone of ['America/Chicago','Asia/Tokyo']){
   const s=await open(config('Recorded authentic NWS and NBM',{now,timezone}),width),p=s.page;
   try{
    assert.equal(await p.locator('#nbmRangeCard').count(),0);
    assert.equal(await p.locator('#nbmInfo details').getAttribute('open'),null);
    await nws(p);const before=await primary(p);await model(p);
    assert.deepEqual(await primary(p),before,'NBM never changes official values/text or risk decisions');
    assert.equal(await p.locator('.nbm-inline').count(),3);assert.equal(await p.locator('.nbm-comparison').count(),5);
    assert.deepEqual(await p.locator('.nbm-inline .nbm-label').allTextContents(),Array(3).fill('NBM model range'));
    assert.equal(await p.locator('.nbm-inline .nbm-window-note').count(),0);
    assert.equal(await p.locator('#nbmWindowHelp').count(),1);
    assert.match(await p.locator('#nbmWindowHelp').innerText(),/18-hour windows/);
    const day=p.locator('#daily .day').first();await day.focus();await day.press('Enter');
    assert.equal(await day.getAttribute('aria-expanded'),'true');
    const timing=p.locator('.nbm-timing').first(),timingSummary=timing.locator('summary');
    assert.match(await p.locator('.nbm-period-detail').first().innerText(),/middle 50%.*Higher or lower outcomes remain possible/);
    assert.match(await p.locator('.nbm-period-detail').first().innerText(),/different 18-hour periods/);
    assert(!/P25|P50|P75|NWS high|CDT/.test(await p.locator('.nbm-period-detail').first().innerText()),'Technical comparison stays hidden initially');
    assert.equal(await p.locator('.nbm-comparison').first().isVisible(),false);
    assert.equal(await p.locator('.nbm-period-detail h3').count(),0,'No redundant temperature guidance heading');
    for(const theme of ['dark','light']){
     await p.evaluate(t=>{applyTheme(t);layoutMasonry();},theme);await p.clock.runFor(500);
     assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     if(process.env.NBM_ARTIFACTS){fs.mkdirSync(process.env.NBM_ARTIFACTS,{recursive:true});await p.locator('#forecastCard').screenshot({style:'.jump-wrap,.skip{visibility:hidden !important}',path:path.join(process.env.NBM_ARTIFACTS,`recorded-simple-${width}-${timezone.replace('/','-')}-${theme}.png`)});}
    }
    await p.evaluate(()=>loadNbmRange());
    assert.equal(await day.getAttribute('aria-expanded'),'true');assert(await day.evaluate(e=>e===document.activeElement));
    await p.evaluate(()=>loadForecast._paint());assert.equal(await p.locator('#daily .day').first().getAttribute('aria-expanded'),'true');
    assert(await p.locator('#daily .day').first().evaluate(e=>e===document.activeElement));
    await timingSummary.focus();await timingSummary.press('Enter');
    assert(await timing.evaluate(e=>e.open));assert(await p.locator('.nbm-comparison').first().isVisible());
    assert.match(await timing.innerText(),/NWS high.*Oct 9.*CDT/);
    assert.match(await timing.innerText(),/Different interval \(18 hours\).*Oct 10, 1:00 AM CDT/);
    assert.match(await timing.innerText(),/median \(P50\)/);
    await model(p);assert(await timing.evaluate(e=>e.open));assert(await timingSummary.evaluate(e=>e===document.activeElement));
    await p.evaluate(()=>loadForecast._paint());assert(await timing.evaluate(e=>e.open));assert(await timingSummary.evaluate(e=>e===document.activeElement));
    await timingSummary.press('Space');assert.equal(await timing.evaluate(e=>e.open),false);
    assert.equal(await p.locator('.nbm-comparison').first().isVisible(),false);
    await timingSummary.press('Enter');
    const summary=p.locator('#nbmInfo summary');await summary.focus();await summary.press('Enter');
    assert.match(await p.locator('#nbmInfoBody').innerText(),/P25 to P75, the middle 50%.*25%.*25% above.*outside remain possible/);
    await p.evaluate(()=>loadNbmRange());assert(await summary.evaluate(e=>e===document.activeElement));
    assert.match(await p.locator('#nbmInfoBody').innerText(),/Unpaired model windows/);
    assert.equal(await p.locator('#nbmInfoBody li').count(),1);
    await p.evaluate(()=>{snapSafeSeq=locSeq;saveSnapshot();});
    const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem(SNAP_KEY)).parts.daily);
    assert(saved.includes('day-item'));assert(!saved.includes('nbm-'),'NBM never enters NWS saved HTML');
    for(const theme of ['dark','light']){
     await p.evaluate(t=>{applyTheme(t);layoutMasonry();},theme);await p.clock.runFor(500);
     assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     if(process.env.NBM_ARTIFACTS){fs.mkdirSync(process.env.NBM_ARTIFACTS,{recursive:true});await p.locator('#forecastCard').screenshot({style:'.jump-wrap,.skip{visibility:hidden !important}',path:path.join(process.env.NBM_ARTIFACTS,`recorded-inline-${width}-${timezone.replace('/','-')}-${theme}.png`)});}
    }
    await p.evaluate(()=>{document.documentElement.style.fontSize='200%';layoutMasonry();});await p.clock.runFor(500);
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await p.evaluate(()=>{document.documentElement.style.fontSize='';layoutMasonry();});
    // A real reload can show saved official HTML, but must wait for new NWS before pairing.
    let releaseForecast;
    const forecastHeld=new Promise(resolve=>{releaseForecast=resolve;});
    await p.route('**/forecast',async r=>{await forecastHeld;await r.fulfill({json:capture.forecast});});
    await p.reload({waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>typeof snapRestored!=='undefined'&&snapRestored);
    await model(p);
    assert((await p.locator('#daily .day-item').count())>0,'Saved NWS rows restore');
    assert.equal(await p.locator('.nbm-inline').count(),0,'Saved HTML cannot create a current comparison');
    releaseForecast();
    await p.waitForFunction(()=>document.querySelectorAll('.nbm-inline').length===3);
    await p.waitForFunction(()=>refreshInFlight===null&&snapSafeSeq===locSeq);
    await p.unroute('**/forecast');
    // Both official and model zero values remain actual values, not unavailable placeholders.
    const zeroNws=structuredClone(capture.forecast);zeroNws.properties.periods.find(x=>x.isDaytime).temperature=0;
    const zeroModel=structuredClone(fixture);zeroModel.periods.filter(x=>x.kind==='TMAX').forEach(x=>{x.p25=x.p50=x.p75=0;x.members.forEach(m=>{m.kelvin=(0-32)*5/9+273.15;m.fahrenheit=0;});});
    await nws(p,zeroNws);await model(p,zeroModel);
    assert.match(await p.locator('.nbm-inline').first().innerText(),/High 0–0°F/);
    assert.match(await p.locator('.nbm-period-detail').first().textContent(),/NWS high 0°F/);
    assert.match(await p.locator('.nbm-period-detail').first().textContent(),/median \(P50\) 0°F/);
    // A single missing native side is explicit; it cannot erase the other valid side.
    const partial=structuredClone(fixture);partial.periods=partial.periods.filter(x=>x.kind!=='TMIN');partial.missingHours=[24];
    await nws(p);await model(p,partial);await expandDay(p);
    assert.match(await p.locator('.nbm-inline').first().innerText(),/High [\s\S]*Low unavailable/);
    assert.match(await p.locator('.nbm-period-detail').first().textContent(),/Low model range unavailable/);
    assert.equal(await p.locator('.nbm-comparison .nbm-official').filter({hasText:'NWS low'}).count(),0);
    // Exact and mixed intervals use the actual align() result for the visible period note.
    const exact=structuredClone(capture.forecast);
    for(const n of exact.properties.periods){const m=fixture.periods.find(x=>x.kind===(n.isDaytime?'TMAX':'TMIN')&&Math.abs(Date.parse(x.start)-Date.parse(n.startTime))<2*3600000);if(m){n.startTime=m.start;n.endTime=m.end;}}
    await nws(p,exact);await model(p,fixture);await expandDay(p);
    assert.equal(await p.locator('.nbm-period-note').count(),0,'Identical intervals do not claim a mismatch');
    assert.match(await p.locator('.nbm-window-note').first().textContent(),/Same interval/);
    exact.properties.periods.find(x=>!x.isDaytime).endTime=capture.forecast.properties.periods.find(x=>!x.isDaytime).endTime;
    await nws(p,exact);
    assert.match(await p.locator('.nbm-period-note').first().textContent(),/Some NBM periods differ/);
    await nws(p);await model(p);
    // State follows a surviving calendar date when its row moves, never the index.
    await expandTiming(p,1);
    const second=p.locator('.nbm-timing').nth(1);
    const movedDate=await second.getAttribute('data-nbm-date'),shifted=structuredClone(capture.forecast);shifted.properties.periods=shifted.properties.periods.slice(2);
    await nws(p,shifted);
    assert.equal(await p.locator('.nbm-timing').first().getAttribute('data-nbm-date'),movedDate);
    assert(await p.locator('.nbm-timing').first().evaluate(e=>e.open));assert(await p.locator('.nbm-timing summary').first().evaluate(e=>e===document.activeElement));
    await nws(p);await model(p);
    // Losing a focused model window returns focus to the surviving NWS day button.
    await expandTiming(p);
    await model(p,{...fixture,run:'2000-01-01T00:00:00Z'});
    assert.equal(await p.locator('.nbm-timing').count(),0);assert(await p.locator('#daily .day').first().evaluate(e=>e===document.activeElement));
    assert.match(await p.locator('.nbm-range-note').first().innerText(),/unavailable/);
    await model(p);assert.equal(await timing.evaluate(e=>e.open),true,'A transient model outage retains view preference for the same NWS intervals');
    // Model before official periods: unpaired until an independently loaded forecast arrives.
    await p.evaluate(()=>{NbmRange.forecast([]);document.getElementById('daily').innerHTML='';});await model(p);
    assert.equal(await p.locator('.nbm-inline').count(),0);assert.equal(await p.locator('#nbmInfoBody li').count(),6);
    await nws(p);assert.equal(await p.locator('.nbm-inline').count(),3);
    // Missing official forecast cannot leave an old comparison attached.
    await p.route('**/forecast',r=>r.fulfill({status:503,json:{}}));await p.evaluate(()=>loadForecast());
    assert.equal(await p.locator('.nbm-inline').count(),0);assert.match(await p.locator('#daily').innerText(),/Forecast unavailable/);
    await p.unroute('**/forecast');await nws(p);
    // Newest same-location response wins; an older valid response cannot restore stale success.
    let release;await p.unroute(modelRoute);await p.route(modelRoute,r=>new Promise(resolve=>{release=async()=>{await r.fulfill({json:regional});resolve();};}));
    await Promise.all([p.waitForRequest(modelRoute),p.evaluate(()=>{window.nbmPending=loadNbmRange();})]);
    while(!release)await new Promise(r=>setTimeout(r,5));
    await p.route(modelRoute,r=>r.fulfill({status:503,json:{}}));await p.evaluate(()=>loadNbmRange());
    await release();await p.evaluate(()=>window.nbmPending);assert.equal(await p.locator('.nbm-inline').count(),0);
    assert.match(await p.locator('#nbmStatus').innerText(),/unavailable/);
    // Location generation reset clears both sources; previous-location responses cannot repaint.
    release=null;await p.unroute(modelRoute);await p.route(modelRoute,r=>new Promise(resolve=>{release=async()=>{await r.fulfill({json:regional});resolve();};}));
    await Promise.all([p.waitForRequest(modelRoute),p.evaluate(()=>{window.nbmPending=loadNbmRange();})]);
    while(!release)await new Promise(r=>setTimeout(r,5));
    await p.evaluate(()=>{locSeq++;current={...current,lat:40};resetLocationState();clearLocationUI();});
    await release();await p.evaluate(()=>window.nbmPending);assert.equal(await p.locator('.nbm-inline').count(),0);
    await model(p);assert.match(await p.locator('#nbmStatus').innerText(),/Outside the supported/);
    await p.evaluate(()=>{locSeq++;current={...current,lat:38.8};resetLocationState();clearLocationUI();});await nws(p);await model(p);
    await p.clock.setFixedTime(new Date(Date.parse(regional.run)+25*3600000));await p.evaluate(()=>loadForecast._paint());
    assert.equal(await p.locator('.nbm-inline').count(),0);assert.match(await p.locator('#nbmStatus').innerText(),/24 hours old/);
    // Authentic full horizon: seven rows, including the final issued night, without repeated prompts.
    await p.clock.setFixedTime(new Date(Math.max(Date.parse(full.retrievedAt),Date.parse(fullCapture.retrievedAt))));
    await nws(p,fullCapture.forecast);const officialFull=await primary(p);await model(p,full);
    assert.deepEqual(await primary(p),officialFull);
    assert.equal(await p.locator('.nbm-inline').count(),7);assert.equal(await p.locator('.nbm-comparison').count(),14);
    assert.equal(await p.locator('.nbm-inline .nbm-window-note').count(),0);
    const last=p.locator('#daily .day').last();await last.focus();await last.press('Enter');
    assert.equal(await p.locator('.nbm-timing').last().evaluate(e=>e.open),false,'New dates/location do not inherit a previous disclosure');
    await p.locator('.nbm-timing summary').last().focus();await p.locator('.nbm-timing summary').last().press('Enter');
    assert.match(await p.locator('.nbm-timing').last().innerText(),/Different interval \(18 hours\)/);
    await last.focus();
    await last.press('Enter');assert.equal(await last.getAttribute('aria-expanded'),'false');
    for(const theme of ['dark','light']){
     await p.evaluate(t=>{applyTheme(t);layoutMasonry();},theme);await p.clock.runFor(500);
     assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     if(process.env.NBM_ARTIFACTS)await p.locator('#forecastCard').screenshot({style:'.jump-wrap,.skip{visibility:hidden !important}',path:path.join(process.env.NBM_ARTIFACTS,`recorded-full-${width}-${timezone.replace('/','-')}-${theme}.png`)});
    }
    assert.deepEqual(s.errors,[]);console.log('PASS inline NBM '+width+' '+timezone);
   }finally{await s.context.close();}
  }
  const s=await open(config('NBM opt-out',{now,search:'?nbm=0'}),390);
  assert.equal(await s.page.locator('#nbmInfo,.nbm-inline,#nbmRangeCard').count(),0);
  assert.equal(await s.page.evaluate(()=>Object.hasOwn(FEEDS,'nbmRange')),false);await s.context.close();
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
