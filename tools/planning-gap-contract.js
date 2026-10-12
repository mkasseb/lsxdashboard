'use strict';
const assert=require('node:assert/strict');
// Serialize this function into either fixture or live-preview pages; inspect rendered boxes.
function planningGapGeometry(){
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,primary:box(document.querySelector('.planning-primary')),support:box(document.querySelector('.planning-support')),heading:box(document.querySelector('.railhead')),masonry:box(document.querySelector('.masonry')),cards:[...document.querySelectorAll('.card')].map(e=>({id:e.id,...box(e)})).filter(r=>r.width&&r.height),context:[...document.querySelectorAll('.masonry>.card')].map(e=>({id:e.id,...box(e)})).filter(r=>r.width&&r.height)};
}
function assertPlanningGap(g){
 assert(g.width>1000);assert(g.scrollWidth<=g.width+1,'No horizontal overflow');
 const short=g.primary.bottom<=g.support.bottom?g.primary:g.support;
 const headerGap=g.heading.y-short.bottom;
 assert(headerGap>=-1&&headerGap<=32,'Lower context must follow the shorter column, not wait for the taller one: '+headerGap+'px');
 assert(Math.abs(g.heading.x-short.x)<2&&g.heading.right<=short.right+1,'Context heading stays in the free column');
 const first=Math.min(...g.context.map(c=>c.y));assert(Math.abs(first-g.heading.bottom-16)<2,'Context cards immediately follow their heading');
 for(const c of g.context)for(const core of [g.primary,g.support]){
  if(Math.min(c.right,core.right)-Math.max(c.x,core.x)>1)assert(c.y>=core.bottom-1,'Context card '+c.id+' cannot enter occupied planning space');
 }
 for(let i=0;i<g.cards.length;i++)for(const b of g.cards.slice(i+1)){
  const a=g.cards[i];assert(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1,'Overlapping cards: '+a.id+' / '+b.id);
 }
 return {shortColumn:short===g.primary?'primary':'support',headerGap,coreDifference:Math.abs(g.primary.bottom-g.support.bottom),firstContextGap:first-g.heading.bottom};
}
module.exports={planningGapGeometry,assertPlanningGap};
