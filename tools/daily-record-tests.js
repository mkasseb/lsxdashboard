#!/usr/bin/env node
'use strict';
// Exercise the served calendar/loader decisions against dated primary-source observations.
const assert=require('node:assert/strict'),vm=require('node:vm'),fixture=require('./fixtures/weather/daily-records-recorded.json');
const source=require('./source').source,H=3600000,base=Date.parse('2026-10-11T14:58:20Z');
const normals=require('./fixtures/weather/daily-normals-recorded.json');
const normalReplay=normals.requests.find(r=>r.window==='records-replay').payload;
function lift(name){const m=source.match(new RegExp('^function '+name+'\\([^\\n]*\\)\\{(?:[^\\n]*\\}|[\\s\\S]*?^\\})','m'));assert(m,name);return m[0];}
const functions=['acisNum','weatherParts','calendarDate','nwsWallTime','locationKey','recordDateKey','forecastRecordDates','forecastCalendarKey','calendarRecordRequest','recordStationMatches','calendarNormalRequests','calendarNormalFacts','forecastNormalFor','calendarRecordFacts','calendarRecordMinimum','acisContextQueries','loadClimateContext'];
const clean=x=>JSON.parse(JSON.stringify(x));
function harness(){
 let clock=base,seq=0,active=0,max=0,calls=[],failure=null,normalFailure=null,hold=null;
 const store=new Map(),meta=fixture.records.KSTL['10-11'].response.meta;
 const station={sid:'KSTL',...meta};
 const state={Date:class extends Date{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}},Intl,Promise,console,
  current:{lat:38.8,lon:-90.79},smart:{days:[]},climate:{station:null},ctx:{ready:false},deferredFeeds:{context:false},CTX_KEY:'test',FEEDS:{context:{age:12*H}},feedChecks:{context:{successAt:0}},savedParts:{},MONTHS:Array.from({length:12},(_,i)=>String(i)),
  WEATHER_TZ:'America/Chicago',WEATHER_PARTS:new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}),
  locGuard(){const captured=seq;return ()=>seq===captured;},climStation:()=>Promise.resolve({sid:'SUS',...normalReplay.meta}),deepStation:()=>Promise.resolve(station),
  ctxTodayKey:()=>state.weatherParts().key,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  renderContext(){},freshnessCheck(){},feedUpdate(k,status){state.feedChecks[k]={status,successAt:status==='unavailable'?state.feedChecks[k].successAt:clock};},
  async acisPost(endpoint,params){
   assert.equal(endpoint,'StnData');calls.push(clean(params));active++;max=Math.max(max,active);
   try{
    await Promise.resolve();
    if(params.elems[0].normal){
     assert.equal(params.elems[0].normal,'91');assert.equal(params.elems[0].prec,1);assert.deepEqual(clean(params.meta),['name','sids','ll']);
     if(normalFailure==='timeout')throw new Error('Controlled normal timeout');
     const response=clean(normalReplay);response.data=response.data.filter(r=>r[0]>=params.sdate&&r[0]<=params.edate);
     if(normalFailure==='wrong station')response.meta=meta;
     if(normalFailure==='missing low')response.data.forEach(r=>{r[2]='M';});
     return response;
    }
    if(params.elems[0].interval&&Array.isArray(params.elems[0].interval)){
     if(hold){const h=hold;hold=null;await h(params);}
     if(failure===params.sdate.slice(5))throw new Error('Controlled timeout');
     return clean(fixture.records.KSTL[params.sdate.slice(5)]?.response||{error:'Date not in recorded fixture'});
    }
    if(params.sdate==='por')return {data:[['2025-10',3,72],['2026-10',2,71]]};
    return {data:[['2026-10-10',75,50,0],['2026-10-11','M','M','M']]};
   }finally{active--;}
  }
 };
 vm.createContext(state);vm.runInContext(functions.map(lift).join('\n'),state);
 return {s:state,store,calls,clock:t=>{clock=t;},move:()=>{seq++;state.current.lat=39;},max:()=>max,fail:md=>{failure=md;},normalFail:why=>{normalFailure=why;},hold:f=>{hold=f;}};
}
async function main(){
 const h=harness(),s=h.s;
 for(const [date,asOf,end]of [['2026-10-11','2026-10-11','2025-10-11'],['2027-01-01','2026-12-29','2026-01-01'],['2028-02-29','2028-02-29','2024-02-29'],['2028-03-01','2028-02-29','2027-03-01'],['2027-12-31','2027-01-01','2026-12-31']]){
  const p=s.calendarRecordRequest('KSTL',date,asOf);assert.equal(p.edate,end);assert(s.recordDateKey(p.sdate));assert(p.edate<asOf);assert(!p.elems.some(x=>x.normal));
 }
 assert.equal(s.recordDateKey('2027-02-29'),null);assert.equal(s.recordDateKey('2028-02-29'),'2028-02-29');
 assert.equal(s.forecastCalendarKey({startTime:'2026-10-11t06:00:00-05:00'}),'2026-10-11');assert.equal(s.forecastCalendarKey({startTime:'bad'}),null);
 for(const [now,date]of [['2026-10-01T04:59:00Z','2026-09-30'],['2026-10-01T05:01:00Z','2026-10-01'],['2026-03-08T07:59:00Z','2026-03-08'],['2026-03-08T08:01:00Z','2026-03-08'],['2026-11-01T06:59:00Z','2026-11-01'],['2026-11-01T07:01:00Z','2026-11-01']])assert.equal(s.weatherParts(now).key,date);
 const evening=[{name:'Tonight',night:{startTime:'2026-12-31T18:00:00-06:00',endTime:'2027-01-01T06:00:00-06:00'}},{name:'New Year’s Day',day:{startTime:'2027-01-01T06:00:00-06:00'}}];
 assert.deepEqual(clean(s.forecastRecordDates(evening,'2026-12-31')),['2026-12-31','2027-01-01']);
 assert.deepEqual(clean(s.forecastRecordDates([],'2026-12-29')),['2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04']);
 const expected=[[94,['1963'],30,['1964']],[88,['1947','2024'],31,['1987']],[89,['1989'],33,['1977','1979']],[89,['1947','2017'],30,['1937']],[89,['1938','1963'],30,['1937']],[89,['1950'],32,['1943']],[91,['2016'],29,['1943']]];
 for(const [station,dates]of Object.entries(fixture.records))for(const [md,{response}]of Object.entries(dates)){
  assert(s.recordStationMatches(station,response.meta));assert(!s.recordStationMatches('STLthr 9',response.meta));
  const r=s.calendarRecordFacts(response.data,'2026-'+md,'2026-10-11');
  assert(r.hiCount>=30&&r.loCount>=30);
  if(station==='KSTL'){const e=expected[Number(md.slice(3))-11];assert.deepEqual(clean([r.recHi.v,r.recHi.years,r.recLo.v,r.recLo.years]),e);assert.equal(r.hiCount,96);assert.equal(r.loCount,96);}
  if(station==='KCOU'&&md==='10-11'){assert.equal(r.recHi.v,87);assert.equal(r.hiCount,115);}
 }
 const leap=s.calendarRecordFacts([['2016-02-29',62,30],['2017-02-28',99,-30],['2020-02-29',62,20],['2024-02-29','M',20],['2028-02-29',150,-50]],'2028-02-29','2028-02-29');
 assert.deepEqual(clean([leap.recHi,leap.recLo,leap.hiCount,leap.loCount]),[{v:62,y:'2016',years:['2016','2020']},{v:20,y:'2020',years:['2020','2024']},2,3]);assert.equal(s.calendarRecordMinimum('2028-02-29'),10);
 const missing=s.calendarRecordFacts([['2000-10-11',0,'M'],['2001-10-11','T',-10],['2002-10-11','',null],['2003-10-11','NaN',Infinity],['2004-10-11',50,10],['2004-10-11',150,-50]],'2026-10-11','2026-10-11');
 assert.deepEqual(clean([missing.recHi,missing.recLo,missing.hiCount,missing.loCount]),[{v:0,y:'2000',years:['2000']},{v:-10,y:'2001',years:['2001']},1,1]);
 for(const captured of normals.requests){
  const dates=captured.payload.data.map(r=>r[0]),facts=s.calendarNormalFacts(captured.payload,dates,captured.params.sid);
  assert.equal(Object.keys(facts).length,dates.length);
  for(const row of captured.payload.data)assert.deepEqual(clean(facts[row[0]]),{date:row[0],hi:Number(row[1]),lo:Number(row[2]),normalPeriod:'1991-2020'});
 }
 const ranges=clean(s.calendarNormalRequests('SUS',['2027-01-01','2026-12-31','2027-01-02','2027-01-02','2027-02-29','2027-01-10']));
 assert.deepEqual(ranges.map(r=>[r.sdate,r.edate]),[['2026-12-31','2027-01-02'],['2027-01-10','2027-01-10']]);
 assert.equal(s.calendarNormalRequests('SUS',Array.from({length:40},(_,i)=>new Date(Date.UTC(2028,1,1+i)).toISOString().slice(0,10)))[0].edate,'2028-02-09','A normal range is bounded to at most nine dates');
 const malformed={meta:normalReplay.meta,data:[['2028-02-28',50,29],['2028-02-29',0,'M'],['2028-03-01','T','20junk'],['2028-03-02',51,30],['2028-03-02',52,30],['2027-02-29',150,-50],['2028-03-03','9'.repeat(400),Infinity]]};
 assert.deepEqual(clean(s.calendarNormalFacts(malformed,['2028-02-29','2028-03-01','2028-03-02','2028-03-03'],'SUS')),{'2028-02-29':{date:'2028-02-29',hi:0,lo:null,normalPeriod:'1991-2020'}});
 assert.deepEqual(clean(s.calendarNormalFacts(normalReplay,normalReplay.data.map(r=>r[0]),'KSTL')),{},'Normals for another airport cannot be borrowed');
 await s.loadClimateContext();assert.equal(h.calls.length,10);assert.equal(h.max(),3);assert.equal(Object.keys(s.ctx.recordsByDate).length,7);assert.equal(s.feedChecks.context.status,'ready');
 assert.equal(s.ctx.normWeek['2026-10-11'].hi,71.6);assert.equal(s.ctx.normWeek['2026-10-11'].lo,46.9);assert.equal(s.ctx.normalSource.sid,'SUS');assert.equal(s.ctx.recordSource.sid,'KSTL');
 assert.equal(s.forecastNormalFor('2026-10-11').checkedAt,base);assert.equal(s.forecastNormalFor('2026-10-18'),null);
 assert(s.ctx.recordsByDate['2026-10-12'].source.sids.includes('KSTL 5'));
 await s.loadClimateContext();assert.equal(h.calls.length,10,'A cache hit adds no history requests');assert.equal(s.feedChecks.context.successAt,base);
 s.smart.days=Array.from({length:7},(_,i)=>({day:{startTime:`2026-10-${12+i}T06:00:00-05:00`}}));
 h.clock(base+H);await s.loadClimateContext();assert.equal(h.calls.length,12,'Only the newly issued record and normal date are added');assert.equal(s.feedChecks.context.successAt,base,'Cache extension does not renew ancillary facts');assert.equal(s.ctx.recordsByDate['2026-10-18'],undefined);
 assert.equal(s.ctx.normWeek['2026-10-11'].checkedAt,base);assert.equal(s.ctx.normWeek['2026-10-18'].checkedAt,base+H);assert.equal(s.ctx.normWeek['2026-10-18'].hi,68.8);
 h.clock(base+12*H+1);assert.equal(s.forecastNormalFor('2026-10-11'),null);assert(s.forecastNormalFor('2026-10-18'),'Newly checked tail retains its own age');
 h.clock(base+13*H);await s.loadClimateContext();assert.equal(h.calls.length,23,'Stale cache refetches the bounded date set');
 const partial=harness();partial.fail('10-14');await partial.s.loadClimateContext();assert.equal(partial.s.feedChecks.context.status,'partial');assert.equal(Object.keys(partial.s.ctx.recordsByDate).length,6);assert.equal(partial.s.ctx.recordsByDate['2026-10-14'],undefined);
 assert(partial.s.forecastNormalFor('2026-10-14'),'A record failure cannot suppress the normal');
 for(const why of ['timeout','wrong station','missing low']){
  const failed=harness();failed.normalFail(why);await failed.s.loadClimateContext();
  assert.equal(failed.s.feedChecks.context.status,'partial');assert.equal(Object.keys(failed.s.ctx.recordsByDate).length,7,'A normal failure cannot suppress records');
  if(why==='missing low'){assert.equal(failed.s.forecastNormalFor('2026-10-11').lo,null);assert.equal(failed.s.forecastNormalFor('2026-10-11').hi,71.6);}
  else assert.equal(failed.s.forecastNormalFor('2026-10-11'),null);
  const count=failed.calls.length;await failed.s.loadClimateContext();assert.equal(failed.calls.length,count,'An unavailable date does not create a repaint retry loop');
 }
 const gate=harness();await gate.s.loadClimateContext();const normal=gate.s.ctx.normWeek['2026-10-11'];
 for(const [field,value]of [['date','2026-10-12'],['asOf','2026-10-10'],['normalPeriod','1981-2010'],['location','other'],['checkedAt',base+1]]){
  const old=normal[field];normal[field]=value;assert.equal(gate.s.forecastNormalFor('2026-10-11'),null,field+' mismatch safely withheld');normal[field]=old;
 }
 for(const reason of ['location','date','generation']){
  const race=harness();let release,started;const signal=new Promise(r=>{started=r;});race.hold(()=>{started();return new Promise(r=>{release=r;});});
  const old=race.s.loadClimateContext();await signal;
  if(reason==='location')race.move();else if(reason==='date')race.clock(Date.parse('2026-10-12T05:01:00Z'));else await race.s.loadClimateContext();
  const before=JSON.stringify(race.s.ctx),cache=race.store.get('test');release();await old;
  assert.equal(JSON.stringify(race.s.ctx),before);assert.equal(race.store.get('test'),cache,reason+' response cannot write a newer cache');
 }
 console.log('PASS verified daily normals and records, separate stations/baseline, all ties, malformed/missing values, literal leap dates, rollover/DST, bounded concurrency, independent failures, cache extension/expiry and location/date/generation races');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
