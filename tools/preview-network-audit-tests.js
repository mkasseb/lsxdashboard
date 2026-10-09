'use strict';
const assert=require('node:assert/strict');
const {endpoint,errorLabel,classifyFailure,browserObserver,watchNetwork}=require('./preview-network-audit');
assert.equal(endpoint('https://user:secret@api.weather.gov/points/38.80,-90.79?token=private#fragment'),'https://api.weather.gov/points/:point');
assert.equal(endpoint('https://api.weather.gov/products/01234567-89ab-cdef-0123-456789abcdef?key=private'),'https://api.weather.gov/products/:product');
assert.equal(endpoint('https://tiles.example.org/base/5/10/12.pbf?key=private'),'https://tiles.example.org/base/:z/:x/:y.pbf');
assert.equal(errorLabel('net::ERR_ABORTED\nhttps://example.org/?key=private'),'net::ERR_ABORTED');
assert.equal(errorLabel('arbitrary secret or newline'),'other transport error');
const r={rawUrl:'https://example.org/data',method:'GET',wallStarted:1000,wallFailed:1200,elapsedMs:200,error:'net::ERR_ABORTED',resourceType:'fetch',boundaries:[]};
assert.equal(classifyFailure(r,[]).classification,'unclassified','ERR_ABORTED alone is insufficient');
const abort={rawUrl:r.rawUrl,method:r.method,startedAt:1000,abortedAt:1200,startGeneration:0,abortGeneration:1,cause:'observed-location-abort'};
assert.equal(classifyFailure(r,[abort]).classification,'location-cancellation');
assert.equal(classifyFailure({...r,boundaries:[{kind:'context-close'}]},[{...abort,cause:'weather-timeout'}]).classification,'weather-timeout','Observed timeout cannot be hidden by teardown');
assert.equal(classifyFailure({...r,boundaries:[{kind:'reload'}]},[]).classification,'reload-interruption-correlated');
assert.equal(classifyFailure({...r,elapsedMs:20001,boundaries:[{kind:'reload'}]},[]).classification,'unclassified','Late aborts may be weather timeouts');
assert.equal(classifyFailure({...r,resourceType:'image',boundaries:[{kind:'theme'}]},[]).classification,'asset-cancellation-correlated');
assert.equal(classifyFailure({...r,boundaries:[{kind:'theme'}]},[]).classification,'unclassified','Location-scoped fetches are not theme tiles');
assert.equal(classifyFailure(r,[{...abort,abortedAt:20000}]).classification,'unclassified','Unrelated later aborts cannot explain this request');
assert.equal(classifyFailure(r,[abort,{...abort,cause:'weather-timeout'}]).classification,'unclassified','Ambiguous concurrent observations must remain unclassified');
assert.equal(classifyFailure({...r,boundaries:[{kind:'reload'}]},[abort,{...abort,cause:'weather-timeout'}]).classification,'unclassified','Lifecycle timing cannot override conflicting observed causes');
assert.equal(classifyFailure({...r,error:'net::ERR_CONNECTION_RESET',boundaries:[{kind:'reload'}]},[abort]).classification,'unclassified','Connection failures are not observed location cancellations');
assert.equal(classifyFailure({...r,resourceType:'image',boundaries:[{kind:'reload'}]},[abort]).classification,'unclassified','A fetch observation cannot explain a different resource type');
assert.equal(classifyFailure({...r,boundaries:[{kind:'reload'}]},[{...abort,cause:'unclassified-signal-abort'}]).classification,'unclassified','An unknown observed initiator cannot be replaced by lifecycle timing');
const imageReset={rawUrl:r.rawUrl,at:1200,replacement:'Leaflet transparent image',connected:false};
assert.equal(classifyFailure({...r,resourceType:'image'},[],[imageReset]).classification,'tile-source-reset-correlated');
assert.equal(classifyFailure({...r,resourceType:'image',error:'net::ERR_CONNECTION_RESET'},[],[imageReset]).classification,'unclassified','A tile reset cannot explain a connection failure');
assert.equal(classifyFailure({...r,resourceType:'image'},[],[{...imageReset,rawUrl:'https://different.example.org/'}]).classification,'unclassified','Tile reset must match the exact request URL');
// Exercise actual signals and promise identity, including an abort after response headers resolve.
const vm=require('node:vm'),observations=[],fetchPromise=Promise.resolve({status:200});
class ObservedController extends AbortController{}
let mutationCallback,loadCallback;
class ObservedMutations{constructor(callback){mutationCallback=callback;}observe(){}}
const context=vm.createContext({AbortController:ObservedController,Request,URL,MutationObserver:ObservedMutations,document:{addEventListener:(name,callback)=>{if(name==='load')loadCallback=callback;}},locSeq:0,location:{href:'https://preview.example.org/'},window:{L:{Util:{emptyImageUrl:'data:image/gif;base64,transparent'}},fetch:()=>fetchPromise,__previewNetworkAbort:a=>{observations.push(a);return Promise.resolve();}}});
vm.runInContext('('+browserObserver.toString()+')({timeoutLine:69,locationLine:3030})',context);
vm.runInContext('var ctl=new AbortController(); var result=window.fetch("/data/nbm-hourly.json",{signal:ctl.signal});',context);
assert.equal(context.result,fetchPromise,'Observer returns the identical original fetch promise');
vm.runInContext('ctl.abort();',context,{filename:'assets/weather-feeds.js',lineOffset:68});
assert(context.ctl.signal.aborted);assert.equal(observations[0].cause,'weather-timeout');
vm.runInContext('ctl=new AbortController();window.fetch("/data/nbm-range.json",{signal:ctl.signal});locSeq++;',context);
vm.runInContext('ctl.abort();',context,{filename:'assets/dashboard.js',lineOffset:3029});
assert.equal(observations[1].cause,'observed-location-abort');assert.equal(observations[1].startGeneration,0);assert.equal(observations[1].abortGeneration,1);
const img={matches:()=>true,getAttribute:()=>context.window.L.Util.emptyImageUrl,isConnected:false};
mutationCallback([{type:'attributes',attributeName:'src',oldValue:'https://radar.example.org/tile?coordinates=private',target:img}]);
assert.equal(observations[2].kind,'image-source-reset');
img.currentSrc='https://radar.example.org/tile?coordinates=private';loadCallback({target:img});
mutationCallback([{type:'attributes',attributeName:'src',oldValue:img.currentSrc,target:img}]);assert.equal(observations.length,3,'Completed tile removals do not consume the failure-evidence budget');
const batched={...img,currentSrc:''};
mutationCallback([{type:'attributes',attributeName:'src',oldValue:'https://radar.example.org/A',target:batched},{type:'attributes',attributeName:'src',oldValue:'https://radar.example.org/B',target:batched}]);
assert.equal(observations.length,4);assert.equal(observations[3].rawUrl,'https://radar.example.org/B','A→B→empty batches record only the actual B→empty transition');
module.exports=(async()=>{
 vm.runInContext('ctl=new AbortController();window.fetch("/body-still-loading",{signal:ctl.signal});',context);
 await fetchPromise; // Allow fulfilled-header promise callbacks to run before a body-phase timeout.
 vm.runInContext('ctl.abort();',context,{filename:'assets/weather-feeds.js',lineOffset:68});
 assert.equal(observations[4].cause,'weather-timeout','A body-consumption timeout remains observable after fetch resolves');
 const page=new (require('node:events').EventEmitter)();page.exposeBinding=async()=>{};page.addInitScript=async()=>{};
 const audit={networkFailures:[],httpErrors:[]},watch=await watchNetwork(page,audit,390,{}, {log:false});
 const request=()=>({url:()=> 'https://preview.example.org/data?key=private',method:()=> 'GET',resourceType:()=> 'fetch',timing:()=>({startTime:Date.now()}),failure:()=>({errorText:'net::ERR_FAILED'})});
 for(let i=0;i<2000;i++){const r=request();page.emit('request',r);page.emit('requestfinished',r);}
 const late=request();page.emit('request',late);page.emit('requestfailed',late);
 const badHttp=request();page.emit('request',badHttp);page.emit('response',{request:()=>badHttp,status:()=>503});page.emit('requestfinished',badHttp);
 const c=watch.finish();assert.equal(c.requests,2002);assert.equal(c.failed,1);assert.equal(c.finished,2001);assert.equal(c.httpErrors,1);
 assert.equal(c.unloggedFailures,0);assert.equal(c.droppedRecords,0);assert.equal(audit.networkFailures.length,1);assert.equal(audit.httpErrors.length,1);
 assert(!JSON.stringify(audit).includes('private'),'Neither query tokens nor original URLs enter the retained audit');
 console.log('preview network audit redaction, timeout, lifecycle and late-failure retention controls passed');
})();
