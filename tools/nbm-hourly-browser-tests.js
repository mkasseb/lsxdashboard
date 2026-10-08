'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');const {open,config,setBrowser}=require('./weather-stress-tests');
const data=JSON.parse(fs.readFileSync('data/nbm-hourly.json')),capture=JSON.parse(fs.readFileSync('tools/fixtures/weather/nbm-hourly-nws-recorded.json'));
const now=Math.max(Date.parse(data.retrievedAt),Date.parse(capture.retrievedAt)),H=3600000,route='**/data/nbm-hourly.json';
async function model(p,d=data){await p.unroute(route);await p.route(route,r=>r.fulfill({json:d}));await p.evaluate(()=>loadNbmHourly());}
async function official(p){await p.route('**/forecast/hourly',r=>r.fulfill({json:capture.forecast}));await p.evaluate(()=>loadForecast());}
async function primary(p){return p.evaluate(()=>({hrs:JSON.stringify(renderHourly24._hrs),summary:document.querySelector('.h24-sum')?.textContent,call:document.getElementById('callCard').innerText,days:JSON.stringify(smart.days)}));}
(async()=>{
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});setBrowser(b);
 try{for(const width of [320,390,1440])for(const timezone of ['America/Chicago','Asia/Tokyo']){
  const s=await open(config('Hourly authentic recording',{now,timezone,touch:width<500}),width),p=s.page;
  try{
   await official(p);const before=await primary(p);await model(p);assert.deepEqual(await primary(p),before);
   assert.equal(await p.locator('.nbm-hourly-band').count(),1);assert.match(await p.locator('#nbmHourlyStatus').innerText(),/24\/24 hours matched/);
   const input=p.locator('#hourlyCursor');await input.focus();await input.press('ArrowRight');
   assert.match(await p.locator('#hourlyDetail').innerText(),/Model range .*°F · middle estimate .*°F/);
   const info=p.locator('#nbmHourlyInfo'),help=info.locator('summary');
   assert.equal(await info.evaluate(e=>e.open),false);
   if(width<500)await help.tap();else{await help.focus();await help.press('Enter');}
   assert.equal(await info.evaluate(e=>e.open),true);
   assert.match(await info.innerText(),/not guaranteed limits or an NWS confidence interval/);
   assert.match(await p.locator('#nbmHourlyPercentiles').innerText(),/P10 .* P50 .* P90/);
   assert.match(await p.locator('#nbmHourlySource').innerText(),/Native 2 m temperature/);
   if(process.env.NBM_ARTIFACTS){fs.mkdirSync(process.env.NBM_ARTIFACTS,{recursive:true});await info.screenshot({path:path.join(process.env.NBM_ARTIFACTS,`hourly-about-${width}-${timezone.replace('/','-')}.png`)});}
   await help.click();await input.focus();
   const chosen=await p.evaluate(()=>renderHourly24._selectedTime);await model(p);assert.equal(await p.evaluate(()=>renderHourly24._selectedTime),chosen);assert(await input.evaluate(e=>e===document.activeElement));
   await p.locator('#nbmHourlyToggle').uncheck();assert.equal(await p.locator('.nbm-hourly-band').count(),0);assert.equal(await p.locator('.nbm-hourly-detail').count(),0);
   await p.locator('#nbmHourlyToggle').check();
   for(const duration of [48,72]){await p.locator('#hourlyOptions [data-hours="'+duration+'"]').click();assert.equal(await p.locator('.nbm-hourly-band').count(),0);assert(await p.locator('#nbmHourlyToggle').isDisabled());}
   await p.locator('#hourlyOptions [data-hours="24"]').click();assert.equal(await p.locator('.nbm-hourly-band').count(),1);
   for(const theme of ['light','dark']){
    await p.evaluate(t=>{applyTheme(t);layoutMasonry();},theme);await p.clock.runFor(500);
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if(process.env.NBM_ARTIFACTS){fs.mkdirSync(process.env.NBM_ARTIFACTS,{recursive:true});await p.locator('#h24Card').screenshot({style:'.jump-wrap,.skip{visibility:hidden !important}',path:path.join(process.env.NBM_ARTIFACTS,`hourly-${width}-${timezone.replace('/','-')}-${theme}.png`)});}
   }
   // A real pointer/touch selection updates the accessible details.
   const beforePointer=await p.evaluate(()=>renderHourly24._selectedTime);
   const svg=p.locator('.h24-svg');if(width<500)await svg.tap({position:{x:100,y:100}});else await svg.hover({position:{x:100,y:100}});
   assert.notEqual(await p.evaluate(()=>renderHourly24._selectedTime),beforePointer,'Touch/pointer actually changes the selected forecast hour');
   assert.match(await p.locator('#hourlyDetail').innerText(),/middle estimate/);
   const missing=structuredClone(data),target=Math.floor(now/H)*H+5*H;missing.hours=missing.hours.filter(h=>Date.parse(h.validTime)!==target);await model(p,missing);
   assert.equal(await p.locator('.nbm-hourly-band').count(),2);assert.match(await p.locator('#nbmHourlyStatus').innerText(),/23\/24/);
   await p.evaluate(()=>{document.getElementById('hourlyCursor').value=5;document.getElementById('hourlyCursor').dispatchEvent(new Event('input'));});
   assert.match(await p.locator('#hourlyDetail').innerText(),/unavailable for this hour/);
   await model(p);await p.evaluate(()=>{renderHourly24._hrs.forEach(h=>h.temperature=0);renderHourly24();});
   assert.match(await p.locator('.h24-sum').innerText(),/High\s*0°/);
   assert(await p.evaluate(()=>{const nums=document.querySelector('.nbm-hourly-band').getAttribute('d').match(/[-\d.]+/g).map(Number),ys=nums.filter((_,i)=>i%2);return Number(document.querySelector('.h24-nowdot').getAttribute('cy'))>Math.max(...ys);}), 'Official zero sits outside independently plotted warmer NBM band');
   await official(p);
   await p.evaluate(()=>{snapSafeSeq=locSeq;saveSnapshot();});const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem(SNAP_KEY)));
   assert(!saved.parts.hourly24,'Model-dependent chart is never saved as NWS-only HTML');
   let release;const held=new Promise(r=>release=r);await p.route('**/forecast/hourly',async r=>{await held;await r.fulfill({json:capture.forecast});});
   await p.reload({waitUntil:'domcontentloaded'});await model(p);assert.equal(await p.locator('.nbm-hourly-band').count(),0);release();await p.waitForSelector('.nbm-hourly-band');
   await p.unroute('**/forecast/hourly');await official(p);
   // Failed refresh retains last-good guidance; an older response cannot clear the failure state.
   let releaseModel;await p.unroute(route);await p.route(route,r=>new Promise(done=>{releaseModel=async()=>{await r.fulfill({json:data});done();};}));
   await Promise.all([p.waitForRequest(route),p.evaluate(()=>{window.hourlyPending=loadNbmHourly();})]);
   while(!releaseModel)await new Promise(r=>setTimeout(r,5));
   await p.route(route,r=>r.fulfill({status:503,json:{}}));await p.evaluate(()=>loadNbmHourly());await releaseModel();await p.evaluate(()=>window.hourlyPending);assert.equal(await p.locator('.nbm-hourly-band').count(),1);assert.match(await p.locator('#nbmHourlyStatus').innerText(),/Latest check failed; previous range shown/);
   await model(p);await p.clock.setFixedTime(new Date(Date.parse(data.run)+24*H));await p.evaluate(()=>renderHourly24());assert.equal(await p.locator('.nbm-hourly-band').count(),0);assert.match(await p.locator('#nbmHourlyStatus').innerText(),/24 hours/);
   await p.clock.setFixedTime(new Date(now));await model(p,{});assert.equal(await p.locator('.nbm-hourly-band').count(),1);assert.match(await p.locator('#nbmHourlyStatus').innerText(),/Latest check failed/);
   await p.evaluate(()=>NbmHourly.reset());await model(p,{});assert.equal(await p.locator('.nbm-hourly-band').count(),0);
   await official(p);await model(p);await p.evaluate(()=>{locSeq++;current={...current,lat:40,lon:-90};resetLocationState();renderHourly24();});assert.equal(await p.locator('.nbm-hourly-band').count(),0);assert.equal(await p.locator('#nbmHourlySource').textContent(),'');assert.equal(await p.locator('#nbmHourlyPercentiles').textContent(),'');
   assert.deepEqual(s.errors,[]);console.log('PASS hourly browser',width,timezone);
  }finally{await s.context.close();}
 }}finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
