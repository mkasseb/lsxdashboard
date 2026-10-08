#!/usr/bin/env node
'use strict';
// Manual rollout verification only: real public site/data, default TLS validation, no routed fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium,request}=require('playwright');
async function main(){
 const directory=process.argv[2],receipt=JSON.parse(fs.readFileSync(path.join(directory,'nbm-receipt.json')));
 const origin='https://lsxdashboard.com',api=await request.newContext(),deadline=Date.now()+300000;
 let data;
 try{
  while(Date.now()<deadline){
   const r=await api.get(origin+'/data/nbm-range.json?verify='+Date.now(),{timeout:20000});
   if(r.ok()){
    const bytes=await r.body();
    if(crypto.createHash('sha256').update(bytes).digest('hex')===receipt.sha256){data=JSON.parse(bytes);break;}
   }
   await new Promise(resolve=>setTimeout(resolve,10000));
  }
  assert(data,'Pages did not serve the expected authentic dataset within five minutes');
  const publicReceipt=await api.get(origin+'/data/nbm-receipt.json?verify='+Date.now());
  assert(publicReceipt.ok());assert.deepEqual(await publicReceipt.json(),receipt);
 }finally{await api.dispose();}
 const browser=await chromium.launch();
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},timezoneId:width===390?'America/Chicago':'Asia/Tokyo'});
   try{
    const page=await context.newPage();
    const response=await page.goto(origin+'/?verify='+Date.now(),{waitUntil:'domcontentloaded',timeout:45000});
    assert(response.ok());
    await page.waitForFunction(()=>typeof NbmRange!=='undefined'&&typeof current!=='undefined',null,{timeout:60000});
    assert.equal(await page.locator('#nbmRangeCard').count(),0);
    assert.equal(await page.locator('#nbmInfo details').getAttribute('open'),null);
    await page.locator('#nbmInfo summary').click();
    for(const point of [{lat:38.8,lon:-90.79},{lat:38.52,lon:-89.98}]){
     const expected=await page.evaluate(async ({data,point})=>{
      locSeq++;current={...current,...point};resetLocationState();clearLocationUI();
      await loadForecast();await loadNbmRange();
      const r=NbmRange.validate(data,point,Date.now());
      const a=r.periods?NbmRange.align(smart.days,r.periods,Date.now()):{matches:[]};
      return {status:r.status,comparisons:a.matches.map(m=>({
       official:'NWS '+(m.part==='day'?'high ':'low ')+m.nws.temperature+'°F · '+NbmRange.local(m.nws.startTime)+' – '+NbmRange.local(m.nws.endTime),
       model:'NBM '+(m.part==='day'?'maximum':'minimum')+' · P10 '+Math.round(m.nbm.p10)+'°F · P50 '+Math.round(m.nbm.p50)+'°F · P90 '+Math.round(m.nbm.p90)+'°F',
       interval:(m.exact?'Same interval: ':'Different interval (18 hours): ')+NbmRange.local(m.nbm.start)+' – '+NbmRange.local(m.nbm.end)
      })),cell:r.cell};
     },{data,point});
     assert.equal(expected.status,'ready');assert(expected.comparisons.length>0,'Live NWS and NBM must have usable comparisons');
     assert.deepEqual(await page.locator('.nbm-comparison').evaluateAll(rows=>rows.map(row=>({official:row.children[0].textContent,model:row.children[1].textContent,interval:row.children[2].textContent}))),expected.comparisons);
     for(const day of await page.locator('#daily .day-item').all()){
      if(await day.locator('.nbm-inline').count()&&await day.locator('.day').getAttribute('aria-expanded')!=='true')await day.locator('.day').click();
     }
     assert.match(await page.locator('#nbmStatus').innerText(),/QMD cycle/);
     assert((await page.locator('#nbmInfoBody').innerText()).includes(expected.cell.lat.toFixed(3)+', '+expected.cell.lon.toFixed(3)));
     assert(await page.locator('.nbm-comparison').first().isVisible());
    }
    assert(await page.locator('#nbmInfo details').evaluate(e=>e.open));
    await page.locator('#forecastCard').screenshot({path:path.join(directory,'live-nbm-'+width+'.png')});
    await page.evaluate(async()=>{locSeq++;current={...current,lat:39.4,lon:-90.79};resetLocationState();clearLocationUI();await loadNbmRange();});
    assert.equal(await page.locator('.nbm-inline').count(),0);
    assert.match(await page.locator('#nbmStatus').innerText(),/Outside the supported/);
    console.log('PASS normal-TLS live inline guidance, native intervals and nearest-cell values at '+width+'px');
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 console.log(JSON.stringify({status:'verified',run:data.run,sha256:receipt.sha256,verifiedAt:new Date().toISOString()}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
