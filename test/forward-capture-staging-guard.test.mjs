import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyCaptureStagingGuard,readCaptureStagingGuard} from '../src/forward-capture-staging-guard.mjs';
const names=['knowledge-capture-ingress-private','knowledge-capture-processor-private'];
const version='abc5bc51-cd11-4864-be2d-b15260f5dbf1';
const db='147ab931-7675-43b2-a8fc-eba2a2b72545';
function manifests(){
 return Object.fromEntries(names.map((n,i)=>[n,JSON.parse(readFileSync(
  new URL('../ops/private-forward/wrangler.capture-'+(i?'processor':'ingress')+'.staged.json',import.meta.url),'utf8'))]));
}
function workers(){
 return Object.fromEntries(names.map(n=>[n,{compatibility_date:'2026-11-07',
  compatibility_flags:[],bindings:[{name:'CAPTURE_INBOX_DB',type:'d1',database_id:db}],
  schedules:[],versions:[{version_id:version,percentage:100}],
  subdomain:{enabled:false,previews_enabled:false}}]));
}
test('matching disabled deployments report rollback versions without authorizing release',()=>{
 const r=verifyCaptureStagingGuard({manifests:manifests(),workers:workers()});
 assert.deepEqual(r,{status:'STAGING_METADATA_MATCH',deploymentAuthorized:false,
  liveCaptureVerified:false,findings:[],
  rollbackVersions:Object.fromEntries(names.map(n=>[n,version]))});
});
test('compatibility, public surface, schedule and binding drift independently fail closed',()=>{
 for(const [change,expected] of [
  [w=>w[names[0]].compatibility_date='2026-11-08','COMPATIBILITY_DRIFT'],
  [w=>w[names[1]].subdomain.enabled=true,'PUBLIC_SURFACE_ENABLED'],
  [w=>w[names[0]].schedules.push({cron:'*/5 * * * *'}),'UNEXPECTED_SCHEDULE'],
  [w=>w[names[1]].bindings.push({name:'CAPTURE_MACHINE_AUTH_KEY_HEX',type:'secret_text'}),'REMOTE_BINDING_DRIFT'],
  [w=>w[names[0]].bindings[0].database_id='33333333-3333-4333-8333-333333333333','REMOTE_BINDING_DRIFT'],
  [w=>w[names[0]].versions[0].percentage=50,'ROLLBACK_VERSION_UNVERIFIED'],
 ]){
  const w=workers();change(w);
  const result=verifyCaptureStagingGuard({manifests:manifests(),workers:w});
  assert.equal(result.status,'BLOCKED');
  assert.ok(result.findings.some(x=>x.endsWith(expected)),expected);
  assert.equal(result.deploymentAuthorized,false);
 }
});
test('unreviewed config keys and wrong owner database block staging',()=>{
 const m=manifests();m[names[0]].routes=['*'];
 assert.ok(verifyCaptureStagingGuard({manifests:m,workers:workers()}).findings.some(x=>x.includes('UNREVIEWED_CONFIG_KEY')));
 const v=manifests();v[names[1]].d1_databases[0].database_id='d942f8de-1f89-4942-adf7-e8ba00a72efa';
 assert.ok(verifyCaptureStagingGuard({manifests:v,workers:workers()}).findings.some(x=>x.includes('OWNER_DB_FORBIDDEN')));
});
test('exact eight read-only GETs discard values and cannot return secrets',async()=>{
 const account='a'.repeat(32),token='fictional-readonly-test-secret';
 const w=workers(),calls=[];
 const fetchImpl=async(url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.Authorization,'Bearer '+token);
  const match=/\/workers\/scripts\/([^/]+)\/(settings|deployments|schedules|subdomain)$/.exec(url);
  assert.ok(match);calls.push(match[1]+'/'+match[2]);
  const current=w[match[1]];
  const result=match[2]==='settings'?{
    compatibility_date:current.compatibility_date,compatibility_flags:[],
    bindings:current.bindings.map(x=>({...x,value:'secret-value-not-for-report'}))
  }:match[2]==='deployments'?{deployments:[{versions:current.versions}]}:
   match[2]==='schedules'?{schedules:current.schedules}:current.subdomain;
  return {ok:true,json:async()=>({success:true,result})};
 };
 const r=await readCaptureStagingGuard({account,token,manifests:manifests(),fetchImpl});
 assert.equal(r.status,'STAGING_METADATA_MATCH');assert.equal(calls.length,8);
 assert.equal(new Set(calls).size,8);
 assert.doesNotMatch(JSON.stringify(r),/fictional-readonly|secret-value|147ab931/);
});
test('provider errors and missing inventory are unavailable, never ready',async()=>{
 await assert.rejects(readCaptureStagingGuard({account:'invalid',token:'x',manifests:manifests()}),
  /KNOWLEDGE_CAPTURE_STAGING_GUARD_UNAVAILABLE/);
 for(const result of [
  {ok:false,status:403},{ok:true,json:async()=>({success:false,result:{}})},
  {ok:true,json:async()=>({success:true,result:{}})}
 ])await assert.rejects(readCaptureStagingGuard({
  account:'a'.repeat(32),token:'fixture',manifests:manifests(),fetchImpl:async()=>result
 }),/KNOWLEDGE_CAPTURE_STAGING_GUARD_UNAVAILABLE/);
});
