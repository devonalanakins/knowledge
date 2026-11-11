import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyOwnerUiStagingTopology,readOwnerUiStagingTopology}
 from '../src/forward-owner-ui-staging-guard.mjs';

const prodDb='11111111-1111-4111-8111-111111111111';
const stageDb='22222222-2222-4222-8222-222222222222';
const prodOrigin='https://knowledge-forward-private.example.workers.dev';
const stageOrigin='https://knowledge-owner-ui-stage.example.workers.dev';
const ownerScript='knowledge-forward-private';
const stageScript='knowledge-owner-ui-stage';
const required=[
 'KNOWLEDGE_ACCESS_AUD','KNOWLEDGE_ACCESS_EMAIL','KNOWLEDGE_PRIVATE_WORKER_ACK',
 'KNOWLEDGE_WORKER_RESOURCE','KNOWLEDGE_SPACE','KNOWLEDGE_KEY_ID',
 'KNOWLEDGE_DATA_KEY','KNOWLEDGE_BROWSER_ACK','KNOWLEDGE_ACCEPTANCE_ONLY_ACK',
];
function facts(){
 return {
  production:{bindings:[{name:'KNOWLEDGE_DB',type:'d1',database_id:prodDb}]},
  staging:{compatibility_date:'2026-11-07',compatibility_flags:[],bindings:[
   {name:'KNOWLEDGE_DB',type:'d1',database_id:stageDb},
   ...required.map(name=>({name,type:'secret_text',text:'never-report-value'})),
  ]},
  databases:[{name:ownerScript,uuid:prodDb},{name:stageScript,uuid:stageDb}],
  apps:[
   {id:'owner-app-id',domain:new URL(prodOrigin).hostname,type:'self_hosted'},
   {id:'stage-app-id',domain:new URL(stageOrigin).hostname,type:'self_hosted'},
  ],
  productionOrigin:prodOrigin,stagingOrigin:stageOrigin,
 };
}
test('separate production/stage D1, Access and worker metadata only passes topology, never release',()=>{
 const result=verifyOwnerUiStagingTopology(facts());
 assert.deepEqual(result,{status:'STAGING_METADATA_SEPARATED',findings:[],
  stagingWorkerFound:true,deploymentAuthorized:false,accessPolicyVerified:false,
  secretValuesVerified:false,syntheticDataVerified:false,hostedOwnerFlowVerified:false,
  rollbackVerified:false});
 assert.doesNotMatch(JSON.stringify(result),/never-report-value|owner-app-id|11111111|22222222/);
});
test('missing staged worker and database remain BLOCKED, never treated as an empty safe stage',()=>{
 const f=facts();f.staging=null;f.databases.pop();f.apps.pop();
 const r=verifyOwnerUiStagingTopology(f);
 assert.equal(r.status,'BLOCKED');assert.equal(r.stagingWorkerFound,false);
 for(const code of ['STAGING_WORKER_MISSING','DEDICATED_STAGING_DATABASE_MISSING',
  'DEDICATED_STAGING_ACCESS_APP_MISSING'])assert.ok(r.findings.includes(code),code);
});
test('reused production D1, Access app and host are each rejected',()=>{
 for(const [change,expected] of [
  [f=>{f.staging.bindings[0].database_id=prodDb;},'PRODUCTION_DATABASE_REUSED'],
  [f=>{f.stagingOrigin=f.productionOrigin;},'HOSTS_INVALID_OR_NOT_ISOLATED'],
  [f=>{f.apps[1].id=f.apps[0].id;},'PRODUCTION_ACCESS_APPLICATION_REUSED'],
  [f=>{f.apps[1].domain=f.apps[0].domain;},'DEDICATED_STAGING_ACCESS_APP_MISSING'],
 ]){
  const f=facts();change(f);
  const r=verifyOwnerUiStagingTopology(f);
  assert.equal(r.status,'BLOCKED');assert.ok(r.findings.includes(expected),expected);
  assert.equal(r.deploymentAuthorized,false);
 }
});
test('staging cannot inherit unrestricted owner write/editor or machine-capture bindings',()=>{
 for(const name of ['KNOWLEDGE_PRIVATE_WRITE_ACK','KNOWLEDGE_OWNER_EDITOR_ACK',
  'KNOWLEDGE_OWNER_SHARE_PREVIEW_ACK','KNOWLEDGE_MACHINE_CAPTURE_ACK']){
  const f=facts();f.staging.bindings.push({name,type:'secret_text'});
  assert.ok(verifyOwnerUiStagingTopology(f).findings.includes(
   'STAGING_UNEXPECTED_OR_PRIVILEGED_BINDINGS'));
 }
 const f=facts();f.staging.bindings=f.staging.bindings.filter(b=>b.name!=='KNOWLEDGE_ACCEPTANCE_ONLY_ACK');
 assert.ok(verifyOwnerUiStagingTopology(f).findings.includes(
  'STAGING_REQUIRED_BINDING_MISSING_OR_WRONG_TYPE'));
});
test('bad compatibility, extra or duplicate bindings, and missing inventory block',()=>{
 const cases=[
  f=>{f.staging.compatibility_date='2026-12-01';},
  f=>{f.staging.compatibility_flags=['nodejs_compat'];},
  f=>{f.staging.bindings.push({...f.staging.bindings[0]});},
  f=>{f.staging.bindings[1].type='plain_text';},
  f=>{f.databases=[];},
  f=>{f.apps=[];},
 ];
 for(const mutate of cases){
  const f=facts();mutate(f);
  assert.equal(verifyOwnerUiStagingTopology(f).status,'BLOCKED');
 }
 const f=facts();f.apps=undefined;
 assert.ok(verifyOwnerUiStagingTopology(f).findings.includes('PROVIDER_INVENTORY_INCOMPLETE'));
});
test('exact four read-only provider GETs preserve token secrecy and return metadata-only report',async()=>{
 const f=facts(),account='a'.repeat(32),token='fictional-read-only-token',calls=[];
 const fetchImpl=async(url,options)=>{
  const u=new URL(url);calls.push({origin:u.origin,path:u.pathname,method:options.method,
   redirect:options.redirect,hasToken:options.headers.Authorization==='Bearer '+token});
  assert.equal(u.origin,'https://api.cloudflare.com');
  const path=u.pathname;
  const result=path.endsWith('/'+ownerScript+'/settings')?f.production:
   path.endsWith('/'+stageScript+'/settings')?f.staging:
   path.endsWith('/d1/database')?f.databases:
   path.endsWith('/access/apps')?f.apps:null;
  assert.notEqual(result,null,'unexpected API request path');
  return {ok:true,status:200,json:async()=>({success:true,result,result_info:{total_pages:1}})};
 };
 const r=await readOwnerUiStagingTopology({account,token,
  productionOrigin:prodOrigin,stagingOrigin:stageOrigin,fetchImpl});
 assert.equal(r.status,'STAGING_METADATA_SEPARATED');
 assert.equal(calls.length,4);
 assert.equal(new Set(calls.map(c=>c.path)).size,4);
 assert.ok(calls.every(c=>c.method==='GET'&&c.redirect==='error'&&c.hasToken));
 assert.doesNotMatch(JSON.stringify(r),/fictional-read-only|never-report-value|owner-app-id/);
});
test('stage 404 is a blocked finding, while access failure and pagination fail closed',async()=>{
 const f=facts(),opts={account:'a'.repeat(32),token:'synthetic-read-only',
  productionOrigin:prodOrigin,stagingOrigin:stageOrigin};
 const fetchImpl=async(url)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/'+stageScript+'/settings'))return {ok:false,status:404};
  const result=path.endsWith('/'+ownerScript+'/settings')?f.production:
   path.endsWith('/d1/database')?f.databases:f.apps;
  return {ok:true,status:200,json:async()=>({success:true,result})};
 };
 const r=await readOwnerUiStagingTopology({...opts,fetchImpl});
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.findings.includes('STAGING_WORKER_MISSING'));
 for(const faulty of [
  async()=>({ok:false,status:403}),
  async()=>({ok:true,status:200,json:async()=>({success:false,result:{}})}),
  async()=>({ok:true,status:200,json:async()=>({success:true,result:[],result_info:{total_pages:2}})}),
 ]){
  await assert.rejects(readOwnerUiStagingTopology({...opts,fetchImpl:faulty}),
   /KNOWLEDGE_UI_STAGE_READ_ONLY_UNAVAILABLE/);
 }
 await assert.rejects(readOwnerUiStagingTopology({...opts,account:'not-an-id',
  fetchImpl:async()=>{throw Error('never network')}}),/KNOWLEDGE_UI_STAGE_READ_ONLY_UNAVAILABLE/);
});
test('CLI is opt-in, read-only and cannot upload or modify secrets',()=>{
 const text=readFileSync(new URL('../ops/private-forward/guard-owner-ui-staging.mjs',import.meta.url),'utf8');
 assert.match(text,/READ_ONLY_STAGING_REVIEW_V1/);
 assert.match(text,/readOwnerUiStagingTopology/);
 assert.doesNotMatch(text,/method:\s*['"](?:PUT|PATCH|POST|DELETE)|wrangler\s+deploy|cloudflare\.request\(\{\s*method:\s*['"]POST/);
 assert.match(text,/if\(report.status!=='STAGING_METADATA_SEPARATED'\)/);
});
