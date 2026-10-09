#!/usr/bin/env node
'use strict';
// Read-only immutable-preview UI verification. All HTTPS requests keep default TLS validation.
// The preceding nws-preview-tests step verifies every served app/data byte and live integration.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),out=process.argv[2]||'/tmp/weather-resources-hosted',sha=process.env.EXPECTED_SHA;
const links=[
 ['#h24Card .resource-links a','https://www.wpc.ncep.noaa.gov/qpf/qpf2.shtml'],
 ['#radarCard .resource-links a','https://map.blitzortung.org/#7/38.7/-90.4'],
 ['#riskCard .resource-links a','https://www.spc.noaa.gov/exper/mesoanalysis/'],
 ['#climateCard .resource-links a','https://www.weather.gov/lsx/climate'],
 ['#moreWeatherResources a:nth-child(1)','https://www.weather.gov/lsx/winter'],
 ['#moreWeatherResources a:nth-child(2)','https://aviationweather.gov/gfa/#obs']
];
const audit={startedAt:new Date().toISOString(),commit:sha,tls:'Default certificate validation; no bypass',live:[],controlled:[],runtimeErrors:[],networkFailures:[]};
async function main(){
 assert(/^[a-f0-9]{40}$/.test(sha||''));
 assert.equal(cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sha);
 const response=await fetch('https://api.github.com/repos/mkasseb/lsxdashboard/commits/'+sha+'/check-runs',{headers:{Accept:'application/vnd.github+json'}});
 assert(response.ok);
 const deployment=(await response.json()).check_runs.find(c=>c.name==='Cloudflare Pages'&&c.conclusion==='success'&&c.head_sha===sha);
 const origin=deployment?.output?.summary?.match(/https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev/)?.[0];
 assert(origin,'Successful immutable deployment of the expected commit is required');
 audit.origin=origin;audit.deployment=deployment.html_url;
 const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']}:{});
 try{for(const width of [390,1440]){
  const touch=width===390,context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,timezoneId:'America/Chicago'}),page=await context.newPage();
  page.on('pageerror',e=>audit.runtimeErrors.push({width,message:e.message}));
  page.on('requestfailed',r=>audit.networkFailures.push({width,url:r.url().split('?')[0],error:r.failure()?.errorText}));
  try{
   const served=await page.goto(origin+'/?resource-preview='+sha,{waitUntil:'domcontentloaded',timeout:60000});assert(served.ok());
   await page.waitForFunction(()=>typeof refreshInFlight!=='undefined'&&refreshInFlight===null&&document.querySelectorAll('.context-toggle').length===5,null,{timeout:90000});
   assert.equal(await page.locator('#linksCard,.quicklinks').count(),0);
   assert.equal(await page.locator('a[href*="StateDroughtMonitor.aspx?MO"]').count(),0);
   assert.equal(await page.locator('#droughtCard .dr-tier a').first().getAttribute('href'),'https://droughtmonitor.unl.edu/CurrentMap.aspx');
   assert.equal(await page.locator('#riversCard h2 a').getAttribute('href'),'https://water.noaa.gov/');
   assert(await page.locator('#afdDiscussionLink').isVisible());
   assert.equal(await page.locator('#moreWeatherResources').evaluate(e=>e.open),false);
   // Explicitly controlled popup pages test native navigation; upstream availability is separate.
   await context.route('**/*',route=>route.request().isNavigationRequest()&&!route.request().url().startsWith(origin+'/')?
    route.fulfill({contentType:'text/html',body:'<!doctype html><title>Resource navigation fixture</title>'}):route.fallback());
   for(const theme of ['light','dark']){
    await page.evaluate(t=>applyTheme(t),theme);
    const summary=page.locator('#moreWeatherResources > summary');
    assert(await page.locator('#moreWeatherResources a').first().isHidden());
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(out,width+'-'+theme+'-collapsed.png'),fullPage:true});
    assert((await summary.boundingBox()).height>=44);
    if(touch)await summary.tap();else{await summary.focus();await summary.press('Enter');}
    assert(await page.locator('#moreWeatherResources').evaluate(e=>e.open));
    for(const [selector,url]of links){
     const anchor=page.locator(selector);
     assert.equal(await anchor.getAttribute('href'),url);assert.equal(await anchor.getAttribute('target'),'_blank');
     assert.equal(await anchor.getAttribute('rel'),'noopener noreferrer');
     assert.match(await anchor.getAttribute('aria-label'),/\(opens in a new tab\)$/);
     assert((await anchor.boundingBox()).height>=44,selector+' target height');
     await anchor.scrollIntoViewIfNeeded();
     if(!touch){await anchor.focus();assert(await anchor.evaluate(e=>getComputedStyle(e).outlineStyle!=='none'));}
     const popupPromise=context.waitForEvent('page');
     if(touch)await anchor.tap();else await anchor.press('Enter');
     const popup=await popupPromise;await popup.waitForURL(url);await popup.waitForLoadState('domcontentloaded');
     assert.equal(await popup.evaluate(()=>window.opener),null);assert.equal(new URL(page.url()).origin,origin);
     await popup.close();
    }
    await page.evaluate(()=>{renderPrecipEvents();renderHourly24();renderTheCall();layoutMasonry();});
    assert(await page.locator('#moreWeatherResources').evaluate(e=>e.open),'Resource disclosure survives live-data rendering');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    await page.locator('#moreWeatherResources').screenshot({path:path.join(out,width+'-'+theme+'-resources.png')});
    for(const id of ['h24Card','radarCard','riskCard','climateCard'])await page.locator('#'+id).screenshot({path:path.join(out,width+'-'+theme+'-'+id+'.png'),style:'.jump-wrap,.skip{visibility:hidden !important}'});
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,width+'-'+theme+'-expanded.png'),fullPage:true});
    audit.live.push({width,theme,test:'Hosted resource placement, targets, disclosure, live rendering and overflow',status:'passed',checks:await page.evaluate(()=>Object.fromEntries(Object.entries(feedChecks).map(([key,value])=>[key,value.status])))});
    audit.controlled.push({width,theme,test:'Six native resource popups with navigation fixtures and no opener',status:'passed'});
    if(touch)await summary.tap();else{await summary.focus();await summary.press('Space');}
    assert.equal(await page.locator('#moreWeatherResources').evaluate(e=>e.open),false);
   }
  }finally{await context.close();}
 }}finally{await browser.close();}
 assert.deepEqual(audit.runtimeErrors,[]);audit.result='passed';
}
fs.mkdirSync(out,{recursive:true});
main().catch(e=>{audit.result='failed';audit.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>{
 audit.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(audit,null,2));
 console.log(JSON.stringify({result:audit.result,commit:sha,origin:audit.origin,live:audit.live,controlled:audit.controlled}));
});
