#!/usr/bin/env node
'use strict';

// Exercise the served discovery/loader code with a deterministic clock and HTTP-shaped
// responses. These are synthetic failure scenarios, not observations of Matt's browser.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('./source').source;
const base=Date.parse('2026-10-09T16:00:00Z');
const metadata=names=>({layers:names.map(([id,name])=>({id,name,subLayerIds:null}))});
const spc=metadata([[1,'Day 1 Categorical Outlook'],[9,'Day 2 Categorical Outlook'],[17,'Day 3 Categorical Outlook'],[3,'Day 1 Probabilistic Tornado Outlook'],[7,'Day 1 Probabilistic Wind Outlook'],[5,'Day 1 Probabilistic Hail Outlook'],[11,'Day 2 Probabilistic Tornado Outlook'],[15,'Day 2 Probabilistic Wind Outlook'],[13,'Day 2 Probabilistic Hail Outlook']]);
const other={
  wpc_precip_hazards:metadata([[0,'Excessive Rainfall Day 1'],[1,'Excessive Rainfall Day 2'],[2,'Excessive Rainfall Day 3']]),
  SPC_firewx:metadata([[1,'Day 1 Outlook'],[4,'Day 2 Outlook'],[7,'Day 3 Dry Thunderstorm'],[8,'Day 3 Winds and Low Humidity']]),
  wpc_wssi:metadata([[1,'Overall_Impact_Day_1'],[2,'Overall_Impact_Day_2']])
};
const features=attrs=>({features:attrs.map(attributes=>({attributes}))});
const stamp=ms=>new Date(ms).toISOString().replace(/[-:TZ]/g,'').slice(0,12);
const period=day=>({valid:stamp(base-(4*3600000)+(day-1)*86400000),expire:stamp(base-(4*3600000)+day*86400000),issue:stamp(base-3600000)});
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:()=>Promise.resolve(body)});
function lift(name){
  const text=source.match(new RegExp('^function '+name+'\\([^\\n]*\\)\\{[^\\n]*\\}$','m'))
    ||source.match(new RegExp('^function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?^\\}','m'));
  assert(text,'Served function must exist: '+name);return text[0];
}
function declaration(name){
  const text=source.match(new RegExp('^var '+name+'=.*$','m'));
  assert(text,'Served declaration must exist: '+name);return text[0];
}
const subject=[
  ...['SPC_URL','ERO_URL','FIRE_URL','WSSI_URL','MCD_URL','WWA_URL','RISK_LAYERS','SPC_THREAT_LAYERS','RISK_READY','SPC_DISCOVERY_DELAYS','_spcDiscovery','_spcDisposed','_riskLayersP','_spcLoad','locSeq','locAbort'].map(declaration),
  ...['requestWeather','requestJSON','getJSON','isAbort','locGuard','locSignal','spcDiscoveryAbort','spcDiscoveryRetryable','readSpcLayers','waitSpcDiscovery','discoverSpcLayers','pauseSpcDiscovery','resumeSpcDiscovery','disposeSpcDiscovery','restoreSpcDiscovery','resolveRiskLayers','loadSpc','pointQuery','spcQuery','eroQuery','fireQuery','fireDay3Query','wssiQuery','fetchSpcThreats','spcUtcTime','spcOutlookPeriod','spcThreatProductCurrent','spcThreatProbability','spcRisk','eroRisk','fireRisk','riskPill'].map(lift)
].join('\n');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<60;i++)await Promise.resolve();}
function harness(metadataReply=()=>response(spc),queryReply=null,otherReply=null){
  let now=base,next=0,metadataCalls=0;
  const timers=new Map(),requests=[],paints=[],updates=[],restores=[],elements={};
  const context={AbortController,Promise,Error,Number,Array,Object,isFinite,Date:class extends Date {static now(){return now;}},
    setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);},
    current:{name:'Lake St. Louis, MO',lat:38.8,lon:-90.79},smart:{},callRisk:null,
    document:{hidden:false,getElementById(id){return elements[id]||(elements[id]={innerHTML:'',textContent:''});}},
    ic:()=>'',textOn:()=>'',renderSpcThreats:days=>paints.push(days),feedUpdate:(...args)=>updates.push(args),
    stampSched:keys=>restores.push(keys),runFeed:()=>Promise.resolve().then(()=>context.loadSpc())
  };
  context.fetch=(url,options)=>{
    const u=new URL(url),call={url:u,signal:options.signal,at:now,generation:context.locSeq};requests.push(call);
    if(u.pathname.includes('/SPC_wx_outlks/MapServer')){
      if(!u.pathname.includes('/query'))return Promise.resolve(metadataReply(++metadataCalls,call));
      if(queryReply){const r=queryReply(call);if(r!==undefined)return Promise.resolve(r);}
      const id=Number(u.pathname.split('/').at(-2)),day=id<9?1:2;
      if([1,9,17].includes(id))return Promise.resolve(response(features([{...period(day),dn:call.generation?6:0}])));
      if(u.searchParams.has('geometry'))return Promise.resolve(response(features([])));
      return Promise.resolve(response(features([5,13].includes(id)?[]:[period(day)])));
    }
    if(!u.pathname.includes('/query')){
      const key=Object.keys(other).find(k=>u.pathname.includes('/'+k+'/'));
      if(otherReply){const r=otherReply(key,call);if(r!==undefined)return Promise.resolve(r);}
      return Promise.resolve(response(key?other[key]:{layers:[]}));
    }
    return Promise.resolve(response(features([])));
  };
  vm.createContext(context);vm.runInContext(subject,context);
  return {context,requests,paints,updates,restores,timers,elements,
    metadataCalls:()=>metadataCalls,
    async advance(ms){
      const target=now+ms;
      await flush();
      for(;;){
        const first=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!first)break;
        now=first[1].at;timers.delete(first[0]);first[1].fn();await flush();
      }
      now=target;await flush();
    },
    move(){context.locSeq++;if(context.locAbort)context.locAbort.abort();context.locAbort=new AbortController();context.current={name:'New town, MO',lat:38.5,lon:-90.5};}
  };
}
const spcRequests=h=>h.requests.filter(r=>r.url.pathname.includes('/SPC_wx_outlks/MapServer'));
const pointRequests=h=>spcRequests(h).filter(r=>r.url.searchParams.has('geometry'));
let passed=0;
async function test(name,run){await run();passed++;console.log('ok    '+name);}
(async()=>{
  await test('shared discovery recovers after exactly 2 seconds; empty hail stays unknown',async()=>{
    const h=harness(n=>response(n===1?{error:{code:503}}:spc));
    const warm=h.context.resolveRiskLayers(),a=h.context.loadSpc(),b=h.context.loadSpc();
    assert.equal(a,b);assert.equal(warm,h.context.resolveRiskLayers());await flush();
    assert.equal(h.metadataCalls(),1);assert.equal(pointRequests(h).length,0);
    await h.advance(1999);assert.equal(h.metadataCalls(),1);
    await h.advance(1);await a;assert.equal(h.metadataCalls(),2);
    assert.deepEqual(h.paints.at(-1).map(d=>Array.from(d.values)),[[0,0,null],[0,0,null]]);
    assert.equal(h.context.callRisk.spc[0],0);assert.equal(h.updates.at(-1)[1],'partial');
    assert.equal(h.requests.filter(r=>!r.url.pathname.includes('/query')&&!r.url.pathname.includes('/SPC_wx_outlks/')).length,5);
    assert.equal(h.timers.size,0);await h.advance(120000);assert.equal(h.metadataCalls(),2);
  });
  await test('three attempts exhaust at 0, 2 and 7 seconds; cooldown cannot be bypassed',async()=>{
    const h=harness(()=>response({},503));const p=h.context.loadSpc();await h.advance(7000);await p;
    assert.equal(h.metadataCalls(),3);assert.deepEqual(spcRequests(h).map(r=>r.at-base),[0,2000,7000]);
    assert.equal(h.context.RISK_READY.spc,false);assert.equal(h.context.callRisk.spc[0],null);
    assert.equal(h.paints.at(-1)[0],null);assert.equal(h.timers.size,0);
    for(let i=0;i<5;i++){await h.context.loadSpc();h.move();}
    assert.equal(h.metadataCalls(),3);await h.advance(59999);await h.context.loadSpc();assert.equal(h.metadataCalls(),3);
    await h.advance(1);const next=h.context.loadSpc();await flush();assert.equal(h.metadataCalls(),4);
    h.context.disposeSpcDiscovery();await next;assert.equal(h.timers.size,0);
  });
  await test('second backoff recovers once, with no further automatic requests',async()=>{
    const h=harness(n=>response(n<3?{}:spc,n<3?502:200));const p=h.context.loadSpc();
    await h.advance(6999);assert.equal(h.metadataCalls(),2);await h.advance(1);await p;
    assert.equal(h.metadataCalls(),3);assert.equal(h.context.RISK_READY.threats,true);
    await h.advance(3600000);assert.equal(h.metadataCalls(),3);assert.equal(h.timers.size,0);
  });
  await test('HTTP and ArcGIS access denials and permanent client errors are not retried',async()=>{
    for(const status of [400,401,403,404,498,499])for(const bodyError of [false,true]){
      const h=harness(()=>response(bodyError?{error:{code:status}}:{},bodyError?200:status));
      await h.context.loadSpc();await h.advance(120000);assert.equal(h.metadataCalls(),1,String(status));
      assert.equal(h.context.RISK_READY.spc,false);assert.equal(h.timers.size,0);
    }
  });
  await test('timeout, transport and malformed/incomplete metadata remain bounded and recover',async()=>{
    for(const failure of ['timeout','transport','json','layers','names',408,429]){
      const h=harness((n,call)=>{
        if(n>1)return response(spc);
        if(failure==='timeout')return new Promise((_,reject)=>call.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
        if(failure==='transport')return Promise.reject(new TypeError('Failed to fetch'));
        if(failure==='json')return {ok:true,json:()=>Promise.reject(new SyntaxError('Bad JSON'))};
        if(failure==='layers')return response({layers:'bad'});
        if(failure==='names')return response(metadata([[1,'Day 1 Categorical Outlook']]));
        return response({},failure);
      });
      const p=h.context.loadSpc();await h.advance(failure==='timeout'?22000:2000);await p;
      assert.equal(h.metadataCalls(),2,String(failure));assert.equal(h.context.RISK_READY.threats,true);
      assert.equal(h.timers.size,0,String(failure));
    }
  });
  await test('a location change shares global retry and only the new location queries/paints',async()=>{
    const h=harness(n=>response(n===1?{error:{code:503}}:spc));
    const old=h.context.loadSpc();await flush();h.move();const current=h.context.loadSpc();
    await h.advance(2000);await Promise.all([old,current]);
    assert.equal(h.metadataCalls(),2);assert(pointRequests(h).every(r=>r.url.searchParams.get('geometry')==='-90.5,38.5'));
    assert.equal(h.paints.length,1);assert.equal(h.context.callRisk.spc[0],6);
    assert.equal(h.elements.spcLoc.textContent,'For New town, MO');
  });
  await test('late old product responses cannot launch queries for the new location or take over',async()=>{
    const held=[];
    const h=harness(()=>response(spc),call=>{
      if(call.generation===0&&!call.url.searchParams.has('geometry')){
        const d=deferred();held.push({d,day:Number(call.url.pathname.split('/').at(-2))<9?1:2});return d.promise;
      }
    });
    const old=h.context.loadSpc();await flush();assert.equal(held.length,2);
    h.move();const current=h.context.loadSpc();await current;
    const count=pointRequests(h).length;held.forEach(x=>x.d.resolve(response(features([period(x.day)]))));await old;
    assert.equal(pointRequests(h).length,count);assert.equal(h.paints.length,1);
    assert.equal(h.context.callRisk.spc[0],6);assert.equal(h.context._spcLoad,null);
  });
  await test('aborted local requests neither paint unknown values nor consume global retry ownership',async()=>{
    const h=harness(n=>response(n===1?{}:spc,n===1?503:200));const p=h.context.loadSpc();await flush();
    h.context.locAbort.abort();await h.advance(2000);await p;
    assert.equal(h.metadataCalls(),2);assert.equal(pointRequests(h).length,0);assert.equal(h.paints.length,0);
  });
  await test('hidden retry waits pause without resetting attempts and resume with their delay',async()=>{
    const h=harness(n=>response(n===1?{}:spc,n===1?503:200));const p=h.context.loadSpc();await h.advance(500);
    h.context.document.hidden=true;h.context.pauseSpcDiscovery();await h.advance(60000);
    assert.equal(h.metadataCalls(),1);assert.equal(h.timers.size,0);
    h.context.document.hidden=false;h.context.resumeSpcDiscovery();h.context.resumeSpcDiscovery();
    await h.advance(1999);assert.equal(h.metadataCalls(),1);await h.advance(1);await p;
    assert.equal(h.metadataCalls(),2);assert.equal(h.timers.size,0);
  });
  await test('pagehide cancels waits; repeated disposal settles, and BFCache restore loads once',async()=>{
    const h=harness(n=>response(n===1?{}:spc,n===1?503:200));const p=h.context.loadSpc();await flush();
    h.context.disposeSpcDiscovery();h.context.disposeSpcDiscovery();await p;await h.advance(10000);
    assert.equal(h.metadataCalls(),1);assert.equal(h.timers.size,0);assert.equal(h.paints.length,0);
    h.context.document.hidden=true;h.context.restoreSpcDiscovery();await flush();assert.equal(h.metadataCalls(),1);
    h.context.document.hidden=false;h.context.resumeSpcDiscovery();h.context.resumeSpcDiscovery();await flush();
    assert.equal(h.metadataCalls(),2);assert.equal(h.restores.length,1);assert.equal(h.paints.length,1);
  });
  await test('cancelled in-flight metadata cannot mutate a restored flight or clear its promise',async()=>{
    const held=deferred();const h=harness(n=>n===1?held.promise:response(spc));
    const old=h.context.loadSpc();await flush();h.context.disposeSpcDiscovery();
    h.context.restoreSpcDiscovery();await flush();assert.equal(h.paints.length,1);
    const memo=h.context._riskLayersP;
    held.resolve(response({layers:[]}));await old;
    assert.equal(h.context.RISK_READY.spc,true);assert.equal(h.context.RISK_READY.threats,true);
    assert.equal(h.context._riskLayersP,memo);assert.equal(h.metadataCalls(),2);
  });
  await test('same-location repeated refreshes share point requests and release listeners/timers',async()=>{
    const held=deferred();let first=true;
    const h=harness(()=>response(spc),call=>{
      if(first&&call.url.searchParams.has('geometry')){first=false;return held.promise;}
    });
    const a=h.context.loadSpc();await flush();const b=h.context.loadSpc(),c=h.context.loadSpc();
    assert.equal(a,b);assert.equal(b,c);const count=pointRequests(h).length;
    held.resolve(response(features([])));await Promise.all([a,b,c]);
    assert.equal(pointRequests(h).length,count);assert.equal(h.paints.length,1);assert.equal(h.timers.size,0);
    assert.equal(h.context._spcLoad,null);await h.context.loadSpc();assert.equal(h.paints.length,2);assert.equal(h.metadataCalls(),1);
  });
  await test('late metadata from every other provider cannot overwrite restored named layers',async()=>{
    const held=[];let first=true;
    const h=harness(()=>response(spc),null,(key,call)=>{
      if(first){const d=deferred();held.push({d,key,url:call.url});if(held.length===5)first=false;return d.promise;}
      if(key)return response({...other[key],layers:other[key].layers.map(l=>({...l,id:l.id+100}))});
      return response(metadata([[100,call.url.pathname.includes('spc_mesoscale_discussion')?'Mesoscale Discussion':'WatchesWarnings']]));
    });
    const old=h.context.loadSpc();await flush();assert.equal(held.length,5);
    h.context.disposeSpcDiscovery();h.context.restoreSpcDiscovery();await flush();
    assert.deepEqual(Array.from(h.context.RISK_LAYERS.ero),[100,101,102]);
    held.forEach(({d,key,url})=>d.resolve(response(key?other[key]:metadata([[0,url.pathname.includes('spc_mesoscale_discussion')?'Mesoscale Discussion':'WatchesWarnings']]))));
    await old;
    assert.deepEqual(Array.from(h.context.RISK_LAYERS.ero),[100,101,102]);
    assert.deepEqual(Array.from(h.context.RISK_LAYERS.fireCat),[101,104]);
    assert.deepEqual(Array.from(h.context.RISK_LAYERS.wssi),[101,102]);
    assert.equal(h.context.RISK_LAYERS.mcd,100);assert.equal(h.context.RISK_LAYERS.wwa,100);
  });
  console.log('\n'+passed+' SPC discovery regression scenarios passed');
})().catch(err=>{console.error(err);process.exitCode=1;});
