import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleGitHubCaptureIngress} from '../src/worker-cloudflare-capture-ingress.mjs';

const signingSecret='fictional-github-signing-secret-fully-isolated-2026';
const inboxRoot='0123456789abcdef'.repeat(4);
const host='https://capture.example.test/github';
const repoName='devonalanakins/knowledge';
const repoId=987650;
const approved={ [repoName]: {repoId,scope:'personal',pathPrefix:'engineering/knowledge'} };
const ddl=readFileSync(new URL('../ops/private-forward/capture-inbox-v1.sql',import.meta.url),'utf8');

class SyntheticD1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(ddl);}
 prepare(sql){
  return {bind:(...params)=>({
   first:async()=>this.db.prepare(sql).get(...params)??null,
   all:async()=>({results:this.db.prepare(sql).all(...params)}),
   run:async()=>({meta:{changes:Number(this.db.prepare(sql).run(...params).changes)}}),
  })};
 }
 async batch(stmts){return Promise.all(stmts);}
 records(){return this.db.prepare('SELECT * FROM knowledge_capture_inbox').all();}
 close(){this.db.close();}
}
function setup(){
 const db=new SyntheticD1();
 const env={
  CAPTURE_INGRESS_ACK:'SIGNED_GITHUB_CAPTURE_INBOX_V1',
  CAPTURE_WEBHOOK_SECRET:signingSecret,
  CAPTURE_INBOX_ROOT_HEX:inboxRoot,
  CAPTURE_INBOX_KEY_ID:'inbox-v1',
  CAPTURE_INBOX_DB:db,
  CAPTURE_REPOSITORIES_JSON:JSON.stringify(approved),
  CAPTURE_INGRESS_URL:host,
 };
 return {db,env,close:()=>db.close()};
}
function event(){
 return {action:'closed',number:41,
  repository:{id:repoId,full_name:repoName},
  pull_request:{number:41,merged:true,merge_commit_sha:'a'.repeat(40),
   merged_at:'2026-11-08T16:00:00.000Z',
   title:'Malicious untrusted <script> that must never persist',
   body:'Private patient details must not persist'}};
}
function signed(body,extra={}){
 const raw=typeof body==='string'?body:JSON.stringify(body);
 return {
  'Content-Type':'application/json',
  'X-Hub-Signature-256':'sha256='+createHmac('sha256',signingSecret).update(raw).digest('hex'),
  'X-GitHub-Event':'pull_request',
  'X-GitHub-Delivery':'e7624b46-7e6c-49b2-a74c-4fdf0b726fac',
  ...extra,
 };
}
async function send(env,body=event(),{url=host,headers,method='POST'}={}){
 const raw=typeof body==='string'?body:JSON.stringify(body);
 return handleGitHubCaptureIngress(new Request(url,{
  method,headers:headers??signed(raw),...(method==='POST'?{body:raw}:{})
 }),env);
}
test('legitimate signed GitHub merge is durably queued without leaking payload',async()=>{
 const fx=setup();
 try{
  const first=await send(fx.env);
  assert.equal(first.status,202);
  assert.equal(await first.text(),'');
  assert.equal(first.headers.get('cache-control'),'no-store');
  assert.equal(fx.db.records().length,1);
  const row=fx.db.records()[0];
  assert.equal(row.state,'queued');
  assert.match(row.delivery_key,/^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(JSON.stringify(row),/devonalanakins|patient|script|engineering/);
  assert.match(row.sealed,/"format":"knowledge-capture-inbox-v1"/);
  assert.equal((await send(fx.env)).status,202);
  assert.equal(fx.db.records().length,1);
  assert.equal(fx.db.records()[0].sealed,row.sealed);
 }finally{fx.close();}
});
test('invalid HMAC and tampered signed request cannot enter queue',async()=>{
 const fx=setup();try{
  const body=JSON.stringify(event());
  const wrong=signed(body);wrong['X-Hub-Signature-256']='sha256='+'0'.repeat(64);
  assert.equal((await send(fx.env,body,{headers:wrong})).status,401);
  assert.equal((await send(fx.env,body+' ',{headers:signed(body)})).status,401);
  const missing=signed(body);delete missing['X-Hub-Signature-256'];
  assert.equal((await send(fx.env,body,{headers:missing})).status,401);
  assert.equal(fx.db.records().length,0);
 }finally{fx.close();}
});
test('repository ID does not follow a transferred/recreated name',async()=>{
 const fx=setup();try{
  const change=event();change.repository.id=987651;
  assert.equal((await send(fx.env,change)).status,403);
  assert.equal(fx.db.records().length,0);
  const other=event();other.repository.full_name='other-owner/knowledge';
  assert.equal((await send(fx.env,other)).status,403);
  assert.equal(fx.db.records().length,0);
 }finally{fx.close();}
});
test('do not enqueue unmerged pull requests or other GitHub events',async()=>{
 const fx=setup();try{
  const notMerged=event();notMerged.pull_request.merged=false;
  assert.equal((await send(fx.env,notMerged)).status,204);
  assert.equal((await send(fx.env,event(),{headers:signed(event(),{'X-GitHub-Event':'push'})})).status,204);
  assert.equal(fx.db.records().length,0);
 }finally{fx.close();}
});
test('reject wrong host, query, route and non-POST calls without affecting owner records',async()=>{
 const fx=setup();try{
  assert.equal((await send(fx.env,event(),{url:'https://wrong.example.test/github'})).status,404);
  assert.equal((await send(fx.env,event(),{url:host+'?preview=1'})).status,404);
  assert.equal((await send(fx.env,event(),{url:'https://capture.example.test/mcp'})).status,404);
  assert.equal((await send(fx.env,event(),{method:'GET'})).status,404);
  assert.equal(fx.db.records().length,0);
 }finally{fx.close();}
});
test('no activation ACK, wrong key, malformed mappings, and clinical mappings all fail closed',async()=>{
 const fx=setup();try{
  const bad=[
   {CAPTURE_INGRESS_ACK:''},
   {CAPTURE_INBOX_ROOT_HEX:'not-a-key'},
   {CAPTURE_INBOX_KEY_ID:''},
   {CAPTURE_WEBHOOK_SECRET:'short'},
   {CAPTURE_REPOSITORIES_JSON:'{}'},
   {CAPTURE_REPOSITORIES_JSON:'invalid-json'},
   {CAPTURE_REPOSITORIES_JSON:JSON.stringify({
    [repoName]:{repoId,scope:'clinical',pathPrefix:'clinical/clients'}})},
   {CAPTURE_REPOSITORIES_JSON:JSON.stringify({
    [repoName]:{scope:'personal',pathPrefix:'engineering/knowledge'}})},
   {CAPTURE_INGRESS_URL:'http://capture.example.test/github'},
   {CAPTURE_INGRESS_URL:'https://capture.example.test/mcp'},
  ];
  for(const override of bad) {
   const r=await send({...fx.env,...override});
   assert.equal(r.status,503,JSON.stringify(Object.keys(override)));
  }
  assert.equal(fx.db.records().length,0);
 }finally{fx.close();}
});
test('reject unsupported content types, encoded bodies, and oversized signed payloads',async()=>{
 const fx=setup();try{
  const raw=JSON.stringify(event());
  assert.equal((await send(fx.env,raw,{headers:signed(raw,{'Content-Type':'text/plain'})})).status,415);
  assert.equal((await send(fx.env,raw,{headers:signed(raw,{'Content-Encoding':'gzip'})})).status,415);
  assert.equal((await send(fx.env,raw,{headers:signed(raw,{'Content-Length':'65537'})})).status,413);
  const gigantic=JSON.stringify({...event(),garbage:'x'.repeat(66_000)});
  assert.equal((await send(fx.env,gigantic)).status,413);
  assert.equal(fx.db.records().length,0);
 }finally{fx.close();}
});
test('signed malformed event fails with non-sensitive error',async()=>{
 const fx=setup();try{
  const response=await send(fx.env,'{invalid');
  assert.equal(response.status,400);
  assert.equal(await response.text(),'');
  assert.equal(fx.db.records().length,0);
 }finally{fx.close();}
});
test('storage error and schema unavailable produce no false delivery receipt',async()=>{
 const fx=setup();try{
  const offline={...fx.env,CAPTURE_INBOX_DB:{
   prepare:()=>{throw Error('D1 unavailable');},
   batch:async()=>[],
  }};
  assert.equal((await send(offline)).status,503);
  assert.equal(fx.db.records().length,0);
 }finally{fx.close();}
});
test('signed event in queue does not grant access to private MCP/owner identity',async()=>{
 const fx=setup();try{
  const r=await send(fx.env);
  assert.equal(r.status,202);
  for(const path of ['https://capture.example.test/mcp','https://capture.example.test/wiki','https://capture.example.test/wiki/page/private']){
   const blocked=await send(fx.env,event(),{url:path});
   assert.equal(blocked.status,404);
   assert.equal(await blocked.text(),'');
  }
 }finally{fx.close();}
});
