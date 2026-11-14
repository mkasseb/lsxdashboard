'use strict';
const assert=require('node:assert/strict');
// Serialize this function into either fixture or live-preview pages; inspect rendered boxes.
// The page is a stack of bands (Now + radar, promoted cards, forecasts, NWS text, context pack);
// CSS places them, and only the context pack is packed by script.
function layoutGeometry(){
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 const bands=['.top-band','#attention','.planning-grid','.nws-band'].map(s=>document.querySelector(s)).filter(e=>e&&!e.hidden).map(e=>({name:e.id||e.className,...box(e)}));
 return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bands,heading:box(document.querySelector('.railhead')),masonry:box(document.querySelector('.masonry')),cards:[...document.querySelectorAll('.card')].map(e=>({id:e.id,...box(e)})).filter(r=>r.width&&r.height),context:[...document.querySelectorAll('.masonry>.card')].map(e=>({id:e.id,...box(e)})).filter(r=>r.width&&r.height)};
}
function assertLayout(g){
 assert(g.scrollWidth<=g.width+1,'No horizontal overflow');
 for(let i=1;i<g.bands.length;i++){
  const gap=g.bands[i].y-g.bands[i-1].bottom;
  assert(gap>=-1&&gap<=32,'Band '+g.bands[i].name+' follows '+g.bands[i-1].name+' without overlap or a dead band: '+gap+'px');
 }
 const last=g.bands[g.bands.length-1],headerGap=g.heading.y-last.bottom;
 assert(headerGap>=-1&&headerGap<=40,'Context heading follows the last band: '+headerGap+'px');
 const first=g.context.length?Math.min(...g.context.map(c=>c.y)):g.masonry.y;
 assert(Math.abs(first-g.masonry.y)<2&&g.masonry.y>=g.heading.bottom-1,'Context cards immediately follow their heading');
 for(let i=0;i<g.cards.length;i++)for(const b of g.cards.slice(i+1)){
  const a=g.cards[i];if(a.id==='radarCard'&&b.id==='radarCard')continue;
  assert(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1,'Overlapping cards: '+a.id+' / '+b.id);
 }
 return {headerGap,bands:g.bands.map(b=>b.name),firstContextGap:first-g.heading.bottom};
}
module.exports={layoutGeometry,assertLayout};
