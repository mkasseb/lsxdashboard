#!/usr/bin/env node
'use strict';
/* The Your Day card in a real page: phone collapse and its toggle, the wide-screen layout that
   ignores the collapse, and freeze severity reaching the DOM as amber vs red. Uses the stress
   suite's intercepted weather, so no live service is involved. */
const assert=require('node:assert/strict'),playwright=require('playwright');
const {open,config,setBrowser}=require('./weather-stress-tests');
const engine=process.env.WEATHER_BROWSER||'chromium';
async function card(p){
  await p.locator('#ccTake .glance-lead').waitFor();
  return p.evaluate(()=>({
    lead:document.querySelector('#ccTake .glance-headline').textContent,
    leadInCard:document.querySelectorAll('#glance .glance-lead').length,
    tone:[...document.querySelector('#ccTake .glance-lead').classList].find(c=>c.startsWith('tone-')),
    rows:document.querySelectorAll('#glance .glance-list li').length,
    shown:[...document.querySelectorAll('#glance .glance-list li')].filter(li=>li.offsetParent).length,
    wearShown:[...document.querySelectorAll('#glance .glance-list li')].some(li=>li.offsetParent&&/Wear/.test(li.textContent)),
    button:(b=>b&&b.offsetParent?{text:b.textContent,expanded:b.getAttribute('aria-expanded'),h:b.getBoundingClientRect().height}:null)(document.querySelector('#glance .glance-more'))
  }));
}
(async()=>{
  const browser=await playwright[engine].launch({headless:engine!=='firefox',...(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{})});
  setBrowser(browser);
  try{
    // A quiet day yields two rows, which stay visible. Then a busy day (extreme UV, storms later
    // in the week) that has enough rows to collapse.
    let s=await open(config('Glance phone quiet'),390),p=s.page;
    try{
      const c=await card(p);
      const first=await p.evaluate(()=>{const a=document.querySelector('#ccTake .glance-lead').getBoundingClientRect(),t=document.querySelector('#current .cc-temp').getBoundingClientRect();return {underReading:a.top>=t.bottom-1,onFirstScreen:a.bottom<=innerHeight};});
      assert(first.underReading&&first.onFirstScreen,'phone puts the takeaway under the reading on the first screen: '+JSON.stringify(first));
      assert(c.rows<=2,'quiet scenario has at most two rows');
      assert.deepEqual([c.shown,c.button],[c.rows,null],'two rows show without a toggle');
      console.log('PASS glance phone shows two rows without a toggle');
    }finally{await s.context.close();}
    s=await open(config('Glance phone',{uv:11,weekRain:true}),390);p=s.page;
    try{
      let c=await card(p);
      assert(c.rows>=3,'busy phone scenario has rows to collapse (got '+c.rows+')');
      assert.equal(c.shown,1,'phone shows exactly one support row');
      assert(c.wearShown,'the kept phone row is Wear');
      assert.deepEqual([c.button.expanded,c.button.text],['false','Show '+(c.rows-1)+' more for today']);
      assert(c.button.h>=44,'toggle is a 44px target');
      await p.locator('#glance .glance-more').click();
      c=await card(p);
      assert.equal(c.shown,c.rows,'expanded phone shows every row');
      assert.deepEqual([c.button.expanded,c.button.text],['true','Show less']);
      await p.evaluate(()=>renderTheCall());
      c=await card(p);
      assert.equal(c.shown,c.rows,'a refresh keeps the card expanded');
      await p.locator('#glance .glance-more').click();
      assert.equal((await card(p)).shown,1,'collapsing again hides the extra rows');
      assert.deepEqual(s.errors,[]);
      console.log('PASS glance phone collapse and toggle');
    }finally{await s.context.close();}

    s=await open(config('Glance desktop'),1440);p=s.page;
    try{
      const c=await card(p);
      assert.equal(c.shown,c.rows,'desktop shows every row');
      assert.equal(c.button,null,'desktop has no toggle');
      // The lead moved out of Your day into Now, beside the temperature; the rows stay in the card.
      assert.equal(c.leadInCard,0,'Your day keeps the rows, not a second copy of the lead');
      const placement=()=>p.evaluate(()=>{
        const a=document.querySelector('#ccTake .glance-lead').getBoundingClientRect(),t=document.querySelector('#current .cc-temp').getBoundingClientRect(),b=document.querySelector('#glance .glance-list').getBoundingClientRect();
        return {beside:a.left>=t.right&&a.top<t.bottom&&a.bottom>t.top,rowsBelow:b.top>=a.bottom-1};
      });
      assert((await placement()).beside,'desktop puts the takeaway beside the temperature');
      assert((await placement()).rowsBelow,'Your day rows follow the takeaway');
      const r=await p.evaluate(()=>{const g=glanceCard.getBoundingClientRect(),n=currentCard.getBoundingClientRect(),m=radarCard.getBoundingClientRect();return g.right<=m.x&&Math.abs(n.top-m.top)<2&&Math.abs(g.top-n.bottom)<2;});
      assert(r,'Now and Your day share the column beside radar on desktop');
      await p.setViewportSize({width:900,height:900});
      assert((await placement()).beside,'tablet keeps the takeaway beside the temperature');
      console.log('PASS glance desktop layout');
    }finally{await s.context.close();}

    for(const [temp,tone,word] of [[30,'tone-warning','Below freezing by'],[20,'tone-danger','Hard freeze by']]){
      s=await open(config('Glance freeze '+temp,{temp,condition:'Clear'}),390);p=s.page;
      try{
        const c=await card(p);
        assert.equal(c.tone,tone,temp+'° freeze tone');
        assert(c.lead.startsWith(word),temp+'° freeze wording: '+c.lead);
        assert(!/\d(am|pm)/.test(await p.locator('#ccTake .glance-detail').textContent()),'freeze detail names no time twice');
        if(c.rows<=2) assert.deepEqual([c.shown,c.button],[c.rows,null],'one extra row is shown, not hidden behind a button');
        console.log('PASS glance '+temp+'° freeze is '+tone+' ('+c.rows+' rows, '+c.shown+' shown)');
      }finally{await s.context.close();}
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
