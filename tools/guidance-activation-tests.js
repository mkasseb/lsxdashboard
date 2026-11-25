'use strict';
// Real input over authentic recorded weather. Modified prose/intervals and lost
// events are controlled regression probes, never presented as current weather.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {open,config}=require('./weather-stress-tests'),capture=require('./fixtures/weather/nbm-quartile-nws-recorded.json');
const model=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-quartile-daily-short-recorded.json.gz'))));
module.exports=async function(engine){
 const cases=[
  ...['mouse','Enter','Space'].flatMap(input=>['model','nws','both'].flatMap(mode=>[false,true].map(initial=>({width:1440,input,mode,initial})))),
  ...['model','nws','both'].flatMap(mode=>[false,true].map(initial=>({width:390,input:'touch',mode,initial}))),
  ...['interval','date','scope','stale','missing','lost-release'].map(mode=>({width:1440,input:'mouse',mode,initial:false}))
 ],audit=[];
 for(const test of cases){
  const session=await open(config('Guidance activation regression',{now:Date.parse(capture.retrievedAt),touch:test.input==='touch'}),test.width),p=session.page;
  await p.locator('#nbmDailyToggle').check();
  try{
   await p.route('**/data/nbm-range.json',r=>r.fulfill({json:model}));
   await p.evaluate(async f=>{stopSchedule();deferredFeeds.context=false;window.activationNws=f;renderDailyForecast(f,null);feedUpdate('daily','ready',f.properties.updateTime);await loadNbmRange();},capture.forecast);
   await p.locator('#daily .day').first().click();
   const timing=p.locator('.nbm-timing').first(),summary=timing.locator('summary');await summary.waitFor({state:'visible'});
   if(test.initial){await summary.focus();await summary.press('Enter');}
   await p.evaluate(({mode,input})=>{
    const summary=document.querySelector('.nbm-timing summary');window.activationHeld=summary;window.activationClicks=0;
    window.activationEvents=[];
    for(const type of ['pointerdown','pointerup','pointercancel','keydown','keyup','click']){
     document.addEventListener(type,e=>activationEvents.push({
      type,target:e.target.tagName,heldTarget:summary.contains(e.target),
      connected:summary.isConnected,open:summary.parentElement?.open
     }),true);
    }
    document.addEventListener('click',e=>{if(e.target.closest('.nbm-timing summary'))activationClicks++;},true);
    summary.addEventListener(['mouse','touch'].includes(input)?'pointerdown':'keydown',()=>{
     if(mode==='model'||mode==='stale'||mode==='lost-release')NbmRange.forecast(smart.days);
     else if(mode==='nws')renderDailyForecast(activationNws,null);
     else if(mode==='both'){
      const first=structuredClone(activationNws),last=structuredClone(activationNws);
      first.properties.periods[0].detailedForecast='Controlled first update';last.properties.periods[0].detailedForecast='Controlled latest update';
      renderDailyForecast(first,null);NbmRange.forecast(smart.days);renderDailyForecast(last,null);loadForecast._paint();renderForecastRecords(true);
      feedUpdate('daily','ready',last.properties.updateTime);snapSafeSeq=locSeq;saveSnapshot();
      const saved=JSON.parse(localStorage.getItem(SNAP_KEY));window.pendingSnapshotSafe=!saved.parts.daily&&!saved.feeds.daily&&Object.keys(saved.parts).length>0;
     }else if(mode==='interval'){
      const f=structuredClone(activationNws);f.properties.periods[0].endTime=new Date(Date.parse(f.properties.periods[0].endTime)+600000).toISOString();renderDailyForecast(f,null);
     }else if(mode==='date'){
      const f=structuredClone(activationNws);f.properties.periods=f.properties.periods.slice(2);renderDailyForecast(f,null);feedUpdate('daily','ready',f.properties.updateTime);
     }else if(mode==='scope'){locSeq++;NbmRange.reset();}
     else if(mode==='missing'){
      renderDailyForecast(activationNws,null);NbmRange.forecast([]);smart.days=[];loadForecast._paint=null;document.getElementById('daily').textContent='Forecast unavailable';
     }
    },{once:true});
   },test);
   if(test.mode==='stale')await p.clock.setSystemTime(new Date(Date.parse(model.run)+25*3600000));
   let heldDuring;
   if(test.mode==='lost-release'){
    await summary.dispatchEvent('pointerdown',{button:0,isPrimary:true,pointerId:91});
    assert(await p.evaluate(()=>activationHeld.isConnected));await p.clock.runFor(5100);
    await p.waitForFunction(()=>!activationHeld.isConnected);assert.equal(await timing.evaluate(e=>e.open),false);
   }else if(test.input==='mouse'){
    const box=await summary.boundingBox();assert(box);await p.mouse.move(box.x+Math.min(50,box.width/2),box.y+box.height/2);await p.mouse.down();
    heldDuring=await p.evaluate(()=>activationHeld.isConnected);await p.mouse.up();
   }else if(test.input==='touch')await summary.tap();else {await summary.focus();await summary.press(test.input);}
   const valid=['model','nws','both'].includes(test.mode);
   if(valid){
    try{
     await p.waitForFunction(expected=>document.querySelector('.nbm-timing')?.open===expected,!test.initial);
    }catch(error){
     console.error('Disclosure activation failed',test,await p.evaluate(()=>({
      events:activationEvents,clicks:activationClicks,open:document.querySelector('.nbm-timing')?.open
     })));
     throw error;
    }
    await p.waitForFunction(()=>!activationHeld.isConnected);
    assert.equal(await p.evaluate(()=>activationClicks),1,'One native activation across refresh');
    assert(await summary.evaluate(e=>e===document.activeElement));
    if(test.mode==='both'){
     assert.match(await p.locator('.dd-text').first().innerText(),/Controlled latest update/);
     assert(await p.evaluate(()=>pendingSnapshotSafe),'Pending NWS source cannot renew older saved rows');
     assert(await p.evaluate(()=>{saveSnapshot();const s=JSON.parse(localStorage.getItem(SNAP_KEY));return s.parts.daily.includes('Controlled latest update')&&!s.parts.daily.includes('nbm-');}));
    }
    if(heldDuring!==undefined)assert(heldDuring,'Valid control stays connected until release');
   }else if(test.mode!=='lost-release'){
    assert.equal(heldDuring,false,'Changed or invalid source retires before release');
    assert.equal(await p.evaluate(()=>activationHeld.isConnected),false);
    if(['scope','stale','missing'].includes(test.mode))assert.equal(await p.locator('.nbm-inline,.nbm-timing').count(),0);
    if(test.mode==='missing'){await p.clock.runFor(100);assert.match(await p.locator('#daily').innerText(),/Forecast unavailable/);assert.equal(await p.locator('.day-item').count(),0);}
    if(test.mode==='date')assert(await p.locator('#daily .day-item').evaluateAll(rows=>rows.every((row,i)=>row.dataset.forecastDate===forecastCalendarKey(smart.days[i].day||smart.days[i].night)&&row.querySelector('.normal-detail h3').textContent.endsWith(fmtMD(calendarDate(row.dataset.forecastDate))))),'Shifted calendar dates and supplemental headings stay aligned');
   }
   assert.deepEqual(session.errors,[]);audit.push({...test,result:'passed'});
  }finally{await session.context.close();}
 }
 // A press that starts while the previous release's finish timeout is still queued must take
 // over the hold. A paused Playwright clock still runs zero-delay timers at will, so the test
 // queues them itself and releases them between Space keydown and keyup: the order that made CI
 // flake. Before the fix that stale timeout repainted the summary away and no click landed.
 {
  const session=await open(config('Guidance activation back-to-back press',{now:Date.parse(capture.retrievedAt)}),1440),p=session.page;
  try{
   await p.locator('#nbmDailyToggle').check();
   await p.route('**/data/nbm-range.json',r=>r.fulfill({json:model}));
   await p.evaluate(async f=>{stopSchedule();deferredFeeds.context=false;window.activationNws=f;renderDailyForecast(f,null);feedUpdate('daily','ready',f.properties.updateTime);await loadNbmRange();},capture.forecast);
   await p.locator('#daily .day').first().click();
   const summary=p.locator('.nbm-timing summary').first();await summary.waitFor({state:'visible'});
   await p.clock.pauseAt(Date.parse(capture.retrievedAt)+60000);
   await p.evaluate(()=>{
    const schedule=window.setTimeout;window.heldZero=[];window.holdZero=true;
    window.setTimeout=function(callback,delay,...args){
     if(holdZero&&!delay&&typeof callback==='function'){heldZero.push(()=>callback(...args));return 0;}
     return schedule.call(this,callback,delay,...args);
    };
    window.releaseZero=()=>{holdZero=false;heldZero.splice(0).forEach(run=>run());};
   });
   await summary.focus();await summary.press('Enter');
   assert.equal(await p.evaluate(()=>document.querySelector('.nbm-timing').open),true);
   assert(await p.evaluate(()=>heldZero.length>0),'The first release left its finish timeout queued');
   await p.evaluate(()=>{
    window.activationClicks=0;window.activationHeld=document.querySelector('.nbm-timing summary');
    document.addEventListener('click',e=>{if(e.target.closest('.nbm-timing summary'))activationClicks++;},true);
    activationHeld.addEventListener('keydown',()=>renderDailyForecast(activationNws,null),{once:true});
   });
   await p.keyboard.down(' ');await p.evaluate(()=>releaseZero());
   assert(await p.evaluate(()=>activationHeld.isConnected),'Second press holds the control through the earlier release timeout');
   await p.keyboard.up(' ');await p.clock.runFor(10);
   assert.equal(await p.evaluate(()=>activationClicks),1,'Second press activates natively');
   assert.equal(await p.evaluate(()=>document.querySelector('.nbm-timing').open),false);
   assert.equal(await p.evaluate(()=>activationHeld.isConnected),false,'Deferred refresh paints after the second release');
   assert.deepEqual(session.errors,[]);audit.push({width:1440,input:'Enter then Space',mode:'back-to-back',result:'passed'});
  }finally{await session.context.close();}
 }
 if(process.env.NBM_ARTIFACTS){fs.mkdirSync(process.env.NBM_ARTIFACTS,{recursive:true});fs.writeFileSync(path.join(process.env.NBM_ARTIFACTS,'activation-'+engine+'.json'),JSON.stringify(audit,null,2));}
 console.log('PASS guidance native activation '+engine+' '+audit.length+' mouse/touch/keyboard, coalesced updates, source retirement and lost-release recovery cases');
};
