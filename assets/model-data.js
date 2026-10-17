/* Parse and validate each model response once; renders only recheck source age/intervals. */
var ModelData=(function(){
  'use strict';
  var worker=null,starting=null,disabled=false,nextId=0,pending={};
  function abortError(){var e=new Error('Model request cancelled');e.name='AbortError';return e;}
  function compile(data,kind,point,now){
    var result=(kind==='daily'?NbmRange:NbmHourly).validate(data,point,now);
    // Regional daily periods also contain all grid cells. Only selected scalars cross
    // the worker boundary; neither renderer needs the regional Kelvin arrays again.
    if(result.periods)result=Object.assign({},result,{periods:result.periods.map(function(p){
      return {start:p.start,end:p.end,kind:p.kind,p25:p.p25,p50:p.p50,p75:p.p75};
    })});
    return {result:result,run:data&&data.run,retrievedAt:data&&data.retrievedAt};
  }
  function current(cache,kind,now){
    if(!cache)return {status:'unavailable',reason:'Model range unavailable.'};
    var r=cache.result;
    if(!r||!['ready','partial'].includes(r.status))return r||{status:'unavailable',reason:'Model range unavailable.'};
    var run=Date.parse(cache.run),retrieved=Date.parse(cache.retrievedAt);
    if(!Number.isFinite(run)||!Number.isFinite(retrieved)||run>now||retrieved>now+300000)
      return {status:'unavailable',reason:'Model source time failed validation.'};
    if(now-run>=WeatherContracts.policy.modelAge)return {status:'stale',run:run,
      reason:kind==='daily'?'NBM source cycle is 24 hours old or older; values withheld.':'Range expired: model run is 24 hours old or older.'};
    if(kind==='daily'){
      var periods=r.periods.filter(function(p){return Date.parse(p.end)>now;});
      return periods.length?Object.assign({},r,{periods:periods}):{status:'missing',run:run,reason:'No unexpired native temperature intervals.'};
    }
    return r;
  }
  function stop(){
    disabled=true;
    if(worker)worker.terminate();worker=null;
    Object.keys(pending).forEach(function(id){pending[id].reject(new Error('Model worker stopped'));});
  }
  function ensureWorker(){
    if(disabled||typeof Worker==='undefined')return Promise.resolve(null);
    if(starting)return starting;
    starting=new Promise(function(resolve){
      var timer,settled=false;
      function finish(ok){
        if(settled)return;settled=true;clearTimeout(timer);
        if(!ok)stop();resolve(ok?worker:null);
      }
      try{
        var descriptor=document.querySelector('script[data-worker-src]');
        if(!descriptor)throw new Error('Missing model worker descriptor');
        worker=new Worker(descriptor.dataset.workerSrc);
        timer=setTimeout(function(){finish(false);},5000);
        worker.onmessage=function(event){
          var data=event.data||{};
          if(data.ready){finish(true);return;}
          var job=pending[data.id];if(!job)return;
          if(data.error)job.reject(new Error(data.error));else job.resolve(data.cache);
        };
        worker.onerror=function(event){event.preventDefault();if(!settled)finish(false);else stop();};
        var modules=['weather-contracts.js','forecast-range.js','hourly-range.js','model-data.js'].map(function(name){
          var script=document.querySelector('script[src^="/assets/'+name+'?"]');
          if(!script)throw new Error('Missing versioned model dependency');return script.src;
        });
        worker.postMessage({init:modules});
      }catch(e){finish(false);}
    });
    return starting;
  }
  function process(buffer,kind,point,signal){
    if(signal&&signal.aborted)return Promise.reject(abortError());
    return ensureWorker().then(function(active){
      if(signal&&signal.aborted)throw abortError();
      if(!active)return compile(JSON.parse(new TextDecoder().decode(buffer)),kind,point,Date.now());
      return new Promise(function(resolve,reject){
        var id=++nextId,timer;
        function finish(error,value){
          if(!pending[id])return;delete pending[id];clearTimeout(timer);
          if(signal)signal.removeEventListener('abort',abort);
          if(error)reject(error);else resolve(value);
        }
        function abort(){finish(abortError());}
        pending[id]={resolve:function(value){finish(null,value);},reject:function(error){finish(error);}};
        if(signal)signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(function(){finish(new Error('Model processing timed out'));},WeatherContracts.policy.requestTimeout);
        // Transfer bytes without copying or parsing regional JSON on the UI thread.
        try{active.postMessage({id:id,kind:kind,point:point,now:Date.now(),buffer:buffer},[buffer]);}
        catch(e){finish(e);}
      });
    });
  }
  function load(kind,point,signal){
    if(!['daily','hourly'].includes(kind))return Promise.reject(new Error('Unknown model product'));
    return requestWeather('/data/nbm-'+(kind==='daily'?'range':'hourly')+'.json',{},signal,'buffer')
      .then(function(buffer){return process(buffer,kind,point,signal);});
  }
  return {load:load,current:current,compile:compile};
})();
