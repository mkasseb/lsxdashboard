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
  var evidence=renderBriefingEvidence._models;
  if(evidence) renderBriefingEvidence(evidence.near,evidence.planning,evidence.hours);
}

function esc(s){return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
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
  var tMin=scLo-2, tMax=scHi+2, rng=Math.max(4,tMax-tMin);
  function X(i){ return padL+slot*(Date.parse(hrs[i].startTime)-windowStart)/3600000; }
  function Y(t){ return curveTop+(baseY-curveTop)*(1-(t-tMin)/rng); }

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

  var svg='<svg class="h24-svg" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="'+hourlyHours+' hour forecast: temperature curve, precipitation chance bars and shaded nights. Hourly details follow the chart.">'
    +'<defs><linearGradient id="h24g" x1="0" y1="0" x2="1" y2="0">'+grad+'</linearGradient>'
    +'<linearGradient id="h24a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+tCol(hi)+'" stop-opacity=".16"/><stop offset="1" stop-color="'+tCol(lo)+'" stop-opacity="0"/></linearGradient></defs>'
    +bands
    +'<line x1="0" y1="'+barBase+'" x2="'+W+'" y2="'+barBase+'" stroke="var(--border)" stroke-width="1"/>'
    +'<path d="'+area+'" fill="url(#h24a)"/>'
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
      +'<span class="muted">'+esc(h.shortForecast||"")+'</span>';
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

/* ============ SKY MAP (NWS radar + GOES satellite + warning polygons) ============ */
var rvMap=null, rvBase=null, rvMarker=null, nwsRadar=null, warnLayer=null, warnCase=null;
var satLayer=null, baseLabels=null;
var NWS_WMS="https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows";
/* 0.9, not the 0.8 it launched with. The 0.8 was tuned when reflectivity sat straight on a dark
   basemap and needed to let the geography through; over the dimmed cloud shield the geography
   comes through the labels pane instead, and the extra tenth is what keeps LIGHT rain — the low,
   translucent end of the ramp — from vanishing into cloud texture. One constant because three
   call sites (the fallback layer, its refresh, and every pooled frame) must agree or a scrub
   would visibly change the weather's weight. */
var RADAR_OPACITY=0.9;
/* NASA GIBS serves GOES-East GeoColor as WMTS in the map's own projection (EPSG:3857), which is
   the whole reason the satellite can be a LAYER now instead of a separate view. The old source \u2014
   NESDIS's `SECTOR/umv/GEOCOLOR/600x600.jpg` \u2014 is a finished picture in a fixed frame: nothing in
   it says where its corners are, and its projection isn't the map's, so it could never be made to
   sit on top of the radar. This is the same imagery, tiled and georeferenced.

   Two details of the endpoint decide the code below:
   \u00b7 The path is {TileMatrix}/{TileRow}/{TileCol} \u2014 i.e. z/y/x, NOT Leaflet's usual z/x/y order.
   \u00b7 Leaving the time segment out ("\u2026/default/GoogleMapsCompatible_Level7/\u2026") resolves to the newest
     frame GIBS has, and it answers `no-store`. Asking for an explicit timestamp is worse on both
     counts: the archive has gaps (a missing 10-minute slot is a hard 404, so a computed "now minus
     latency" guess would blank the layer), and a dated URL is cacheable, which is the opposite of
     what a live panel wants. Undated + no-store means a fresh layer object always fetches current
     pixels with no cache-buster in the URL. */
var GIBS_SAT="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png";
/* GoogleMapsCompatible_Level7 means levels 0\u20137 exist; z8 and beyond answer HTTP 400. maxNativeZoom
   lets Leaflet upscale past that instead of requesting tiles that aren't there and leaving holes.
   Nothing is lost by stopping at 7: ABI GeoColor is 2 km data, and z7 is already finer than that. */
var SAT_MAX_NATIVE=7;
function effectiveLight(){
  // data-theme always holds the resolved theme; the "auto" pref never reaches the DOM
  return document.documentElement.getAttribute("data-theme")==="light";
}
/* CARTO's raster variants now require an API key. OpenFreeMap serves keyless vector styles, so
   split each style at its symbol layers: geometry stays below weather; place and road labels stay
   in labelPane above radar and satellite. The station plot uses the complete style. */
var mapStylePromises={};
function loadMapStyle(theme){
  if(!mapStylePromises[theme]){
    mapStylePromises[theme]=getJSON("https://tiles.openfreemap.org/styles/"+(theme==="light"?"positron":"dark"))
      .catch(function(e){ delete mapStylePromises[theme]; throw e; });
  }
  return mapStylePromises[theme];
}
function mapStylePart(style,part){
  var copy=JSON.parse(JSON.stringify(style));
  /* OpenFreeMap's dark style references circle-11 in three place layers, but that sprite is
     absent from the published sprite sheet. Names still render without the decorative icon. */
  copy.layers.forEach(function(l){
    if(l.layout && JSON.stringify(l.layout["icon-image"]||"").indexOf("circle-11")>=0) delete l.layout["icon-image"];
  });
  if(part!=="all") copy.layers=copy.layers.filter(function(l){
    return part==="labels" ? l.type==="symbol" : l.type!=="symbol";
  });
  if(part==="labels") copy.layers.forEach(function(l){
    if(l.layout && l.layout["text-field"]){
      l.paint=l.paint||{};
      l.paint["text-color"]="#fff";
      l.paint["text-halo-color"]="#152033";
      l.paint["text-halo-width"]=1.5;
    }
  });
  return copy;
}
var mapThemeSeq=0;
function updateRadarBase(){
  if(!rvBase||!baseLabels) return;
  var theme=effectiveLight()?"light":"dark", seq=++mapThemeSeq;
  loadMapStyle(theme).then(function(style){
    if(seq!==mapThemeSeq) return;
    rvBase.getMaplibreMap().setStyle(mapStylePart(style,"base"));
    baseLabels.getMaplibreMap().setStyle(mapStylePart(style,"labels"));
  }).catch(function(e){ console.warn("Basemap theme failed:",e); });
}
/* ---- Is the sky actually drawing? ---------------------------------------
   A tile layer that fails leaves the basemap showing, and a bare basemap under this card is
   exactly what a calm evening looks like. Every other feed on this page fails LOUDLY — the alert
   list says so, the metrics show a dash — but a dead radar renders as "no precipitation", which is
   the one wrong answer a weather dashboard must never give confidently. Nothing was watching:
   `.imgfail` covers only the case where Leaflet itself never loaded.

   Counting is PER LAYER, not per session, and that is the whole trick. A shared counter cannot
   work here because the loop POOLS layers: on a refresh, fourteen frames are already painted and
   silent (their tiles are cached <img>s that re-fire nothing), so a session counter reset each
   cycle would see one new frame's failures against zero fresh successes and cry outage while the
   map was drawing perfectly. Asking the newest layer about its OWN tiles has no such blind spot.

   "Down" is deliberately strict — errors AND not one tile through. Radar tiles 404 at the edges of
   the mosaic all the time, and a key that flickers to red on ordinary noise is worse than no key.
   Panned somewhere the layer requests nothing, both counters stay 0 and nothing is claimed. */
function bindSkyHealth(lyr){
  if(!lyr||lyr._hb) return;
  lyr._hb=1; lyr._ok=0; lyr._err=0;
  lyr.on("tileload", function(){ lyr._ok++;  syncSkyHealth(); });
  lyr.on("tileerror",function(){ lyr._err++; syncSkyHealth(); });
}
function layerDown(lyr){ return !!(lyr && lyr._err>0 && !lyr._ok); }
/* The newest frame is the one the badge is talking about, so it is the one asked. With no frame
   list (capabilities failed, or reflectivity just came back) the fallback layer is what's drawing. */
function radarDown(){
  if(!skyOn.radar) return false;
  return radarFrames.length ? layerDown(radarFrames[radarFrames.length-1].layer) : layerDown(nwsRadar);
}
function satDown(){ return !!skyOn.sat && layerDown(satLayer); }
/* Tile events fire per tile — dozens per pan — and both sinks below rewrite innerHTML. Redraw only
   when the ANSWER changes, not when the evidence does. */
var skyHealth={radar:null, sat:null};
function syncSkyHealth(){
  var r=radarDown(), s=satDown();
  if(r===skyHealth.radar && s===skyHealth.sat) return;
  skyHealth.radar=r; skyHealth.sat=s;
  syncRadarBadge();
  syncSkyMeta();
}
function initRadarMap(style){
  var el=document.getElementById("radar");
  if(typeof L==="undefined"||!L.maplibreGL||!el){
    if(el) el.innerHTML='<div class="imgfail">Map didn\u2019t load. <a href="https://radar.weather.gov/station/KLSX/standard" target="_blank" rel="noopener">Open KLSX radar \u2197</a></div>';
    return;
  }
  rvMap=L.map(el,{zoomControl:true,attributionControl:true,scrollWheelZoom:true,minZoom:4,maxZoom:12}).setView([current.lat,current.lon],7);
  rvMap.attributionControl.setPrefix(false);
  /* Reflectivity gets its own pane purely for STACKING (visibility is handled by adding and
     removing the layers \u2014 see detachRadarLayers). It sits above the tiles at 200 and below the
     overlays at 400, which is exactly where it belongs visually: on the clouds, under the warning
     polygons. A pane rather than another zIndex on each layer, because the loop creates ~10 of
     them at runtime and they would all have to agree with whatever the satellite is using.
     Warnings deliberately do NOT toggle with reflectivity \u2014 someone who turns it off to look at
     the cloud shield still needs to see where the warning is. */
  rvMap.createPane("radarPane").style.zIndex=350;
  /* The satellite gets a pane of its own for a different reason than the radar did: not stacking
     order (a zIndex on the layer handled that for years) but so CSS can reach the IMAGERY alone.
     The sat-dim filter — see the rule on #radar.sat-dim — must darken the cloud tops without
     touching the place names. 250 keeps the imagery above the basemap tiles (200) and under
     reflectivity (350). The LABELS go above the reflectivity too — 375, under the overlays at 400
     — because a name legible only in clear air answers no question anyone asks a radar: "is that
     cell over Springfield" is exactly the moment the name must survive. Warning polygons still
     out-rank the labels; a label the storm can't bury, a box nothing can. */
  rvMap.createPane("satPane").style.zIndex=250;
  rvMap.createPane("labelPane").style.zIndex=375;
  rvBase=L.maplibreGL({style:mapStylePart(style,"base"),attributionControl:false,
    /* Only the BASEMAP is credited here. The NOAA and NASA lines used to ride along, and on a
       375px phone the four of them wrapped to three lines — 46px over a 236px map, a fifth of the
       picture, sitting on top of southern Missouri. They were never load-bearing: #rsCap under the
       map names every source that is drawing, and the footer links all of them. Basemap credits stay
       on the map itself; NOAA imagery is public domain and NASA
       GIBS asks for acknowledgement, which the caption gives. Every source is still credited on
       the page — the credits just stopped being drawn over the weather. */
    pane:"tilePane"}).addTo(rvMap);
  rvMap.attributionControl.addAttribution('&copy; <a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  satLayer=L.tileLayer(GIBS_SAT,{maxZoom:12,maxNativeZoom:SAT_MAX_NATIVE,pane:"satPane"});
  bindSkyHealth(satLayer);
  /* Added unconditionally, not tied to the satellite the way it used to be: the nolabels basemap
     carries no names of its own, so this layer is the map's ONLY geography text now and every
     combination of toggles needs it. */
  baseLabels=L.maplibreGL({style:mapStylePart(style,"labels"),pane:"labelPane",attributionControl:false}).addTo(rvMap);
  /* Added straight away, not left for the catch in refreshRadarLayer(): the capabilities fetch
     takes a moment, and this paints reflectivity NOW rather than showing an empty map until the
     frame list resolves. The success path removes it once the pooled frames can drive.
     Constructed either way, added only if reflectivity is on — addTo() starts fetching tiles the
     moment it runs, and a visitor who left the layer off last time should not pay for a sweep the
     next line would immediately take away again. */
  nwsRadar=L.tileLayer.wms(NWS_WMS,{
    layers:"conus_bref_qcd",format:"image/png",transparent:true,opacity:RADAR_OPACITY,version:"1.3.0",
    pane:"radarPane"
  });
  bindSkyHealth(nwsRadar);
  if(skyOn.radar) nwsRadar.addTo(rvMap);
  /* A divIcon rather than a circleMarker so the mark can be MORE than a disc — the .me-pin CSS
     owns its look (halo, pulse) for the reasons given there. markerPane sits at 600, over the
     warning polygons: being findable inside a warning is the moment the pin earns its keep. */
  rvMarker=L.marker([current.lat,current.lon],{
    icon:L.divIcon({className:"me-pin",iconSize:[16,16],iconAnchor:[8,8]}),
    interactive:false,keyboard:false
  }).addTo(rvMap);
  applySkyLayers(true);
  setTimeout(function(){ if(rvMap) rvMap.invalidateSize(); },250);
  /* The radar now stretches to whatever height the hero column ends up at, and that height moves
     as feeds land — not only on window resize, which is the only thing Leaflet watches by itself.
     Without this the map keeps its first-measured size and renders into a stale viewport. */
  if(window.ResizeObserver){
    var rvRO=new ResizeObserver(function(){ if(rvMap) rvMap.invalidateSize(false); });
    rvRO.observe(el);
  }
  /* zoomend, not zoomstart: the target zoom is only settled once the animation lands, and the
     budget is a function of it. The surplus layers come off a beat after the gesture rather than
     before it, which costs one round of tiles on the way out and saves every pan afterwards. */
  rvMap.on("zoomend",rebuildRadarFramesForView);
  initRadarCtl();
  refreshRadarLayer();
  loadWarnPolygons(undefined);  // draw from cache if alerts already arrived
  drawMcdPolygons();            // same deal for any mesoscale discussion that beat the map here
  drawWatchPolygons();          // …and any watch fills
}
/* ---- RADAR LOOP ----------------------------------------------------------
   The WMS advertises ~2 h of past sweeps in its time dimension, and honours a
   `time` param on GetMap, so a loop is just N stacked layers we cross-fade by
   opacity. Frames are POOLED by timestamp: a refresh reuses the layers it already
   has and only fetches the genuinely new sweep, instead of re-downloading the set.
   If the capabilities fetch fails we fall back to the plain "latest" layer. */
/* How much history the loop should COVER, and separately how many frames we will spend covering
   it. Two numbers, because the cadence is not ours to choose: NWS publishes conus_bref_qcd every
   ~2 minutes today, and "the last N sweeps" silently means whatever that cadence happens to be.
   Ten sweeps read as a 30-minute loop in the button's tooltip and measured 18 (10 on a phone,
   at six) — long enough to prove a storm exists, far too short to show where it is going, which
   is the only question a loop answers. An hour is the useful unit and 60 fits comfortably inside
   the ~118 minutes the time dimension advertises. Thinning to fit keeps the number honest if NWS
   ever changes the cadence again; nothing downstream hard-codes a duration. */
var RADAR_SPAN_MIN=60;
/* The third budget is about ZOOM, not screen size, and it is the one that was missing. Every pooled
   frame refetches on a view change, and at low zoom each GetMap covers far more ground — measured
   against the live WMS, a median 5.9s per tile at z4 (p95 10.1s) against 120 requests for fifteen
   frames, ~8 seconds before the set was whole again. The loop meanwhile kept stepping on its 450ms
   timer onto frames whose tiles had not arrived, which paints nothing and reads as "the loop
   broke". Detail is not what a z4 view is for anyway: seven frames still show an hour of motion at
   synoptic scale, for roughly half the requests. */
var RADAR_N_DESK=15, RADAR_N_PHONE=8, RADAR_N_WIDE=7, RADAR_WIDE_ZOOM=5;
var radarFrames=[], radarPool={}, radarIdx=-1, radarBuildGen=0;
var radarPlaying=false, radarTimer=null, radarUserPaused=false;
function radarFrameCount(){
  if(rvMap && rvMap.getZoom()<=RADAR_WIDE_ZOOM) return RADAR_N_WIDE;
  return (window.innerWidth<=680)?RADAR_N_PHONE:RADAR_N_DESK;
}
/* The frame list is rebuilt on zoom, not only on the 4-minute refresh. A zoom-dependent budget that
   waited for the next refresh would leave fifteen layers refetching across a continent-wide view
   for up to four minutes — precisely the stampede the budget exists to prevent. Cached times rather
   than a fresh capabilities fetch: this fires on a gesture, and the sweep list has not changed. */
var radarTimesCache=[];
function rebuildRadarFramesForView(){
  if(!rvMap||!skyOn.radar||!radarTimesCache.length) return;
  // Same budget as last time means pickRadarTimes returns the same set; touching the pool would
  // tear down layers only to rebuild them identically.
  if(pickRadarTimes(radarTimesCache).length===radarFrames.length) return;
  var wasLatest=(radarIdx<0)||(radarIdx>=radarFrames.length-1);
  buildRadarFrames(radarTimesCache);   // drops the surplus layers off the map along the way
  showRadarFrame(wasLatest?radarFrames.length-1:Math.min(radarIdx,radarFrames.length-1));
  updateRadarCtl();
}
/* Thin an hour of 2-minute sweeps down to a frame budget, on a grid anchored to the EPOCH.
   The epoch anchoring is the load-bearing part and it is not obvious. radarPool keys on the
   timestamp string, so pooling only pays off if a refresh asks for the same timestamps it asked
   for last time. Striding backwards from "now" — the obvious implementation — fails exactly that
   test: two fresh sweeps land, every stride lands two slots earlier, and all fifteen frames miss
   the pool and re-download. Against a fixed grid the same wall-clock instants keep resolving to
   the same sweeps, so a refresh costs the one genuinely new frame, which is what the pool was
   built to do. Snapping is bounded to half a step so a gap in the archive drops a frame rather
   than silently substituting a sweep from the wrong end of the window. */
function pickRadarTimes(times){
  var n=radarFrameCount();
  if(times.length<=n) return times.slice();
  var ms=times.map(function(t){ return +new Date(t); });
  var newest=ms[ms.length-1], oldest=newest-RADAR_SPAN_MIN*60000;
  var step=Math.max(1,Math.round(RADAR_SPAN_MIN/(n-1)))*60000, half=step/2;
  var want=[], seen={};
  for(var g=Math.floor(newest/step)*step; g>=oldest && want.length<n-1; g-=step){
    var best=-1, bd=half;
    for(var i=0;i<ms.length;i++){
      var d=Math.abs(ms[i]-g);
      if(d<=bd){ bd=d; best=i; }
    }
    // The newest sweep is appended below no matter what; picking it here too would spend a slot.
    if(best>=0 && ms[best]!==newest && !seen[times[best]]){ seen[times[best]]=1; want.push(times[best]); }
  }
  want.push(times[times.length-1]);   // "now" is always present and always last — the scrubber's right edge is it
  want.sort(function(a,b){ return new Date(a)-new Date(b); });
  return want;
}
/* What the frame list actually spans, in minutes. Every duration shown to a visitor is derived
   from this rather than asserted, which is the fix for a tooltip that spent two years describing
   a loop the page was not building. */
function radarSpanMin(){
  if(radarFrames.length<2) return 0;
  return Math.round((new Date(radarFrames[radarFrames.length-1].time)-new Date(radarFrames[0].time))/60000);
}
function fetchRadarTimes(){
  return getText(NWS_WMS+"?service=WMS&version=1.3.0&request=GetCapabilities")
    .then(function(xml){
      var m=xml.match(/<Dimension[^>]*name="time"[^>]*>([\s\S]*?)<\/Dimension>/i);
      if(!m) throw new Error("no time dimension");
      var list=m[1].split(",").map(function(s){return s.trim();}).filter(function(s){return /^\d{4}-\d\d-\d\d/.test(s);});
      if(!list.length) throw new Error("empty time list");
      return list;
    });
}
/* Add the newest sweep first, then admit at most two historical frames at a time. A cold load used
   to add every selected WMS layer in one synchronous loop: fifteen layers times the visible tile
   grid could occupy the host connection pool before the rest of the dashboard had painted. The
   pool still owns every selected timestamp immediately, but its network work is staged. */
function preloadRadarFrames(layers,gen){
  var q=(layers||[]).filter(function(lyr){ return !rvMap.hasLayer(lyr); }).reverse();
  if(!q.length||gen!==radarBuildGen) return;
  function add(lyr,done){
    if(gen!==radarBuildGen||!skyOn.radar){ done(); return; }
    if(rvMap.hasLayer(lyr)){ done(); return; }
    var released=false, timer=null;
    function release(){
      if(released) return; released=true;
      if(timer) clearTimeout(timer);
      lyr.off("load",release);
      updateRadarCtl();
      done();
    }
    lyr.once("load",release);
    timer=setTimeout(release,9000);   // one broken layer cannot stop the queue forever
    lyr.addTo(rvMap);
  }
  function pump(){
    if(gen!==radarBuildGen||!skyOn.radar||!q.length) return;
    add(q.shift(),pump);
  }
  // The current picture goes first. Historical preloads start only after it settles.
  add(q.shift(),function(){ pump(); pump(); });
}
function buildRadarFrames(times){
  var gen=++radarBuildGen;
  var want=pickRadarTimes(times), keep={};
  radarFrames=want.map(function(t){
    keep[t]=1;
    var lyr=radarPool[t];
    if(!lyr){
      lyr=L.tileLayer.wms(NWS_WMS,{layers:"conus_bref_qcd",format:"image/png",transparent:true,
        version:"1.3.0",time:t,opacity:0,pane:"radarPane"});
      lyr.on("load",function(){ lyr._ready=1; updateRadarCtl(); });
      bindSkyHealth(lyr);
      radarPool[t]=lyr;
    }
    return {time:t, layer:lyr};
  });
  Object.keys(radarPool).forEach(function(t){   // release sweeps that aged out of the window
    if(!keep[t]){ if(rvMap.hasLayer(radarPool[t])) rvMap.removeLayer(radarPool[t]); delete radarPool[t]; }
  });
  preloadRadarFrames(radarFrames.map(function(f){ return f.layer; }),gen);
  syncSkyHealth(); // The newest layer is new evidence, even if the previous layer was down.
}
/* A sweep this old is not "now" no matter what the clock face says. Three missed cycles: the
   scheduler re-reads the time dimension every 4 minutes, so anything past ~15 means the feed has
   genuinely stalled rather than that one refresh was unlucky. */
var RADAR_STALE_MIN=15;
var radarFallback=false;   // capabilities failed; the plain "latest" layer is carrying the card
/* One owner for the badge. It used to be written from two places that knew different things —
   showRadarFrame() had the timestamp, the catch in refreshRadarLayer() had the failure — and
   neither could say the thing that actually matters, which is whether what you are looking at is
   current. Everything it needs is module state, so every caller just says "re-decide". */
function syncRadarBadge(){
  var lbl=document.getElementById("radarTime");
  if(!lbl) return;
  lbl.className="radar-time";
  if(!rvMap){lbl.textContent=typeof mapBoot!=="undefined"&&mapBoot.phase==="error"?"map unavailable":"loading map…";return;}
  if(!skyOn.radar){ lbl.textContent=""; return; }
  if(radarDown()){ lbl.textContent="radar unavailable"; lbl.classList.add("down"); return; }
  if(!radarFrames.length){
    // No frame list, but the fallback layer is painting: say it is live without inventing a time.
    lbl.textContent=radarFallback?"latest sweep":"";
    return;
  }
  var i=Math.max(0,Math.min(radarFrames.length-1,radarIdx));
  var t=new Date(radarFrames[i].time), latest=(i===radarFrames.length-1);
  var hhmm=t.toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric",minute:"2-digit"});
  var age=Math.round((Date.now()-new Date(radarFrames[radarFrames.length-1].time))/60000);
  if(latest && age>=RADAR_STALE_MIN){
    // The dangerous case: a real sweep, drawn correctly, quietly an hour out of date.
    lbl.textContent="sweep "+hhmm+" · "+age+" min old";
    lbl.classList.add("down");
    return;
  }
  lbl.textContent=(latest?"sweep ":"")+hhmm;
  if(!latest) lbl.classList.add("past");
}
function showRadarFrame(i){
  if(!radarFrames.length) return;
  i=Math.max(0,Math.min(radarFrames.length-1,i));
  radarIdx=i;
  radarFrames.forEach(function(f,k){ f.layer.setOpacity(k===i?RADAR_OPACITY:0); });
  var t=new Date(radarFrames[i].time), latest=(i===radarFrames.length-1);
  syncRadarBadge();
  var ft=document.getElementById("radarFrameTime");
  if(ft){
    var mins=Math.round((new Date(radarFrames[radarFrames.length-1].time)-t)/60000);
    ft.textContent=latest?"now":("−"+mins+" min");
  }
  var sl=document.getElementById("radarSlider");
  if(sl && +sl.value!==i) sl.value=i;
  syncSatToRadar();   // the cloud shield follows the moment the radar is showing
}
function radarFramesReady(){
  return radarFrames.length>1 && radarFrames.every(function(f){ return f.layer._ready; });
}
function radarFramesAttached(){
  return !!rvMap && radarFrames.length>1 && radarFrames.every(function(f){ return rvMap.hasLayer(f.layer); });
}
function updateRadarCtl(){
  var ctl=document.getElementById("radarCtl"), sl=document.getElementById("radarSlider");
  if(!ctl||!sl) return;
  if(radarFrames.length>1){
    ctl.classList.add("ready");
    sl.max=radarFrames.length-1;
    if(radarIdx>=0) sl.value=Math.min(radarIdx,radarFrames.length-1);
    sl.disabled=!radarFramesAttached();
  }else{
    ctl.classList.remove("ready");
    sl.disabled=true;
  }
  setRadarBtn();   // the span the button advertises changes with the frame list, so re-derive it here
}
function setRadarBtn(){
  var b=document.getElementById("radarPlay");
  if(!b) return;
  /* The duration comes off the frame list every time rather than from a constant. A screen reader
     gets it too — the tooltip is mouse-only, and "how far back does this go" is not a sighted-user
     question. Before frames land there is no honest number, so it says nothing instead. */
  var span=radarSpanMin(), of=span?(" — last "+span+" minutes"):"";
  b.innerHTML=radarPlaying?ic("pause")+"Pause":ic("play")+"Loop";
  b.disabled=radarFrames.length>1&&!radarFramesAttached();
  b.setAttribute("aria-label",(radarPlaying?"Pause radar loop":"Play radar loop")+of);
  b.title=span?("Play the last "+span+" minutes"):"Play the radar loop";
}
/* "Every frame has its tiles for the CURRENT view", which is a different question from _ready —
   that flag is set by the first load ever and never cleared, so it stays true through a zoom that
   has invalidated every tile behind it. Leaflet's own _loading is the live answer. */
function radarFramesPainted(){
  return radarFrames.length>1 && radarFrames.every(function(f){
    return rvMap.hasLayer(f.layer)&&!f.layer._loading;
  });
}
var radarHoldSince=0, RADAR_HOLD_MAX=9000;
function setRadarLoading(on){
  var el=document.getElementById("radarLoad");
  if(el) el.textContent=on?"loading frames…":"";
}
function radarStep(){
  if(!radarPlaying||!radarFrames.length) return;
  /* A view change makes every pooled frame refetch at once. Advancing through frames whose tiles
     have not landed draws blank sweeps at 450ms apiece, which looks like a broken loop rather than
     a busy one — the bug report that prompted this was exactly that. Hold on the frame that IS
     painted and say why.
     Bounded, though: a frame that never finishes must not freeze the loop for good. Leaflet clears
     _loading on tile ERRORS too, so this should not trigger in practice — it is here because
     "should not" is not a guarantee to hand a control the visitor is watching. */
  if(!radarFramesPainted()){
    if(!radarHoldSince) radarHoldSince=Date.now();
    if(Date.now()-radarHoldSince < RADAR_HOLD_MAX){
      setRadarLoading(true);
      radarTimer=setTimeout(radarStep,400);
      return;
    }
  }
  radarHoldSince=0;
  setRadarLoading(false);
  var next=(radarIdx+1)%radarFrames.length;
  showRadarFrame(next);
  radarTimer=setTimeout(radarStep, next===radarFrames.length-1?1400:450);  // hold on the newest sweep
}
function radarPlayLoop(){
  if(radarPlaying||radarFrames.length<2) return;
  radarPlaying=true; setRadarBtn();
  if(radarIdx>=radarFrames.length-1) showRadarFrame(0);
  radarTimer=setTimeout(radarStep,450);
}
function radarPauseLoop(){
  radarPlaying=false;
  if(radarTimer){ clearTimeout(radarTimer); radarTimer=null; }
  radarHoldSince=0; setRadarLoading(false);   // nothing is waiting on tiles once nothing is stepping
  setRadarBtn();
  /* Playback skipped every sync on purpose; stopping is the moment the visitor started looking, so
     the satellite catches up to wherever they landed. */
  syncSatToRadar();
}
function initRadarCtl(){
  var b=document.getElementById("radarPlay"), sl=document.getElementById("radarSlider");
  if(b) b.addEventListener("click",function(){
    if(radarPlaying){ radarUserPaused=true; radarPauseLoop(); }
    else { radarUserPaused=false; radarPlayLoop(); }
  });
  if(sl) sl.addEventListener("input",function(){
    radarUserPaused=true; radarPauseLoop();     // scrubbing means "I'm driving"
    showRadarFrame(+sl.value);
  });
}
function refreshRadarLayer(){
  if(!rvMap) return ensureMaps();
  if(!skyOn.radar) return;   // layer switched off fetches nothing; applySkyLayers refreshes on the way back
  return fetchRadarTimes().then(function(times){
    var wasLatest=(radarIdx<0)||(radarIdx>=radarFrames.length-1);
    radarFallback=false;
    radarTimesCache=times;   // lets a zoom re-pick the frame set without another capabilities fetch
    buildRadarFrames(times);
    if(nwsRadar&&rvMap.hasLayer(nwsRadar)) rvMap.removeLayer(nwsRadar);   // frames drive from here
    showRadarFrame(wasLatest?radarFrames.length-1:radarIdx);              // don't yank a scrubbing user to "now"
    updateRadarCtl();
  }).catch(function(){
    // No usable time list → behave exactly like the pre-loop dashboard: single latest layer, no fake time
    radarFallback=true;
    if(nwsRadar){
      if(!rvMap.hasLayer(nwsRadar)) nwsRadar.addTo(rvMap);
      nwsRadar.setOpacity(RADAR_OPACITY); nwsRadar.setParams({_t:Date.now()});
    }
    /* This used to blank the badge, which left a live map with nothing on it saying so — and left
       a DEAD map looking identical. syncRadarBadge() distinguishes the two: "latest sweep" while
       the fallback is painting, "radar unavailable" once its tiles start failing. Frames are NOT
       cleared here: one unlucky capabilities fetch should not demolish a loop that is already
       built and still current. If the outage persists the frames simply age, and the staleness
       rule in syncRadarBadge() says so on its own.
       updateRadarCtl() rather than dropping .ready by hand — with frames still standing the
       scrubber is still meaningful, and unconditionally hiding it stranded a working loop. */
    syncRadarBadge();
    updateRadarCtl();
  });
}
/* Weights and fills re-tuned against the bright satellite, not the dark basemap they were born
   on: a shade heavier, a shade fuller, ordered so the deadliest boxes read first. The tornado
   entry alone carries a className — see .warn-tor for what it buys and who it excludes. */
function warnStyle(ev){
  ev=(ev||"").toLowerCase();
  if(ev.indexOf("tornado")>=0)            return {color:"#ff2d55",weight:3,fillColor:"#ff2d55",fillOpacity:.20,className:"warn-tor"};
  if(ev.indexOf("severe thunderstorm")>=0)return {color:"#ffb020",weight:3,fillColor:"#ffb020",fillOpacity:.18};
  if(ev.indexOf("flash flood")>=0)        return {color:"#3ecf8e",weight:3,fillColor:"#3ecf8e",fillOpacity:.18};
  if(ev.indexOf("flood")>=0)              return {color:"#2e8b57",weight:2.5,fillColor:"#2e8b57",fillOpacity:.14};
  if(ev.indexOf("special marine")>=0||ev.indexOf("special weather")>=0) return {color:"#4aa3ff",weight:2.5,fillColor:"#4aa3ff",fillOpacity:.10};
  return {color:"#c17bff",weight:2.5,fillColor:"#c17bff",fillOpacity:.14};
}
var lastWarnFeats=[];
/* One predicate for "this alert is drawn on the radar", shared by the map and by the card's
   "Show on radar" button — so the button can never point at something that isn't there. */
function isMappedAlert(f){
  return !!(f && f.geometry && ((f.properties&&f.properties.event)||"").toLowerCase().indexOf("warning")>=0);
}
function normFeature(f){ return {type:"Feature", geometry:f.geometry, properties:f.properties||{}}; }
function loadWarnPolygons(feats){
  if(feats!==undefined) lastWarnFeats=feats||[];
  if(!rvMap) return;
  var polys=lastWarnFeats.filter(isMappedAlert);
  if(warnLayer){ rvMap.removeLayer(warnLayer); warnLayer=null; }
  if(warnCase){ rvMap.removeLayer(warnCase); warnCase=null; }
  if(!polys.length){ syncWarnKey(); return; }
  // Drawing is best-effort: this runs before the alert LIST renders, so a single malformed
  // geometry must not be able to take down the safety-critical list with it.
  try{
    /* Casing: every warning drawn twice, a dark wide stroke under the coloured one — the road-map
       trick, and the only treatment that keeps a coloured line legible over ANY background. No
       single stroke colour can: over the dark basemap the old lines read fine, over white cloud
       tops the yellow ones all but dissolved. Added first so it stays underneath; not interactive,
       so every tap still lands on the coloured layer that owns the tooltips and card links. */
    warnCase=L.geoJSON({type:"FeatureCollection",features:polys.map(normFeature)},{
      style:{color:"#0b0f16",weight:5.5,opacity:.65,fill:false},
      pane:"overlayPane",interactive:false
    }).addTo(rvMap);
    warnLayer=L.geoJSON({type:"FeatureCollection",features:polys.map(normFeature)},{
      style:function(f){ return warnStyle(f.properties.event); },
      pane:"overlayPane",
      onEachFeature:function(f,layer){
        var ev=(f.properties&&f.properties.event)||"";
        layer.bindTooltip(esc(ev)+" — tap for details",{className:"stn-tip",direction:"top",sticky:true});
        // Which of the event's two possible cards this is — through the same pair of functions the
        // card writes its data-scope with, so the two ends of the link cannot answer differently.
        // This end used to hard-code "here"/"away" and so guessed confidently in the flat mode,
        // where the cards carry no scope at all and the lookup has to fall back to the name.
        var scope=scopeAttr(alertCoversMe(f),zonesResolved());
        layer.on("click",function(e){
          if(e.originalEvent) e.originalEvent.stopPropagation();
          focusAlertCard(ev,scope);
        });
      }
    }).addTo(rvMap);
  }catch(e){
    if(warnCase){ rvMap.removeLayer(warnCase); }   // a casing with no coloured line over it is just a smudge
    warnCase=null; warnLayer=null;
  }
  syncWarnKey();
}
function loadRadar(){  // recenter on location change
  if(!rvMap) return;
  rvMap.setView([current.lat,current.lon], rvMap.getZoom()||7);
  if(rvMarker) rvMarker.setLatLng([current.lat,current.lon]);
}

/* ===== Convective watches on the radar =====
   Watches arrive from api.weather.gov with geometry:null — they're zone-based, which is why the
   warning layer has never had anything to draw for one. The event-driven WWA map service carries
   the same products WITH their county polygons, so the alerts feed stays the one source of truth
   for WHETHER a watch is out (and owns the card a tap jumps to) and the map service only supplies
   the shapes. Convective watches only (TO/SV): a Flash Flood or Winter Storm Watch runs a day or
   more and would shade the whole map for its whole life — the radar is a storm map, and the SPC
   watch box is the thing it was missing. */
var WWA_URL="https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/";
/* The region the radar practically shows at its zoom range. The watch query is envelope-clipped
   so a ten-watch outbreak on the Plains doesn't ship its every county here, and loadMcd uses the
   same box to budget its text fetches; the cost is that panning far outside the CWA runs out of
   watch fills, same as it runs out of relevant warnings. */
var WWA_ENV={xmin:-96.5,ymin:34,xmax:-85,ymax:43};


var watchFeats=[], watchKey="", watchAt=0, watchLayer=null, watchOutline=null;
function isWatchEvent(ev){
  ev=(ev||"").toLowerCase();
  return ev.indexOf("tornado watch")>=0||ev.indexOf("severe thunderstorm watch")>=0;
}
function watchStyle(ev){
  /* radar.weather.gov's colours, so a reader coming from the official map keeps their bearings:
     tornado watch yellow, severe thunderstorm watch pink. The FILL stays stroke-free — the product
     is county-based, and stroking these shapes would draw every internal county line. The outline
     a watch deserves is drawn separately, from watchBoundary()'s dissolve of those same counties,
     so the perimeter can be crisp without the seams. */
  /* .22, up from .16 — yellow at 16% over white cloud tops was close to invisible once the
     satellite joined the stack. The dimmed imagery carries most of the recovery; this carries
     the rest without shading the geography away, which is what the fill-only choice protects. */
  if((ev||"").toLowerCase().indexOf("tornado")>=0) return {stroke:false,fillColor:"#ffe14d",fillOpacity:.22};
  return {stroke:false,fillColor:"#db7093",fillOpacity:.22};
}
// Whether the card's "Show on radar" button has something to frame — the watch analogue of isMappedAlert.
function watchOnRadar(ev){
  return isWatchEvent(ev)&&watchFeats.some(function(f){ return ((f.properties||{}).prod_type||"")===ev; });
}
function loadWatchPolygons(feats){
  var active=(feats||[]).filter(function(f){ return isWatchEvent((f.properties||{}).event); });
  if(!active.length){
    watchFeats=[]; watchKey=""; drawWatchPolygons();   // the all-clear must clear the map too
    return;
  }
  /* Gated on the alert list, throttled on its ids: the alerts poll runs every minute, but a
     watch's shape only changes when the SET of watches does — same ids within 10 minutes means
     the counties on screen are still the counties. */
  var key=active.map(function(f){ return (f.properties&&f.properties.id)||f.id||""; }).sort().join("|");
  if(key===watchKey&&watchFeats.length&&Date.now()-watchAt<10*60000) return;
  // Which watch TYPES the alert list vouches for right now — the service's ingest can lag the
  // feed by minutes, and this is what keeps a just-cancelled Tornado Watch's counties from
  // riding along with a Severe Thunderstorm Watch that really is out.
  var vouched={};
  active.forEach(function(f){ vouched[(f.properties||{}).event]=1; });
  var before=watchEvSet();
  resolveRiskLayers().then(function(){
    return getJSON(WWA_URL+RISK_LAYERS.wwa+"/query?where="+encodeURIComponent("sig='A' AND phenom IN ('TO','SV')")
      +"&geometry="+WWA_ENV.xmin+","+WWA_ENV.ymin+","+WWA_ENV.xmax+","+WWA_ENV.ymax
      +"&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects"
      +"&outFields=prod_type,ends,expiration&returnGeometry=true&geometryPrecision=3&f=geojson");
  }).then(function(fc){
    var now=Date.now();
    watchFeats=((fc&&fc.features)||[]).filter(function(f){
      var p=f.properties||{};
      var end=Date.parse(p.ends||p.expiration||"")||0;
      return f.geometry&&(!end||end>now)     // the service can hold a cancelled watch briefly
        &&vouched[p.prod_type];              // …and only types the live alert list stands behind
    });
    watchKey=key; watchAt=now;
    drawWatchPolygons();
    /* The list renders its "Show on radar" buttons from watchOnRadar(), which was still false
       while these fills were in flight — without this, the first render after a watch is issued
       goes a minute buttonless. One re-render when drawability actually changed closes the
       window, and the id throttle above is what keeps the round trip from ever looping. */
    if(watchEvSet()!==before) loadAlerts();
  }).catch(function(){});   // keep whatever is drawn; the alert LIST is the safety-critical view
}
// The drawable watch types, as a comparable key — order-free so a re-fetch that reshuffles
// records doesn't read as a change.
function watchEvSet(){
  var s={};
  watchFeats.forEach(function(f){ s[(f.properties||{}).prod_type||""]=1; });
  return Object.keys(s).sort().join("|");
}

function drawWatchPolygons(){
  if(!rvMap) return;
  if(watchLayer){ rvMap.removeLayer(watchLayer); watchLayer=null; }
  if(watchOutline){ rvMap.removeLayer(watchOutline); watchOutline=null; }
  if(!watchFeats.length){ syncWarnKey(); return; }
  try{
    watchLayer=L.geoJSON({type:"FeatureCollection",features:watchFeats.map(normFeature)},{
      style:function(f){ return watchStyle((f.properties||{}).prod_type); },
      pane:"overlayPane",
      onEachFeature:function(f,layer){
        var ev=(f.properties&&f.properties.prod_type)||"Watch";
        layer.bindTooltip(esc(ev)+" — tap for details",{className:"stn-tip",direction:"top",sticky:true});
        layer.on("click",function(e){
          if(e.originalEvent) e.originalEvent.stopPropagation();
          /* No scope: the county under the tap doesn't say which of the event's two possible
             cards this is, and findAlertCard's no-scope fallback already prefers the local one. */
          focusAlertCard(ev,null);
        });
      }
    }).addTo(rvMap);
    watchLayer.bringToBack();   // fills under every outline: warnings and MDs both out-rank a watch shade
    /* The perimeter the fill was too shy to show: a thin solid line inside a wide, faint halo of
       its own colour. The halo is what earns the line its legibility over bright cloud — it widens
       the stroke's footprint without adding a second pattern, where the first cut of this (dark
       casing under dashes, the warnings' treatment scaled up) read as hazard tape. The watch stays
       distinguishable from the warnings by everything else: huge where they are small, smooth
       where they are sharp, glowing where they are cased. Lines are not interactive — the county
       fills underneath own the tooltip and the card link, and the key under the map names the
       colour. */
    var byType={};
    watchFeats.forEach(function(f){
      var ev=(f.properties||{}).prod_type||"";
      (byType[ev]=byType[ev]||[]).push(f);
    });
    var parts=[];
    Object.keys(byType).forEach(function(ev){
      var rings=watchBoundary(byType[ev]).map(function(r){ return chaikinRing(r,2); });
      if(!rings.length) return;
      var c=watchStyle(ev).fillColor;
      parts.push(L.polyline(rings,{color:c,weight:10,opacity:.16,pane:"overlayPane",interactive:false}));
      parts.push(L.polyline(rings,{color:c,weight:2,opacity:.9,pane:"overlayPane",interactive:false}));
    });
    if(parts.length) watchOutline=L.layerGroup(parts).addTo(rvMap);
  }catch(e){
    watchLayer=null;
    if(watchOutline){ rvMap.removeLayer(watchOutline); watchOutline=null; }
  }
  syncWarnKey();
}
/* ===== Hazard key =====
   One chip per hazard TYPE the map is drawing right now, written into #rsWarnKey under the
   reflectivity key. Everything about it is derived, nothing asserted: the set comes from the same
   feature lists the two draw functions just painted (gated on their layers actually standing, so
   a failed draw advertises nothing), and each chip's colour comes out of the same style function
   that coloured the shape. Both draw paths call this on every outcome — draw, clear, and failure —
   so the key can neither outlive its shapes nor lag them. */
function syncWarnKey(){
  var el=document.getElementById("rsWarnKey");
  if(!el) return;
  var seen={}, chips=[];
  if(warnLayer) lastWarnFeats.filter(isMappedAlert).forEach(function(f){
    var ev=(f.properties&&f.properties.event)||"";
    if(!ev||seen[ev]) return;
    seen[ev]=1;
    chips.push({ev:ev,c:warnStyle(ev).color});
  });
  if(watchLayer) watchFeats.forEach(function(f){
    var ev=(f.properties||{}).prod_type||"";
    if(!ev||seen[ev]) return;
    seen[ev]=1;
    chips.push({ev:ev,c:watchStyle(ev).fillColor});
  });
  el.innerHTML=chips.map(function(k){
    return '<span class="rw-chip"><i style="background:'+k.c+'"></i>'+esc(k.ev)+'</span>';
  }).join("");
}

/* ===== Two-way linking between the radar polygons and the alert cards =====
   The list groups by event type AND coverage (all "Severe Thunderstorm Warning" segments that
   cover this location share one card; the ones that don't share another), while the map draws one
   polygon per segment — so a card maps to N polygons and every polygon maps back to exactly one
   card. Both directions resolve through the event name PLUS the scope, because the name alone can
   now name two cards; a FOLDED card (several products of one hazard family) lists every name it
   answers to in data-evs, "|"-separated. Scope is a preference rather than a filter: a card is
   better than no card if a coverage test somehow disagrees between the two calls. */
function findAlertCard(ev,scope){
  var cards=document.querySelectorAll("#alerts .alert"), any=null;
  for(var i=0;i<cards.length;i++){
    // data-aid was written HTML-escaped; getAttribute hands it back decoded, so compare raw
    var evs=cards[i].getAttribute("data-evs");
    var named=cards[i].getAttribute("data-aid")===ev || (evs&&evs.split("|").indexOf(ev)>=0);
    if(!named) continue;
    if(!scope||cards[i].getAttribute("data-scope")===scope) return cards[i];
    if(!any) any=cards[i];
  }
  return any;
}
function focusAlertCard(ev,scope){
  var card=findAlertCard(ev,scope);
  if(!card) return;
  var hint=card.querySelector(".ab-head");   // the banner head owns aria-expanded
  if(hint) setOpen(card,hint,true);
  if(card.querySelector(".a2-more")) card.classList.add("areas-all");
  card.classList.remove("flash");
  void card.offsetWidth;                            // restart the animation if it's already running
  card.classList.add("flash");
  try{ card.scrollIntoView({behavior:"smooth", block:"center"}); }catch(e){ card.scrollIntoView(); }
  if(typeof scheduleMasonry==="function") scheduleMasonry();
  setTimeout(function(){ card.classList.remove("flash"); },2200);
}
var flashLayer=null, flashTimer=null;
function showAlertOnRadar(ev,scope){
  if(!rvMap) return;
  var evs=String(ev||"").split("|");   // a folded card sends every product it holds
  /* Scoped to the card that asked. Without this, "Show on radar" on the Severe Thunderstorm Warning
     over this location would fit the map to every severe thunderstorm in the office's area — zooming
     the reader out and away from the one polygon they tapped the button to look at. */
  var feats=lastWarnFeats.filter(function(f){
    if(!isMappedAlert(f) || evs.indexOf((f.properties&&f.properties.event)||"")<0) return false;
    if(!scope) return true;
    return (scope==="here")===!!alertCoversMe(f);
  });
  /* Watches live in their own cache: zone-based products have no geometry in lastWarnFeats, and
     their county fills are what the button should frame. Scope is dropped on purpose — a watch is
     one product, and framing all of it beats framing the LSX slice of it. */
  if(!feats.length) feats=watchFeats.filter(function(f){
    return evs.indexOf((f.properties&&f.properties.prod_type)||"")>=0;
  });
  if(!feats.length) return;
  if(flashTimer){ clearTimeout(flashTimer); flashTimer=null; }
  if(flashLayer){ rvMap.removeLayer(flashLayer); flashLayer=null; }
  try{
    flashLayer=L.geoJSON({type:"FeatureCollection",features:feats.map(normFeature)},{
      style:{color:"#ffffff",weight:4,opacity:.95,fill:false,dashArray:"7 5"},
      interactive:false, pane:"overlayPane"
    }).addTo(rvMap);
    rvMap.fitBounds(flashLayer.getBounds(),{padding:[34,34],maxZoom:10});
  }catch(e){ flashLayer=null; }
  var rc=document.getElementById("radarCard");
  if(rc){ try{ rc.scrollIntoView({behavior:"smooth",block:"center"}); }catch(e2){ rc.scrollIntoView(); } }
  flashTimer=setTimeout(function(){
    if(flashLayer&&rvMap){ rvMap.removeLayer(flashLayer); flashLayer=null; }
  },2800);
}

/* Show the row dates only where the day-name column can actually hold them. Measured, not
   media-queried: the masonry hands this card ~a third of a desktop but the full width of a phone,
   so column width moves the OPPOSITE way from viewport width, and the card's width isn't even
   settled until layoutMasonry has run — which is why that function is the ONE caller, at its end.
   Every path that could change the answer (initial pack, resize, any card repaint the observer
   sees) already funnels through it. All-or-nothing across the widget — seven rows where some have
   dates and some don't reads as a bug, not a compromise. The +2 slack absorbs the 1px
   screen-reader twin, which sits out of flow at the content edge and leaks into scrollWidth.
   The observer pause is load-bearing, same as reorderMasonryDOM's: the masonry observer watches
   class mutations, and an un-paused remove/re-add here would schedule a fresh pack that lands
   right back in this function, rAF after rAF, forever. Hiding the date changes no card's height,
   so the pack has nothing to learn from the toggle and drops nothing by not seeing it. */
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
    +'<div class="v" style="color:'+i.c+'">'+aqiState.val+' <span class="ex-cat">'+i.t+'</span></div>'
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
/* Memoised and awaitable: loadSpc waits for names before querying. A failed metadata lookup
   leaves that service unavailable and is retried on the next scheduled refresh. */
var _riskLayersP=null;
function resolveRiskLayers(){
  if(_riskLayersP) return _riskLayersP;
  _riskLayersP=Promise.all([
  getJSON(SPC_URL+"?f=json").then(function(d){
    var ids={};
    var threats=[{},{}];
    (d.layers||[]).forEach(function(l){
      var m=/^Day\s*([123])\s+Categorical/i.exec(l.name||""); if(m) ids[m[1]]=l.id;
      var t=/^Day\s*([12])\s+Probabilistic\s+(Tornado|Wind|Hail)\s+Outlook$/i.exec(l.name||"");
      if(t&&l.subLayerIds==null) threats[Number(t[1])-1][t[2].toLowerCase()]=l.id;
    });
    if(ids[1]!=null&&ids[2]!=null&&ids[3]!=null){ RISK_LAYERS.spc=[ids[1],ids[2],ids[3]]; RISK_READY.spc=true; }
    SPC_THREAT_LAYERS=threats;
    RISK_READY.threats=threats.every(function(t){return t.tornado!=null&&t.wind!=null&&t.hail!=null;});
  }).catch(function(){}),
  getJSON(ERO_URL+"?f=json").then(function(d){
    var ids={};
    (d.layers||[]).forEach(function(l){ var m=/^Excessive Rainfall Day\s*([123])/i.exec(l.name||""); if(m) ids[m[1]]=l.id; });
    if(ids[1]!=null&&ids[2]!=null&&ids[3]!=null){ RISK_LAYERS.ero=[ids[1],ids[2],ids[3]]; RISK_READY.ero=true; }
  }).catch(function(){}),
  getJSON(FIRE_URL+"?f=json").then(function(d){
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
    var ids={};
    (d.layers||[]).forEach(function(l){ var m=/^Overall_Impact_Day_([12])$/i.exec(l.name||""); if(m) ids[m[1]]=l.id; });
    if(ids[1]!=null&&ids[2]!=null){ RISK_LAYERS.wssi=[ids[1],ids[2]]; RISK_READY.wssi=true; }
  }).catch(function(){}),
  getJSON(MCD_URL+"?f=json").then(function(d){
    (d.layers||[]).forEach(function(l){ if(/Mesoscale Discussion/i.test(l.name||"")) RISK_LAYERS.mcd=l.id; });
  }).catch(function(){}),
  getJSON(WWA_URL+"?f=json").then(function(d){
    (d.layers||[]).forEach(function(l){ if(/^WatchesWarnings$/i.test(l.name||"")) RISK_LAYERS.wwa=l.id; });
  }).catch(function(){})
  ]);
  _riskLayersP.then(function(){ if(!RISK_READY.spc||!RISK_READY.threats||!RISK_READY.ero||!RISK_READY.fire||!RISK_READY.wssi) _riskLayersP=null; });
  return _riskLayersP;
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


/* ============ CLIMATE vs NORMAL (RCC-ACIS, 1991-2020 normals, keyless) ============ */
var ACIS="https://data.rcc-acis.org/";
var climate={normHi:null, normLo:null, fcHi:null, fcLo:null, station:null, stationName:""};
var _climStationCache={};
function acisNum(v){ // ACIS returns "M" (missing), "T" (trace), or a numeric string
  if(v==null) return null;
  if(v==="T") return 0;            // trace precip/snow → treat as ~0
  if(v==="M"||v==="") return null;
  var n=parseFloat(v);
  return isNaN(n)?null:n;
}

function fmtDep(v,unit){
  if(v==null) return '<span class="cn-na">—</span>';
  var s=(v>0?"+":"")+ (unit==="°"?v.toFixed(1):v.toFixed(2)) + unit;
  var cls = Math.abs(v)<(unit==="°"?0.5:0.05) ? "cn-flat"
          : (unit==="°"
              ? (v>0?"cn-warm":"cn-cool")
              : (v>0?"cn-wet":"cn-dry"));
  return '<span class="'+cls+'">'+s+'</span>';
}
function renderVsNormal(){
  var el=document.getElementById("cnToday"); if(!el) return;
  function dep(fc,norm){
    if(fc==null||norm==null) return '';
    var d=fc-norm, s=(d>0?"+":"")+Math.round(d)+"°";
    var cls=Math.abs(d)<1?"cn-flat":(d>0?"cn-warm":"cn-cool");
    return ' <span class="'+cls+'">('+s+')</span>';
  }
  var hiNormal=ctx.normWeek[climate.fcHiDate], loNormal=ctx.normWeek[climate.fcLoDate];
  var normHi=hiNormal?hiNormal.hi:(climate.normDate===climate.fcHiDate?climate.normHi:null);
  var normLo=loNormal?loNormal.lo:(climate.normDate===climate.fcLoDate?climate.normLo:null);
  var hi = climate.fcHi!=null ? '<b>'+climate.fcHi+'°</b>'+dep(climate.fcHi,normHi) : '—';
  var lo = climate.fcLo!=null ? '<b>'+climate.fcLo+'°</b>'+dep(climate.fcLo,normLo) : '—';
  var nh = normHi!=null ? normHi+'°' : 'unavailable for this date';
  var nl = normLo!=null ? normLo+'°' : 'unavailable for this date';
  var hiLbl = "Forecast high"+(climate.fcHiLabel||"");
  el.innerHTML='<div class="cn-trow"><span class="cn-k">'+hiLbl+'</span><span class="cn-v">'+hi+'</span><span class="cn-n">normal '+nh+'</span></div>'
    +'<div class="cn-trow"><span class="cn-k">Forecast low'+(climate.fcLoDate?' ('+weatherTime(calendarDate(climate.fcLoDate),{weekday:"short"})+')':'')+'</span><span class="cn-v">'+lo+'</span><span class="cn-n">normal '+nl+'</span></div>';
}
/* Gap tolerance depends on the statistic, because gaps hurt sums and means differently:
   a SUM of precipitation always loses rain on a missing day (biased low, so be strict), while a
   MEAN temperature over 19 of 25 days is simply a smaller sample (unbiased, so be generous). */
function climGapMax(periodDays,isSum){
  return isSum ? Math.max(2,Math.floor(0.05*periodDays)) : Math.max(3,Math.floor(0.25*periodDays));
}

/* Each departure arrives as [value, missingDays] thanks to add:"mcnt" — return the value with a
   verdict, so the caller can decide between using it, borrowing, or blanking. */
function climCells(row,showSnow,per){
  function plain(x){ return Array.isArray(x)?acisNum(x[x.length-1]):acisNum(x); }
  function grab(x,period,isSum){
    if(!Array.isArray(x)){ var v0=acisNum(x); return {v:v0, ok:v0!=null}; }
    var miss=(x.length>1)?(+x[1]||0):0, v=acisNum(x[0]);
    return {v:v, ok:(v!=null && miss<=climGapMax(period,isSum)), miss:miss};
  }
  return {normHi:plain(row[1]), normLo:plain(row[2]),
          t1:grab(row[3],per.mtd,false), t2:grab(row[4],per.ytd,false),
          p1:grab(row[5],per.mtd,true),  p2:grab(row[6],per.ytd,true),
          sn:showSnow?grab(row[7],per.std,true):{v:null,ok:true}};
}
function climAllOK(c,showSnow){
  return c.t1.ok&&c.t2.ok&&c.p1.ok&&c.p2.ok&&(!showSnow||c.sn.ok);
}


/* ============ CLIMATE CONTEXT — records, rankings, streaks ============
   Five keyless ACIS queries, cached for up to 12 hours as small DERIVED facts (~10 KB)
   rather than raw history:
     1. today and tomorrow across every year of record (two queries) → date-matched records + percentiles
     2. monthly totals across every year          → "already wetter than N of M Julys"
     3. the last two years of dailies             → dry streaks, "warmest since"
     4. normals for the week ahead                → per-day departures in the 7-day detail
   A pre-POR start date (1850) is fine — ACIS pads with "M", which we filter. Everything here
   degrades to silence: a number we can't verify is never shown. */
var CTX_KEY="lsxCtx_v4";
var ctx={ready:false, recHi:null, recLo:null, recPcp:null, doyHi:[], doyLo:[],
         monWet:[], monWarm:[], monMtd:null, monMean:null, monName:"", years:0,
         dry:null, hist:null, normWeek:{}, recStation:""};
/* Minimum samples before a statistic is worth printing. "Warmer than 0 of 11 Jul 24s" carries
   the same visual confidence as "12 of 96" — suppression beats false precision. */
var CTX_MIN_YEARS=30, CTX_MIN_MONTHS=25;
/* ---- deep-record station for daily records & rankings ----
   The nearest station is right for normals and recent stats, but records need DEPTH. A station
   qualifies as deep when its temperature POR starts by 1965 — a legacy record, not a modern
   ASOS whose daterange merely LOOKS long (Mount Vernon spans 1976–2026 with 11 usable years).
   Search wider than the local pick (±1.8°) since legacy stations are sparse. */
var _deepCache={};

var MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
function ctxTodayKey(){ return weatherParts().key; }
function contextRecord(date){
  if(!ctx.ready) return null;
  return ctx.recordsByDate&&ctx.recordsByDate[date] || (ctx.recordDate===date?ctx:null);
}
function ctxNumPairs(rows,col,pickMax){
  // → {best:{v,y}, sorted:[v...]} over one column, ignoring M/T padding
  var vals=[], best=null;
  (rows||[]).forEach(function(r){
    var v=acisNum(r[col]);
    if(v==null||r[col]==="M") return;
    var y=String(r[0]).slice(0,4);
    vals.push(v);
    if(!best || (pickMax?v>best.v:v<best.v)) best={v:v,y:y};   // strict: ties keep the year the record was SET
  });
  vals.sort(function(a,b){return a-b;});
  return {best:best, sorted:vals};
}

/* ---- derived lookups (cheap, recomputed as the forecast changes) ---- */
function ctxRankBelow(sorted,v){
  if(v==null||!sorted||!sorted.length) return null;
  var n=0; for(var i=0;i<sorted.length;i++){ if(sorted[i]<v) n++; }
  return {below:n, total:sorted.length, pct:Math.round(n/sorted.length*100)};
}
function ctxDateAt(i){
  if(!ctx.hist) return null;
  var d=calendarDate(ctx.hist.start);
  d.setUTCDate(d.getUTCDate()+i);
  return d;
}
function ctxSince(kind,v){
  // most recent earlier day that reached v (hot) / dropped to v (cold); null = not in the window
  if(v==null||!ctx.hist) return null;
  var arr=(kind==="hot")?ctx.hist.maxt:ctx.hist.mint;
  for(var i=arr.length-2;i>=0;i--){        // skip today (often incomplete)
    var x=arr[i];
    if(x==null) continue;
    if(kind==="hot"?x>=v:x<=v){
      var d=ctxDateAt(i);
      return {date:d, days:Math.round((weatherDay()-d)/86400000)};
    }
  }
  return {date:null, days:null, beyond:true};
}
function fmtMD(d){ return d?d.toLocaleDateString("en-US", {timeZone:"UTC",month:"short", day:"numeric"}):""; }
/* Same date, with the year. ctxSince() searches two full years back and only reports a gap of 21
   days or more, so "warmest since Aug 27" could mean five weeks ago or twenty months — and a
   reader has no way to tell which, or whether the year was simply left off. The year is not
   decoration on a sentence whose whole point is how long it has been. Always printed, including
   for a date in the current year: a rule with an exception is a rule you have to check. */
function fmtMDY(d){ return d?d.toLocaleDateString("en-US", {timeZone:"UTC",month:"short", day:"numeric", year:"numeric"}):""; }
function shortStn(n){   // "ST LOUIS LAMBERT INTL AIRPORT" → "St Louis Lambert"
  var w=String(n||"").split(/\s+/).filter(function(x){
    return !/^(INTL|INTERNATIONAL|AIRPORT|ARPT|AP|FIELD|FLD|MUNICIPAL|MUNI|RGNL|REGIONAL|OUTLAND|AFB)$/i.test(x);
  });
  return w.slice(0,3).join(" ").replace(/\w\S*/g,function(t){ return t.charAt(0)+t.slice(1).toLowerCase(); });
}
function renderContext(){
  var el=document.getElementById("cnCtx");
  if(!el) return;
  if(!ctx.ready){ el.innerHTML=""; return; }
  var L=[];
  function line(ico,html,cls){ L.push('<div class="cx'+(cls?" "+cls:"")+'"><span class="cxi">'+ic(ico)+'</span><span>'+html+'</span></div>'); }
  var record=contextRecord(climate.fcHiDate)||contextRecord(ctx.recordDate)||ctx;
  var md=fmtMD(record.recordDate?calendarDate(record.recordDate):weatherDay());
  // records for the forecast date — only from a sample that can support the claim; attribute the deep
  // station when it isn't the local one
  var deepOK=record.years>=CTX_MIN_YEARS;
  if(deepOK&&record.recHi&&record.recLo){
    line("record","Record for "+md+": high <b class=\"cx-rec\">"+Math.round(record.recHi.v)+"°</b> ("+record.recHi.y+")"
      +" · low <b class=\"cx-cold\">"+Math.round(record.recLo.v)+"°</b> ("+record.recLo.y+")"
      +' <span class="cx-src">· '+record.years+" years"
      +(ctx.recStation?" · "+esc(shortStn(ctx.recStation)):"")+'</span>');
  }else if(record.years>0&&!deepOK){
    line("info","Stations near here have short records ("+record.years+" yrs) — daily records omitted");
  }
  // where the forecast high would land among its matching calendar dates
  var r=deepOK&&climate.fcHiDate===record.recordDate?ctxRankBelow(record.doyHi,climate.fcHi):null;
  if(r&&climate.fcHi!=null){
    var pos=Math.max(0,Math.min(100,r.pct));
    L.push('<div class="cx cx-rank">'
      +'<div class="cx-row"><span class="cxi">'+ic("stats")+'</span>'
      +'<span>Forecast <b>'+climate.fcHi+'°</b> would rank warmer than <b>'+r.below+'</b> of '+r.total+' '+md+'s on record</span></div>'
      +'<div class="cx-bar"><i style="left:calc('+pos+'% - 1.5px)"></i></div>'
      +'</div>');
  }
  // month-to-date rankings stay LOCAL, so they need the local station to have enough history —
  // "wetter than 4 of 17 full Julys" is noise dressed as signal
  if(ctx.monMtd!=null&&ctx.monWet.length>=CTX_MIN_MONTHS){
    var rw=ctxRankBelow(ctx.monWet,ctx.monMtd);
    line("rain",ctx.monName+" rain <b class=\"cx-wet\">"+ctx.monMtd.toFixed(2)+"″</b> so far — already wetter than <b>"+rw.below+"</b> of "+rw.total+" full "+ctx.monName+"s");
  }
  if(ctx.monMean!=null&&ctx.monWarm.length>=CTX_MIN_MONTHS){
    var rt=ctxRankBelow(ctx.monWarm,ctx.monMean);
    line("heat",ctx.monName+" averaging <b>"+ctx.monMean.toFixed(1)+"°</b> — warmer than <b>"+rt.below+"</b> of "+rt.total+" "+ctx.monName+"s");
  }
  // dry streak
  if(ctx.dry&&ctx.dry.days>=3){
    line("drought","<b class=\"cx-dry\">"+ctx.dry.days+" days</b> since measurable rain (last "+ctx.dry.amt.toFixed(2)+"″ on "+fmtMD(calendarDate(ctx.dry.date))+")");
  }
  // "warmest since" / "coldest since", only when the gap is actually interesting
  if(climate.fcHi!=null){
    var s=ctxSince("hot",climate.fcHi);
    if(s&&s.beyond) line("heat","<b>"+climate.fcHi+"°</b> would be the warmest in at least 2 years");
    else if(s&&s.days>=21) line("heat","<b>"+climate.fcHi+"°</b> would be the warmest since "+fmtMDY(s.date));
  }
  if(climate.fcLo!=null){
    var sc=ctxSince("cold",climate.fcLo);
    if(sc&&sc.beyond) line("cold","<b>"+climate.fcLo+"°</b> would be the coolest in at least 2 years");
    else if(sc&&sc.days>=21) line("cold","<b>"+climate.fcLo+"°</b> would be the coolest since "+fmtMDY(sc.date));
  }
  el.innerHTML=L.join("");
  renderCurrentCtx(); renderVsNormal();
  // per-day normals arrive after the 7-day is already on screen → repaint it once
  if(Object.keys(ctx.normWeek||{}).length && typeof loadForecast==="function" && loadForecast._paint) loadForecast._paint();
  if(typeof renderTheCall==="function") renderTheCall();
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
/* Today's range + sun times, painted into the hero.
   Two feeds have to agree before this can say anything: the observation supplies "now" and the
   7-day supplies today's high/low. Either can land first, so both call this and it renders
   whatever is currently known — the same idempotent-repaint contract renderCurrentCtx uses. */
var heroNow={temp:null};

function renderHeroToday(){
  var el=document.getElementById("ccToday");
  if(!el) return;
  var r=rangeRow((smart.days&&smart.days[0])||null,(smart.days&&smart.days[1])||null,heroNow.temp);
  var out="";
  if(r){
    var lo=r.lo, hi=r.hi, nextDay=r.nextDay;
    var mark=(r.mark==null)?"":'<b style="left:'+(r.mark*100).toFixed(1)+'%"></b>';
    out+='<div class="cc-range">'
      +'<span class="cr-lbl">'+(nextDay?"Tonight":"Today")+'</span>'
      +'<span '+tvAttr(lo,"cr-lo")+'>'+lo+'°</span>'
      +'<span class="cc-track"><i style="background:linear-gradient(90deg,'+tCol(lo)+','+tCol(hi)+')"></i>'+mark+'</span>'
      +'<span '+tvAttr(hi,"cr-hi")+'>'+hi+'°'
        +(nextDay?'<span class="cr-nx">tmrw</span>':'')+'</span>'
      +(r.drop!=null?'<span class="cr-drop">'+r.drop+'° colder</span>':'')
      +'</div>';
  }
  // Sun line: lead with whichever event is still ahead — that's the one worth planning around.
  var st=sunTimes(current.lat,current.lon,new Date()), now=Date.now();
  if(st.rise&&st.set){
    var bits;
    if(now<st.rise.getTime()){
      bits=['<span>'+mcImg("sunrise","sun",18)+'Sunrise <b>'+fmtT(st.rise)+'</b></span>'];
    }else if(now<st.set.getTime()){
      bits=['<span>'+mcImg("sunset","moon",18)+'Sunset <b>'+fmtT(st.set)+'</b></span>',
            '<span class="cs-sep">·</span>',
            '<span><b>'+fmtDur(st.set.getTime()-now)+'</b> of daylight left</span>'];
    }else{
      var tm=sunTimes(current.lat,current.lon,new Date(weatherDay(now).getTime()+86400000));
      bits=['<span>'+mcImg("sunset","moon",18)+'Sun set <b>'+fmtT(st.set)+'</b></span>'];
      if(tm.rise) bits.push('<span class="cs-sep">·</span>',
                            '<span>'+mcImg("sunrise","sun",18)+'Sunrise <b>'+fmtT(tm.rise)+'</b></span>');
    }
    out+='<div class="cc-sun">'+bits.join("")+'</div>';
  }
  // No next-few-hours strip here: the full 24-hour chart now sits in this same card, and two
  // renderings of the same forecast an inch apart is worse than either alone.
  el.innerHTML=out;
}
function renderCurrentCtx(){
  var el=document.getElementById("ccCtx"), src=document.getElementById("ccRecSrc");
  if(!el) return;
  var bits=[], credit="";
  if(climate.normDate===weatherParts().key&&climate.normHi!=null&&climate.normLo!=null)
    bits.push('<span class="cx-pair"><i>Normal</i><b>'+Math.round(climate.normHi)+"°/"+Math.round(climate.normLo)+"°</b></span>");
  if(ctx.recordDate===weatherParts().key&&ctx.years>=CTX_MIN_YEARS){   // records only when the sample can support them
    var r=[];
    if(ctx.recHi) r.push('<b class="rc-hi">'+Math.round(ctx.recHi.v)+'°</b><span class="rc-y">'+ctx.recHi.y+'</span>');
    if(ctx.recLo) r.push('<b class="rc-lo">'+Math.round(ctx.recLo.v)+'°</b><span class="rc-y">'+ctx.recLo.y+'</span>');
    if(r.length) bits.push('<span class="cx-pair"><i>Record</i>'+r.join('<span class="rc-sep"></span>')+'</span>');
    // The credit follows the numbers down to the provenance line, but it still follows them —
    // a figure borrowed from another station stays attributed by name.
    if(ctx.recStation&&r.length) credit=' · <span class="nw">'+esc(shortStn(ctx.recStation))+" records</span>";
  }
  el.innerHTML=bits.join("");
  if(src) src.innerHTML=credit;
}

/* ============ WPC 7-DAY QPF (best-effort chip) ============ */
var QPF_URL="https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer";
var qpfLayerId;   // undefined = not checked yet; null = service has no 7-day layer (a real answer — don't refetch)


/* ============ STATIC IMAGES ============ */
// ===== Station Plot: live surface obs (temp/dew/wind) on a St. Louis-region Leaflet map =====
// Curated regional ASOS/METAR stations around the LSX CWA
/* The regional plot's stations. `n` is each site's name as api.weather.gov gives it (only the
   stray title-case "Of" corrected) — read out of /stations/<id> once and written down here rather
   than fetched, because these fifteen ASOS sites are as fixed as their coordinates are and the
   table already carries those. A four-letter code is the whole identity of a station to somebody
   who knows the network and nothing at all to everybody else; the name is what makes "SAR 75°" a
   place rather than a serial number. */
var STN_LIST=[
  {id:"KSTL",lat:38.75,lon:-90.37,n:"St. Louis Lambert International Airport"},
  {id:"KSUS",lat:38.66,lon:-90.65,n:"St. Louis, Spirit of St. Louis Airport"},
  {id:"KCPS",lat:38.57,lon:-90.16,n:"St. Louis Downtown Airport"},
  {id:"KALN",lat:38.89,lon:-90.05,n:"St. Louis Regional Airport"},
  {id:"KSET",lat:38.93,lon:-90.43,n:"St. Charles, St. Charles County Smartt Airport"},
  {id:"KBLV",lat:38.54,lon:-89.84,n:"Belleville, Scott AFB/MidAmerica Airport"},
  {id:"KUIN",lat:39.94,lon:-91.19,n:"Quincy Regional Airport-Baldwin Field"},
  {id:"KCOU",lat:38.82,lon:-92.22,n:"Columbia, Columbia Regional Airport"},
  {id:"KJEF",lat:38.59,lon:-92.16,n:"Jefferson City, Jefferson City Memorial Airport"},
  {id:"KFAM",lat:37.76,lon:-90.43,n:"Farmington Airport"},
  {id:"KVIH",lat:38.13,lon:-91.76,n:"Rolla / Vichy, Rolla National Airport"},
  {id:"KSAR",lat:38.14,lon:-89.70,n:"Sparta Community-Hunter Field Airport"},
  {id:"KMDH",lat:37.78,lon:-89.25,n:"Southern Illinois Airport"},
  {id:"KPPQ",lat:39.63,lon:-90.78,n:"Pittsfield, Pittsfield Penstone Municipal Airport"},
  {id:"KSLO",lat:38.64,lon:-88.96,n:"Salem, Salem-Leckrone Airport"}
];
/* Whatever we know a station identifier's name to be. Seeded from the table above and topped up by
   stationFor(), which was already fetching the name and dropping it on the floor. A station we
   cannot name simply gets no tooltip — a guess would be worse than the code alone. */
var STN_NAMES={};
STN_LIST.forEach(function(s){ STN_NAMES[s.id]=s.n; });
function stnName(id){ return STN_NAMES[id]||""; }
var stnMap=null, stnBase=null, stnLayer=null;
var stnObs=[], stnMode="temp";
function rhFromTd(tF,tdF){   // Magnus — lets us derive feels-like from what METAR actually reports
  if(tF==null||tdF==null) return null;
  var tC=(tF-32)/1.8, dC=(tdF-32)/1.8;
  var e=Math.exp((17.625*dC)/(243.04+dC)), es=Math.exp((17.625*tC)/(243.04+tC));
  return Math.max(1,Math.min(100,Math.round(100*e/es)));
}
function dewColor(d){
  if(d==null) return "#8a97a8";
  if(d<50) return "#7ec8ff";      // dry
  if(d<60) return "#3ecf8e";      // comfortable
  if(d<65) return "#e0b93a";      // sticky
  if(d<70) return "#ff9f43";      // humid
  return "#ff5a5f";               // oppressive
}
function windColor(m){
  if(m==null) return "#8a97a8";
  if(m<5) return "#8a97a8";
  if(m<12) return "#3ecf8e";
  if(m<20) return "#e0b93a";
  if(m<30) return "#ff9f43";
  return "#ff5a5f";
}
function stnValue(o,mode){
  if(mode==="dew") return o.dewF;
  if(mode==="feels") return o.feelsF;
  if(mode==="wind") return o.windMph;
  return o.tempF;
}
function stnColor(v,mode){
  if(mode==="dew") return dewColor(v);      // dew point and wind are different quantities —
  if(mode==="wind") return windColor(v);    // their own palettes are correct, not duplication
  return tChip(v);                          // temp & feels-like: the shared ramp
}
function stnMarkerHTML(o,mode,isExtreme){
  var v=stnValue(o,mode);
  if(v==null) return null;
  var id=o.id.replace(/^K/,""), col=stnColor(v,mode), inner;
  if(mode==="wind"){
    /* Speed without a direction is a VRB wind, not a calm one — METAR files VRB05KT when the
       direction is wandering, and the API hands that over as speed with a null direction. The
       chip shows the speed arrowless; only a true zero gets to say calm. */
    inner=(v>0)
      ? '<span class="stn2-w">'+(o.windDir!=null?'<span class="stn2-arrow" style="transform:rotate('+((o.windDir+180)%360)+'deg)">↑</span>':'')+v+'</span>'
      : "calm";
  }else{
    inner=v+"°";
  }
  return '<div class="stn2'+(isExtreme?" is-hi":"")+(o.stale?" is-old":"")+'" style="--c:'+col+'">'
    +'<div class="stn2-v">'+inner+'</div><div class="stn2-id">'+esc(id)+'</div></div>';
}
/* Code, then the place, then the readings, then WHEN — stacked lines rather than one run, because
   the name is the part a stranger needs and burying it mid-sentence between "KSTL" and "93° temp"
   would leave it as hard to find as it was to guess. The when-line is the qualifier for everything
   above it, and "stale" is the tooltip's word for a marker the map has already dimmed. */
/* One builder for the readings list, because it now has two readers: the hover/focus tooltip and
   the marker's aria-label. Two copies of "what counts as a reading" would drift the first time
   one of them learned a new field. */
function stnReadings(o){
  var b=[];
  if(o.tempF!=null) b.push(o.tempF+"° temp");
  if(o.feelsF!=null&&o.tempF!=null&&Math.abs(o.feelsF-o.tempF)>=2) b.push("feels "+o.feelsF+"°");
  if(o.dewF!=null) b.push(o.dewF+"° dew");
  if(o.rh!=null) b.push(o.rh+"% RH");
  // A moving wind with no direction is VRB, not calm — the compass part simply goes unsaid.
  if(o.windMph!=null) b.push(o.windMph>0?((o.windDir!=null?degToCompass(o.windDir)+" ":"")+o.windMph+" mph"):"calm");
  if(o.gustMph!=null&&o.gustMph>0) b.push("gusts "+o.gustMph);
  return b;
}
function stnAria(o){
  var nm=stnName(o.id);
  return o.id+(nm?", "+nm:"")+": "+stnReadings(o).join(", ")
    +(o.ts?", observed "+timeAgo(o.ts)+(o.stale?" (stale)":""):"");
}
function stnTip(o){
  var nm=stnName(o.id), b=stnReadings(o);
  return '<b>'+esc(o.id)+'</b>'
    +(nm?'<span class="stn-nm">'+esc(nm)+'</span>':'')
    +(b.length?'<span class="stn-rd">'+b.join(" · ")+'</span>':'')
    +(o.ts?'<span class="stn-when">'+(o.stale?"stale · ":"")+"observed "+timeAgo(o.ts)+'</span>':'');
}
function renderStnExtremes(){
  var el=document.getElementById("stnEx"); if(!el) return;
  // Stale obs plot (dimmed) but don't compete: "Warmest" from a three-hour-old reading is a
  // record of when the station broke, not of where it is hottest now.
  var list=stnObs.filter(function(o){ return o&&!o.stale&&stnValue(o,stnMode)!=null; });
  if(!list.length){ el.innerHTML=""; return; }
  function best(dir){
    var b=null;
    list.forEach(function(o){
      var v=stnValue(o,stnMode);
      if(!b||(dir>0?v>stnValue(b,stnMode):v<stnValue(b,stnMode))) b=o;
    });
    return b;
  }
  var hi=best(1), lo=best(-1), chips=[], unit=(stnMode==="wind")?" mph":"°";
  function chip(lbl,o){ if(o) chips.push('<span class="sx"><b>'+lbl+'</b> '+esc(o.id.replace(/^K/,""))+" "+stnValue(o,stnMode)+unit+'</span>'); }
  if(stnMode==="wind"){
    /* Only the windy end is a story here, so only hi competes for the marker ring — lo used to
       ride along into stnExtremeIds and put a ring on the calmest station that no chip ever
       explained. And "Windiest SUS 0 mph" on a still evening is the superlative outliving the
       thing it measures: a max of zero means calm IS the regional fact, so one chip says that. */
    lo=null;
    if(hi&&stnValue(hi,stnMode)===0){ hi=null; chips.push('<span class="sx">all stations calm</span>'); }
    chip("Windiest",hi);
    var g=null; stnObs.forEach(function(o){ if(o&&!o.stale&&o.gustMph!=null&&(!g||o.gustMph>g.gustMph)) g=o; });
    if(g&&g.gustMph>0) chips.push('<span class="sx"><b>Top gust</b> '+esc(g.id.replace(/^K/,""))+" "+g.gustMph+' mph</span>');
  }else if(stnMode==="dew"){
    chip("Muggiest",hi); chip("Driest",lo);
  }else{
    // "Warmest" is a claim about air temperature, and in Feels mode that isn't what's ranked.
    var fl=(stnMode==="feels");
    chip(fl?"Feels hottest":"Warmest",hi); chip(fl?"Feels coolest":"Coolest",lo);
    var spread=stnValue(hi,stnMode)-stnValue(lo,stnMode);
    if(spread>0) chips.push('<span class="sx"><b>Spread</b> '+spread+'°</span>');
  }
  var staleN=0; stnObs.forEach(function(o){ if(o&&o.stale) staleN++; });
  chips.push('<span class="sx sx-n">'+list.length+' stations'+(staleN?' · '+staleN+' stale':'')+'</span>');
  el.innerHTML=chips.join("");
  stnExtremeIds=[hi&&hi.id, lo&&lo.id];
}
var stnExtremeIds=[];
function renderStationLayer(){
  if(!stnMap||typeof L==="undefined") return;
  renderStnExtremes();                                  // sets stnExtremeIds, so markers can highlight them
  if(stnLayer){ stnMap.removeLayer(stnLayer); stnLayer=null; }
  var pairs=[];
  stnObs.forEach(function(o){
    if(!o) return;
    var html=stnMarkerHTML(o,stnMode,stnExtremeIds.indexOf(o.id)>=0);
    if(!html) return;
    var m=L.marker([o.lat,o.lon],{
      icon:L.divIcon({className:"stn-divicon",html:html,iconSize:[0,0],iconAnchor:[0,0]}),
      keyboard:true, riseOnHover:true
    });
    m.bindTooltip(stnTip(o),{className:"stn-tip",direction:"top",offset:[0,-16],sticky:false});
    pairs.push({m:m,o:o});
  });
  stnLayer=L.layerGroup(pairs.map(function(p){ return p.m; })).addTo(stnMap);
  /* keyboard:true above makes the chips tabbable, but that is only half a keyboard path —
     Leaflet 1.9's focus-opens-the-tooltip accessibility never fires for divIcon markers
     (verified against 1.9.4), so Tab landed on a chip and learned nothing. The two halves are
     wired by hand: the tooltip for eyes on focus, and an aria-label carrying the same facts for
     a screen reader, which won't reliably read a floating tooltip it isn't described by. This
     runs after addTo() because getElement() has nothing to return before the icon exists.
     The focus ring is CSS's problem: see .stn-divicon:focus-visible. */
  pairs.forEach(function(p){
    var el=p.m.getElement&&p.m.getElement(); if(!el) return;
    el.setAttribute("role","img");
    el.setAttribute("aria-label",stnAria(p.o));
    el.addEventListener("focus",function(){ p.m.openTooltip(); });
    el.addEventListener("blur",function(){ p.m.closeTooltip(); });
  });
}
function initStnTools(){
  var t=document.getElementById("stnTools"); if(!t) return;
  t.addEventListener("click",function(e){
    var b=e.target.closest("button[data-m]"); if(!b) return;
    stnMode=b.getAttribute("data-m");
    [].forEach.call(t.querySelectorAll("button"),function(x){ x.classList.toggle("on",x===b); });
    renderStationLayer();
  });
}
function initStationMap(style){
  var el=document.getElementById("stnmap");
  if(typeof L==="undefined"||!L.maplibreGL||!el){
    if(el) el.innerHTML='<div class="imgfail">Map didn\u2019t load. <a href="https://www.weather.gov/wrh/timeseries?site=KSTL" target="_blank" rel="noopener">Open NWS obs \u2197</a></div>';
    return;
  }
  // Frame the station network itself (not the user's saved location, which may be far away).
  // fitBounds rather than a fixed zoom: the card's width changes with the masonry, and a fixed
  // zoom clipped the outer stations off the edges.
  var _cLat=0,_cLon=0; STN_LIST.forEach(function(s){_cLat+=s.lat;_cLon+=s.lon;}); _cLat/=STN_LIST.length; _cLon/=STN_LIST.length;
  stnMap=L.map(el,{zoomControl:true,attributionControl:true,scrollWheelZoom:false,minZoom:5,maxZoom:10}).setView([_cLat,_cLon],7);
  stnMap.attributionControl.setPrefix(false);
  var stnBounds=L.latLngBounds(STN_LIST.map(function(s){ return [s.lat,s.lon]; }));
  function fitStations(){ if(stnMap) stnMap.fitBounds(stnBounds,{padding:[30,26]}); }
  fitStations();
  stnBase=L.maplibreGL({style:mapStylePart(style,"all"),attributionControl:false}).addTo(stnMap);
  stnMap.attributionControl.addAttribution('&copy; <a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  setTimeout(function(){ if(stnMap){ stnMap.invalidateSize(); fitStations(); } },250);
  setTimeout(function(){ if(stnMap){ stnMap.invalidateSize(); fitStations(); } },1200);  // after masonry settles the card width
  initStnTools();
  // no loadStationPlot() here — refreshAll() runs right after init and fetches the obs once
}
var stationThemeSeq=0;
function updateStationBase(){
  if(!stnBase) return;
  var theme=effectiveLight()?"light":"dark", seq=++stationThemeSeq;
  loadMapStyle(theme).then(function(style){
    if(seq===stationThemeSeq) stnBase.getMaplibreMap().setStyle(mapStylePart(style,"all"));
  }).catch(function(e){ console.warn("Station basemap theme failed:",e); });
}
/* Staleness cutoffs. /observations/latest never admits how old "latest" is — a wedged ASOS keeps
   serving its final report, and it plotted here with the same standing as a five-minute-old ob,
   eligible to win "Warmest". Two hours (a missed hourly cycle, plus slack for the specials-only
   quiet stretches) demotes an ob to stale: still drawn, but dimmed and barred from the extremes.
   Six hours removes it — by then the number is trivia about the station, not weather. */
var STN_STALE_MS=2*60*60000, STN_DEAD_MS=6*60*60000;
/* Last good ob per station. api.weather.gov throws intermittent 5xx, and catch→null traded a
   ten-minute-old reading for a hole in the map until the next 12-minute cycle. A failed fetch
   now falls back to this cache; the cutoffs above are what keep the fallback honest — a cached
   ob ages into stale and then off the map exactly like a served one. */
var _stnLast={};

/* ---- Sky layer toggles ----
   Radar and satellite stack on one map now, and each button is an independent on/off. They were
   TABS, which is the right control for two views that cannot coexist and the wrong one the moment
   they can: a tablist tells a screen reader "pick exactly one of these", which stopped being true
   when the satellite became a layer. Two <button aria-pressed> say what is actually on offer.
   Both on is the default and the whole point of the card.

   A switched-off layer leaves the map rather than merely hiding, so it costs nothing: no tiles,
   and for the radar no capabilities fetch either. Reflectivity is the exception in HOW it hides —
   the loop keeps ~10 pooled frames alive and drives them by opacity, so giving opacity a second
   meaning (off vs. not-the-current-frame) would have the layer reappear on the next sweep. It is
   torn down instead — see detachRadarLayers().

   Hiding is NOT enough for either layer, which is worth stating because the first cut of this got
   it wrong: a Leaflet layer that is merely invisible is still on the map, and GridLayer requests
   tiles for the current view on every moveend regardless of whether anything can see them. With
   the radar pane set to display:none, one pan across the state still pulled ~90 reflectivity
   tiles. Off has to mean off the map. */
var skyOn={radar:true, sat:true};
var SKY_KEY="lsxSky_v1";
try{
  var _sk=JSON.parse(localStorage.getItem(SKY_KEY)||"null");
  /* Both-off is a legal thing to click your way into but a broken thing to LAND on: the card would
     restore as a bare basemap with nothing on screen explaining why. Persist it, don't restore it. */
  if(_sk&&(_sk.radar||_sk.sat)){ skyOn.radar=!!_sk.radar; skyOn.sat=!!_sk.sat; }
}catch(e){}

/* The caption names what is actually drawn, so it can never promise a satellite that is switched
   off. The ↗ link follows the same rule; radar wins when both are on, because the loop and the
   warning polygons are its. */
function syncSkyMeta(){
  var lk=document.getElementById("rsLink");
  if(lk) lk.innerHTML = skyOn.radar
    ? '<a href="https://radar.weather.gov/station/KLSX/standard" target="_blank" rel="noopener">Official KLSX ↗</a>'
    : '<a href="https://www.star.nesdis.noaa.gov/GOES/sector.php?sat=G19&amp;sector=umv" target="_blank" rel="noopener">GOES loop ↗</a>';
  var bits=[];
  /* "Names what is actually drawn" has to survive a layer that is switched ON and failing, or the
     caption goes from honest to actively misleading — crediting NOAA for reflectivity nobody
     received. A down layer says so where it used to advertise itself. */
  if(skyOn.radar) bits.push(radarDown()
    ? '<b>Radar unavailable</b> — NOAA is not serving reflectivity right now'
    : 'Official NOAA/NWS radar &middot; tap a <b>warning or watch</b> to jump to its alert');
  /* A pinned satellite says WHICH moment it is showing. Left as the plain credit it would quietly
     claim to be current while displaying an hour-old cloud shield — the same lie the radar badge's
     stale state exists to prevent, arriving through the other layer. */
  if(skyOn.sat) bits.push(satDown()
    ? '<b>Satellite unavailable</b> — no GOES imagery from NASA GIBS right now'
    : (satPinned
        ? 'GOES-19 GeoColor at <b>'+esc(satClock(satPinned))+'</b>, following the radar'
        : 'GOES-19 GeoColor via NASA GIBS'));
  if(!bits.length) bits.push('Both layers are off — the buttons above bring them back');
  bits.push('OpenFreeMap basemap');
  var note=skyOn.radar?'radar every ~4 min':(skyOn.sat?'satellite every ~10 min':'');
  var cap=document.getElementById("rsCap");
  if(cap) cap.innerHTML='<span>'+bits.join(' &middot; ')+'</span><span>'+note+'</span>';
  /* The key belongs to reflectivity, so it lives and dies with it — and it goes away when the
     layer is down too, because a guide to colours the map is not painting is just clutter. */
  var lg=document.getElementById("rsLegend");
  if(lg) lg.classList.toggle("on", !!rvMap && !!skyOn.radar && !radarDown());
  [].slice.call(document.querySelectorAll("#rsTabs .rs-tab")).forEach(function(b){
    var on=!!skyOn[b.getAttribute("data-l")];
    b.disabled=!rvMap;
    b.classList.toggle("on",on&&!!rvMap);
    b.setAttribute("aria-pressed",on?"true":"false");
  });
}
/* Take reflectivity off the map completely: the fallback layer, every pooled sweep, and the loop
   state that indexes them. The pool is CLEARED rather than parked, because buildRadarFrames() only
   calls addTo() for timestamps it hasn't seen — a pool full of detached layers would be reused on
   the way back and draw nothing. Rebuilding costs one capabilities fetch, and the sweeps would be
   stale by then anyway. */
function detachRadarLayers(){
  radarBuildGen++;   // cancel any staged historical-frame queue before it adds another layer
  radarPauseLoop();
  if(!rvMap) return;
  if(nwsRadar&&rvMap.hasLayer(nwsRadar)) rvMap.removeLayer(nwsRadar);
  Object.keys(radarPool).forEach(function(t){
    if(rvMap.hasLayer(radarPool[t])) rvMap.removeLayer(radarPool[t]);
    delete radarPool[t];
  });
  radarFrames=[]; radarIdx=-1;
  /* The pool is gone, so every per-layer tile tally went with it. Reset the cached verdict too, or
     syncSkyHealth() compares against a stale "was down" and skips the redraw that clears the badge
     when reflectivity comes back. */
  radarFallback=false; skyHealth.radar=null;
  syncRadarBadge();   // skyOn.radar is already false here, so this empties the badge
  updateRadarCtl();   // empty frame list drops .ready, so the scrubber can't outlive its frames
  /* A pinned satellite outliving the frame list would strand the card on an hour-old cloud shield
     with nothing left on screen explaining which moment it belongs to. Empty frames means unpin. */
  syncSatToRadar();
}
function applySkyLayers(first){
  syncSkyMeta();
  if(!rvMap) return;
  /* Dimmed only while BOTH layers stack — the whole point is giving reflectivity contrast over
     the cloud tops. Radar off, the satellite is the product and gets its full brightness back. */
  rvMap.getContainer().classList.toggle("sat-dim",!!(skyOn.radar&&skyOn.sat));
  if(!skyOn.radar) detachRadarLayers();
  // The scrubber drives frames nobody can see; it goes with them. (Class-driven display otherwise
  // — clearing the inline value hands it back to .radar-ctl.ready rather than forcing it open.)
  var ctl=document.getElementById("radarCtl");
  if(ctl) ctl.style.display=skyOn.radar?"":"none";
  // Only the imagery toggles; the labels stay put — they are the map's whole supply of geography
  // text now that the basemap geometry layer has no labels (see mapStylePart()).
  if(satLayer){
    if(skyOn.sat&&!rvMap.hasLayer(satLayer)) satLayer.addTo(rvMap);
    else if(!skyOn.sat&&rvMap.hasLayer(satLayer)) rvMap.removeLayer(satLayer);
  }
  /* Switched back on while the radar is parked in the past, the satellite would return as the LIVE
     frame — the exact mismatch the time track exists to close, reachable by a route that never
     touches the scrubber. Re-ask where the radar is standing. */
  if(!first&&skyOn.sat) syncSatToRadar();
  /* Back on, everything reflectivity had was torn down, so rebuild. nwsRadar goes back first for
     the same reason it is added at init: the capabilities fetch takes a moment, and this paints a
     sweep NOW instead of leaving an empty map until the frame list resolves. refreshRadarLayer()
     removes it again once the pooled frames can drive. */
  if(!first&&skyOn.radar){
    if(nwsRadar&&!rvMap.hasLayer(nwsRadar)) nwsRadar.addTo(rvMap);
    refreshRadarLayer();
  }
}
function setSkyLayer(name,on){
  if(name!=="radar"&&name!=="sat") return;
  skyOn[name]=!!on;
  try{ localStorage.setItem(SKY_KEY,JSON.stringify(skyOn)); }catch(e){}
  applySkyLayers(false);
}
document.addEventListener("click",function(e){
  var b=e.target.closest?e.target.closest("#rsTabs .rs-tab"):null;
  if(!b) return;
  var n=b.getAttribute("data-l");
  setSkyLayer(n,!skyOn[n]);
});

/* ============ SATELLITE TIME TRACK ============
   Scrubbing the radar back an hour used to leave the cloud shield sitting at "now" — the storm in
   the past and the system carrying it in the present, drawn as one picture. That is precisely what
   stacking the two layers was supposed to stop.

   GIBS has always exposed a time dimension, and the reason this waited is not the one the README
   used to give. The archive's gaps are real: measured across three hours, only 11 of 18 nominal
   10-minute slots existed, and a slot that does not exist is a hard 404, so the moments have to be
   DISCOVERED rather than computed. But that turns out to be the cheap part — DescribeDomains
   bounded to a few hours answers in ~350 bytes. (Unbounded it returns the whole archive back to
   2021, about 1 MB, which is what made this look impractical for so long.)

   The expensive part is the imagery, and it is what shapes everything below. A reflectivity tile is
   a sparse transparent PNG — measured, 1,980 bytes. A GeoColor tile is opaque full colour: 113,601
   bytes, 57x bigger. That single ratio is why the radar keeps ~15 frames alive and the satellite
   keeps exactly ONE. Nothing here preloads a parallel stack; it re-points one layer at whatever
   moment the visitor stopped on. Playback is exempt for the same reason — see syncSatToRadar. */
var SAT_DOMAIN="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/DescribeDomains";
var satTimes=[], satTimesPending=null, satPinned=null, satPending=null, satSwapGen=0, satSyncTimer=null;
/* The time is a segment of its own, AFTER the style — not in place of it. Dropping it where
   `default` sits looks right and answers 400 for every tile. */
function satUrl(t){ return t ? GIBS_SAT.replace("/default/","/default/"+t+"/") : GIBS_SAT; }
function isoZ(ms){ return new Date(ms).toISOString().replace(/\.\d+Z$/,"Z"); }
function iso8601Ms(d){
  var m=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec((d||"").trim());
  return m ? ((+m[1]||0)*86400+(+m[2]||0)*3600+(+m[3]||0)*60+(+m[4]||0))*1000 : 0;
}
/* The domain is a comma-separated list of START/END/PERIOD *intervals*, not a list of instants —
   that is exactly how the gaps are expressed, and expanding it is what turns "which slots exist"
   into something we can snap a radar timestamp onto. */
function expandSatDomain(s){
  var out=[];
  s.split(",").forEach(function(chunk){
    var p=chunk.trim().split("/");
    var start=Date.parse(p[0]);
    if(isNaN(start)) return;
    var end=(p.length>1)?Date.parse(p[1]):start;
    var step=iso8601Ms(p[2]);
    if(!step||isNaN(end)||end<start){ out.push(p[0].trim()); return; }
    for(var t=start; t<=end && out.length<400; t+=step) out.push(isoZ(t));
  });
  return out.sort();
}
function fetchSatTimes(){
  var now=Date.now();
  // Only as wide as the loop can reach. Unbounded is ~1 MB; this is a few hundred bytes.
  var url=SAT_DOMAIN+"?SERVICE=WMTS&VERSION=1.0.0&REQUEST=DescribeDomains"
    +"&layer=GOES-East_ABI_GeoColor&tileMatrixSet=GoogleMapsCompatible_Level7&domains=time"
    +"&time="+isoZ(now-(RADAR_SPAN_MIN+30)*60000)+"/"+isoZ(now+10*60000);
  return getText(url).then(function(xml){
    var m=xml.match(/<Domain>([\s\S]*?)<\/Domain>/i);
    if(!m) throw new Error("no domain");
    var list=expandSatDomain(m[1]);
    if(!list.length) throw new Error("empty domain");
    satTimes=list;
    return list;
  });
}
/* Newest satellite frame at or before the radar's moment. GOES publishes every ~10 minutes and the
   loop steps every ~4, so several radar frames legitimately share one image — the cloud shield
   really did not move in between, and pretending otherwise would be inventing data. */
function satTimeFor(ms){
  for(var i=satTimes.length-1;i>=0;i--){ if(Date.parse(satTimes[i])<=ms) return satTimes[i]; }
  return satTimes.length?satTimes[0]:null;   // radar frame predates anything GIBS still holds
}
function scheduleSatSwap(){
  clearTimeout(satSyncTimer);
  // Coalesce a drag: crossing an hour coincides with ~6 satellite frames, and the visitor only
  // ever looks at the one they stop on. The caption updates immediately; the bytes wait.
  satSyncTimer=setTimeout(function(){ swapSatLayer(satUrl(satPinned)); },180);
}
function unpinSat(){
  if(!satPinned) return;
  satPinned=null;
  scheduleSatSwap();
  syncSkyMeta();
}
/* Called whenever the radar's displayed moment changes. PLAYBACK IS DELIBERATELY EXEMPT: a
   GeoColor frame is ~450 KB for this map, and fetching that every 450ms would stall the loop
   rather than enrich it. Pausing or scrubbing means the visitor has stopped on a moment and is
   actually looking at it — that is when the cloud shield is worth the bytes. */
function syncSatToRadar(){
  if(!rvMap||!skyOn.sat||radarPlaying) return;
  if(!radarFrames.length){ unpinSat(); return; }
  var i=Math.max(0,Math.min(radarFrames.length-1,radarIdx));
  if(i===radarFrames.length-1){ unpinSat(); return; }   // back at now → the live, undated layer
  if(!satTimes.length){
    // First scrub since the window last moved: discover the valid slots, then re-enter with them.
    if(!satTimesPending){
      satTimesPending=fetchSatTimes().then(function(){ satTimesPending=null; syncSatToRadar(); })
        .catch(function(){ satTimesPending=null; });   // no domain → the satellite simply stays live
    }
    return;
  }
  var want=satTimeFor(Date.parse(radarFrames[i].time));
  if(!want||want===satPinned) return;   // ~15 radar steps over ~6 satellite frames: mostly a no-op
  satPinned=want;
  scheduleSatSwap();
  syncSkyMeta();
}
function satClock(iso){
  var d=new Date(iso);
  return isNaN(d)?"":d.toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric",minute:"2-digit"});
}
/* GIBS posts a new GeoColor frame every ~10 minutes, and Leaflet caches its tile <img>s in the DOM
   — nothing re-fetches on its own. redraw() would do it, but it drops every tile first and leaves
   a hole in the map while the replacements load. Build the new layer, swap once it has painted,
   and the change is invisible. For the LIVE frame old and new URLs are identical: the endpoint
   answers `no-store`, so the browser really does re-request instead of serving the frame we
   already have, which is why there is no cache-buster here. A pinned frame is a different URL and
   is cacheable on purpose — scrubbing back over ground you already covered should cost nothing. */
function swapSatLayer(url){
  if(!rvMap||!satLayer||!skyOn.sat) return;
  /* A swap already in flight is now aimed at the wrong minute. Drop it before starting another, or
     dragging the scrubber across an hour stacks half a dozen opaque layers all waiting to paint. */
  if(satPending&&satPending!==satLayer&&rvMap.hasLayer(satPending)) rvMap.removeLayer(satPending);
  var gen=++satSwapGen, old=satLayer, swapped=false;
  var next=L.tileLayer(url,{maxZoom:12,maxNativeZoom:SAT_MAX_NATIVE,zIndex:5});
  satPending=next;
  bindSkyHealth(next);   // satDown() asks whichever layer is current, and that is about to be this one
  function swap(){
    if(swapped) return; swapped=true;
    /* Tiles do not necessarily come back in the order they were asked for. Without this, a slow
       early scrub could paint last and leave the map showing a minute the visitor already left. */
    if(gen!==satSwapGen){ if(next!==satLayer&&rvMap.hasLayer(next)) rvMap.removeLayer(next); return; }
    satPending=null;
    if(satLayer===old&&rvMap.hasLayer(old)) rvMap.removeLayer(old);
    // A toggle-off mid-swap wins: never resurrect a layer the visitor just switched away from.
    if(skyOn.sat) satLayer=next;
    else if(rvMap.hasLayer(next)) rvMap.removeLayer(next);
    /* The verdict now refers to a different object with different tallies. Re-ask, or a caption
       that said "unavailable" for the old layer never comes back when the new one paints. */
    syncSkyHealth();
  }
  next.once("load",swap);
  /* If every tile errors "load" never fires, and without this the old layer would stay pinned
     behind a detached one forever. Swapping anyway makes the failure visible instead of leaving
     an hour-old frame on screen looking current. */
  setTimeout(swap,20000);
  next.addTo(rvMap);
}
function refreshSatLayer(){
  /* The discovery window has moved on; make the next scrub re-ask rather than snap to slots that
     have since aged out of it. Cleared even while pinned — the pinned frame stays on screen, and
     the list it came from is what goes stale. */
  satTimes=[];
  if(!rvMap||!satLayer||!skyOn.sat) return;
  // Scrubbed back on purpose: a live refresh here would yank the visitor to "now" mid-look.
  if(satPinned) return;
  swapSatLayer(satUrl(null));
}
/* The jump nav needs no script: every link points at a section that is always on the page, and the
   browser does the scrolling. */

/* ---- Sky fullscreen ----
   The inline map is a peek; this is the "where exactly, and when" view. The card itself goes
   fixed-position rather than cloning anything, so the Leaflet instance, the loop, the layer
   toggles and the warning polygons survive the transition untouched — only the box changes size.
   Leaflet has to be told, twice: once when the layout has settled and once after the CSS
   transition, or it renders tiles for the old viewport. */
var radarFull=false, radarFullPrevFocus=null, radarInert=[];
function setRadarFull(on){
  var card=document.getElementById("radarCard"), btn=document.getElementById("rsFull");
  if(!card||radarFull===on) return;
  radarFull=on;
  document.body.classList.toggle("radar-full",on);
  if(btn){
    btn.setAttribute("aria-expanded",on?"true":"false");
    var t=btn.querySelector(".rsf-t"); if(t) t.textContent=on?"Close":"Fullscreen";
    // The icon is not swapped here — body.radar-full picks which of the button's two marks shows.
  }
  if(on){
    radarFullPrevFocus=document.activeElement;
    card.setAttribute("role","dialog");card.setAttribute("aria-modal","true");card.setAttribute("aria-labelledby","skyTitle");
    var branch=card;
    while(branch.parentElement){
      [].forEach.call(branch.parentElement.children,function(sibling){
        if(sibling!==branch&&!sibling.inert){sibling.inert=true;radarInert.push(sibling);}
      });
      branch=branch.parentElement;if(branch===document.body)break;
    }
    if(btn) btn.focus();
  }else{
    radarInert.forEach(function(node){node.inert=false;});radarInert=[];
    card.removeAttribute("role");card.removeAttribute("aria-modal");card.removeAttribute("aria-labelledby");
    // Return focus where it came from; a keyboard user must not be dumped at the top of the page.
    if(radarFullPrevFocus&&radarFullPrevFocus.focus) radarFullPrevFocus.focus();
    radarFullPrevFocus=null;
  }
  if(rvMap){ rvMap.invalidateSize(); setTimeout(function(){ if(rvMap) rvMap.invalidateSize(); },260); }
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
document.addEventListener("click",function(e){
  if(e.target.closest&&e.target.closest("#rsFull")) setRadarFull(!radarFull);
});
document.addEventListener("keydown",function(e){
  if(!radarFull) return;
  if(e.key==="Escape"){e.preventDefault();setRadarFull(false);return;}
  if(e.key==="Tab"){
    var card=document.getElementById("radarCard");
    var controls=[].slice.call(card.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(function(node){return !node.closest("[inert]")&&node.getClientRects().length;});
    if(!controls.length){e.preventDefault();return;}
    var first=controls[0],last=controls[controls.length-1],active=document.activeElement;
    if(!card.contains(active)||e.shiftKey&&active===first||!e.shiftKey&&active===last){
      e.preventDefault();(e.shiftKey?last:first).focus();
    }
  }
});

/* ============ FORECAST DISCUSSION (the pulse) ============ */
var AFD_LINK="https://forecast.weather.gov/product.php?site=LSX&issuedby=LSX&product=AFD&format=CI&glossary=1";

function renderAFD(sec, issued){
  var el=document.getElementById("afd");
  if(!sec){
    el.innerHTML='<div class="empty">Discussion unavailable right now. <a href="'+AFD_LINK+'" target="_blank" rel="noopener">Open the full AFD ↗</a></div>';
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
  }
  var meta=sec.label+" · NWS St. Louis"+(issued?" · issued "+timeAgo(issued):"");
  el.innerHTML='<div class="afd-body">'+inner+'</div><div class="afd-meta">'+meta+'</div>';
}


/* ============ LOCATION (geolocation / search / presets, persisted) ============ */
var LOC_KEY="lsxLoc";
var FAVORITES_KEY="lsxFavorites_v1";


function saveLoc(l){ try{ localStorage.setItem(LOC_KEY,JSON.stringify(validLocation(l))); }catch(e){} }
function readLoc(){ try{ return validLocation(JSON.parse(localStorage.getItem(LOC_KEY)||"null")); }catch(e){ return null; } }
function readFavorites(){
  try{ var v=JSON.parse(localStorage.getItem(FAVORITES_KEY)||"[]");return Array.isArray(v)?v.map(validLocation).filter(Boolean).slice(0,20):[]; }catch(e){ return []; }
}
var favoriteLocations=readFavorites();
function saveFavorites(){ try{ localStorage.setItem(FAVORITES_KEY,JSON.stringify(favoriteLocations)); }catch(e){} }

function locationURL(l){
  var u=new URL(location.href);
  u.searchParams.set("lat",l.lat.toFixed(5));u.searchParams.set("lon",l.lon.toFixed(5));u.searchParams.set("place",l.name);
  u.searchParams.set("kind",l.precision==="representative"?"city":"point");u.hash="";
  return u.href;
}
function locationFeedback(text){ var el=document.getElementById("locFeedback");if(el) el.textContent=text; }
function syncLocationTools(){
  var toggle=document.getElementById("favoriteToggle"), select=document.getElementById("favoriteSelect");
  var found=favoriteLocations.some(function(l){return locationKey(l)===locationKey(current);});
  if(toggle){toggle.setAttribute("aria-pressed",String(found));toggle.textContent=found?"Remove this favorite":"Save this location";}
  if(select){
    var chosen=select.value;
    select.innerHTML='<option value="">Choose a saved location</option>'+favoriteLocations.map(function(l){return '<option value="'+locationKey(l)+'">'+esc(l.name)+'</option>';}).join("");
    select.value=favoriteLocations.some(function(l){return locationKey(l)===chosen;})?chosen:"";
    document.getElementById("favoriteRemove").disabled=!select.value;
  }
  var link=document.getElementById("locationLink");if(link) link.value=locationURL(current);
}
function chooseVerifiedLocation(loc,opts){
  var sequence=locSeq, geo=++geoSeq;
  locationFeedback("Checking "+loc.name+"…");
  return pointsFor(loc.lat,loc.lon).then(function(pt){
    if(sequence!==locSeq||geo!==geoSeq) return false;
    if(!pt||!pt.properties||(pt.properties.cwa||pt.properties.gridId)!=="LSX"){
      locationFeedback("This point is outside the St. Louis (LSX) forecast area. The current location was kept.");return false;
    }
    setLocation(loc,opts||{save:true});locationFeedback("Forecast location: "+loc.name+".");return true;
  }).catch(function(){if(sequence===locSeq&&geo===geoSeq) locationFeedback("Couldn't verify this location. Try again when weather services are available.");return false;});
}
var TITLE_BASE="LSX Dashboard";
function updateLocNow(){
  var el=document.getElementById("locNow");
  if(el) el.innerHTML='<span class="locNow-label">Forecast for</span><span class="locNow-place">'
    +ic("pin")+'<strong>'+esc(current.name)+'</strong></span>';
  // A pinned tab should say WHOSE weather it is. Safe to write here rather than behind a
  // fresh() guard: this runs synchronously from setLocation with the location it just set,
  // never from a fetch that a later location could have superseded.
  var place=(current.name||"").replace(" (home)","");
  document.title=place?(place+" — "+TITLE_BASE):TITLE_BASE;
  // The hero band names the place too: a shared link should say whose weather this is without
  // the visitor having to find the location bar.
  var r=document.getElementById("railNowSub"); if(r) r.textContent=current.name.replace(" (home)","");
  var sticky=document.getElementById("stickyLocation");if(sticky){sticky.textContent=current.name;sticky.setAttribute("aria-label","Change forecast location: "+current.name);}
  var kind=document.getElementById("stickyKind");if(kind) kind.textContent=current.precision==="representative"?"Town point":current.precision==="device"?"Geolocated point":"Selected point";
  syncLocationTools();
}


/* ===== Location generation guard =====
   Every location-scoped fetch captures the generation it was issued under. If the user moves
   before it lands, the response is DISCARDED rather than painted: a slow forecast for the old
   town was otherwise overwriting the new one and sitting there under the new town's label. */
var locSeq=0, snapSafeSeq=0, geoSeq=0;
/* Packages the capture half of that guard. Call it once at the top of a location-scoped loader,
   then call the returned fresh() immediately before any DOM write:

     function loadThing(){
       var fresh=locGuard();
       return getJSON(url).then(function(d){ if(!fresh()) return; paint(d); });
     }

   This is deliberately not a full wrapper. Loaders paint from inside their own promise chains —
   several from two or three different branches — so there is no single return value a wrapper
   could gate on, and converting them all to hand a paint closure back would be a large rewrite of
   safety-critical code. What it does remove is the half that was quietly easy to get wrong:
   capturing locSeq at the wrong moment, or comparing against the wrong variable. */
function locGuard(){ var g=locSeq; return function(){ return g===locSeq; }; }
/* The guard above discards a stale RESULT; this cancels the stale REQUEST. Without it, switching
   towns a few times leaves every superseded fetch running to completion, competing for the browser's
   handful of per-host connections with the ones the user is actually waiting on.
   Only feeds that describe A PLACE carry this signal. The CWA-wide alert list, the fixed river
   gauges, the AFD, the regional station plot and the one-shot service-metadata lookups deliberately
   do not — aborting those would paint their error states every time the user moved. */
var locAbort=null;
function locSignal(){ if(!locAbort) locAbort=new AbortController(); return locAbort.signal; }
/* Derived state is cleared on every change so a render can never MIX two places -- e.g. the new
   town's forecast high ranked against the old town's 96-year record. */
function resetLocationState(){
  lastAlertData=null; alertsRetained=false; retainedAlertKey=""; alertUpdateNotice();
  renderBriefingEvidence._models=null;
  Object.keys(FEEDS).forEach(function(k){if(FEEDS[k].local&&FEEDS[k].tracked!==false) feedChecks[k]={status:"loading",successAt:0,issuedAt:0,saved:false};});
  savedParts={}; freshnessCheck();
  climate.normHi=null; climate.normLo=null; climate.normDate=null; climate.fcHi=null; climate.fcLo=null; climate.fcHiDate=null; climate.fcLoDate=null;
  climate.fcHiLabel=""; climate.station=null; climate.stationName="";
  ctx={ready:false, recHi:null, recLo:null, recPcp:null, doyHi:[], doyLo:[],
       monWet:[], monWarm:[], monMtd:null, monMean:null, monName:"", years:0,
       dry:null, hist:null, normWeek:{}, recStation:""};
  uv={now:null, peak:null, daily:{}};
  smart.hourly=[]; smart.hourlyAll=[]; smart.days=[]; smart.weekDays=[];
  forecastGrid={status:"loading",properties:null,gusts:[]};
  heroNow.temp=null;   // the old city's reading must not mark the new city's range
  aqiState={val:null, pm:null, err:false}; callAqi=null; callRisk=null; callLocalAlert=null; callAlertGroups=[];
  lastMcds=[];   // "inside this area" was ray-cast against the OLD point; loadMcd re-answers
  userZones={county:"",forecast:"",fire:""};
  renderHourly24._hrs=null; renderHourly24._cursor=0; renderHourly24._selectedTime=null; loadForecast._paint=null;
}
/* ...and the on-screen numbers go back to a loading state, so nothing false is legible while
   the new place loads. */
function clearLocationUI(){
  Object.keys(FEEDS).forEach(function(k){
    var cfg=FEEDS[k];if(!cfg.local) return;
    Object.keys(cfg.reset||{}).forEach(function(id){
      var el=document.getElementById(id), text=cfg.reset[id];
      if(el) el.innerHTML=text?'<div class="loading">'+esc(text)+'</div>':"";
    });
  });
  syncHourlyControls();
  var briefing=document.getElementById("callRow");if(briefing) briefing.innerHTML="";
  document.getElementById("briefPlanning").hidden=true;
  document.getElementById("briefEvidence").innerHTML="";
  var cc=document.getElementById("callCard"); if(cc) cc.classList.remove("has");
  var ch=document.getElementById("callHorizon"); if(ch) ch.textContent="Next 24 hours";
  var aq=document.getElementById("aqiCard"); if(aq) aq.classList.remove("show");
  var cs=document.getElementById("cnStation"); if(cs) cs.textContent="\u2026";
  drawMcdPolygons();   // lastMcds was just reset; take the old place's outline off the map with it
  if(typeof scheduleMasonry==="function") scheduleMasonry();
}
function setLocation(loc,opts){
  opts=opts||{};
  geoSeq++;                       // a search selection supersedes geolocation still resolving
  var g=++locSeq;              // anything already in flight for the old place is now stale
  if(locAbort) locAbort.abort();          // …so stop paying for it
  locAbort=new AbortController();         // this generation's fetches hang off a fresh signal
  current=loc;
  resetLocationState();
  clearLocationUI();
  updateLocNow();
  if(opts.save) saveLoc(loc);
  if(opts.url!==false){ try{ history.replaceState(null,"",locationURL(loc)); }catch(e){} }
  var keys=feedTasks(true);stampSched(keys);
  var jobs=keys.map(runFeed);
  loadRadar();      // discovers a missing station itself, and retries on later cycles
  // Only once everything has settled for THIS generation is the screen safe to snapshot --
  // otherwise a scheduled save could store the old town's cards under the new town's name.
  Promise.allSettled(jobs).then(function(){ if(g===locSeq) snapSafeSeq=g; });
}
function useMyLocation(explicit){
  var btn=document.getElementById("geoBtn");
  var seq=++geoSeq, locAtStart=locSeq;
  // Write the label into .g-txt, never over the button: the phone layout hides that span to get
  // the geolocate control down to its icon, and a textContent assignment would delete it.
  function active(){ return seq===geoSeq&&locAtStart===locSeq; }
  function label(t){ if(!active()) return; var s=btn&&btn.querySelector(".g-txt"); if(s) s.textContent=t; }
  if(!navigator.geolocation){ if(explicit) alert("Geolocation isn't available on this device/browser."); return; }
  label(" Locating…");
  navigator.geolocation.getCurrentPosition(function(pos){
    if(!active()) return;
    label(" My location");
    var lat=pos.coords.latitude, lon=pos.coords.longitude;
    // Only adopt the fix if it falls inside the LSX forecast area.
    pointsFor(lat,lon).then(function(pt){
      if(!active()) return;
      var cwa=pt&&pt.properties&&(pt.properties.cwa||pt.properties.gridId);
      if(cwa!=="LSX"){
        if(explicit) alert(cwa
          ?"Your current location is outside the St. Louis (LSX) forecast area, so it isn't shown on this dashboard."
          :"Couldn't verify that your location is inside the St. Louis (LSX) forecast area. Your current dashboard location was kept.");
        return;   // keep the existing in-area location
      }
      /* The same response that vouched for the CWA names the place: /points carries the nearest
         town as relativeLocation. Showing it beats the literal "My Location" the header used to
         echo — "Wentzville, MO" tells you which forecast you are actually reading, and costs no
         second request. The literal stays as the fallback when the field is missing. */
      var rl=pt&&pt.properties&&pt.properties.relativeLocation&&pt.properties.relativeLocation.properties;
      var nm=rl&&rl.city?rl.city+(rl.state?", "+rl.state:""):"My Location";
      setLocation({name:nm,lat:lat,lon:lon,station:null,precision:"device"},{save:true});
    }).catch(function(e){
      if(isAbort(e)||!active()) return;
      if(explicit) alert("Couldn't verify that your location is inside the St. Louis (LSX) forecast area. Your current dashboard location was kept.");
    });
  },function(){
    if(!active()) return;
    label(" My location");
    if(explicit) alert("Couldn't get your location. Make sure location access is allowed for this site.");
  },{enableHighAccuracy:true,timeout:9000,maximumAge:600000});
}
/* Type-ahead location search (Open-Meteo geocoder, restricted to the LSX CWA) */
var sugTimer=null, sugItems=[], sugSeq=0, sugHot=-1;

/* ===== LSX County Warning Area restriction =====
   The dashboard only searches places inside the St. Louis (LSX) forecast area.
   The county whitelist is built once from the authoritative NWS zone data
   (api.weather.gov) and cached; a hardcoded list is the fallback if that fails. */
var LSX_CC_KEY="lsxCwaCounties_v2";
var LSX_FALLBACK={
  "MO":["audrain","bollinger","boone","callaway","cole","crawford","dent","franklin","gasconade","iron","jefferson","lewis","lincoln","madison","maries","marion","moniteau","monroe","montgomery","osage","perry","phelps","pike","ralls","reynolds","st charles","st francois","st louis","ste genevieve","shannon","shelby","warren","washington","wayne"],
  "IL":["adams","bond","brown","calhoun","clinton","greene","jersey","macoupin","madison","monroe","montgomery","pike","randolph","st clair","washington"]
};
function normCounty(s){
  s=String(s||"").toLowerCase();
  s=s.replace(/[.’']/g,"").replace(/,/g," ");
  s=s.replace(/\(city\)/g," ").replace(/\bcounty\b/g," ").replace(/\bcity\b/g," ").replace(/\bparish\b/g," ");
  s=s.replace(/\bsainte\b/g,"ste").replace(/\bsaint\b/g,"st");
  return s.replace(/\s+/g," ").trim();
}
var LSX_COUNTIES=null;                 // {MO:Set, IL:Set} once resolved
function lsxSetsFrom(obj){
  var out={}; Object.keys(obj).forEach(function(k){ out[k]=new Set((obj[k]||[]).map(normCounty)); }); return out;
}
function buildLsxCounties(){
  try{ var c=localStorage.getItem(LSX_CC_KEY); if(c){ var p=JSON.parse(c); if(p&&(p.MO||p.IL)) return Promise.resolve(lsxSetsFrom(p)); } }catch(e){}
  function zurl(st){ return API+"/zones?area="+st+"&type=county&include_geometry=false"; }
  return Promise.all([getJSON(zurl("MO"),HEADERS),getJSON(zurl("IL"),HEADERS)]).then(function(rs){
    var acc={MO:[],IL:[]};
    rs.forEach(function(fc){
      (fc.features||[]).forEach(function(f){
        var pr=f.properties||{}, cwa=pr.cwa;
        var isLsx=Array.isArray(cwa)?cwa.indexOf("LSX")>=0:cwa==="LSX";
        if(isLsx&&(pr.state==="MO"||pr.state==="IL")&&pr.name) acc[pr.state].push(pr.name);
      });
    });
    if(!acc.MO.length&&!acc.IL.length) throw new Error("no LSX zones");
    try{ localStorage.setItem(LSX_CC_KEY,JSON.stringify(acc)); }catch(e){}
    return lsxSetsFrom(acc);
  }).catch(function(){ return lsxSetsFrom(LSX_FALLBACK); });
}
function ensureLsxCounties(){
  if(LSX_COUNTIES) return Promise.resolve(LSX_COUNTIES);
  return buildLsxCounties().then(function(m){ LSX_COUNTIES=m; return m; });
}
function inLsx(admin1,admin2){
  if(!LSX_COUNTIES) return null;
  var set=LSX_COUNTIES[abbrState(admin1)];
  return set?set.has(normCounty(admin2)):false;
}
/* ===== Writing the query the way the index spelled it =====
   The Open-Meteo geocoder does no fuzzy matching whatsoever: a name that doesn't match the stored
   spelling character-for-character returns an empty list, not a near miss. That is a problem in a
   forecast area this full of saints, because the index is not consistent about them — it holds
   "Lake Saint Louis", "East Saint Louis", "Saint Ann" and "City of Saint Peters" spelled out, but
   "St. Louis" and "Mt. Vernon" abbreviated. Typed the way everyone here writes them, "Lake St.
   Louis", "East St. Louis", "St. Ann" and "Ste. Genevieve" all came back with nothing at all, and
   "St. Charles" came back as an airport plus a town in Kane County, Illinois.

   So the search no longer asks one question. It rewrites what was typed into every spelling the
   index might be using, asks for all of them at once, merges the answers, and ranks them by how
   well they actually match what the visitor typed — abbreviation, apostrophe and case aside. */
var ABBR_LONG={st:"saint",ste:"sainte",mt:"mount",mtn:"mountain",ft:"fort",pt:"point",
               hts:"heights",spgs:"springs",jct:"junction",n:"north",s:"south",e:"east",w:"west"};
var ABBR_SHORT={saint:"st",sainte:"ste",mount:"mt",mountain:"mtn",fort:"ft",point:"pt",
                heights:"hts",springs:"spgs",junction:"jct"};
/* Rewrites whole words only, so "Street" is never mistaken for "St" and a ZIP code (digits) is
   passed through untouched. A trailing period is part of the word being replaced. */
function abbrSwap(s,map){
  return s.replace(/[A-Za-z]+\.?/g,function(w){
    var bare=w.replace(/\.$/,"").toLowerCase();
    return Object.prototype.hasOwnProperty.call(map,bare)?map[bare]:w;
  });
}
/* "Wentzville, MO" and "Columbia IL" both returned nothing — the geocoder matches the place name
   alone and treats the state as part of it. Peel it off and keep it as a ranking hint instead,
   which is exactly what it is worth: it settles Columbia, IL vs. Columbia, MO. */
var STATE_HINT={mo:"Missouri",missouri:"Missouri",il:"Illinois",ill:"Illinois",illinois:"Illinois"};
function splitState(q){
  var m=/^(.*[^,\s])[,\s]\s*([A-Za-z]{2,8})\.?$/.exec(q);
  if(m){
    var st=STATE_HINT[m[2].toLowerCase()];
    if(st && m[1].trim().length>=2) return {text:m[1].trim(), state:st};
  }
  return {text:q, state:null};
}
var MAX_VARIANTS=6;
function queryVariants(q){
  var out=[], seen={};
  function add(s){
    s=String(s||"").replace(/\s+/g," ").trim();
    if(s.length<2) return;
    var k=s.toLowerCase();
    if(!seen[k]){ seen[k]=1; out.push(s); }
  }
  var base=q.replace(/[‘’]/g,"'").replace(/^(?:city|town|village)\s+of\s+/i,"").replace(/\s+/g," ").trim();
  /* The apostrophe forms, unchanged: "O Fallon" and "OFallon" return NOTHING while "O'Fallon"
     matches, and iOS smart punctuation turns a typed straight quote into a curly one. */
  var forms=[base,
             base.replace(/\b([OoDd])\s+(?=[A-Za-z]{2})/g,"$1'"),
             base.replace(/\b([OD])(?=[a-z]{2})/g,"$1'"),
             base.replace(/'/g,"")];
  if(/&/.test(base)) forms.push(base.replace(/\s*&\s*/g," and "));
  else if(/\band\b/i.test(base)) forms.push(base.replace(/\band\b/ig,"&"));
  forms.forEach(function(f){
    add(f);
    add(abbrSwap(f,ABBR_LONG));
    add(abbrSwap(f,ABBR_SHORT));
    add(f.replace(/\./g,""));
    add(abbrSwap(f,ABBR_LONG).replace(/\./g,""));
  });
  add(base.replace(/\b(county|parish)\b/ig,""));
  return out.slice(0,MAX_VARIANTS);
}
/* One spelling of a name compared to another, with everything the two indexes disagree about
   flattened away: case, punctuation, the saint/st and mount/mt pairs, and the "City of" prefix
   the geocoder puts on some incorporated places but not others. */
function normName(s){
  return String(s||"").toLowerCase()
    .replace(/[‘’]/g,"'")
    .replace(/^(?:city|town|village)\s+of\s+/,"")
    .replace(/\bsainte\b/g,"ste").replace(/\bsaint\b/g,"st")
    .replace(/\bmount\b/g,"mt").replace(/\bfort\b/g,"ft")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
/* Locals write St. and Ste., and so does the NWS. The geocoder's spelled-out form is the same
   place, so print the one the area actually uses. */
function prettyPlace(s){
  return String(s||"").replace(/^(?:City|Town|Village)\s+of\s+/i,"")
    .replace(/\bSainte\b/g,"Ste.").replace(/\bSaint\b/g,"St.")
    .replace(/\bSte\b(?!\.)/g,"Ste.").replace(/\bSt\b(?!\.)/g,"St.").trim();
}
/* Dice coefficient on character bigrams — the only fuzziness in the pipeline, and it is used
   solely to rescue a typo AFTER every exact spelling has come back empty. Never to reorder
   results that did match, where it would happily rank a wrong town above a right one. */
function nameSimil(a,b){
  if(a===b) return 1;
  if(a.length<2||b.length<2) return 0;
  var pool={}, hit=0, i;
  for(i=0;i<a.length-1;i++){ var g=a.substr(i,2); pool[g]=(pool[g]||0)+1; }
  for(i=0;i<b.length-1;i++){ var h=b.substr(i,2); if(pool[h]>0){ pool[h]--; hit++; } }
  return (2*hit)/((a.length-1)+(b.length-1));
}
/* How well a candidate answers what was typed. Ranked ahead of population, because the visitor
   who typed six characters of a small town's name meant that town, not the metro area. */
function matchScore(cand,keys){
  var best=0;
  keys.forEach(function(k){
    var s;
    if(cand===k) s=100;
    else if(cand.indexOf(k+" ")===0) s=72;                 // "st charles" → "st charles county smartt airport"
    else if(cand.indexOf(k)===0) s=66;                     // still typing: "wentz" → "wentzville"
    else if(k.indexOf(cand+" ")===0) s=56;                 // typed more than the place is called
    else if((" "+cand+" ").indexOf(" "+k+" ")>=0) s=44;
    else s=Math.round(nameSimil(cand,k)*42);
    if(s>best) best=s;
  });
  return best;
}
/* A geocoder "result" is not necessarily a place anyone lives: searching Ste. Genevieve turns up
   a flying club, and Lake St. Louis turns up its dam. Populated places win by a wide margin. */
function featureScore(code){
  code=String(code||"");
  if(code.indexOf("PPL")===0) return 40;
  if(code.indexOf("ADM")===0) return 8;
  return -30;
}
function geoScore(r,ask){
  var s=matchScore(normName(r.name),ask.keys)+featureScore(r.feature_code);
  s+=Math.min(18,Math.log10((r.population||0)+1)*4.5);     // mild big-city tiebreak, never the lead
  if(ask.state) s+=(r.admin1===ask.state)?14:-26;
  return s;
}
function sugLabel(r){
  var name=prettyPlace(r.name);
  var co=prettyPlace(String(r.admin2||"").replace(/\s+(?:County|Parish)$/i,""));
  var where=[];
  // The county only earns its place when it isn't just the town's name again (St. Louis, St. Charles).
  if(co && normName(co)!==normName(name)) where.push(co+" Co.");
  where.push(abbrState(r.admin1));
  return {name:name, where:where.join(", ")};
}
/* The input is a combobox, so the list being open and which row is highlighted have to be said out
   loud, not just drawn. Without this the arrow keys move a background colour that a screen reader
   never hears about. */
function sugAria(open,active){
  var inp=document.getElementById("locSearch"); if(!inp) return;
  inp.setAttribute("aria-expanded",open?"true":"false");
  if(active) inp.setAttribute("aria-activedescendant",active); else inp.removeAttribute("aria-activedescendant");
}
function hideSug(){
  var b=document.getElementById("locSug");
  b.classList.remove("show"); b.innerHTML=""; sugItems=[]; sugHot=-1; sugAria(false,null);
}
function showSugNote(msg){
  var b=document.getElementById("locSug");
  b.innerHTML='<div class="sug-note">'+msg+'</div>';
  b.classList.add("show"); sugItems=[]; sugHot=-1;
  sugAria(false,null);   // a note is not a list of options to arrow through
}
/* Per-session memo, keyed by the exact string sent, so backspacing a character costs nothing.
   Bounded, because every prefix of every word typed is its own key holding up to 100 records —
   an afternoon of searching would otherwise accumulate a few thousand of them. Oldest key out
   first: the visitor is refining the word in front of them, not returning to one from an hour ago. */
var geoCache={}, geoCacheKeys=[], GEO_CACHE_MAX=80;
function geoFetch(q){
  var k=q.toLowerCase();
  if(geoCache[k]) return geoCache[k];
  var p=getJSON("https://geocoding-api.open-meteo.com/v1/search?count=100&countryCode=US&language=en&format=json&name="+encodeURIComponent(q))
    .then(function(d){ return d.results||[]; })
    .catch(function(e){                                    // a dropped connection must not be cached as "no such place"
      delete geoCache[k];
      var at=geoCacheKeys.indexOf(k); if(at>=0) geoCacheKeys.splice(at,1);
      throw e;
    });
  geoCache[k]=p;
  geoCacheKeys.push(k);
  while(geoCacheKeys.length>GEO_CACHE_MAX){ delete geoCache[geoCacheKeys.shift()]; }
  return p;
}
/* Ask for every spelling at once and merge by geoname id. One variant failing is not the search
   failing — only every variant failing is, and that is a connection problem worth saying out loud. */
function geoLookup(variants){
  var dead=0;
  return Promise.all(variants.map(function(v){
    return geoFetch(v).catch(function(){ dead++; return []; });
  })).then(function(lists){
    if(dead===variants.length) throw new Error("geocoder unreachable");
    var seen={}, out=[];
    lists.forEach(function(rs){
      rs.forEach(function(r){
        var id=(r.id!=null)?("#"+r.id):(r.name+"@"+r.latitude+","+r.longitude);
        if(!seen[id]){ seen[id]=1; out.push(r); }
      });
    });
    return out;
  });
}
function inArea(r){
  return r.country_code==="US" && (r.admin1==="Missouri"||r.admin1==="Illinois")
      && !!r.admin2 && inLsx(r.admin1,r.admin2)===true;
}
/* The index matches historical alternate names it doesn't hand back, so a search for Springfield
   returns Palmyra (Marion County, and therefore in area) alongside the Springfields that aren't.
   Left alone that made Palmyra the ONE suggestion for "Springfield" — the right answer being out
   of area is not the same as this being the right answer.

   The test is comparative: only once something in the full result set really is named what was
   typed does a coincidental hit have to clear the bar for "matches the name at all" — a prefix,
   which is what half-typed type-ahead looks like, or better. If nothing anywhere matches by name,
   the index matched on a name we can't see (a neighbourhood, an old name), and the only sane move
   is to trust it — pruning would leave the visitor with nothing at all. */
var RELEVANT=40;
function pruneWeak(hits,all,ask){
  var best=0;
  all.forEach(function(r){ var m=matchScore(normName(r.name),ask.keys); if(m>best) best=m; });
  if(best<44) return hits;
  return hits.filter(function(r){ return matchScore(normName(r.name),ask.keys)>=RELEVANT; });
}
/* Last resort, and only once every exact spelling has come back empty: the geocoder matches on a
   name PREFIX, so a query with a typo in its tail ("Chesterfeild", "Edwardsvile") still shares a
   good prefix with the real name. Ask for that prefix, then keep only candidates that a bigram
   comparison says are genuinely close to what was typed. */
var FUZZ_FLOOR=0.66;
function fuzzyRescue(variants,ask){
  var stems=[], seen={};
  variants.slice(0,3).forEach(function(v){
    var stem=v.slice(0,Math.max(4,Math.ceil(v.length*0.62))).trim();
    var k=stem.toLowerCase();
    if(stem.length>=4 && stem.length<v.length && !seen[k]){ seen[k]=1; stems.push(stem); }
  });
  if(!stems.length) return Promise.resolve([]);
  return geoLookup(stems.slice(0,2)).then(function(rs){
    return rs.filter(function(r){
      if(String(r.feature_code||"").indexOf("PPL")!==0 || !inArea(r)) return false;
      var n=normName(r.name);
      return ask.keys.some(function(k){ return nameSimil(n,k)>=FUZZ_FLOOR; });
    });
  }).catch(function(){ return []; });
}
function renderSuggestions(res,ask){
  // Once a real town has matched, the dam and the flying club named after it are noise in a list
  // of six. They stay only when nothing populated matched at all, where a lake or a park is
  // plausibly the place the visitor wants a forecast for.
  var ppl=res.filter(function(r){ return String(r.feature_code||"").indexOf("PPL")===0; });
  if(ppl.length) res=ppl;
  res.sort(function(a,b){ return geoScore(b,ask)-geoScore(a,ask); });
  // Collapse true duplicates (the same town returned under two spellings) while keeping the two
  // different O'Fallons, which differ by county. Sorted first, so the survivor is the best-scored.
  var seen={};
  res=res.filter(function(r){
    var k=normName(r.name)+"|"+r.admin1+"|"+normCounty(r.admin2);
    if(seen[k]) return false;
    seen[k]=1; return true;
  }).slice(0,6);
  sugItems=res.map(function(r){
    var l=sugLabel(r);
    return {name:l.name+", "+abbrState(r.admin1), lat:r.latitude, lon:r.longitude, label:l};
  });
  sugHot=-1;
  var b=document.getElementById("locSug");
  b.innerHTML=sugItems.map(function(s,i){
    return '<div class="sug" role="option" id="locSugOpt'+i+'" aria-selected="false" data-i="'+i+'"><span class="sname">'+esc(s.label.name)+'</span><span class="swhere">'+esc(s.label.where)+'</span></div>';
  }).join("");
  b.classList.add("show");
  sugAria(true,null);
}
/* Nothing in the area matched. Say which of the two things went wrong, because they need
   different responses from the visitor: a place that exists but sits outside the CWA is the
   dashboard's limit, while no place at all is a spelling to fix. */
function noMatchNote(q,all,ask){
  // Naming the out-of-area town takes the whole name, not a shared opening: three characters into
  // "Ste. Genevieve" the index offers Ste. Marie, Illinois, and "Ste. Marie, IL is outside the
  // area" is a confusing thing to read while still typing the town that isn't.
  var out=all.filter(function(r){ return String(r.feature_code||"").indexOf("PPL")===0 && matchScore(normName(r.name),ask.keys)===100; });
  if(out.length){
    // Prefer a two-state answer when the name is shared nationally: "Mount Vernon, IL is outside
    // the area" tells a visitor here something; the bigger one in Washington does not.
    function near(r){ return (r.admin1==="Missouri"||r.admin1==="Illinois")?1:0; }
    out.sort(function(a,b){ return (near(b)-near(a))||(geoScore(b,ask)-geoScore(a,ask)); });
    var best=out[0];
    showSugNote(esc(prettyPlace(best.name)+", "+abbrState(best.admin1))+" is outside the St. Louis (LSX) forecast area, which is all this dashboard covers.");
  }else{
    showSugNote('No LSX-area city or town matches "'+esc(q)+'".');
  }
}
function fetchSuggestions(q){
  var seq=++sugSeq;   // guard against out-of-order responses (a slow reply for an old query must not clobber newer results)
  var parsed=splitState(q);
  var variants=queryVariants(parsed.text);
  if(!variants.length){ hideSug(); return; }
  // Every spelling we are willing to accept as "what the visitor meant", normalised for comparison.
  var ask={state:parsed.state, keys:variants.map(normName).filter(function(k,i,a){ return k && a.indexOf(k)===i; })};
  if(!sugItems.length) showSugNote("Searching…");
  ensureLsxCounties().then(function(){
    return geoLookup(variants).then(function(all){
      var hits=pruneWeak(all.filter(inArea),all,ask);
      if(hits.length) return {hits:hits, all:all};
      return fuzzyRescue(variants,ask).then(function(f){ return {hits:f, all:all}; });
    });
  }).then(function(r){
    if(seq!==sugSeq) return;
    if(r.hits.length) renderSuggestions(r.hits,ask);
    else noMatchNote(q,r.all,ask);
  }).catch(function(){ if(seq===sugSeq) showSugNote("Search failed — check your connection and try again."); });
}
var STATE_ABBR={"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"};
function abbrState(s){ return STATE_ABBR[s]||s; }
function cleanPlace(s){ return String(s||"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,80); }
function pickSuggestion(i){
  var s=sugItems[i]; if(!s) return;
  hideSug();
  var inp=document.getElementById("locSearch");
  inp.value=""; inp.blur();
  setLocation({name:cleanPlace(s.name),lat:s.lat,lon:s.lon,station:null,precision:"representative"},{save:true});
}
/* The .hot style was in the sheet from the start with nothing ever applying it — the list could
   only be clicked. Arrow keys move it, Enter takes it, and the row scrolls itself into view for
   the short list the phone layout shows. */
function moveHot(d){
  if(!sugItems.length) return;
  sugHot=(sugHot+d+sugItems.length)%sugItems.length;
  var rows=document.getElementById("locSug").querySelectorAll(".sug");
  for(var i=0;i<rows.length;i++){
    var on=(i===sugHot);
    rows[i].classList.toggle("hot",on);
    rows[i].setAttribute("aria-selected",on?"true":"false");
    if(on&&rows[i].scrollIntoView) rows[i].scrollIntoView({block:"nearest"});
  }
  sugAria(true,"locSugOpt"+sugHot);
}
function initLocationUI(){
  var inp=document.getElementById("locSearch"), form=document.getElementById("locForm"), box=document.getElementById("locSug");
  ensureLsxCounties();   // warm the LSX county whitelist so the first search is instant
  document.getElementById("geoBtn").addEventListener("click",function(){ useMyLocation(true); });
  document.getElementById("stickyLocation").addEventListener("click",function(e){e.preventDefault();inp.scrollIntoView({block:"center"});inp.focus({preventScroll:true});});
  document.getElementById("favoriteToggle").addEventListener("click",function(){
    var key=locationKey(current), found=favoriteLocations.some(function(l){return locationKey(l)===key;});
    if(found) favoriteLocations=favoriteLocations.filter(function(l){return locationKey(l)!==key;});
    else if(favoriteLocations.length<20) favoriteLocations.push(validLocation(current));
    else{locationFeedback("Remove a favorite before saving another; up to 20 are supported.");return;}
    saveFavorites();syncLocationTools();locationFeedback(found?"Favorite removed.":"Location saved to favorites.");
  });
  document.getElementById("favoriteSelect").addEventListener("change",function(){
    var key=this.value;document.getElementById("favoriteRemove").disabled=!key;
    var loc=favoriteLocations.filter(function(l){return locationKey(l)===key;})[0];if(loc) chooseVerifiedLocation(loc,{save:true});
  });
  document.getElementById("favoriteRemove").addEventListener("click",function(){
    var key=document.getElementById("favoriteSelect").value;
    favoriteLocations=favoriteLocations.filter(function(l){return locationKey(l)!==key;});saveFavorites();syncLocationTools();locationFeedback("Favorite removed.");
  });
  document.getElementById("shareLocation").addEventListener("click",function(){
    var link=document.getElementById("locationLink"), url=locationURL(current);link.value=url;
    function manual(){link.focus();link.select();locationFeedback("Select and copy the location link.");}
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function(){locationFeedback("Location link copied.");}).catch(manual);
    else manual();
  });
  inp.addEventListener("input",function(){
    clearTimeout(sugTimer);
    var q=inp.value.trim();
    if(q.length<2){ hideSug(); return; }
    sugTimer=setTimeout(function(){ fetchSuggestions(q); },300);
  });
  form.addEventListener("submit",function(e){   // iOS "search"/"go" key lands here reliably
    e.preventDefault();
    if(sugItems.length){ pickSuggestion(sugHot>=0?sugHot:0); }
    else{
      var q=inp.value.trim();
      if(q.length>=2){ clearTimeout(sugTimer); fetchSuggestions(q); }
    }
  });
  box.addEventListener("mousedown",function(e){ // mousedown beats input blur
    var s=e.target.closest(".sug");
    if(s){ e.preventDefault(); pickSuggestion(+s.dataset.i); }
  });
  inp.addEventListener("keydown",function(e){
    if(e.key==="Escape"){ hideSug(); return; }
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault(); moveHot(e.key==="ArrowDown"?1:-1); }
  });
  inp.addEventListener("blur",function(){ setTimeout(hideSug,250); });
}
function initLocation(){
  var saved=readLoc(), shared=sharedLocation(location.search);
  if(saved) current=saved;
  if(shared){updateLocNow();chooseVerifiedLocation(shared,{save:true});return;}
  if(new URLSearchParams(location.search).has("lat")||new URLSearchParams(location.search).has("lon")) locationFeedback("The shared location link is invalid. Showing your saved or default location.");
  if(saved){updateLocNow();return;}
  updateLocNow();                 // shows the default preset while we ask
  useMyLocation(false);           // silent attempt; falls back to default if denied
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
    +'<div class="v" style="color:'+lv.c+'">'+val+'</div>'
    // Left genuinely empty when there is no detail (a UV of 2 has neither a burn clock nor a
    // higher peak to name), so .s:empty can collapse it rather than leaving a stray margin.
    +'<div class="s">'+(sub.length?'<span class="ex-b">'
      +sub.join('</span> <span class="ex-sep">·</span> <span class="ex-b">')+'</span>':'')+'</div>';
}
/* ============ BOTTOM LINE (né The Call — plain-English verdicts from data on hand) ============
   Near-term rules use the next ~24 hourly periods; later rules use NWS seven-day periods. AQI,
   local alerts and outlooks refine that picture. One candidate leads and up to three distinct
   topics support it. The hourly rain call is the near-term fallback; the daily feed can still
   give a briefing when the hourly service is unavailable. */
var callAqi=null;
var callRisk=null;   // {spc, ero, fire, wssi}, each [day1,day2] — raw dn/rank values from loadSpc
var callLocalAlert=null; // strongest active LSX alert covering the selected location, if known
var callAlertGroups=[]; // retained so an expiring warning can yield to another active local hazard

function renderBriefingEvidence(near,planning,H){
  var el=document.getElementById("briefEvidence"); if(!el) return;
  renderBriefingEvidence._models={near:near,planning:planning,hours:H};
  var sources={}, html="";
  [["Near-term guidance",near],["Later-week planning",planning]].forEach(function(pair){
    var model=pair[1]; if(!model||!model.lead) return;
    html+='<h3 class="brief-section-title">'+pair[0]+'</h3><dl>';
    [model.lead].concat(model.supports).forEach(function(c){
      var e=briefingEvidence(c,H);
      e.sources.forEach(function(k){sources[k]=true;});
      html+='<dt>'+esc(c.headline)+'</dt><dd>'+esc(e.reason)
        +(e.values.length?'<ul>'+e.values.map(function(v){return '<li>'+esc(v)+'</li>';}).join('')+'</ul>':'')
        +(e.limits.length?'<p>'+esc(e.limits.join(' '))+'</p>':'')+'</dd>';
    });
    html+='</dl>';
  });
  html+='<h3 class="brief-section-title">Sources and age</h3><ul>';
  Object.keys(sources).forEach(function(k){
    var cfg=FEEDS[k], c=feedChecks[k], state=feedState(c,Date.now(),cfg.age);
    var label=cfg.label+': '+(c.successAt?'last successful check '+timeAgo(new Date(c.successAt).toISOString()):'no successful check');
    label+=' · '+({ready:'verified',partial:'some data unavailable',stale:'check overdue',unavailable:'unavailable',saved:'saved and unverified',loading:'checking'}[state]||'unavailable');
    label+=c.issuedAt?' · source '+timeAgo(new Date(c.issuedAt).toISOString()):' · source issuance time not supplied';
    html+='<li>'+esc(label)+'</li>';
  });
  html+='</ul><p>Generated automatically for '+esc(current.name)+'. '+(current.precision==='representative'?'The selected town point may differ from your exact position. ':'')+'Official NWS warning instructions take precedence.</p>';
  if(el.innerHTML!==html) el.innerHTML=html;
}
function briefingComfortAllowed(){
  return feedState(feedChecks.alerts,Date.now(),FEEDS.alerts.age)==="ready"
    &&feedState(feedChecks.aqi,Date.now(),FEEDS.aqi.age)==="ready"&&callAqi!=null&&callAqi<=100;
}
function renderBriefingStatus(){
  var el=document.getElementById("briefStatus"); if(!el) return;
  var notes=[];
  if(feedState(feedChecks.alerts,Date.now(),FEEDS.alerts.age)!=="ready") notes.push("Alert status is unverified. Check official NWS warnings.");
  if(feedState(feedChecks.aqi,Date.now(),FEEDS.aqi.age)!=="ready") notes.push("Air quality is unverified; outdoor comfort guidance is limited.");
  el.textContent=notes.join(" "); el.hidden=!notes.length;
}
function renderTheCall(){
  var card=document.getElementById("callCard"), row=document.getElementById("callRow");
  if(!card||!row) return;
  var now=new Date(), H=bottomLineHours(forecastWindowHours(smart.hourlyAll,24,Date.now()));
  var hourlyReady=H.length>=6;
  var comfort=briefingComfortAllowed(); renderTheCall._comfortAllowed=comfort; renderBriefingStatus();
  var candidates=bottomLineHourlyCandidates(hourlyReady?H:[],{now:now,uvPeak:uv.peak,aqi:callAqi,allowComfort:comfort});
  var cutoff=hourlyReady?H[H.length-1].end:now;
  /* A local warning or emergency owns the immediate reading. Later forecasts cannot corroborate
     its timing, and should not compete for scarce space directly under the alert banner. */
  var weekEnabled=!callLocalAlert||!(callLocalAlert.level==="warning"||callLocalAlert.level==="emergency");
  var weekCandidates=weekEnabled?bottomLineWeekCandidates(smart.weekDays,cutoff,smart.hourlyAll):[];
  function push(pri,ico,topic,label,headline,detail,action,tone,context,opts){
    candidates.push(bottomCandidate(pri,ico,topic,label,headline,detail,action,tone,context,opts));
  }
  var horizon=document.getElementById("callHorizon");
  if(horizon) horizon.textContent=hourlyReady?bottomLineHorizon(H[H.length-1].end):"Today and tomorrow";

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

  var model=buildBottomLine(candidates,callLocalAlert), planning=buildBottomLine(weekCandidates,null);
  if(alertsRetained&&model.lead&&model.lead.alertAware) model.lead.detail=model.lead.detail.replace("Alert active locally","Last verified local alert");
  var planningEl=document.getElementById("briefPlanning");
  if(!model.lead&&!planning.lead){ card.classList.remove("has"); row.innerHTML="";planningEl.hidden=true;renderBriefingEvidence._models=null; return; }
  function tone(c){ return /^(danger|warning|good|context)$/.test(c.tone)?c.tone:"neutral"; }
  function detail(c){
    var parts=[];
    if(c.detail) parts.push('<span>'+esc(c.detail)+'</span>');
    if(c.action) parts.push('<strong>'+esc(c.action)+'</strong>');
    return parts.join(' ');
  }
  function section(model){
    if(!model.lead) return '<p class="muted">Near-term guidance unavailable. Check the official forecast and alerts.</p>';
    var lead=model.lead;
    return '<div class="bl-lead bl-tone-'+tone(lead)+'">'
    +'<div class="bl-lead-ico" aria-hidden="true">'+ic(lead.icon)+'</div><div>'
    +'<div class="bl-kicker">'+esc(lead.label)+'</div>'
    +'<div class="bl-headline">'+esc(lead.headline)+'</div>'
    +(lead.detail?'<div class="bl-detail">'+esc(lead.detail)+'</div>':'')
    +(lead.action?'<div class="bl-action">'+esc(lead.action)+'</div>':'')+'</div></div>'
    +(model.supports.length?'<ul class="bl-support" aria-label="Supporting considerations">'
      +model.supports.map(function(c){ return '<li class="bl-tone-'+tone(c)+'">'
        +'<span class="bl-sico" aria-hidden="true">'+ic(c.icon)+'</span><div>'
        +'<div class="bl-slabel">'+esc(c.label)+'</div><div class="bl-sheadline">'+esc(c.headline)+'</div>'
        +(detail(c)?'<div class="bl-sdetail">'+detail(c)+'</div>':'')+'</div></li>'; }).join('')+'</ul>':'');
  }
  row.innerHTML='<section id="briefNear"><h3 class="brief-section-title">Near-term guidance</h3>'+section(model)+'</section>';
  var planningFocused=planningEl.contains(document.activeElement);
  planningEl.hidden=!planning.lead;
  if(planning.lead){
    document.getElementById("briefPlanningTitle").textContent="Later-week planning · "+planning.lead.headline+" · "+bottomLineWeekHorizon(smart.weekDays);
    document.getElementById("briefPlanningBody").innerHTML=section(planning);
  }else if(planningFocused){document.querySelector("#briefWhy summary").focus({preventScroll:true});}
  renderBriefingEvidence(model,planning,H);
  card.classList.add("has");
}

/* ============ INSTANT PAINT (snapshot → localStorage → restore before any fetch) ============
   Return visits paint in one synchronous step, before a single network request. Cards are stored
   as already-rendered HTML, so there's no re-render cost either.
   Honesty rules, since this is weather data:
     · every fragment carries a TTL measured from its last successful weather check, not the save;
     · alerts, short-fused discussions and current observations are NEVER restored, so they only
       ever comes from a live fetch;
     · a snapshot is only reused for the same location it was taken at;
     · saved fragments and their cards stay labeled until that specific feed is verified or cleared. */
/* The key carries a version because a snapshot is RESTORED MARKUP, not data: it is painted under
   whatever stylesheet ships today. When the hero's footer became a tile pair, a v1 snapshot's old
   rows picked up the new tile chrome without their grid parent and the old context line — now a
   flex row — spread its words across the card. Reshape the markup, bump the key. One cold paint
   for a returning visitor beats a deployment's worth of visibly wrong first paints. */
// v3: emoji became <svg class="ic"> and the alert card's severity classes became one lv-* ramp.
// A v2 snapshot is markup that today's stylesheet has no rules for, so it must not be restored.
// v4: The Pulse moved above the hero band and gained its clamp, so #afd's markup carried an
// expander button. v5: the clamp came back out (measurement said it was guarding nothing — see
// the note in the CSS), so #afd is plain body-and-credit again. A v4 snapshot still holds that
// button, and nothing styles it any more: it would restore wearing the default 44px button skin
// with BOTH of its labels showing, reading "Read the full discussionShow less". Exactly the class
// of visibly-wrong first paint this version gate exists for, and it only reached real devices
// because the preview deploys were opened on one.
// v6: the "N alerts elsewhere" fold became an always-visible compact list, so #alerts no longer
// holds that <button> and #alertsElse is no longer display:none. A v5 snapshot restores both — a
// dashed toggle wearing the default button skin, above a block of cards nothing collapses, sitting
// where the local alerts belong. Same class of wrong first paint as v4's orphaned expander.
// v7: coverage alone decides which section a card sits in now, so a v6 snapshot of #alerts restores
// the OLD split — a distant tornado warning back in the local list, above the "elsewhere" heading,
// wearing an "Elsewhere in LSX" badge whose class no longer has a single rule behind it (measured:
// zero matching selectors, so it paints as bare inline text in the banner's flex row). Both halves
// of the contradiction this version was cut to remove, restored together. #alerts is the
// safety-critical part on the shortest leash, which makes it the worst one to be wrong on first
// paint — a reader who opens the page to check on a warning is the reader who gets the stale answer.
// v8: #daily gained the week summary/scale and its rows changed shape: compact condition text,
// visible H/L labels in high-first order, and rounded precipitation in the collapsed scan. A v7
// snapshot restores the old six-column row under the new fixed-width grid and silently loses the
// new answer-first context, so it needs one cold paint rather than a malformed first impression.
// v9: the fixed list of peak/rain/coolest facts became a headline plus supporting insights, and
// the weekly range endpoints gained their day labels. A v8 snapshot restores the old summary DOM
// under the new hierarchy and leaves the endpoint grid without its .fc-end wrappers.
// v10: the shared temperature bar gained a visible "7-day temperature scale · low → high"
// label. A v9 snapshot would restore the exact unlabeled bar this release is meant to clarify.
// v11: the shared weekly temperature bar was removed. A v10 snapshot would restore the rejected
// element even though today's renderer no longer creates it.
// v12: the loose summary sentences became a tone icon, labeled fact grid and separated source
// footer. A v11 snapshot would restore the old floating text under the new summary styles.
// v13: #callRow changed from an equal-weight pill cloud to a lead briefing plus semantic support
// list. A v12 snapshot would restore the old pills under rules that deliberately no longer exist.
// v14: outage-aware risk, rain and current-observation markup must replace old reassuring cards.
// Current readings, risk outlooks and the Bottom Line are fetched fresh on every open: their
// rendered timestamps and conclusions cannot be revalidated from a saved HTML snapshot.
// v15: #daily no longer includes the forecast overview. A v14 snapshot would restore that
// duplicate summary without its removed styles before the fresh forecast arrives.
// v16: the hourly chart has duration controls, day boundaries and an accessible detail slider.
// v17: saved fragments carry their original validated check times and Central Time labels.
// v18: the feed registry owns cached fragments; river rows include persistent pin controls.
// v19: time-scaled hourly gaps, dated climate comparisons and verified gauge timestamps.
var SNAP_KEY="lsxSnap_v20", snapRestored=false;
try{ ["lsxSnap_v1","lsxSnap_v3","lsxSnap_v4","lsxSnap_v5","lsxSnap_v6","lsxSnap_v7","lsxSnap_v8","lsxSnap_v9","lsxSnap_v10","lsxSnap_v11","lsxSnap_v12","lsxSnap_v13","lsxSnap_v14","lsxSnap_v15","lsxSnap_v16","lsxSnap_v17","lsxSnap_v18","lsxSnap_v19"].forEach(function(k){ localStorage.removeItem(k); }); }catch(e){}   // don't let dead snapshots crowd the live one
var SNAP_PARTS=Object.keys(FEEDS).reduce(function(parts,k){return parts.concat((FEEDS[k].snapshot||[]).map(function(p){return Object.assign({feed:k},p);}));},[]);
function saveSnapshot(){
  // Mid-transition the DOM still shows the OLD place while `current` is already the new one --
  // saving then would file the old cards under the new name. setLocation marks the generation
  // safe only once its loaders settle.
  if(locSeq!==snapSafeSeq) return;
  // Snapshots are keyed by COORDINATES, not the display name: geolocation always calls itself
  // "My Location", so a name-only match served the previous city's cards after you moved.
  var snap={t:Date.now(), loc:(current&&current.name)||"",
            lat:(current&&current.lat!=null)?+current.lat.toFixed(3):null,
            lon:(current&&current.lon!=null)?+current.lon.toFixed(3):null,
            wx:document.body.getAttribute("data-wx")||"", parts:{},feeds:{}};
  SNAP_PARTS.forEach(function(p){
    var c=feedChecks[p.feed];
    if(!c||!c.successAt||(!c.saved&&c.status!=="ready"&&c.status!=="partial")||Date.now()-c.successAt>p.ttl) return;
    var el=document.getElementById(p.id);
    if(!el) return;
    var h=el.innerHTML;
    if(!h||/class="loading"/.test(h)) return;   // never cache a spinner
    snap.parts[p.id]=h;
    snap.feeds[p.feed]={status:c.status,successAt:c.successAt,issuedAt:c.issuedAt};
  });
  if(!Object.keys(snap.parts).length) return;
  function put(){ localStorage.setItem(SNAP_KEY,JSON.stringify(snap)); }
  try{ put(); }
  catch(e){
    try{ delete snap.parts.hourly24; put(); }              // the SVG chart is far the biggest part
    catch(e2){ try{ localStorage.removeItem(SNAP_KEY); }catch(e3){} }
  }
}
/* Serialising ~22 cards of rendered HTML is real main-thread work. Two callers, two urgencies:
   the periodic save and the post-refresh save can wait for an idle moment, but the
   visibilitychange save CANNOT — the page may be frozen or discarded the instant after, so that
   one stays synchronous and accepts the hitch. */
function saveSnapshotIdle(){
  if(window.requestIdleCallback) requestIdleCallback(function(){ saveSnapshot(); },{timeout:2000});
  else setTimeout(saveSnapshot,0);
}
function showSnapBar(t){
  var bar=document.getElementById("snapBar"), txt=document.getElementById("snapBarText");
  if(!bar||!txt) return;
  txt.textContent="Saved view from "+new Date(t).toLocaleTimeString("en-US", {timeZone:WEATHER_TZ,hour:"numeric",minute:"2-digit"})+" · fetching live data…";
  bar.classList.add("show");
}
function resolveSnapBar(){
  var bar=document.getElementById("snapBar"), txt=document.getElementById("snapBarText");
  if(!bar||!bar.classList.contains("show")) return;
  if(!Object.keys(savedParts).length){ bar.classList.remove("show","offline"); return; }
  var failed=Object.keys(feedChecks).some(function(k){return feedChecks[k].status==="unavailable";});
  if(failed&&txt){
    bar.classList.add("offline");
    txt.textContent="Some saved data remain unverified. Check each card's timestamp; current weather services are partly unavailable.";
  }
}
function restoreSnapshot(){
  var snap=null;
  try{ var s=localStorage.getItem(SNAP_KEY); snap=s?JSON.parse(s):null; }catch(e){ return false; }
  if(!snap||!snap.t||!snap.parts||!snap.feeds) return false;
  var age=Date.now()-snap.t;
  if(age<0||age>48*3600000) return false;                       // clock moved or far too old
  if(snap.loc&&current&&snap.loc!==current.name) return false;  // numbers would describe another place
  if(current&&snap.lat!=null&&snap.lon!=null){                 // and same name != same place
    if(Math.abs(snap.lat-current.lat)>0.02||Math.abs(snap.lon-current.lon)>0.02) return false;
  }
  var n=0;
  SNAP_PARTS.forEach(function(p){
    var h=snap.parts[p.id];
    var c=snap.feeds[p.feed], checkedAge=c?Date.now()-c.successAt:Infinity;
    if(!h||!c||!c.successAt||checkedAge<0||checkedAge>p.ttl||(c.status!=="ready"&&c.status!=="partial")) return;
    var el=document.getElementById(p.id);
    if(!el) return;
    el.innerHTML=h; n++; savedParts[p.id]=p.feed;
    feedChecks[p.feed]={status:c.status,successAt:c.successAt,issuedAt:c.issuedAt||0,saved:true};
  });
  if(!n) return false;
  var riverEl=document.getElementById("rivers");
  if(riverEl){RIVERS.forEach(function(r){var a=riverEl.querySelector('[data-gauge="'+r.id+'"] a');if(a) riverRows[r.id]=a.outerHTML;});if(Object.keys(riverRows).length) renderRiverRows();}
  if(snap.wx) document.body.setAttribute("data-wx",snap.wx);
  var hourlyWrap=document.querySelector("#hourly24 .h24-wrap"), restoredHours=hourlyWrap?Number(hourlyWrap.getAttribute("data-hours")):24;
  if([24,48,72].indexOf(restoredHours)>=0) hourlyHours=restoredHours;
  var restoredCursor=document.getElementById("hourlyCursor"); if(restoredCursor) restoredCursor.disabled=true;
  syncHourlyControls();
  snapRestored=true;
  showSnapBar(snap.t); freshnessCheck();
  if(typeof scheduleMasonry==="function") scheduleMasonry();
  return true;
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

/* The DOM above is parsed; third-party downloads must never gate startup or context controls. */
var mapsCanStart=true, mapsInFlight=null;
var mapBoot={phase:"loading",started:Date.now(),events:[]};
function mapStage(detail){
  mapBoot.events.push(Math.round((Date.now()-mapBoot.started)/1000)+"s: "+detail);
  if(mapBoot.events.length>12)mapBoot.events.shift();
}
function mapDiagnosticsText(){
  return "Map bootstrap v1 · "+mapBoot.phase+" · document "+document.readyState+"\n"
    +"Libraries: Leaflet "+!!window.L+", MapLibre "+!!window.maplibregl+", adapter "+!!(window.L&&L.maplibreGL)+"\n"
    +"Radar: map "+!!rvMap+", panes "+document.querySelectorAll('#radar .leaflet-map-pane').length
    +", controls "+document.querySelectorAll('#radar .leaflet-control-zoom').length
    +", loaded tiles "+document.querySelectorAll('#radar .leaflet-tile-loaded').length+"\n"
    +mapBoot.events.join("\n");
}
function initMapDiagnostics(){
  var panel=document.createElement("details");panel.className="map-diagnostics";
  panel.innerHTML='<summary>Map diagnostics</summary><pre></pre><small>Diagnostic text stays on this device.</small>';
  panel.addEventListener("toggle",function(){if(panel.open)panel.querySelector('pre').textContent=mapDiagnosticsText();});
  document.getElementById("radar").closest(".maplock-wrap").after(panel);
}

function mapFallback(id){
  var el=document.getElementById(id);
  if(el&&el.closest(".maplock-wrap"))el.closest(".maplock-wrap").classList.add("map-unavailable");
  var href=id==="radar"?"https://radar.weather.gov/station/KLSX/standard":"https://www.weather.gov/wrh/timeseries?site=KSTL";
  if(el) el.innerHTML='<div class="imgfail">Map didn’t load. <button type="button" data-retry-maps>Retry maps</button> <a href="'+href+'" target="_blank" rel="noopener">'+(id==="radar"?"Open NWS radar":"Open NWS obs")+' ↗</a></div>';
}
function ensureMapLibraries(){
  var libraries=[
    {part:"leaflet/1.9.4/",ready:function(){return !!window.L;}},
    {part:"maplibre-gl@5.24.0/",ready:function(){return !!window.maplibregl;}},
    {part:"maplibre-gl-leaflet@",ready:function(){return !!(window.L&&L.maplibreGL);}}
  ];
  var retryStyles=libraries.some(function(lib){return !lib.ready();});
  return libraries.reduce(function(chain,lib){return chain.then(function(){
    if(lib.ready()) return;
    var original=[].slice.call(document.querySelectorAll("script[data-map-src]")).filter(function(node){return node.getAttribute("data-map-src").indexOf(lib.part)>=0;})[0];
    if(!original) throw new Error("Map dependency unavailable");
    return new Promise(function(resolve,reject){
      var url=original.getAttribute("data-map-src"),controller=new AbortController(),settled=false;
      var label=lib.part+" ["+url+"]";
      mapStage("Requesting "+label);
      function done(err){
        if(settled)return;settled=true;clearTimeout(timer);
        mapStage(label+": "+(err?err.message:"ready"));
        if(err)reject(err);else resolve();
      }
      var timer=setTimeout(function(){done(new Error("Download timed out after 20s"));controller.abort();},20000);
      // Abort before execution: removing a script element alone does not reliably cancel its download.
      // Fetch enforces the descriptor's SRI; existing CSP permits inline execution of verified bytes.
      fetch(url,{mode:"cors",integrity:original.getAttribute("integrity")||"",signal:controller.signal})
        .then(function(response){if(!response.ok)throw new Error("HTTP "+response.status);return response.text();})
        .then(function(source){
          if(settled)return;
          var script=document.createElement("script");script.textContent=source;
          try{document.head.appendChild(script);done(lib.ready()?null:new Error("Library did not initialize"));}
          finally{script.remove();}
        }).catch(function(error){done(new Error("Download/integrity/CORS failure: "+error.message));});
    });
  });},Promise.resolve()).then(function(){
    // A CDN outage can also leave the map stylesheets unloaded.
    return Promise.all([].slice.call(document.querySelectorAll('link[rel="stylesheet"]')).filter(function(node){
      return /leaflet\/1\.9\.4\/|maplibre-gl@5\.24\.0\//.test(node.href)&&(retryStyles||!node.sheet||node.media==="print");
    }).map(function(original){
      return new Promise(function(resolve,reject){
        var link=document.createElement("link"),timer;
        mapStage("Loading CSS "+new URL(original.href).hostname+new URL(original.href).pathname);
        [].forEach.call(original.attributes,function(attr){link.setAttribute(attr.name,attr.value);});
        function done(err){
          clearTimeout(timer);link.onload=null;link.onerror=null;
          if(err){link.remove();reject(err);}else{original.remove();resolve();}
        }
        link.onload=function(){link.media="all";done();};link.onerror=function(){done(new Error("Map stylesheet unavailable"));};
        timer=setTimeout(function(){done(new Error("Map stylesheet timed out"));},20000);
        document.head.appendChild(link);
      });
    }));
  });
}
function removePartialMap(map){
  // MapLibre may throw before creating its GL map; the Leaflet adapter's onRemove then throws
  // too. Teardown must not prevent the fallback or leave a failed map eligible for reuse.
  try{if(map) map.remove();}catch(e){}
}
function ensureMaps(){
  if(!mapsCanStart||rvMap&&(stnMap||!feedRequested("stations"))) return Promise.resolve();
  if(mapsInFlight) return mapsInFlight;
  var theme=effectiveLight()?"light":"dark";
  mapBoot.phase="loading";mapStage("Starting maps");
  if(!rvMap){document.getElementById("radar").closest(".maplock-wrap").classList.add("map-unavailable");document.getElementById("radar").innerHTML='<div class="imgfail" role="status">Loading map…</div>';}
  syncRadarBadge();syncSkyMeta();
  mapsInFlight=ensureMapLibraries().then(function(){mapStage("Requesting basemap style (tiles.openfreemap.org)");return loadMapStyle(theme);}).then(function(style){
    if(!rvMap){
      try{document.getElementById("radar").innerHTML="";initRadarMap(style);document.getElementById("radar").closest(".maplock-wrap").classList.remove("map-unavailable");}
      catch(e){
        var failedRadar=rvMap;rvMap=null;rvBase=null;baseLabels=null;
        removePartialMap(failedRadar);mapBoot.phase="error";mapStage("Radar initialization: "+e.message);mapFallback("radar");
      }
    }
    if(!stnMap&&feedRequested("stations")){
      try{document.getElementById("stnmap").innerHTML="";initStationMap(style);renderStationLayer();}
      catch(e){
        var failedStation=stnMap;stnMap=null;stnBase=null;
        removePartialMap(failedStation);mapStage("Station initialization: "+e.message);mapFallback("stnmap");
      }
    }
    if((effectiveLight()?"light":"dark")!==theme){updateRadarBase();updateStationBase();}
  }).catch(function(error){
    mapBoot.phase="error";mapStage("Startup failed: "+error.message);
    if(!rvMap)mapFallback("radar");
    if(!stnMap&&feedRequested("stations"))mapFallback("stnmap");
  }).finally(function(){mapsInFlight=null;if(rvMap)mapBoot.phase="ready";syncRadarBadge();syncSkyMeta();});
  return mapsInFlight;
}
queueMicrotask(function(){initMapDiagnostics();initContextView();ensureMaps();});
document.addEventListener("click",function(e){if(e.target.closest("[data-retry-maps]"))ensureMaps();});

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
  if(document.hidden){ stopSchedule(); radarPauseLoop(); saveSnapshot(); }   // no drain while backgrounded; bank the view on the way out
  else { tick(); startSchedule(); runDue(); freshnessCheck(); } // catch up on return
});
syncTabMotion();   // a page opened into a background tab never gets the event
if(!document.hidden) startSchedule();
document.getElementById("refresh").addEventListener("click",function(){ refreshAll(); });

/* ---- JavaScript masonry: pack band cards by their REAL measured height ---- */
function layoutMasonry(){
  var m=document.querySelector(".masonry"); if(!m) return;
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
  //  Importance tiers come FIRST (so critical outlooks stay high and Deep-Dive Links stays at the bottom),
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
      cpcCard:8,        // week-ahead leanings
      linksCard:10      // deep-dive links — reference, lowest
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
    // Source text, disclosure and font metrics can change height after the mutation's frame.
    if(window.ResizeObserver){
      var sizes=new ResizeObserver(scheduleMasonry);
      [].forEach.call(m.children,function(card){if(card.classList.contains("card"))sizes.observe(card);});
    }
    // re-pack whenever a child image finishes loading
    [].slice.call(m.querySelectorAll("img")).forEach(function(img){ img.addEventListener("load",scheduleMasonry); img.addEventListener("error",scheduleMasonry); });
    // re-pack when card contents change (data loads in)
    if(window.MutationObserver){ _mObs=new MutationObserver(scheduleMasonry); _mObs.observe(m,_mObsOpts); }
  }
})();
scheduleMasonry();

/* The fixed forecast band has its own resize/content lifecycle now. */
(function(){
  var card=document.getElementById("forecastCard");
  if(window.ResizeObserver) new ResizeObserver(fitDayDates).observe(card);
  if(window.MutationObserver) new MutationObserver(fitDayDates).observe(card,{childList:true,subtree:true,characterData:true});
})();

/* Active navigation follows rendered geometry, including independent disclosures and repacking. */
(function(){
  var nav=document.getElementById("jumpNav"), bar=nav.parentElement, queued=false, clicked=null;
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
    var chosen=candidates.find(function(item){return item.link===clicked;});
    if(chosen&&active&&Math.abs(chosen.box.top-active.box.top)<=4)active=chosen;
    links.forEach(function(link){if(active&&link===active.link)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(update);}}
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);
  if(window.ResizeObserver)new ResizeObserver(schedule).observe(document.getElementById('main'));
  document.addEventListener('lsxlayout',schedule);
  document.addEventListener('toggle',schedule,true);
  nav.addEventListener('click',function(e){clicked=e.target.closest('a');schedule();});
  schedule();
})();
