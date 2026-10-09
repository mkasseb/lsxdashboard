#!/usr/bin/env node
'use strict';
// Offline parsing/freshness contracts, including authentic carried-forward LSX messages.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {afdKeyMessages,nwsTextTime,nwsLocalPeriod}=new Function(fs.readFileSync('assets/weather-core.js','utf8')+';return {afdKeyMessages,nwsTextTime,nwsLocalPeriod};')();
const recorded=require('./fixtures/weather/nws-afd-recorded.json'),now=Date.parse(recorded.verifiedAt),H=3600000;
const expected=[
 'Near-record warmth and predominantly dry weather is forecast into early next week.',
 'The remnants of Tropical Cyclone Isaias bring slightly "cooler" temperatures Saturday and Sunday due to clouds, as well as chances of light rain in southeast Missouri and southwest Illinois.'
];
for(const prod of recorded.products){
 const r=afdKeyMessages(prod,'LSX',now);assert.equal(r.status,'ready');assert.deepEqual(r.messages,expected);
 assert.equal(r.issuedAt,Date.parse(prod.issuanceTime));assert.equal(r.sectionIssuedAt,0,'No inferred Key Messages revision time');
 assert.equal(r.officeName,'St Louis MO');
}
const product=body=>({productCode:'AFD',issuingOffice:'KLSX',issuanceTime:'2026-10-08T23:02:00Z',productText:'AFDLSX\nNational Weather Service St Louis MO\n.KEY MESSAGES...\n'+body+'\n&&\n.SHORT TERM...\nOther material.\n&&'});
const status=(p,wanted,t=now,office='LSX')=>assert.equal(afdKeyMessages(p,office,t).status,wanted,JSON.stringify(p).slice(0,250));
status(product('-Dry weather into Friday.\n- Rain in southeast Missouri.\n  Elsewhere stays dry.'),'ready');
assert.deepEqual(afdKeyMessages(product('-Dry weather into Friday.\n- Rain in southeast Missouri.\n  Elsewhere stays dry.'),'LSX',now).messages,['Dry weather into Friday.','Rain in southeast Missouri. Elsewhere stays dry.']);
for(const stamp of ['Issued at 232 PM CDT Thu Oct 8 2026','232 PM CDT Thu Oct 8 2026']){
 const r=afdKeyMessages(product(stamp+'\n- Dry weather into Friday.'),'LSX',now);assert.equal(r.status,'ready');assert.equal(r.sectionIssuedAt,Date.parse('2026-10-08T19:32:00Z'));
}
const unicode=product('- Dry weather into Friday.');unicode.productText=unicode.productText.replace('.KEY MESSAGES...','.KEY MESSAGES…');status(unicode,'ready');
status(product('* Dry weather into Friday.\n* Rain remains southeast.'),'ready');
status(product('1. Dry weather into Friday.\n2. Rain remains southeast.'),'ready');
assert.deepEqual(afdKeyMessages(product('- Rainfall may exceed\n  1.00 inches in southeast Missouri.'),'LSX',now).messages,['Rainfall may exceed 1.00 inches in southeast Missouri.']);
assert.deepEqual(afdKeyMessages(product('- Wind chills may fall to\n  -30 to -20 degrees in northeast Missouri.'),'LSX',now).messages,['Wind chills may fall to -30 to -20 degrees in northeast Missouri.']);
status(product('- Dry weather into Friday.\n-'),'malformed');
status(product(''),'missing');
status(product('Issued at 232 PM CDT Thu Oct 8 2026'),'missing');
const missing=product('- Dry weather into Friday.');missing.productText=missing.productText.replace('KEY MESSAGES','SYNOPSIS');status(missing,'missing');
status(product('Dry weather into Friday.'),'malformed');
status(product('Issued at an unknown time\n- Dry weather into Friday.'),'malformed');
status(product('Issued at 1260 PM CDT Thu Oct 8 2026\n- Dry weather into Friday.'),'malformed');
status(product('Issued at 232 PM CDT Thu Feb 30 2026\n- Dry weather into Friday.'),'malformed');
status(product('Issued at 232 PM CDT Fri Oct 9 2026\n- Dry weather into Friday.'),'malformed');
status(product('Issued at 232 PM CDT Wed Oct 7 2026\n- Dry weather into Friday.'),'stale');
const truncated=product('- Rain in southeast Missouri.');truncated.productText=truncated.productText.split('&&')[0];status(truncated,'malformed');
const duplicate=product('- Dry weather into Friday.');duplicate.productText+='\n.KEY MESSAGES...\n- Another message here.\n&&';status(duplicate,'malformed');
const wrong=product('- Dry weather into Friday.');wrong.issuingOffice='KEAX';status(wrong,'malformed');
status(product('- Dry weather into Friday.'),'malformed',now,'EAX');
status({...product('- Dry weather into Friday.'),productCode:'HWO'},'malformed');
status({...product('- Dry weather into Friday.'),issuanceTime:'unknown'},'malformed');
status({...product('- Dry weather into Friday.'),issuanceTime:new Date(now+H).toISOString()},'malformed');
status(product('- Dry weather into Friday.'),'stale',Date.parse('2026-10-09T17:02:01Z'));
status(product('- Dry weather into Friday.'),'ready',Date.parse('2026-10-09T17:02:00Z'));
for(const value of [null,{},[],{productText:17}])status(value,'malformed');
assert.equal(nwsTextTime('1200 AM CST Sun Nov 1 2026'),Date.parse('2026-11-01T06:00:00Z'));
assert.equal(nwsTextTime('1200 PM CDT Thu Oct 8 2026'),Date.parse('2026-10-08T17:00:00Z'));
assert.equal(nwsTextTime('232 PM BAD Thu Oct 8 2026'),0);
const data={properties:{updateTime:new Date(now-H).toISOString(),periods:[{name:'Tonight',startTime:new Date(now-H).toISOString(),endTime:new Date(now+H).toISOString(),detailedForecast:'Mostly clear in southeast Missouri.',shortForecast:'Mostly Clear'}]}};
const check={status:'ready',successAt:now,saved:false};
assert.equal(nwsLocalPeriod(data,check,now,H).period.detailedForecast,'Mostly clear in southeast Missouri.');
for(const change of [{status:'unavailable'},{saved:true},{status:'partial'},{successAt:now-H-1},{successAt:now+1}])assert.equal(nwsLocalPeriod(data,{...check,...change},now,H),null);
for(const issued of ['unknown',new Date(now-13*H).toISOString(),new Date(now+H).toISOString()])assert.equal(nwsLocalPeriod({properties:{...data.properties,updateTime:issued}},check,now,H),null);
assert.equal(nwsLocalPeriod(data,check,now+H,H),null,'Expired local period withheld');
console.log('PASS authentic carried-forward messages; section/product clocks; bullet formats and order; missing, malformed, stale and office mismatch; current local forecast fallback');
