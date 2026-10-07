#!/usr/bin/env node
'use strict';
// Official destination contracts and real native-link activation; no live upstream dependency.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const engine=process.env.WEATHER_BROWSER||'chromium';
const cpc='https://www.cpc.ncep.noaa.gov/products/';
const expected=[
 ['#cpc a:nth-child(1)',cpc+'predictions/610day/','CPC 6–10 Day Temperature outlook'],
 ['#cpc a:nth-child(2)',cpc+'predictions/610day/','CPC 6–10 Day Precipitation outlook'],
 ['#cpc a:nth-child(3)',cpc+'predictions/814day/','CPC 8–14 Day Temperature outlook'],
 ['#cpc a:nth-child(4)',cpc+'predictions/814day/','CPC 8–14 Day Precipitation outlook'],
 ['#droughtCard .dr-tier:nth-of-type(1) > a','https://droughtmonitor.unl.edu/CurrentMap.aspx','Now — current U.S. Drought Monitor'],
 ['#droughtCard .dr-tier:nth-of-type(2) > a',cpc+'expert_assessment/mdo_summary.php','Month ahead — CPC monthly drought outlook'],
 ['#droughtCard .dr-tier:nth-of-type(3) > a',cpc+'expert_assessment/sdo_summary.php','Season (3 mo) — CPC seasonal drought outlook'],
 ['#hazards .hz-row:nth-child(1) a','https://www.wpc.ncep.noaa.gov/threats/threats.php','WPC Days 3–7 hazards outlook'],
 ['#hazards .hz-row:nth-child(2) a',cpc+'predictions/threats/threats.php','CPC Days 8–14 hazards outlook']
];
async function contracts(page){
 for(const [selector,url,label] of expected){
  const a=page.locator(selector);
  assert.equal(await a.count(),1,selector);
  assert.equal(await a.getAttribute('href'),url);
  assert.equal(await a.getAttribute('aria-label'),label+' (opens in a new tab)');
  assert.equal(await a.getAttribute('target'),'_blank');
  assert.equal(await a.getAttribute('rel'),'noopener noreferrer');
  assert.match(await a.innerText(),/↗/);
  if(selector.startsWith('#cpc ')){
   const described=await a.getAttribute('aria-describedby');
   assert(described);assert.match(await page.locator('#'+described).innerText(),/Leaning|Equal chances|Unavailable/);
  }
  assert.equal(await a.locator('a,button,input,summary,[role="button"]').count(),0,'No nested controls');
  assert.equal(await a.evaluate(e=>!!e.parentElement.closest('a,button,summary,[role="button"]')),false);
  assert((await a.boundingBox()).height>=44,'44px touch target: '+selector);
 }
}
async function activate(page,context,selector,url,touch){
 const a=page.locator(selector),before=page.url();
 await a.scrollIntoViewIfNeeded();
 if(!touch){
  await a.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  assert(await a.evaluate(e=>document.activeElement===e),'Native tab order');
  assert(await a.evaluate(e=>getComputedStyle(e).outlineStyle!=='none'),'Visible keyboard focus');
 }
 const popupPromise=context.waitForEvent('page');
 if(touch)await a.tap();else await page.keyboard.press('Enter');
 const popup=await popupPromise;
 await popup.waitForURL(url);
 await popup.waitForLoadState('domcontentloaded');
 assert.equal(await popup.evaluate(()=>window.opener),null);
 assert.equal(page.url(),before,'Dashboard stays in its tab');
 await popup.close();
}
async function main(){
 const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}: {})});setBrowser(browser);
 try{
  for(const width of [320,390,768,1280])for(const theme of ['dark','light']){
   const touch=width<768,s=await open(config('official sources',{touch,cpcAbove:true}),width),p=s.page;
   try{
    // New tabs are intercepted independently of the dashboard's API fixture routing.
    await s.context.route('**/*',route=>route.request().isNavigationRequest()&&route.request().url()!=='https://lsx-weather-test.invalid/'?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Official source navigation fixture</title>'}):route.fallback());
    await p.evaluate(t=>applyTheme(t),theme);
    await contracts(p);
    for(const [selector,url] of expected)await activate(p,s.context,selector,url,touch);
    for(const id of ['cpcCard','droughtCard']){
     const toggle=p.locator('#'+id+' .context-toggle');
     assert.equal(await toggle.getAttribute('aria-expanded'),'true','Link did not collapse card');
     if(touch)await toggle.tap();else await toggle.press('Enter');
     assert.equal(await toggle.getAttribute('aria-expanded'),'false');
     if(touch)await toggle.tap();else await toggle.press('Space');
     assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    }
    await p.locator('#riskHelp summary').click();
    await p.evaluate(()=>Promise.all([loadCpc(),loadHazards(),loadDrought(),loadSpc()]));
    assert(await p.locator('#riskHelp').evaluate(e=>e.open),'Risk disclosure survives refresh');
    await contracts(p);
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    if(process.env.SOURCE_LINK_ARTIFACTS){
     fs.mkdirSync(process.env.SOURCE_LINK_ARTIFACTS,{recursive:true});
     for(const id of ['cpcCard','droughtCard','hazardsCard'])await p.locator('#'+id).screenshot({path:path.join(process.env.SOURCE_LINK_ARTIFACTS,engine+'-'+width+'-'+theme+'-'+id+'.png')});
    }
    s.change(config('source outage',{offline:true}));
    await p.evaluate(()=>Promise.all([loadCpc(),loadHazards(),loadDrought()]));
    await contracts(p);
    assert.equal(await p.locator('#cpc .cpc-pill').filter({hasText:'Unavailable'}).count(),4);
    assert.match(await p.locator('#hazards').innerText(),/Hazards data unavailable/);
    assert.deepEqual(s.errors,[]);
    console.log('PASS source links '+engine+' '+width+' '+theme+' (destinations, '+(touch?'tap':'keyboard')+', refresh, outage, disclosures)');
   }finally{await s.context.close();}
  }
  const s=await open(config('saved links'));
  let snapshot;
  try{snapshot=await s.page.evaluate(()=>{saveSnapshot();return localStorage.getItem(SNAP_KEY);});}finally{await s.context.close();}
  const cached=await open(config('restored links',{now:JSON.parse(snapshot).t+60000,snapshot,skipWait:true,cpcDelay:5000}));
  try{
   await cached.page.waitForFunction(()=>snapRestored);
   await contracts(cached.page);
   assert.equal(await cached.page.evaluate(()=>feedChecks.cpc.saved),true);
   console.log('PASS saved source-link markup');
  }finally{await cached.context.close();}
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
