#!/usr/bin/env node
'use strict';
// Read-only exact-head preview verification. Original live feeds, default TLS; no routed fixtures.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.join(__dirname,'..'),out=process.argv[2],sha=process.env.EXPECTED_SHA;
const audit={startedAt:new Date().toISOString(),commit:sha,tls:'Default certificate validation',live:[],errors:[]};
const model=JSON.parse(fs.readFileSync(path.join(root,'data/nbm-range.json')));
async function evidence(page){return page.evaluate(data=>{
 const result=NbmRange.validate(data,current,Date.now()),paired=NbmRange.align(smart.days,result.periods||[],Date.now());
 return {sourceRun:data.run,status:result.status,cell:result.cell,location:current,forecast:smart.days,
  matches:paired.matches.map(m=>({row:m.row,part:m.part,exact:m.exact,
   range:(m.part==='day'?'High ':'Low ')+Math.round(m.nbm.p25)+'–'+Math.round(m.nbm.p75)+'°F',
   official:'NWS '+(m.part==='day'?'high ':'low ')+m.nws.temperature+'°F · '+NbmRange.local(m.nws.startTime)+' – '+NbmRange.local(m.nws.endTime),
   model:'NBM '+(m.part==='day'?'maximum':'minimum')+' · P25 '+Math.round(m.nbm.p25)+'°F · median (P50) '+Math.round(m.nbm.p50)+'°F · P75 '+Math.round(m.nbm.p75)+'°F',
   interval:(m.exact?'Same interval: ':'Different interval (18 hours): ')+NbmRange.local(m.nbm.start)+' – '+NbmRange.local(m.nbm.end)
  })),checks:{daily:feedChecks.daily,model:feedChecks.nbmRange}};
 },model);}
