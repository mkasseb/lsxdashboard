#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-qmd-recorded.json')));
const now=Date.parse(fixture.retrievedAt);
const regional=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/weather/nbm-regional-recorded.json.gz'))));
async function main(){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});setBrowser(browser);
 try{
  for(const width of [320,390,1440])for(const timezone of ['America/Chicago','Asia/Tokyo']){
   const s=await open(config('NBM recorded replay',{now,timezone}),width),p=s.page;
   try{
    assert.equal(await p.locator('#nbmRangeCard details').getAttribute('open'),null);
    assert.match(await p.locator('#nbmRangeCard').innerText(),/unavailable/i);
    await p.route('**/data/nbm-range.json',route=>route.fulfill({json:fixture}));
    const before=await p.evaluate(()=>({days:JSON.stringify(smart.days),call:document.getElementById('callCard').innerText,daily:document.getElementById('daily').innerText}));
    await p.evaluate(()=>loadNbmRange());
    const summary=p.locator('#nbmRangeCard summary');await summary.focus();await summary.press('Enter');
    assert(await p.locator('#nbmRangeCard details').evaluate(e=>e.open));
    assert.equal(await p.locator('.nbm-table tbody tr').count(),6);
    assert.match(await p.locator('#nbmRange').innerText(),/Oct 9, 1:00 AM CDT/);
    await p.evaluate(()=>loadNbmRange());assert(await p.locator('#nbmRangeCard details').evaluate(e=>e.open));
    assert.equal(await p.evaluate(()=>document.activeElement.tagName),'SUMMARY');
    assert.deepEqual(await p.evaluate(()=>({days:JSON.stringify(smart.days),call:document.getElementById('callCard').innerText,daily:document.getElementById('daily').innerText})),before);
    await p.clock.setFixedTime(new Date(regional.retrievedAt));
    await p.route('**/data/nbm-range.json',route=>route.fulfill({json:regional}));
    await p.evaluate(()=>loadNbmRange());assert.equal(await p.locator('.nbm-table tbody tr').count(),6);
    await p.evaluate(()=>{current={...current,lat:38.52,lon:-89.98};});await p.evaluate(()=>loadNbmRange());
    assert.equal(await p.locator('.nbm-table tbody tr').count(),6);
    await p.evaluate(()=>{current={...current,lat:40};});await p.evaluate(()=>loadNbmRange());
    assert.match(await p.locator('#nbmRange').innerText(),/Outside the supported St. Louis/);
    await p.evaluate(()=>{current={...current,lat:38.8,lon:-90.79};});await p.evaluate(()=>loadNbmRange());
    for(const theme of ['dark','light']){
     await p.evaluate(t=>{applyTheme(t);layoutMasonry();},theme);await p.clock.runFor(500);
     assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     const out=process.env.NBM_ARTIFACTS;
     if(out){fs.mkdirSync(out,{recursive:true});await p.locator('#nbmRangeCard').screenshot({path:path.join(out,`recorded-nbm-${width}-${timezone.replace('/','-')}-${theme}.png`)});}
    }
    // Previous-location response cannot write under a new location; race uses a held response.
    let release;await p.route('**/data/nbm-range.json',route=>new Promise(resolve=>{release=async()=>{await route.fulfill({json:fixture});resolve();};}));
    await Promise.all([p.waitForRequest('**/data/nbm-range.json'),p.evaluate(()=>{window.nbmPending=loadNbmRange();})]);
    // Wait only for interception, without relying on the test clock.
    while(!release)await new Promise(resolve=>setTimeout(resolve,5));
    await p.evaluate(()=>{locSeq++;current={...current,lat:39};resetLocationState();clearLocationUI();});
    await release();await p.evaluate(()=>window.nbmPending);
    assert.equal(await p.locator('.nbm-table').count(),0);
    await p.unroute('**/data/nbm-range.json');await p.route('**/data/nbm-range.json',route=>route.fulfill({json:fixture}));
    await p.evaluate(()=>loadNbmRange());assert.match(await p.locator('#nbmRange').innerText(),/No extracted NBM range/);
    await p.evaluate(()=>{current={...current,lat:38.8};});
    await p.clock.setFixedTime(new Date(Date.parse(fixture.run)+25*3600000));await p.evaluate(()=>loadNbmRange());
    assert.equal(await p.locator('.nbm-table').count(),0);assert.match(await p.locator('#nbmRange').innerText(),/over 24 hours/);
    assert.deepEqual(s.errors,[]);console.log('PASS NBM width '+width+' timezone '+timezone);
   }finally{await s.context.close();}
  }
  const s=await open(config('NBM disabled',{now,search:'?nbm=0'}),390);
  assert.equal(await s.page.locator('#nbmRangeCard').count(),0);
  assert.equal(await s.page.evaluate(()=>Object.hasOwn(FEEDS,'nbmRange')),false);
  await s.context.close();console.log('PASS explicit opt-out');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
