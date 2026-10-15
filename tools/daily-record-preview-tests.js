#!/usr/bin/env node
'use strict';
// Read-only verification of an immutable PR preview. Default TLS, exact bytes, live normal and record sources.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {chromium,request}=require('playwright'),root=path.join(__dirname,'..'),out=process.argv[2]||'/tmp/records-hosted',sha=process.env.EXPECTED_SHA;
const audit={startedAt:new Date().toISOString(),commit:sha,tls:'Default certificate validation',assets:[],live:[],errors:[],sourceFailures:[]};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let origin=process.env.PREVIEW_URL;
function independent(payload,date,asOf,col,max){
 const values=new Map();
 for(const row of payload.data||[]){
  const key=row[0],raw=row[col];
  if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key)||key.slice(5)!==date.slice(5)||key>=asOf)continue;
  if(new Date(key+'T12:00:00Z').toISOString().slice(0,10)!==key)continue;
  if(!/^[+-]?\d+(?:\.\d+)?$/.test(String(raw)))continue;
  const v=Number(raw);if(Number.isFinite(v))values.set(key,v);
 }
 const all=[...values.values()],best=all.length?(max?Math.max(...all):Math.min(...all)):null;
 return {value:best,count:all.length,years:[...values].filter(([,v])=>v===best).map(([k])=>k.slice(0,4)).sort()};
}
async function main(){
 assert(/^[a-f0-9]{40}$/.test(sha||''));assert.equal(cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sha);
 for(let i=0;i<24;i++){
  const headers={Accept:'application/vnd.github+json'};if(process.env.GH_TOKEN)headers.Authorization='Bearer '+process.env.GH_TOKEN;
  const r=await fetch('https://api.github.com/repos/mkasseb/lsxdashboard/commits/'+sha+'/check-runs',{headers});assert(r.ok,'GitHub checks HTTP '+r.status);
  const deploy=(await r.json()).check_runs.find(c=>c.name==='Cloudflare Pages'&&c.conclusion==='success'&&c.head_sha===sha),match=deploy?.output?.summary?.match(/https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev/);
  if(match){if(origin)assert.equal(origin,match[0]);origin=match[0];audit.deployment={check:deploy.html_url,summary:deploy.output.summary};break;}
  await new Promise(r=>setTimeout(r,10000));
 }
 assert(/^https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev$/.test(origin||''),'Confirmed immutable PR preview required');audit.origin=origin;
 const api=await request.newContext();
 try{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),files=['index.html',...Array.from(html.matchAll(/(?:src|href)="\/?(assets\/[^"?]+)\?v=[a-f0-9]+/g),m=>m[1]),'data/nbm-range.json','data/nbm-hourly.json','data/nbm-receipt.json','data/nbm-hourly-receipt.json','data/nbm-publication.json'];
  for(const file of [...new Set(files)]){
   const expected=cp.execFileSync('git',['show',sha+':'+file],{cwd:root,maxBuffer:40*1024*1024}),r=await api.get(origin+'/'+file);assert(r.ok(),file+' HTTP '+r.status());
   const bytes=await r.body();assert.equal(hash(bytes),hash(expected),file+' differs from PR commit');audit.assets.push({file,sha256:hash(bytes),cacheControl:r.headers()['cache-control']});
  }
 }finally{await api.dispose();}
 const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});let cached=null,verifiedResponses=[];
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},timezoneId:width===390?'Asia/Tokyo':'America/Chicago'}),p=await context.newPage(),responses=[],pending=[];
   if(cached)await p.addInitScript(cache=>localStorage.setItem('lsxCtx_v6',cache),cached);
   p.on('pageerror',e=>audit.errors.push({width,error:e.message}));
   p.on('response',r=>{
    if(r.url()==='https://data.rcc-acis.org/StnData'){
     const q=JSON.parse(new URLSearchParams(r.request().postData()||'').get('params')||'{}');
     if(Array.isArray(q.elems?.[0]?.interval)||q.elems?.[0]?.normal==='91')pending.push(r.json().then(payload=>{responses.push({params:q,status:r.status(),payload});}).catch(()=>{}));
    }
   });
   try{
    assert((await p.goto(origin+'/?records-verification='+sha,{waitUntil:'domcontentloaded',timeout:60000})).ok());
    await p.waitForFunction(()=>typeof refreshInFlight!=='undefined'&&refreshInFlight===null&&feedChecks.daily.status!=='loading',null,{timeout:90000});
    await p.locator('#forecastCard').scrollIntoViewIfNeeded();await p.evaluate(()=>requestContext('context'));
    await p.waitForFunction(()=>feedRequested('context')&&['ready','partial','unavailable'].includes(feedChecks.context.status),null,{timeout:125000});await Promise.all(pending);
    const state=await p.evaluate(()=>({current,asOf:ctxTodayKey(),days:smart.days.map(d=>({date:forecastCalendarKey(d.day||d.night),night:d.night&&{start:d.night.startTime,end:d.night.endTime}})),context:ctx,checks:{daily:feedChecks.daily,context:feedChecks.context,model:feedChecks.nbmRange},source:document.getElementById('forecastRecordStation').textContent,rows:[...document.querySelectorAll('.normal-inline')].map(x=>x.textContent),normalSource:document.getElementById('forecastNormalStation').textContent,modelRows:document.querySelectorAll('.nbm-inline').length}));
    assert.equal(state.checks.daily.status,'ready','Live official NWS forecast required');assert.equal(state.days.length,7);assert.equal(state.rows.length,7);
    verifiedResponses.push(...responses);
    const facts=[],unavailable=[],normalFacts=[],normalUnavailable=[];
    for(const [index,day] of state.days.entries()){
     const line=p.locator('#daily .record-detail').nth(index),r=state.context.recordsByDate?.[day.date],shown=[];
     const normalLine=p.locator('#daily .normal-inline').nth(index),normal=state.context.normWeek?.[day.date];
     assert(await normalLine.evaluate(e=>e.previousElementSibling===e.parentElement.querySelector('.nbm-inline')||!e.parentElement.querySelector('.nbm-inline')&&e.previousElementSibling.classList.contains('day')),'Normal remains below this row’s NBM range');
     const qualifiedNormal=normal&&state.context.ready&&state.context.normalPeriod==='1991-2020'&&normal.normalPeriod==='1991-2020'&&normal.date===day.date&&normal.asOf===state.asOf&&normal.location===state.context.location&&Date.now()>=normal.checkedAt&&Date.now()-normal.checkedAt<=12*3600000;
     if(qualifiedNormal){
      const raw=[...verifiedResponses].reverse().find(x=>x.status===200&&x.params.sid===normal.source.sid&&x.params.elems?.[0]?.normal==='91'&&x.params.sdate<=day.date&&x.params.edate>=day.date&&x.payload.meta?.sids?.some(s=>s.split(' ')[0]===normal.source.sid.split(' ')[0]));
      assert(raw,'Actual matching-station normal response required');assert.equal(raw.params.elems[0].prec,1);
      const values=raw.payload.data.filter(row=>row[0]===day.date);assert.equal(values.length,1,'Exactly one literal requested normal date');
      const expected=values[0].slice(1,3).map(v=>/^[+-]?\d+(?:\.\d+)?$/.test(String(v))&&Number.isFinite(Number(v))?Number(v):null);
      assert.deepEqual([normal.hi,normal.lo],expected);assert.deepEqual(await normalLine.locator('b').allTextContents(),expected.filter(v=>v!=null).map(v=>Math.round(v)+'°'));
      const detail=await p.locator('.normal-detail').nth(index).textContent();assert(detail.includes('1991–2020'));assert(detail.includes(normal.source.name));
      for(const v of expected.filter(v=>v!=null))assert(detail.includes(v+'°F'));
      normalFacts.push({date:day.date,station:normal.source,normalPeriod:normal.normalPeriod,hi:normal.hi,lo:normal.lo,checkedAt:normal.checkedAt});
      if(expected.some(v=>v==null))normalUnavailable.push(day.date);
     }else {assert.equal(await normalLine.locator('b').count(),0);assert.match(await normalLine.textContent(),/unavailable/);normalUnavailable.push(day.date);}

     if(!r){assert.equal(await line.locator('b').count(),0);assert.match(await line.textContent(),/unavailable/);unavailable.push(day.date);continue;}
     const raw=[...verifiedResponses].reverse().find(x=>x.status===200&&Array.isArray(x.params.elems?.[0]?.interval)&&x.params.sid===r.source.sid&&x.params.sdate.slice(5)===day.date.slice(5)&&x.payload.meta?.sids?.some(s=>s.split(' ')[0]===r.source.sid.split(' ')[0]));
     assert(raw,'Actual matching-station response required for each displayed record');
     const min=day.date.slice(5)==='02-29'?10:30,qualified=state.context.ready&&r.asOf===state.asOf&&r.recordDate===day.date&&Date.now()>=r.checkedAt&&Date.now()-r.checkedAt<=12*3600000;
     let displayed=0;
     for(const [col,key,count]of [[1,'recHi','hiCount'],[2,'recLo','loCount']]){
      const expected=independent(raw.payload,day.date,state.asOf,col,col===1);assert.equal(r[count],expected.count);
      if(r[key]){assert.equal(r[key].v,expected.value);assert.deepEqual(r[key].years,expected.years);}
      if(qualified&&expected.count>=min&&r[key]){
       shown.push(String(expected.value)+'°F');displayed++;
       const years=expected.years.join(', ');
       assert((await line.textContent()).includes('('+years+')'),'Rendered tied years match the actual response');
      }
     }
     assert.deepEqual(await line.locator('b').allTextContents(),shown,'Rendered high/low match their qualified calendar-date observations');
     assert(await line.evaluate(e=>e.closest('.day-detail')!==null),'Record values remain in expanded details');
     if(displayed<2)unavailable.push(day.date);
     if(displayed)facts.push({date:day.date,station:r.source,high:r.recHi,low:r.recLo,hiCount:r.hiCount,loCount:r.loCount,checkedAt:r.checkedAt,displayedTemperatures:displayed});
    }
    if(!facts.length)assert(await p.locator('.record-detail').evaluateAll(rows=>rows.every(r=>/unavailable/.test(r.textContent))));
    if(normalUnavailable.length)audit.sourceFailures.push({width,message:'Some live calendar-date normals safely withheld',dates:normalUnavailable,status:state.checks.context.status});
    if(unavailable.length)audit.sourceFailures.push({width,message:'Some live calendar-date records safely withheld',dates:unavailable,status:state.checks.context.status});
    cached=await p.evaluate(()=>localStorage.getItem(CTX_KEY));
    for(const theme of ['dark','light']){
     await p.evaluate(t=>applyTheme(t),theme);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     assert(await p.locator('#daily .day').evaluateAll(rows=>rows.every(r=>r.getBoundingClientRect().height>=44)));
     assert(await p.locator('#daily .dnd').evaluateAll(dates=>dates.length===7&&dates.every(r=>r.getBoundingClientRect().height>0)));
     await p.locator('#forecastCard').screenshot({path:path.join(out,`live-${width}-${theme}.png`),style:'.jump-wrap,.skip{visibility:hidden !important}'});
    }
    await p.locator('#daily .day').nth(1).click();await p.locator('#forecastCard').screenshot({path:path.join(out,`live-${width}-detail.png`),style:'.jump-wrap,.skip{visibility:hidden !important}'});
    audit.live.push({width,timezone:width===390?'Asia/Tokyo':'America/Chicago',location:state.current,asOf:state.asOf,source:state.source,normalSource:state.normalSource,normalFacts,checks:state.checks,days:state.days,modelRows:state.modelRows,records:facts});
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(out,'live-record-responses.json'),JSON.stringify(verifiedResponses,null,2));assert.deepEqual(audit.errors,[]);audit.result='passed';
}
fs.mkdirSync(out,{recursive:true});main().catch(e=>{audit.result='failed';audit.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>{audit.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify({result:audit.result,commit:sha,origin,assets:audit.assets.length,live:audit.live.map(x=>({width:x.width,records:x.records.length,normals:x.normalFacts.length,normalSource:x.normalSource,source:x.source,modelRows:x.modelRows})),sourceFailures:audit.sourceFailures}));});
