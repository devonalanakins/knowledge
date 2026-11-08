/**
 * Source-only, separately keyed, encrypted D1 event inbox. No public route,
 * source-data import, direct Knowledge database write, or Access bypass.
 */
import {isAuthenticatedGitHubMerge} from './forward-github-capture.mjs';
const te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true});
const FORMAT='knowledge-capture-inbox-v1',MAX_ATTEMPTS=8,LEASE_MS=90_000;
const HASH=/^[A-Za-z0-9_-]{43}$/;
function fail(code){const e=new Error(code);e.code=code;throw e;}
function time(ms){if(!Number.isSafeInteger(ms)||ms<0)fail('INVALID_CLOCK');return new Date(ms).toISOString();}
function store(db){if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')fail('STORAGE_UNAVAILABLE');return db;}
function base64(b){return BufferFallback(b);}
function BufferFallback(b){let s='';for(const c of b)s+=String.fromCharCode(c);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decode(s){if(typeof s!=='string'||s.length>44000||!/^[\w-]+$/.test(s))fail('INVALID_SEAL');try{return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}catch{fail('INVALID_SEAL');}}
async function keys(hex){
 if(typeof hex!=='string'||!/^[0-9a-f]{64}$/.test(hex))fail('INBOX_KEY_UNAVAILABLE');
 const raw=Uint8Array.from(hex.match(/.{2}/g),s=>parseInt(s,16));
 let root;try{root=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);}finally{raw.fill(0);}
 const ctx={name:'HKDF',hash:'SHA-256',salt:te.encode('Knowledge capture inbox v1')};
 return {aes:await crypto.subtle.deriveKey({...ctx,info:te.encode('payload')},root,{name:'AES-GCM',length:256},false,['encrypt','decrypt']),
   mac:await crypto.subtle.deriveKey({...ctx,info:te.encode('index')},root,{name:'HMAC',hash:'SHA-256',length:256},false,['sign'])};
}
async function id(mac,eventKey){return base64(new Uint8Array(await crypto.subtle.sign('HMAC',mac,te.encode(FORMAT+'\0'+eventKey))));}
function keyIdValid(keyId){if(typeof keyId!=='string'||!/^[a-z0-9-]{1,32}$/.test(keyId))fail('INVALID_KEY_ID');}
function candidateValid(c){return c&&c.kind==='github.pr.merged'&&c.scope==='personal'&&c.classification==='nonclinical'&&c.sourceAuthenticated===true&&['eventKey','path','title','body','sourceUrl'].every(k=>typeof c[k]==='string');}
async function seal(aes,keyId,index,c){
 const raw=te.encode(JSON.stringify(c));if(raw.byteLength>16384)fail('PAYLOAD_TOO_LARGE');
 const nonce=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:te.encode(FORMAT+'\0'+keyId+'\0'+index)},aes,raw);
 return JSON.stringify({format:FORMAT,keyId,nonce:base64(nonce),data:base64(new Uint8Array(bytes))});
}
async function unseal(aes,keyId,index,sealed){
 let e;try{e=JSON.parse(sealed);}catch{fail('INVALID_SEAL');}
 if(!e||e.format!==FORMAT||e.keyId!==keyId||Object.keys(e).length!==4)fail('INVALID_SEAL');
 const nonce=decode(e.nonce),data=decode(e.data);if(nonce.length!==12||data.length<17)fail('INVALID_SEAL');
 let plaintext;try{plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:te.encode(FORMAT+'\0'+keyId+'\0'+index)},aes,data);}catch{fail('INVALID_SEAL');}
 let c;try{c=JSON.parse(td.decode(plaintext));}catch{fail('INVALID_SEAL');}
 if(!candidateValid(c))fail('INVALID_SEAL');return c;
}
const GET="SELECT delivery_key,sealed,state,attempts,lease_id,lease_until,next_at,last_error,updated_at FROM knowledge_capture_inbox WHERE delivery_key=?";
async function get(db,i){return db.prepare(GET).bind(i).first();}
function exact(p,c){return p?.status==='draft'&&p.path===c.path&&p.title===c.title&&p.body===c.body&&p.sourceUrl===c.sourceUrl&&Number.isSafeInteger(p.version)&&p.version>0;}
async function persist(c,adapter){
 if(!adapter||typeof adapter.read!=='function'||typeof adapter.capture!=='function')fail('INVALID_ADAPTER');
 let first;try{first=await adapter.read(c.path);}catch{return {state:'retry',reason:'READ_FAILED'};}
 if(first!==null&&(!first||first.error||!first.page))return {state:'retry',reason:'READ_FAILED'};
 if(first?.page)return exact(first.page,c)?{state:'saved',version:first.page.version}:{state:'blocked',reason:'RECORD_CONFLICT'};
 try{await adapter.capture({path:c.path,title:c.title,body:c.body,sourceUrl:c.sourceUrl,expectedVersion:0});}
 catch(e){if(e?.code!=='VERSION_CONFLICT')return {state:'retry',reason:'WRITE_FAILED'};}
 let check;try{check=await adapter.read(c.path);}catch{return {state:'retry',reason:'READBACK_FAILED'};}
 if(exact(check?.page,c))return {state:'saved',version:check.page.version};
 return check?.page?{state:'blocked',reason:'RECORD_CONFLICT'}:{state:'retry',reason:'READBACK_FAILED'};
}
export async function enqueueCapture({db,rootHex,keyId,candidate,now=Date.now()}){
 store(db);keyIdValid(keyId);const t=time(now);
 if(!isAuthenticatedGitHubMerge(candidate))fail('UNVERIFIED_EVENT');
 const k=await keys(rootHex),i=await id(k.mac,candidate.eventKey),payload=await seal(k.aes,keyId,i,candidate);
 await db.prepare("INSERT INTO knowledge_capture_inbox (delivery_key,sealed,state,attempts,lease_id,lease_until,next_at,last_error,created_at,updated_at) VALUES (?,?,'queued',0,NULL,NULL,?,NULL,?,?) ON CONFLICT(delivery_key) DO NOTHING").bind(i,payload,t,t,t).run();
 const row=await get(db,i);if(!row)fail('STORAGE_UNAVAILABLE');
 const old=await unseal(k.aes,keyId,i,row.sealed);
 if(JSON.stringify(old)!==JSON.stringify(candidate))fail('EVENT_KEY_COLLISION');
 return {deliveryKey:i,state:row.state,attempts:row.attempts};
}
export async function claimCapture({db,rootHex,keyId,now=Date.now()}){
 store(db);keyIdValid(keyId);const t=time(now),k=await keys(rootHex);
 // A worker that crashes repeatedly cannot be reclaimed without limit.
 await db.prepare("UPDATE knowledge_capture_inbox SET state='failed',last_error='LEASE_EXHAUSTED',lease_id=NULL,lease_until=NULL,updated_at=? WHERE state='leased' AND lease_until<=? AND attempts>=?").bind(t,t,MAX_ATTEMPTS).run();
 for(let a=0;a<5;a++){
  const row=await db.prepare("SELECT delivery_key,sealed,state,updated_at FROM knowledge_capture_inbox WHERE attempts < 8 AND ((state='queued' AND next_at<=?) OR (state='leased' AND lease_until<=?)) ORDER BY next_at,created_at LIMIT 1").bind(t,t).first();
  if(!row)return null;
  const leaseId=crypto.randomUUID();
  const done=await db.prepare("UPDATE knowledge_capture_inbox SET state='leased',attempts=attempts+1,lease_id=?,lease_until=?,updated_at=? WHERE delivery_key=? AND state=? AND updated_at=? AND ((state='queued' AND next_at<=?) OR (state='leased' AND lease_until<=?))").bind(leaseId,time(now+LEASE_MS),t,row.delivery_key,row.state,row.updated_at,t,t).run();
  if(done?.meta?.changes!==1)continue;
  const c=await unseal(k.aes,keyId,row.delivery_key,row.sealed);
  if(await id(k.mac,c.eventKey)!==row.delivery_key)fail('INVALID_SEAL');
  return {deliveryKey:row.delivery_key,leaseId,candidate:c};
 }
 return null;
}
export async function processCapture({db,rootHex,keyId,lease,adapter,now=Date.now()}){
 store(db);keyIdValid(keyId);const t=time(now);
 if(!lease||!HASH.test(lease.deliveryKey)||typeof lease.leaseId!=='string')fail('INVALID_LEASE');
 const row=await get(db,lease.deliveryKey);
 if(!row||row.state!=='leased'||row.lease_id!==lease.leaseId||row.lease_until<t)return {status:'STALE_LEASE'};
 const k=await keys(rootHex),c=await unseal(k.aes,keyId,lease.deliveryKey,row.sealed);
 if(await id(k.mac,c.eventKey)!==lease.deliveryKey||JSON.stringify(c)!==JSON.stringify(lease.candidate))fail('INVALID_SEAL');
 const outcome=await persist(c,adapter);
 const state=outcome.state==='saved'?'saved':outcome.state==='blocked'?'blocked':row.attempts>=MAX_ATTEMPTS?'failed':'queued';
 const delay=Math.min(3600000,10000*2**Math.min(12,Math.max(0,row.attempts-1)));
 const next=state==='queued'?time(now+delay):t;
 const result=await db.prepare("UPDATE knowledge_capture_inbox SET state=?,last_error=?,next_at=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE delivery_key=? AND state='leased' AND lease_id=? AND lease_until>=?").bind(state,outcome.reason??null,next,t,lease.deliveryKey,lease.leaseId,t).run();
 if(result?.meta?.changes!==1)return {status:'STALE_LEASE'};
 const check=await get(db,lease.deliveryKey);
 if(!check||check.state!==state)fail('STORAGE_UNAVAILABLE');
 return {status:state==='saved'?'SAVED':state==='blocked'?'BLOCKED':state==='failed'?'FAILED':'PENDING_KNOWLEDGE_UNSAVED',
  deliveryKey:lease.deliveryKey,attempts:check.attempts,version:outcome.version??null,reason:outcome.reason??null,
  nextAt:state==='queued'?next:null};
}
export async function listCaptureStates({db,limit=50}){
 store(db);if(!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID_LIMIT');
 const result=await db.prepare("SELECT delivery_key,state,attempts,last_error,created_at,updated_at FROM knowledge_capture_inbox ORDER BY updated_at DESC LIMIT ?").bind(limit).all();
 if(!Array.isArray(result?.results))fail('STORAGE_UNAVAILABLE');return result.results;
}
export async function retryCapture({db,deliveryKey,now=Date.now()}){
 store(db);if(!HASH.test(deliveryKey))fail('INVALID_KEY');
 const t=time(now);
 const result=await db.prepare("UPDATE knowledge_capture_inbox SET state='queued',attempts=0,lease_id=NULL,lease_until=NULL,next_at=?,last_error=NULL,updated_at=? WHERE delivery_key=? AND state IN ('blocked','failed')").bind(t,t,deliveryKey).run();
 return result?.meta?.changes===1;
}
