#!/usr/bin/env node
'use strict';
// Verify an immutable preview or the exact main deployment, with default TLS and live responses first.
// Static model data may expire in a preview; retain its real timestamps and verify withholding.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {chromium,request}=require('playwright');
const {applicationHtml}=require('./hosted-html');
const root=path.join(__dirname,'..'),out=process.argv[2]||'/tmp/nws-hosted',sha=process.env.EXPECTED_SHA,target=process.env.NWS_VERIFY_TARGET||'preview';
let origin=process.env.PREVIEW_URL||(target==='production'?'https://lsxdashboard.com':undefined);
const audit={startedAt:new Date().toISOString(),commit:sha,verifierCommit:process.env.NWS_VERIFIER_SHA||sha,target,origin,tls:'Default certificate validation; no bypass',assets:[],live:[],controlled:[],runtimeErrors:[],networkFailures:[]};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 assert(/^[a-f0-9]{40}$/.test(sha||''));
 assert(['preview','production'].includes(target));
 if(target==='production')assert.equal(origin,'https://lsxdashboard.com');
 else if(origin)assert(/^https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev$/.test(origin),'Immutable preview URL required');
 assert.equal(cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sha);
 let deploy;
 for(let i=0;i<24;i++){
  const meta=await fetch('https://api.github.com/repos/mkasseb/lsxdashboard/commits/'+sha+'/check-runs',{headers:{Accept:'application/vnd.github+json'}});assert(meta.ok);
  const checks=(await meta.json()).check_runs;
  deploy=checks.find(c=>c.name==='Cloudflare Pages'&&c.conclusion==='success'&&c.head_sha===sha);
  const url=deploy?.output?.summary?.match(/https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev/);
  if(url){if(!origin)origin=url[0];if(target==='preview')assert.equal(origin,url[0]);audit.immutableDeployment=url[0];break;}
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 assert(deploy?.output?.summary?.includes(audit.immutableDeployment),'Cloudflare check must confirm deployment of the expected commit');
 audit.origin=origin;
 audit.deployment={check:deploy.html_url,summary:deploy.output.summary};
 const api=await request.newContext();let dailyModel,hourlyModel;
 try{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),files=['index.html',...Array.from(html.matchAll(/(?:src|href)="\/?(assets\/[^"?]+)\?v=[a-f0-9]+/g),m=>m[1]),'data/nbm-range.json','data/nbm-hourly.json','data/nbm-receipt.json','data/nbm-hourly-receipt.json','data/nbm-publication.json'],deadline=Date.now()+180000;
  for(const file of [...new Set(files)]){
   const expected=cp.execFileSync('git',['show',sha+':'+file],{cwd:root,maxBuffer:40*1024*1024});let r,bytes,comparison;
   do{
    r=await api.get(origin+'/'+file+(target==='production'?'?verify='+sha:''));assert(r.ok(),file+' HTTP '+r.status());bytes=await r.body();
    comparison=file==='index.html'&&target==='production'?applicationHtml(bytes,r.headers()['cf-ray']):{bytes,injection:null};
    if(hash(comparison.bytes)===hash(expected)||target==='preview'||Date.now()>=deadline)break;
    await new Promise(resolve=>setTimeout(resolve,10000));
   }while(Date.now()<deadline);
   if(hash(comparison.bytes)!==hash(expected)){
    fs.writeFileSync(path.join(out,'unexpected-'+file.replace(/\//g,'-')),bytes);
    audit.unexpectedAsset={file,rawHash:hash(bytes),comparisonHash:hash(comparison.bytes),expectedHash:hash(expected)};
   }
   assert.equal(hash(comparison.bytes),hash(expected),file+' differs from exact commit');audit.assets.push({file,sha256:hash(comparison.bytes),rawSha256:hash(bytes),injection:comparison.injection,cacheControl:r.headers()['cache-control']});
   if(file==='index.html')fs.writeFileSync(path.join(out,'served-index.html'),bytes);
   if(file==='data/nbm-range.json')dailyModel=JSON.parse(bytes);if(file==='data/nbm-hourly.json')hourlyModel=JSON.parse(bytes);
  }
 }finally{await api.dispose();}
 const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},timezoneId:width===390?'America/Chicago':'Asia/Tokyo'}),p=await context.newPage(),products=[],pending=[];
   p.on('pageerror',e=>audit.runtimeErrors.push({width,message:e.message}));
   p.on('requestfailed',r=>audit.networkFailures.push({width,url:r.url().split('?')[0],error:r.failure()?.errorText}));
   p.on('response',r=>{if(/^https:\/\/api\.weather\.gov\/products\/[a-f0-9-]+$/i.test(r.url())&&r.ok())pending.push(r.json().then(d=>products.push(d)).catch(()=>{}));});
   try{
    const response=await p.goto(origin+'/?preview-verification='+sha,{waitUntil:'domcontentloaded',timeout:60000});assert(response.ok());
    await p.waitForFunction(()=>typeof refreshInFlight!=='undefined'&&refreshInFlight===null&&nwsMessages&&feedChecks.daily.status!=='loading'&&feedChecks.nbmHourly.status!=='loading',null,{timeout:90000});
    await Promise.all(pending);
    const live=await p.evaluate(async()=>({location:current,coverage:(await pointsFor(current.lat,current.lon)).properties,messages:nwsMessages,checks:{afd:feedChecks.afd,daily:feedChecks.daily,hourly:feedChecks.hourly,alerts:feedChecks.alerts},alerts:{received:lastAlertData?.features?.length,localEvent:callLocalAlert?.event||null,zones:userZones},local:nwsLocalForecast,title:document.getElementById('keyMessagesTitle').textContent,status:document.getElementById('keyMessagesStatus').textContent}));
    assert.equal(live.coverage.cwa||live.coverage.gridId,'LSX');assert.equal(live.checks.alerts.status,'ready','Live alert/zone lookup must succeed');
    assert.equal(live.alerts.zones.county,live.coverage.county);
    audit.live.push({width,test:'Actual point coverage and alert check',point:live.location,cwa:live.coverage.cwa||live.coverage.gridId,alerts:live.alerts});
    assert.equal(live.messages.status,'ready','Live NWS messages must load for this verification');assert.equal(live.title,'NWS Key Messages');
    const product=products.find(d=>Date.parse(d.issuanceTime)===live.messages.issuedAt&&d.issuingOffice==='K'+live.messages.office);assert(product,'Capture actual live AFD response');
    const section=product.productText.split(/\.KEY MESSAGES(?:\.{3}|…)/i)[1].split(/\n\s*&&|\n\.[A-Z]|\$\$/)[0];
    const bullets=section.replace(/\r/g,'').split(/\n(?=[ \t]*-(?:[ \t]|[A-Za-z]))/).map(s=>s.trim()).filter(s=>s.startsWith('-')).map(s=>s.replace(/^-\s*/,'').replace(/\s+/g,' ').trim());
    assert.deepEqual(await p.locator('#callRow li').allTextContents(),bullets,'Hosted bullets match actual official wording/order independently');
    assert.equal(new URL(await p.locator('#keyDiscussionLink').getAttribute('href')).searchParams.get('issuedby'),live.messages.office);
    audit.live.push({width,test:'Unmodified live NWS messages',location:live.location,office:live.messages.office,productIssuedAt:product.issuanceTime,sectionIssuedAt:live.messages.sectionIssuedAt||null,bullets,status:live.status});
    const models=await p.evaluate(({dailyModel,hourlyModel})=>({daily:NbmRange.validate(dailyModel,current,Date.now()),hourly:NbmHourly.validate(hourlyModel,current,Date.now())}),{dailyModel,hourlyModel});
    for(const [key,result]of Object.entries(models)){
     assert(['ready','partial','stale'].includes(result.status),key+' model validation '+result.status);
     if(result.status==='stale'){
      assert.equal(await p.locator(key==='daily'?'.nbm-inline':'.nbm-hourly-band').count(),0);
      assert.match(await p.locator(key==='daily'?'#nbmStatus':'#nbmHourlyStatus').textContent(),/over 24 hours|older than 24|stale/i);
     }else assert((await p.locator(key==='daily'?'.nbm-inline':'.nbm-hourly-band').count())>0,'Valid '+key+' guidance still renders');
    }
    audit.live.push({width,test:'Untouched daily/hourly NBM integration',daily:{status:models.daily.status,run:dailyModel.run,ageHours:(Date.now()-Date.parse(dailyModel.run))/3600000},hourly:{status:models.hourly.status,run:hourlyModel.run,ageHours:(Date.now()-Date.parse(hourlyModel.run))/3600000}});
    const hero=await p.locator('#callRow').textContent();await p.locator('#nbmHourlyToggle').uncheck();assert.equal(await p.locator('.nbm-hourly-band').count(),0);assert.equal(await p.locator('#callRow').textContent(),hero);await p.locator('#nbmHourlyToggle').check();
    const source=p.locator('#briefWhy > summary');await source.focus();await source.press('Enter');assert(await p.locator('#briefWhy').evaluate(e=>e.open));assert((await source.boundingBox()).height>=44);
    await p.evaluate(()=>loadAFD());assert(await source.evaluate(e=>e===document.activeElement));assert(await p.locator('#briefWhy').evaluate(e=>e.open));await source.press('Enter');
    for(const theme of ['light','dark']){
     await p.evaluate(t=>applyTheme(t),theme);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     await p.locator('#callCard').screenshot({path:path.join(out,'live-'+width+'-'+theme+'-messages.png'),style:'.jump-wrap,.skip{visibility:hidden !important}'});
     await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(out,'live-'+width+'-'+theme+'-page.png'),fullPage:true});
    }
    // Real point switching runs before any controlled response routing.
    await p.evaluate(()=>{setLocation({name:'Wentzville, MO',lat:38.81,lon:-90.86,station:null,precision:'representative'},{save:false});setLocation({name:'Belleville, IL',lat:38.52,lon:-89.98,station:null,precision:'representative'},{save:false});});
    await p.waitForFunction(()=>snapSafeSeq===locSeq&&nwsMessages?.status==='ready',null,{timeout:90000});
    assert.equal(await p.evaluate(()=>current.name),'Belleville, IL');assert.match(await p.locator('#keyMessagesMeta').textContent(),/LSX/);audit.live.push({width,test:'Rapid real LSX point changes and fixed regional attribution',status:'passed'});
    // Clearly controlled latest-discussion absence/failure on hosted assets; source clocks stay real.
    await p.route('**/products/'+product.id,r=>r.fulfill({json:{...product,productText:product.productText.replace('.KEY MESSAGES...','.SYNOPSIS...')}}));
    await p.evaluate(()=>loadAFD());assert.equal(await p.locator('#keyMessagesTitle').textContent(),'NWS Local Forecast');assert.match(await p.locator('#keyMessagesStatus').textContent(),/not included/);
    const local=await p.evaluate(()=>nwsLocalForecast),time=Date.now(),period=local.daily.properties.periods.find(q=>Date.parse(q.startTime)<=time&&Date.parse(q.endTime)>time);
    assert(period);assert((await p.locator('#callRow').textContent()).includes(period.detailedForecast||period.shortForecast));
    await p.locator('#callRow a').focus();await p.unroute('**/products/'+product.id);await p.evaluate(()=>loadAFD());assert.equal(await p.locator('#keyMessagesTitle').textContent(),'NWS Key Messages');assert(await p.locator('#briefWhy > summary').evaluate(e=>e===document.activeElement));
    audit.controlled.push({width,test:'Missing section gives current official local forecast; recovery preserves focus',status:'passed'});
   }finally{await context.close();}
  }
  {
   for(const saved of [{name:'Saved Wentzville, MO',lat:38.81,lon:-90.86,cwa:'LSX'},{name:'Saved Chicago',lat:41.88,lon:-87.63,cwa:'LOT'}]){
    const context=await browser.newContext({viewport:{width:390,height:1000},timezoneId:'America/Chicago'}),p=await context.newPage(),lookup=[];
    p.on('pageerror',e=>audit.runtimeErrors.push({test:'Live saved startup',message:e.message}));
    await p.addInitScript(saved=>localStorage.setItem('lsxLoc',JSON.stringify({name:saved.name,lat:saved.lat,lon:saved.lon,precision:'representative'})),saved);
    const endpoint='/points/'+saved.lat.toFixed(4)+','+saved.lon.toFixed(4);
    p.on('response',r=>{if(new URL(r.url()).pathname===endpoint&&r.ok())lookup.push(r.json());});
    try{
     await p.goto(origin+'/?startup-verification='+sha,{waitUntil:'domcontentloaded',timeout:60000});
     await p.waitForFunction(()=>!document.getElementById('locFeedback').textContent.startsWith('Checking ')&&refreshInFlight===null&&snapSafeSeq===locSeq&&feedChecks.alerts.status!=='loading',null,{timeout:90000});
     const membership=(await Promise.all(lookup)).at(-1)?.properties;assert(membership,'Actual saved-coordinate coverage response required');assert.equal(membership.cwa||membership.gridId,saved.cwa);
     const active=await p.evaluate(async()=>({location:current,cwa:(await pointsFor(current.lat,current.lon)).properties.cwa,feedback:document.getElementById('locFeedback').textContent,alerts:feedChecks.alerts.status,localEvent:callLocalAlert?.event||null,office:nwsMessages?.office}));
     assert.equal(active.cwa,'LSX');assert.equal(active.alerts,'ready');assert.equal(active.office,'LSX');
     if(saved.cwa==='LSX'){assert.equal(active.location.lat,saved.lat);assert.equal(active.location.lon,saved.lon);assert.equal(active.location.name,saved.name);}
     else{assert.equal(active.location.name,'Lake St. Louis, MO');assert.match(active.feedback,/outside.*LSX/);}
     audit.live.push({test:'Saved startup with unmodified live '+saved.cwa+' membership',saved,active});
    }finally{await context.close();}
   }
  }
 }finally{await browser.close();}
 assert.deepEqual(audit.runtimeErrors,[]);audit.result='passed';
}
fs.mkdirSync(out,{recursive:true});
main().catch(e=>{audit.result='failed';audit.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>{audit.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify({result:audit.result,target,origin,commit:sha,verifierCommit:audit.verifierCommit,assets:audit.assets,live:audit.live,controlled:audit.controlled}));console.log(audit.result+' hosted '+target+' '+origin+' at '+sha);});
