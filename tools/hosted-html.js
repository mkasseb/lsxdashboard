'use strict';
// Exact bootstrap captured on the custom domain; only ray ID and base64 decimal time vary.
// Never use these comparison bytes to fulfill or rewrite a browser response.
const TEMPLATE="<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML=\"window.__CF$cv$params={r:'{{RAY}}',t:'{{STAMP}}'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);\";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>";
function applicationHtml(bytes,cfRay){
 const unchanged={bytes,injection:null};
 const end=bytes.lastIndexOf(Buffer.from('</body>'));
 if(end<0)return unchanged;
 const start=bytes.lastIndexOf(Buffer.from('<script>'),end);
 if(start<0)return unchanged;
 const tag=bytes.subarray(start,end),text=tag.toString('utf8');
 const fields=text.match(/window\.__CF\$cv\$params=\{r:'([a-f0-9]{16})',t:'([A-Za-z0-9+/]{14}==)'\};/);
 const ray=String(cfRay||'').match(/^([a-f0-9]{16})-[A-Z]{3}$/);
 if(!fields||!ray||fields[1]!==ray[1])return unchanged;
 const stamp=Buffer.from(fields[2],'base64').toString('ascii');
 if(!/^[0-9]{10}$/.test(stamp)||Buffer.from(stamp,'ascii').toString('base64')!==fields[2])return unchanged;
 const known=Buffer.from(TEMPLATE.replace('{{RAY}}',fields[1]).replace('{{STAMP}}',fields[2]));
 if(!tag.equals(known))return unchanged;
 return {bytes:Buffer.concat([bytes.subarray(0,start),bytes.subarray(end)]),injection:{kind:'Captured Cloudflare JS detection bootstrap',bytes:tag.length,ray:fields[1],timestamp:Number(stamp)}};
}
module.exports={applicationHtml};
