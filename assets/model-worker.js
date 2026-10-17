/* Same-origin dedicated worker; dependencies carry the page's exact content hashes. */
'use strict';
var initialized=false;
self.onmessage=function(event){
  var job=event.data||{};
  if(!initialized){
    var names=['weather-contracts.js','forecast-range.js','hourly-range.js','model-data.js'];
    if(!Array.isArray(job.init)||job.init.length!==names.length)throw new Error('Invalid model dependencies');
    var urls=job.init.map(function(value,i){
      var url=new URL(value,self.location.href);
      if(url.origin!==self.location.origin||url.pathname!=='/assets/'+names[i]||
         !/^[a-f0-9]{16}$/.test(url.searchParams.get('v')))throw new Error('Invalid model dependency URL');
      return url.href;
    });
    self.importScripts.apply(self,urls);initialized=true;self.postMessage({ready:true});return;
  }
  try{
    if(!['daily','hourly'].includes(job.kind)||!(job.buffer instanceof ArrayBuffer))throw new Error('Invalid model job');
    var data=JSON.parse(new TextDecoder().decode(job.buffer));
    self.postMessage({id:job.id,cache:ModelData.compile(data,job.kind,job.point,job.now)});
  }catch(e){self.postMessage({id:job.id,error:'Model data could not be processed.'});}
};
