import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyBoundDisabledCapture,readBoundDisabledCapture}
 from '../src/forward-capture-bound-guard.mjs';
const INGRESS='knowledge-capture-ingress-private';
const PROCESSOR='knowledge-capture-processor-private';
const OWNER='knowledge-forward-private';
const DB='147ab931-7675-43b2-a8fc-eba2a2b72545';
const OWNER_DB='d942f8de-1f89-4942-adf7-e8ba00a72efa';
const versions={
 [INGRESS]:'e8fc83ab-ff4e-4c7b-8d76-61617d1214e5',
 [PROCESSOR]:'99d70b8f-0a90-4eab-8fb9-9a61b017f0b9',
 [OWNER]:'9accc39c-b91a-4101-9d86-b3db7aed9405',
};
const ownerBindings=[
 'KNOWLEDGE_ACCESS_AUD','KNOWLEDGE_ACCESS_EMAIL',
 'KNOWLEDGE_BROWSER_ACK','KNOWLEDGE_DATA_KEY','KNOWLEDGE_DB',
 'KNOWLEDGE_KEY_ID','KNOWLEDGE_OWNER_EDITOR_ACK',
 'KNOWLEDGE_PRIVATE_WORKER_ACK','KNOWLEDGE_PRIVATE_WRITE_ACK',
 'KNOWLEDGE_SPACE','KNOWLEDGE_WORKER_RESOURCE',
].map(name=>({name,type:name==='KNOWLEDGE_DB'?'d1':'secret_text',
 ...(name==='KNOWLEDGE_DB'?{database_id:OWNER_DB}:{})}));
const dbBinding={name:'CAPTURE_INBOX_DB',type:'d1',database_id:DB};
const rpcBinding={name:'KNOWLEDGE_CAPTURE_WRITER',type:'service',
 service:OWNER,entrypoint:'KnowledgeCaptureEntrypoint'};
