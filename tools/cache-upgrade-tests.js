#!/usr/bin/env node
'use strict';
// Uses a real HTTP cache: Playwright request routing would disable the behavior under test.
const http=require('http'),fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('node:assert/strict');
const playwright=require('playwright'),root=path.join(__dirname,'..');
const legacy='f8976ef0d8101528cec520ff886bb278096f271c';
const names=['dashboard.css','weather-core.js','weather-feeds.js','forecast-view.js','dashboard-context.js','dashboard.js'];
const currentNames=[...names,'forecast-range.js','hourly-range.js'];
const quartileLegacy='3e4ed1634acd2b3caefd86cca94a08d43f1fb18f';
const old=Object.fromEntries(names.map(name=>[name,cp.execFileSync('git',['show',legacy+':assets/'+name],{cwd:root,maxBuffer:10*1024*1024})]));
const vendors=[['leaflet/1.9.4/leaflet.min.js','leaflet/dist/leaflet.js'],['leaflet/1.9.4/leaflet.min.css','leaflet/dist/leaflet.css'],['maplibre-gl@5.24.0/dist/maplibre-gl.js','maplibre-gl/dist/maplibre-gl.js'],['maplibre-gl@5.24.0/dist/maplibre-gl.css','maplibre-gl/dist/maplibre-gl.css'],['@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js','@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js']];
let priming=true,quartileMode=false,unversioned=false,requests=[],base;
function controlled(text){
  // Preserve real local cache semantics; external map resources and ancillary outages are deterministic.
  return text.replace(/https:\/\/cdnjs.cloudflare.com\/ajax\/libs\//g,base+'/vendor/').replace(/https:\/\/cdn.jsdelivr.net\/npm\//g,base+'/vendor/')
    .replace(/https:\/\/tiles.openfreemap.org/g,base+'/style').replace(/https:\/\/opengeo.ncep.noaa.gov/g,base+'/radar').replace(/https:\/\/gibs.earthdata.nasa.gov/g,base+'/sat')
    .replace(/https:\/\/([a-zA-Z0-9.-]+)/g,base+'/external/$1');
}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,base),p=u.pathname;requests.push(req.url);
  if(p==='/'||p==='/old'){
    let html=(priming?cp.execFileSync('git',['show',(quartileMode?quartileLegacy:legacy)+':index.html'],{cwd:root,maxBuffer:10*1024*1024}).toString():fs.readFileSync(path.join(root,'index.html'),'utf8')).replace(/integrity="[^"]*"/g,'');
    if(unversioned)html=html.replace(/\?v=[a-f0-9]+/g,'');
    res.setHeader('Cache-Control','public, max-age=0, must-revalidate');res.setHeader('Content-Type','text/html');res.end(controlled(html));return;
  }
  if(p.startsWith('/assets/')){
    const name=path.basename(p);if(!(priming&&!quartileMode?names:currentNames).includes(name)){res.writeHead(404).end();return;}
    res.setHeader('Cache-Control',priming?'public, max-age=14400, must-revalidate':'no-cache, max-age=0, must-revalidate');
    res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'application/javascript');
    res.end(controlled(priming?(quartileMode?cp.execFileSync('git',['show',quartileLegacy+':assets/'+name],{cwd:root,maxBuffer:10*1024*1024}).toString():old[name].toString()):fs.readFileSync(path.join(root,'assets',name),'utf8')));return;
  }
  if(p.startsWith('/data/')&&quartileMode){
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','public, max-age=14400');
    // Simulate an old response surviving the app rollout. WebKit may evict these
    // large bodies and re-request them; both cache reuse and revalidation must
    // withhold the same legacy bytes. Chromium/Firefox still exercise cache reuse.
    res.end(cp.execFileSync('git',['show',quartileLegacy+':'+p.slice(1)],{cwd:root,maxBuffer:10*1024*1024}));return;
  }
  if(p.startsWith('/external/')){res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Controlled ancillary outage'}));return;}
  const vendor=vendors.find(([part])=>p==='/vendor/'+part);
  if(vendor){res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'application/javascript');res.end(fs.readFileSync(require.resolve(vendor[1])));return;}
  if(p.startsWith('/style/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#18202d'}}]}));return;}
  if(p.startsWith('/radar/')||p.startsWith('/sat/')){
    if(/GetCapabilities|DescribeDomains/.test(req.url)){res.setHeader('Content-Type','text/xml');res.end('<Dimension name="time">'+Array.from({length:15},(_,i)=>new Date(Date.now()-(14-i)*120000).toISOString()).join(',')+'</Dimension>');return;}
    res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));return;
  }
  res.writeHead(404).end();
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  const engine=process.env.WEATHER_BROWSER||'chromium';
  const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']}:{}),...(engine==='firefox'?{firefoxUserPrefs:{'webgl.force-enabled':true,'webgl.disabled':false,'webgl.enable-webgl2':true,'gfx.webrender.software':true}}:{})});
  try{for(const baseline of [true,false]){
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    try{
      priming=true;unversioned=baseline;
      await page.goto(base+'/old',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelectorAll('.context-toggle').length===6);
      // Controls appear before asynchronous map bootstrap. Prime a fully rendered legacy
      // page before testing cache reuse, rather than navigating during its WebGL startup.
      await page.waitForFunction(()=>typeof rvMap!=='undefined'&&rvMap&&radarFrames.length>1&&radarFrames.some(f=>f.layer._ok>0),{},{timeout:30000});
      await page.waitForLoadState('networkidle');
      assert.deepEqual(errors,[],'old page loads before upgrade');
      priming=false;requests=[];
      await page.goto(base+'/',{waitUntil:'domcontentloaded'});
      if(baseline){
        await page.waitForFunction(()=>document.querySelectorAll('.context-toggle').length===6);
        await page.waitForTimeout(100);
        assert(errors.some(e=>/addEventListener|compact/.test(e)),JSON.stringify({errors,requests,diagnostics:await page.locator('.map-diagnostics').count()}));
        assert.equal(await page.locator('.map-diagnostics').count(),0);
        assert.equal(await page.locator('#radar').innerHTML(),'');
        assert.equal(requests.filter(p=>p.startsWith('/assets/')&&names.includes(path.basename(new URL(p,base).pathname))).length,0,'old assets reused without network');
        assert.equal(requests.filter(p=>p==='/assets/forecast-range.js').length,1,'new optional asset is not in the legacy cache');
        console.log('PASS negative control: cached PR49 scripts + unversioned new HTML reproduce blank radar and missing diagnostics');
      }else{
        await page.waitForFunction(()=>typeof rvMap!=='undefined'&&rvMap&&radarFrames.length>1&&radarFrames.some(f=>f.layer._ok>0),{},{timeout:30000});
        assert.deepEqual(errors,[]);
        for(const name of currentNames)assert(requests.some(p=>new RegExp('^/assets/'+name.replaceAll('.','\\.')+'\\?v=[a-f0-9]{16}$').test(p)),name+' fetched at new version URL');
        assert.equal(await page.locator('.map-diagnostics').count(),1);
        assert.equal(await page.locator('#radar .leaflet-map-pane').count(),1);
        assert.equal(await page.locator('#radar .leaflet-control-zoom').count(),1);
        assert.equal(await page.locator('.context-toggle').count(),6);
        console.log('PASS versioned upgrade: all current assets fetched, no handler crash, rendered radar tiles/controls and diagnostics');
      }
    }finally{await context.close();}
  }
  quartileMode=true;priming=true;unversioned=false;
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(base+'/old',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof NbmRange!=='undefined'&&typeof NbmHourly!=='undefined');
    const oldData=await page.evaluate(async()=>({daily:await(await fetch('/data/nbm-range.json')).json(),hourly:await(await fetch('/data/nbm-hourly.json')).json()}));
    assert.equal(oldData.daily.schema,2);assert.equal(oldData.hourly.schema,1);
    await page.evaluate(()=>localStorage.setItem('lsxSnap_v21','legacy P10/P90 snapshot sentinel'));
    priming=false;requests=[];
    await page.goto(base+'/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.readyState==='complete'&&typeof SNAP_KEY!=='undefined'&&SNAP_KEY==='lsxSnap_v22'&&typeof NbmRange!=='undefined'&&typeof NbmHourly!=='undefined');
    const retained=await page.evaluate(async()=>{
      const d=await(await fetch('/data/nbm-range.json')).json(),h=await(await fetch('/data/nbm-hourly.json')).json(),p={lat:38.8,lon:-90.79};
      return {dailySchema:d.schema,hourlySchema:h.schema,daily:NbmRange.validate(d,p,Date.parse(d.retrievedAt)).status,hourly:NbmHourly.validate(h,p,Date.parse(h.retrievedAt)).status,oldSnapshot:localStorage.getItem('lsxSnap_v21')};
    });
    assert.deepEqual(retained,{dailySchema:2,hourlySchema:1,daily:'unavailable',hourly:'unavailable',oldSnapshot:null});
    const dataRequests=requests.filter(p=>p.startsWith('/data/nbm-')).length;
    if(engine!=='webkit')assert.equal(dataRequests,0,'Actual browser HTTP cache retains old payloads during upgrade');
    assert.equal(await page.locator('.nbm-inline,.nbm-hourly-band,#nbmBriefNote').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS old P10/P90 data withheld by new quartile schemas; v21 snapshot discarded; versioned assets loaded; '+dataRequests+' data requests after cache priming');
  }finally{await context.close();}
  }finally{await browser.close();server.close();}

})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
