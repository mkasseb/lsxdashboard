#!/usr/bin/env node
'use strict';
// Paired controlled experiment, not a physical-phone or live-network benchmark.
const fs=require('fs');
const {chromium}=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});setBrowser(browser);
  const samples=[];
  try{
    for(let pair=0;pair<5;pair++)for(const eagerContext of (pair%2?[false,true]:[true,false])){
      const started=Date.now();
      const session=await open(config('context measurement',{maps:true,aqi:35,climateFixture:true,measure:true,eagerContext}),390);
      const {page,context,requests}=session;
      try{
        const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
        await page.waitForFunction(()=>mapsInFlight===null&&rvMap&&radarFrames.length>1&&radarFrames.every(f=>f.layer._ok>0));
        const state=await page.evaluate(()=>({stationMap:!!stnMap,deepContext:deferredFeeds.context,weatherReady:feedChecks.hourly.status==='ready'&&feedChecks.current.status==='ready',heap:performance.memory?.usedJSHeapSize}));
        const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
        samples.push({pair,eagerContext,readyMs:Date.now()-started,requests:requests.length,observationRequests:requests.filter(u=>u.includes('/observations/latest')).length,acisRequests:requests.filter(u=>u.includes('rcc-acis.org')).length,documents:metrics.Documents,nodes:metrics.Nodes,layoutCount:metrics.LayoutCount,...state});
        if(session.errors.length)throw Error(session.errors.join('; '));
        console.log(JSON.stringify(samples.at(-1)));
      }finally{await context.close();}
    }
  }finally{await browser.close();}
  const report={method:'Five alternating paired fresh contexts, 390x900 viewport, Chromium, 4x CPU throttle, fixed 80ms latency per controlled external request. Real pinned map libraries with controlled empty style and PNG tiles; synthetic weather/ACIS payloads. Eager variant changes only initial deferred-demand state in the served test asset. readyMs is Node wall time through current/hourly refresh and successful radar frames, not LCP or physical-phone speed. Counts quantify avoided startup work, not actual live bandwidth.',samples};
  fs.writeFileSync(process.env.CONTEXT_REPORT||'/tmp/context-performance.json',JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