async function shot(page,name){await page.waitForTimeout(350);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#forecastCard').screenshot({path:path.join(out,name+'.png'),style:'.jump-wrap,.skip{visibility:hidden !important}'});}
async function main(){
 assert(/^[a-f0-9]{40}$/.test(sha||''));assert.equal(cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sha);
 const parent=JSON.parse(fs.readFileSync(path.join(out,'..','verification.json')));
 assert.equal(parent.result,'passed');assert.equal(parent.commit,sha);assert.equal(parent.target,'preview');assert(parent.assets.length>=14);
 assert(/^https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev$/.test(parent.origin));audit.origin=parent.origin;audit.assetEvidence='../verification.json';
 const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
 try{for(const width of [390,1440]){
  const timezone=width===390?'Asia/Tokyo':'America/Chicago',context=await browser.newContext({viewport:{width,height:1000},timezoneId:timezone}),page=await context.newPage(),nws=[],pending=[];
  page.on('pageerror',e=>audit.errors.push({width,error:e.message}));
  page.on('response',r=>{if(/^https:\/\/api\.weather\.gov\/gridpoints\/[^/]+\/[^/]+\/forecast$/.test(r.url()))pending.push(r.json().then(payload=>nws.push(payload)).catch(()=>{}));});
  try{
   assert((await page.goto(parent.origin+'/?guidance-preview='+sha,{waitUntil:'domcontentloaded',timeout:60000})).ok());
   await page.waitForFunction(()=>typeof refreshInFlight!=='undefined'&&refreshInFlight===null&&smart.days.length===7&&feedChecks.daily.status==='ready'&&feedChecks.nbmRange.status!=='loading',null,{timeout:90000});
   await Promise.all(pending);assert(nws.length,'Actual NWS response required');
   // Independently preserve the issued NWS values and prose, including its day/night pairing.
   const original=await page.evaluate(payloads=>payloads.some(f=>JSON.stringify(pairForecastPeriods(f.properties.periods.slice(0,15)).slice(0,7))===JSON.stringify(smart.days)),nws);assert(original,'Displayed days equal an original live NWS response');
   const before=await page.locator('#daily .day,.dd-text').allTextContents(),facts=await evidence(page);
   assert.equal(await page.locator('.normal-inline,.record-inline').count(),0);assert.equal(await page.locator('.normal-detail,.record-detail').count(),14);
   assert.equal(await page.locator('.nbm-period-detail h3').count(),0);
   assert(await page.locator('.nbm-timing').evaluateAll(rows=>rows.every(e=>!e.open)),'Technical details start collapsed');
   assert(await page.locator('#daily .day').evaluateAll(rows=>rows.every(e=>e.getAttribute('aria-expanded')==='false')));
   assert.equal(await page.locator('#daily .nbm-inline,#daily .nbm-unavailable').count(),7);
   assert(await page.locator('#daily .nbm-inline,#daily .nbm-unavailable').evaluateAll(rows=>rows.every(e=>e.getClientRects().length>0&&!e.closest('.day-detail')&&e.previousElementSibling.classList.contains('day'))),'Every collapsed row visibly contains model guidance or its unavailable state');
   if(!facts.matches.length){
    assert.equal(await page.locator('.nbm-inline,.nbm-timing').count(),0,'Expired/unavailable model values stay withheld');
    assert.equal(await page.locator('.nbm-unavailable').count(),7,'Unavailable guidance remains explicit while collapsed');
    if(facts.status==='stale')assert(await page.locator('.nbm-unavailable').evaluateAll(rows=>rows.every(e=>e.textContent.includes('data expired'))));
    const day=page.locator('#daily .day').first();await day.click();assert.match(await page.locator('.nbm-range-note').first().innerText(),/unavailable/);await day.click();
   }
   for(const row of [...new Set(facts.matches.map(m=>m.row))]){
    const item=page.locator('#daily .day-item').nth(row),matches=facts.matches.filter(m=>m.row===row);
    for(const m of matches)assert((await item.locator('.nbm-inline').innerText()).includes(m.range));
    assert(await item.locator('.nbm-inline').evaluate(e=>e.previousElementSibling.classList.contains('day')));
    const day=item.locator('.day');await day.focus();await day.press('Enter');
    assert.equal(await day.getAttribute('aria-expanded'),'true','NWS day opens by keyboard at row '+row+' / '+width);
    const detail=item.locator('.nbm-period-detail'),timing=item.locator('.nbm-timing'),summary=timing.locator('summary');
    assert.match(await detail.innerText(),/middle 50%.*Higher or lower outcomes remain possible/);
    assert(!/P25|P50|P75|NWS high|NWS low|CDT|CST/.test(await detail.innerText()),'Technical values and times remain hidden');
    const different=matches.filter(m=>!m.exact).length;
    assert.equal(await item.locator('.nbm-period-note').count(),different?1:0);
    if(different)assert.match(await item.locator('.nbm-period-note').innerText(),different===matches.length?/different 18-hour periods/:/Some NBM periods differ/);
    assert.equal(await item.locator('.nbm-comparison').first().isVisible(),false);
    // Climate can repaint between separate locator reads. Find and measure the
    // current control atomically in the page, retrying until native layout is ready.
    await page.waitForFunction(row=>{const s=document.querySelectorAll('#daily .day-item')[row]?.querySelector('.nbm-timing > summary');return s&&s.getClientRects().length>0&&s.getBoundingClientRect().height>=44;},row);
    await summary.focus();await summary.press('Enter');assert(await timing.evaluate(e=>e.open));
    assert.deepEqual(await item.locator('.nbm-comparison').evaluateAll(rows=>rows.map(r=>({official:r.querySelector('.nbm-official').textContent,model:r.querySelector('.nbm-model').textContent,interval:r.querySelector('.nbm-window-note').textContent}))),matches.map(({official,model,interval})=>({official,model,interval})));
    assert(await item.locator('.nbm-comparison').first().isVisible());
    await summary.press('Space');assert.equal(await timing.evaluate(e=>e.open),false);await day.focus();await day.press('Enter');
   }
   const selectedRow=facts.matches.find(m=>m.part==='day')?.row??0,item=page.locator('#daily .day-item').nth(selectedRow),day=item.locator('.day');
   for(const theme of ['light','dark']){
    await page.evaluate(t=>applyTheme(t),theme);await shot(page,`live-${width}-${theme}-collapsed`);
    await day.click();await shot(page,`live-${width}-${theme}-simple`);
    if(await item.locator('.nbm-timing').count()){
     const timing=item.locator('.nbm-timing'),summary=timing.locator('summary');await summary.focus();await summary.press('Enter');await shot(page,`live-${width}-${theme}-technical`);
     await page.evaluate(()=>loadForecast._paint());assert(await timing.evaluate(e=>e.open));assert(await summary.evaluate(e=>e===document.activeElement));
     await page.evaluate(()=>loadNbmRange());assert(await timing.evaluate(e=>e.open));assert(await summary.evaluate(e=>e===document.activeElement));
     await summary.press('Enter');
    }
    await day.click();
   }
   assert.deepEqual(await page.locator('#daily .day,.dd-text').allTextContents(),before,'Model and presentation repaints preserve NWS values/prose');
   await page.evaluate(()=>{document.documentElement.style.fontSize='200%';layoutMasonry();});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.evaluate(()=>{snapSafeSeq=locSeq;saveSnapshot();});
   assert(!/nbm-|normal-detail|record-detail/.test(await page.evaluate(()=>JSON.parse(localStorage.getItem(SNAP_KEY)).parts.daily)),'Supplemental values are excluded from NWS snapshots');
   audit.live.push({width,timezone,...facts,interactions:'Native Enter/Space, refresh open state and focus, both themes, 200% text, NWS snapshot boundary'});
  }finally{await context.close();}
 }}finally{await browser.close();}
 assert.deepEqual(audit.errors,[]);audit.result='passed';
}
fs.mkdirSync(out,{recursive:true});main().catch(e=>{audit.result='failed';audit.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>{audit.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify({result:audit.result,commit:sha,origin:audit.origin,live:audit.live.map(x=>({width:x.width,status:x.status,matches:x.matches.length})),errors:audit.errors}));});
