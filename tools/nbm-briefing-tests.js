'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const s={Intl,Date,URLSearchParams};vm.createContext(s);vm.runInContext(fs.readFileSync('assets/hourly-range.js','utf8'),s);
const N=s.NbmHourly,H=3600000,base=Date.parse('2026-10-08T14:30Z');
function fixture({now=base,nws=36,bounds=[28,35,40],offsets=[1,2],run=now-8*H}={}){
 const hours=offsets.map(i=>{const t=Math.ceil(now/H)*H+i*H;return {startTime:new Date(t).toISOString(),endTime:new Date(t+H).toISOString(),temperature:nws,temperatureUnit:'F'};});
 const result={status:'ready',run,values:{}};
 hours.forEach(h=>result.values[Date.parse(h.startTime)]={p10:bounds[0],p50:bounds[1],p90:bounds[2]});
 return {now,hours,result};
}
function note(f){return N.planningNote(f.result,f.hours,f.now);}
assert.equal(note(fixture()).kind,'freeze');
assert.equal(note(fixture({nws:86,bounds:[82,87,94]})).kind,'heat');
for(const f of [fixture({offsets:[1]}),fixture({offsets:[1,3]}),fixture({nws:32}),fixture({nws:33}),fixture({nws:41,bounds:[28,35,45]}),fixture({nws:25}),fixture({nws:86,bounds:[87,90,94]}),fixture({nws:90,bounds:[82,88,94]}),fixture({nws:89,bounds:[82,88,94]}),fixture({bounds:[30.1,34,40]}),fixture({bounds:[28,32,33.9]}),fixture({bounds:[30,32,34],nws:34}),fixture({run:base-24*H}),fixture({run:base+H}),fixture({offsets:[-3,-2]}),fixture({offsets:[25,26]})])assert.equal(note(f),null);
assert(note(fixture({nws:34,bounds:[30,34,36]})),'Exact margin/width boundary qualifies');
assert(note(fixture({nws:88,bounds:[86,88,92]})),'Heat exact boundary qualifies');
assert(note(fixture({bounds:[20,32,40]})),'Wide valid range can add decision value');
for(const mutate of [f=>delete f.result.values[Date.parse(f.hours[1].startTime)],f=>f.hours.push({...f.hours[0]}),f=>f.hours[0].temperatureUnit='C',f=>f.hours[0].endTime=new Date(Date.parse(f.hours[0].endTime)+1).toISOString(),f=>f.result.status='stale',f=>f.result.values[Date.parse(f.hours[0].startTime)].p50=100]){const f=fixture();mutate(f);assert.equal(note(f),null);}
for(const season of ['2026-01-15','2026-04-15','2026-07-15','2026-10-15']){
 const f=fixture({now:Date.parse(season+'T12:30Z')});assert(note(f),'Data driven in every season');
}
for(const [now,times,zones] of [
 ['2026-11-01T05:30Z',['2026-11-01T06:00Z','2026-11-01T07:00Z'],['CDT','CST']],
 ['2026-03-08T06:30Z',['2026-03-08T07:00Z','2026-03-08T08:00Z'],['CST','CDT']]]){
 const f=fixture({now:Date.parse(now)});f.result.values={};f.hours=times.map(t=>({startTime:t,endTime:new Date(Date.parse(t)+H).toISOString(),temperature:36,temperatureUnit:'F'}));f.hours.forEach(h=>f.result.values[Date.parse(h.startTime)]={p10:28,p50:35,p90:40});
 const n=note(f);assert.equal(n.time,Date.parse(times[0]));assert(N.noteText(n).includes(zones[0]));assert(N.noteText({...n,time:Date.parse(times[1])}).includes(zones[1]));
}
const f=fixture({offsets:[1,2,4,5]});for(const h of f.hours.slice(2)){h.temperature=86;f.result.values[Date.parse(h.startTime)]={p10:82,p50:87,p90:94};}assert.equal(note(f).kind,'freeze','Earliest qualifying pair wins');
assert.equal(N.noteText(note(f)).includes('central 80% model range'),true);
console.log('PASS temperature briefing thresholds, margins, widths, exact UTC pairs, conflicts, gaps, seasons, DST and age');
