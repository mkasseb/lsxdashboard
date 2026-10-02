#!/usr/bin/env node
'use strict';
// Layout/interaction contract in addition to the full weather suite. No live weather dependency.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const cards=['alertsCard','currentCard','callCard','h24Card','radarCard','forecastCard','riversCard','aqiCard','afdCard','riskCard','hazardsCard','obsCard','droughtCard','climateCard','cpcCard','linksCard'];
const engine=process.env.WEATHER_BROWSER||'chromium';
const out=process.env.REDESIGN_ARTIFACTS;
async function main(){
 const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']}: {})});setBrowser(browser);
 const report=[];
 try{for(const width of [320,390,768,1024,1180,1440,1920])for(const theme of ['dark','light']){
  const s=await open(config('layout fixture',{maps:true,touch:width<768,aqi:32,uv:4,river:[20,25,22]}),width),p=s.page;
  try{
   await p.evaluate(t=>applyTheme(t),theme);
   await p.waitForFunction(()=>document.querySelectorAll('#radar .leaflet-tile-loaded').length>0);
   for(const id of cards)assert.equal(await p.locator('#'+id).count(),1,id+' retained once');
   assert.equal(await p.locator('#compactView').count(),0);
   assert.equal(await p.locator('#hourlyOptions button').count(),3);
   assert.equal(await p.locator('#rsTabs button').count(),2);
   const boxes=await p.evaluate(()=>Object.fromEntries(['currentCard','callCard','h24Card','radarCard','forecastCard'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[id,{x:r.x,y:r.y,right:r.right,bottom:r.bottom}];})));
   if(width>1000){assert(Math.abs(boxes.h24Card.y-boxes.radarCard.y)<2);assert(boxes.h24Card.right<=boxes.radarCard.x);assert(Math.abs(boxes.forecastCard.y-boxes.h24Card.bottom-16)<2,'No dead band above Week');assert(Math.abs(boxes.forecastCard.x-boxes.h24Card.x)<2);assert(Math.abs(boxes.forecastCard.right-boxes.h24Card.right)<2);assert(Math.abs(boxes.forecastCard.bottom-boxes.radarCard.bottom)<2,'Radar must fill the full forecast column');assert(Math.abs(boxes.currentCard.y-boxes.callCard.y)<2);}
   else {assert(boxes.radarCard.y>=boxes.h24Card.bottom);assert(boxes.forecastCard.y>=boxes.radarCard.bottom);}
   const radarSize=await p.locator('#radar').boundingBox(),loadedTiles=await p.locator('#radar .leaflet-tile-loaded').count();if(width>1000)assert(radarSize.height>600,'Successful map must render at full column height, not fallback height');
   const rowHeights=await p.locator('#daily .day').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().height));assert(rowHeights.every(h=>h>=44&&h<=56),'Compact rows keep 44px touch targets');
   if(width<=680)assert(boxes.callCard.y>=boxes.currentCard.bottom);
   await p.locator('#daily .day').first().click();assert.equal(await p.locator('#daily .day').first().getAttribute('aria-expanded'),'true');
   await p.locator('#daily .day').first().press('Enter');assert.equal(await p.locator('#daily .day').first().getAttribute('aria-expanded'),'false');
   for(const hours of [48,72,24]){await p.locator('#hourlyOptions [data-hours="'+hours+'"]').click();assert.equal(await p.locator('#hourlyOptions [data-hours="'+hours+'"]').getAttribute('aria-pressed'),'true');}
   await p.locator('#hourlyCursor').focus();await p.locator('#hourlyCursor').press('ArrowRight');
   const selected=await p.evaluate(()=>renderHourly24._selectedTime);await p.evaluate(()=>loadForecast());assert.equal(await p.evaluate(()=>renderHourly24._selectedTime),selected);assert.equal(await p.evaluate(()=>document.activeElement.id),'hourlyCursor');
   await p.locator('#briefWhy summary').click();await p.evaluate(()=>renderTheCall());assert(await p.locator('#briefWhy').evaluate(e=>e.open));
   await p.locator('#briefWhy summary').click();
   // Repacking after an independently collapsed card must preserve the visible navigation target.
   await p.locator('#afdCard .context-toggle').click();await p.evaluate(()=>layoutMasonry());await p.clock.runFor(500);
   for(const id of ['currentCard','h24Card','radarCard','forecastCard','riversCard','climateCard']){
    await p.evaluate(id=>{document.querySelector('#jumpNav a[href="#'+id+'"]').click();document.getElementById(id).scrollIntoView();},id);
    await p.waitForFunction(id=>document.querySelector('#jumpNav a[aria-current="location"]')?.getAttribute('href')==='#'+id,id).catch(async e=>{console.error(JSON.stringify({width,theme,id,geometry:await p.evaluate(()=>({scroll:scrollY,bar:document.querySelector('.jump-wrap').getBoundingClientRect().bottom,links:[...document.querySelectorAll('#jumpNav a')].map(l=>({href:l.hash,active:l.getAttribute('aria-current'),top:document.querySelector(l.hash).getBoundingClientRect().top}))}))}));throw e;});
   }
   const rivers=await p.locator('#rivers .rlink').evaluateAll(rows=>rows.map(row=>({w:row.clientWidth,prose:row.querySelector('.rsub')?.getBoundingClientRect().width,now:row.querySelector('.rmeta')?.getBoundingClientRect().top,forecast:row.querySelector('.rsub')?.getBoundingClientRect().top})));
   for(const row of rivers){assert(row.prose>=row.w*.7,'River detail must use the row width: '+JSON.stringify(row));assert(row.now<row.forecast,'Now precedes forecast details');}
   assert.match(await p.locator('#rivers').innerText(),/Now/);assert.match(await p.locator('#rivers').innerText(),/Forecast peak in window/);
   // Measure full document and card bounds; never conceal overflow by changing viewport width.
   const overflow=await p.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.card')].filter(e=>{let r=e.getBoundingClientRect();return r.width&&(r.left< -1||r.right>innerWidth+1);}).map(e=>e.id)}));
   assert(overflow.scroll<=overflow.w+1,JSON.stringify(overflow));assert.deepEqual(overflow.cards,[]);
   const contrast=await p.evaluate(()=>{
    const c=getComputedStyle(document.documentElement),rgb=s=>(s.length===4?'#'+s.slice(1).split('').map(c=>c+c).join(''):s).match(/[\da-f]{2}/gi).map(n=>parseInt(n,16)/255),lum=s=>rgb(s).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    return ['--text','--muted','--accent'].flatMap(f=>['--bg','--panel','--panel-2'].map(b=>{let x=lum(c.getPropertyValue(f).trim()),y=lum(c.getPropertyValue(b).trim());return {f,b,ratio:(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};}));
   });for(const c of contrast)assert(c.ratio>=4.5,JSON.stringify(c));
   assert.deepEqual(s.errors,[]);
   if(out&&[390,768,1180,1440,1920].includes(width)){
    fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('img.wxi').forEach(wxiFail);document.querySelectorAll('.context-toggle[aria-expanded="false"]').forEach(b=>b.click());});
    await p.clock.runFor(500);await p.evaluate(()=>layoutMasonry());
    await p.waitForFunction(()=>{const boxes=[...document.querySelectorAll('.masonry>.card')].map(c=>c.getBoundingClientRect()).filter(r=>r.width&&r.height);return boxes.every((a,i)=>boxes.slice(i+1).every(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1));});
    // Explicit QA label belongs only to captured test evidence, never to served production markup.
    await p.evaluate(()=>{const n=document.createElement('p');n.textContent='VISUAL QA • deterministic sample weather and test map tiles • not a live forecast';n.style.cssText='font:12px system-ui;color:var(--muted);margin:0 0 12px';document.querySelector('header').before(n);});
    await p.screenshot({path:path.join(out,engine+'-'+width+'-'+theme+'.png'),fullPage:true});
    await p.screenshot({path:path.join(out,engine+'-'+width+'-'+theme+'-first-screen.png')});
   }
   if(width>1000){s.change(config('forecast outage',{maps:true,hourlyDown:true,dailyDown:true}));await p.evaluate(()=>loadForecast());const mapBox=await p.locator('#radar').boundingBox();assert(mapBox.height>=277.5,'Working radar keeps its 280px framed minimum when forecasts are unavailable: '+JSON.stringify(mapBox));}
   report.push({width,theme,status:'passed',planning:boxes,renderedMap:radarSize,loadedTiles,forecastRowHeights:rowHeights});console.log('PASS '+engine+' '+width+' '+theme);
  }finally{await s.context.close();}
 }
 // A short fallback must not stand in for a fully rendered map during layout review.
 for(const width of [390,768,1180,1440,1920])for(const theme of ['dark','light']){
  const scenario=config('map failure layout',{maps:true,mapLibrariesDown:true,touch:width<768,aqi:32});
  const s=await open(scenario,width),p=s.page;
  try{
   await p.evaluate(t=>applyTheme(t),theme);
   await p.locator('#radar [data-retry-maps]').waitFor();
   const boxes=await p.evaluate(()=>Object.fromEntries(['h24Card','radarCard','forecastCard'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[id,{x:r.x,y:r.y,right:r.right,bottom:r.bottom}];})));
   if(width>1000){
    assert(Math.abs(boxes.h24Card.y-boxes.radarCard.y)<2);
    assert(Math.abs(boxes.forecastCard.x-boxes.radarCard.x)<2);
    assert(boxes.forecastCard.y-boxes.radarCard.bottom<=96,'Failure state must not leave a large band above Week');
    assert(boxes.radarCard.bottom-boxes.radarCard.y<400,'Failure panel stays compact');
   }else {assert(boxes.radarCard.y>=boxes.h24Card.bottom);assert(boxes.forecastCard.y>=boxes.radarCard.bottom);}
   assert(await p.locator('#radar a[href="https://radar.weather.gov/station/KLSX/standard"]').isVisible());
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(out){
    fs.mkdirSync(out,{recursive:true});await p.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('img.wxi').forEach(wxiFail);const n=document.createElement('p');n.textContent='VISUAL QA • deterministic sample weather • map startup failure';n.style.cssText='font:12px system-ui;color:var(--muted);margin:0 0 12px';document.querySelector('header').before(n);});
    await p.clock.runFor(500);await p.evaluate(()=>layoutMasonry());
    await p.screenshot({path:path.join(out,engine+'-'+width+'-'+theme+'-map-failure.png'),fullPage:true});
   }
   s.change({...scenario,mapLibrariesDown:false});await p.locator('#radar [data-retry-maps]').click();
   await p.waitForFunction(()=>document.querySelectorAll('#radar .leaflet-tile-loaded').length>0);
   if(width>1000)await p.waitForFunction(()=>Math.abs(document.getElementById('radarCard').getBoundingClientRect().bottom-document.getElementById('forecastCard').getBoundingClientRect().bottom)<2);
   assert.equal(await p.locator('#radar .leaflet-map-pane').count(),1);assert.equal(await p.locator('#radar .leaflet-map-pane').evaluate(e=>getComputedStyle(e).position),'absolute');assert(await p.locator('#radar .leaflet-control-zoom').isVisible());assert(await p.locator('#radar .leaflet-tile-loaded').first().isVisible());assert.equal(await p.locator('#radar [data-retry-maps]').count(),0);
   assert.deepEqual(s.errors,[]);
   report.push({width,theme,mapState:'failure and retry',status:'passed',failurePlanning:boxes,recoveredMap:await p.locator('#radar').boundingBox(),recoveredTiles:await p.locator('#radar .leaflet-tile-loaded').count()});console.log('PASS '+engine+' '+width+' '+theme+' failure/retry');
  }finally{await s.context.close();}
 }
 }finally{await browser.close();}
 if(out)fs.writeFileSync(path.join(out,engine+'-layout-report.json'),JSON.stringify(report,null,2));
 console.log(report.length+' layout/interaction cases passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
