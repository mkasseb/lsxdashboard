#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),playwright=require('playwright');
const {default:AxeBuilder}=require('@axe-core/playwright');
const {open,config,alert,setBrowser}=require('./weather-stress-tests');
const engine=process.env.WEATHER_BROWSER||'chromium',report=[];
(async()=>{
 const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{})});setBrowser(browser);
 try{
  for(const width of [320,1440])for(const state of ['normal','observation outage','warning']){
   const scenario=config('Accessibility '+state,{aqi:225,uv:11});
   if(state==='warning')scenario.alerts=[alert('Tornado Warning',scenario.now)];
   const s=await open(scenario,width),p=s.page;
   try{
    if(state==='observation outage'){
     await p.route('**/observations/latest',r=>r.fulfill({status:503,json:{}}));await p.evaluate(()=>loadCurrent());
    }
    const day=p.locator('#daily .day').first();await day.click();
    await p.locator('#nbmInfo details').evaluate(e=>e.open=true);
    await p.locator('#nbmHourlyInfo').evaluate(e=>e.open=true);
    for(const theme of ['dark','light']){
     await p.evaluate(t=>{applyTheme(t);layoutMasonry();},theme);await p.clock.runFor(400);
     const audit=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
     const violations=audit.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
     report.push({engine,width,state,theme,violations});
     console.log((violations.length?'FAIL':'PASS')+' accessibility '+width+' '+state+' '+theme+' ('+violations.length+' violations)');
     if(violations.length)console.error(JSON.stringify(violations));
    }
    assert.deepEqual(s.errors,[],'No uncaught application errors');
   }finally{await s.context.close();}
  }
  assert(report.every(r=>!r.violations.length),'WCAG audit failed; see accessibility report');
 }finally{
  fs.writeFileSync(process.env.ACCESSIBILITY_REPORT||'/tmp/lsx-accessibility.json',JSON.stringify(report,null,2)+'\n');
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
