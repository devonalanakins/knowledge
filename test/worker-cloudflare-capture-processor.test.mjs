import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleGitHubCaptureIngress} from '../src/worker-cloudflare-capture-ingress.mjs';
import {handlePrivateKnowledgeWorker,handlePrivateMergeCapture}
 from '../src/worker-cloudflare-private.mjs';
import captureProcessor,{drainCaptureInbox,PROCESSOR_CRON}
 from '../src/worker-cloudflare-capture-processor.mjs';
import {listCaptureStates} from '../src/forward-capture-inbox.mjs';
import canaryWorker,{runRuntimeCanary,CANARY_ACK,CANARY_NUMBER,CANARY_REPO_ID} from '../src/worker-cloudflare-capture-canary.mjs';

const inboxSchema=readFileSync(new URL('../ops/private-forward/capture-inbox-v1.sql',import.meta.url),'utf8');
const ownerSchema=readFileSync(new URL('../ops/private-forward/schema.sql',import.meta.url),'utf8');
const signingSecret='fictional-github-event-signing-secret-2026';
const inboxHex='cd'.repeat(32);
const machineHex='ab'.repeat(32);
const ownerHex='89'.repeat(32);
const repoName='devonalanakins/knowledge';
const repoId=98452;
const path='engineering/knowledge/pr-36';
const url='https://capture.example.test/github';
const resource='https://knowledge.example.test/mcp';
const t0=Date.now();
// Test-only, never a provider fetch: canonical PR #36 authoritative fixture.
// The integration tests continue to exercise the actual ingress verifier.
globalThis.fetch=async(url,options)=>{
 assert.equal(url,'https://api.github.com/repos/devonalanakins/knowledge/pulls/36');
 assert.equal(options.method,'GET');
 assert.equal(options.redirect,'error');
 return new Response(JSON.stringify({
  number:36,state:'closed',merged:true,
  merged_at:'2026-11-08T13:30:00Z',merge_commit_sha:'a'.repeat(40),
  base:{ref:'main',repo:{id:repoId,full_name:repoName}},
 }),{status:200,headers:{'Content-Type':'application/json'}});
};


