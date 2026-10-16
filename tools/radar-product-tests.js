#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),playwright=require('playwright');
const {open,config,alert,setBrowser}=require('./weather-stress-tests');
const engine=process.env.WEATHER_BROWSER||'chromium',out=process.env.RADAR_ARTIFACTS;
const now=Date.parse('2026-09-30T18:00:00Z');
const scans=(count,step,lag=0)=>Array.from({length:count},(_,i)=>new Date(now-((count-i-1)*step+lag)*60000).toISOString());
const reflectivity=scans(25,5),velocity=scans(25,5,2),regional=scans(61,2);
function capabilities(entries){return '<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Capability><Layer>'+Object.entries(entries).map(([name,times])=>'<Layer><Name>'+name+'</Name><Dimension name="time">'+times.join(',')+'</Dimension></Layer>').join('')+'</Layer></Capability></WMS_Capabilities>';}
// An unrelated product comes first, and each product has its own cadence and scan time.
const xml=capabilities({klsx_bdhc:scans(2,5,180),klsx_sr_bref:reflectivity,klsx_sr_bvel:velocity,conus_bref_qcd:regional});
async function ready(page,layer){try{await page.waitForFunction(layer=>radarFrames.length>1&&radarFrames.every(f=>f.layer.wmsParams.layers===layer&&f.layer._ok>0)&&!radarFallback,layer);}catch(e){console.error('RADAR_PRODUCT_STATE',await page.evaluate(()=>({view:radarView,product:radarProduct(),fallback:radarFallback,frames:radarFrames.map(f=>({time:f.time,layer:f.layer.wmsParams.layers,ok:f.layer._ok,err:f.layer._err,attached:rvMap.hasLayer(f.layer)}))})));throw e;}}
async function overflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');}
async function state(page){return page.evaluate(()=>({view:radarView,layer:radarProduct().layer,times:radarFrames.map(f=>f.time),span:radarSpanMin(),url:radarFrames[0]?.layer._url}));}
const settings=extra=>config('KLSX products',{now,maps:true,productionCsp:true,radarCapabilities:xml,...extra});
(async()=>{
 const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']}: {})});setBrowser(browser);
 const report=[];
 try{
  for(const width of [320,390,1440]){
   const session=await open(settings({alerts:[alert('Tornado Warning',now)]}),width),p=session.page;
   try{
    await ready(p,'klsx_sr_bref');
    assert.equal((await state(p)).times.at(-1),reflectivity.at(-1));assert((await state(p)).span<=60);
    assert.equal(await p.locator('[data-radar-source="klsx"]').getAttribute('aria-pressed'),'true');
    assert.match(await p.locator('#stationLegendImage').getAttribute('src'),/layer=klsx_sr_bref$/);
    await p.waitForFunction(()=>stationLegendImage.complete&&stationLegendImage.naturalWidth===500&&stationLegendImage.naturalHeight===30);
    assert(await p.locator('#stationRadarScale').isVisible());assert(await p.locator('#regionalRadarScale').isHidden());
    await p.evaluate(()=>{rvMap.setView([38.8,-90.7],8,{animate:false});window.productMap=rvMap;window.productWarnings=warnLayer;window.productSatellite=satLayer;window.oldFrames=radarFrames.map(f=>f.layer);});
    const camera=await p.evaluate(()=>[rvMap.getCenter().lat,rvMap.getCenter().lng,rvMap.getZoom()]);
    await p.locator('#radarPlay').click();assert(await p.evaluate(()=>radarPlaying));
    await p.locator('#radarProduct').selectOption('velocity');await ready(p,'klsx_sr_bvel');
    assert.equal((await state(p)).times.at(-1),velocity.at(-1));assert((await state(p)).span<=60);
    assert(await p.evaluate(()=>oldFrames.every(l=>!rvMap.hasLayer(l))&&!radarPlaying));
    assert(await p.evaluate(()=>productMap===rvMap&&productWarnings===warnLayer&&productSatellite===satLayer));
    assert(await p.evaluate(camera=>rvMap.getZoom()===camera[2]&&rvMap.project(rvMap.getCenter()).distanceTo(rvMap.project(camera.slice(0,2)))<2,camera),'Source switch preserves the camera within two rendered pixels');
    assert.match(await p.locator('#stationLegendImage').getAttribute('src'),/layer=klsx_sr_bvel$/);
    assert.match(await p.locator('#stationLegendTitle').innerText(),/velocity.*knots/i);
    assert.match(await p.locator('#radarProductNote').innerText(),/toward KLSX.*away/);
    assert.match(await p.locator('#rsCap').innerText(),/KLSX velocity/);
    await p.locator('#radarSlider').fill('0');assert.equal(await p.evaluate(()=>radarIdx),0);
    await p.locator('[data-radar-source="regional"]').click();await ready(p,'conus_bref_qcd');
    assert.equal((await state(p)).times.at(-1),regional.at(-1));assert((await state(p)).span<=60);
    assert(await p.locator('#radarProduct').isDisabled());assert(await p.locator('#regionalRadarScale').isVisible());assert(await p.locator('#stationRadarScale').isHidden());
    assert.match(await p.locator('#rsLink a').getAttribute('href'),/^https:\/\/radar.weather.gov\/$/);
    await p.locator('[data-radar-source="klsx"]').click();await ready(p,'klsx_sr_bref');
    await p.locator('#rsFull').click();assert.equal(await p.locator('#radarCard').getAttribute('aria-modal'),'true');
    await p.locator('#radarProduct').selectOption('velocity');await ready(p,'klsx_sr_bvel');await overflow(p);
    await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.id),'rsFull');
    await p.evaluate(()=>applyTheme('light'));await overflow(p);
    if(out){fs.mkdirSync(out,{recursive:true});await p.locator('#radarCard').screenshot({path:path.join(out,engine+'-velocity-'+width+'.png')});}
    await p.reload();await ready(p,'klsx_sr_bvel');assert.equal(await p.locator('#radarProduct').inputValue(),'velocity');
    assert.deepEqual(session.errors,[]);await overflow(p);
    report.push({width,status:'passed',...await state(p)});console.log('PASS '+engine+' station products, camera, legends, fullscreen and persistence '+width);
   }finally{await session.context.close();}
  }
  const session=await open(settings(),390),p=session.page;
  try{
   await ready(p,'klsx_sr_bref');
   let held=null,resolveHeld;
   let heldReady=new Promise(resolve=>{resolveHeld=resolve;});
   await p.route('**/geoserver/**',async route=>{
    if(!held&&/GetCapabilities/i.test(route.request().url())){held=route;resolveHeld();return;}
    await route.fallback();
   });
   await p.evaluate(()=>{window.oldRefresh=refreshRadarLayer();});await heldReady;
   await p.locator('#radarProduct').selectOption('velocity');await ready(p,'klsx_sr_bvel');
   await held.fulfill({contentType:'text/xml',body:xml});await p.evaluate(()=>oldRefresh);
   assert.equal((await state(p)).layer,'klsx_sr_bvel');assert.equal((await state(p)).times.at(-1),velocity.at(-1));
   await p.unroute('**/geoserver/**');held=null;heldReady=new Promise(resolve=>{resolveHeld=resolve;});
   await p.route('**/geoserver/**',async route=>{if(/GetCapabilities/i.test(route.request().url())){held=route;resolveHeld();return;}await route.fallback();});
   await p.evaluate(()=>{window.offRefresh=refreshRadarLayer();});await heldReady;
   await p.locator('#rsTabs [data-l="radar"]').click();
   await held.fulfill({contentType:'text/xml',body:xml});await p.evaluate(()=>offRefresh);
   assert(await p.evaluate(()=>!skyOn.radar&&!radarFrames.length&&!Object.keys(radarPool).length&&!rvMap.hasLayer(nwsRadar)));
   await p.unroute('**/geoserver/**');
   await p.locator('[data-radar-source="regional"]').click();assert.equal(await p.evaluate(()=>radarFrames.length),0);
   await p.locator('#rsTabs [data-l="radar"]').click();await ready(p,'conus_bref_qcd');
   assert.deepEqual(session.errors,[]);console.log('PASS '+engine+' late responses cannot replace a product or resurrect a hidden layer');
   report.push({case:'source and visibility request races',status:'passed'});
  }finally{await session.context.close();}
  const legend=await open(settings({radarLegendDown:true}),390),l=legend.page;
  try{
   await ready(l,'klsx_sr_bref');await l.locator('#radarLegendRetry').waitFor({state:'visible'});
   const before=legend.requests.filter(url=>url.includes('GetLegendGraphic')).length;
   await l.evaluate(()=>{syncSkyMeta();syncSkyMeta();});
   assert.equal(legend.requests.filter(url=>url.includes('GetLegendGraphic')).length,before,'Metadata refresh must not create a legend retry loop');
   await l.locator('[data-radar-source="regional"]').click();await ready(l,'conus_bref_qcd');
   legend.change(settings());await l.locator('[data-radar-source="klsx"]').click();await ready(l,'klsx_sr_bref');
   await l.waitForFunction(()=>stationLegendImage.complete&&stationLegendImage.naturalWidth===500&&!stationLegendImage.hidden);
   assert(await l.locator('#radarLegendRetry').isHidden());
   legend.change(settings({radarLegendDown:true}));await l.locator('#radarProduct').selectOption('velocity');await ready(l,'klsx_sr_bvel');
   await l.locator('#radarLegendRetry').waitFor({state:'visible'});legend.change(settings());await l.locator('#radarLegendRetry').click();
   await l.waitForFunction(()=>stationLegendImage.complete&&stationLegendImage.naturalWidth===500&&!stationLegendImage.hidden);
   assert(await l.locator('#radarLegendRetry').isHidden());assert.deepEqual(legend.errors,[]);
   console.log('PASS '+engine+' failed legends recover on station restore and explicit retry without retry loops');
   report.push({case:'legend failure and retry',status:'passed'});
  }finally{await legend.context.close();}
  const fallback=await open(settings({radarCapabilities:capabilities({klsx_bdhc:reflectivity})}),390),f=fallback.page;
  try{
   await f.waitForFunction(()=>radarFallback&&nwsRadar._ok>0);
   assert.equal(await f.evaluate(()=>radarFrames.length),0);assert.match(await f.locator('#radarTime').innerText(),/latest sweep/);
   assert.equal(await f.evaluate(()=>nwsRadar.wmsParams.layers),'klsx_sr_bref');
   fallback.change(settings());await f.evaluate(()=>refreshRadarLayer());await ready(f,'klsx_sr_bref');
   await f.route('**/geoserver/klsx/**',async route=>{if(/GetMap/i.test(route.request().url()))return route.abort();await route.fallback();});
   await f.locator('#radarProduct').selectOption('velocity');await f.waitForFunction(()=>radarDown());
   assert.match(await f.locator('#radarTime').innerText(),/unavailable/);assert.match(await f.locator('#rsCap').innerText(),/KLSX velocity unavailable.*Regional/);
   assert(await f.locator('#rsLegend').isHidden());
   await f.locator('[data-radar-source="regional"]').click();await ready(f,'conus_bref_qcd');assert.equal(await f.evaluate(()=>radarDown()),false);
   assert.deepEqual(fallback.errors,[]);console.log('PASS '+engine+' missing selected metadata, station tile outage and regional recovery');
   report.push({case:'metadata fallback and station outage',status:'passed'});
  }finally{await fallback.context.close();}
 }finally{await browser.close();}
 if(out)fs.writeFileSync(path.join(out,engine+'-radar-products.json'),JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
