#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const engine=process.env.WEATHER_BROWSER||'chromium',out=process.env.REDESIGN_ARTIFACTS;
async function settled(p){
 // ResizeObserver and the native layout engine may run after Playwright's clock RAF.
 // Wait for stable rendered geometry, without moving or correcting the camera in the test.
 let last='',stable=0;
 try{await p.waitForFunction(()=>rvMap&&document.querySelector('#radar .leaflet-tile-loaded'));
  for(let i=0;i<60;i++){
   const state=await p.evaluate(()=>{
    const r=radar.getBoundingClientRect(),m=rvMarker.getElement().getBoundingClientRect(),sz=rvMap.getSize();
    return{size:[sz.x,sz.y],dom:[radar.clientWidth,radar.clientHeight],box:[r.x,r.y,r.width,r.height],pin:[m.x,m.y],pan:!!(rvMap._panAnim&&rvMap._panAnim._inProgress),zoom:!!rvMap._animatingZoom};
   });
   const key=JSON.stringify(state);
   stable=key===last?stable+1:0;last=key;
   if(stable>=5&&state.size.every((v,i)=>v===state.dom[i])&&!state.pan&&!state.zoom)return;
   await p.waitForTimeout(100);
  }
  throw new Error('Radar geometry did not settle: '+last);
 }catch(e){console.error('RADAR_SETTLE',last,await p.evaluate(()=>({map:!!rvMap,tiles:document.querySelectorAll('#radar .leaflet-tile-loaded').length,retry:!!document.querySelector('[data-retry-maps]'),size:rvMap&&rvMap.getSize(),dom:[radar.clientWidth,radar.clientHeight]})));throw e;}
}
async function geometry(p){return p.evaluate(()=>{
 const r=radar.getBoundingClientRect(),m=rvMarker.getElement().getBoundingClientRect(),c=rvMap.getCenter(),pin=rvMarker.getLatLng(),gl=rvBase._glMap.getCenter(),gp=rvMap.project([gl.lat,gl.lng]),cp=rvMap.project(c);
 return{current:[current.lat,current.lon],marker:[pin.lat,pin.lng],center:[c.lat,c.lng],zoom:rvMap.getZoom(),size:[r.width,r.height],offset:[m.x+m.width/2-r.x-r.width/2,m.y+m.height/2-r.y-r.height/2],baseError:gp.distanceTo(cp)};
});}
function centered(g){assert.deepEqual(g.marker,g.current,'Marker coordinates match selected forecast point');assert(Math.hypot(...g.offset)<2,'Full-canvas marker offset '+JSON.stringify(g));assert(g.baseError<2,'Vector base and Leaflet agree '+JSON.stringify(g));}
function sameCamera(a,b){assert.equal(b.zoom,a.zoom);assert(Math.hypot(b.offset[0]-a.offset[0],b.offset[1]-a.offset[1])<2,'Resize/scroll must preserve deliberate pan '+JSON.stringify({a,b}));assert(b.baseError<2);}
(async()=>{const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']}: {})});setBrowser(browser);const report=[];
try{for(const width of [1180,1440,1920]){
 const s=await open(config('radar camera',{maps:true,geo:{lat:38.4328,lon:-90.3776},storage:{lsxLoc:{name:'Lake St. Louis, MO',lat:38.8,lon:-90.79,precision:'representative'}}}),width),p=s.page,steps=[];
 try{
  await settled(p);centered(await geometry(p));steps.push({state:'saved location startup',...await geometry(p)});
  // Preserve the same forced asynchronous geolocation boundary as the browser API.
  await p.evaluate(()=>{navigator.geolocation.getCurrentPosition=cb=>{window.cameraGeo=cb;};document.getElementById('h24Card').style.minHeight='1200px';});await settled(p);
  await p.locator('#geoBtn').click();await p.waitForFunction(()=>!!window.cameraGeo);
  await p.evaluate(()=>window.cameraGeo({coords:{latitude:38.4328,longitude:-90.3776,accuracy:25}}));
  await p.waitForFunction(()=>current.lat===38.4328&&snapSafeSeq===locSeq);await settled(p);centered(await geometry(p));steps.push({state:'asynchronous geolocation and forecast resize',...await geometry(p)});
  // City search/favorites use this same verified-location entry point.
  await p.evaluate(async()=>{
   await chooseVerifiedLocation({name:'Columbia, MO',lat:38.9517,lon:-92.3341,station:null,precision:'representative'},{save:true});
   // Force the real resize interleaving before a legacy animated pan can finish.
   document.getElementById('h24Card').style.minHeight='1600px';rvMap.invalidateSize({animate:false});
  });
  await p.waitForFunction(()=>current.lat===38.9517&&snapSafeSeq===locSeq);await settled(p);centered(await geometry(p));steps.push({state:'selected town and forecast resize',...await geometry(p)});
  // Reproduce a transient reset that returns to the previously observed height:
  // ResizeObserver need not report it, but loadRadar has measured the smaller canvas.
  await p.evaluate(()=>{const card=document.getElementById('h24Card');card.style.minHeight='1200px';loadRadar();card.style.minHeight='1600px';});
  await settled(p);centered(await geometry(p));steps.push({state:'transient resize returns to previously observed height',...await geometry(p)});
  await p.evaluate(()=>{document.getElementById('h24Card').style.minHeight='';});await settled(p);centered(await geometry(p));
  // Real map camera operations; resizing may not snap a deliberately explored view home.
  await p.evaluate(()=>{rvMap.setZoom(8,{animate:false});rvMap.panBy([130,80],{animate:false});});await settled(p);const chosen=await geometry(p);assert(Math.hypot(...chosen.offset)>100);
  await p.evaluate(()=>{document.getElementById('h24Card').style.minHeight='1400px';});await settled(p);sameCamera(chosen,await geometry(p));
  await p.setViewportSize({width:width===1180?1440:1180,height:900});await settled(p);sameCamera(chosen,await geometry(p));
  await p.evaluate(()=>{window.scrollTo(0,radar.getBoundingClientRect().top+scrollY+250);});await settled(p);sameCamera(chosen,await geometry(p));steps.push({state:'user pan/zoom survives content resize, viewport resize and scroll',...await geometry(p)});
  await p.evaluate(()=>setRadarFull(true));await settled(p);sameCamera(chosen,await geometry(p));await p.evaluate(()=>setRadarFull(false));await settled(p);sameCamera(chosen,await geometry(p));
  assert.deepEqual(s.errors,[]);report.push({width,steps});console.log('PASS '+engine+' radar camera '+width);
 }finally{await s.context.close();}
}
const s=await open(config('radar camera retry',{maps:true,mapLibrariesDown:true}),1440),p=s.page;
try{await p.locator('#radar [data-retry-maps]').waitFor();await p.evaluate(()=>chooseVerifiedLocation({name:'Arnold, MO',lat:38.4328,lon:-90.3776,station:null,precision:'representative'},{save:true}));await p.waitForFunction(()=>snapSafeSeq===locSeq);s.change(config('radar recovered',{maps:true}));await p.locator('#radar [data-retry-maps]').click();await settled(p);centered(await geometry(p));assert.deepEqual(s.errors,[]);report.push({width:1440,steps:[{state:'retry uses latest selected point',...await geometry(p)}]});console.log('PASS '+engine+' radar camera fallback/retry');}finally{await s.context.close();}
}finally{await browser.close();}
if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,engine+'-radar-camera-report.json'),JSON.stringify(report,null,2));}console.log(report.length+' radar camera cases passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