const manifests=()=>({
 [INGRESS]:JSON.parse(readFileSync(new URL(
 '../ops/private-forward/wrangler.capture-ingress.staged.json',import.meta.url),'utf8')),
 [PROCESSOR]:JSON.parse(readFileSync(new URL(
 '../ops/private-forward/wrangler.capture-processor.bound.json',import.meta.url),'utf8')),
});
function workers(){
 return Object.fromEntries([INGRESS,PROCESSOR,OWNER].map(name=>{
  const role=name===OWNER?'owner':name===PROCESSOR?'processor':'ingress';
  const bindings=role==='owner'?ownerBindings:role==='processor'?
   [dbBinding,rpcBinding]:[dbBinding];
  return [name,{
   compatibilityDate:'2026-11-07',versionCompatibilityDate:'2026-11-07',
   compatibilityFlags:[],bindings:structuredClone(bindings),
   versionBindings:structuredClone(bindings),versionId:versions[name],
   versions:[{version_id:versions[name],percentage:100}],
   handlers:role==='processor'?['fetch','scheduled']:['fetch'],
   namedHandlers:role==='owner'?['KnowledgeCaptureEntrypoint']:[],
   schedules:[],
   subdomain:{enabled:role==='owner',previews_enabled:false},
  }];
 }));
}
const routing=()=>({allPagesReviewed:true,domains:[{script:OWNER}],routes:[{script:OWNER}]});
function verify(workersArg=workers(),routingArg=routing(),manifestArg=manifests(),
 versionsArg=versions){
 return verifyBoundDisabledCapture({
  workers:workersArg,expectedVersions:versionsArg,
  manifests:manifestArg,routing:routingArg,
 });
}
test('reviewed 3-worker disabled boundary matches active owner RPC without granting capture',()=>{
 const result=verify();
 assert.equal(result.status,'BOUND_DISABLED_MATCH');
 assert.deepEqual(result.findings,[]);
 assert.deepEqual(result.rollbackVersions,versions);
 assert.equal(result.deploymentAuthorized,false);
 assert.equal(result.activationAuthorized,false);
 assert.equal(result.liveCaptureVerified,false);
});
test('bound processor manifest is exact and never includes secrets, routes or Cron',()=>{
 const {services,d1_databases,...manifest}=manifests()[PROCESSOR];
 assert.deepEqual(services,[{
  binding:'KNOWLEDGE_CAPTURE_WRITER',service:OWNER,
  entrypoint:'KnowledgeCaptureEntrypoint',
 }]);
 assert.deepEqual(d1_databases,[{binding:'CAPTURE_INBOX_DB',
  database_name:'knowledge-capture-inbox-private',database_id:DB}]);
 assert.equal(manifest.workers_dev,false);
 assert.equal(manifest.preview_urls,false);
 for(const name of ['routes','triggers','vars','secrets','unsafe','env']){
  assert.equal(Object.hasOwn(manifest,name),false,name);
 }
});
test('unexpected bindings, public exposure, schedules and active version drift are blocked',()=>{
 const checks=[
  [w=>w[PROCESSOR].bindings.push({name:'CAPTURE_MACHINE_AUTH_KEY_HEX',type:'secret_text'}),'BINDING_DRIFT'],
  [w=>w[PROCESSOR].versionBindings[1].entrypoint='WrongRPC','BINDING_DRIFT'],
  [w=>w[PROCESSOR].versionBindings[1].service='another-worker','BINDING_DRIFT'],
  [w=>w[PROCESSOR].bindings[1].environment='staging','BINDING_DRIFT'],
  [w=>w[INGRESS].bindings.push(rpcBinding),'BINDING_DRIFT'],
  [w=>w[OWNER].versionBindings.push({name:'KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX',type:'secret_text'}),'BINDING_DRIFT'],
  [w=>w[PROCESSOR].schedules.push({cron:'*/5 * * * *'}),'UNEXPECTED_SCHEDULE'],
  [w=>w[INGRESS].subdomain.enabled=true,'PUBLIC_SURFACE_DRIFT'],
  [w=>w[OWNER].subdomain.previews_enabled=true,'PUBLIC_SURFACE_DRIFT'],
  [w=>w[PROCESSOR].versions[0].percentage=50,'ACTIVE_VERSION_DRIFT'],
  [w=>w[OWNER].versionId=versions[PROCESSOR],'ACTIVE_VERSION_DRIFT'],
  [w=>w[OWNER].namedHandlers=[],'OWNER_RPC_ENTRYPOINT_MISSING'],
  [w=>w[PROCESSOR].handlers=['fetch'],'HANDLER_DRIFT'],
  [w=>w[OWNER].compatibilityFlags=['unsafe-eval'],'COMPATIBILITY_DRIFT'],
 ];
 for(const [mutate,suffix] of checks){
  const w=workers();mutate(w);
  const result=verify(w);
  assert.equal(result.status,'BLOCKED',suffix);
  assert.ok(result.findings.some(f=>f.endsWith(suffix)),suffix);
  assert.equal(result.activationAuthorized,false);
 }
});
test('route and domain inventory must be complete; no capture Worker is publicly routed',()=>{
 for(const [kind,name] of [['routes',PROCESSOR],['domains',INGRESS]]){
  const evidence=routing();evidence[kind].push({script:name});
  const result=verify(workers(),evidence);
  assert.equal(result.status,'BLOCKED');
  assert.ok(result.findings.includes(name+':UNEXPECTED_PUBLIC_ROUTE'));
 }
 const evidence=routing(); evidence.allPagesReviewed=false;
 assert.throws(()=>verify(workers(),evidence),/BOUND_GUARD_UNAVAILABLE/);
});
test('unreviewed manifest changes and missing source metadata fail closed',()=>{
 for(const mutate of [
  m=>m[PROCESSOR].services[0].entrypoint='Default',
  m=>m[PROCESSOR].services.push({binding:'OTHER',service:OWNER,entrypoint:'KnowledgeCaptureEntrypoint'}),
  m=>m[PROCESSOR].routes=['*'],
  m=>m[PROCESSOR].d1_databases[0].database_id=OWNER_DB,
 ]){
  const m=manifests();mutate(m);
  assert.throws(()=>verify(workers(),routing(),m),/BOUND_GUARD_UNAVAILABLE/);
 }
 const w=workers();delete w[OWNER].versionBindings;
 assert.throws(()=>verify(w),/BOUND_GUARD_UNAVAILABLE/);
});
test('read-only provider preflight makes exact GETs, strips all secret values',async()=>{
 const list=[];
 const fetchImpl=async(url,options)=>{
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer fictional-test-token');
  list.push(url);
  const u=new URL(url);
  const match=/\/workers\/scripts\/([^/]+)\/(settings|deployments|schedules|subdomain|versions\/[^/]+)$/.exec(u.pathname);
  const w=workers();
  if(match){
   const data=w[match[1]];
   assert.ok(data);
   const kind=match[2];
   const result=kind==='settings'?{compatibility_date:data.compatibilityDate,
     compatibility_flags:[],bindings:data.bindings.map(b=>({...b,text:'DO_NOT_PRINT_SECRET'}))}:
    kind==='deployments'?{deployments:[{versions:data.versions}]}:
    kind==='schedules'?{schedules:data.schedules}:
    kind==='subdomain'?data.subdomain:
    {id:data.versionId,resources:{script_runtime:{compatibility_date:data.versionCompatibilityDate},
     script:{handlers:data.handlers,named_handlers:data.namedHandlers.map(name=>({name}))},
     bindings:data.versionBindings.map(b=>({...b,text:'DO_NOT_PRINT_SECRET'}))}};
   return {ok:true,json:async()=>({success:true,result})};
  }
  if(u.pathname.endsWith('/workers/domains'))
   return {ok:true,json:async()=>({success:true,result:[{service:OWNER,hostname:'private.example'}]})};
  if(u.pathname.endsWith('/zones'))
   return {ok:true,json:async()=>({success:true,result:[{id:'b'.repeat(32)},{id:'c'.repeat(32)}],
    result_info:{total_pages:1}})};
  if(u.pathname.endsWith('/workers/routes'))
   return {ok:true,json:async()=>({success:true,result:[{script:OWNER,pattern:'*'}],
    result_info:{total_pages:1}})};
  throw Error('Unexpected URL '+url);
 };
 const report=await readBoundDisabledCapture({
  account:'a'.repeat(32),token:'fictional-test-token',fetchImpl,
  expectedVersions:versions,manifests:manifests(),
 });
 assert.equal(report.status,'BOUND_DISABLED_MATCH');
 assert.equal(list.length,19);
 assert.equal(new Set(list).size,19);
 assert.ok(list.every(x=>x.startsWith('https://api.cloudflare.com/client/v4/')));
 assert.doesNotMatch(JSON.stringify(report),/DO_NOT_PRINT_SECRET|fictional-test-token|private.example/);
});
test('provider failures and incomplete route pagination abort without readiness',async()=>{
 const args={account:'a'.repeat(32),token:'fictional',expectedVersions:versions,
  manifests:manifests()};
 await assert.rejects(readBoundDisabledCapture({...args,account:'bad',fetchImpl:async()=>{throw Error('never');}}),
  /BOUND_GUARD_UNAVAILABLE/);
 for(const response of [
  {ok:false,status:403},
  {ok:true,json:async()=>({success:false,result:{}})},
  {ok:true,json:async()=>({success:true,result:{}})},
 ]){
  await assert.rejects(readBoundDisabledCapture({...args,fetchImpl:async()=>response}),
   /BOUND_GUARD_UNAVAILABLE/);
 }
});
