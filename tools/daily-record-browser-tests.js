#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests'),fixture=require('./fixtures/weather/daily-records-recorded.json');
// Replay the captured model and its real retrieval clock; later publications must not
// turn this deterministic records/placement test into a future or expired NBM check.
const model=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-daily-records-20261011-recorded.json.gz'))));
const now=Date.parse(model.retrievedAt),out=process.env.RECORD_ARTIFACTS;
const normals=require('./fixtures/weather/daily-normals-recorded.json'),normalReplay=normals.requests.find(r=>r.window==='records-replay').payload;
const normalExpected=[[72,47],[71,47],[71,46],[70,46],[70,46],[70,45],[69,45]];
const expected=[[94,30],[88,31],[89,33],[89,30],[89,30],[89,32],[91,29]];
const params=r=>JSON.parse(new URLSearchParams(r.postData()||'').get('params')||'{}');
async function primary(p){return p.evaluate(()=>({days:JSON.stringify(smart.days),rows:[...document.querySelectorAll('#daily .day')].map(x=>x.textContent),nbm:[...document.querySelectorAll('.nbm-inline')].map(x=>x.textContent),brief:document.getElementById('callRow').textContent}));}
async function main(){
 const engine=process.env.WEATHER_BROWSER||'chromium',browser=await playwright[engine].launch({...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{} )});setBrowser(browser);
 try{
  for(const width of [320,390,1440])for(const timezone of ['America/Chicago','Asia/Tokyo']){
   const session=await open(config('Recorded calendar-date station records',{now,timezone}),width),p=session.page,control={},calls=[];let release;
   try{
    await p.route('**/data.rcc-acis.org/**',async route=>{
     const q=params(route.request());calls.push(q);
     const sample=fixture.records.KSTL['10-11'].response.meta;
     if(route.request().url().endsWith('/StnMeta'))return route.fulfill({json:{meta:[sample,{...normalReplay.meta,valid_daterange:Array(3).fill(['1991-01-01','2026-10-10'])}]}});
     if(q.elems?.[0]?.normal){
      assert.equal(q.sid,'SUS');assert.equal(q.elems[0].normal,'91');assert.equal(q.elems[0].prec,1);assert.deepEqual(q.meta,['name','sids','ll']);
      if(control.normalHang)await new Promise(r=>{release=r;});
      if(control.normalFail)return route.fulfill({status:503,json:{error:'Controlled normal outage'}});
      const response=structuredClone(normalReplay);response.data=response.data.filter(r=>r[0]>=q.sdate&&r[0]<=q.edate);
      if(control.normalLowMissing)response.data[0][2]='M';
      if(control.normalWrongStation)response.meta=sample;
      return route.fulfill({json:response}).catch(()=>{});
     }
     if(Array.isArray(q.elems?.[0]?.interval)){
      const md=q.sdate.slice(5);
      if(md===control.hang)await new Promise(r=>{release=r;});
      if(md===control.fail)return route.fulfill({status:503,json:{error:'Controlled date outage'}}).catch(()=>{});
      const response=structuredClone(fixture.records.KSTL[md]?.response||{error:'Date outside captured fixture'});
      if(control.lowMissing===md)response.data.forEach(r=>{r[2]='M';});
      if(control.wrongStation)response.meta=fixture.records.KCOU['10-11'].response.meta;
      return route.fulfill({json:response}).catch(()=>{});
     }
     return route.fulfill({json:{data:[]}}); // Ancillary climate unavailable; records remain independent.
    });
    await p.route('**/data/nbm-range.json',r=>r.fulfill({json:model}));
    await p.evaluate(f=>{
     stopSchedule();_climStationCache={};_deepCache={};localStorage.removeItem(CTX_KEY);deferredFeeds.context=false;
     renderDailyForecast(f,null);feedUpdate('daily','ready',f.properties.updateTime);
    },fixture.forecast);
    await p.evaluate(()=>loadClimateContext());await p.evaluate(()=>loadNbmRange());
    assert.equal(await p.locator('#daily .day-item').count(),7);assert.equal(await p.locator('.normal-inline').count(),7);assert.equal(await p.locator('.record-inline').count(),0);assert.equal(await p.locator('.nbm-inline').count(),7);
    assert.match(await p.locator('#forecastRecordStation').textContent(),/St Louis Lambert.*KSTL.*since 1930/);
    assert(await p.locator('.normal-inline').evaluateAll(lines=>lines.every(line=>line.previousElementSibling.classList.contains('nbm-inline'))),'Every normal row is directly below its NBM range');
    for(let i=0;i<7;i++){
     assert.match(await p.locator('.normal-inline').nth(i).textContent(),new RegExp(`High ${normalExpected[i][0]}°.*Low ${normalExpected[i][1]}°`,'s'));
     assert.match(await p.locator('.record-detail').nth(i).textContent(),new RegExp(`Highest daily high: ${expected[i][0]}°F.*Lowest daily low: ${expected[i][1]}°F`,'s'));
    }
    assert.match(await p.locator('#forecastNormalStation').textContent(),/Spirit.*KSUS.*1991–2020/);
    assert.match(await p.locator('.normal-detail').first().textContent(),/71\.6°F.*46\.9°F.*1991–2020.*SPIRIT.*KSUS/s);
    assert.equal(await p.locator('.normal-comparison').count(),7);assert.match(await p.locator('.normal-comparison').first().textContent(),/vs Normal \(72°\/47°\)/);
    assert.match(await p.locator('.record-detail').nth(1).textContent(),/1947, 2024/);
    const official=await primary(p),day=p.locator('#daily .day').nth(1);await day.focus();await day.press('Enter');
    assert.match(await p.locator('.record-detail').nth(1).textContent(),/1947, 2024/);
    assert.match(await p.locator('.record-detail').nth(1).textContent(),/Oct 12, 6 PM.*Oct 13, 6 AM.*following morning/s);
    assert(await day.evaluate(e=>e===document.activeElement));
    const count=calls.length,checked=await p.evaluate(()=>ctx.recordsByDate['2026-10-11'].checkedAt);
    await p.evaluate(()=>loadClimateContext());assert.equal(calls.length,count);assert.equal(await p.evaluate(()=>ctx.recordsByDate['2026-10-11'].checkedAt),checked);
    assert.equal(await day.getAttribute('aria-expanded'),'true');assert(await day.evaluate(e=>e===document.activeElement));
    const summary=p.locator('#forecastRecordSource > summary');await summary.focus();await summary.press('Enter');
    assert((await summary.boundingBox()).height>=44);assert.match(await p.locator('#forecastRecordSourceBody').textContent(),/1930-01-01 to 2026-10-10/);
    assert.equal(await p.locator('#forecastRecordSourceBody li').count(),7);assert.match(await p.locator('#forecastRecordSourceBody').textContent(),/exact GPS point.*separate from NWS area/s);
    await p.evaluate(()=>freshnessCheck());assert(await summary.evaluate(e=>e===document.activeElement));
    await summary.press('Enter');await day.press('Enter');
    // A new issued tail reuses checked facts and preserves their visible freshness label.
    await p.clock.setFixedTime(new Date(now+3600000));
    const oldLabel=await p.locator('#fresh-context').textContent();
    await p.evaluate(async()=>{smart.days.push({day:{startTime:'2026-10-18T06:00:00-05:00'}});smart.days=smart.days.slice(1);await loadClimateContext();});
    assert.equal(await p.locator('#fresh-context').textContent(),oldLabel,'Extending the date set cannot renew the visible cache timestamp');
    await p.clock.setFixedTime(new Date(100+await p.evaluate(()=>Math.max(...Object.values(ctx.recordsByDate).map(r=>r.checkedAt)))));
    await p.evaluate(f=>{deferredFeeds.context=false;renderDailyForecast(f,null);},fixture.forecast);
    // New dates have not changed any of the seven previously verified record clocks.
    assert.equal(await p.evaluate(()=>ctx.recordsByDate['2026-10-11'].checkedAt),checked);
    const alternate=structuredClone(fixture.forecast);alternate.properties.periods[0].startTime=alternate.properties.periods[0].startTime.replace('T','t');
    await p.evaluate(f=>renderDailyForecast(validatedForecast(f,Date.now()),null),alternate);
    assert.equal(await p.locator('#daily .day-item').count(),7,'An accepted alternate timestamp cannot make optional records blank NWS');
    assert.match(await p.locator('.record-detail').first().textContent(),/Highest daily high: 94°/);assert.match(await p.locator('.record-detail').nth(1).textContent(),/Highest daily high: 88°/);
    await p.evaluate(f=>renderDailyForecast(f,null),fixture.forecast);
    for(const theme of ['dark','light']){
     await p.evaluate(t=>{applyTheme(t);layoutMasonry();},theme);await p.clock.runFor(500);
     assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     assert(await p.locator('#daily .day').evaluateAll(rows=>rows.every(row=>row.getBoundingClientRect().height>=44)));
     assert(await p.locator('#daily .dnd').evaluateAll(dates=>dates.length===7&&dates.every(date=>date.getBoundingClientRect().height>0)),'Each visible row keeps its calendar date, including holidays on phones');
     if(out){fs.mkdirSync(out,{recursive:true});await p.locator('#forecastCard').screenshot({path:path.join(out,`records-${width}-${timezone.replace('/','-')}-${theme}.png`),style:'.jump-wrap,.skip{visibility:hidden !important}'});}
    }
    await p.evaluate(()=>{document.documentElement.style.fontSize='200%';layoutMasonry();});await p.clock.runFor(500);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.evaluate(()=>{document.documentElement.style.fontSize='';layoutMasonry();});
    await p.evaluate(()=>{
     document.querySelector('#daily .dd-grid').insertAdjacentHTML('beforeend','<div class="dd-item"><div class="k">vs Normal (999°/888°)</div><div class="v">+777°</div></div>');
     snapSafeSeq=locSeq;saveSnapshot();
    });
    const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem(SNAP_KEY)).parts.daily);assert(!/record-inline|record-detail|normal-inline|normal-detail|normal-comparison|vs Normal|nbm-/.test(saved),'Supplemental and legacy comparison values cannot enter saved NWS HTML');
    const legacy=await p.evaluate(()=>{
     const days=smart.days;smart.days=[];renderForecastRecords();
     const stale=[...document.querySelectorAll('#daily .dd-item')].filter(e=>e.textContent.includes('999°')).length;
     smart.days=days;renderForecastRecords(true);return stale;
    });assert.equal(legacy,0,'Old untagged comparisons retire even before restored NWS rows have smart.days');
    control.fail='10-14';await p.evaluate(()=>{localStorage.removeItem(CTX_KEY);return loadClimateContext();});
    assert.match(await p.locator('.record-detail').nth(3).textContent(),/Daily records for Oct 14.*Highest daily high: unavailable/s);assert.match(await p.locator('.record-detail').nth(2).textContent(),/Highest daily high: 89°/);
    assert.equal(await p.evaluate(()=>feedChecks.context.status),'partial');assert.deepEqual(await primary(p),official,'A failed record date leaves NWS/NBM and briefing unchanged');
    delete control.fail;control.lowMissing='10-15';await p.evaluate(()=>{localStorage.removeItem(CTX_KEY);return loadClimateContext();});
    assert.match(await p.locator('.record-detail').nth(4).textContent(),/Highest daily high: 89°.*Lowest daily low: unavailable/s);delete control.lowMissing;
    control.wrongStation=true;await p.evaluate(()=>{localStorage.removeItem(CTX_KEY);return loadClimateContext();});
    assert.equal(await p.locator('.record-detail b').count(),0,'A response for another station cannot produce records');assert.equal(await p.locator('.normal-inline b').count(),14,'Record failures leave normals available');assert.deepEqual(await primary(p),official);delete control.wrongStation;
    // Normal outages, missing sides and mismatched stations stay separate from records/NBM.
    for(const controlKey of ['normalFail','normalLowMissing','normalWrongStation']){
     control[controlKey]=true;await p.evaluate(()=>{localStorage.removeItem(CTX_KEY);return loadClimateContext();});
     const line=p.locator('.normal-inline').first();
     if(controlKey==='normalLowMissing')assert.match(await line.textContent(),/High 72°.*Low unavailable/s);
     else {assert.equal(await p.locator('.normal-inline b').count(),0);assert.equal(await p.locator('.normal-comparison').count(),0);assert.match(await line.textContent(),/normals unavailable/);}
     assert.equal(await p.locator('.record-detail b').count(),14);assert.deepEqual(await primary(p),official);delete control[controlKey];
    }
    control.normalHang=true;release=null;
    await p.evaluate(()=>{
     localStorage.removeItem(CTX_KEY);window.normalRecordSettled=0;window.normalPostOriginal=acisPost;
     acisPost=function(endpoint,q){return normalPostOriginal(endpoint,q).then(value=>{if(Array.isArray(q.elems[0].interval))normalRecordSettled++;return value;});};
     window.normalJob=loadClimateContext();
    });while(!release)await new Promise(r=>setTimeout(r,5));
    // Settle the independently successful record requests before advancing the virtual
    // deadline; advancing earlier would expire their intercepted responses too.
    await p.waitForFunction(()=>normalRecordSettled===7);
    assert.deepEqual(await primary(p),official);await p.clock.runFor(20001);await p.evaluate(()=>window.normalJob);
    release();delete control.normalHang;await p.evaluate(()=>{acisPost=normalPostOriginal;});assert.equal(await p.locator('.normal-inline b').count(),0);assert.equal(await p.locator('.record-detail b').count(),14);assert.deepEqual(await primary(p),official,'Normal timeout leaves NWS/NBM and records intact');
    // The real request deadline is independent of the forecast and model loaders.
    control.hang='10-14';release=null;
    await p.evaluate(()=>{localStorage.removeItem(CTX_KEY);window.recordJob=loadClimateContext();});
    while(!release)await new Promise(r=>setTimeout(r,5));
    assert.deepEqual(await primary(p),official);await p.clock.runFor(20001);await p.evaluate(()=>window.recordJob);
    release();delete control.hang;assert.match(await p.locator('.record-detail').nth(3).textContent(),/unavailable/);assert.equal(await p.locator('.nbm-inline').count(),7);
    // Expiry is per-record; restoring a later saved-view timestamp cannot renew it.
    await p.evaluate(()=>{localStorage.removeItem(CTX_KEY);return loadClimateContext();});
    const beforeAge=await p.evaluate(()=>ctx.recordsByDate['2026-10-11'].checkedAt),lastCheck=await p.evaluate(()=>Math.max(...Object.values(ctx.recordsByDate).map(r=>r.checkedAt)));
    await p.clock.setFixedTime(new Date(beforeAge+12*3600000+1));await p.evaluate(()=>freshnessCheck());assert.equal(await p.locator('.record-detail').first().locator('b').count(),0);assert.equal(await p.locator('.normal-inline').first().locator('b').count(),0);
    await p.clock.setFixedTime(new Date(lastCheck+12*3600000+1));await p.evaluate(()=>freshnessCheck());assert.equal(await p.locator('.record-detail b').count(),0);assert.equal(await p.locator('.normal-inline b').count(),0);assert.equal(await p.locator('.normal-comparison').count(),0,'Expired normal comparisons cannot survive in expanded details');
    assert.equal(await p.evaluate(()=>ctx.recordsByDate['2026-10-11'].checkedAt),beforeAge);
    // An old location response must not label or fill the new location's forecast.
    await p.clock.setFixedTime(new Date(now));control.hang='10-11';release=null;
    await p.evaluate(()=>{localStorage.removeItem(CTX_KEY);window.recordJob=loadClimateContext();});while(!release)await new Promise(r=>setTimeout(r,5));
    await p.evaluate(()=>{locSeq++;current={...current,lat:38.95,lon:-91};resetLocationState();clearLocationUI();});
    release();await p.evaluate(()=>window.recordJob);assert.equal(await p.locator('.record-detail b').count(),0);assert(!/Lambert/.test(await p.locator('#forecastRecordStation').textContent()));assert.equal(await p.locator('.normal-inline b').count(),0);assert(!/Spirit/.test(await p.locator('#forecastNormalStation').textContent()));
    assert.deepEqual(session.errors,[]);console.log('PASS daily normals and expanded records '+width+' '+timezone+' both themes, partial/timeout/stale/wrong-station isolation, cache provenance and location race');
   }finally{if(release)release();await session.context.close();}
  }
  for(const window of ['leap','rollover']){
   const captured=normals.requests.find(r=>r.window===window&&r.params.sid==='SUS'),dates=captured.payload.data.map(r=>r[0]);
   const session=await open(config('Recorded normal '+window,{now:Date.parse(dates[0]+'T18:00:00Z'),timezone:'Asia/Tokyo'}),390),p=session.page;let missingLeap=false;
   try{
    await p.route('**/data.rcc-acis.org/**',route=>{
     const q=params(route.request());
     if(route.request().url().endsWith('/StnMeta'))return route.fulfill({json:{meta:[fixture.records.KSTL['10-11'].response.meta,{...captured.payload.meta,valid_daterange:Array(3).fill(['1991-01-01','2026-10-10'])}]}});
     if(q.elems?.[0]?.normal==='91'){
      const response=structuredClone(captured.payload);response.data=response.data.filter(r=>r[0]>=q.sdate&&r[0]<=q.edate&&(!missingLeap||r[0]!=='2028-02-29'));
      return route.fulfill({json:response});
     }
     return route.fulfill({json:{data:[]}});
    });
    await p.evaluate(()=>{stopSchedule();_climStationCache={};_deepCache={};localStorage.removeItem(CTX_KEY);return loadClimateContext();});
    assert.deepEqual(await p.evaluate(()=>smart.days.map(d=>forecastCalendarKey(d.day||d.night))),dates,'Literal row dates survive leap and year rollover in a Tokyo browser');
    for(const [i,row]of captured.payload.data.entries())assert.deepEqual(await p.locator('.normal-inline').nth(i).locator('b').allTextContents(),row.slice(1,3).map(v=>Math.round(Number(v))+'°'));
    if(window==='leap'){
     assert.match(await p.locator('.normal-detail').nth(2).textContent(),/estimates the February 29.*supplied February 29 entry/s);
     assert.match(await p.locator('.record-detail').nth(2).textContent(),/Only observed February 29 dates/);
     missingLeap=true;await p.evaluate(()=>{localStorage.removeItem(CTX_KEY);return loadClimateContext();});
     assert.match(await p.locator('.normal-inline').nth(2).textContent(),/Feb 29 normals unavailable/);assert.equal(await p.locator('.normal-inline').nth(2).locator('b').count(),0,'A missing leap date cannot borrow February 28 or March 1');assert.equal(await p.locator('.normal-inline b').count(),12);
    }
    assert.deepEqual(session.errors,[]);console.log('PASS recorded normals '+window+' literal dates'+(window==='leap'?' and missing leap entry':'')+' in Tokyo browser');
   }finally{await session.context.close();}
  }
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
