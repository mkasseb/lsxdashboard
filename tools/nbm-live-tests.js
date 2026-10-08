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
    assert.equal(await page.locator('#nbmRangeCard details').getAttribute('open'),null);
    for(const point of [{lat:38.8,lon:-90.79},{lat:38.52,lon:-89.98}]){
     const expected=await page.evaluate(async ({data,point})=>{
      current={...current,...point};await loadNbmRange();
      const r=NbmRange.validate(data,point,Date.now());
      return {status:r.status,rows:r.periods?.map(p=>[(p.kind==='TMAX'?'Maximum':'Minimum')+' · '+NbmRange.local(p.start)+' – '+NbmRange.local(p.end),...['p10','p50','p90'].map(k=>Math.round(p[k])+'°')]),cell:r.cell};
     },{data,point});
     assert.equal(expected.status,'ready');
     assert.deepEqual(await page.locator('.nbm-table tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.children,c=>c.textContent))),expected.rows);
     assert.match(await page.locator('#nbmStatus').innerText(),/QMD cycle/);
     assert((await page.locator('#nbmRange').innerText()).includes(expected.cell.lat.toFixed(3)+', '+expected.cell.lon.toFixed(3)));
    }
    await page.locator('#nbmRangeCard summary').click();
    assert(await page.locator('#nbmRangeCard details').evaluate(e=>e.open));
    await page.locator('#nbmRangeCard').screenshot({path:path.join(directory,'live-nbm-'+width+'.png')});
    await page.evaluate(async()=>{current={...current,lat:39.4,lon:-90.79};await loadNbmRange();});
    assert.match(await page.locator('#nbmRange').innerText(),/Outside the supported/);
    console.log('PASS normal-TLS live card, native intervals and nearest-cell values at '+width+'px');
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 console.log(JSON.stringify({status:'verified',run:data.run,sha256:receipt.sha256,verifiedAt:new Date().toISOString()}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
