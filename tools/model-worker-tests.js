#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),zlib=require('node:zlib'),http=require('node:http'),assert=require('node:assert/strict');
const {html,assets}=require('./source');
const playwright=require('playwright'),{open,config,setBrowser}=require('./weather-stress-tests');
const engine=process.env.WEATHER_BROWSER||'chromium';
const daily=JSON.parse(zlib.gunzipSync(fs.readFileSync('tools/fixtures/weather/nbm-quartile-daily-recorded.json.gz')));
const hourly=JSON.parse(zlib.gunzipSync(fs.readFileSync('tools/fixtures/weather/nbm-quartile-hourly-recorded.json.gz')));
const now=Math.max(Date.parse(daily.retrievedAt),Date.parse(hourly.retrievedAt));
async function routes(page){
  await page.route('**/data/nbm-range.json',r=>r.fulfill({json:daily}));
  await page.route('**/data/nbm-hourly.json',r=>r.fulfill({json:hourly}));
}
(async()=>{
 let failWorker=false;
 const csp=fs.readFileSync('_headers','utf8').match(/Content-Security-Policy: (.*)/)[1];
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname,asset=assets[name];
  res.setHeader('Content-Security-Policy',csp);res.setHeader('Cache-Control','no-store');
  if(name==='/assets/model-worker.js'&&failWorker){res.writeHead(503).end();return;}
  res.writeHead(name==='/'||asset?200:404,{'Content-Type':name==='/'?'text/html':asset?.type||'text/plain'});
  res.end(name==='/'?html:asset?.content||'');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{})});setBrowser(browser);
  const s=await open(config('Worker validation',{now,origin,productionCsp:true}));
  try{
   const p=s.page;await routes(p);
   await p.evaluate(()=>{
    window.workerJobs=[];window.workerErrors=[];const NativeWorker=Worker;
    window.Worker=function(url){const worker=new NativeWorker(url),send=worker.postMessage.bind(worker);window.testModelWorker=worker;
     worker.addEventListener('error',e=>workerErrors.push(e.message||e.type));
     worker.postMessage=function(job,transfer){if(job.kind)workerJobs.push({kind:job.kind,bytes:job.buffer.byteLength});return send(job,transfer);};return worker;};
    NbmRange.validate=NbmHourly.validate=function(){throw new Error('UI thread must not validate regional model data');};
   });
   await p.evaluate(()=>Promise.all([loadNbmRange(),loadNbmHourly()]));
   assert.deepEqual(await p.evaluate(()=>workerJobs.map(j=>j.kind).sort()),['daily','hourly'],JSON.stringify(await p.evaluate(()=>({workerErrors,feeds:[feedChecks.nbmRange,feedChecks.nbmHourly]}))));
   assert(await p.evaluate(()=>workerJobs.every(j=>j.bytes>1000000)));
   assert.equal(await p.evaluate(()=>feedChecks.nbmRange.status),'ready');
   assert.equal(await p.evaluate(()=>feedChecks.nbmHourly.status),'ready');
   await p.evaluate(()=>{for(let i=0;i<10;i++){loadForecast._paint();renderHourly24();}});
   assert.equal(await p.evaluate(()=>workerJobs.length),2,'Repaints reuse selected-point validation');
   // Cancellation must settle without waiting for a worker response, and ignore it later.
   await p.evaluate(()=>{
    window.modelMessage=testModelWorker.onmessage;
    testModelWorker.onmessage=function(e){if(e.data.cache)window.heldModelMessage=e;else modelMessage(e);};
    window.modelAbort=new AbortController();
    window.cancelledModel=ModelData.load('hourly',{lat:current.lat,lon:current.lon},modelAbort.signal)
     .then(()=> 'unexpected success',e=>e.name);
   });
   await p.waitForFunction(()=>!!window.heldModelMessage);
   await p.evaluate(()=>modelAbort.abort());assert.equal(await p.evaluate(()=>cancelledModel),'AbortError');
   await p.evaluate(()=>{modelMessage(heldModelMessage);testModelWorker.onmessage=modelMessage;});
   // A broken response settles as unavailable; it cannot terminate the shared worker.
   await p.route('**/data/nbm-range.json',r=>r.fulfill({body:'{broken',contentType:'application/json'}));
   await p.evaluate(()=>loadNbmRange());assert.equal(await p.evaluate(()=>feedChecks.nbmRange.status),'unavailable');
   await p.unroute('**/data/nbm-range.json');await routes(p);await p.evaluate(()=>loadNbmRange());
   assert.equal(await p.evaluate(()=>feedChecks.nbmRange.status),'ready');
   assert.deepEqual(s.errors,[]);console.log('PASS actual worker under production CSP, transferred regional bytes, cached repaints, cancellation/late replies and malformed-response recovery');
  }finally{await s.context.close();}
  for(const mode of ['constructor','startup']){
   failWorker=mode==='startup';
   const fallback=await open(config('Worker fallback',{now,origin}));
   try{
    const p=fallback.page;await routes(p);
    if(mode==='constructor')await p.evaluate(()=>{window.Worker=function(){throw new Error('Workers unavailable');};});
    await p.evaluate(()=>{
     window.mainValidations=0;
     [NbmRange,NbmHourly].forEach(api=>{const validate=api.validate;api.validate=function(...args){mainValidations++;return validate.apply(api,args);};});
    });
    await p.evaluate(()=>Promise.all([loadNbmRange(),loadNbmHourly()]));
    assert.equal(await p.evaluate(()=>mainValidations),2);
    assert.equal(await p.evaluate(()=>feedChecks.nbmRange.status),'ready');assert.equal(await p.evaluate(()=>feedChecks.nbmHourly.status),'ready');
    await p.evaluate(()=>{loadForecast._paint();renderHourly24();});
    assert.equal(await p.evaluate(()=>mainValidations),2);assert.deepEqual(fallback.errors,[]);
    console.log('PASS '+mode+' failure falls back once per response and caches validation');
   }finally{await fallback.context.close();}
  }
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
