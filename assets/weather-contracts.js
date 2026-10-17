/* Shared data contracts. Pure helpers are used by the UI, tests and read-only feed checks. */
var WeatherContracts=(function(){
  'use strict';
  var H=3600000;
  var policy=Object.freeze({clockSkew:10*60000,requestTimeout:20000,observationAge:2*H,
    stationRetention:6*H,riverObservationAge:2*H,riverForecastAge:48*H,airQualityAge:2*H,
    localForecastAge:12*H,messagesAge:18*H,uvSampleGap:90*60000,modelAge:24*H});
  function finite(value){return typeof value==='number'&&Number.isFinite(value);}
  function number(value,min,max){
    return finite(value)&&(min==null||value>=min)&&(max==null||value<=max)?value:null;
  }
  function time(value){return typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;}
  function sourceState(value,now,maxAge,skew){
    var t=time(value);
    if(!finite(t)||t<=0||t>now+(skew==null?policy.clockSkew:skew))return {state:'unknown',time:0};
    return {state:now-t>maxAge?'stale':'ready',time:t};
  }
  function dateKey(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    var t=Date.parse(value+'T12:00:00Z');
    return finite(t)&&new Date(t).toISOString().slice(0,10)===value?value:null;
  }
  var central=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
  function centralDate(t){
    if(!finite(t)||!finite(new Date(t).getTime()))return null;
    var parts={};central.formatToParts(t).forEach(function(p){parts[p.type]=p.value;});
    return parts.year+'-'+parts.month+'-'+parts.day;
  }
  // Canonical UI units are degrees F, mph, inches Hg, miles and percent. A missing
  // unit uses the NWS observation schema default; an explicit unknown unit is withheld.
  function measurement(field,kind){
    if(!field||!finite(field.value))return null;
    var value=field.value,unit=field.unitCode||field.uom;
    if(kind==='temperature'){
      unit=unit||'wmoUnit:degC';
      if(unit==='wmoUnit:degC')return value*9/5+32;
      if(unit==='wmoUnit:degF')return value;
      if(unit==='wmoUnit:K')return (value-273.15)*9/5+32;
    }else if(kind==='wind'){
      if(value<0)return null;
      unit=unit||'wmoUnit:km_h-1';
      if(unit==='wmoUnit:km_h-1'||unit==='wmoUnit:km_h')return value*0.621371;
      if(unit==='wmoUnit:m_s-1')return value*2.236936292;
      if(unit==='wmoUnit:kn')return value*1.150779448;
      if(unit==='wmoUnit:mi_h-1')return value;
    }else if(kind==='pressure'){
      if(value<0)return null;
      unit=unit||'wmoUnit:Pa';
      if(unit==='wmoUnit:Pa')return value/3386.39;
      if(unit==='wmoUnit:hPa')return value/33.8639;
      if(unit==='wmoUnit:inHg')return value;
    }else if(kind==='visibility'){
      if(value<0)return null;
      unit=unit||'wmoUnit:m';
      if(unit==='wmoUnit:m')return value/1609.34;
      if(unit==='wmoUnit:km')return value/1.60934;
      if(unit==='wmoUnit:mi')return value;
    }else if(kind==='humidity'){
      if(!unit||unit==='wmoUnit:percent')return number(value,0,100);
    }else if(kind==='direction'){
      if(!unit||unit==='wmoUnit:degree_(angle)')return number(value,0,360);
    }
    return null;
  }
  function observation(data,now,maxAge,requireTemperature){
    var p=data&&data.properties;if(!p)return null;
    var stamp=sourceState(p.timestamp,now,maxAge==null?policy.observationAge:maxAge);
    if(stamp.state!=='ready')return null;
    var out={time:stamp.time,temperature:measurement(p.temperature,'temperature'),
      dewpoint:measurement(p.dewpoint,'temperature'),humidity:measurement(p.relativeHumidity,'humidity'),
      wind:measurement(p.windSpeed,'wind'),direction:measurement(p.windDirection,'direction'),
      gust:measurement(p.windGust,'wind'),pressure:measurement(p.barometricPressure,'pressure'),
      visibility:measurement(p.visibility,'visibility'),heatIndex:measurement(p.heatIndex,'temperature'),
      windChill:measurement(p.windChill,'temperature')};
    return requireTemperature&&out.temperature==null?null:out;
  }
  function airQuality(data,now){
    var current=data&&data.current;
    if(!current||number(current.us_aqi,0)==null||!finite(current.time))return null;
    var stamp=sourceState(current.time*1000,now,policy.airQualityAge);
    return stamp.state==='ready'?{value:current.us_aqi,pm25:number(current.pm2_5,0),time:stamp.time}:null;
  }
  function uv(data,now){
    var hourly=data&&data.hourly||{},times=hourly.time,values=hourly.uv_index;
    if(!Array.isArray(times)||!Array.isArray(values))return null;
    var current=null,gap=Infinity,peak=null;
    times.forEach(function(value,i){
      var v=number(values[i],0),t=finite(value)?value*1000:typeof value==='string'&&/Z$|[+-]\d\d:\d\d$/.test(value)?Date.parse(value):NaN;
      if(v==null||!finite(t))return;
      var distance=Math.abs(t-now);
      if(distance<gap&&distance<=policy.uvSampleGap){gap=distance;current=v;}
      if(t>=now-30*60000&&t<=now+24*H&&(!peak||v>peak.v))peak={v:v,t:t};
    });
    if(current==null&&!peak)return null;
    var daily=data.daily||{},map={};
    if(Array.isArray(daily.time)&&Array.isArray(daily.uv_index_max))daily.time.forEach(function(value,i){
      var v=number(daily.uv_index_max[i],0),key=finite(value)?centralDate(value*1000):dateKey(value);
      if(v!=null&&key)map[key]=v;
    });
    return {now:current,peak:peak,daily:map};
  }
  function forecastWind(value){
    var factor=/\bkm\/h\b|\bkph\b/i.test(value)?0.621371:/\bknots?\b|\bkts?\b/i.test(value)?1.150779448:/\bm\/s\b/i.test(value)?2.236936292:null;
    if(factor==null)return value;
    return value.replace(/\d+(?:\.\d+)?/g,function(v){return String(Math.round(Number(v)*factor));})
      .replace(/km\/h|kph|knots?|kts?|m\/s/gi,'mph');
  }
  function forecast(data,now){
    if(!data||!data.properties||!Array.isArray(data.properties.periods))return null;
    var periods=data.properties.periods.filter(function(p){
      return p&&finite(p.temperature)&&typeof p.name==='string'&&typeof p.isDaytime==='boolean'
        &&typeof p.shortForecast==='string'&&typeof p.windSpeed==='string'
        &&(p.detailedForecast==null||typeof p.detailedForecast==='string')
        &&['F','C'].includes(p.temperatureUnit||'F')&&finite(time(p.startTime))
        &&time(p.endTime)>time(p.startTime)&&time(p.endTime)>now;
    }).map(function(p){return Object.assign({},p,{temperature:p.temperatureUnit==='C'?Math.round(p.temperature*9/5+32):p.temperature,
      temperatureUnit:'F',windSpeed:forecastWind(p.windSpeed)});}).sort(function(a,b){return time(a.startTime)-time(b.startTime);});
    return periods.length?{properties:Object.assign({},data.properties,{periods:periods})}:null;
  }
  function arcgis(data){return !!data&&!data.error&&Array.isArray(data.features)&&data.features.every(function(f){return f&&typeof f==='object';});}
  function mapStyle(style){return !!style&&style.version===8&&Array.isArray(style.layers)&&!!style.sources&&typeof style.sources==='object'&&!Array.isArray(style.sources);}
  return {policy:policy,finite:finite,number:number,time:time,sourceState:sourceState,dateKey:dateKey,
    measurement:measurement,observation:observation,airQuality:airQuality,uv:uv,forecast:forecast,arcgis:arcgis,mapStyle:mapStyle};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=WeatherContracts;
