/* Dashboard rendering, interaction, maps and startup. Plain scripts; no build step. */

function feedUpdate(key,status,issued){
  var c=feedChecks[key]; if(!c) return;
  // Remove restored fragments before their loader paints its failure state. A saved normal must
  // never survive underneath an unavailable feed, or acquire a new timestamp on the next save.
  Object.keys(savedParts).forEach(function(id){
    if(savedParts[id]!==key) return;
    if(status==="unavailable"){
      var el=document.getElementById(id);
      if(el) el.innerHTML="";
    }
    delete savedParts[id];
  });
  c.status=status; c.saved=false;
  if(status==="ready"||status==="partial"){
    c.successAt=Date.now();
    var t=typeof issued==="number"?issued:Date.parse(issued||"");
    c.issuedAt=isFinite(t)&&t>0&&t<=Date.now()+10*60000?t:0;
  }
  freshnessCheck();
}
function freshnessCheck(){
  if(typeof renderForecastRecords==="function") renderForecastRecords();
  var now=Date.now(), total=0, counts={deferred:0,ready:0,partial:0,unavailable:0,stale:0,saved:0,loading:0};
  Object.keys(FEEDS).forEach(function(k){
    var cfg=FEEDS[k]; if(cfg.tracked===false) return;
    total++;
    var c=feedChecks[k], state=feedRequested(k)?feedState(c,now,cfg.age):"deferred";
    counts[state]++;
    if(!cfg.card) return;
    var card=document.getElementById(cfg.card); if(!card) return;
    var el=document.getElementById("fresh-"+k);
    if(!el){
      el=document.createElement("div"); el.id="fresh-"+k; el.className="feed-status";
      card.appendChild(el);
    }
    var text=cfg.label+": ";
    if(state==="ready"||state==="partial") text+=(state==="partial"?"Some data unavailable · ":"")+"checked "+weatherTime(c.successAt,{hour:"numeric",minute:"2-digit"})+" CT";
    else text+=({deferred:"Loads when this section approaches or is opened",loading:"Checking…",unavailable:"Unavailable",stale:"Check overdue",saved:"Saved data · awaiting verification"}[state]||"Unavailable")
      +(c.successAt?" · last successful check "+weatherTime(c.successAt,{weekday:"short",hour:"numeric",minute:"2-digit"})+" CT":"");
    if(c.issuedAt&&(state==="ready"||state==="partial"||state==="saved")) text+=" · source "+weatherTime(c.issuedAt,{weekday:"short",hour:"numeric",minute:"2-digit"})+" CT";
    el.setAttribute("data-state",state);
    if(el.textContent!==text) el.textContent=text;
  });
  var good=counts.ready+counts.partial, bad=counts.unavailable+counts.stale;
  var summary=good?good+" of "+total+" feeds checked"+(bad?" · "+bad+" unavailable or overdue":"")
    +(counts.partial?" · "+counts.partial+" with incomplete results":"")
    +(counts.loading?" · "+counts.loading+" checking":"")
    +(counts.saved?" · "+counts.saved+" showing saved data":"")
    +(counts.deferred?" · "+counts.deferred+" on demand":"")
    :(counts.saved?"Showing saved data; current weather is unverified":counts.loading?"Checking weather services…":"Weather data unavailable — no current checks succeeded");
  var dot=document.getElementById("statusDot"), btn=document.getElementById("refresh");
  var state=!good?(counts.loading?"loading":"unavailable"):(bad||counts.partial||counts.saved||counts.loading?"partial":"ready");
  if(dot){ dot.setAttribute("data-state",state); dot.classList.toggle("stale",state==="unavailable"); }
  var alert=feedChecks.alerts, alertState=feedState(alert,now,FEEDS.alerts.age);
  var notice=summary+". Alerts: "+({ready:"checked",partial:"some data unavailable",stale:"check overdue",saved:"saved and unverified",loading:"checking",unavailable:"unavailable"}[alertState]||"unavailable")+(alert.successAt?", last successful check "+weatherTime(alert.successAt,{weekday:"short",hour:"numeric",minute:"2-digit"})+" CT":"")+".";
  if(btn){ btn.title=notice; btn.setAttribute("aria-label","Refresh weather data. "+notice); }
  var footer=document.getElementById("lastUpdate");
  if(footer) footer.textContent=summary+(lastAttempt?" · last full refresh attempted "+weatherTime(lastAttempt,{weekday:"short",hour:"numeric",minute:"2-digit"})+" CT":"")+". All weather times are Central Time (CT).";
  if(typeof resolveSnapBar==="function") resolveSnapBar();
  renderBriefingStatus();
  if(renderTheCall._comfortAllowed!=null&&renderTheCall._comfortAllowed!==briefingComfortAllowed()) renderTheCall();
  renderNwsMessages();
}

