import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {verifySignedGitHubMerge} from '../src/forward-github-capture.mjs';
import {enqueueCapture,claimCapture,processCapture,listCaptureStates,retryCapture}
  from '../src/forward-capture-inbox.mjs';

const root='aabbccddeeff0011'.repeat(4);
const secret='fixture-signing-key-more-than-thirty-two-characters';
const keyId='inbox-v1';
const t0=Date.parse('2026-11-08T12:00:00Z');
const candidateEvent=(n=41)=>({action:'closed',number:n,
  repository:{id:98452,full_name:'devonalanakins/knowledge'},
  pull_request:{number:n,merged:true,merge_commit_sha:'a'.repeat(40),
    merged_at:'2026-11-08T11:30:00Z',title:'This untrusted text is not persisted'}});
async function candidate(n=41){
 const body=JSON.stringify(candidateEvent(n));
 return verifySignedGitHubMerge({body,secret,repositories:{
   'devonalanakins/knowledge':{scope:'personal',pathPrefix:'engineering/knowledge'}},
  headers:{'X-GitHub-Event':'pull_request','X-GitHub-Delivery':'8834ffad-bc19-41d1-83d9-2af9e349eed6',
    'X-Hub-Signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')}});
}
const ddl=readFileSync(new URL('../ops/private-forward/capture-inbox-v1.sql',import.meta.url),'utf8');
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(ddl);}
 prepare(sql){
  return {bind:(...params)=>({
   first:async()=>this.db.prepare(sql).get(...params)??null,
   all:async()=>({results:this.db.prepare(sql).all(...params)}),
   run:async()=>({meta:{changes:Number(this.db.prepare(sql).run(...params).changes)}}),
  })};
 }
 async batch(queries){return Promise.all(queries);}
 close(){this.db.close();}
}
function adapter(){
 const pages=new Map(),writes=[];
 return {pages,writes,
  async read(path){return pages.has(path)?{page:structuredClone(pages.get(path))}:null;},
  async capture(args){
   writes.push(args);
   const old=pages.get(args.path);
   if(args.expectedVersion!==(old?.version??0)){const e=Error('stale');e.code='VERSION_CONFLICT';throw e;}
   pages.set(args.path,{...args,status:'draft',version:(old?.version??0)+1});
  },
 };
}
async function queued(db,n=41){
 const c=await candidate(n);
 const receipt=await enqueueCapture({db,rootHex:root,keyId,candidate:c,now:t0});
 return {c,...receipt};
}
test('HMAC-verified merge enqueues encrypted only, deduplicates, leases, saves after exact readback',async()=>{
 const db=new D1();
 try{
  const {c,deliveryKey}=await queued(db),other=await queued(db);
  assert.equal(deliveryKey,other.deliveryKey);
  const raw=db.db.prepare('SELECT * FROM knowledge_capture_inbox').all();
  assert.equal(raw.length,1);assert.equal(raw[0].state,'queued');
  assert.doesNotMatch(JSON.stringify(raw),/devonalanakins|engineering|merge receipt|a{40}/);
  const claim=await claimCapture({db,rootHex:root,keyId,now:t0});
  assert.equal(claim.candidate.eventKey,c.eventKey);
  const writer=adapter();
  const result=await processCapture({db,rootHex:root,keyId,lease:claim,adapter:writer,now:t0+1000});
  assert.equal(result.status,'SAVED');assert.equal(result.version,1);
  assert.equal(writer.writes.length,1);
  assert.equal((await claimCapture({db,rootHex:root,keyId,now:t0+300000})),null);
  assert.equal((await queued(db)).state,'saved');
 }finally{db.close();}
});
test('forged unverified event, serial copy, and alternate secret cannot enter or read inbox',async()=>{
 const db=new D1();try{
  const c=await candidate();
  await assert.rejects(enqueueCapture({db,rootHex:root,keyId,candidate:{...c},now:t0}),{code:'UNVERIFIED_EVENT'});
  await assert.rejects(enqueueCapture({db,rootHex:root,keyId,candidate:JSON.parse(JSON.stringify(c)),now:t0}),{code:'UNVERIFIED_EVENT'});
  await queued(db);
  await assert.rejects(claimCapture({db,rootHex:'b'.repeat(64),keyId,now:t0}),{code:'INVALID_SEAL'});
  assert.equal((await listCaptureStates({db}))[0].state,'leased');
 }finally{db.close();}
});
test('existing conflicting draft is blocked without overwrite, operator retry is explicit',async()=>{
 const db=new D1();try{
  const {c,deliveryKey}=await queued(db),writer=adapter();
  writer.pages.set(c.path,{path:c.path,title:'Owner changed',body:'Preserve me',sourceUrl:null,status:'draft',version:7});
  const lease=await claimCapture({db,rootHex:root,keyId,now:t0});
  const result=await processCapture({db,rootHex:root,keyId,lease,adapter:writer,now:t0+1000});
  assert.equal(result.status,'BLOCKED');assert.equal(result.reason,'RECORD_CONFLICT');
  assert.equal(writer.pages.get(c.path).body,'Preserve me');
  assert.equal(writer.writes.length,0);
  assert.equal(await claimCapture({db,rootHex:root,keyId,now:t0+100000}),null);
  assert.equal(await retryCapture({db,deliveryKey,now:t0+100000}),true);
  assert.equal((await claimCapture({db,rootHex:root,keyId,now:t0+100000})).deliveryKey,deliveryKey);
 }finally{db.close();}
});
test('network failures stay pending, with due-time backoff and no fictional success',async()=>{
 const db=new D1();try{
  await queued(db);
  const claim=await claimCapture({db,rootHex:root,keyId,now:t0});
  const unavailable={read:async()=>{throw Error('offline');},capture:async()=>{throw Error('offline');}};
  const first=await processCapture({db,rootHex:root,keyId,lease:claim,adapter:unavailable,now:t0+1000});
  assert.equal(first.status,'PENDING_KNOWLEDGE_UNSAVED');
  assert.equal(first.reason,'READ_FAILED');
  assert.equal(await claimCapture({db,rootHex:root,keyId,now:t0+9000}),null);
  const next=await claimCapture({db,rootHex:root,keyId,now:t0+11000});
  assert.ok(next);
  const result=await processCapture({db,rootHex:root,keyId,lease:next,adapter:adapter(),now:t0+12000});
  assert.equal(result.status,'SAVED');
  assert.equal(result.attempts,2);
 }finally{db.close();}
});
test('a first write may succeed and fail readback; retry must not append another revision',async()=>{
 const db=new D1();try{
  await queued(db);const writer=adapter();
  let reads=0;
  const transport={capture:writer.capture,read:async path=>{
    reads++;
    if(reads===2)throw Error('readback timeout');
    return writer.read(path);
  }};
  const first=await claimCapture({db,rootHex:root,keyId,now:t0});
  const pending=await processCapture({db,rootHex:root,keyId,lease:first,adapter:transport,now:t0+1000});
  assert.equal(pending.reason,'READBACK_FAILED');assert.equal(writer.writes.length,1);
  const again=await claimCapture({db,rootHex:root,keyId,now:t0+11000});
  const result=await processCapture({db,rootHex:root,keyId,lease:again,adapter:transport,now:t0+12000});
  assert.equal(result.status,'SAVED');assert.equal(writer.writes.length,1);
  assert.equal(writer.pages.values().next().value.version,1);
 }finally{db.close();}
});
test('expired lease is reclaimed and old actor cannot overwrite newer saved result',async()=>{
 const db=new D1();try{
  await queued(db);
  const old=await claimCapture({db,rootHex:root,keyId,now:t0});
  const current=await claimCapture({db,rootHex:root,keyId,now:t0+91000});
  assert.notEqual(current.leaseId,old.leaseId);
  assert.equal((await processCapture({db,rootHex:root,keyId,lease:old,adapter:adapter(),now:t0+92000})).status,'STALE_LEASE');
  assert.equal((await processCapture({db,rootHex:root,keyId,lease:current,adapter:adapter(),now:t0+92000})).status,'SAVED');
 }finally{db.close();}
});
test('tampered ciphertext and inbox key mismatch fail closed',async()=>{
 const db=new D1();try{
  const {deliveryKey}=await queued(db);
  db.db.prepare('UPDATE knowledge_capture_inbox SET sealed=? WHERE delivery_key=?')
    .run('{"format":"knowledge-capture-inbox-v1","keyId":"inbox-v1","nonce":"aaaaaaaaaaaaaaaa","data":"bbbb"}',deliveryKey);
  await assert.rejects(claimCapture({db,rootHex:root,keyId,now:t0}),{code:'INVALID_SEAL'});
  assert.equal((await listCaptureStates({db}))[0].state,'leased');
 }finally{db.close();}
});
test('8 exhausted attempts enter failed and need explicit retry',async()=>{
 const db=new D1();try{
  const {deliveryKey}=await queued(db);
  let clock=t0;
  for(let i=0;i<8;i++){
   const lease=await claimCapture({db,rootHex:root,keyId,now:clock});
   assert.ok(lease);
   const status=await processCapture({db,rootHex:root,keyId,lease,
     adapter:{read:async()=>{throw Error('offline');},capture:async()=>{}},now:clock+1000});
   assert.equal(status.status,i===7?'FAILED':'PENDING_KNOWLEDGE_UNSAVED');
   clock=Date.parse(status.nextAt||new Date(clock+3600000).toISOString())+1000;
  }
  assert.equal(await claimCapture({db,rootHex:root,keyId,now:clock}),null);
  assert.equal((await listCaptureStates({db}))[0].last_error,'READ_FAILED');
  assert.equal(await retryCapture({db,deliveryKey,now:clock}),true);
  assert.ok(await claimCapture({db,rootHex:root,keyId,now:clock}));
 }finally{db.close();}
});
test('status listing omits encrypted content and operator controls enforce bounds',async()=>{
 const db=new D1();try{
  await queued(db);
  const states=await listCaptureStates({db});
  assert.equal(states.length,1);
  assert.equal(states[0].state,'queued');
  assert.ok(!('sealed' in states[0]));
  await assert.rejects(listCaptureStates({db,limit:101}),{code:'INVALID_LIMIT'});
  assert.equal(await retryCapture({db,deliveryKey:states[0].delivery_key,now:t0}),false);
 }finally{db.close();}
});

test('eight crashed leases exhaust into failed state and require explicit operator retry',async()=>{
 const db=new D1();try{
  const {deliveryKey}=await queued(db);
  for(let i=0;i<8;i++){
   const lease=await claimCapture({db,rootHex:root,keyId,now:t0+i*91000});
   assert.ok(lease);
  }
  assert.equal(await claimCapture({db,rootHex:root,keyId,now:t0+8*91000}),null);
  const row=(await listCaptureStates({db}))[0];
  assert.equal(row.state,'failed');
  assert.equal(row.last_error,'LEASE_EXHAUSTED');
  assert.equal(await retryCapture({db,deliveryKey,now:t0+8*91000}),true);
  assert.ok(await claimCapture({db,rootHex:root,keyId,now:t0+8*91000}));
 }finally{db.close();}
});
