#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {applicationHtml}=require('./hosted-html'),recording=require('./fixtures/weather/cloudflare-jsd-recorded.json');
const expected=Buffer.from(recording.applicationHtml),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let count=0;
function rejected(label,bytes,ray){assert(!applicationHtml(bytes,ray).bytes.equals(expected),label);count++;}
assert(applicationHtml(expected).bytes.equals(expected));count++;
for(const response of recording.responses){
 const captured=Buffer.concat([expected.subarray(0,response.prefix),Buffer.from(response.inserted),expected.subarray(expected.length-response.suffix)]);
 assert.equal(hash(captured),response.hash,'Fixture reconstructs the actual full hosted response');
 const checked=applicationHtml(captured,response.headers['cf-ray']);assert(checked.bytes.equals(expected));assert.equal(checked.injection.bytes,938);count++;
 const rawCopy=Buffer.from(captured);applicationHtml(captured,response.headers['cf-ray']);assert(captured.equals(rawCopy),'Comparison never mutates served bytes');count++;
 rejected('A mismatched response ray cannot authorize removal',captured,'0000000000000000-SJC');
 rejected('A missing response ray cannot authorize removal',captured);
 for(const [label,from,to]of [
  ['App wording','LSX Dashboard','Different Dashboard'],
  ['App asset version','?v=','?v=changed'],
  ['Additional app code','</body>','<script>window.unexpected=true</script></body>'],
  ['Modified challenge URL','/cdn-cgi/challenge-platform/scripts/jsd/main.js','/cdn-cgi/other.js'],
  ['Modified bootstrap code','a.height=1','a.height=2'],
  ['Code smuggled into bootstrap','a.width=1','a.width=1;window.unexpected=true'],
  ['Noncanonical timestamp encoding',"t:'MTc5MTUy", "t:'!Tc5MTUy"],
  ['Unknown tag attribute','<script>(function(){function c(){','<script data-unknown>(function(){function c(){']
 ]){
  assert(captured.toString().includes(from),label+' control changes actual bytes');
  rejected(label,Buffer.from(captured.toString().replace(from,to)),response.headers['cf-ray']);
 }
 const tag=recording.bootstrapTemplate.replace('{{RAY}}',response.headers['cf-ray'].split('-')[0]).replace('{{STAMP}}',captured.toString().match(/t:'([^']+)'/)[1]);
 rejected('Duplicate bootstrap cannot hide extra bytes',Buffer.from(captured.toString().replace('</body>',tag+'</body>')),response.headers['cf-ray']);
 rejected('Bootstrap at an unsupported position',Buffer.from(expected.toString().replace('<head>','<head>'+tag)),response.headers['cf-ray']);
}
// A new ray/time is permitted only inside the same exact template and with its own header.
const newRay='0123456789abcdef',stamp=Buffer.from('1791520900').toString('base64'),tag=recording.bootstrapTemplate.replace('{{RAY}}',newRay).replace('{{STAMP}}',stamp);
const varied=Buffer.from(expected.toString().replace('</body>',tag+'</body>'));
assert(applicationHtml(varied,newRay+'-SJC').bytes.equals(expected));count++;
console.log('PASS '+count+' strict hosted HTML checks: three real captures, dynamic metadata, preserved raw bytes, and unexpected app/bootstrap differences');
