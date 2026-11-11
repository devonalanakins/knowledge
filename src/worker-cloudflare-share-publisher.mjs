/**
 * Source-only, opt-in owner-reviewed publisher for a SEPARATE public snapshot store.
 * Never bind the private Knowledge D1 or private Knowledge encryption keys.
 * Deliberately accepts manually reviewed PUBLIC content, not a private wiki path.
 * No route is deployed or enabled by importing this module.
 */
import {renderSafeMarkdown} from './forward-safe-markdown.mjs';

const ACK='OWNER_REVIEWED_NONCLINICAL_SNAPSHOT_V1';
const CONFIRM='PUBLISH THIS SNAPSHOT';
const DECLARATION='PUBLIC_NONCLINICAL_REVIEWED';
const REVIEW_AGE=15*60*1000;
const SHARE_AGE=7*24*60*60*1000;
const MAX_FORM_BYTES=65536;
const MAX_BODY_BYTES=16384;
const encoder=new TextEncoder();
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STYLES=':root{color-scheme:light;font-family:system-ui,-apple-system,sans-serif;color:#263e36;background:#f3f6f1}*{box-sizing:border-box}body{margin:0}main{max-width:770px;margin:auto;padding:32px 20px 90px}h1{font:500 clamp(1.8rem,5vw,2.6rem)/1.18 Georgia,serif;letter-spacing:-.025em}h2{font:500 1.4rem Georgia,serif}p,li{line-height:1.6}a{color:#166451}label{display:block;font-weight:650;margin:19px 0 7px}input[type=text],textarea{width:100%;border:1px solid #9cb4a9;background:white;padding:12px;border-radius:8px;font:inherit;min-height:44px}textarea{min-height:240px}button{background:#184d3e;color:white;border:0;border-radius:8px;font:inherit;font-weight:650;padding:12px 20px;min-height:44px;cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #297960;outline-offset:2px}.notice{padding:14px;border-left:3px solid #bb8958;background:#faf3e9}.article{margin:23px 0;border:1px solid #cbd8d0;background:white;border-radius:12px;padding:24px;overflow-wrap:anywhere;line-height:1.72}.article h2,.article h3{margin-top:1.4em}.article pre{overflow:auto;background:#edf2ef;padding:14px;border-radius:7px}.article code{background:#edf2ef;padding:2px 5px}.link{overflow-wrap:anywhere;border:1px solid #bccdc3;padding:12px;border-radius:8px}.actions{display:flex;gap:13px;flex-wrap:wrap;margin:24px 0}.muted{color:#58736a;font-size:.85rem}table{border-collapse:collapse;width:100%;font-size:.84rem}th,td{text-align:left;padding:10px 6px;border-bottom:1px solid #c9d8d0;overflow-wrap:anywhere}th{font-weight:700}td form{margin:0}footer{border-top:1px solid #c9d8d0;margin-top:40px;padding-top:14px;color:#58736a;font-size:.83rem}@media(max-width:600px){main{padding:21px 14px 70px}.article{padding:16px}table,tbody,tr,td{display:block}thead{display:none}tr{border-bottom:1px solid #bccdc3;padding:8px 0}td{border:0;padding:3px 0}td:before{content:attr(data-label) ": ";font-weight:700}}';
const HEADERS={
 'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store',
 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; script-src 'none'; base-uri 'none'; frame-ancestors 'none'",
 'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
 'X-Robots-Tag':'noindex, nofollow, noarchive'
};
function html(status,body,method='GET'){
 return new Response(method==='HEAD'?null:body,{status,headers:HEADERS});
}
function layout(title,content){
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
   esc(title)+' · Knowledge sharing</title><style>'+STYLES+'</style></head><body><main>'+
   '<nav class="actions" aria-label="Sharing navigation"><a href="/share/new">New reviewed snapshot</a><a href="/share/manage">Shared snapshots</a></nav>'+
   content+'<footer>Owner-only publishing console. Never upload clinical, client, family, confidential, or otherwise restricted content.</footer>'+
   '</main></body></html>';
}
function page(status,title,body){return html(status,layout(title,body));}
function httpsOrigin(value){
 if(typeof value!=='string')return null;
 try {
  const u=new URL(value);
  return u.protocol==='https:'&&u.origin===value&&u.hostname.includes('.')&&!u.username&&!u.password?u.origin:null;
 } catch{return null;}
}
function settings(env){
 const publisher=httpsOrigin(env?.KNOWLEDGE_SHARE_PUBLISH_ORIGIN);
 const publicOrigin=httpsOrigin(env?.KNOWLEDGE_SHARE_PUBLIC_ORIGIN);
 if(env?.KNOWLEDGE_SHARE_PUBLISH_ACK!==ACK||
    env?.KNOWLEDGE_SHARE_DB_SCOPE_ACK!=='ISOLATED_PUBLIC_SNAPSHOTS_ONLY_V1'||
    !publisher||!publicOrigin||publisher===publicOrigin||
    !env?.KNOWLEDGE_SHARE_DB||typeof env.KNOWLEDGE_SHARE_DB.prepare!=='function'||
    typeof env.KNOWLEDGE_SHARE_ACCESS_AUD!=='string'||!/^[A-Za-z0-9_-]{12,128}$/.test(env.KNOWLEDGE_SHARE_ACCESS_AUD)||
    typeof env.KNOWLEDGE_SHARE_ACCESS_EMAIL!=='string'||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.KNOWLEDGE_SHARE_ACCESS_EMAIL)||
    env.KNOWLEDGE_SHARE_ACCESS_EMAIL!==env.KNOWLEDGE_SHARE_ACCESS_EMAIL.toLowerCase()||
    typeof env.KNOWLEDGE_SHARE_APPROVAL_KEY!=='string'||!/^[0-9a-f]{64}$/.test(env.KNOWLEDGE_SHARE_APPROVAL_KEY))
  return null;
 return {publisher,publicOrigin,db:env.KNOWLEDGE_SHARE_DB,
  aud:env.KNOWLEDGE_SHARE_ACCESS_AUD,email:env.KNOWLEDGE_SHARE_ACCESS_EMAIL,key:env.KNOWLEDGE_SHARE_APPROVAL_KEY};
}
async function authorized(cfg,ctx){
 if(!ctx?.access||ctx.access.aud!==cfg.aud||typeof ctx.access.getIdentity!=='function')return false;
 try {
  const identity=await ctx.access.getIdentity();
  return identity?.email===cfg.email;
 }catch{return false;}
}
async function mac(cfg,domain,parts){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(cfg.key.match(/../g),h=>parseInt(h,16)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 const data=encoder.encode(JSON.stringify(['knowledge-share-publisher-v1',domain,cfg.publisher,cfg.aud,cfg.email,...parts]));
 return {key,data};
}
function hex(b){return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function sign(cfg,domain,parts){
 const {key,data}=await mac(cfg,domain,parts);
 return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,data)));
}
async function verify(cfg,domain,parts,signature){
 if(typeof signature!=='string'||!/^[0-9a-f]{64}$/.test(signature))return false;
 const {key,data}=await mac(cfg,domain,parts);
 const bytes=Uint8Array.from(signature.match(/../g),h=>parseInt(h,16));
 return crypto.subtle.verify('HMAC',key,bytes,data);
}
function fresh(timestamp,now){
 if(typeof timestamp!=='string'||!/^[1-9][0-9]{11,14}$/.test(timestamp))return false;
 const t=Number(timestamp);
 return Number.isSafeInteger(t)&&t<=now+30000&&t>=now-REVIEW_AGE;
}
function validCopy(title,body){
 return typeof title==='string'&&title.trim().length>0&&title.trim().length<=160&&
   typeof body==='string'&&body.trim().length>0&&encoder.encode(body).byteLength<=MAX_BODY_BYTES&&
   !body.includes('[[')&&!body.includes(']]');
}
async function form(request,allowed){
 if(!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('content-type')??''))return {error:415};
 const stated=request.headers.get('content-length');
 if(stated&&/^\d+$/.test(stated)&&Number(stated)>MAX_FORM_BYTES)return {error:413};
 let raw='';
 try {
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const reader=request.body?.getReader();
  if(!reader)return {error:400};
  let size=0;
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>MAX_FORM_BYTES){await reader.cancel().catch(()=>{});return {error:413};}
   raw+=decoder.decode(value,{stream:true});
  }
  raw+=decoder.decode();
 }catch{return {error:400};}
 const params=new URLSearchParams(raw);
 if([...params.keys()].length!==allowed.length||allowed.some(k=>params.getAll(k).length!==1)||
    [...params.keys()].some(k=>!allowed.includes(k)))return {error:400};
 return {fields:Object.fromEntries(allowed.map(k=>[k,params.get(k)]))};
}
const hidden=(name,value)=>'<input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'">';
async function newForm(cfg,now){
 const issued=String(now);
 const csrf=await sign(cfg,'new',[issued]);
 return layout('New reviewed snapshot','<p class="muted">1 / 3 · Manually provide only information approved for public release</p>'+
   '<h1>Prepare a shareable snapshot</h1>'+
   '<p class="notice">This creates a completely separate public copy after a second confirmation. It does not share a private Knowledge page or its links. Do not paste clinical, client, family or confidential information.</p>'+
   '<form method="post" action="/share/preview">'+
   '<label for="title">Public title</label><input id="title" type="text" name="title" maxlength="160" required>'+
   '<label for="body">Reviewed public content (Markdown)</label><textarea id="body" name="body" required></textarea>'+
   '<label for="classification">Content classification</label><p class="muted">Type PUBLIC_NONCLINICAL_REVIEWED to confirm you have removed confidential, client and clinical information.</p>'+
   '<input id="classification" type="text" name="classification" required autocomplete="off">'+
   hidden('issued',issued)+hidden('csrf',csrf)+
   '<p><button type="submit">Review exact recipient copy</button></p></form>');
}
function reviewPage(cfg,title,body,issued,proof){
 return layout('Review recipient copy','<p class="muted">2 / 3 · Private owner review · not yet public</p>'+
   '<h1>Review the exact public copy</h1>'+
   '<p class="notice"><strong>No link has been issued.</strong> Confirm the title and every word below. Public recipients will see only a fixed copy. This review is not a clinical compliance check.</p>'+
   '<section class="article" aria-label="Recipient content preview"><h2>'+esc(title)+'</h2>'+
     renderSafeMarkdown(body,{internalLinks:false,externalLinks:false})+'</section>'+
   '<form method="post" action="/share/create">'+hidden('title',title)+hidden('body',body)+
     hidden('issued',issued)+hidden('proof',proof)+
   '<label for="confirmation">Type '+CONFIRM+' to authorize this exact snapshot for seven days</label>'+
   '<input id="confirmation" type="text" name="confirmation" required autocomplete="off">'+
   '<p><button type="submit">Issue seven-day public link</button></p></form>');
}
function issuedPage(cfg,title,token,expires){
 const link=cfg.publicOrigin+'/s/'+token;
 return layout('Snapshot link issued','<p class="muted">3 / 3 · Public capability issued</p><h1>Snapshot link created</h1>'+
   '<p>Anyone possessing this URL can read the reviewed copy until '+esc(expires)+
   ' or until you revoke it.</p><p class="link"><a href="'+esc(link)+'" rel="noreferrer noopener">'+esc(link)+'</a></p>'+
   '<p class="notice">Copy this link now. Knowledge stores only its hash, not the original link. It can still be revoked from Shared snapshots.</p>'+
   '<p><a href="/share/manage">Manage and revoke shared snapshots</a></p>');
}
async function managePage(cfg,now){
 const rows=await cfg.db.prepare(
   'SELECT token_hash,title,shared_version,approved_at,expires_at,revoked_at FROM knowledge_public_snapshots ORDER BY approved_at DESC LIMIT 100'
 ).all();
 if(!Array.isArray(rows?.results))throw Error('DB_ERROR');
 const list=rows.results.length?'<table><thead><tr><th>Snapshot</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>'+
   (await Promise.all(rows.results.map(async row=>{
    if(typeof row.token_hash!=='string'||!/^[0-9a-f]{64}$/.test(row.token_hash)||typeof row.title!=='string')throw Error('DB_ERROR');
    const active=row.revoked_at===null&&Date.parse(row.expires_at)>now;
    const issued=String(now),csrf=await sign(cfg,'revoke',[issued,row.token_hash]);
    return '<tr><td data-label="Snapshot">'+esc(row.title)+' · r'+Number(row.shared_version)+'</td>'+
     '<td data-label="Expires">'+esc(row.expires_at)+'</td><td data-label="Status">'+
     (active?'Active':row.revoked_at!==null?'Revoked':'Expired')+'</td>'+
     '<td data-label="Action">'+(active?'<form action="/share/revoke" method="post">'+
       hidden('tokenHash',row.token_hash)+hidden('issued',issued)+hidden('csrf',csrf)+
       '<button type="submit">Revoke</button></form>':'No access')+'</td></tr>';
   }))).join('')+'</tbody></table>':'<p>No public snapshots issued.</p>';
 return layout('Shared snapshots','<h1>Shared snapshots</h1><p class="muted">Owner-only management · latest 100 approvals · no original tokens stored</p>'+list);
}
export async function handleSharePublisher(request,env,ctx,{now=Date.now()}={}){
 const cfg=settings(env);
 if(!cfg)return html(503,'Sharing service unavailable');
 if(!await authorized(cfg,ctx))return html(403,'Access required');
 let url;
 try{url=new URL(request.url)}catch{return html(404,'Not found')}
 if(url.origin!==cfg.publisher||url.search||url.hash)return html(404,'Not found');
 try{
  if(request.method==='GET'&&url.pathname==='/share/new')return html(200,await newForm(cfg,now));
  if(request.method==='GET'&&url.pathname==='/share/manage')return html(200,await managePage(cfg,now));
  if(request.method!=='POST')return html(404,'Not found');
  if(url.pathname==='/share/preview'){
   const result=await form(request,['title','body','classification','issued','csrf']);
   if(result.error)return html(result.error,'Invalid form');
   const {title,body,classification,issued,csrf}=result.fields;
   if(!fresh(issued,now)||!await verify(cfg,'new',[issued],csrf))return html(403,'Approval expired or invalid');
   if(classification!==DECLARATION||!validCopy(title,body))return page(400,'Review needed','<h1>Invalid public copy</h1><p>Only specifically reviewed nonclinical content without private wiki references may be shared.</p>');
   const publicTitle=title.trim(),proof=await sign(cfg,'review',[issued,publicTitle,body,DECLARATION]);
   return html(200,reviewPage(cfg,publicTitle,body,issued,proof));
  }
  if(url.pathname==='/share/create'){
   const result=await form(request,['title','body','issued','proof','confirmation']);
   if(result.error)return html(result.error,'Invalid form');
   const {title,body,issued,proof,confirmation}=result.fields;
   if(confirmation!==CONFIRM||!validCopy(title,body)||title!==title.trim()||!fresh(issued,now)||
      !await verify(cfg,'review',[issued,title,body,DECLARATION],proof))
    return html(403,'Approval expired or invalid');
   const bytes=new Uint8Array(32);
   crypto.getRandomValues(bytes);
   const token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
   const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))));
   // A signed review can issue only one link, including under concurrent/replayed POSTs.
   const reviewHash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(proof))));
   const approved=new Date(now).toISOString(),expires=new Date(now+SHARE_AGE).toISOString();
   const inserted=await cfg.db.prepare(
     'INSERT INTO knowledge_public_snapshots(token_hash,review_proof_hash,title,body,shared_version,approval_status,approved_at,expires_at,revoked_at) VALUES(?,?,?,?,1,?,?,?,NULL)'
   ).bind(hash,reviewHash,title,body,'approved',approved,expires).run();
   if(inserted?.meta?.changes!==1)return html(503,'Unable to verify snapshot publication');
   const check=await cfg.db.prepare('SELECT review_proof_hash,title,body,shared_version,approval_status,approved_at,expires_at,revoked_at FROM knowledge_public_snapshots WHERE token_hash=?').bind(hash).first();
   if(!check||check.review_proof_hash!==reviewHash||check.title!==title||check.body!==body||check.shared_version!==1||check.approval_status!=='approved'||check.approved_at!==approved||check.expires_at!==expires||check.revoked_at!==null)
    return html(503,'Unable to verify snapshot publication');
   return html(200,issuedPage(cfg,title,token,expires));
  }
  if(url.pathname==='/share/revoke'){
   const result=await form(request,['tokenHash','issued','csrf']);
   if(result.error)return html(result.error,'Invalid form');
   const {tokenHash,issued,csrf}=result.fields;
   if(!/^[0-9a-f]{64}$/.test(tokenHash)||!fresh(issued,now)||!await verify(cfg,'revoke',[issued,tokenHash],csrf))
    return html(403,'Revocation authorization expired or invalid');
   const at=new Date(now).toISOString();
   const resultDb=await cfg.db.prepare('UPDATE knowledge_public_snapshots SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(at,tokenHash).run();
   if(resultDb?.meta?.changes!==1)return html(404,'Snapshot unavailable');
   const row=await cfg.db.prepare('SELECT revoked_at FROM knowledge_public_snapshots WHERE token_hash=?').bind(tokenHash).first();
   if(row?.revoked_at!==at)return html(503,'Unable to verify revocation');
   return page(200,'Revoked','<h1>Snapshot revoked</h1><p>The public viewer should now refuse this link. Previously downloaded copies cannot be recalled.</p><p><a href="/share/manage">Back to shared snapshots</a></p>');
  }
  return html(404,'Not found');
 }catch{
  return html(503,'Sharing service unavailable');
 }
}
export default {fetch(request,env,ctx){return handleSharePublisher(request,env,ctx);}};
