#!/usr/bin/env node
'use strict';

// Browser integration tests: serve the unchanged dashboard and intercept its real fetches.
// Weather extremes are synthetic NWS/ArcGIS-shaped scenarios, not historical observations.
// The recorded LSX case replays the source responses and retrieval time in fixtures/weather.
// Requires Playwright and a Chromium executable; no npm dependency is added to the dashboard.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/weather/lsx-recorded.json'), 'utf8'));
const H = 3600000;
const base = Date.parse('2026-09-30T18:00:00Z');
const chicago = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Chicago', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
const clone = x => JSON.parse(JSON.stringify(x));
function stamp(ms) {
  const wall = chicago.format(new Date(ms)).replace(' ', 'T');
  const offset = (Date.parse(wall+'Z')-ms)/60000;
  return wall+(offset<0?'-':'+')+String(Math.abs(offset)/60).padStart(2,'0')+':00';
}
function attrs(now, day, issueOffset=0) {
  const d=new Date(now);
  let start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),12);
  if(start>now) start-=24*H;
  if(day===2) start+=24*H;
  const utc=t=>new Date(t).toISOString().replace(/[-:TZ]/g,'').slice(0,12);
  return {valid:utc(start),expire:utc(start+24*H),issue:utc(now-H+issueOffset)};
}
function layer(now, periods, unit='wmoUnit:mm') {
  return {uom:unit,values:periods.map(([start,duration,value])=>({validTime:new Date(now+start*H).toISOString()+'/PT'+duration+'H',value}))};
}
function config(name, extra={}) {
  const now=extra.now||base;
  return {name,now,qpf:[[0,96,0]],snow:[[0,96,0]],ice:[[0,96,0]],gusts:[[0,96,32.18688]],temp:72,pop:0,wind:'5 to 10 mph',condition:'Sunny',alerts:[],probabilities:[[0,0,0],[0,0,0]],...extra};
}
function feeds(c, id='0') {
  const now=c.now, start=Math.floor(now/H)*H;
  const periods=Array.from({length:168},(_,i)=>{
    const time=start+i*H, hour=Number(stamp(time).slice(11,13));
    return {number:i+1,name:'',startTime:stamp(time),endTime:stamp(time+H),isDaytime:hour>=7&&hour<19,temperature:c.temp+(c.wave?Math.round(Math.sin(i/6)*c.wave):0),temperatureUnit:'F',temperatureTrend:null,probabilityOfPrecipitation:{unitCode:'wmoUnit:percent',value:c.pop},dewpoint:{unitCode:'wmoUnit:degC',value:10},relativeHumidity:{unitCode:'wmoUnit:percent',value:80},windSpeed:c.wind,windDirection:'SW',icon:'',shortForecast:c.condition,detailedForecast:''};
  });
  if(c.missingHourly) { periods[4].temperature=null; periods[10].probabilityOfPrecipitation.value=null; }
  const daily=Array.from({length:14},(_,i)=>{
    const p=clone(periods[i*12]);p.name=i===0?'Today':i%2?'Tonight':'Thursday';p.detailedForecast='Scenario '+c.name;p.endTime=stamp(start+(i+1)*12*H);return p;
  });
  return {
    points:{properties:{forecast:'https://api.weather.gov/gridpoints/LSX/'+id+'/forecast',forecastHourly:'https://api.weather.gov/gridpoints/LSX/'+id+'/forecast/hourly',forecastGridData:'https://api.weather.gov/gridpoints/LSX/'+id,observationStations:'https://api.weather.gov/gridpoints/LSX/'+id+'/stations',county:'https://api.weather.gov/zones/county/MOC183',forecastZone:'https://api.weather.gov/zones/forecast/MOZ052',fireWeatherZone:'https://api.weather.gov/zones/fire/MOZ052',timeZone:'America/Chicago',cwa:'LSX',relativeLocation:{properties:{city:'Lake St. Louis',state:'MO'}}}},
    hourly:{properties:{periods}},daily:{properties:{periods:daily}},
    grid:{properties:{updateTime:new Date(now-H).toISOString(),quantitativePrecipitation:layer(now,c.qpf,c.unit),snowfallAmount:layer(now,c.snow,c.unit),iceAccumulation:layer(now,c.ice,c.unit),windGust:layer(now,c.gusts,'wmoUnit:km_h-1')}},
    observation:{properties:{timestamp:new Date(now-(c.staleObservation?3*H:5*60000)).toISOString(),temperature:{value:(c.temp-32)*5/9},dewpoint:{value:10},relativeHumidity:{value:80},windSpeed:{value:16.1},windDirection:{value:225},windGust:{value:null},barometricPressure:{value:101325},visibility:{value:16093},textDescription:c.condition}}
  };
}
function alert(event, now, away=false) {
  return {id:'urn:scenario:'+event,type:'Feature',geometry:{type:'Polygon',coordinates:[away?[[-89,38],[-88,38],[-88,39],[-89,39],[-89,38]]:[[-91.2,38.2],[-90,38.2],[-90,39.4],[-91.2,39.4],[-91.2,38.2]]]},properties:{id:'urn:scenario:'+event,event,severity:event==='Tornado Warning'?'Extreme':event.includes('Advisory')?'Moderate':'Severe',urgency:'Immediate',certainty:'Observed',senderName:'NWS St Louis MO',sent:new Date(now-600000).toISOString(),effective:new Date(now-600000).toISOString(),onset:new Date(now-600000).toISOString(),expires:new Date(now+H).toISOString(),ends:new Date(now+H).toISOString(),areaDesc:away?'Madison':'St. Charles',affectedZones:['https://api.weather.gov/zones/county/'+(away?'ILC119':'MOC183')],headline:event+' issued for scenario testing',description:'Scenario weather hazard.',instruction:'Move to a safe location.',parameters:{NWSheadline:[event]}}};
}
function metadata(names) { return {layers:names.map(([id,name])=>({id,name,subLayerIds:null}))}; }
const SPC=metadata([[1,'Day 1 Categorical Outlook'],[9,'Day 2 Categorical Outlook'],[17,'Day 3 Categorical Outlook'],[3,'Day 1 Probabilistic Tornado Outlook'],[7,'Day 1 Probabilistic Wind Outlook'],[5,'Day 1 Probabilistic Hail Outlook'],[11,'Day 2 Probabilistic Tornado Outlook'],[15,'Day 2 Probabilistic Wind Outlook'],[13,'Day 2 Probabilistic Hail Outlook']]);
const otherMetadata={
  'wpc_precip_hazards':metadata([[0,'Excessive Rainfall Day 1'],[1,'Excessive Rainfall Day 2'],[2,'Excessive Rainfall Day 3']]),
  'SPC_firewx':metadata([[1,'Day 1 Outlook'],[4,'Day 2 Outlook'],[7,'Day 3 Dry Thunderstorm'],[8,'Day 3 Winds and Low Humidity']]),
  'wpc_wssi':metadata([[1,'Overall_Impact_Day_1'],[2,'Overall_Impact_Day_2']])
};
const features=a=>({features:a.map(attributes=>({attributes}))});
const results=[];
let browser;
async function open(c, width=390) {
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Chicago'});
  const page=await context.newPage();
  await page.clock.install({time:new Date(c.now)});
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  let active=c;
  await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.hostname==='lsx-weather-test.invalid') return route.fulfill({status:200,contentType:'text/html',body:html});
    // Capture a request's scenario before any delay; later switches must not rewrite an old response.
    const scenario=clone(active);
    const c=scenario.locations?.[u.searchParams.get('geometry')]||scenario;
    requests.push(u.href);
    const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
    if(c.offline) return reply({error:'simulated outage'},503);
    if(u.hostname==='air-quality-api.open-meteo.com'&&c.aqi!=null) return reply({current:{us_aqi:c.aqi,pm2_5:75,pm10:90}});
    if(u.hostname==='api.open-meteo.com'&&c.uv!=null) return reply({hourly:{time:[stamp(c.now).slice(0,19),stamp(c.now+H).slice(0,19)],uv_index:[c.uv,c.uv+1]},daily:{time:Array.from({length:7},(_,i)=>stamp(c.now+i*24*H).slice(0,10)),uv_index_max:Array(7).fill(c.uv+1)}});
    if(u.hostname==='api.water.noaa.gov'&&c.river){
      if(u.pathname.endsWith('/stageflow/forecast')) return reply({data:c.river.map((primary,i)=>({primary,validTime:new Date(c.now+i*24*H).toISOString()}))});
      return reply({status:{observed:{primary:20,primaryUnit:'ft',floodCategory:'minor'}},flood:{categories:{action:{stage:16},minor:{stage:18},moderate:{stage:24},major:{stage:30}}}});
    }
    if(u.hostname==='api.weather.gov') {
      let id='0';
      if(u.pathname.startsWith('/points/')) id=u.pathname.split('/').pop();
      else if(u.pathname.startsWith('/gridpoints/LSX/')) id=u.pathname.split('/').slice(3,u.pathname.endsWith('/forecast/hourly')?-2:u.pathname.endsWith('/forecast')||u.pathname.endsWith('/stations')?-1:undefined).join('/');
      const chosen=scenario.byId?.[id]||c;
      const f=chosen.recorded?clone(recorded.responses):feeds(chosen,id);
      if(chosen.delay) await new Promise(resolve=>setTimeout(resolve,chosen.delay));
      if(u.pathname.startsWith('/points/')) return reply(f.points);
      if(u.pathname.endsWith('/forecast/hourly')) return reply(chosen.hourlyDown||chosen.hourlyMalformed?{}:chosen.hourlyEmpty?{properties:{periods:[]}}:f.hourly,chosen.hourlyDown?503:200);
      if(u.pathname.endsWith('/forecast')) return reply(chosen.dailyDown?{}:f.daily,chosen.dailyDown?503:200);
      if(u.pathname.startsWith('/gridpoints/')&&!u.pathname.endsWith('/stations')) return reply(chosen.gridDown?{}:f.grid,chosen.gridDown?503:200);
      if(u.pathname.endsWith('/observations/latest')) return reply(f.observation);
      if(u.pathname.endsWith('/stations')) return reply({features:[{geometry:{type:'Point',coordinates:[-90.79,38.8]},properties:{stationIdentifier:'KSUS',name:'Test station'}}]});
      if(u.pathname==='/alerts/active') return reply({features:c.alerts});
      return reply({error:'ancillary feed intentionally unavailable'},503);
    }
    if(u.hostname==='mapservices.weather.noaa.gov') {
      if(u.pathname.includes('/SPC_wx_outlks/MapServer')) {
        if(!u.pathname.includes('/query')) return reply(SPC);
        const id=Number(u.pathname.split('/').at(-2)),day=id<9?1:2,a=attrs(c.now,day);
        if([1,9,17].includes(id)) return reply(features([{...a,dn:c.spcCategory||0}]));
        const k={3:0,7:1,5:2,11:0,15:1,13:2}[id];
        if(c.threatDown?.includes(id)) return reply({error:{code:500}});
        const product=c.staleThreats?.includes(id)?{...a,issue:attrs(c.now,day,-4*H).issue}:a;
        if(u.searchParams.get('returnDistinctValues')==='true') return reply(c.emptyThreats?.includes(id)?features([]):features([product]));
        const probability=c.probabilities[day-1][k];
        return reply(features(probability?[{...product,dn:k===0?2:5},{...product,dn:probability}]:[]));
      }
      for(const [service,m] of Object.entries(otherMetadata)){
        if(u.pathname.includes('/'+service+'/MapServer')) {
          if(!u.pathname.includes('/query')) return reply(m);
          if(service==='wpc_wssi'&&c.winterImpact) return reply(features([{impact:'Major',dn:4}]));
          if(service==='wpc_precip_hazards'&&c.floodRisk) return reply(features([{dn:c.floodRisk,rank:c.floodRisk}]));
          return reply(features([]));
        }
      }
      return reply(u.pathname.includes('/query')?features([]):{layers:[]});
    }
    if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.endsWith('.svg')) return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
    return route.abort().catch(()=>{}); // Maps and unrelated third-party widgets use their real fallbacks.
  });
  await page.goto('https://lsx-weather-test.invalid/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof refreshInFlight!=='undefined'&&refreshInFlight===null);
  return {page,context,errors,requests,change:c=>{active=c;}};
}
async function expectText(page,selector,pattern) {
  assert.match(await page.locator(selector).innerText(),pattern);
}
async function noOverflow(page) {
  const faults=await page.locator('.spc-threat-value').evaluateAll(els=>els.filter(el=>{
    const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);
    return [...range.getClientRects()].some(t=>t.left<r.left-.5||t.right>r.right+.5);
  }).length);
  assert.equal(faults,0,'probability labels must fit their cells');
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1;}).slice(0,12).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right,text:el.textContent.slice(0,100)}))}));
  assert(overflow.scroll<=overflow.width+1,'page must fit viewport: '+JSON.stringify(overflow));
}
async function durations(page, missing=false) {
  for(const hours of [24,48,72]) {
    await page.locator('#hourlyOptions [data-hours="'+hours+'"]').click();
    const cursor=page.locator('#hourlyCursor');
    assert.equal(Number(await cursor.getAttribute('max')),hours-1-(missing?1:0));
    await cursor.focus();await page.keyboard.press('End');
    assert.equal(Number(await cursor.inputValue()),hours-1-(missing?1:0));
    await expectText(page,'#h24Title',new RegExp('Next '+hours+' hours'));
    await expectText(page,'#hourlyDetail',/Wind/);
    assert(!/NaN|undefined/.test(await page.locator('#hourly24').innerText()));
    await page.keyboard.press('Home');
  }
}
function accumulationCases(count) {
  let seed=44044;
  function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
  return Array.from({length:count},(_,n)=>{
    const values=Array.from({length:24},()=>{const r=random();return r<.2?null:r<.6?0:Math.round(random()*100)/100+.01;});
    const hours=[24,48,72][n%3], groups=[];
    // Independent oracle: connect wet six-hour slots only through at most one known dry slot.
    const wet=values.map((v,i)=>v>0?i:-1).filter(i=>i>=0);
    for(const i of wet){
      const last=groups.at(-1),prev=last?.indices.at(-1);
      if(last&&i-prev<=2&&values.slice(prev+1,i).every(v=>v===0))last.indices.push(i);
      else groups.push({indices:[i]});
    }
    const expected=groups.filter(g=>g.indices[0]*6<hours).map(g=>({start:base+g.indices[0]*6*H,end:base+(g.indices.at(-1)+1)*6*H,amount:g.indices.reduce((sum,i)=>sum+values[i],0)}));
    const unit=['wmoUnit:in','wmoUnit:mm','wmoUnit:cm'][n%3],factor=[1,25.4,2.54][n%3];
    return {hours,expected,complete:values.slice(0,hours/6).every(v=>v!=null),grid:{quantitativePrecipitation:layer(base,values.map((v,i)=>[i*6,6,v==null?null:v*factor]),unit),snowfallAmount:layer(base,[[0,144,0]]),iceAccumulation:layer(base,[[0,144,0]])}};
  });
}
async function run(name,c,test,width=390) {
  if(process.env.WEATHER_CASE_FILTER&&!name.includes(process.env.WEATHER_CASE_FILTER)) return;
  let session;
  const started=Date.now();
  try {
    session=await open(c,width);await test(session);
    assert.deepEqual(session.errors,[],'no uncaught JavaScript errors');
    await noOverflow(session.page);
    results.push({name,status:'passed',width,ms:Date.now()-started,requests:session.requests.length});
    console.log('PASS',name);
  } catch(e) {
    results.push({name,status:'failed',width,ms:Date.now()-started,error:e.message});
    console.error('FAIL',name,e.message);
  } finally {if(session)await session.context.close();}
}
async function main() {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    await run('dry forecast and all duration controls',config('dry'),async({page})=>{
      await expectText(page,'#precipEvents',/No measurable precipitation/);await durations(page);
    });
    await run('rain bursts separated by six known dry hours',config('rain',{qpf:[[0,6,25.4],[6,6,0],[12,6,12.7],[18,78,0]],pop:80,condition:'Showers And Thunderstorms'}),async({page})=>{
      assert.equal(await page.locator('.precip-event').count(),1);await expectText(page,'.precip-total',/~1\.50″ rain/);await durations(page);
    });
    await run('separate rain events across a long dry gap',config('split',{qpf:[[0,6,25.4],[6,12,0],[18,6,12.7],[24,72,0]],pop:50}),async({page})=>assert.equal(await page.locator('.precip-event').count(),2));
    await run('heavy rain with local flash flood warning',config('flood',{qpf:[[0,6,50.8],[6,6,76.2],[12,6,12.7],[18,78,0]],pop:100,condition:'Heavy Rain',floodRisk:3,alerts:[alert('Flash Flood Warning',base)]}),async({page})=>{
      await expectText(page,'.precip-total',/~5\.50″ rain/);await expectText(page,'#alerts',/Flash Flood Warning/);assert(await page.evaluate(()=>!!callLocalAlert));
    });
    await run('mixed snow and freezing rain depths',config('winter',{temp:25,pop:100,condition:'Snow And Freezing Rain',qpf:[[0,6,12.7],[6,90,0]],snow:[[0,6,152.4],[6,90,0]],ice:[[0,6,6.35],[6,90,0]],alerts:[alert('Winter Storm Warning',base)]}),async({page})=>{
      await expectText(page,'.precip-total',/~0\.50″ liquid equivalent/);await expectText(page,'.precip-event',/Snow 6\.00″.*Ice 0\.25″/s);await durations(page);
    });
    await run('unknown frozen precipitation is not called rain',config('frozen unknown',{qpf:[[0,6,25.4],[6,90,0]],snow:[]}),async({page})=>await expectText(page,'.precip-total',/liquid equivalent/));
    for(const width of [320,768]){
      await run('combined winter hazards at '+width+'px',config('winter layout',{temp:20,pop:100,condition:'Snow And Freezing Rain',wind:'25 to 40 mph',qpf:[[0,6,25.4],[6,90,0]],snow:[[0,6,203.2],[6,90,0]],ice:[[0,6,6.35],[6,90,0]],winterImpact:true,alerts:[alert('Winter Storm Warning',base),alert('High Wind Warning',base)]}),async({page})=>{
        await expectText(page,'.precip-event',/Snow 8\.00″.*Ice 0\.25″/s);await durations(page);
      },width);
    }
    await run('ongoing accumulation keeps source-period total',config('ongoing',{now:base+15*60000,qpf:[[-.25,6,25.4],[5.75,90,0]],snow:[[-.25,96.25,0]],ice:[[-.25,96.25,0]]}),async({page})=>{
      await expectText(page,'.precip-total',/~1\.00″ rain/);await expectText(page,'.precip-event',/Ongoing.*hours already elapsed/s);
    });
    await run('event tail beyond the 72-hour view',config('tail',{qpf:[[0,66,0],[66,12,25.4],[78,18,0]]}),async({page})=>await expectText(page,'.precip-event',/1\.00″ rain.*beyond the 72-hour view/s));
    await run('missing amounts split events into known subtotals',config('missing',{qpf:[[0,6,25.4],[6,6,null],[12,6,12.7],[18,78,0]]}),async({page})=>{
      assert.equal(await page.locator('.precip-event').count(),2);assert.equal(await page.locator('.precip-total').filter({hasText:'Known'}).count(),2);await expectText(page,'#precipEvents',/Some periods are unavailable/);
    });
    await run('missing later amounts do not invalidate a completed earlier event',config('later missing',{qpf:[[0,6,25.4],[6,12,0],[18,6,null],[24,72,0]]}),async({page})=>await expectText(page,'.precip-total',/~1\.00″ rain/));
    await run('long dry break closes an earlier missing-data boundary',config('earlier missing',{qpf:[[0,6,null],[6,12,0],[18,6,25.4],[24,72,0]]}),async({page})=>await expectText(page,'.precip-total',/~1\.00″ rain/));
    await run('ambiguous overlapping accumulation periods',config('overlap',{qpf:[[0,6,25.4],[3,6,12.7],[9,87,0]]}),async({page})=>{
      await expectText(page,'#precipEvents',/incomplete/);assert.equal(await page.locator('.precip-event').count(),0);
    });
    await run('tornado warning and overlapping severe contours',config('tornado',{spcCategory:6,probabilities:[[10,45,30],[5,15,15]],pop:90,condition:'Severe Thunderstorms',wind:'35 to 50 mph',gusts:[[0,96,112.654]],alerts:[alert('Tornado Warning',base),alert('Severe Thunderstorm Watch',base,true)]}),async({page})=>{
      assert.deepEqual(await page.locator('.spc-threat-value').allTextContents(),['10%','45%','30%','5%','15%','15%']);await expectText(page,'#alerts',/Tornado Warning/);assert(await page.evaluate(()=>!!callLocalAlert));await durations(page);
    });
    const shortWarning=alert('Tornado Warning',base);
    shortWarning.properties.expires=shortWarning.properties.ends=new Date(base+60000).toISOString();
    await run('warning expiration promotes the next active local hazard',config('expiration',{pop:90,condition:'Severe Thunderstorms',alerts:[shortWarning,alert('Flood Advisory',base)]}),async({page})=>{
      assert.equal(await page.evaluate(()=>callLocalAlert.event),'Tornado Warning');
      await page.clock.setSystemTime(new Date(base+120000));await page.evaluate(()=>tickCountdowns());
      assert.equal(await page.evaluate(()=>callLocalAlert.event),'Flood Advisory');
      assert(!/Go to a basement/.test(await page.locator('#callRow').innerText()));
      await page.clock.setSystemTime(new Date(base+2*H));await page.evaluate(()=>tickCountdowns());
      assert.equal(await page.evaluate(()=>callLocalAlert),null);
      await page.evaluate(()=>loadAlerts());assert.equal(await page.evaluate(()=>callLocalAlert),null);
    });
    const shortHeat=alert('Excessive Heat Warning',base);
    shortHeat.properties.expires=shortHeat.properties.ends=new Date(base+60000).toISOString();
    await run('folded warning expiration preserves a later advisory phase',config('heat expiration',{temp:105,alerts:[shortHeat,alert('Heat Advisory',base)]}),async({page})=>{
      assert.equal(await page.evaluate(()=>callLocalAlert.level),'warning');
      await page.clock.setSystemTime(new Date(base+120000));await page.evaluate(()=>tickCountdowns());
      assert.equal(await page.evaluate(()=>callLocalAlert.level),'advisory');
    });
    await run('SPC update mismatches, missing products and failures',config('spc transition',{probabilities:[[10,15,5],[5,0,0]],staleThreats:[11],emptyThreats:[13],threatDown:[7]}),async({page})=>{
      assert.deepEqual(await page.locator('.spc-threat-value').allTextContents(),['10%','Unavailable','5%','Unavailable','<5%','Unavailable']);
    },320);
    await run('grid outage leaves hourly forecasts usable',config('grid outage',{gridDown:true}),async({page})=>{
      await expectText(page,'#precipEvents',/unavailable/);await durations(page);await expectText(page,'#hourlyDetail',/Gusts unavailable/);
    });
    await run('hourly outage preserves independent grid totals',config('hourly outage',{hourlyDown:true,qpf:[[0,6,25.4],[6,90,0]]}),async({page})=>{
      await expectText(page,'.precip-total',/1\.00″ rain/);await expectText(page,'#hourly24',/unavailable/);assert(await page.locator('#hourlyOptions button').first().isDisabled());
    });
    await run('malformed hourly response leaves the daily forecast available',config('malformed hourly',{hourlyMalformed:true}),async({page})=>{
      await expectText(page,'#hourly24',/unavailable/);assert.equal(await page.locator('#daily .day').count(),7);
    });
    await run('empty hourly refresh clears a previous chart',config('empty hourly'),async session=>{
      session.change(config('empty hourly',{hourlyEmpty:true}));await session.page.evaluate(()=>refreshAll());
      await expectText(session.page,'#hourly24',/unavailable/);assert.equal(await session.page.evaluate(()=>renderHourly24._hrs),null);assert.equal(await session.page.locator('#daily .day').count(),7);
    });
    await run('missing hourly temperature and rain chance',config('hourly missing',{missingHourly:true,pop:40}),async({page})=>{
      await durations(page,true);await expectText(page,'#hourly24',/Rain chance incomplete/);
    });
    for(const [name,temp,wind] of [['extreme heat',115,'5 mph'],['extreme cold',-20,'35 to 50 mph']]) {
      await run(name,config(name,{temp,wind,wave:3}),async({page})=>{await durations(page);assert(!/NaN|undefined|Infinity/.test(await page.locator('#current').innerText()));});
    }
    for(const [name,now] of [['fall daylight-saving transition','2026-11-01T05:00:00Z'],['spring daylight-saving transition','2026-03-08T06:00:00Z']]){
      await run(name,config(name,{now:Date.parse(now)}),async({page})=>{await durations(page);assert.equal(await page.evaluate(()=>new Set(renderHourly24._hrs.slice(0,72).map(h=>Date.parse(h.startTime))).size),72);});
    }
    await run('stale station observations cannot read as current',config('stale station',{staleObservation:true}),async({page})=>{await expectText(page,'#current',/Current observation unavailable/);assert.equal(await page.evaluate(()=>heroNow.temp),null);await durations(page);});
    await run('recorded live LSX grid and hourly replay',config('recorded',{recorded:true,now:Date.parse(recorded.recordedAt)}),async({page})=>{
      await durations(page);assert.equal(await page.evaluate(()=>forecastGrid.properties.updateTime),recorded.responses.grid.properties.updateTime);assert.equal(await page.evaluate(()=>smart.hourlyAll.length),recorded.responses.hourly.properties.periods.length);await expectText(page,'#precipEvents',/NWS forecast amounts/);await expectText(page,'.precip-total',/~0\.77″ rain/);
    },1440);
    await run('hazardous air quality and extreme UV',config('smoke and sun',{aqi:325,uv:11,temp:100}),async({page})=>{
      await expectText(page,'#aqi',/325.*Hazardous/s);assert(await page.locator('#aqiCard').evaluate(el=>el.classList.contains('show')));await expectText(page,'#ccUv',/11.*Extreme/s);assert.equal(await page.evaluate(()=>callAqi),325);
    },320);
    await run('river crest reaches major flood stage',config('river crest',{river:[22,28,32,25,20]}),async({page})=>{
      await expectText(page,'#rivers',/cresting 32 ft.*major flood/si);
    },320);
    await run('rising river tail is not described as a crest',config('river rising',{river:[22,28,32]}),async({page})=>{
      await expectText(page,'#rivers',/rising to 32 ft/);assert(!/cresting/.test(await page.locator('#rivers').innerText()));
    });
    await run('receding river forecast',config('river falling',{river:[19,17,15]}),async({page})=>await expectText(page,'#rivers',/falling to 15 ft/));
    await run('map CDN or style outage keeps official radar and observation links',config('maps unavailable'),async({page})=>{
      await expectText(page,'#radar',/Map didn.t load/);assert(await page.locator('#radar a[href*="radar.weather.gov"]').count());assert(await page.locator('#stnmap a[href*="weather.gov"]').count());
    });
    await run('100 concurrent refresh requests are coalesced',config('refresh storm',{delay:20,pop:60}),async({page})=>{
      const same=await page.evaluate(async()=>{const jobs=Array.from({length:100},()=>refreshAll());const same=jobs.every(j=>j===jobs[0]);await jobs[0];return same;});assert(same);assert(!(await page.locator('#refresh').isDisabled()));await durations(page);
    });
    await run('2000 generated accumulation scenarios with an independent oracle',config('generated'),async({page})=>{
      const cases=accumulationCases(2000);
      const actual=await page.evaluate(({cases,base})=>cases.map(c=>precipEventSummary(c.grid,base,c.hours)),{cases,base});
      for(let i=0;i<cases.length;i++){
        const a=actual[i],e=cases[i];assert.equal(a.complete,e.complete,'coverage case '+i);assert.equal(a.events.length,e.expected.length,'event count case '+i);
        for(let j=0;j<a.events.length;j++){
          assert.equal(a.events[j].start,e.expected[j].start);assert.equal(a.events[j].end,e.expected[j].end);assert(Math.abs(a.events[j].amount-e.expected[j].amount)<1e-8,'source totals case '+i);assert.equal(a.events[j].rain,true);
        }
      }
    });
    await run('300 chart duration changes do not grow the DOM',config('chart stress'),async({page})=>{
      const counts=await page.evaluate(()=>{
        const counts=[];
        for(let i=0;i<300;i++){hourlyHours=[24,48,72][i%3];renderHourly24();counts.push(document.querySelectorAll('#hourly24 *').length);}
        return counts;
      });
      assert(Math.max(...counts)<600);assert.equal(counts[2],counts.at(-1));await durations(page);
    });
    await run('repeated feed failures recover without stale gusts',config('recovery'),async session=>{
      for(let i=0;i<12;i++){
        session.change(config('cycle '+i,{gridDown:i%2===0,pop:60}));await session.page.evaluate(()=>refreshAll());
        assert.equal(await session.page.evaluate(()=>forecastGrid.status),i%2===0?'unavailable':'ready');
        if(i%2===0)await expectText(session.page,'#hourlyDetail',/Gusts unavailable/);
      }
      await durations(session.page);
    });
    await run('rapid location changes discard late forecasts',config('locations'),async session=>{
      const byId={};
      for(let i=0;i<8;i++)byId[(38.8+i/100).toFixed(4)+',-90.7900']=config('town '+i,{temp:40+i,delay:(8-i)*35,qpf:[[0,6,(i+1)*2.54],[6,90,0]]});
      session.change(config('location races',{byId}));
      await session.page.evaluate(async()=>{
        for(let i=0;i<8;i++){
          // Leave old requests alive to test generation guards in addition to normal cancellation.
          if(locAbort)locAbort.abort=function(){};
          setLocation({name:'Town '+i,lat:38.8+i/100,lon:-90.79,station:'KSUS'});
          await new Promise(resolve=>setTimeout(resolve,10));
        }
      });
      await session.page.waitForFunction(()=>snapSafeSeq===locSeq&&current.name==='Town 7');
      await new Promise(resolve=>setTimeout(resolve,400));
      assert.equal(await session.page.evaluate(()=>renderHourly24._hrs[0].temperature),47);
      await expectText(session.page,'.precip-total',/0\.80″ rain/);await expectText(session.page,'#precipEvents',/Town 7/);
    });
    await run('complete outage renders explicit unavailable states',config('offline',{offline:true}),async({page})=>{
      await expectText(page,'#hourly24',/unavailable/);await expectText(page,'#precipEvents',/unavailable/);assert.equal(await page.locator('.spc-threat-value').filter({hasText:'Unavailable'}).count(),6);assert(!(await page.locator('#refresh').isDisabled()));
    },320);
  } finally {await browser.close();}
  const report={testedAt:new Date().toISOString(),recordedSourceAt:recorded.recordedAt,scope:'Production dashboard in Chromium; synthetic weather extremes and one recorded live LSX replay. AQI, UV and rivers are simulated in selected cases; maps and other ancillary feeds exercise unavailable fallbacks.',passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,results};
  const reportPath=process.env.WEATHER_STRESS_REPORT||'/tmp/lsx-weather-stress-report.json';
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(report.passed+' passed; '+report.failed+' failed; report '+reportPath);
  if(report.failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
