'use strict';
// Read-only hosted-test diagnostics. Do not change signals, timers, responses or fetch promises.
const {performance}=require('node:perf_hooks');
const LIMIT=1000,GROUP_LIMIT=60;
function endpoint(raw){
 try{const u=new URL(raw);return u.origin+u.pathname.replace(/\/points\/[^/]+/g,'/points/:point').replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi,':product').replace(/\/\d+\/\d+\/\d+(?=(?:\.[a-z]+)?$)/i,'/:z/:x/:y');}catch{return '(invalid URL)';}
}
function errorLabel(raw){return String(raw||'').match(/(?:net::)?ERR_[A-Z_]+|NS_ERROR_[A-Z_]+/)?.[0]||'other transport error';}
function browserObserver(sites){
 const fetchOriginal=window.fetch,abortOriginal=AbortController.prototype.abort,calls=new WeakMap(),pending=new Set();
 const generation=()=>typeof locSeq==='number'?locSeq:null;
 const emit=value=>{const p=window.__previewNetworkAbort(value).catch(()=>{});pending.add(p);p.finally(()=>pending.delete(p));};
 window.__previewNetworkFlush=()=>Promise.allSettled(Array.from(pending));
 AbortController.prototype.abort=function(){
  const frames=Array.from(String(new Error().stack).matchAll(/assets\/(weather-feeds\.js|dashboard\.js)(?:\?[^():\s]*)?:(\d+):(\d+)/g),m=>({file:m[1],line:Number(m[2])}));
  calls.set(this.signal,{at:Date.now(),generation:generation(),frames});
  return abortOriginal.apply(this,arguments);
 };
 window.fetch=function(input,options){
  const rawUrl=new URL(input instanceof Request?input.url:String(input),location.href).href,method=options?.method||input?.method||'GET',signal=options?.signal||input?.signal;
  const startedAt=Date.now(),startGeneration=generation();
  if(signal){
   const aborted=()=>{
    const call=calls.get(signal),frames=call?.frames||[];
    const timeout=frames.some(f=>f.file==='weather-feeds.js'&&f.line===sites.timeoutLine);
    const location=frames.some(f=>f.file==='dashboard.js'&&f.line===sites.locationLine)&&startGeneration!==null&&call.generation>startGeneration;
    emit({rawUrl,method,startedAt,startGeneration,abortGeneration:call?.generation??null,abortedAt:call?.at??Date.now(),
     cause:timeout?'weather-timeout':location?'observed-location-abort':'unclassified-signal-abort',frames:frames.slice(0,5)});
   };
   if(signal.aborted)aborted();else signal.addEventListener('abort',aborted,{once:true});
   // Keep observing through body consumption: requestWeather's timer also covers r.json()/r.text().
   // Fetch resolves at headers, so removing this listener on fetch resolution would miss body timeouts.
   return fetchOriginal.apply(this,arguments);
  }
  return fetchOriginal.apply(this,arguments);
 };
}
function classifyFailure(r,aborts){
 const matches=aborts.filter(a=>a.rawUrl===r.rawUrl&&a.method===r.method&&Math.abs(a.startedAt-r.wallStarted)<500&&Math.abs(a.abortedAt-r.wallFailed)<1000);
 // Similar concurrent requests cannot be assigned a cause unless every matching observation agrees.
 if(matches.some(a=>a.cause!==matches[0].cause))return {classification:'unclassified',evidence:'Conflicting observed abort causes; lifecycle timing cannot resolve them'};
 if(matches.length&&matches.every(a=>a.cause===matches[0].cause)){
  const a=matches.reduce((x,y)=>Math.abs(x.startedAt-r.wallStarted)<Math.abs(y.startedAt-r.wallStarted)?x:y);
  if(r.error!=='net::ERR_ABORTED'||!['fetch','xhr'].includes(r.resourceType))return {classification:'unclassified',evidence:'Signal abort observed, but transport code/resource is incompatible with a fetch cancellation',abort:a};
  if(a.cause==='weather-timeout')return {classification:'weather-timeout',evidence:'Observed 20-second requestWeather timer abort',abort:a};
  if(a.cause==='observed-location-abort')return {classification:'location-cancellation',evidence:'Abort initiator and superseded generation observed; endpoint/start-time correlation',abort:a};
  return {classification:'unclassified',evidence:'Signal abort observed but its initiator is not a recognized weather timer/location cancellation',abort:a};
 }
 if(r.error==='net::ERR_ABORTED'&&r.elapsedMs<19000){
  const boundary=r.boundaries.find(b=>b.kind==='context-close'||b.kind==='reload');
  if(boundary)return {classification:boundary.kind+'-interruption-correlated',evidence:'Short request pending across explicit lifecycle boundary; interruption is correlated, not directly observed'};
  if(['image','font'].includes(r.resourceType)&&r.boundaries.some(b=>['theme','location','resize'].includes(b.kind)))
   return {classification:'asset-cancellation-correlated',evidence:'Image/font pending across theme/location/layout change; cancellation cause is correlated, not directly observed'};
 }
 return {classification:'unclassified',evidence:'Transport error alone does not identify a cancellation or timeout cause'};
}
async function watchNetwork(page,audit,width,sites){
 const records=[],byRequest=new WeakMap(),pending=new Set(),aborts=[],boundaries=[];
 let phase='initial-load',epoch=0,serial=0,droppedRecords=0,droppedAborts=0,totalFailures=0,totalHttpErrors=0,finished=0;
 await page.exposeBinding('__previewNetworkAbort',(_,a)=>{if(aborts.length<LIMIT)aborts.push(a);else droppedAborts++;});
 await page.addInitScript(browserObserver,sites);
 page.on('request',request=>{
  const r={id:width+'-'+(++serial),rawUrl:request.url(),url:endpoint(request.url()),method:request.method(),resourceType:request.resourceType(),startPhase:phase,epoch,
   wallStarted:Date.now(),started:performance.now(),boundaries:[]};
  byRequest.set(request,r);pending.add(r);if(records.length<LIMIT)records.push(r);else droppedRecords++;
 });
 page.on('response',response=>{const r=byRequest.get(response.request());if(r){r.status=response.status();if(r.status>=400)totalHttpErrors++;}});
 function terminal(request,failed){
  const r=byRequest.get(request);if(!r)return;
  r.elapsedMs=Math.round(performance.now()-r.started);r.wallFailed=Date.now();r.endPhase=phase;r.outcome=failed?'failed':'finished';pending.delete(r);
  // Browser timing ties an observed fetch abort to the actual transport request more closely.
  if(request.timing().startTime>0)r.wallStarted=request.timing().startTime;
  if(failed){totalFailures++;r.error=errorLabel(request.failure()?.errorText);}else finished++;
 }
 page.on('requestfailed',r=>terminal(r,true));page.on('requestfinished',r=>terminal(r,false));
 return {
  mark(next,kind){phase=next;if(kind){const b={id:boundaries.length+1,kind,phase,epoch,pending:pending.size,at:new Date().toISOString()};boundaries.push(b);pending.forEach(r=>r.boundaries.push({id:b.id,kind}));if(kind==='reload')epoch++;}},
  flush:()=>page.evaluate(()=>window.__previewNetworkFlush?.()).catch(()=>{}),
  finish(){
   const groups=new Map(),failures=records.filter(r=>r.outcome==='failed');
   for(const r of failures){
    const result=classifyFailure(r,aborts),a=result.abort;
    const row={phase:'live',width,id:r.id,documentEpoch:r.epoch,startPhase:r.startPhase,failurePhase:r.endPhase,url:r.url,method:r.method,resourceType:r.resourceType,
     error:r.error,elapsedMs:r.elapsedMs,boundaries:r.boundaries,...result,abort:a?{startGeneration:a.startGeneration,abortGeneration:a.abortGeneration,signalAborted:true,frames:a.frames}:undefined};
    audit.networkFailures.push(row);
    const key=JSON.stringify([r.startPhase,r.endPhase,r.url,r.error,result.classification,r.resourceType]);
    let g=groups.get(key);if(!g){g={url:r.url,startPhase:r.startPhase,failurePhase:r.endPhase,error:r.error,classification:result.classification,evidence:result.evidence,resourceType:r.resourceType,count:0,minMs:r.elapsedMs,maxMs:r.elapsedMs,samples:[]};groups.set(key,g);}
    g.count++;g.minMs=Math.min(g.minMs,r.elapsedMs);g.maxMs=Math.max(g.maxMs,r.elapsedMs);if(g.samples.length<2)g.samples.push({id:r.id,epoch:r.epoch,boundaries:r.boundaries,abort:row.abort});
   }
   const httpGroups=new Map();
   records.filter(r=>r.status>=400).forEach(r=>{audit.httpErrors.push({phase:'live',width,scenario:r.endPhase||phase,url:r.url,status:r.status});const key=JSON.stringify([r.url,r.status,r.endPhase||phase]);const g=httpGroups.get(key)||{url:r.url,status:r.status,phase:r.endPhase||phase,count:0};g.count++;httpGroups.set(key,g);});
   const allGroups=Array.from(groups.values());
   const classifications=failures.reduce((counts,r)=>{const k=classifyFailure(r,aborts).classification;counts[k]=(counts[k]||0)+1;return counts;},{});
   const context={width,requests:serial,finished,failed:totalFailures,httpErrors:totalHttpErrors,abortObservations:aborts.length+droppedAborts,droppedRecords,droppedAborts,classifications,unloggedFailures:totalFailures-failures.length,
    unclassified:failures.filter(r=>classifyFailure(r,aborts).classification==='unclassified').length,groups:allGroups.slice(0,GROUP_LIMIT),omittedGroups:Math.max(0,allGroups.length-GROUP_LIMIT),httpGroups:Array.from(httpGroups.values()).slice(0,GROUP_LIMIT),omittedHttpGroups:Math.max(0,httpGroups.size-GROUP_LIMIT),boundaries};
   (audit.networkContexts||=[]).push(context);console.log('LIVE_NETWORK_AUDIT '+JSON.stringify(context));return context;
  }
 };
}
module.exports={endpoint,errorLabel,browserObserver,classifyFailure,watchNetwork};
