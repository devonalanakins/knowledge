import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planCaptureVersionUpload,stageCaptureVersion,VERSION_STAGE_ACK}
  from '../src/forward-capture-version-stage.mjs';

const a='dae6bc51-cd11-4864-be2d-b15260f5dbf1';
const b='be68505f-f028-41ad-bebc-746f3a13e5bf';
const names=['knowledge-capture-ingress-private','knowledge-capture-processor-private'];
function manifests(){
 return Object.fromEntries(names.map((name,index)=>[name,JSON.parse(readFileSync(new URL(
  '../ops/private-forward/wrangler.capture-'+(index?'processor':'ingress')+
  '.staged.json',import.meta.url),'utf8'))]));
}
function inventory(){
 return {status:'STAGING_METADATA_MATCH',deploymentAuthorized:false,
  liveCaptureVerified:false,findings:[],
  rollbackVersions:{[names[0]]:a,[names[1]]:b}};
}
function args(part='ingress',extra={}){
 return {component:part,ack:VERSION_STAGE_ACK,
  expectedActiveVersion:part==='ingress'?a:b,manifests:manifests(),
  inventory:inventory(),...extra};
}
test('version-only upload plan uses no deploy, trigger, secret or project-wide write',()=>{
 for (const part of ['ingress','processor']){
  const plan=planCaptureVersionUpload(args(part));
  assert.equal(plan.name,names[part==='ingress'?0:1]);
  assert.equal(plan.command,'npm');
  assert.deepEqual(plan.args.slice(0,6),['exec','--yes','--package=wrangler@4.68.0',
   '--','wrangler','versions']);
  assert.ok(plan.args.includes('upload'));
  assert.ok(plan.args.includes('--keep-vars'));
  assert.ok(plan.args.includes('--strict'));
  assert.ok(plan.args.includes('--config'));
  assert.equal(plan.args.at(-1),'ops/private-forward/wrangler.capture-'+part+'.staged.json');
  assert.equal(plan.deploymentAuthorized,false);
  assert.equal(plan.liveCaptureVerified,false);
  assert.doesNotMatch(plan.args.join(' '),/triggers|deploy|secret put|worker-forward|\.env/);
 }
});
test('requires exact owner approval, immutable rollback baseline and approved component',()=>{
 for(const overrides of [
  {ack:''},{ack:'APPROVED'},{expectedActiveVersion:'x'},
  {expectedActiveVersion:b},{component:'owner-rpc'},{component:'knowledge-forward-private'},
  {inventory:{...inventory(),status:'BLOCKED'}},
  {inventory:{...inventory(),deploymentAuthorized:true}},
  {inventory:{...inventory(),liveCaptureVerified:true}},
  {inventory:{...inventory(),findings:['COMPATIBILITY_DRIFT']}},
  {inventory:{...inventory(),rollbackVersions:{[names[0]]:a}}},
 ]){
  assert.throws(()=>planCaptureVersionUpload(args('ingress',overrides)),
    /KNOWLEDGE_CAPTURE_VERSION_STAGE_/);
 }
});
test('rejects changed manifest, database, compatibility, public surface and extra keys',()=>{
 const mutations=[
  m=>{m[names[0]].name='knowledge-forward-private';},
  m=>{m[names[0]].main='../../src/worker-cloudflare-private.mjs';},
  m=>{m[names[0]].workers_dev=true;},
  m=>{m[names[0]].preview_urls=true;},
  m=>{m[names[0]].routes=['*'];},
  m=>{m[names[0]].compatibility_date='2026-11-08';},
  m=>{m[names[0]].d1_databases[0].database_id='d942f8de-1f89-4942-adf7-e8ba00a72efa';},
  m=>{m[names[0]].d1_databases[0].binding='KNOWLEDGE_DB';},
  m=>{m[names[0]].d1_databases.push(m[names[0]].d1_databases[0]);},
 ];
 for(const mutate of mutations){
  const m=manifests();mutate(m);
  assert.throws(()=>planCaptureVersionUpload(args('ingress',{manifests:m})),
    /KNOWLEDGE_CAPTURE_VERSION_STAGE_MANIFEST_DRIFT/);
 }
});
test('preflight refusal prevents upload even if an upload callback is supplied',async()=>{
 let writes=0;
 await assert.rejects(stageCaptureVersion({
  ...args('ingress'),
  inspect:async()=>({...inventory(),status:'BLOCKED'}),
  upload:async()=>{writes++;return {status:0};},
 }),/KNOWLEDGE_CAPTURE_VERSION_STAGE_NOT_READY/);
 assert.equal(writes,0);
});
test('successful accepted upload is not deployed and requires a second guard read',async()=>{
 let inspections=0,writes=0;
 const result=await stageCaptureVersion({
  ...args('processor'),
  inspect:async()=>{inspections++;return inventory();},
  upload:async plan=>{
   writes++;
   assert.equal(plan.name,names[1]);
   assert.equal(plan.args.at(-1),'ops/private-forward/wrangler.capture-processor.staged.json');
   return {status:0};
  },
 });
 assert.equal(inspections,2);
 assert.equal(writes,1);
 assert.deepEqual(result,{status:'VERSION_UPLOADED_NOT_DEPLOYED',
  name:names[1],activeVersionUnchanged:b,
  deploymentAuthorized:false,liveCaptureVerified:false});
});
test('nonzero, thrown upload and unverifiable post-upload state fail closed',async()=>{
 for(const upload of [
  async()=>({status:1}),
  async()=>{throw Error('test-only network unavailable');},
  async()=>({}),
 ]){
  await assert.rejects(stageCaptureVersion({...args(),inspect:async()=>inventory(),upload}),
    /KNOWLEDGE_CAPTURE_VERSION_STAGE_UPLOAD_FAILED/);
 }
 let read=0;
 await assert.rejects(stageCaptureVersion({...args(),
  inspect:async()=>{
   read++;
   return read===1?inventory():{...inventory(),status:'BLOCKED'};
  },upload:async()=>({status:0})}),
 /KNOWLEDGE_CAPTURE_VERSION_STAGE_POSTUPLOAD_UNVERIFIED/);
 let count=0;
 await assert.rejects(stageCaptureVersion({...args(),
  inspect:async()=>{
   count++;
   return count===1?inventory():{...inventory(),rollbackVersions:
    {...inventory().rollbackVersions,[names[0]]:'aaa6bc51-cd11-4864-be2d-b15260f5dbf1'}};
  },upload:async()=>({status:0})}),
 /KNOWLEDGE_CAPTURE_VERSION_STAGE_ACTIVE_DEPLOYMENT_CHANGED/);
});