class TestD1 {
 constructor(schema){this.db=new DatabaseSync(':memory:');this.db.exec(schema);}
 prepare(sql){return {
  bind:(...params)=>({
   first:async()=>this.db.prepare(sql).get(...params)??null,
   all:async()=>({results:this.db.prepare(sql).all(...params)}),
   run:async()=>({meta:{changes:Number(this.db.prepare(sql).run(...params).changes)}}),
  }),
  first:async()=>this.db.prepare(sql).get()??null,
  all:async()=>({results:this.db.prepare(sql).all()}),
  run:async()=>({meta:{changes:Number(this.db.prepare(sql).run().changes)}}),
 };}
 async batch(queries){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const result=[];for(const q of queries)result.push(await q.run());
   this.db.exec('COMMIT');return result;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
function setup(){
 const inbox=new TestD1(inboxSchema),owner=new TestD1(ownerSchema);
 const ownerEnv={
  KNOWLEDGE_PRIVATE_WORKER_ACK:'OWNER_ONLY_DRAFTS_NO_IMPORT',
  KNOWLEDGE_PRIVATE_WRITE_ACK:'DRAFT_CAPTURE_ALLOWED',
  KNOWLEDGE_WORKER_RESOURCE:resource,
  KNOWLEDGE_ACCESS_AUD:'fictional-test-access-aud',
  KNOWLEDGE_ACCESS_EMAIL:'owner@example.test',
  KNOWLEDGE_SPACE:'personal',KNOWLEDGE_KEY_ID:'v1',
  KNOWLEDGE_DATA_KEY:ownerHex,KNOWLEDGE_DB:owner,
  KNOWLEDGE_MACHINE_CAPTURE_ACK:'APPROVED_PERSONAL_GITHUB_MERGE_V1',
  KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX:machineHex,
  KNOWLEDGE_MACHINE_CAPTURE_REPO_NAME:repoName,
  KNOWLEDGE_MACHINE_CAPTURE_REPO_ID:String(repoId),
  KNOWLEDGE_MACHINE_CAPTURE_PREFIX:'engineering/knowledge',
 };
 const ingressEnv={
  CAPTURE_INGRESS_ACK:'SIGNED_GITHUB_CAPTURE_INBOX_V1',
  CAPTURE_INGRESS_URL:url,
  CAPTURE_WEBHOOK_SECRET:signingSecret,
  CAPTURE_INBOX_ROOT_HEX:inboxHex,CAPTURE_INBOX_KEY_ID:'inbox-v1',
  CAPTURE_INBOX_DB:inbox,
  CAPTURE_REPOSITORIES_JSON:JSON.stringify({
   [repoName]:{repoId,scope:'personal',pathPrefix:'engineering/knowledge'},
  }),
 };
 let serviceWrites=0;
 const processorEnv={
  CAPTURE_PROCESSOR_ACK:'OWNER_ONLY_SIGNED_MERGE_PROCESSOR_V1',
  CAPTURE_INBOX_ROOT_HEX:inboxHex,CAPTURE_INBOX_KEY_ID:'inbox-v1',
  CAPTURE_INBOX_DB:inbox,
  CAPTURE_MACHINE_AUTH_KEY_HEX:machineHex,
  KNOWLEDGE_CAPTURE_WRITER:{
   async saveMergeReceipt(payload){
    serviceWrites++;
    return handlePrivateMergeCapture(ownerEnv,payload,payload.issuedAt);
   },
  },
 };
 return {inbox,owner,ownerEnv,ingressEnv,processorEnv,
  getServiceWrites:()=>serviceWrites,close:()=>{inbox.close();owner.close();}};
}
function event(){
 return {action:'closed',number:36,repository:{id:repoId,full_name:repoName},
  pull_request:{number:36,merged:true,merge_commit_sha:'a'.repeat(40),
   merged_at:'2026-11-08T13:30:00Z',
   title:'Do not retain untrusted text',body:'private test text'}};
}
async function webhook(env,data=event(),alter={}){
 const raw=JSON.stringify(data);
 const headers={'Content-Type':'application/json',
  'X-GitHub-Event':'pull_request',
  'X-GitHub-Delivery':'e7624b46-7e6c-49b2-a74c-4fdf0b726fac',
  'X-Hub-Signature-256':'sha256='+createHmac('sha256',signingSecret).update(raw).digest('hex'),...alter};
 const request=new Request(url,{method:'POST',headers,body:raw});
 return handleGitHubCaptureIngress(request,env);
}
async function readOwner(env,p){
 const msg={jsonrpc:'2.0',id:1,method:'tools/call',
  params:{name:'knowledge_read',arguments:{path:p}}};
 const r=await handlePrivateKnowledgeWorker(new Request(resource,{
  method:'POST',
  headers:{'Content-Type':'application/json',
   'Accept':'application/json, text/event-stream',
   'MCP-Protocol-Version':'2025-11-25'},
  body:JSON.stringify(msg),
 }),env,{access:{aud:'fictional-test-access-aud',
  getIdentity:async()=>({email:'owner@example.test'})}});
 const result=await r.json();
 return result?.result?.structuredContent?.page??null;
}
test('signed GitHub -> encrypted inbox -> nonpublic machine RPC -> verified owner readback',async()=>{
 const fx=setup();try{
  assert.equal((await webhook(fx.ingressEnv)).status,202);
  const raw=JSON.stringify(fx.inbox.db.prepare('SELECT * FROM knowledge_capture_inbox').all());
  assert.doesNotMatch(raw,/private test text|devonalanakins|engineering\/knowledge/);
  const before=await readOwner(fx.ownerEnv,path);
  assert.equal(before,null);
  const done=await drainCaptureInbox(fx.processorEnv,{now:t0+5000});
  assert.deepEqual(done,{attempted:1,saved:1,pending:0,blocked:0,failed:0,stale:0});
  const after=await readOwner(fx.ownerEnv,path);
  assert.equal(after?.version,1);
  assert.equal(after?.status,'draft');
  assert.match(after?.body??'',/SOURCE-EVENT VERIFIED/);
  assert.match(after?.sourceUrl??'',/pull\/36$/);
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,1);
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
  assert.equal((await listCaptureStates({db:fx.inbox}))[0].state,'saved');
  assert.equal((await webhook(fx.ingressEnv)).status,202);
  const duplicate=await drainCaptureInbox(fx.processorEnv,{now:t0+10000});
  assert.equal(duplicate.attempted,0);
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
 }finally{fx.close();}
});
test('wrong machine proof cannot be mistaken for success, then retries safely',async()=>{
 const fx=setup();try{
  assert.equal((await webhook(fx.ingressEnv)).status,202);
  fx.processorEnv.CAPTURE_MACHINE_AUTH_KEY_HEX='ef'.repeat(32);
  const fail=await drainCaptureInbox(fx.processorEnv,{now:t0+5000});
  assert.equal(fail.pending,1);assert.equal(fail.saved,0);
  assert.equal((await listCaptureStates({db:fx.inbox}))[0].last_error,'READBACK_FAILED');
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
  fx.processorEnv.CAPTURE_MACHINE_AUTH_KEY_HEX=machineHex;
  assert.equal((await drainCaptureInbox(fx.processorEnv,{now:t0+10000})).attempted,0);
  const retry=await drainCaptureInbox(fx.processorEnv,{now:t0+16000});
  assert.equal(retry.saved,1);
  assert.equal((await readOwner(fx.ownerEnv,path))?.version,1);
 }finally{fx.close();}
});
test('missing private service binding never consumes event as successful Knowledge save',async()=>{
 const fx=setup();try{
  assert.equal((await webhook(fx.ingressEnv)).status,202);
  await assert.rejects(drainCaptureInbox({...fx.processorEnv,KNOWLEDGE_CAPTURE_WRITER:null},{now:t0+5000}),
   /KNOWLEDGE_CAPTURE_PROCESSOR_DISABLED/);
  assert.equal((await listCaptureStates({db:fx.inbox}))[0].state,'queued');
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
 }finally{fx.close();}
});
test('lying or malformed RPC success replies do not mark an event SAVED',async()=>{
 const fx=setup();try{
  assert.equal((await webhook(fx.ingressEnv)).status,202);
  const broken={...fx.processorEnv,KNOWLEDGE_CAPTURE_WRITER:{
   saveMergeReceipt:async()=>({status:'SAVED',version:1}),
  }};
  const result=await drainCaptureInbox(broken,{now:t0+5000});
  assert.equal(result.pending,1);
  assert.equal((await listCaptureStates({db:fx.inbox}))[0].state,'queued');
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
 }finally{fx.close();}
});
test('wrong-path and wrong-event success replies cannot acknowledge another receipt',async()=>{
 for (const reply of [
  {status:'SAVED',action:'verified',version:1,path:'engineering/knowledge/pr-999',eventKey:'wrong-event'},
  {status:'SAVED',action:'verified',version:1,path, eventKey:'wrong-event'},
  {status:'SAVED',action:'unchanged',version:1,path:'engineering/knowledge/pr-999',eventKey:'wrong-event'},
  {status:'SAVED',action:'verified',version:1},
 ]) {
  const fx=setup();
  try {
   assert.equal((await webhook(fx.ingressEnv)).status,202);
   const fake={...fx.processorEnv,KNOWLEDGE_CAPTURE_WRITER:{saveMergeReceipt:async()=>reply}};
   const result=await drainCaptureInbox(fake,{now:t0+5000});
   assert.equal(result.saved,0);
   assert.equal(result.pending,1);
   const [row]=await listCaptureStates({db:fx.inbox});
   assert.equal(row.state,'queued');
   assert.equal(row.last_error,'READBACK_FAILED');
   assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
  } finally {fx.close();}
 }
});
test('closed but unmerged GitHub event stays ignored without touching owner D1',async()=>{
 const fx=setup();try{
  const e=event();e.pull_request.merged=false;
  assert.equal((await webhook(fx.ingressEnv,e)).status,204);
  assert.equal((await drainCaptureInbox(fx.processorEnv,{now:t0+5000})).attempted,0);
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
 }finally{fx.close();}
});
test('processor refuses HTTP and cannot act without exact scheduled event or activation',async()=>{
 const fx=setup();try{
  assert.equal((await captureProcessor.fetch()).status,404);
  await assert.rejects(captureProcessor.scheduled({cron:'* * * * *',scheduledTime:t0},fx.processorEnv),
   /KNOWLEDGE_CAPTURE_NOT_SCHEDULED/);
  await assert.rejects(drainCaptureInbox({...fx.processorEnv,CAPTURE_PROCESSOR_ACK:''}),
   /KNOWLEDGE_CAPTURE_PROCESSOR_DISABLED/);
  await assert.rejects(drainCaptureInbox({...fx.processorEnv,CAPTURE_INBOX_ROOT_HEX:machineHex}),
   /KNOWLEDGE_CAPTURE_PROCESSOR_DISABLED/);
  await assert.rejects(drainCaptureInbox(fx.processorEnv,{limit:11}),
   /INVALID_CAPTURE_BATCH/);
  assert.equal((await listCaptureStates({db:fx.inbox})).length,0);
 }finally{fx.close();}
});


function canaryFixture(fx){
 const owner={
  ...fx.ownerEnv,
  KNOWLEDGE_MACHINE_CAPTURE_REPO_ID:String(CANARY_REPO_ID),
  KNOWLEDGE_MACHINE_CAPTURE_PREFIX:'acceptance/github-canary',
 };
 const ingress={
  ...fx.ingressEnv,
  CAPTURE_INGRESS_URL:'https://capture-canary.example.test/github',
  CAPTURE_REPOSITORIES_JSON:JSON.stringify({
   'devonalanakins/knowledge':{
    repoId:CANARY_REPO_ID,scope:'personal',pathPrefix:'acceptance/github-canary',
   },
  }),
 };
 return {
  ...ingress,...fx.processorEnv,CAPTURE_CANARY_ACK:CANARY_ACK,
  KNOWLEDGE_CAPTURE_WRITER:{
   async saveMergeReceipt(payload){
    return handlePrivateMergeCapture(owner,payload,payload.issuedAt);
   },
  },
 };
}
test('runtime canary test-only path saves exactly one fictional receipt then verifies duplicate',async()=>{
 const fx=setup();
 try {
  const config=canaryFixture(fx);
  const first=await runRuntimeCanary(config);
  assert.equal(first.status,'SAVED_AND_READBACK_VERIFIED');
  assert.deepEqual({saved:first.summary.saved,pending:first.summary.pending},{saved:1,pending:0});
  const path='acceptance/github-canary/pr-'+CANARY_NUMBER;
  const actual=await readOwner({...fx.ownerEnv,
   KNOWLEDGE_MACHINE_CAPTURE_REPO_ID:String(CANARY_REPO_ID),
   KNOWLEDGE_MACHINE_CAPTURE_PREFIX:'acceptance/github-canary',
  },path);
  assert.equal(actual?.version,1);
  assert.match(actual.body,/SOURCE-EVENT VERIFIED/);
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
  const duplicate=await runRuntimeCanary(config);
  assert.equal(duplicate.status,'ALREADY_SAVED');
  assert.equal(duplicate.summary.attempted,0);
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
  assert.equal((await canaryWorker.fetch()).status,404);
 }finally {fx.close();}
});
test('runtime canary rejects incomplete configuration and cannot mistake queued event for saved',async()=>{
 const fx=setup();
 try {
  const env=canaryFixture(fx);
  await assert.rejects(runRuntimeCanary({...env,CAPTURE_CANARY_ACK:''}),/CANARY_UNAVAILABLE/);
  await assert.rejects(runRuntimeCanary({...env,CAPTURE_INBOX_ROOT_HEX:''}),/CANARY_UNAVAILABLE/);
  // A queued receipt with a future delivery time is not a verified save
  // even when it was already saved during an earlier successful canary run.
  assert.equal((await runRuntimeCanary(env)).status,'SAVED_AND_READBACK_VERIFIED');
  fx.inbox.db.prepare("UPDATE knowledge_capture_inbox SET state='queued',next_at=?,last_error='READ_FAILED' WHERE state='saved'")
    .run('2099-01-01T00:00:00.000Z');
  await assert.rejects(runRuntimeCanary(env),/CANARY_LEDGER_NOT_SAVED/);
  assert.equal((await listCaptureStates({db:fx.inbox}))[0].state,'queued');
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,1);
  assert.equal(fx.owner.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
 }finally {fx.close();}
});
