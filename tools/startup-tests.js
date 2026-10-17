#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),playwright=require('playwright');
const {html,assets}=require('./source'),engine=process.env.WEATHER_BROWSER||'chromium';
(async()=>{
 const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{})});
 try{
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(15000);
  let main;const waiting=new Promise(resolve=>main=resolve);
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,
   value:{getCurrentPosition:function(ok,fail){queueMicrotask(fail);}}}));
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(['cdnjs.cloudflare.com','cdn.jsdelivr.net'].includes(u.hostname))return route.abort();
   if(u.hostname!=='startup.invalid')return route.fulfill({status:403,headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:'{}'});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/assets/dashboard.js'){main(route);return;}
   const asset=assets[u.pathname];return route.fulfill({status:asset?200:404,contentType:asset?.type||'text/plain',body:asset?.content||''});
  });
  await page.goto('https://startup.invalid/',{waitUntil:'commit'});
  const held=await waiting; // Every preceding ordered script has executed.
  assert.equal(await page.evaluate(()=>typeof ic),'undefined');
  await page.locator('#radarProduct').selectOption('velocity');await page.locator('#rsFull').click();
  assert.equal(await page.locator('#rsFull').getAttribute('aria-expanded'),'false','Partial startup cannot enter a fullscreen dialog without its controller');
  assert.deepEqual(errors,[],'Controls cannot call missing functions while the main file downloads');
  await held.fulfill({contentType:'application/javascript',body:assets['/assets/dashboard.js'].content});
  await page.waitForLoadState('domcontentloaded');
  // Map-library failures hide these controls; their registered handlers must still
  // be complete when startup finishes, independent of third-party availability.
  await page.locator('#radarProduct').evaluate(e=>{e.value='velocity';e.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>radarView.product),'velocity');
  await page.locator('#rsFull').evaluate(e=>e.click());assert.equal(await page.locator('#rsFull').getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#rsFull').getAttribute('aria-expanded'),'false');
  await page.waitForFunction(()=>refreshInFlight===null);assert.deepEqual(errors,[]);
  await context.close();console.log('PASS ordered-script startup: slow main download, early controls and normal radar/fullscreen activation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
