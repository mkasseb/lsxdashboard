#!/usr/bin/env node
'use strict';
// Verify only an immutable branch preview, with default TLS and unmodified live responses first.
// Static model data may expire in a preview; retain its real timestamps and verify withholding.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {chromium,request}=require('playwright');
const root=path.join(__dirname,'..'),out=process.argv[2]||'/tmp/nws-hosted',sha=process.env.EXPECTED_SHA,origin=process.env.PREVIEW_URL;
const audit={startedAt:new Date().toISOString(),commit:sha,origin,tls:'Default certificate validation; no bypass',assets:[],live:[],controlled:[],runtimeErrors:[],networkFailures:[]};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 assert(/^[a-f0-9]{40}$/.test(sha||''));assert(/^https:\/\/[a-f0-9]+\.lsxdashboard2\.pages\.dev$/.test(origin||''),'Immutable preview URL required');
 assert.equal(cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sha);
 const meta=await fetch('https://api.github.com/repos/mkasseb/lsxdashboard/commits/'+sha+'/check-runs',{headers:{Accept:'application/vnd.github+json'}});assert(meta.ok());
 const checks=(await meta.json()).check_runs,deploy=checks.find(c=>c.name==='Cloudflare Pages'&&c.conclusion==='success');
 assert(deploy?.output?.summary?.includes(origin),'Cloudflare check must confirm this preview for the expected commit');
 audit.deployment={check:deploy.html_url,summary:deploy.output.summary};
 const api=await request.newContext();let dailyModel,hourlyModel;
 try{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),files=['index.html',...Array.from(html.matchAll(/(?:src|href)="\/?(assets\/[^"?]+)\?v=[a-f0-9]+/g),m=>m[1]),'data/nbm-range.json','data/nbm-hourly.json'];
  for(const file of [...new Set(files)]){
   const r=await api.get(origin+'/'+file);assert(r.ok(),file+' HTTP '+r.status());const bytes=await r.body(),expected=cp.execFileSync('git',['show',sha+':'+file],{cwd:root,maxBuffer:40*1024*1024});
   assert.equal(hash(bytes),hash(expected),file+' differs from exact commit');audit.assets.push({file,sha256:hash(bytes),cacheControl:r.headers()['cache-control']});
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
    const live=await p.evaluate(()=>({location:current,messages:nwsMessages,checks:{afd:feedChecks.afd,daily:feedChecks.daily,hourly:feedChecks.hourly},local:nwsLocalForecast,title:document.getElementById('keyMessagesTitle').textContent,status:document.getElementById('keyMessagesStatus').textContent}));
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
 }finally{await browser.close();}
 assert.deepEqual(audit.runtimeErrors,[]);audit.result='passed';
}
fs.mkdirSync(out,{recursive:true});
main().catch(e=>{audit.result='failed';audit.error=e.stack;console.error(e);process.exitCode=1;}).finally(()=>{audit.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(audit,null,2));console.log(audit.result+' hosted preview '+origin+' at '+sha);});