function esc(s){return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
// Source links are native anchors, separate from disclosure buttons and risk explanations.
function officialSourceLink(url,label,content,cls,descriptionId,nameIds){
  var name=nameIds?' aria-labelledby="'+esc(nameIds)+'"':' aria-label="'+esc(label)+' (opens in a new tab)"';
  return '<a class="'+(cls||"source-link")+'" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer"'+name+(descriptionId?' aria-describedby="'+esc(descriptionId)+'"':'')+'>'+content+'</a>';
}
/* One reference into the inline sprite at the top of <body>. Always aria-hidden: every icon in this
   page sits beside a text label that already says the same thing, so announcing it twice is noise. */
function ic(name,cls){ return '<svg class="ic'+(cls?" "+cls:"")+'" aria-hidden="true"><use href="#i-'+name+'"/></svg>'; }
/* The DOM form, for the handful of places that set an element's contents rather than build HTML. */
function icNode(name,cls){
  var s=document.createElementNS("http://www.w3.org/2000/svg","svg");
  s.setAttribute("class","ic"+(cls?" "+cls:"")); s.setAttribute("aria-hidden","true");
  var u=document.createElementNS("http://www.w3.org/2000/svg","use");
  u.setAttribute("href","#i-"+name); s.appendChild(u);
  return s;
}

/* ============ ANIMATED WEATHER ICONS (Meteocons, MIT) ============ */
var ICON_BASE="https://cdn.jsdelivr.net/npm/@meteocons/svg/fill/";
function wxName(text,day){
  if(day===undefined)day=true;
  var t=(text||"").toLowerCase();
  if(t.indexOf("tornado")>=0)return "tornado";
  if(t.indexOf("thunder")>=0)return day?"thunderstorms-day":"thunderstorms-night";
  if(t.indexOf("sleet")>=0||t.indexOf("ice")>=0||t.indexOf("freezing")>=0)return "sleet";
  if(t.indexOf("snow")>=0||t.indexOf("flurr")>=0||t.indexOf("wintry")>=0)return "snow";
  if(t.indexOf("hail")>=0)return "hail";
  if(t.indexOf("drizzle")>=0)return "drizzle";
  if(t.indexOf("rain")>=0||t.indexOf("shower")>=0)return "rain";
  if(t.indexOf("fog")>=0)return day?"fog-day":"fog-night";
  if(t.indexOf("haze")>=0)return day?"haze-day":"haze-night";
  if(t.indexOf("smoke")>=0)return "smoke";
  if(t.indexOf("wind")>=0||t.indexOf("breezy")>=0||t.indexOf("blustery")>=0)return "wind";
  if(t.indexOf("overcast")>=0)return day?"overcast-day":"overcast-night";
  if(t.indexOf("partly")>=0||t.indexOf("mostly sunny")>=0||t.indexOf("mostly clear")>=0)return day?"partly-cloudy-day":"partly-cloudy-night";
  if(t.indexOf("cloudy")>=0)return "cloudy";
  if(t.indexOf("sunny")>=0||t.indexOf("clear")>=0||t.indexOf("fair")>=0||t.indexOf("hot")>=0)return day?"clear-day":"clear-night";
  return day?"partly-cloudy-day":"partly-cloudy-night";
}
function mcImg(name,fb,px,alt){
  /* alt is empty by DEFAULT and that is the right default: nearly every sky icon on this page sits
     beside words that already say the condition, and a second announcement of "Sunny" is noise.
     A collapsed 7-day row normally has its own concise condition text now. When that line is
     replaced by a higher-value feels-like impact, the row passes the full forecast here instead;
     data-alt carries that description to the CDN-failure path below. */
  return '<img class="wxi" src="'+ICON_BASE+name+'.svg" width="'+px+'" height="'+px+'" alt="'
    +esc(alt||"")+'" data-ic="'+fb+'"'+(alt?' data-alt="'+esc(alt)+'"':'')
    +' loading="lazy" onerror="wxiFail(this)">';
}
function wxImg(text,day,px,describe){ return mcImg(wxName(text,day), wxFallback(text,day), px, describe?text:""); }
function wxiFail(img){  // CDN down → fall back to the local sprite, at the size the <img> reserved
  var px=+img.getAttribute("width")||24;
  var s=icNode(img.getAttribute("data-ic")||"cloud");
  s.style.width=px+"px"; s.style.height=px+"px";
  // icNode() is aria-hidden, which is right for a decorative mark and wrong for the one icon that
  // was carrying the condition on its own. A CDN outage shouldn't also cost a screen reader the
  // forecast, so a described icon keeps its description across the swap.
  var alt=img.getAttribute("data-alt");
  if(alt){ s.setAttribute("aria-hidden","false"); s.setAttribute("role","img"); s.setAttribute("aria-label",alt); }
  img.replaceWith(s);
}

function wxGroup(desc,day){
  var t=(desc||"").toLowerCase();
  if(t.indexOf("thunder")>=0||t.indexOf("tornado")>=0)return "storm";
  if(t.indexOf("snow")>=0||t.indexOf("sleet")>=0||t.indexOf("hail")>=0||t.indexOf("flurr")>=0||t.indexOf("wintry")>=0||t.indexOf("freezing")>=0)return "snow";
  if(t.indexOf("rain")>=0||t.indexOf("drizzle")>=0||t.indexOf("shower")>=0)return "rain";
  if(t.indexOf("fog")>=0||t.indexOf("haze")>=0||t.indexOf("smoke")>=0||t.indexOf("mist")>=0)return "fog";
  if(t.indexOf("overcast")>=0||t.indexOf("cloudy")>=0&&t.indexOf("partly")<0)return "cloud";
  return day?"sun":"night";
}

/* ONE temperature→hue ramp (cold blue → hot red), shared by everything that colours a temperature,
   so a given reading reads the same on every card. Only the LIGHTNESS is per-context: thin strokes
   and text sit on the dark panel and want 52%, while the station-plot chips are filled blocks
   carrying dark text and need 62% to stay above 4.5:1 at the blue and red ends of the ramp. The
   HUE — the part that actually encodes the value — is identical, which is what the station plot
   used to get wrong by keeping its own 7-bucket scale. */
/* The domain is −10…95°F. It ran 15–95 for years, which handed every cold-snap reading the same
   terminal blue — the station plot's whole job is regional spread, and it went monochrome exactly
   the week that spread was the story. −10 covers a modern St. Louis outbreak; whatever undershoots
   it still clamps. The ENDPOINT hues (225 and 0) are untouched, so the 52%/62% lightness contrast
   tuning below still holds — mid-range temps just sit a shade warmer than they used to. */
function tHue(t){ return Math.round(225-225*Math.max(0,Math.min(1,(t+10)/(95+10)))); }
function tCol(t){ return "hsl("+tHue(t)+",78%,52%)"; }    // strokes, gradients, marks
function tChip(t){ return "hsl("+tHue(t)+",78%,62%)"; }   // filled chips that carry dark text
/* Temperature as a NUMBER you read, rather than a stroke you look at. tCol()'s 52% lightness is
   tuned to sit on a dark canvas as a line; the same value set as 13px text lands at 3-4:1, and the
   value that fixes that in the dark theme (a bright 72%) is invisible on white. An inline style is
   written once at render time and cannot know which theme it will be read in, so the markup emits
   the HUE only and CSS picks the lightness per theme — which also means the colours re-resolve the
   instant someone flips the toggle, with nothing to re-render. */
function tvAttr(t,cls){ return 'class="tv'+(cls?" "+cls:"")+'" style="--th:'+tHue(t)+'"'; }

var forecastGrid={status:"loading",properties:null,gusts:[]}, hourlyHours=24;
function forecastClock(ms){
  return new Date(ms).toLocaleString("en-US",{timeZone:"America/Chicago",weekday:"short",hour:"numeric",minute:"2-digit"});
}
function precipAmountText(amount){
  return amount>0&&amount<0.01?"<0.01\u2033":amount.toFixed(2)+"\u2033";
}
function renderPrecipEvents(){
  var el=document.getElementById("precipEvents"); if(!el) return;
  if(forecastGrid.status==="loading"){ el.innerHTML='<div class="loading">Loading precipitation amounts\u2026</div>'; return; }
  if(!forecastGrid.properties){
    el.innerHTML='<div class="precip-note">Precipitation amounts unavailable. Rain chances remain in the hourly forecast.</div>'; return;
  }
  var p=forecastGrid.properties, summary=precipEventSummary(p,Date.now(),72), html='';
  summary.events.forEach(function(e){
    var notes=[];
    if(e.ongoing) notes.push("Includes the current forecast period, including hours already elapsed");
    if(e.partial) notes.push("Some amounts missing; this is a known subtotal");
    if(e.continues) notes.push("Continues beyond the available forecast; total is incomplete");
    else if(e.beyondView) notes.push("Full event total includes hours beyond the 72-hour view");
    var extra=[];
    if(e.snow>0) extra.push("Snow "+precipAmountText(e.snow));
    if(e.ice>0) extra.push("Ice "+precipAmountText(e.ice));
    html+='<div class="precip-event"><div class="precip-when">'+(e.ongoing?'Ongoing \u00b7 ':'')
      +esc(forecastClock(e.start))+" \u2013 "+esc(forecastClock(e.end))+'</div>'
      +'<div class="precip-total">'+(e.partial||e.continues?'Known ':'~')+precipAmountText(e.amount)
      +' '+(e.rain?'rain':'liquid equivalent')+'</div>'
      +(extra.length?'<div class="precip-when">'+esc(extra.join(" \u00b7 "))+'</div>':'')
      +(notes.length?'<div class="precip-note">'+esc(notes.join(". "))+'.</div>':'')+'</div>';
  });
  el.innerHTML='<div class="precip-head">Upcoming precipitation \u00b7 events starting within 72 hours</div>'
    +(html?'<div class="precip-list">'+html+'</div>':'<div class="precip-when">'
      +(summary.dry?'No measurable precipitation forecast in the next 72 hours.':'Precipitation amounts incomplete; no reliable event total available.')+'</div>')
    +'<div class="precip-note">NWS forecast amounts for '+esc(current.name.replace(" (home)",""))
    +' \u00b7 '+(p.updateTime?'issued '+esc(timeAgo(p.updateTime))+' \u00b7 ':'')
    +'Timing follows forecast accumulation periods; rain may be intermittent.'
    +(!summary.complete?' Some periods are unavailable.':'')+'</div>';
}

function syncHourlyControls(){
  var wrap=document.querySelector("#hourly24 .h24-wrap"), hours=wrap?Number(wrap.getAttribute("data-hours")):hourlyHours;
  var title=document.getElementById("h24Title"); if(title) title.textContent="Next "+hours+" hours";
  document.querySelectorAll("#hourlyOptions button").forEach(function(b){
    b.setAttribute("aria-pressed",String(Number(b.getAttribute("data-hours"))===hours));
    b.disabled=!forecastWindowHours(renderHourly24._hrs,hourlyHours,Date.now()).length;
  });
}
document.getElementById("hourlyOptions").addEventListener("click",function(ev){
  var b=ev.target.closest("button[data-hours]"); if(!b||b.disabled) return;
  hourlyHours=Number(b.getAttribute("data-hours")); renderHourly24._cursor=0; renderHourly24._selectedTime=null; renderHourly24();
});
function renderHourly24(hrs){
  var el=document.getElementById("hourly24"); if(!el) return;
  var restoreFocus=document.activeElement&&document.activeElement.id==="hourlyCursor";
  if(hrs&&hrs.length) renderHourly24._hrs=hrs;
  hrs=forecastWindowHours(renderHourly24._hrs,hourlyHours,Date.now());
  if(!hrs||!hrs.length){
    // A resize can fire before live data arrives — never overwrite a restored snapshot chart
    if(renderHourly24._hrs||!el.querySelector(".h24-svg")) clearHourlyForecast();
    syncHourlyControls(); return;
  }
  var nbmPoints=typeof NbmHourly!=="undefined"?NbmHourly.presentation(hrs,hourlyHours,Date.now()):[];
  var n=hrs.length, i;
  var hi=-999, lo=999, peak=0, popMissing=false, popKnown=false, temps=[], pops=[], feels=[], maxDiv=0, feelsHi=-999, maxWind=null, maxGust=null, gustMissing=false;
  for(i=0;i<n;i++){
    var t=hrs[i].temperature; temps.push(t); if(t>hi)hi=t; if(t<lo)lo=t;
    var v=precipChance(hrs[i].probabilityOfPrecipitation);
    pops.push(v); if(v==null) popMissing=true; else{ popKnown=true; if(v>peak) peak=v; }
    var hrh=(hrs[i].relativeHumidity&&hrs[i].relativeHumidity.value!=null)?hrs[i].relativeHumidity.value:null;
    var fl=feelsLikeF(t,hrh,parseMph(hrs[i].windSpeed)); feels.push(fl);
    var wind=parseMph(hrs[i].windSpeed), gust=gridGustAt(forecastGrid.gusts,Date.parse(hrs[i].startTime));
    if(wind!=null) maxWind=maxWind==null?wind:Math.max(maxWind,wind);
    if(gust!=null) maxGust=maxGust==null?gust:Math.max(maxGust,gust);
    else gustMissing=true;
    if(fl!=null){ if(Math.abs(fl-t)>maxDiv) maxDiv=Math.abs(fl-t); if(fl>feelsHi) feelsHi=fl; }
  }
  var showFeels = maxDiv>=3;   // ghost curve only when it meaningfully diverges
  var sum='<div class="h24-sum">'
    +'<span class="h24-pill">▲ High <b '+tvAttr(hi)+'>'+hi+'°</b></span>'
    +'<span class="h24-pill">▼ Low <b '+tvAttr(lo)+'>'+lo+'°</b></span>'
    +'<span class="h24-pill">'+ic("drop")+(popMissing?(popKnown?'Rain chance incomplete · known peak <b style="color:var(--accent)">'+peak+'%</b>':'Rain chance unavailable'):'Peak rain <b style="color:var(--accent)">'+peak+'%</b>')+'</span>'
    +(maxWind!=null?'<span class="h24-pill">'+ic("wind")+'Wind up to <b>'+maxWind+' mph</b></span>':'')
    +(maxGust!=null?'<span class="h24-pill">'+(gustMissing?'Known gusts':'Gusts')+' up to <b>'+Math.round(maxGust)+' mph</b></span>':'')
    +(showFeels?'<span class="h24-pill">'+ic("heat")+'Feels high <b '+tvAttr(feelsHi)+'>'+feelsHi+'°</b></span>':'')
    +'<span class="h24-pill h24-now">'+wxImg(hrs[0].shortForecast,hrs[0].isDaytime,20)+' Forecast <b>'+hrs[0].temperature+'°</b></span>'
    +'</div>';

  // ---- geometry (full container width; 1200 fallback pre-layout) ----
  var W=el.clientWidth||1200, narrow=W<=680;
  var H=narrow?190:236, padL=16, padR=16, innerW=W-padL-padR, denom=Math.max(1,n-1), slot=innerW/Math.max(1,hourlyHours-1);
  var windowStart=Math.floor(Date.now()/3600000)*3600000;
  function contiguous(i){ return i>0&&Date.parse(hrs[i].startTime)-Date.parse(hrs[i-1].startTime)===3600000; }
  var iconPx=narrow?22:28, iconY=25;
  var curveTop=iconY+iconPx+(narrow?18:24), baseY=H-58, barBase=H-26, barMax=narrow?26:34, timeY=H-8;
  var step = slot>=48?1 : slot>=30?2 : slot>=20?3 : slot>=12?6 : 12;
  var scLo=lo, scHi=hi;
  if(showFeels){ for(i=0;i<n;i++){ if(feels[i]!=null){ if(feels[i]<scLo)scLo=feels[i]; if(feels[i]>scHi)scHi=feels[i]; } } }
  nbmPoints.forEach(function(p){if(p){scLo=Math.min(scLo,p.p25);scHi=Math.max(scHi,p.p75);}});
  var tMin=scLo-2, tMax=scHi+2, rng=Math.max(4,tMax-tMin);
  function X(i){ return padL+slot*(Date.parse(hrs[i].startTime)-windowStart)/3600000; }
  function Y(t){ return curveTop+(baseY-curveTop)*(1-(t-tMin)/rng); }

  // Actual model bounds at exact UTC samples; split at missing/nonconsecutive hours.
  var nbmBand="", nbmSegment=[];
  function flushNbm(){
    if(nbmSegment.length>1){
      var upper=nbmSegment.map(function(i){return X(i).toFixed(2)+","+Y(nbmPoints[i].p75).toFixed(2);});
      var lower=nbmSegment.slice().reverse().map(function(i){return X(i).toFixed(2)+","+Y(nbmPoints[i].p25).toFixed(2);});
      nbmBand+='<path class="nbm-hourly-band" d="M'+upper.join(' L')+' L'+lower.join(' L')+' Z"/>';
    }
    nbmSegment=[];
  }
  nbmPoints.forEach(function(p,i){if(!p||!contiguous(i))flushNbm();if(p)nbmSegment.push(i);});flushNbm();

  // day/night shading bands (runs of !isDaytime)
  var bands="";
  var runStart=null;
  for(i=0;i<=n;i++){
    var night=(i<n)&&!hrs[i].isDaytime;
    if(runStart!=null&&i<n&&!contiguous(i)){
      bands+='<rect x="'+Math.max(0,X(runStart)-slot/2).toFixed(1)+'" y="0" width="'+(X(i-1)-X(runStart)+slot).toFixed(1)+'" height="'+(barBase+2)+'" fill="var(--h24night)"/>';
      runStart=null;
    }
    if(night&&runStart==null) runStart=i;
    if(!night&&runStart!=null){
      var x0=(runStart===0)?0:X(runStart)-slot/2, x1=(i===n)?W:X(i-1)+slot/2;
      bands+='<rect class="h24-night" x="'+x0.toFixed(1)+'" y="0" width="'+(x1-x0).toFixed(1)+'" height="'+(barBase+2)+'" fill="var(--h24night)"/>';
      runStart=null;
    }
  }

  // per-hour temperature gradient
  var grad="";
  for(i=0;i<n;i++){ grad+='<stop offset="'+((X(i)-padL)/innerW*100).toFixed(1)+'%" stop-color="'+tCol(temps[i])+'"/>'; }

  // Curve segments stop at missing hours. The x-axis always represents elapsed time.
  function curve(values,fill){
    var out="", a=0;
    while(a<n){
      var b=a;
      while(b+1<n&&contiguous(b+1)) b++;
      var pts=[];
      for(var j=a;j<=b;j++) pts.push([X(j),Y(values[j])]);
      out+="M "+pts[0][0].toFixed(1)+" "+pts[0][1].toFixed(1);
      for(var j=0;j<pts.length-1;j++){
        var p0=pts[Math.max(0,j-1)],p1=pts[j],p2=pts[j+1],p3=pts[Math.min(pts.length-1,j+2)];
        out+=" C "+(p1[0]+(p2[0]-p0[0])/6).toFixed(1)+" "+(p1[1]+(p2[1]-p0[1])/6).toFixed(1)
          +" "+(p2[0]-(p3[0]-p1[0])/6).toFixed(1)+" "+(p2[1]-(p3[1]-p1[1])/6).toFixed(1)
          +" "+p2[0].toFixed(1)+" "+p2[1].toFixed(1);
      }
      if(fill) out+=" L "+X(b).toFixed(1)+" "+baseY+" L "+X(a).toFixed(1)+" "+baseY+" Z ";
      a=b+1;
    }
    return out;
  }
  var line=curve(temps,false), area=curve(temps,true), feelsPath="";
  if(showFeels) feelsPath='<path class="h24-feels" d="'+curve(feels.map(function(v,j){return v!=null?v:temps[j];}),false)+'" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 5" opacity=".65"/>';

  // precip bars + labels
  var bars="";
  for(i=0;i<n;i++){
    if(pops[i]==null||pops[i]<=0) continue;
    var bh=Math.max(3,barMax*pops[i]/100), bw=Math.min(18,slot*0.5), bx=X(i)-bw/2;
    bars+='<rect class="h24-bar" x="'+bx.toFixed(1)+'" y="'+(barBase-bh).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="3" fill="var(--accent)" opacity=".38"/>';
    if(pops[i]>=15&&i%step===0) bars+='<text class="h24-poplbl" x="'+X(i).toFixed(1)+'" y="'+(barBase-bh-4).toFixed(1)+'" text-anchor="middle" fill="var(--accent)">'+pops[i]+'%</text>';
  }

  // icons, temp labels, time labels (density-stepped)
  var icons="", tlabels="", times="", dates="", lastDate="";
  for(i=0;i<n;i++){
    var wall=nwsWallTime(hrs[i].startTime), dateKey=wall?wall.key:"";
    if(dateKey&&dateKey!==lastDate){
      var dayEnd=i+1;
      while(dayEnd<n&&nwsWallTime(hrs[dayEnd].startTime)&&nwsWallTime(hrs[dayEnd].startTime).key===dateKey) dayEnd++;
      var dx=(X(i)+X(dayEnd-1))/2;
      var dateLabel=new Date(hrs[i].startTime).toLocaleDateString("en-US",{timeZone:"America/Chicago",weekday:"short"});
      if((dayEnd-i)*slot>=45) dateLabel+=" "+wall.day;
      dates+='<text x="'+dx.toFixed(1)+'" y="13" text-anchor="middle" font-size="11" font-weight="700" fill="var(--muted)">'
        +esc(dateLabel)+'</text>';
      if(i>0) dates+='<line x1="'+X(i).toFixed(1)+'" x2="'+X(i).toFixed(1)+'" y1="21" y2="'+barBase+'" stroke="var(--border)" stroke-dasharray="3 4"/>';
      lastDate=dateKey;
    }
    if(i%step!==0 && i!==0) continue;
    var hx=X(i), hh=hrs[i], d=new Date(hh.startTime);
    icons+='<image class="h24-ic" href="'+ICON_BASE+wxName(hh.shortForecast,hh.isDaytime)+'.svg" x="'+(hx-iconPx/2).toFixed(1)+'" y="'+iconY+'" width="'+iconPx+'" height="'+iconPx+'"/>';
    tlabels+='<text '+tvAttr(temps[i],"h24-tl")+' x="'+hx.toFixed(1)+'" y="'+(Y(temps[i])-9).toFixed(1)+'" text-anchor="middle">'+temps[i]+'°</text>';
    var lbl=d.toLocaleTimeString("en-US", {timeZone:"America/Chicago",hour:"numeric"}).replace(" ","").toLowerCase();
    times+='<text class="h24-time'+(Date.parse(hrs[i].startTime)===windowStart?" is-now":"")+'" x="'+hx.toFixed(1)+'" y="'+timeY+'" text-anchor="middle">'+lbl+'</text>';
  }

  // now marker
  var nowX=X(0), nowY=Y(temps[0]);
  var nowMark='<line class="h24-nowline" x1="'+nowX+'" y1="'+(curveTop-14)+'" x2="'+nowX+'" y2="'+(barBase+2)+'" stroke="var(--accent)" stroke-dasharray="3 4" stroke-width="1" opacity=".55"/>'
    +'<circle class="h24-nowdot" cx="'+nowX+'" cy="'+nowY.toFixed(1)+'" r="4.5" fill="'+tCol(temps[0])+'" stroke="var(--bg)" stroke-width="2"/>';

  if(Date.parse(hrs[0].startTime)!==windowStart) nowMark="";

  // hover tracker (moved by JS)
  var tracker='<line class="h24-track" x1="-99" y1="'+(curveTop-14)+'" x2="-99" y2="'+(barBase+2)+'" stroke="var(--accent)" stroke-width="1" opacity="0"/>'
    +'<circle class="h24-trackdot" cx="-99" cy="-99" r="4" fill="var(--accent)" opacity="0"/>';

  var svg='<svg class="h24-svg" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="'+hourlyHours+' hour NWS forecast: temperature curve, precipitation chance bars and shaded nights. '+(nbmBand?'Shaded NBM model range: the middle 50% of modeled outcomes, from native NBM P25–P75. ':'')+'Hourly details follow the chart.">'
    +'<defs><linearGradient id="h24g" x1="0" y1="0" x2="1" y2="0">'+grad+'</linearGradient>'
    +'<linearGradient id="h24a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+tCol(hi)+'" stop-opacity=".16"/><stop offset="1" stop-color="'+tCol(lo)+'" stop-opacity="0"/></linearGradient></defs>'
    +bands
    +'<line x1="0" y1="'+barBase+'" x2="'+W+'" y2="'+barBase+'" stroke="var(--border)" stroke-width="1"/>'
    +(nbmBand||'<path d="'+area+'" fill="url(#h24a)"/>')
    +feelsPath
    +'<path class="h24-line" d="'+line+'" fill="none" stroke="url(#h24g)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
    +bars+icons+tlabels+times+dates+nowMark+tracker
    +'</svg>';

  var coverage=n<hourlyHours?'Only '+n+' forecast hours are available in this window; gaps have no forecast data. ':'';
  el.innerHTML=sum+'<div class="h24-wrap" data-hours="'+hourlyHours+'">'+svg+'<div class="h24-tip" id="h24tip"></div></div>'
    +'<input class="h24-cursor" id="hourlyCursor" type="range" min="0" max="'+(n-1)+'" value="0" step="1" aria-label="Forecast hour">'
    +'<div class="h24-detail" id="hourlyDetail" role="status" aria-live="polite"></div>'
    +'<div class="h24-note">'+coverage+'Move across the chart or use the slider for hourly detail. NWS point forecast; gusts from the NWS forecast grid.</div>';
  syncHourlyControls();

  // ---- hover / touch readout ----
  var wrap=el.querySelector(".h24-wrap"), tip=el.querySelector(".h24-tip");
  var trk=el.querySelector(".h24-track"), tdot=el.querySelector(".h24-trackdot");
  var cursor=el.querySelector(".h24-cursor"), detail=el.querySelector(".h24-detail");
  function describeHour(idx){
    var h=hrs[idx], gust=gridGustAt(forecastGrid.gusts,Date.parse(h.startTime)), wind=((h.windDirection||"")+" "+(h.windSpeed||"")).trim();
    return '<b>'+esc(forecastClock(Date.parse(h.startTime)))+'</b><span><b '+tvAttr(temps[idx])+'>'+temps[idx]+'°</b>'
      +(feels[idx]!=null?' \u00b7 feels '+feels[idx]+'°':'')+'</span>'
      +'<span>'+(pops[idx]==null?'Rain chance unavailable':'Rain '+pops[idx]+'%')+'</span>'
      +'<span>Wind '+esc(wind||"unavailable")+'</span>'
      +'<span>Gusts '+(gust==null?'unavailable':Math.round(gust)+' mph')+'</span>'
      +'<span class="muted">'+esc(h.shortForecast||"")+'</span>'
      +(nbmPoints.length?NbmHourly.describe(nbmPoints[idx]):'');
  }
  function selectHour(idx){
    renderHourly24._cursor=idx; renderHourly24._selectedTime=Date.parse(hrs[idx].startTime); cursor.value=idx;
    cursor.setAttribute("aria-valuetext",forecastClock(Date.parse(hrs[idx].startTime)));
    detail.innerHTML=describeHour(idx);
  }
  cursor.addEventListener("input",function(){ selectHour(Number(cursor.value)); });
  var selected=renderHourly24._selectedTime, chosen=Math.min(n-1,renderHourly24._cursor||0);
  if(selected!=null){
    chosen=0;
    for(i=0;i<n;i++){ if(Date.parse(hrs[i].startTime)<=selected) chosen=i; else break; }
  }
  selectHour(chosen);
  if(restoreFocus) cursor.focus({preventScroll:true});
  function showAt(clientX){
    var r=wrap.getBoundingClientRect(); if(!r.width) return;
    var sx=(clientX-r.left)*(W/r.width);
    var idx=0, closest=Infinity;
    for(var j=0;j<n;j++){ var distance=Math.abs(X(j)-sx); if(distance<closest){closest=distance;idx=j;} }
    var hx=X(idx), hy=Y(temps[idx]);
    trk.setAttribute("x1",hx);trk.setAttribute("x2",hx);trk.setAttribute("opacity",".45");
    tdot.setAttribute("cx",hx);tdot.setAttribute("cy",hy.toFixed(1));tdot.setAttribute("opacity","1");
    selectHour(idx);
    var when=forecastClock(Date.parse(hrs[idx].startTime));
    tip.innerHTML='<b>'+esc(when)+'</b> · <b '+tvAttr(temps[idx])+'>'+temps[idx]+'°</b>'
      +((feels[idx]!=null&&Math.abs(feels[idx]-temps[idx])>=2)?' · <span '+tvAttr(feels[idx])+'>feels '+feels[idx]+'°</span>':'')
      +(pops[idx]==null?' · rain chance unavailable':(pops[idx]>0?' · <span style="color:var(--accent)">'+ic("drop")+pops[idx]+'%</span>':''))
      +' · '+esc(hrs[idx].shortForecast||"");
    tip.style.display="block";
    var px=(hx/W)*r.width, tw=tip.offsetWidth;
    tip.style.left=Math.max(4,Math.min(r.width-tw-4,px-tw/2))+"px";
  }
  function hideTip(){ tip.style.display="none"; trk.setAttribute("opacity","0"); tdot.setAttribute("opacity","0"); }
  wrap.addEventListener("mousemove",function(e){ showAt(e.clientX); });
  wrap.addEventListener("mouseleave",hideTip);
  wrap.addEventListener("touchmove",function(e){ if(e.touches[0]) showAt(e.touches[0].clientX); },{passive:true});
  wrap.addEventListener("touchstart",function(e){ if(e.touches[0]) showAt(e.touches[0].clientX); },{passive:true});
  wrap.addEventListener("click",function(e){ showAt(e.clientX); });
  wrap.addEventListener("touchend",hideTip);

  // ---- re-render on resize so the chart always fills the card ----
  if(!renderHourly24._rsz){
    renderHourly24._rsz=true;
    var rt=null;
    window.addEventListener("resize",function(){ clearTimeout(rt); rt=setTimeout(function(){ renderHourly24(); },150); });
  }
}
function clearHourlyForecast(){
  var focus=document.activeElement&&document.activeElement.id==="hourlyCursor";
  renderHourly24._hrs=null;
  if(typeof NbmHourly!=="undefined"){NbmHourly.forecast(null);NbmHourly.presentation([],hourlyHours,Date.now());}
  var el=document.getElementById("hourly24");if(el) el.innerHTML='<div class="empty">Hourly forecast unavailable.</div>';
  syncHourlyControls();
  if(focus){var title=document.getElementById("h24Title");if(title){title.tabIndex=-1;title.focus({preventScroll:true});}}
}
/* imgFail() and bust() lived here. Both existed for the NESDIS sector JPEG — the one <img> feed on
   the page — and went with it: tile layers report failure per tile, and the satellite endpoint
   answers `no-store`, so there is nothing left to hand-bust. */
/* The sprite name to draw when the Meteocons CDN is unreachable. Coarser than wxName() on purpose:
   this is the degraded path, so it trades sleet-vs-snow precision for glyphs that stay legible at
   the 18-24px the failed <img> had reserved. */
function wxFallback(text,day){
  if(day===undefined)day=true;
  var t=(text||"").toLowerCase();
  if(t.indexOf("tornado")>=0)return "tornado";
  if(t.indexOf("thunder")>=0)return "storm";
  if(t.indexOf("snow")>=0||t.indexOf("flurr")>=0||t.indexOf("wintry")>=0||t.indexOf("sleet")>=0||t.indexOf("ice")>=0)return "snow";
  if(t.indexOf("freezing")>=0)return "snow";
  if(t.indexOf("rain")>=0||t.indexOf("shower")>=0||t.indexOf("drizzle")>=0)return "rain";
  if(t.indexOf("fog")>=0||t.indexOf("haze")>=0||t.indexOf("smoke")>=0)return "fog";
  if(t.indexOf("wind")>=0)return "wind";
  if(t.indexOf("partly")>=0||t.indexOf("mostly sunny")>=0||t.indexOf("mostly clear")>=0)return day?"sun":"moon";
  if(t.indexOf("cloudy")>=0||t.indexOf("overcast")>=0)return "cloud";
  if(t.indexOf("sunny")>=0||t.indexOf("clear")>=0||t.indexOf("fair")>=0)return day?"sun":"moon";
  if(t.indexOf("hot")>=0)return "heat";
  return day?"sun":"moon";
}

/* ===== "Does this alert actually cover me?" =====
   Two cases, because NWS issues alerts two ways:
     · storm-based warnings (tornado, severe tstorm, flash flood) carry a POLYGON — ray-cast the
       saved location against it, holes included. A warning polygon often covers a diagonal
       slice of three counties, so "St. Charles" in the area list doesn't mean your part of it.
     · watches/advisories are ZONE-based with geometry:null — but they list affectedZones as
       zone URLs, and /points hands us the same URLs for our location, so that's an exact match
       with no extra geometry to fetch. */
function ptInRing(x,y,ring){
  var inside=false;
  for(var i=0,j=ring.length-1;i<ring.length;j=i++){
    var xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function ptInPolygon(x,y,rings){
  if(!rings||!rings.length||!ptInRing(x,y,rings[0])) return false;
  for(var i=1;i<rings.length;i++){ if(ptInRing(x,y,rings[i])) return false; }   // inside a hole
  return true;
}
function ptInGeometry(lon,lat,geom){
  if(!geom||!geom.coordinates) return false;
  if(geom.type==="Polygon") return ptInPolygon(lon,lat,geom.coordinates);
  if(geom.type==="MultiPolygon"){
    for(var i=0;i<geom.coordinates.length;i++){ if(ptInPolygon(lon,lat,geom.coordinates[i])) return true; }
  }
  return false;
}
var userZones={county:"",forecast:"",fire:""};
function ensureUserZones(){
  var fresh=locGuard();
  return pointsFor(current.lat,current.lon).then(function(pt){
    if(!fresh()) return userZones;
    var pr=pt.properties||{};
    userZones={county:pr.county||"", forecast:pr.forecastZone||"", fire:pr.fireWeatherZone||""};
    return userZones;
  }).catch(function(){
    if(!fresh()) return userZones;
    userZones={county:"",forecast:"",fire:""};   // this round: no zones → simply no badge, never a wrong one
    return userZones;
  });
}
/* Returns WHICH kind of match it was, so the badge can state exactly what the evidence supports.
   NWS issues watches/advisories against forecast zones (MOZ###), not counties (MOC###) — claiming
   "your county is included" off a forecast-zone match would be a subtly false statement. */
function alertCoversMe(f){
  var p=f.properties||{};
  if(f.geometry) return ptInGeometry(current.lon,current.lat,f.geometry)?"polygon":false;
  var az=p.affectedZones||[];
  if(!az.length) return false;
  if(userZones.county  &&az.indexOf(userZones.county)>=0)   return "county";
  if(userZones.forecast&&az.indexOf(userZones.forecast)>=0) return "zone";
  if(userZones.fire    &&az.indexOf(userZones.fire)>=0)     return "fire";
  return false;
}

var HIT_TEXT={polygon:"You're inside this area", county:"Your county is included",
              zone:"Your forecast zone is included", fire:"Your fire zone is included"};
/* Whether /points resolved this location's zones — the difference between a page that can say
   "this one is over you" and one that must not pretend to. Every coverage decision keys off it,
   so it is a function rather than a boolean recomputed at each call site. */
function zonesResolved(){ return !!(userZones.county||userZones.forecast||userZones.fire); }

/* A tornado gets its own mark — the family icon (a storm cloud) undersells the one event that
   matters most, and flash flood is a different picture from river flooding. */
function alertIcon(ev,famIco){
  var e=(ev||"").toLowerCase();
  if(e.indexOf("tornado")>=0) return "tornado";
  if(e.indexOf("flash flood")>=0) return "flood";
  return famIco;
}
/* NWS descriptions are structured as "* WHAT...x  * WHERE...y  * WHEN...z  * IMPACTS...w".
   Parsing that into labelled rows turns a wall of caps into something readable at a glance. */
function parseAlertBullets(desc){
  var out=[], txt=String(desc||"").replace(/\r/g,""), m;
  var re=/\*\s*([A-Z][A-Z \-\/]{1,24}?)\s*\.\.\.\s*([\s\S]*?)(?=\n\s*\*\s*[A-Z]|$)/g;
  while((m=re.exec(txt))){
    var k=m[1].trim().toLowerCase(), v=m[2].replace(/\s*\n\s*/g," ").trim();
    if(v) out.push({k:k.charAt(0).toUpperCase()+k.slice(1), v:v});
  }
  return out;
}

/* The banner's one-line subline. A sentence boundary, not a character count: a clamp cuts
   mid-clause ("check up on relatives and neigh…"), and NWS instructions front-load the action,
   so the first sentence is the one worth a banner. */
function firstSentence(t){
  t=String(t||"").replace(/\s+/g," ").trim();
  var m=t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return m?m[0]:t;
}
/* The two ways a parsed alert body gets drawn. They exist as functions because the card now renders
   bullets in two places — the always-visible lede and the details drawer — and a second copy of the
   markup is how the two would quietly drift apart. */
function alertKV(bullets){
  return '<div class="a2-kv">'+bullets.map(function(b){
    return '<span class="k">'+esc(b.k)+'</span><span class="v">'+esc(b.v)+'</span>';
  }).join("")+'</div>';
}
function alertDo(instruction){
  return '<div class="a2-do"><b>What to do</b>'+alertParas(instruction).map(function(p){
    return '<p>'+esc(p)+'</p>';}).join("")+'</div>';
}
var AREA_CHIPS=6;   // county chips shown before the "+N more" expander
function degToCompass(d){
  if(d==null)return "";
  var dirs=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(d/22.5)%16];
}
/* Keep the ARIA state in lockstep with the visual state. A screen reader cannot perceive the .open
   class, so a toggle that only flips CSS silently misreports whether the row is expanded.
   `item` carries the class; `ctl` is the thing focus lands on (for alert cards they're the same
   element, since the card itself has role="button"). */
function setOpen(item,ctl,on){
  if(!item) return;
  item.classList.toggle("open",!!on);
  if(ctl) ctl.setAttribute("aria-expanded",on?"true":"false");
}
function toggleOpen(item,ctl){ setOpen(item,ctl,!item.classList.contains("open")); }
function timeAgo(ts){
  if(!ts)return "—";
  var m=Math.round((Date.now()-new Date(ts))/60000);
  if(m<1)return "just now";
  if(m<60)return m+" min ago";
  return Math.round(m/60)+" hr ago";
}

/* ============ MAP LOCKS (Fix 1) ============ */
function bindMapLock(w){
  if(w.dataset.lockBound) return;
  w.dataset.lockBound="1";
  var lock=w.querySelector(".maplock");
  var toggle=document.createElement("button");
  toggle.className="maplock-toggle";toggle.type="button";toggle.innerHTML=ic("lock")+"Lock";
  w.appendChild(toggle);
  lock.addEventListener("click",function(){w.classList.add("unlocked");});
  toggle.addEventListener("click",function(e){e.stopPropagation();w.classList.remove("unlocked");});
}
function initMapLocks(){
  document.querySelectorAll(".maplock-wrap").forEach(bindMapLock);
  var relock;
  window.addEventListener("scroll",function(){
    clearTimeout(relock);
    relock=setTimeout(function(){
      document.querySelectorAll(".maplock-wrap.unlocked").forEach(function(w){w.classList.remove("unlocked");});
    },400);
  },{passive:true});
}

function fitDayDates(){
  var daily=document.getElementById("daily");
  if(!daily) return;
  if(_mObs) _mObs.disconnect();
  daily.classList.remove("no-dnd");
  var dns=daily.querySelectorAll(".dn"), cut=false;
  for(var i=0;i<dns.length;i++){ if(dns[i].scrollWidth>dns[i].clientWidth+2){ cut=true; break; } }
  daily.classList.toggle("no-dnd",cut);
  if(_mObs){ var m=document.querySelector(".masonry"); if(m) _mObs.observe(m,_mObsOpts); }
}


/* ============ CURRENT ============ */
/* ---- The two ways a metric tile can be empty ----
   A field the station left out of this observation and a field it is telling you nothing happened
   in rendered as the same "—", which is the whole of the complaint: one is a gap in the data and
   the other is the data.
   Gusts made it obvious. KSUS filed no gust in eleven of its last twelve observations, because a
   METAR only carries one when the peak run exceeds the steady wind by enough to be worth noting.
   A dash there drew a hole where the truth was "the wind is steady" — the reading people actually
   wanted. A real gap still gets a dash, but one that says whose gap it is; a screen reader was
   otherwise announcing these tiles as "Gusts, em dash".
   Neither case is a failed FETCH: that path is the .catch below, which says the station may be
   offline, and the scheduler re-runs loadCurrent on its own interval either way. */
function ccGap(what){
  return '<span class="cc-gap" title="'+esc(current.station)+' didn\'t report the '+esc(what)
    +' in this observation" aria-label="'+esc(what)+' not reported">—</span>';
}
function ccNone(label,why){
  return '<span class="cc-gap" title="'+esc(why)+'">'+esc(label)+'</span>';
}

function currentExposure(){
  return '<div class="cc-expo"><div class="cc-uv" id="ccUv"></div><div class="aqi-mini" id="aqiMini"></div></div>';
}
function exposureColor(color){
  var colors={"#3ecf8e":"green","#ffd23f":"yellow","#e0b93a":"uv-yellow","#ff9f2f":"orange",
    "#ff6a2f":"red-orange","#c13bff":"purple","#ff3b3b":"red"};
  return colors[color]?"var(--ex-"+colors[color]+")":color;
}
function renderCurrentUnavailable(message){
  heroNow.temp=null;
  document.body.removeAttribute("data-wx");
  document.getElementById("current").innerHTML='<div class="empty" role="status"><b>Current observation unavailable.</b> '+message+'</div>'
    +currentExposure()+'<div class="stn">UV &amp; air Open-Meteo · <a href="https://gispub.epa.gov/airnow/" target="_blank" rel="noopener">AirNow ↗</a></div>';
  renderUvNow(); renderAqiMini();
}


function currentObservation(){
  var station=current.station, lat=current.lat, lon=current.lon, signal=locSignal();
  function read(id){ return getJSON(API+"/stations/"+id+"/observations/latest",HEADERS,signal); }
  return read(station).catch(function(){ return null; }).then(function(primary){
    if(currentObservationFresh(primary,Date.now())) return {station:station,observation:primary};
    // Check three verified-nearby reports before giving up; a distant fresh report is not "now" here.
    return observationStationsFor(lat,lon,35).then(function(ids){
      return Promise.all(ids.filter(function(id){ return id!==station; }).slice(0,3).map(function(id){
        return read(id).then(function(o){ return {station:id,observation:o}; })
          .catch(function(){ return null; });
      }));
    }).then(function(alternates){
      for(var i=0;i<alternates.length;i++){
        if(alternates[i]&&currentObservationFresh(alternates[i].observation,Date.now())) return alternates[i];
      }
      return {station:station,observation:null,lastTimestamp:primary&&primary.properties&&primary.properties.timestamp};
    }).catch(function(){
      return {station:station,observation:null,lastTimestamp:primary&&primary.properties&&primary.properties.timestamp};
    });
  });
}

/* ---- Repainting the list without throwing away the reader's place in it ----
   The section rebuilds every 60s, and innerHTML destroys every node in it. openIds already carries
   which drawers were open across that; two things were still being lost with the nodes.

   FOCUS. A reader tabbed onto a banner head — the section's leading control — had focus dropped to
   <body> mid-interaction, silently, at a moment they didn't act at and get no notice of. Worse for
   the one who opened a drawer and is reading it: the next Tab starts over at the top of the
   document. So the control focus was on is recorded before the rebuild and re-found after it.

   THE REBUILD ITSELF. NWS alerts rarely change between polls, so most minutes the markup we just
   built is byte-for-byte what is already on screen. Skipping an identical repaint keeps every node
   alive — no lost focus to restore at all. Two things make the comparison hold. Nothing
   time-varying is left in the markup: the countdown text and the time bar's fill are both written
   in afterwards by tickCountdowns, so an unchanged alert builds an unchanged string. And the
   comparison is against the last string we BUILT, not against el.innerHTML — tickCountdowns writes
   into the DOM the instant after we paint, so what is on the page stops matching what we wrote
   within milliseconds.

   The skip doesn't make the focus restore redundant. An alert genuinely revised mid-window still
   rebuilds the section, and that is exactly the minute someone is most likely to be reading it. */
var alertsHTML=null;
/* Every focusable control the section renders. The drawer's weather.gov link is in here for the
   same reason as the buttons: it's a tab stop inside #alerts, so it's somewhere focus can be when
   the timer fires. Drawer controls imply an open drawer (.alert-more is display:none otherwise),
   and openIds rebuilds it open, so they're findable again after the rebuild. */
var AB_FOCUS=[".ab-head",".a2-radar",".a2-more",".a2-foot .link"];
function alertFocusKey(el){
  var a=document.activeElement;
  // Focus outside the section is none of this function's business: "restoring" it would yank the
  // caret out of the location search or off a link halfway down the page, every 60 seconds.
  if(!a||!el.contains(a)) return null;
  for(var i=0;i<AB_FOCUS.length;i++){
    var c=a.closest(AB_FOCUS[i]);
    if(!c) continue;
    /* Keyed by event name AND scope, the same pair openIds uses and for the same reason: the local
       card and the elsewhere card can carry one event name, so the name alone would sometimes hand
       focus to the other one — a jump from the alert over your roof to one two counties away. */
    var card=c.closest(".alert");
    return {sel:AB_FOCUS[i], aid:card?card.getAttribute("data-aid"):null,
            scope:card?(card.getAttribute("data-scope")||""):""};
  }
  return null;
}
function restoreAlertFocus(el,k){
  if(!k) return;
  // Replacing the focused node leaves focus on <body>. Anything else means something claimed it
  // between then and now, and it has a better claim than a 60-second timer does.
  var a=document.activeElement;
  if(a&&a!==document.body&&a!==document.documentElement) return;
  var scope=el;
  if(k.aid){
    var cards=el.querySelectorAll(".alert"), card=null;
    for(var i=0;i<cards.length;i++){
      if(cards[i].getAttribute("data-aid")===k.aid&&(cards[i].getAttribute("data-scope")||"")===k.scope){ card=cards[i]; break; }
    }
    if(!card) return;   // the alert expired between polls — there is no equivalent control to move to
    scope=card;
  }
  var c=scope.querySelector(k.sel);
  // preventScroll: focus is going back exactly where the reader already had it, so it is already
  // where they are looking. Scrolling to it could only move the page out from under them.
  if(c) c.focus({preventScroll:true});
}
/* The one way anything paints #alerts — list, calm line and error all route through here, so all
   three get the comparison and the focus handling rather than just the one that renders alerts. */
function paintAlerts(el,html){
  if(html===alertsHTML) return;   // nothing changed: leave the DOM, and the reader's place in it, alone
  var k=alertFocusKey(el);        // read BEFORE innerHTML destroys the element it points at
  alertsHTML=html;
  el.innerHTML=html;
  restoreAlertFocus(el,k);
}

/* ============ RIVERS ============ */
var RIVER_PINS_KEY="lsxRiverPins_v1", riverRows={}, riverPins=[];
try{ var savedPins=JSON.parse(localStorage.getItem(RIVER_PINS_KEY)||"[]");if(Array.isArray(savedPins)) riverPins=savedPins.filter(function(id){return RIVERS.some(function(r){return r.id===id;});}); }catch(e){}
function renderRiverRows(){
  var el=document.getElementById("rivers"); if(!el) return;
  var focus=document.activeElement&&document.activeElement.getAttribute("data-pin-gauge"), html="";
  var pinned=RIVERS.filter(function(r){return riverPins.indexOf(r.id)>=0;}), regional=RIVERS.filter(function(r){return riverPins.indexOf(r.id)<0;});
  function rows(list){return list.map(function(r){
    var on=riverPins.indexOf(r.id)>=0;
    return '<div class="river-row" data-gauge="'+r.id+'">'+(riverRows[r.id]||riverLinkOnly(r))
      +'<button type="button" class="river-pin" data-pin-gauge="'+r.id+'" aria-pressed="'+on+'" aria-label="'+(on?'Unpin ':'Pin ')+esc(r.name)+'">'+(on?'Pinned':'Pin')+'</button></div>';
  }).join('');}
  if(pinned.length) html+='<h3 class="river-group">Pinned gauges</h3>'+rows(pinned)+'<h3 class="river-group">Other regional gauges</h3>';
  el.innerHTML=html+rows(regional);
  if(focus){var button=el.querySelector('[data-pin-gauge="'+focus+'"]');if(button) button.focus({preventScroll:true});}
}
document.getElementById("rivers").addEventListener("click",function(e){
  var button=e.target.closest("[data-pin-gauge]");if(!button) return;
  var id=button.getAttribute("data-pin-gauge"), index=riverPins.indexOf(id);
  if(index<0) riverPins.push(id);else riverPins.splice(index,1);
  try{ localStorage.setItem(RIVER_PINS_KEY,JSON.stringify(riverPins)); }catch(err){}
  renderRiverRows();
});
function catInfo(cat){
  var c=(cat||"").toLowerCase();
  if(c.indexOf("major")>=0)return {cls:"c-major",label:"Major Flood"};
  if(c.indexOf("moderate")>=0)return {cls:"c-moderate",label:"Moderate Flood"};
  if(c.indexOf("minor")>=0)return {cls:"c-minor",label:"Minor Flood"};
  if(c.indexOf("action")>=0)return {cls:"c-action",label:"Action Stage"};
  return {cls:"c-none",label:"No Flooding"};
}
/* ===== Crest forecasts (NWPS /stageflow/forecast) =====
   The gauge payload carries a single forecast point, which is not a crest. The stageflow endpoint
   returns the whole series (5–14 days depending on the gauge), so we can say what the river is
   actually going to DO. The honest distinction that matters: a true crest rises and then falls
   inside the window, whereas a river still climbing when the window ends has NOT crested —
   calling that a crest would promise a peak the model never forecast. */
function stageCategory(stage,cats){
  if(stage==null||!cats) return null;
  var order=[["major","major flood"],["moderate","moderate flood"],["minor","minor flood"],["action","action stage"]];
  for(var i=0;i<order.length;i++){
    var c=cats[order[i][0]];
    if(c&&typeof c.stage==="number"&&c.stage>0&&stage>=c.stage) return {key:order[i][0], label:order[i][1]};
  }
  return null;
}
function crestWhen(iso){
  var d=new Date(iso), days=(d.getTime()-Date.now())/86400000;
  // Beyond ~5 days a bare weekday is ambiguous (today is Saturday; so is next Saturday) and an
  // hour is false precision on long-range guidance — give the date instead.
  return (days>5)
    ? d.toLocaleDateString("en-US", {timeZone:WEATHER_TZ,weekday:"short",month:"short",day:"numeric"})
    : d.toLocaleString("en-US", {timeZone:WEATHER_TZ,weekday:"short",hour:"numeric"});
}
function crestInfo(fcJson,now){
  if(!fcJson) return null;
  // Series are issued hours before we read them, so drop points that have already elapsed —
  // otherwise a peak from earlier this morning gets announced as an upcoming crest.
  var cutoff=Date.now()-30*60000;
  var pts=(fcJson.data||[]).filter(function(p){
    return p&&typeof p.primary==="number"&&p.primary>-500&&p.validTime   // -9999 is the NWPS sentinel
      && new Date(p.validTime).getTime()>cutoff;
  });
  if(pts.length<2) return null;
  var base=(typeof now==="number")?now:pts[0].primary;
  var maxI=0, i;
  for(i=1;i<pts.length;i++){ if(pts[i].primary>pts[maxI].primary) maxI=i; }
  var peak=pts[maxI], last=pts[pts.length-1];
  if(peak.primary>=base+0.5){
    // fell back by the end of the window → a real crest; still climbing → say so instead
    if(maxI<pts.length-1 && peak.primary>last.primary+0.05) return {kind:"crest", stage:peak.primary, when:peak.validTime};
    return {kind:"rising", stage:peak.primary, when:peak.validTime};
  }
  // Recession: quote a point within a week rather than the tail of 14-day long-range guidance
  var horizon=Date.now()+7*86400000, end=pts[0];
  for(i=0;i<pts.length;i++){ if(new Date(pts[i].validTime).getTime()<=horizon) end=pts[i]; }
  if(base-end.primary>=0.5) return {kind:"falling", stage:end.primary, when:end.validTime};
  return null;
}
function riverLinkOnly(r,note){
  return '<a class="rlink c-none" href="https://water.noaa.gov/gauges/'+r.id+'" target="_blank" rel="noopener">'
    +'<span class="rname"><span class="rn-top">'+ic("flood")+esc(r.name)+'</span>'+(note?'<span class="rsub">'+esc(note)+'</span>':'')+'</span><span class="rmeta"><span class="rval" style="color:var(--muted);font-size:13px">View ↗</span></span></a>';
}


/* ============ AQI ============ */
var aqiState={val:null, pm:null, err:false};
function renderAqiMini(){
  var el=document.getElementById("aqiMini"); if(!el) return;
  if(aqiState.val==null){
    // The AirNow link is in the .stn footline now, so the outage state can just say so.
    el.innerHTML=aqiState.err
      ?'<div class="k"><span class="ex-dot" style="background:var(--muted)"></span>Air Quality</div>'
        +'<div class="v" style="color:var(--muted)">—</div><div class="s">unavailable</div>'
      :"";
    return;
  }
  var i=aqiInfo(aqiState.val);
  el.innerHTML='<div class="k"><span class="ex-dot" style="background:'+i.c+'"></span>Air Quality</div>'
    +'<div class="v" style="color:'+exposureColor(i.c)+'">'+aqiState.val+' <span class="ex-cat">'+i.t+'</span></div>'
    +'<div class="s">'+(aqiState.pm!=null?'PM2.5 <b>'+aqiState.pm+'</b>':'')+'</div>';
}


/* ============ RISK OUTLOOK (SPC storm + WPC flood/winter, via NOAA ArcGIS) ============ */
var SPC_URL="https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/";
var ERO_URL="https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer/";
var FIRE_URL="https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/SPC_firewx/MapServer/";
var WSSI_URL="https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer/";
var MCD_URL="https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/";
/* Layer ids drift when NOAA republishes these services. Only a named, verified layer may
   establish a zero-risk result; fallback ids alone cannot certify an empty point query. */
var RISK_LAYERS={spc:[1,9,17], ero:[0,1,2], fireCat:[1,4], fireD3:{dry:7,wind:8}, wssi:[1,2], mcd:0, wwa:1};
var SPC_THREAT_LAYERS=[{},{}];
var RISK_READY={spc:false,threats:false,ero:false,fire:false,wssi:false};
/* SPC metadata is global, so callers and locations share one discovery flight. Only this
   request retries: two waits, at 2s and 5s, then a 60s cooldown before another caller may try.
   Point queries and product-issuance checks keep their existing unknown-risk semantics. */
var SPC_DISCOVERY_DELAYS=[2000,5000], SPC_DISCOVERY_COOLDOWN=60000;
var _spcDiscovery=null, _spcDiscoveryRetryAt=0, _spcDiscoveryError=null;
var _spcDisposed=false, _spcRestoreRisk=false;
function spcDiscoveryAbort(){
  var err=new Error("SPC discovery cancelled"); err.name="AbortError"; return err;
}
function spcDiscoveryRetryable(err){
  if(isAbort(err)) return false;
  var status=Number(err&&err.status)||0;
  return !status||status===408||status===429||status>=500;
}
function readSpcLayers(d){
  if(!d||d.error||!Array.isArray(d.layers)){
    var err=new Error("Invalid SPC layer metadata");
    if(d&&d.error) err.status=d.error.code;
    throw err;
  }
  var ids={}, threats=[{},{}];
  d.layers.forEach(function(l){
    var m=/^Day\s*([123])\s+Categorical/i.exec(l.name||""); if(m) ids[m[1]]=l.id;
    var t=/^Day\s*([12])\s+Probabilistic\s+(Tornado|Wind|Hail)\s+Outlook$/i.exec(l.name||"");
    if(t&&l.subLayerIds==null) threats[Number(t[1])-1][t[2].toLowerCase()]=l.id;
  });
  RISK_READY.spc=ids[1]!=null&&ids[2]!=null&&ids[3]!=null;
  if(RISK_READY.spc) RISK_LAYERS.spc=[ids[1],ids[2],ids[3]];
  SPC_THREAT_LAYERS=threats;
  RISK_READY.threats=threats.every(function(t){return t.tornado!=null&&t.wind!=null&&t.hail!=null;});
  if(!RISK_READY.spc||!RISK_READY.threats) throw new Error("SPC named layers unavailable");
}
function waitSpcDiscovery(run,delay){
  return new Promise(function(resolve,reject){
    function finish(err){
      if(run.timer!=null) clearTimeout(run.timer);
      run.timer=null; run.resume=null;
      run.controller.signal.removeEventListener("abort",abort);
      if(err) reject(err); else resolve();
    }
    function abort(){finish(spcDiscoveryAbort());}
    run.resume=function(){
      if(document.hidden||_spcDisposed||run.timer!=null) return;
      run.timer=setTimeout(function(){finish();},delay);
    };
    run.controller.signal.addEventListener("abort",abort,{once:true});
    if(run.controller.signal.aborted) abort(); else run.resume();
  });
}
function discoverSpcLayers(){
  if(_spcDisposed) return Promise.reject(spcDiscoveryAbort());
  if(_spcDiscovery) return _spcDiscovery.promise;
  if(RISK_READY.spc&&RISK_READY.threats) return Promise.resolve();
  if(Date.now()<_spcDiscoveryRetryAt) return Promise.reject(_spcDiscoveryError);
  var run={controller:new AbortController(),timer:null,resume:null};
  _spcDiscovery=run;
  function active(){return _spcDiscovery===run&&!_spcDisposed&&!run.controller.signal.aborted;}
  function attempt(n){
    if(!active()) return Promise.reject(spcDiscoveryAbort());
    return getJSON(SPC_URL+"?f=json",null,run.controller.signal).then(function(d){
      if(!active()) throw spcDiscoveryAbort();
      readSpcLayers(d);
    }).catch(function(err){
      if(!active()||!spcDiscoveryRetryable(err)||n>=SPC_DISCOVERY_DELAYS.length) throw err;
      return waitSpcDiscovery(run,SPC_DISCOVERY_DELAYS[n]).then(function(){return attempt(n+1);});
    });
  }
  run.promise=attempt(0).catch(function(err){
    if(active()&&!isAbort(err)){
      _spcDiscoveryError=err; _spcDiscoveryRetryAt=Date.now()+SPC_DISCOVERY_COOLDOWN;
    }
    throw err;
  }).finally(function(){
    if(run.timer!=null) clearTimeout(run.timer);
    if(_spcDiscovery===run) _spcDiscovery=null;
  });
  return run.promise;
}
function pauseSpcDiscovery(){
  if(_spcDiscovery&&_spcDiscovery.timer!=null){
    clearTimeout(_spcDiscovery.timer); _spcDiscovery.timer=null;
  }
}
function resumeSpcDiscovery(){
  if(!_spcDisposed&&_spcRestoreRisk) restoreSpcDiscovery();
  if(_spcDiscovery&&_spcDiscovery.resume) _spcDiscovery.resume();
}
function disposeSpcDiscovery(){
  _spcDisposed=true; _spcRestoreRisk=_spcRestoreRisk||!!(_spcDiscovery||_spcLoad);
  if(_spcDiscovery) _spcDiscovery.controller.abort();
  if(_spcLoad) _spcLoad.controller.abort();
  _spcDiscovery=null; _spcLoad=null; _riskLayersP=null;
}
function restoreSpcDiscovery(){
  _spcDisposed=false;
  if(_spcRestoreRisk&&!document.hidden){
    _spcRestoreRisk=false; stampSched(["risk"]); runFeed("risk");
  }
}
/* Memoised and awaitable: loadSpc waits for names before querying. A failed metadata lookup
   leaves that service unavailable. An exhausted SPC discovery may try again after cooldown. */
var _riskLayersP=null;
function resolveRiskLayers(){
  if(_riskLayersP) return _riskLayersP;
  function active(){return _riskLayersP===pending&&!_spcDisposed;}
  var pending=Promise.all([
  discoverSpcLayers().catch(function(){}),
  getJSON(ERO_URL+"?f=json").then(function(d){
    if(!active()) return;
    var ids={};
    (d.layers||[]).forEach(function(l){ var m=/^Excessive Rainfall Day\s*([123])/i.exec(l.name||""); if(m) ids[m[1]]=l.id; });
    if(ids[1]!=null&&ids[2]!=null&&ids[3]!=null){ RISK_LAYERS.ero=[ids[1],ids[2],ids[3]]; RISK_READY.ero=true; }
  }).catch(function(){}),
  getJSON(FIRE_URL+"?f=json").then(function(d){
    if(!active()) return;
    var cat={}, d3={};
    (d.layers||[]).forEach(function(l){
      var n=l.name||"";
      var m=/^Day\s*([12])\s+Outlook$/i.exec(n); if(m) cat[m[1]]=l.id;
      if(/^Day\s*3\s+Dry\s*Thunderstorm$/i.test(n)) d3.dry=l.id;
      if(/^Day\s*3\s+Winds and Low Humidity$/i.test(n)) d3.wind=l.id;
    });
    if(cat[1]!=null&&cat[2]!=null&&d3.dry!=null&&d3.wind!=null){
      RISK_LAYERS.fireCat=[cat[1],cat[2]]; RISK_LAYERS.fireD3=d3; RISK_READY.fire=true;
    }
  }).catch(function(){}),
  getJSON(WSSI_URL+"?f=json").then(function(d){
    if(!active()) return;
    var ids={};
    (d.layers||[]).forEach(function(l){ var m=/^Overall_Impact_Day_([12])$/i.exec(l.name||""); if(m) ids[m[1]]=l.id; });
    if(ids[1]!=null&&ids[2]!=null){ RISK_LAYERS.wssi=[ids[1],ids[2]]; RISK_READY.wssi=true; }
  }).catch(function(){}),
  getJSON(MCD_URL+"?f=json").then(function(d){
    if(!active()) return;
    (d.layers||[]).forEach(function(l){ if(/Mesoscale Discussion/i.test(l.name||"")) RISK_LAYERS.mcd=l.id; });
  }).catch(function(){}),
  getJSON(WWA_URL+"?f=json").then(function(d){
    if(!active()) return;
    (d.layers||[]).forEach(function(l){ if(/^WatchesWarnings$/i.test(l.name||"")) RISK_LAYERS.wwa=l.id; });
  }).catch(function(){})
  ]);
  _riskLayersP=pending;
  pending.then(function(){
    if(_riskLayersP===pending&&(!RISK_READY.spc||!RISK_READY.threats||!RISK_READY.ero||!RISK_READY.fire||!RISK_READY.wssi)) _riskLayersP=null;
  });
  return pending;
}
function fireRisk(dn){
  var m={
    10:{t:"Extreme",  lvl:3, bg:"#d1006c"},
    8: {t:"Critical", lvl:2, bg:"#ff5a1f"},
    5: {t:"Elevated", lvl:1, bg:"#ffb020"}
  };
  return m[dn]||(dn===0?{t:"No Fire Risk",lvl:0,bg:"",muted:true}:{t:"Unavailable",lvl:null,bg:"",muted:true});
}

function spcRisk(dn){
  var m={
    8:{t:"High Risk",     lvl:5, bg:"#ee88ee"},
    6:{t:"Moderate Risk", lvl:4, bg:"#e06666"},
    5:{t:"Enhanced Risk", lvl:3, bg:"#ffa366"},
    4:{t:"Slight Risk",   lvl:2, bg:"#ffd23f"},
    3:{t:"Marginal Risk", lvl:1, bg:"#7bbf7b"},
    2:{t:"General Storms",lvl:0, bg:"#a9dca9"}
  };
  return m[dn]||(dn===0?{t:"No Severe Risk",lvl:-1,bg:"",muted:true}:{t:"Unavailable",lvl:null,bg:"",muted:true});
}
function eroRisk(rank){
  var m={
    4:{t:"High Risk",     bg:"#e754c8"},
    3:{t:"Moderate Risk", bg:"#ff6a2f"},
    2:{t:"Slight Risk",   bg:"#ffd23f"},
    1:{t:"Marginal Risk", bg:"#66bb6a"}
  };
  if(rank==null||(!m[rank]&&rank!==0)) return {t:"Unavailable",lvl:null,bg:"",muted:true};
  var r=m[rank]||{t:"No Flood Risk",bg:"",muted:true};
  return {t:r.t,lvl:rank,bg:r.bg,muted:r.muted};
}

function riskPill(info,denom){
  var fg=info.muted?"var(--muted)":textOn(info.bg);
  var bg=info.muted?"var(--inset)":info.bg;
  var txt=info.t+(info.lvl>0?" \u00b7 "+info.lvl+"/"+denom:"");
  return '<span class="spc-pill" style="background:'+bg+';color:'+fg+'">'+txt+'</span>';
}


function renderSpcThreats(days){
  var el=document.getElementById("spcThreats"); if(!el) return;
  var kinds=["tornado","wind","hail"], html='<div class="spc-threat-title">Severe-weather probabilities</div>'
    +'<div class="spc-threat-row"><span></span><span class="rh">Tornado</span><span class="rh">Wind</span><span class="rh">Hail</span></div>', periods=[];
  [0,1].forEach(function(i){
    var day=days&&days[i];
    html+='<div class="spc-threat-row"><span class="spc-day">Day '+(i+1)+'</span>';
    kinds.forEach(function(kind,k){
      var prob=day?day.values[k]:null;
      html+='<span class="spc-threat-value '+(prob>0?'elevated':'quiet')+'">'+esc(spcThreatText(prob,kind))+'</span>';
    });
    html+='</div>';
    if(day) periods.push('<div class="spc-threat-period">Day '+(i+1)+': '+esc(forecastClock(day.period.start))
      +' \u2013 '+esc(forecastClock(day.period.end))+' \u00b7 issued '+esc(timeAgo(new Date(day.period.issue).toISOString()))+'</div>');
  });
  el.innerHTML=html+'<div class="spc-threat-note">Chance within <b>25 miles of this location</b> during each outlook period. '
    +'Wind: damaging storm winds or gusts of 58+ mph. Hail: 1\u2033 or larger. Below the lowest contour still allows a small risk.</div>'
    +periods.join("");
}

function mcdPill(d){
  var t=(d.concerning||"").replace(/\.\.\./g," · ").replace(/·\s*$/,"").trim();
  if(!t) t="Severe potential";
  if(d.prob!=null) t+=" · "+d.prob+"%";
  return t;
}
function mcdUntil(end){
  if(!end) return "";
  var d=new Date(end);
  var t=d.toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric",minute:"2-digit"});
  // an MD can run past local midnight; a bare "1:15 AM" would read as nineteen hours ago
  if(weatherParts(d).key!==weatherParts().key) t=d.toLocaleDateString("en-US", {timeZone:WEATHER_TZ,weekday:"short"})+" "+t;
  return "until "+t;
}
var lastMcds=[], mcdLayer=null;
/* Mirrors loadWarnPolygons' shape for the same reason it has one: the map may not exist yet when
   the first fetch lands (Leaflet is deferred), so initRadarMap redraws from this cache on its own. */
function drawMcdPolygons(){
  if(!rvMap) return;
  if(mcdLayer){ rvMap.removeLayer(mcdLayer); mcdLayer=null; }
  if(!lastMcds.length) return;
  try{
    mcdLayer=L.geoJSON({type:"FeatureCollection",features:lastMcds.map(function(m){
      return {type:"Feature",geometry:m.geom,properties:{num:m.num,pill:mcdPill(m.d)}};
    })},{
      // dashed on purpose: this outline is guidance about the next couple of hours, and it must
      // read as a different kind of thing from the solid polygons that are warnings
      style:{color:"#ffb020",weight:2,dashArray:"6 4",fillColor:"#ffb020",fillOpacity:.06},
      pane:"overlayPane",
      onEachFeature:function(f,layer){
        layer.bindTooltip(esc("Mesoscale Discussion #"+f.properties.num+" — "+f.properties.pill),
          {className:"stn-tip",direction:"top",sticky:true});
        layer.on("click",function(e){
          if(e.originalEvent) e.originalEvent.stopPropagation();
          var rc=document.getElementById("riskCard");
          if(rc){ try{ rc.scrollIntoView({behavior:"smooth",block:"center"}); }catch(err){ rc.scrollIntoView(); } }
        });
      }
    }).addTo(rvMap);
    mcdLayer.bringToBack();   // under the warnings: a watch-likely outline must never cover a warning
  }catch(e){ mcdLayer=null; }
}
function renderMcd(list){
  lastMcds=list||[];
  lastMcds.sort(function(a,b){ return (b.hits?1:0)-(a.hits?1:0) || b.num-a.num; });
  var el=document.getElementById("mcd");
  if(el) el.innerHTML=lastMcds.map(function(m){
    var d=m.d, until=mcdUntil(m.end);
    var scope=m.hits?HIT_TEXT.polygon:"Elsewhere in the St. Louis area";
    return '<div class="mcd '+(m.hits?'hits':'away')+'">'
      +'<div class="mcd-head">'+ic("storm")
      +'<span class="mcd-t">Mesoscale Discussion #'+m.num+'</span>'
      +(until?'<span class="mcd-when">'+esc(until)+'</span>':'')
      +'</div>'
      +'<span class="mcd-pill">'+esc(mcdPill(d))+'</span>'
      +(d.summary?'<div class="mcd-sum">'+esc(d.summary)+'</div>':'')
      +'<div class="mcd-foot"><span class="mcd-me"'+(d.areas?' title="'+esc(d.areas)+'"':'')+'>'+scope+'</span> · '
      +'<a class="link" href="https://www.spc.noaa.gov/products/md/md'+m.num+'.html" target="_blank" rel="noopener">Full discussion ↗</a></div>'
      +'</div>';
  }).join("");
  drawMcdPolygons();
}


/* ============ CPC WEEK-AHEAD LEANINGS ============ */
var CPC_610="https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_6_10_day_outlk/MapServer/";
var CPC_814="https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_8_14_day_outlk/MapServer/";


/* ============ CPC US HAZARDS OUTLOOK (days 3-14) ============ */
var HZ_URL="https://mapservices.weather.noaa.gov/vector/rest/services/hazards/cpc_weather_hazards/MapServer/";
/* U.S. Drought Monitor (NDMC/NOAA/USDA) — weekly, released Thursdays. DM field: 0=D0 … 4=D4 */
var USDM_URL="https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/USDM_current/FeatureServer/";
// CPC Monthly (layer 1) + Seasonal/3-month (layer 4) Drought Outlook — field "outlook", verified against the live service
var DROUGHT_OUTLK_URL="https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_drought_outlk/MapServer/";
function outlookCat(o){
  var m={
    "Development":{t:"Drought developing", bg:"#ffde63", fg:"#0b2a0b", ic:"alert"},
    "Persistence":{t:"Drought persisting",  bg:"#9b634a", fg:"#fff",     ic:"drought"},
    "Improvement":{t:"Improving (lingers)", bg:"#ded4bc", fg:"#0b2a0b", ic:"trend-down"},
    "Removal":    {t:"Drought easing",       bg:"#b2ad69", fg:"#0b2a0b", ic:"check"}
  };
  return m[o]||null;   // null = "No_Drought" / outside any outlook area = none expected
}
function droughtCat(dm){
  var m={
    4:{t:"D4 · Exceptional", bg:"#730000", fg:"#fff"},
    3:{t:"D3 · Extreme",     bg:"#e60000", fg:"#fff"},
    2:{t:"D2 · Severe",      bg:"#ffaa00", fg:"#0b2a0b"},
    1:{t:"D1 · Moderate",    bg:"#fcd37f", fg:"#0b2a0b"},
    0:{t:"D0 · Abnormally Dry", bg:"#ffff00", fg:"#0b2a0b"}
  };
  return m[dm]||null;   // null = no drought at this point
}

function hazIcon(t){
  t=(t||"").toLowerCase();
  if(t.indexOf("heat")>=0) return "heat";
  if(t.indexOf("cold")>=0||t.indexOf("freeze")>=0||t.indexOf("frost")>=0) return "cold";
  if(t.indexOf("snow")>=0||t.indexOf("winter")>=0||t.indexOf("ice")>=0||t.indexOf("freezing")>=0) return "snow";
  if(t.indexOf("flood")>=0) return "flood";
  if(t.indexOf("rain")>=0||t.indexOf("precip")>=0) return "rain";
  if(t.indexOf("wildfire")>=0||t.indexOf("fire")>=0) return "fire";
  if(t.indexOf("drought")>=0) return "drought";
  if(t.indexOf("wind")>=0) return "wind";
  if(t.indexOf("wave")>=0) return "flood";
  if(t.indexOf("thunder")>=0||t.indexOf("severe")>=0) return "storm";
  return "alert";
}
// CPC/WPC hazards return raw product codes like "Prcp_D3_7_Clip" — translate to plain English.
function hazLabel(raw){
  var s=String(raw||"").trim();
  if(!s) return "";
  // strip the day-range + geometry suffixes: _D3_7_Clip, _D8_14_Fill, _Outline, etc.
  var core=s.replace(/_D\d+_\d+.*$/i,"").replace(/_(clip|fill|outline|line|poly|area)$/i,"").replace(/_+$/,"").trim();
  var key=core.toLowerCase().replace(/[^a-z]/g,"");
  var MAP={
    prcp:"Heavy Precipitation", precip:"Heavy Precipitation", precipitation:"Heavy Precipitation",
    rain:"Heavy Rain", hvyrain:"Heavy Rain",
    flood:"Flooding Possible", flooding:"Flooding Possible", flooddg:"Flooding Possible",
    maxt:"Extreme Heat", heat:"Extreme Heat", heatindex:"Extreme Heat", exheat:"Extreme Heat",
    mint:"Extreme Cold", cold:"Extreme Cold", excold:"Extreme Cold", windchill:"Extreme Cold", freeze:"Hard Freeze", frost:"Frost/Freeze",
    snow:"Heavy Snow", heavysnow:"Heavy Snow", hvysnow:"Heavy Snow", blizzard:"Blizzard",
    winter:"Winter Weather", winterwx:"Winter Weather", ice:"Ice / Freezing Rain", freezingrain:"Ice / Freezing Rain", frzrain:"Ice / Freezing Rain",
    wind:"High Wind", highwind:"High Wind", hiwind:"High Wind",
    fire:"Fire Weather", firewx:"Fire Weather", wildfire:"Fire Weather",
    drought:"Drought", drght:"Drought",
    svr:"Severe Storms", severe:"Severe Storms", thunder:"Severe Storms", tstm:"Severe Storms",
    hazard:"Hazardous Weather", hazards:"Hazardous Weather"
  };
  if(MAP[key]) return MAP[key];
  // Fallback: prettify the code (underscores→spaces, Title Case) so a raw string is NEVER shown
  var pretty=core.replace(/_/g," ").replace(/\s+/g," ").trim().replace(/\b\w/g,function(c){return c.toUpperCase();});
  return pretty || "Hazard";
}
/* Each hazard polygon carries far more than a name: the service's own display label, the
   REAL valid window (start_date/end_date, UTC-midnight day boundaries), an optional second
   period for split windows, and the issuance timestamp. Return structured records, merging
   same-label polygons into one date envelope. Missing fields degrade to a plain chip. */
function hazScan(results){
  var out=[];   // [{label, start, end}]
  results.forEach(function(rs){
    if(rs.status!=="fulfilled"||!rs.value) return;
    (rs.value.features||[]).forEach(function(f){
      var at=f.attributes||{}, label="";
      if(typeof at.label==="string"&&at.label.trim()){ label=at.label.trim(); }   // the service names it — use that
      else if(at.prod_type){ label=hazLabel(at.prod_type); }
      else if(at.Prod_Type){ label=hazLabel(at.Prod_Type); }
      else {
        for(var k in at){
          var v=at[k];
          if(typeof v==="string" && v.length>2 && !/^\d+$/.test(v) && !/^(day|http|\d{4}-)/i.test(v) && v.length>label.length) label=v;
        }
        // if the fallback grabbed a raw-looking code (underscores / Dx_y), clean it up too
        if(/_D\d+_\d+|_(clip|fill|outline)$/i.test(label)) label=hazLabel(label);
        label=label.trim();
      }
      if(!label) return;
      var rec=null;
      for(var i=0;i<out.length;i++){ if(out[i].label===label){ rec=out[i]; break; } }
      if(!rec){ rec={label:label, start:null, end:null}; out.push(rec); }
      [at.start_date, at.start_dt2].forEach(function(s){
        if(typeof s==="number"&&s>0&&(rec.start==null||s<rec.start)) rec.start=s;
      });
      [at.end_date, at.end_dt2].forEach(function(e){
        if(typeof e==="number"&&e>0&&(rec.end==null||e>rec.end)) rec.end=e;
      });
    });
  });
  return out;
}
/* Hazard dates are UTC-midnight day boundaries — format in UTC or the calendar day shifts back
   one when rendered in Chicago time. */
function hazD(ms,withMonth){
  // assembled by hand — locale part-ordering turned "Wed 29" into "29 Wed" and added commas
  var d=new Date(ms);
  var wd=d.toLocaleDateString([], {weekday:"short",timeZone:"UTC"});
  var mo=d.toLocaleDateString([], {month:"short",timeZone:"UTC"});
  return wd+" "+(withMonth?mo+" ":"")+d.getUTCDate();
}
function hazRange(s,e){
  if(s==null&&e==null) return "";
  if(s!=null&&e!=null){
    if(s===e) return hazD(s,true);
    return hazD(s,true)+" – "+hazD(e, new Date(e).getUTCMonth()!==new Date(s).getUTCMonth());
  }
  return hazD(s!=null?s:e,true);
}
/* Corroborate temperature hazards against the 7-day already on the page:
   "Hazardous Heat · Sun–Tue" + forecast 94/98/95 that stretch → "peaks 98° Monday in the 7-day" */
function hazForecastNote(h){
  if(!smart.days||!smart.days.length||h.start==null||h.end==null) return "";
  var l=h.label.toLowerCase();
  var mode=/heat|hot/.test(l)?"hi":(/cold|freeze|frost|chill/.test(l)?"lo":"");
  if(!mode) return "";
  function utcKey(ms){ var d=new Date(ms); return d.getUTCFullYear()*10000+(d.getUTCMonth()+1)*100+d.getUTCDate(); }
  function locKey(iso){ var d=weatherParts(iso); return d.year*10000+(d.month+1)*100+d.day; }
  var ks=utcKey(h.start), ke=utcKey(h.end), best=null;
  smart.days.forEach(function(d){
    var p=d.day||d.night; if(!p||!p.startTime) return;
    var k=locKey(p.startTime);
    if(k<ks||k>ke) return;
    if(mode==="hi"&&d.day&&d.day.temperature!=null&&(!best||d.day.temperature>best.v)) best={v:d.day.temperature,n:d.name};
    if(mode==="lo"&&d.night&&d.night.temperature!=null&&(!best||d.night.temperature<best.v)) best={v:d.night.temperature,n:d.name};
  });
  if(!best) return "";
  return mode==="hi"?("peaks "+best.v+"° "+best.n+" in the 7-day"):("down to "+best.v+"° "+best.n+" in the 7-day");
}


/* ============ WPC 7-DAY QPF (best-effort chip) ============ */
var QPF_URL="https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer";
var qpfLayerId;   // undefined = not checked yet; null = service has no 7-day layer (a real answer — don't refetch)


/* ============ FORECAST DISCUSSION (the pulse) ============ */
var nwsDiscussionOffice='LSX', nwsMessages=null, nwsLocalForecast=null;
function discussionLink(){
  return 'https://forecast.weather.gov/product.php?site=LSX&issuedby=LSX&product=AFD&format=CI&version=1&glossary=1';
}

function renderAFD(sec, issued){
  var el=document.getElementById("afd");
  var link=discussionLink(), anchor=document.getElementById('afdDiscussionLink');
  anchor.hidden=!link;
  if(link){anchor.href=link;anchor.setAttribute('aria-label','Full discussion — NWS '+nwsDiscussionOffice+' forecast discussion (opens in a new tab)');}
  if(!sec){
    el.innerHTML='<div class="empty">Discussion details unavailable right now.'+(link?' <a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">Open the full AFD ↗</a>':'')+'</div>';
    return;
  }
  var inner;
  if(sec.kind==="key"){
    var items=sec.text.split(/\n(?=\s*[-*]\s)/).map(function(s){
      return esc(s.replace(/^\s*[-*]\s*/,"").replace(/\s*\n\s*/g," ").trim());
    }).filter(Boolean);
    inner='<ul class="afd-list">'+items.map(function(it){return '<li>'+it+'</li>';}).join("")+'</ul>';
  }else{
    var paras=sec.text.split(/\n\s*\n/).map(function(p){return esc(p.replace(/\s*\n\s*/g," ").trim());}).filter(Boolean);
    inner=paras.map(function(p){return '<p>'+p+'</p>';}).join("");
    if(paras.length>1){
      inner='<p>'+paras[0]+'</p><details class="disclosure afd-more"><summary>'
        +'<span class="afd-read-more">Read more</span><span class="afd-show-less">Show less</span></summary>'
        +paras.slice(1).map(function(p){return '<p>'+p+'</p>';}).join("")+'</details>';
    }
  }
  var meta=sec.label+' · NWS '+(nwsMessages&&nwsMessages.officeName||nwsDiscussionOffice)+(issued?' · AFD issued '+timeAgo(issued):'');
  // An unchanged refresh only updates the credit, preserving disclosure state and focus.
  if(el.querySelector('.afd-body')&&el._afdContent===inner){
    el.querySelector('.afd-meta').textContent=meta;
    return;
  }
  el._afdContent=inner;
  el.innerHTML='<div class="afd-body">'+inner+'</div><div class="afd-meta">'+esc(meta)+'</div>';
}


// Shared forecast/hazard state, read by most renderers below.
var smart={spcRisk:0,eroRisk:0,fireRisk:0,hourly:[],hourlyAll:[],days:[],weekDays:[]};


function fmtT(d){ return d?d.toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric",minute:"2-digit"}):"—"; }
function fmtDur(ms){ var h=Math.floor(ms/3600000), m=Math.round(ms%3600000/60000); return h+"h "+m+"m"; }
function uvLevel(v){
  if(v==null) return null;
  if(v<3)  return {t:"Low",c:"#3ecf8e"};
  if(v<6)  return {t:"Moderate",c:"#e0b93a"};
  if(v<8)  return {t:"High",c:"#ff9f2f"};
  if(v<11) return {t:"Very High",c:"#ff6a2f"};
  return {t:"Extreme",c:"#c13bff"};
}
function shortT(t){ return new Date(t).toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric"}).replace(/\s/g,"").toLowerCase(); }
/* ===== UV =====
   UV reads as a current condition, not a seasonal curiosity, so it lives with the other exposure
   numbers in the hero and as a per-day figure in the 7-day. One request serves both: the hourly
   series gives "now" and the next-24h peak, the daily series gives each forecast day's maximum.
   Fetched year-round — a clear February afternoon over snow still burns. */
var uv={now:null, peak:null, daily:{}};

/* Painted into the hero. Both this and loadCurrent can run first, so it renders from whatever
   state exists — the same idempotent-repaint contract as renderCurrentCtx. */
function renderUvNow(){
  var el=document.getElementById("ccUv"); if(!el) return;
  var r=(uv.now!=null)?Math.round(uv.now):null;
  var p=uv.peak, pr=p?Math.round(p.v):null;
  // After dark UV is 0 for everyone; saying so is noise. Keep the tile only if there is either a
  // live reading worth having or a peak still ahead worth planning around.
  if((r==null||r<1)&&!(pr!=null&&pr>=3&&p.t>Date.now())){ el.innerHTML=""; return; }
  var live=(r!=null&&r>=1), lv=live?uvLevel(r):uvLevel(pr), sub=[], val;
  // A peak that lands on a later date needs saying so — "at 10am" at 11pm reads as four hours ago.
  var when=p?(weatherParts(p.t).key!==weatherParts().key?'tomorrow ':'at ')+shortT(p.t):"";
  if(live){
    val=r+' <span class="ex-cat">'+lv.t+'</span>';
    if(pr!=null&&pr>r) sub.push('peak <b>'+pr+'</b> '+when);
    /* "burn ~33 min" named a number without naming what it measured — 33 minutes of what, and
       burning what. The words carry it now, because the title cannot: a phone shows no tooltip,
       and the phone is where this gets read. The title only adds the assumption behind the
       figure, which is a footnote rather than the point. */
    if(r>=3) sub.push('<span class="ex-hint" title="Roughly how long untanned, unprotected skin '
      +'can be in full sun before it starts to burn at this UV index">sunburn in ~<b>'
      +Math.max(5,Math.round(200/r))+'</b> min</span>');
  }else{
    // After dark the peak is the whole message, so it takes the value slot and names itself
    // rather than trailing after a label with nothing under it.
    val=pr+' <span class="ex-cat">peak</span>';
    sub.push(when);
  }
  el.innerHTML='<div class="k"><span class="ex-dot" style="background:'+lv.c+'"></span>UV</div>'
    +'<div class="v" style="color:'+exposureColor(lv.c)+'">'+val+'</div>'
    // Left genuinely empty when there is no detail (a UV of 2 has neither a burn clock nor a
    // higher peak to name), so .s:empty can collapse it rather than leaving a stray margin.
    +'<div class="s">'+(sub.length?'<span class="ex-b">'
      +sub.join('</span> <span class="ex-sep">·</span> <span class="ex-b">')+'</span>':'')+'</div>';
}
/* ============ NWS KEY MESSAGES ============
   The hero displays only verified official text. Existing hazard candidates remain internal
   guards for the optional model note in hourly details; they never supply the NWS message card. */
var callAqi=null;
var callRisk=null;   // {spc, ero, fire, wssi}, each [day1,day2] — raw dn/rank values from loadSpc
var callLocalAlert=null; // strongest active LSX alert covering the selected location, if known
var callAlertGroups=[]; // retained so an expiring warning can yield to another active local hazard

function nwsStamp(time){return weatherTime(time,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}
function renderNwsMessages(){
  var card=document.getElementById('callCard'), row=document.getElementById('callRow');
  if(!card||!row) return;
  var now=Date.now(), c=feedChecks.afd, m=nwsMessages, status=m&&m.generation===locSeq?m.status:'loading';
  if(status==='ready'&&(feedState(c,now,FEEDS.afd.age)!=='ready'||now-m.issuedAt>NWS_MESSAGES_MAX_AGE||m.sectionIssuedAt&&now-m.sectionIssuedAt>NWS_MESSAGES_MAX_AGE)) status='stale';
  var title=document.getElementById('keyMessagesTitle'), meta='', notice='', evidence='', html='';
  var link=discussionLink(), anchor=document.getElementById('keyDiscussionLink');
  if(!link&&document.activeElement===anchor)document.querySelector('#briefWhy > summary').focus({preventScroll:true});
  anchor.hidden=!link;
  if(link){anchor.href=link;anchor.setAttribute('aria-label','Full discussion — NWS '+nwsDiscussionOffice+' forecast discussion (opens in a new tab)');}
  if(status==='ready'){
    title.textContent='NWS Key Messages';
    meta='Regional outlook · NWS '+m.officeName+' ('+m.office+')';
    html='<ul class="nws-key-list">'+m.messages.map(function(s){return '<li>'+esc(s)+'</li>';}).join('')+'</ul>';
    notice='AFD issued '+nwsStamp(m.issuedAt)+' · checked '+nwsStamp(c.successAt);
    evidence='<p>'+(m.sectionIssuedAt?'Key Messages section issued '+esc(nwsStamp(m.sectionIssuedAt))+'.':'Key Messages revision time is not supplied in this discussion.')+'</p>'
      +'<p>AFD product issuance can reflect an aviation-only update; it does not establish when these messages changed. Official wording and bullet order are preserved; line wrapping is removed.</p>'
      +'<p>This is an office-wide outlook. Geographic qualifiers apply to the named areas; these bullets are not a point forecast for '+esc(current.name)+'. Location-specific warnings above take precedence.</p>'
      +'<p>Messages are withheld after 18 hours from the AFD issuance or an explicit Key Messages section time, or after one hour without a successful discussion check. They are fetched again on location changes and are never restored from saved HTML.</p>';
  }else{
    title.textContent='NWS Local Forecast';
    meta='Local forecast for '+current.name;
    notice=({loading:'Checking regional Key Messages. Local forecast fallback.',missing:'Key Messages are not included in the latest discussion. Local forecast fallback.',stale:'Key Messages or their verification are stale. Local forecast fallback.',malformed:'Key Messages could not be verified in the latest discussion. Local forecast fallback.',unavailable:'Regional Key Messages are unavailable. Local forecast fallback.'}[status]||'Regional Key Messages are unavailable. Local forecast fallback.');
    var local=nwsLocalForecast&&nwsLocalForecast.generation===locSeq?nwsLocalForecast:null;
    var chosen=local&&nwsLocalPeriod(local.daily,feedChecks.daily,now,FEEDS.daily.age), source='Daily';
    if(!chosen&&local){chosen=nwsLocalPeriod(local.hourly,feedChecks.hourly,now,FEEDS.hourly.age);source='Hourly';}
    if(chosen){
      var p=chosen.period;
      html='<p class="nws-local-period"><strong>'+esc(p.name||nwsStamp(Date.parse(p.startTime)))+'</strong> '+esc(p.detailedForecast||p.shortForecast)+'</p>';
      evidence='<p>'+source+' NWS forecast issued '+esc(nwsStamp(chosen.issuedAt))+'; checked '+esc(nwsStamp(feedChecks[source==='Daily'?'daily':'hourly'].successAt))+'. Valid '+esc(nwsStamp(Date.parse(p.startTime)))+' – '+esc(nwsStamp(Date.parse(p.endTime)))+'.</p>';
    }else html='<p>Current NWS local forecast unavailable. Open the official forecast for this location.</p>';
    html+='<p class="nws-local-link">'+officialSourceLink('https://forecast.weather.gov/MapClick.php?lat='+current.lat+'&lon='+current.lon,'NWS local forecast for '+current.name,'Open local NWS forecast ↗')+'</p>';
    evidence+='<p>This fallback uses the current period of a live NWS local forecast, with an issuance no more than 12 hours old and a successful check within one hour. Saved, expired or unverified text is withheld. It is not an NWS Key Messages section. Local warnings above take precedence.</p>';
  }
  var metaEl=document.getElementById('keyMessagesMeta');if(metaEl.textContent!==meta)metaEl.textContent=meta;
  var statusEl=document.getElementById('keyMessagesStatus');if(statusEl.textContent!==notice)statusEl.textContent=notice;
  if(statusEl.getAttribute('data-state')!==status)statusEl.setAttribute('data-state',status);
  if(row.innerHTML!==html){
    var rowFocused=row.contains(document.activeElement);
    row.innerHTML=html;
    if(rowFocused){var restore=row.querySelector('a')||document.querySelector('#briefWhy > summary');restore.focus({preventScroll:true});}
  }
  var details=document.getElementById('briefEvidence');if(details.innerHTML!==evidence) details.innerHTML=evidence;
  card.classList.add('has');
}
function briefingComfortAllowed(){
  return feedState(feedChecks.alerts,Date.now(),FEEDS.alerts.age)==="ready"
    &&feedState(feedChecks.aqi,Date.now(),FEEDS.aqi.age)==="ready"&&callAqi!=null&&callAqi<=100;
}
function renderBriefingStatus(){
  var el=document.getElementById("briefStatus"); if(!el) return;
  var notes=[];
  if(feedState(feedChecks.alerts,Date.now(),FEEDS.alerts.age)!=="ready") notes.push("Alert status is unverified. Check official NWS warnings.");
  el.textContent=notes.join(" "); el.hidden=!notes.length;
}
function renderTheCall(){
  var card=document.getElementById("callCard"), row=document.getElementById("callRow");
  if(!card||!row) return;
  var now=new Date(), H=bottomLineHours(forecastWindowHours(smart.hourlyAll,24,Date.now()));
  var hourlyReady=H.length>=6;
  var comfort=briefingComfortAllowed(); renderTheCall._comfortAllowed=comfort; renderBriefingStatus();
  var candidates=bottomLineHourlyCandidates(hourlyReady?H:[],{now:now,uvPeak:uv.peak,aqi:callAqi,allowComfort:comfort});
  function push(pri,ico,topic,label,headline,detail,action,tone,context,opts){
    candidates.push(bottomCandidate(pri,ico,topic,label,headline,detail,action,tone,context,opts));
  }

  /* The outlook desks see hazards beyond the hourly edge. Their pure verdicts join the hourly
     candidates before one deterministic selector chooses the lead and supports. */
  if(callRisk){
    [outlookVerdict(OUTLOOK_CFG.spc, spcRisk(callRisk.spc[0]).lvl, spcRisk(callRisk.spc[1]).lvl),
     outlookVerdict(OUTLOOK_CFG.ero, eroRisk(callRisk.ero[0]).lvl, eroRisk(callRisk.ero[1]).lvl),
     outlookVerdict(OUTLOOK_CFG.fire, fireRisk(callRisk.fire[0]).lvl, fireRisk(callRisk.fire[1]).lvl),
     outlookVerdict(OUTLOOK_CFG.wssi, callRisk.wssi[0], callRisk.wssi[1])
    ].forEach(function(v){ if(v) candidates.push(v); });
  }
  // — climate context: only genuinely notable framings earn a candidate (and only from a record
  //    deep enough to mean anything) —
  var forecastRecord=contextRecord(climate.fcHiDate);
  if(forecastRecord&&forecastRecord.years>=CTX_MIN_YEARS&&climate.fcHi!=null&&forecastRecord.recHi){
    var gap=forecastRecord.recHi.v-climate.fcHi;
    if(gap<=0) push(92,"record","climate","Context","Record warmth possible",
      "Could reach the "+fmtMD(calendarDate(climate.fcHiDate))+" record of "+Math.round(forecastRecord.recHi.v)+"° from "+forecastRecord.recHi.y+".","","context",true);
    else if(gap<=4) push(88,"record","climate","Context","Near-record warmth",
      "Within "+Math.round(gap)+"° of the "+fmtMD(calendarDate(climate.fcHiDate))+" record: "+Math.round(forecastRecord.recHi.v)+"° in "+forecastRecord.recHi.y+".","","context",true);
    else{
      var rk=ctxRankBelow(forecastRecord.doyHi,climate.fcHi);
      if(rk&&rk.pct>=90) push(74,"stats","climate","Context","Unusually warm",
        "Warmer than "+rk.below+" of "+rk.total+" "+fmtMD(calendarDate(climate.fcHiDate))+"s on record.","","context",true);
      else if(rk&&rk.pct<=10) push(74,"stats","climate","Context","Unusually cool",
        "Cooler than "+(rk.total-rk.below)+" of "+rk.total+" "+fmtMD(calendarDate(climate.fcHiDate))+"s on record.","","context",true);
    }
  }
  if(ctx.ready&&ctx.dry&&ctx.dry.days>=10) push(45,"drought","climate","Context","Long dry stretch",
    "Day "+ctx.dry.days+" with no measurable rain.","","context",true);

  var model=buildBottomLine(candidates,callLocalAlert);
  renderTheCall._nbmContext={model:model,candidates:candidates};
  renderNwsMessages();
}

/* ============ LIVE EXPIRY COUNTDOWNS ============
   "Through Mon 9:00 PM" is a fact you have to do arithmetic on; "24 min left" is the thing you
   actually want during a warning. Any element carrying data-exp (ms epoch) is filled in here,
   so restored snapshots tick correctly too — and an expired alert says so rather than lingering. */
function fmtSpan(ms){   // bare duration, no framing
  var m=Math.floor(ms/60000);
  if(m>=1440){ var dys=Math.floor(m/1440); return dys+(dys===1?" day":" days"); }
  if(m>=60){ var h=Math.floor(m/60), r=m%60; return h+"h"+(r?" "+r+"m":""); }
  if(m>=1) return m+" min";
  return "under a minute";
}
function fmtLeft(ms){ return ms<=0?null:(fmtSpan(ms)+(ms<60000?"":" left")); }
function tickCountdowns(){
  var now=Date.now();
  if(alertsRetained) renderRetainedAlerts();
  else if(lastAlertData&&lastAlertData.features.some(function(f){return alertEvidenceEnd(f.properties)<=now;})){
    lastAlertData={features:liveAlertFeatures(lastAlertData.features,now)};
    if(feedState(feedChecks.alerts,now,FEEDS.alerts.age)!=="ready"){
      alertsRetained=true;retainedAlertKey="";renderRetainedAlerts();
    }else renderAlertsData(lastAlertData);
  }
  if(callLocalAlert&&callLocalAlert.ends>0&&callLocalAlert.ends<=now){
    callLocalAlert=bottomLineLocalAlert(callAlertGroups,now);
    renderTheCall();
  }
  [].forEach.call(document.querySelectorAll("[data-exp]"),function(el){
    var t=+el.getAttribute("data-exp");
    if(!t){ el.textContent=""; return; }
    var left=t-now;
    // data-pre marks an alert whose window hasn't opened yet — "starts in 17h" beats "3 days left",
    // which would describe the end of something that isn't happening
    if(el.hasAttribute("data-pre")){
      if(left>0){ el.textContent="starts in "+fmtSpan(left); el.classList.remove("expired","urgent"); }
      else { el.textContent="starting now"; el.classList.add("urgent"); }
      return;
    }
    var s=fmtLeft(left);
    if(s==null){
      el.textContent="expired";
      el.classList.remove("urgent"); el.classList.add("expired");
      return;
    }
    el.textContent=s;
    el.classList.remove("expired");
    el.classList.toggle("urgent", left<=15*60000);   // final quarter hour reads red
  });
  /* The alert time bar fills here for the same reason the countdowns do: it is a live value, and
     writing it into the markup as an inline width made every poll's HTML differ from the last —
     which is precisely what paintAlerts' comparison exists to notice. A one-hour warning's bar
     moves 1.7 points a minute, so baked in it would have forced a full rebuild of the section on
     every single refresh and left the skip firing only for multi-day alerts. Out here it also
     advances once a second instead of stepping once a minute. */
  [].forEach.call(document.querySelectorAll("[data-prog]"),function(el){
    var v=(el.getAttribute("data-prog")||"").split(","), s=+v[0], e=+v[1];
    if(!s||!e||e<=s) return;
    el.style.width=Math.max(0,Math.min(100,(now-s)/(e-s)*100)).toFixed(1)+"%";
  });
}

/* ============ CLOCK ============ */
function tick(){
  var d=new Date();
  document.getElementById("clock").textContent=d.toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"2-digit",minute:"2-digit"})+" CT";
  document.getElementById("cdate").textContent=d.toLocaleDateString("en-US", {timeZone:WEATHER_TZ,weekday:"long",month:"short",day:"numeric"});
  tickCountdowns();
  syncRadarBadge();
}

/* ============ ORCHESTRATION ============ */

/* Mark the scheduler entries a manual refresh has just satisfied, so runDue() doesn't re-fire the
   same fetch seconds later. Stamped at START, matching runDue's own semantics (it stamps before
   calling, not after, so a failure waits a full interval rather than hammering). Guarded because
   the initial refreshAll() runs before SCHED is initialised — startSchedule() stamps everything on
   first start anyway, so a no-op there is correct. */
function stampSched(keys){
  if(typeof SCHED==="undefined"||!SCHED) return;
  var now=Date.now();
  SCHED.forEach(function(t){ if(keys.indexOf(t.key)>=0) t.last=now; });
}
var refreshInFlight=null, refreshSeq=0;
function refreshAll(){
  if(refreshInFlight) return refreshInFlight;   // one caller owns the expensive full-page fan-out
  var seq=++refreshSeq, g=locSeq;
  var keys=feedTasks(false);
  var label=document.getElementById("refreshLabel");
  var btn=document.getElementById("refresh");
  lastAttempt=Date.now(); freshnessCheck(); label.textContent="Refreshing…";
  if(btn){ btn.disabled=true; btn.setAttribute("aria-busy","true"); }
  stampSched(keys.concat(["snapshot"]));
  /* Convert synchronous loader failures to rejected task promises. Without this guard, one throw
     while building the array exits refreshAll before refreshInFlight exists and strands the button
     in its disabled "Refreshing…" state. allSettled can isolate failures only after it receives
     them, so each invocation has to cross that boundary deliberately. */
  var tasks=keys.map(runFeed);
  tasks.push(ensureMaps());
  refreshInFlight=Promise.allSettled(tasks).then(function(){
    freshnessCheck();
    if(g===locSeq) snapSafeSeq=g;  // an older location's refresh cannot bless a newer screen
    resolveSnapBar();   // live data has landed (or we're offline and should say so)
    saveSnapshotIdle(); // freshest render → instant paint next visit (no rush: yield to idle)
  }).then(function(v){
    if(seq===refreshSeq){
      refreshInFlight=null; label.textContent="Refresh";
      if(btn){ btn.disabled=false; btn.removeAttribute("aria-busy"); }
    }
    return v;
  },function(e){
    if(seq===refreshSeq){
      refreshInFlight=null; label.textContent="Refresh";
      if(btn){ btn.disabled=false; btn.removeAttribute("aria-busy"); }
    }
    throw e;
  });
  return refreshInFlight;
}


/* ============ THEME TOGGLE (auto → light → dark) ============
   The PREFERENCE (incl. "auto") lives in themePref/localStorage; the DOM's data-theme
   only ever holds the resolved "light"/"dark", so CSS needs no duplicate auto block
   and meta theme-color always matches what's actually on screen. */
var themePref="auto";
function resolvedTheme(pref){
  if(pref==="light"||pref==="dark") return pref;
  return (window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark";
}
function applyTheme(pref){
  themePref=pref;
  var t=resolvedTheme(pref);
  document.documentElement.setAttribute("data-theme",t);
  var b=document.getElementById("themeBtn");
  if(b){
    b.innerHTML = ic(pref==="auto"?"theme-auto":(pref==="light"?"sun":"moon"));
    b.title = "Theme: "+pref+" (tap to change)";
  }
  var meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute("content", t==="light"?"#eef1f6":"#0a0e14");
  if(typeof updateRadarBase==="function") updateRadarBase();
  if(typeof updateStationBase==="function") updateStationBase();
}
function initTheme(){
  var t="auto";
  try{ t=localStorage.getItem("lsxTheme")||"auto"; }catch(e){}
  applyTheme(t);
  document.getElementById("themeBtn").addEventListener("click",function(){
    var next = themePref==="auto"?"light":(themePref==="light"?"dark":"auto");
    try{ localStorage.setItem("lsxTheme",next); }catch(e){}
    applyTheme(next);
  });
  // Track live OS scheme changes while in auto (updates palette, theme-color, and map basemaps)
  if(window.matchMedia){
    var mq=window.matchMedia("(prefers-color-scheme: light)");
    var onOsTheme=function(){ if(themePref==="auto") applyTheme("auto"); };
    if(mq.addEventListener) mq.addEventListener("change",onOsTheme);
    else if(mq.addListener) mq.addListener(onOsTheme);
  }
}

/* ============ INIT ============ */
function initJumpCue(){
  var nav=document.getElementById("jumpNav");
  function sync(){
    var remaining=nav.scrollWidth-nav.clientWidth;
    nav.classList.toggle("more-left",nav.scrollLeft>1);
    nav.classList.toggle("more-right",remaining>1&&nav.scrollLeft<remaining-1);
  }
  var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)");
  function move(toEnd){ nav.scrollTo({left:toEnd?nav.scrollWidth:0,behavior:reduce&&reduce.matches?"auto":"smooth"}); }
  document.querySelector(".jump-prev").addEventListener("click",function(){ move(false); });
  document.querySelector(".jump-next").addEventListener("click",function(){ move(true); });
  nav.addEventListener("scroll",sync,{passive:true});
  window.addEventListener("resize",sync);
  sync();
}
initJumpCue();
initTheme();
initLocationUI();
initLocation();
restoreSnapshot();   // paint the last good view NOW — before a single fetch (needs `current` from initLocation)
initMapLocks();
syncRadarProductUI();
/* The caption and the toggles' pressed state ship EMPTY and are written by syncSkyMeta(), which
   otherwise only runs via applySkyLayers() — and that is reached from initRadarMap(), which bails
   before it if Leaflet never loaded. Call it here so a failed CDN leaves a card that still says
   what it is, rather than a blank caption over the map's own "open the official radar" fallback. */
syncSkyMeta();
resolveRiskLayers();   // warm the layer-id lookup; loadSpc awaits this same memoised promise
document.getElementById("daily").addEventListener("click",function(e){
  var row=e.target.closest(".day");
  if(row&&row.parentNode) toggleOpen(row.parentNode,row);
});
document.getElementById("alerts").addEventListener("click",function(e){
  if(e.target.closest(".a2-radar")){       // jump to this alert's polygons on the radar
    /* The card is always on the page now, so there is nothing to summon — but reflectivity may be
       switched off, and jumping to a bare basemap to look at a warning is a poor landing. The
       polygons draw either way; turning radar back on is what the visitor actually meant. */
    if(!skyOn.radar) setSkyLayer("radar",true);
    var rc=e.target.closest(".alert");
    e.stopPropagation();
    if(rc) showAlertOnRadar(rc.getAttribute("data-evs")||rc.getAttribute("data-aid"),
                            rc.getAttribute("data-scope"));
    return;
  }
  if(e.target.closest(".a2-more")){        // "+N more" reveals counties in place, doesn't open details
    var ac=e.target.closest(".alert");
    if(ac){ ac.classList.add("areas-all"); e.stopPropagation(); if(typeof scheduleMasonry==="function") scheduleMasonry(); }
    return;
  }
  /* The banner head is the drawer's one control — a real <button>, so Enter and Space arrive
     here as clicks with no keydown handler. Clicks inside the open drawer fall through to
     nothing, which is correct: the drawer holds its own controls. */
  var head=e.target.closest(".ab-head");
  if(head){
    toggleOpen(head.closest(".alert"),head);
    if(typeof scheduleMasonry==="function") scheduleMasonry();
  }
});
tick();
refreshAll();
startMapRuntime();

/* ---- Unified scheduler: one ticker, pauses when backgrounded, tracks real freshness ---- */
var SCHED=Object.keys(FEEDS).filter(function(k){return FEEDS[k].load&&FEEDS[k].every;}).map(function(k){
  return {key:k,every:FEEDS[k].every,fn:function(){return runFeed(k);}};
});
var schedTimer=null, clockTimer=null;
var scheduleDate=weatherParts().key;
function runDue(){
  var now=Date.now(), today=weatherParts(now).key;
  if(today!==scheduleDate){
    scheduleDate=today;
    // Calendar-bound records and normals must not silently acquire the new day's label.
    ctx.ready=false; climate.normHi=null; climate.normLo=null; climate.normDate=null;
    renderContext(); renderCurrentCtx(); renderVsNormal(); renderTheCall();
    SCHED.forEach(function(t){if(["daily","grid","uv","risk","climate","context"].indexOf(t.key)>=0)t.last=0;});
  }
  SCHED.forEach(function(t){
    if(now - (t.last||0) >= t.every){
      t.last=now;
      try{ t.fn(); }catch(e){}   // each loader marks its own validated weather check
    }
  });
}
function startSchedule(){
  stopSchedule();
  // Stamp only on the FIRST start (initial refreshAll already covered them). On later restarts
  // (returning from background) keep each task's real last-run time so runDue() can catch up.
  SCHED.forEach(function(t){ if(!t.last) t.last=Date.now(); });
  schedTimer=setInterval(function(){ runDue(); freshnessCheck(); }, 30000);
  clockTimer=setInterval(tick,1000);
}
function stopSchedule(){
  if(schedTimer){clearInterval(schedTimer);schedTimer=null;}
  if(clockTimer){clearInterval(clockTimer);clockTimer=null;}
}
/* Everything this page does on a timer already stops when the tab goes away — the scheduler, the
   clock, the radar loop. CSS animations were the exception: the browser keeps compositing them
   whether or not anyone can see them, so the logo's sweep and the two colour blobs behind the page
   were the one thing still costing battery in a tab left open all day. See .tab-hidden. */
function syncTabMotion(){ document.documentElement.classList.toggle("tab-hidden", document.hidden); }
document.addEventListener("visibilitychange",function(){
  syncTabMotion();
  if(document.hidden){ pauseSpcDiscovery(); stopSchedule(); radarPauseLoop(); saveSnapshot(); }   // no drain while backgrounded; bank the view on the way out
  else { resumeSpcDiscovery(); tick(); startSchedule(); runDue(); freshnessCheck(); } // catch up on return
});
window.addEventListener("pagehide",disposeSpcDiscovery);
window.addEventListener("pageshow",restoreSpcDiscovery);
syncTabMotion();   // a page opened into a background tab never gets the event
if(!document.hidden) startSchedule();
document.getElementById("refresh").addEventListener("click",function(){ refreshAll(); });

/* ---- JavaScript masonry: pack band cards by their REAL measured height ---- */
var masonryPointerActive=false;
function layoutMasonry(){
  // Preserve the pressed target until its native click/toggle has completed.
  if(masonryPointerActive)return;
  var m=document.querySelector(".masonry"); if(!m) return;
  if(layoutPlanningContext(m,tier))return;
  var GAP=16, w=m.clientWidth;
  var cols = w<=680 ? 1 : (w<=1100 ? 2 : 3);
  var colW = Math.floor((w-GAP*(cols-1))/cols);
  var cards=[].slice.call(m.children).filter(function(c){return c.classList.contains("card");});
  if(!cards.length) return;
  m.classList.add("mready");
  // Pass 1a: set every card's width (all WRITES together)…
  var data=cards.map(function(c){
    var span=c.classList.contains("wide")?Math.min(2,cols):1;
    c.style.width=(span*colW+(span-1)*GAP)+"px";
    return {c:c, span:span, h:0};
  });
  // Pass 1b: …then measure all heights (all READS together) — interleaving write/read per card
  // would force a synchronous reflow for every card instead of one for the whole batch
  data.forEach(function(d){ d.h=d.c.offsetHeight; });
  // Pass 2: order for packing.
  //  Importance tiers come FIRST so critical outlooks stay high,
  //  then within a tier we pack tallest-first (desktop/tablet) for an even bottom, or natural order (mobile).
  // Explicit widget hierarchy: lower rank = more important = packed higher.
  //  (Alerts/Pulse/Current/Radar/Hourly are fixed heroes above this masonry.)
  function tier(id){
    var RANK={
      riversCard:1, aqiCard:1, afdCard:1, // local context follows the fixed planning band
      riskCard:2,       // severe storm/flood/fire risk
      hazardsCard:3,    // hazards outlook (days 3–14)
      obsCard:4,        // station plot — current regional obs
      droughtCard:6,    // drought outlook
      climateCard:7,    // climate vs normal
      cpcCard:8         // week-ahead leanings
    };
    return (RANK[id]!=null) ? RANK[id] : 50;
  }
  data.forEach(function(d,i){ d.idx=i; });
  data.sort(function(a,b){
    var ta=tier(a.c.id), tb=tier(b.c.id);
    if(ta!==tb) return ta-tb;
    if(cols>1) return b.h-a.h;   // within a tier: tallest-first for tight packing
    return a.idx-b.idx;           // single column (mobile): keep natural reading order
  });
  // Pass 3: place cards. Base rule: each card drops into the spanned column-window with the
  // lowest top (ties → leftmost). A WIDE card must clear the tallest spanned column, which would
  // permanently strand the height difference in the shorter column as a hole — so before
  // committing a wide card, BACKFILL: pull forward later single-width cards that fit inside that
  // hole. A card only jumps the importance ranking to occupy space that would otherwise stay empty.
  var colH=[]; for(var i=0;i<cols;i++) colH.push(0);
  function bestWindow(span){
    var bs=0, bt=Infinity;
    for(var s=0; s+span<=cols; s++){
      var top=0; for(var k=s;k<s+span;k++){ if(colH[k]>top) top=colH[k]; }
      if(top < bt-0.5){ bt=top; bs=s; }
    }
    return {start:bs, top:bt};
  }
  function setPos(d,col,top){
    d.left=col*(colW+GAP); d.top=top;   // remembered so reading order can be derived from geometry
    d.c.style.left=d.left+"px";
    d.c.style.top=top+"px";
  }
  var queue=data.slice();
  while(queue.length){
    var d=queue.shift();
    var w=bestWindow(d.span);
    if(d.span>1){
      var safety=queue.length+4;
      while(safety-->0){
        // deepest hole a spanned column would strand under the wide card's start line
        var gapCol=-1, gapH=40;                    // sub-40px slivers aren't worth reordering for
        for(var k=w.start;k<w.start+d.span;k++){
          var g=w.top-colH[k];
          if(g>gapH){ gapH=g; gapCol=k; }
        }
        if(gapCol<0) break;
        // tallest later single-width card that fits WITHOUT pushing the wide card down
        // (strict fit keeps w valid, so no recompute needed; tallest-first = best space use)
        var pick=-1;
        for(var q=0;q<queue.length;q++){
          if(queue[q].span===1 && queue[q].h+GAP<=gapH && (pick<0||queue[q].h>queue[pick].h)) pick=q;
        }
        if(pick<0){
          // No card fits INSIDE the hole. Fallback: a slightly-too-tall filler that pushes the
          // wide card down by `push` px converts a gapH-px hole into a push-px one — accept the
          // smallest such push when it's a clear win (leaves at least 24px less empty space).
          var alt=-1, altPush=Infinity;
          for(var q2=0;q2<queue.length;q2++){
            var c2=queue[q2]; if(c2.span!==1) continue;
            var push=(colH[gapCol]+c2.h+GAP)-w.top;
            if(push>0 && push<gapH-24 && push<altPush){ altPush=push; alt=q2; }
          }
          if(alt<0) break;
          var fill2=queue.splice(alt,1)[0];
          setPos(fill2,gapCol,colH[gapCol]);
          colH[gapCol]+=fill2.h+GAP;
          w=bestWindow(d.span);   // the wide card's start line moved — recompute before continuing
          continue;
        }
        var fill=queue.splice(pick,1)[0];
        setPos(fill,gapCol,colH[gapCol]);
        colH[gapCol]+=fill.h+GAP;
      }
    }
    setPos(d,w.start,w.top);
    var nb=w.top+d.h+GAP;
    for(var k2=w.start;k2<w.start+d.span;k2++) colH[k2]=nb;
  }
  m.style.height=Math.max.apply(null,colH)+"px";
  reorderMasonryDOM(m,data);
  fitDayDates();
  document.dispatchEvent(new Event("lsxlayout"));
}
/* Tab order and screen-reader order follow the DOM, but these cards are absolutely positioned, so
   after packing they can read in a wholly different order than they appear. Put the nodes into
   visual order (top row first, then left-to-right); since position comes from inline top/left,
   moving them changes nothing on screen.
   The iframe guard is defensive: re-inserting an element reloads any iframe inside it. Nothing in
   the masonry hosts an iframe today (the lightning map that motivated the guard is gone), so the
   reorder now always runs and reading order matches visual order. */
function reorderMasonryDOM(m,data){
  if(m.querySelector("iframe")) return;
  var visual=data.slice().sort(function(a,b){
    if(Math.abs(a.top-b.top)>4) return a.top-b.top;   // same row within 4px
    return a.left-b.left;
  });
  var kids=[].slice.call(m.children).filter(function(c){ return c.classList.contains("card"); });
  var same=kids.length===visual.length;
  for(var i=0;same&&i<visual.length;i++){ if(kids[i]!==visual[i].c) same=false; }
  if(same) return;                                    // don't churn the DOM for no reason
  var focused=document.activeElement, restoreFocus=focused&&m.contains(focused);
  if(_mObs) _mObs.disconnect();                       // our own moves must not re-trigger layout
  visual.forEach(function(d){ m.appendChild(d.c); });
  if(_mObs) _mObs.observe(m,_mObsOpts);               // disconnect() also drops queued records
  // Moving an existing card can blur its native disclosure or other control. Keep the same node.
  if(restoreFocus&&m.contains(focused)&&document.activeElement!==focused) focused.focus({preventScroll:true});
}
var _masonryRAF=null;
function scheduleMasonry(){ if(_masonryRAF) cancelAnimationFrame(_masonryRAF); _masonryRAF=requestAnimationFrame(layoutMasonry); }
// Recompute on load, resize, image loads, and after any data refresh repaints a card
window.addEventListener("resize", scheduleMasonry);
window.addEventListener("load", function(){ scheduleMasonry(); setTimeout(scheduleMasonry,500); setTimeout(scheduleMasonry,1500); });
// Class and native disclosure state catch expand/collapse height changes; the engine's style writes
// are filtered out (no loop). Hoisted so reorderMasonryDOM can disconnect it — moving children
// fires childList records, which would otherwise re-enter layout forever.
var _mObs=null, _mObsOpts={childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["class","open","hidden"]};
(function(){
  var m=document.querySelector(".masonry");
  if(m){
    m.addEventListener("pointerdown",function(){masonryPointerActive=true;},true);
    function releasePointer(){
      // Native click follows pointerup before the next animation frame. Reparenting a card
      // between those events can discard the click in WebKit even when focus is restored.
      requestAnimationFrame(function(){masonryPointerActive=false;scheduleMasonry();});
    }
    document.addEventListener("pointerup",releasePointer,true);
    document.addEventListener("pointercancel",releasePointer,true);
    window.addEventListener("blur",releasePointer);
    // Source text, disclosure and font metrics can change height after the mutation's frame.
    if(window.ResizeObserver){
      var sizes=new ResizeObserver(scheduleMasonry);
      [].forEach.call(m.children,function(card){if(card.classList.contains("card"))sizes.observe(card);});
    }
    // re-pack whenever a child image finishes loading
    [].slice.call(m.querySelectorAll("img")).forEach(function(img){ img.addEventListener("load",scheduleMasonry); img.addEventListener("error",scheduleMasonry); });
    // re-pack when card contents change (data loads in)
    // Pack feed/disclosure growth in the mutation checkpoint. Deferring to another frame
    // leaves absolutely positioned cards overlapping briefly and can send pointerdown
    // to a different card than pointerup, even while the intended summary is visible.
    if(window.MutationObserver){
      _mObs=new MutationObserver(function(records){
        // GL resize toggles decorative classes inside the fixed map viewport. Packing
        // during that resize delivery changes shallower card sizes again in WebKit.
        // Real card sizes still have their ResizeObserver; content/disclosures pack now.
        if(records.some(function(r){return r.type!=="attributes"||r.attributeName!=="class"||!r.target.closest(".leaflet-pane,.leaflet-control-container");}))layoutMasonry();
      });
      _mObs.observe(m,_mObsOpts);
    }
  }
})();
scheduleMasonry();

/* The fixed forecast band has its own resize/content lifecycle now. */
(function(){
  var card=document.getElementById("forecastCard");
  var frame=null;
  function scheduleDates(){
    if(frame!=null)return;
    // Date fitting changes row heights. Run after resize delivery so a narrower
    // viewport/fullscreen transition cannot resize its own observed parent mid-cycle.
    frame=requestAnimationFrame(function(){frame=null;fitDayDates();});
  }
  if(window.ResizeObserver) new ResizeObserver(scheduleDates).observe(card);
  if(window.MutationObserver) new MutationObserver(scheduleDates).observe(card,{childList:true,subtree:true,characterData:true});
})();

/* Active navigation follows rendered geometry, including independent disclosures and repacking. */
(function(){
  var nav=document.getElementById("jumpNav"), bar=nav.parentElement, queued=false, clicked=null, clickedView=null;
  var links=[].slice.call(nav.querySelectorAll('a'));
  function update(){
    queued=false;
    var edge=Math.max(bar.getBoundingClientRect().bottom+16,parseFloat(getComputedStyle(document.getElementById("currentCard")).scrollMarginTop)+2);
    var candidates=links.map(function(link){return {link:link,box:document.querySelector(link.getAttribute('href')).getBoundingClientRect()};})
      .filter(function(item){return item.box.height>0;})
      .sort(function(a,b){return a.box.top-b.box.top||a.box.left-b.box.left;});
    var active=candidates[0];
    candidates.forEach(function(item){if(item.box.top<=edge&&(!active||item.box.top>active.box.top+4))active=item;});
    if(window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-2){
      var visible=candidates.filter(function(item){return item.box.top<window.innerHeight&&item.box.bottom>edge;});
      if(visible.length)active=visible[visible.length-1];
    }
    // Native anchor jumps settle before this frame. Retire their intent before
    // evaluating geometry after a real scroll or viewport change, so an old click
    // cannot re-arm merely because its section becomes clamped again later.
    if(clickedView&&(Math.abs(window.scrollY-clickedView.y)>1||
      window.innerWidth!==clickedView.width||window.innerHeight!==clickedView.height)){
      clicked=null;clickedView=null;
    }
    var chosen=candidates.find(function(item){return item.link===clicked;});
    var fullyVisible=chosen&&chosen.box.top>edge&&chosen.box.bottom<=window.innerHeight;
    var clamped=fullyVisible&&chosen.box.top+window.scrollY-edge>document.documentElement.scrollHeight-window.innerHeight;
    if(chosen&&!clickedView)clickedView={y:window.scrollY,width:window.innerWidth,height:window.innerHeight,clamped:!!clamped};
    if(clickedView){if(clamped)clickedView.clamped=true;else if(!fullyVisible)clickedView.clamped=false;}
    // Late content can permit further scrolling without moving a fully visible
    // target. Preserve the initial clamped choice until the viewport actually moves.
    if(chosen&&active&&(Math.abs(chosen.box.top-active.box.top)<=4||
      fullyVisible&&clickedView.clamped))active=chosen;
    links.forEach(function(link){if(active&&link===active.link)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(update);}}
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);
  if(window.ResizeObserver)new ResizeObserver(schedule).observe(document.getElementById('main'));
  document.addEventListener('lsxlayout',schedule);
  document.addEventListener('toggle',schedule,true);
  nav.addEventListener('click',function(e){clicked=e.target.closest('a');clickedView=null;schedule();});
  schedule();
})();
