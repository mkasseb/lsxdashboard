#!/usr/bin/env node
'use strict';
// Actual served UI with recorded NWS text and clearly controlled outage/race scenarios.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const recording=require('./fixtures/weather/nws-afd-recorded.json'),now=Date.parse(recording.verifiedAt),H=3600000;
const engine=process.env.WEATHER_BROWSER||'chromium',out=process.env.NWS_ARTIFACTS,results=[];
const prod=recording.products[0],endpoint='**/products/11111111-1111-1111-1111-111111111111';
const expected=['Near-record warmth and predominantly dry weather is forecast into early next week.','The remnants of Tropical Cyclone Isaias bring slightly "cooler" temperatures Saturday and Sunday due to clouds, as well as chances of light rain in southeast Missouri and southwest Illinois.'];
async function replace(p,product){await p.unroute(endpoint);await p.route(endpoint,r=>r.fulfill({json:product}));await p.evaluate(()=>loadAFD());}
async function currentMessages(p){return p.locator('#callRow li').allTextContents();}
async function sourceTarget(source){
 const box=await source.boundingBox();
 assert(box&&box.height>=44,'Source tap target: '+JSON.stringify(await source.evaluate(e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return {rect:r.toJSON(),height:c.height,minHeight:c.minHeight,display:c.display,padding:c.padding,lineHeight:c.lineHeight,open:e.parentElement.open};})));
}
async function fallback(p,reason){
 assert.equal(await p.locator('#keyMessagesTitle').innerText(),'NWS Local Forecast');
 assert.match(await p.locator('#keyMessagesStatus').innerText(),reason);
 assert.equal(await p.locator('#callRow li').count(),0);
 assert.match(await p.locator('#callRow').innerText(),/Scenario|Sunny|Current NWS local forecast unavailable/);
 const u=new URL(await p.locator('#callRow a').getAttribute('href'));
 const location=await p.evaluate(()=>current);assert.equal(+u.searchParams.get('lat'),location.lat);assert.equal(+u.searchParams.get('lon'),location.lon);
}
async function main(){
 const browser=await playwright[engine].launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});setBrowser(browser);
 try{
  for(const width of [320,390,1440])for(const timezone of ['America/Chicago','Asia/Tokyo']){
   const s=await open(config('NWS Key Messages fixture',{now,afdProduct:prod,timezone,touch:width<500,aqi:35}),width),p=s.page;
   try{
    assert.equal(await p.locator('#keyMessagesTitle').innerText(),'NWS Key Messages');assert.deepEqual(await currentMessages(p),expected);
    assert.match(await p.locator('#keyMessagesMeta').innerText(),/Regional outlook.*NWS St Louis MO \(LSX\)/);
    assert.match(await p.locator('#keyMessagesStatus').innerText(),/AFD issued Oct 8, 6:02 PM CDT/);
    assert.equal(new URL(await p.locator('#keyDiscussionLink').getAttribute('href')).searchParams.get('issuedby'),'LSX');
    const source=p.locator('#briefWhy > summary');await sourceTarget(source);if(width<500)await source.tap();else{await source.focus();await source.press('Enter');}
    assert(await p.locator('#briefWhy').evaluate(e=>e.open));assert.match(await p.locator('#briefEvidence').textContent(),/revision time is not supplied/);
    await source.focus();await p.evaluate(()=>loadAFD());assert(await source.evaluate(e=>e===document.activeElement));assert(await p.locator('#briefWhy').evaluate(e=>e.open));
    await sourceTarget(source);
    for(const theme of ['light','dark']){
     await p.evaluate(t=>applyTheme(t),theme);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     if(out&&timezone==='America/Chicago'){
      fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>{window.scrollTo(0,0);const label=document.createElement('p');label.id='nwsQaLabel';label.textContent='QA: recorded NWS AFD at 2026-10-09 01:04 UTC; other weather is synthetic.';label.style.cssText='font:12px system-ui;color:var(--muted)';document.querySelector('header').before(label);});
      await p.screenshot({path:path.join(out,engine+'-'+width+'-'+theme+'.png'),fullPage:true});await p.evaluate(()=>document.getElementById('nwsQaLabel').remove());
     }
    }
    assert.deepEqual(s.errors,[]);results.push({width,timezone,test:'Recorded text, office, issuance, accessible controls and layout',status:'passed'});
   }finally{await s.context.close();}
  }
  const s=await open(config('NWS failure and race fixtures',{now,afdProduct:prod,aqi:35}),390),p=s.page;
  try{
   // A product update carrying unchanged messages changes only the explicitly labeled AFD clock.
   await replace(p,recording.products[1]);assert.deepEqual(await currentMessages(p),expected);assert.match(await p.locator('#keyMessagesStatus').innerText(),/2:38 PM CDT/);
   await replace(p,prod);assert.deepEqual(await currentMessages(p),expected);
   const examples=[
    ['missing',{...prod,productText:prod.productText.replace('.KEY MESSAGES...','.SYNOPSIS...')},/not included/],
    ['empty',{...prod,productText:prod.productText.replace(/\.KEY MESSAGES[\s\S]*?&&/,'.KEY MESSAGES...\n&&')},/not included/],
    ['malformed',{...prod,productText:prod.productText.replace(/\.KEY MESSAGES[\s\S]*?&&/,'.KEY MESSAGES...\nUnbulleted text must not be presented as messages.\n&&')},/could not be verified/],
    ['truncated',{...prod,productText:prod.productText.split('&&')[0]},/could not be verified/],
    ['stale product',{...prod,issuanceTime:new Date(now-19*H).toISOString()},/stale/],
    ['invalid timestamp',{...prod,issuanceTime:'not-a-time'},/could not be verified/],
    ['wrong office',{...prod,issuingOffice:'KEAX'},/could not be verified/],
    ['stale section',{...prod,productText:prod.productText.replace('.KEY MESSAGES...','.KEY MESSAGES...\nIssued at 232 PM CDT Wed Oct 7 2026')},/stale/]
   ];
   for(const [test,product,reason]of examples){await replace(p,product);await fallback(p,reason);results.push({test,status:'passed'});}
   await p.locator('#callRow a').focus();await replace(p,prod);assert(await p.locator('#briefWhy > summary').evaluate(e=>e===document.activeElement));
   // Escape official text and office attribution; malformed HTML cannot create executable nodes.
   const htmlText={...prod,productText:prod.productText.replace('St Louis MO','St Louis MO <img src=x onerror="window.nwsInjected=true">').replace('- Near-record','- <img src=x onerror="window.nwsInjected=true"> Near-record')};
   await replace(p,htmlText);assert.equal(await p.locator('#callCard img, #afd img').count(),0);assert.equal(await p.evaluate(()=>window.nwsInjected),undefined);
   await replace(p,prod);
   // Local warnings keep their own official instructions and position above regional messages.
   const warn={id:'urn:nws-qa-warning',type:'Feature',geometry:{type:'Polygon',coordinates:[[[-91.2,38.2],[-90,38.2],[-90,39.4],[-91.2,39.4],[-91.2,38.2]]]},properties:{event:'Tornado Warning',severity:'Extreme',urgency:'Immediate',certainty:'Observed',senderName:'NWS St Louis MO',sent:new Date(now-60000).toISOString(),expires:new Date(now+H).toISOString(),ends:new Date(now+H).toISOString(),areaDesc:'St. Charles',affectedZones:['https://api.weather.gov/zones/county/MOC183'],headline:'Synthetic warning for QA',description:'Synthetic hazard.',instruction:'Take shelter immediately.',parameters:{}}};
   s.change(config('NWS local warning fixture',{now,afdProduct:prod,aqi:35,alerts:[warn]}));await p.evaluate(()=>loadAlerts());
   assert.match(await p.locator('#alerts').innerText(),/Tornado Warning|Take shelter immediately/);assert.deepEqual(await currentMessages(p),expected);
   assert(await p.evaluate(()=>document.getElementById('alertsCard').getBoundingClientRect().bottom<=document.getElementById('callCard').getBoundingClientRect().top));
   // Failed refresh removes official messages; a current independent local forecast remains.
   await p.unroute(endpoint);await p.route(endpoint,r=>r.fulfill({status:503,json:{}}));await p.evaluate(()=>loadAFD());await fallback(p,/unavailable/);
   await p.route('**/forecast',r=>r.fulfill({status:503,json:{}}));await p.evaluate(()=>loadForecast());await fallback(p,/unavailable/);assert.match(await p.locator('#briefEvidence').textContent(),/Hourly NWS forecast/);
   await p.route('**/forecast/hourly',r=>r.fulfill({status:503,json:{}}));await p.evaluate(()=>loadForecast());await fallback(p,/unavailable/);assert.match(await p.locator('#callRow').innerText(),/Current NWS local forecast unavailable/);
   await p.unroute('**/forecast');await p.unroute('**/forecast/hourly');await p.evaluate(()=>loadForecast());await replace(p,prod);
   // Source age and successful-check age independently expire; unchanged live-region text
   // must not announce itself repeatedly during unrelated feed checks.
   assert.equal(await p.evaluate(()=>{let n=0;const o=new MutationObserver(records=>n+=records.length);o.observe(document.getElementById('keyMessagesStatus'),{childList:true,subtree:true});freshnessCheck();freshnessCheck();const records=o.takeRecords();o.disconnect();return n+records.length;}),0);
   await p.evaluate(()=>{feedChecks.afd.successAt=Date.now()-61*60000;freshnessCheck();});await fallback(p,/stale/);
   await p.evaluate(()=>{feedChecks.daily.successAt=Date.now()-61*60000;feedChecks.hourly.successAt=Date.now()-61*60000;freshnessCheck();});assert.match(await p.locator('#callRow').innerText(),/Current NWS local forecast unavailable/);
   await p.evaluate(()=>loadForecast());await replace(p,prod);
   // List order must not pick an older issuance; API reads revalidate their HTTP cache.
   await p.route('**/products/types/AFD/locations/LSX',r=>r.fulfill({json:{'@graph':[{'@id':'https://api.weather.gov/products/33333333-3333-3333-3333-333333333333',productCode:'AFD',issuingOffice:'KLSX',issuanceTime:recording.products[1].issuanceTime},{'@id':'https://api.weather.gov/products/11111111-1111-1111-1111-111111111111',productCode:'AFD',issuingOffice:'KLSX',issuanceTime:prod.issuanceTime}]}}));
   const oldCount=s.requests.filter(u=>u.includes('33333333')).length;await p.evaluate(()=>loadAFD());assert.equal(s.requests.filter(u=>u.includes('33333333')).length,oldCount);assert.deepEqual(await currentMessages(p),expected);
   await p.evaluate(()=>{window.afdCacheOptions=[];const original=window.fetch;window.fetch=function(url,options){if(String(url).includes('/products/'))window.afdCacheOptions.push(options.cache);return original.apply(this,arguments);};});
   await p.evaluate(()=>loadAFD());assert.deepEqual(await p.evaluate(()=>window.afdCacheOptions),['no-cache','no-cache']);
   // An older overlapping request for the same location cannot replace a newer result.
   let release,called=0;await p.unroute(endpoint);await p.route(endpoint,async r=>{if(called++===0){await new Promise(resolve=>release=resolve);await r.fulfill({json:{...prod,productText:prod.productText.replace('Near-record warmth','Older response warmth')}}).catch(()=>{});}else await r.fulfill({json:prod});});
   const oldRequest=p.waitForRequest(endpoint);await p.evaluate(()=>{window.oldAfd=loadAFD();});await oldRequest;
   await p.evaluate(()=>loadAFD());release();await p.evaluate(()=>window.oldAfd);assert.deepEqual(await currentMessages(p),expected);
   // A supported LSX town change clears old text and rejects the prior town's late reply.
   let late,calls=0;await p.unroute(endpoint);await p.route(endpoint,async r=>{if(calls++===0){await new Promise(resolve=>late=resolve);await r.fulfill({json:{...prod,productText:prod.productText.replace('Near-record warmth','Prior-town response warmth')}}).catch(()=>{});}else await r.fulfill({json:prod});});
   const pending=p.waitForRequest(endpoint);await p.evaluate(()=>{window.lateAfd=loadAFD();});await pending;
   await p.evaluate(()=>{setLocation({name:'Belleville, IL',lat:38.52,lon:-89.98,precision:'representative',station:'KSUS'},{save:true});window.immediateMessages=document.getElementById('callRow').textContent;});
   assert(!/Prior-town response|southeast Missouri/.test(await p.evaluate(()=>window.immediateMessages)));
   await p.waitForFunction(()=>nwsMessages?.generation===locSeq&&nwsMessages?.status==='ready');late();await p.evaluate(()=>window.lateAfd);
   assert.deepEqual(await currentMessages(p),expected);assert.match(await p.locator('#keyMessagesMeta').innerText(),/Regional outlook.*St Louis MO \(LSX\)/);
   assert.equal(new URL(await p.locator('#keyDiscussionLink').getAttribute('href')).searchParams.get('issuedby'),'LSX');
   assert(!s.requests.some(u=>/products\/types\/AFD\/locations\/(?!LSX)/.test(u)),'Only LSX discussion products are requested');
   // Saved HTML cannot restore regional messages under the next selected location.
   assert(await p.evaluate(()=>!SNAP_PARTS.some(p=>['afd','callRow'].includes(p.id))));
   await p.evaluate(()=>{snapSafeSeq=locSeq;saveSnapshot();});const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem(SNAP_KEY)));assert(!saved.parts.afd&&!saved.parts.callRow);
   assert.deepEqual(s.errors,[]);results.push({test:'Warning precedence; independent forecast fallback; escaping; failed refresh; same-location overlap; LSX town switch; saved HTML exclusion',status:'passed'});
  }finally{await s.context.close();}
 }finally{await browser.close();}
 if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,engine+'-nws-message-report.json'),JSON.stringify(results,null,2));}
 console.log('PASS '+engine+': '+results.length+' NWS message browser cases');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
