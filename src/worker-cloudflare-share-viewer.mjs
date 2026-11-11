/** Anonymous read-only viewer for EXPLICITLY REVIEWED, revision-pinned snapshots.
 * This Worker must bind ONLY the dedicated public snapshot D1, not private owner D1
 * or data keys. No creation/revocation route exists in this Worker.
 */
import {renderSafeMarkdown} from './forward-safe-markdown.mjs';

const ACK='REVIEWED_IMMUTABLE_SNAPSHOTS_ONLY_V1';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const encoder=new TextEncoder();
const esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const STYLES=':root{color-scheme:light;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f5f5f0;color:#223730}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:0 auto;padding:clamp(22px,5vw,58px) 22px 90px}header{border-bottom:1px solid #cfd9d3;padding-bottom:18px;margin-bottom:30px}.brand{font-size:.72rem;font-weight:750;letter-spacing:.15em;color:#396458}.kicker{font-size:.8rem;color:#58736b;letter-spacing:.06em;text-transform:uppercase}h1{font:500 clamp(2rem,5vw,3rem)/1.13 Georgia,serif;letter-spacing:-.02em;margin:17px 0 9px}h2,h3,h4,h5{font:500 1.35rem/1.3 Georgia,serif;margin:1.5em 0 .6em}article{font-size:1rem;line-height:1.74;overflow-wrap:anywhere}article p{margin:0 0 1em}article ul,article ol{padding-left:1.5rem}article li{margin:.3em 0}article code{background:#e5ede7;border-radius:4px;padding:.1em .3em;overflow-wrap:anywhere}article pre{background:#e9efeb;border:1px solid #d2dfd7;border-radius:9px;padding:15px;overflow:auto}article pre code{background:transparent;padding:0;white-space:pre}article blockquote{border-left:3px solid #98b6aa;margin:20px 0;padding:5px 16px;color:#39564a}a{color:#145747;text-decoration:underline;text-underline-offset:3px}a:focus-visible{outline:3px solid #187765;outline-offset:3px}footer{border-top:1px solid #cfd9d3;margin-top:35px;padding-top:18px;color:#566d64;font-size:.79rem;line-height:1.6}hr{border:0;border-top:1px solid #cfd9d3;margin:25px 0}';
const HEADERS={
 'Content-Type':'text/html; charset=utf-8',
 'Cache-Control':'no-store, max-age=0',
 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',
 'X-Robots-Tag':'noindex, nofollow, noarchive',
 'Cross-Origin-Resource-Policy':'same-origin',
};
function response(status,body,method='GET'){
 return new Response(method==='HEAD'?null:body,{status,headers:HEADERS});
}
function unavailable(method='GET'){
 return response(404,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page unavailable · Knowledge</title><style>'+STYLES+'</style><main><p class="brand">KNOWLEDGE</p><h1>Page unavailable</h1><p>This link may have expired or been revoked.</p></main></html>',method);
}
function settings(env){
 if(env?.KNOWLEDGE_PUBLIC_SHARE_ACK!==ACK||
   !env.KNOWLEDGE_SHARE_DB||typeof env.KNOWLEDGE_SHARE_DB.prepare!=='function'||
   typeof env.KNOWLEDGE_SHARE_ORIGIN!=='string')return null;
 try{
   const url=new URL(env.KNOWLEDGE_SHARE_ORIGIN);
   if(url.origin!==env.KNOWLEDGE_SHARE_ORIGIN || url.protocol!=='https:' ||
      url.username||url.password||url.pathname!=='/'||url.search||url.hash||
      !url.hostname.includes('.'))return null;
   return {origin:url.origin,db:env.KNOWLEDGE_SHARE_DB};
 }catch{return null;}
}
async function hashToken(token){
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token)));
 return [...digest].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function validDate(value){
 if(typeof value!=='string')return false;
 const time=Date.parse(value);
 return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
   Number.isFinite(time);
}
function validSnapshot(row){
 return row&&row.approval_status==='approved'&&
   typeof row.title==='string'&&row.title.length>0&&row.title.length<=160&&
   typeof row.body==='string'&&encoder.encode(row.body).length<=16384&&
   Number.isInteger(row.shared_version)&&row.shared_version>=1&&row.shared_version<=128&&
   validDate(row.approved_at)&&validDate(row.expires_at)&&
   (row.revoked_at===null||validDate(row.revoked_at));
}
export function renderPublicSnapshot(snapshot){
 if(!validSnapshot(snapshot)||snapshot.revoked_at!==null||
    Date.parse(snapshot.expires_at)<=Date.parse(snapshot.approved_at))
   throw new Error('INVALID_SHARE_SNAPSHOT');
 const html=renderSafeMarkdown(snapshot.body,{internalLinks:false,externalLinks:false});
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>'+
   esc(snapshot.title)+' · Knowledge shared snapshot</title><style>'+STYLES+'</style></head><body>'+
   '<main><header><p class="brand">KNOWLEDGE</p><p class="kicker">Shared read-only snapshot</p>'+
   '<h1>'+esc(snapshot.title)+'</h1><p class="kicker">Revision '+snapshot.shared_version+'</p></header>'+
   '<article aria-label="Shared page content">'+html+'</article>'+
   '<footer>Approved snapshot: <time>'+esc(snapshot.approved_at)+'</time>. Link expires: <time>'+
   esc(snapshot.expires_at)+'</time>. This is a fixed copy; later private edits are not shared. '+
   'Anyone with this URL can view this approved snapshot until it expires or is revoked.</footer></main></body></html>';
}
export async function handlePublicShareViewer(request,env,{now=Date.now()}={}){
 const cfg=settings(env);
 if(!cfg)return response(503,'Service unavailable');
 let url;
 try{url=new URL(request.url);}catch{return unavailable(request.method);}
 if(url.origin!==cfg.origin||url.search||url.hash||!['GET','HEAD'].includes(request.method))
   return unavailable(request.method);
 const matched=/^\/s\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
 if(!matched||!TOKEN.test(matched[1]))return unavailable(request.method);
 try{
   const tokenHash=await hashToken(matched[1]);
   const row=await cfg.db.prepare('SELECT title,body,shared_version,approval_status,approved_at,expires_at,revoked_at FROM knowledge_public_snapshots WHERE token_hash = ? LIMIT 1').bind(tokenHash).first();
   if(!row)return unavailable(request.method);
   // Malformed approved records must fail closed. Never display raw storage data.
   if(!validSnapshot(row))return response(503,'Service unavailable',request.method);
   if(row.revoked_at!==null||Date.parse(row.expires_at)<=now)
     return unavailable(request.method);
   return response(200,renderPublicSnapshot(row),request.method);
 }catch{return response(503,'Service unavailable',request.method);}
}
export default {fetch(request,env){return handlePublicShareViewer(request,env);}};
