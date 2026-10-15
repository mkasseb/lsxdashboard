#!/usr/bin/env node
'use strict';
// Native loaded/disclosure/feed/resize states, with explicitly labelled fixture screenshots.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const {planningGapGeometry,assertPlanningGap}=require('./planning-gap-contract');
const engine=process.env.WEATHER_BROWSER||'chromium',out=process.env.REDESIGN_ARTIFACTS;
async function stable(p){
 await p.clock.runFor(500);
 await p.waitForFunction(()=>document.querySelector('.planning-grid').classList.contains('desktop-planning')===(innerWidth>1000));
 await p.waitForFunction(()=>!stnMap||!stnmap.clientWidth||stnMap.getSize().x===stnmap.clientWidth&&stnMap.getSize().y===stnmap.clientHeight);
}
async function main(){
 const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']}: {})});setBrowser(browser);const report=[];
 try{for(const width of [1024,1180,1440,1920])for(const theme of ['light','dark']){
  const s=await open(config('planning gap fixture',{maps:true,aqi:32,uv:4,river:[20,25,22],climateFixture:true,datedRecords:true}),width),p=s.page,states=[];
  try{
   await p.evaluate(t=>applyTheme(t),theme);await p.evaluate(()=>Promise.all([requestContext('stations'),requestContext('context')]));
   await p.waitForFunction(()=>rvMap&&stnMap&&stnLayer&&stnLayer.getLayers().length===STN_LIST.length);await p.clock.runFor(1600);
   const original=await p.evaluate(()=>({days:JSON.stringify(smart.days),gauges:document.querySelectorAll('#rivers .river-row').length}));
   await p.evaluate(()=>{window.gapMaps={radar:rvMap,station:stnMap};stnMap.panBy([30,20],{animate:false});});
   const stationCamera=await p.evaluate(()=>({zoom:stnMap.getZoom(),center:stnMap.getCenter()}));
   if(out)await p.evaluate(()=>{const n=document.createElement('p');n.textContent='VISUAL QA • deterministic sample weather and test map tiles • not a live forecast';n.style.cssText='font:12px system-ui;color:var(--muted);margin:0 0 12px';document.querySelector('header').before(n);});
   async function check(state,capture=false){
    await stable(p);const geometry=await p.evaluate(planningGapGeometry);let gaps;
    try{gaps=assertPlanningGap(geometry);}catch(e){console.error(JSON.stringify({width,theme,state,geometry,layout:await p.evaluate(()=>({pointer:masonryPointerActive,desktop:document.querySelector('.planning-grid').classList.contains('desktop-planning'),heading:document.querySelector('.railhead').getAttribute('style'),masonry:document.querySelector('.masonry').getAttribute('style'),planning:document.querySelector('.planning-grid').getAttribute('style')}))}));throw e;}
    assert(await p.evaluate(()=>gapMaps.radar===rvMap&&gapMaps.station===stnMap),'Map instances survive repacking');
    assert.equal(await p.evaluate(()=>JSON.stringify(smart.days)),original.days);assert.equal(await p.locator('#rivers .river-row').count(),original.gauges);
    const camera=await p.evaluate(before=>({zoom:stnMap.getZoom(),error:stnMap.project(stnMap.getCenter()).distanceTo(stnMap.project(before.center))}),stationCamera);assert.equal(camera.zoom,stationCamera.zoom);assert(camera.error<2,'Station resize preserves the explored camera within native pixel rounding');
    assert.equal(await p.locator('.normal-inline,.record-inline').count(),0,'Collapsed rows contain no climate line');assert.equal(await p.locator('.normal-detail,.record-detail').count(),14);
    const modelRows=await p.locator('.nbm-inline').count();if(modelRows)assert(await p.locator('.nbm-inline').evaluateAll(rows=>rows.every(e=>e.previousElementSibling.classList.contains('day'))));
    states.push({state,gaps,geometry});
    if(out&&capture){fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,`${engine}-gap-${width}-${theme}-${state}.png`),fullPage:true});}
   }
   await check('loaded',true);
   const risk=p.locator('#riskHelp > summary');await risk.click();await check('risk-expanded',true);
   // These pins lie in the occupied side of the lifted, otherwise transparent lower pack.
   const lastPin=p.locator('#rivers [data-pin-gauge]').last(),id=await lastPin.getAttribute('data-pin-gauge');
   await lastPin.scrollIntoViewIfNeeded();
   assert(await lastPin.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
   await lastPin.click();assert.equal(await p.locator(`[data-pin-gauge="${id}"]`).getAttribute('aria-pressed'),'true');await p.locator(`[data-pin-gauge="${id}"]`).click();
   await risk.click();for(const day of await p.locator('#daily .day').all())await day.click();
   await p.locator('#forecastRecordSource > summary').click();await check('forecast-expanded',true);
   for(const day of await p.locator('#daily .day').all())await day.click();await p.locator('#forecastRecordSource > summary').click();
   for(const toggle of await p.locator('.context-toggle').all())await toggle.click();await check('context-collapsed',true);
   for(const toggle of await p.locator('.context-toggle').all())await toggle.click();await check('context-expanded');
   // A later river response must reserve its new height before lower cards can overlap it.
   s.change(config('later river response',{maps:true,aqi:32,uv:4,river:[35,40,38],climateFixture:true,datedRecords:true}));await p.evaluate(()=>loadRivers());await check('river-refresh');
   await p.locator('#climateCard .context-toggle').focus();await p.setViewportSize({width:1000,height:900});await stable(p);
   assert(await p.locator('#riskCard').evaluate(e=>e.parentElement.classList.contains('masonry')));assert(await p.locator('#riversCard').evaluate(e=>e.parentElement.classList.contains('masonry')));
   assert(await p.locator('#climateCard .context-toggle').evaluate(e=>e===document.activeElement));
   await p.setViewportSize({width,height:900});await check('desktop-restored');assert(await p.locator('#climateCard .context-toggle').evaluate(e=>e===document.activeElement));
   assert.deepEqual(s.errors,[]);report.push({width,theme,states});console.log('PASS '+engine+' planning gap '+width+' '+theme+' loaded/expanded/collapsed/refresh/resize/pins/maps');
  }finally{await s.context.close();}
 }}finally{await browser.close();}
 if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,engine+'-planning-gap-report.json'),JSON.stringify(report,null,2));}
 console.log(report.length+' planning gap cases passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
