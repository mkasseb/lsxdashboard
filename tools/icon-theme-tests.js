#!/usr/bin/env node
'use strict';
// Real Meteocons SVG fixtures exercise artwork, rather than blank CDN placeholders.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PNG}=require('pngjs'),playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const engine=process.env.WEATHER_BROWSER||'chromium',out=process.env.REDESIGN_ARTIFACTS;
const fixture=path.join(__dirname,'fixtures/icons'),names=fs.readdirSync(fixture).filter(n=>n.endsWith('.svg')).map(n=>n.slice(0,-4));
const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
(async()=>{
 const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader']}: {})});setBrowser(browser);const results=[];
 try{for(const width of [390,768,1440])for(const theme of ['light','dark']){
  const s=await open(config('icon review'),width),p=s.page;
  try{
   await p.route('https://cdn.jsdelivr.net/npm/@meteocons/svg/fill/**',route=>{const name=path.basename(new URL(route.request().url()).pathname);return route.fulfill({contentType:'image/svg+xml',body:fs.readFileSync(path.join(fixture,name))});});
   await p.evaluate(({names,theme})=>{
    applyTheme(theme);document.querySelector('.jump-wrap').style.position='static';document.querySelector('.skip').style.display='none';const g=document.createElement('section');g.id='iconReview';g.className='card';g.style.cssText='position:relative;max-width:900px;margin:16px auto';
    g.innerHTML='<h2>Weather icon visual QA — '+theme+'</h2><p>Actual condition artwork; daily / hourly / CDN fallback. No weather data.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">'+names.map(name=>'<div class="icon-case"><p>'+name+'</p><div style="display:flex;align-items:center;gap:14px"><div class="day" style="display:block;padding:0"><span class="di">'+mcImg(name,'cloud',32,name)+'</span></div><svg width="32" height="32" viewBox="0 0 32 32" style="flex:none;width:32px;height:32px"><image class="h24-ic" width="32" height="32" href="'+ICON_BASE+name+'.svg?icon-review=1"/></svg><span class="fallback">'+wxImg(name,name.indexOf('night')<0,32,true)+'</span></div></div>').join('')+'</div>';
    document.body.appendChild(g);g.querySelectorAll('.fallback img').forEach(wxiFail);
    g.querySelectorAll('img').forEach(e=>{e.loading='eager';e.src+='?icon-review=1';});
   },{names,theme});
   await p.locator('#iconReview').scrollIntoViewIfNeeded();
   await p.evaluate(()=>Promise.all([...document.querySelectorAll('#iconReview img')].map(e=>e.decode())));
   const bg=await p.locator('#iconReview').evaluate(e=>getComputedStyle(e).backgroundColor.match(/[\d.]+/g).slice(0,3).map(Number)),background=lum(bg),samples=[];
   for(let i=0;i<names.length;i++){
    const slot=p.locator('#iconReview .di').nth(i);
    assert(await slot.evaluate(e=>getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(e).boxShadow==='none'),'No badge behind '+names[i]);
    const png=PNG.sync.read(await slot.locator('img').screenshot({animations:'disabled'}));let readable=0;
    for(let j=0;j<png.data.length;j+=4){const l=lum([...png.data.slice(j,j+3)]),contrast=(Math.max(background,l)+.05)/(Math.min(background,l)+.05);if(contrast>=3)readable++;}
    if(readable<8&&out)fs.writeFileSync(path.join(out,'failed-'+names[i]+'.png'),PNG.sync.write(png));
    assert(readable>=8,`${names[i]} ${theme}: ${readable} readable pixels; darkest RGB ${JSON.stringify([...png.data].filter((_,i)=>i%4!==3).reduce((n,v)=>Math.min(n,v),255))}`);samples.push({name:names[i],readablePixels:readable});
   }
   // Unknown conditions retain their existing mapped artwork and accessible fallback label.
   const unknown=await p.evaluate(()=>{const x=document.createElement('div');x.innerHTML=wxImg('Unknown conditions',false,32,true);wxiFail(x.firstChild);return {name:wxName('Unknown conditions',false),label:x.firstChild.getAttribute('aria-label')};});
   assert.equal(unknown.name,'partly-cloudy-night');assert.equal(unknown.label,'Unknown conditions');
   assert.deepEqual(s.errors,[]);
   if(out){fs.mkdirSync(out,{recursive:true});await p.locator('#iconReview').screenshot({path:path.join(out,`${engine}-icons-${width}-${theme}.png`)});}
   if(out){
    await p.evaluate(()=>{const c=document.getElementById('forecastCard'),n=document.createElement('p');n.textContent='VISUAL QA • sample forecast, not live weather';n.style.cssText='font-size:12px;color:var(--muted)';c.prepend(n);c.querySelectorAll('img.wxi').forEach(e=>{e.loading='eager';e.src+='?icon-review=1';});});
    await p.evaluate(()=>Promise.all([...document.querySelectorAll('#forecastCard img.wxi')].map(e=>e.decode())));
    await p.locator('#forecastCard').screenshot({path:path.join(out,`${engine}-forecast-icons-${width}-${theme}.png`)});
   }
   results.push({width,theme,samples});console.log(`PASS ${engine} ${width} ${theme}: ${names.length} icon types, transparent slots, rendered contrast, unknown fallback`);
  }finally{await s.context.close();}
 }}finally{await browser.close();}
 if(out)fs.writeFileSync(path.join(out,engine+'-icon-report.json'),JSON.stringify(results,null,2));
 console.log(results.length+' icon theme/responsive cases passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
