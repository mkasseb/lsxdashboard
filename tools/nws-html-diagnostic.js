#!/usr/bin/env node
'use strict';
// Read-only capture of a specific release. Keep every byte difference as a failure.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {request}=require('playwright');
const root=path.join(__dirname,'..'),out=process.argv[2],sha=process.env.NWS_DIAGNOSTIC_SHA;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 assert(/^[a-f0-9]{40}$/.test(sha||''));assert(out);
 fs.mkdirSync(out,{recursive:true});
 const expected=cp.execFileSync('git',['show',sha+':index.html'],{cwd:root}),audit={commit:sha,tls:'Default certificate validation; no bypass',expectedHash:hash(expected),responses:[]};
 fs.writeFileSync(path.join(out,'expected-index.html'),expected);
 const api=await request.newContext();
 try{
  for(const [label,route]of [['index-one','/index.html'],['index-two','/index.html'],['root','/']]){
   const r=await api.get('https://lsxdashboard.com'+route+'?verify='+sha,{timeout:30000});assert(r.ok(),label+' HTTP '+r.status());
   const bytes=await r.body();fs.writeFileSync(path.join(out,label+'.html'),bytes);
   let prefix=0,suffix=0;
   while(prefix<Math.min(expected.length,bytes.length)&&expected[prefix]===bytes[prefix])prefix++;
   while(suffix<Math.min(expected.length,bytes.length)-prefix&&expected[expected.length-1-suffix]===bytes[bytes.length-1-suffix])suffix++;
   const removed=expected.subarray(prefix,expected.length-suffix),inserted=bytes.subarray(prefix,bytes.length-suffix);
   const item={label,url:r.url(),status:r.status(),hash:hash(bytes),bytes:bytes.length,exact:bytes.equals(expected),prefix,suffix,removedBytes:removed.length,insertedBytes:inserted.length,
    removed:removed.toString('utf8').slice(0,16000),inserted:inserted.toString('utf8').slice(0,16000),diffTruncated:removed.length>16000||inserted.length>16000,
    headers:Object.fromEntries(Object.entries(r.headers()).filter(([k])=>['content-type','cache-control','cf-cache-status','cf-ray','etag'].includes(k)))};
   audit.responses.push(item);console.log(JSON.stringify(item));
   if(!item.exact)console.log('::notice title=Exact hosted HTML difference::'+JSON.stringify(item).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
  }
 }finally{await api.dispose();fs.writeFileSync(path.join(out,'html-diagnostic.json'),JSON.stringify(audit,null,2)+'\n');}
 assert(audit.responses.every(r=>r.exact),'Captured HTML differs from the release; inspect exact inserted/removed bytes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
