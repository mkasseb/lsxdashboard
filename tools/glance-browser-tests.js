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
    rainShown:[...document.querySelectorAll('#glance .glance-list li')].some(li=>li.offsetParent&&/Dry today/.test(li.textContent)),
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
      assert.equal(await p.locator('#ccTake .glance-action').count(),0,'an empty action produces no paragraph');
      assert.deepEqual([c.shown,c.button],[c.rows,null],'two rows show without a toggle');
      console.log('PASS glance phone shows two rows without a toggle');
    }finally{await s.context.close();}
    s=await open(config('Glance phone',{uv:11,weekRain:true,rh:40,aqi:35}),390);p=s.page;
    try{
      let c=await card(p);
      assert(c.rows>=3,'busy phone scenario has rows to collapse (got '+c.rows+')');
      assert.equal(c.shown,1,'phone shows exactly one support row');
      assert(c.rainShown,'the kept phone row answers the rain question');
      assert.deepEqual([c.button.expanded,c.button.text],['false','Show '+(c.rows-1)+' more']);
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

    s=await open(config('Glance November 18',{now:Date.parse('2026-11-18T08:40:00-06:00'),temp:42,rh:50}),1440);p=s.page;
    try{
      await p.evaluate(()=>{
        const temps=[42,46,48,50,55,63,66,64,61,54,49,47,46,45,43,42,41,40,39,39,38,38,39,40];
        smart.hourlyAll.slice(0,24).forEach((h,i)=>{
          h.temperature=temps[i]; h.windSpeed='0 mph'; h.shortForecast='Clear';
        });
        smart.weekDays=[{night:{name:'Saturday Night',startTime:'2026-11-21T18:00:00-06:00',
          endTime:'2026-11-22T06:00:00-06:00',temperature:44,shortForecast:'Chance Rain',
          windSpeed:'5 mph',probabilityOfPrecipitation:{value:46}}}];
        climate.normDate='2026-11-18'; climate.normLo=35; climate.normHi=55;
      });
      const reading={properties:{timestamp:'2026-11-18T08:35:00-06:00',textDescription:'Clear',
        temperature:{value:10/9},dewpoint:{value:-10/9},relativeHumidity:{value:86},windSpeed:{value:0}}};
      await p.route('**/observations/latest',r=>r.fulfill({json:reading}));
      await p.evaluate(()=>loadCurrent());
      assert.match(await p.locator('#current .cc-feels').textContent(),/34°/);
      const lead=await p.locator('#ccTake').textContent();
      assert.match(lead,/Chilly start, mild afternoon.*34° now → 66° by 2pm/);
      assert.doesNotMatch(lead,/Cold morning|8am/);
      const advice=await p.locator('#ccTake .glance-action').textContent();
      assert.match(advice,/Warm jacket until ~12pm, then light jacket or sweater/);
      assert.doesNotMatch(advice,/9am|short sleeves/i);
      const rows=await p.locator('#glance .glance-list li').allTextContents();
      assert.equal(rows.filter(r=>r.startsWith('Rain')).length,1);
      assert.match(rows.find(r=>r.startsWith('Rain')),/Dry today/);
      assert.match(rows.at(-1),/^Later.*Rain possible Saturday night.*46%/);
      assert.equal(await p.locator('#glanceScope').textContent(),'Next 24 hours');
      assert(!rows.some(r=>r.startsWith('Wear')),'temperature lead includes Wear advice');
      await p.evaluate(()=>{heroNow.observation.raw.properties.timestamp='2026-11-18T05:00:00-06:00';renderTheCall();});
      assert.doesNotMatch(await p.locator('#ccTake').textContent(),/34° now/,'stale observations cannot drive the lead');
      assert.deepEqual(s.errors,[]);
      console.log('PASS glance uses the fresh station reading and shows Rain and Later');
    }finally{await s.context.close();}

    for(const [temp,tone,word] of [[30,'tone-warning','Below freezing now'],[20,'tone-danger','Hard freeze now']]){
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
