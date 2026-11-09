import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessCaptureReleaseInventory,readCaptureReleasePreflight}
 from '../src/forward-capture-release-preflight.mjs';

const names=['knowledge-forward-private','knowledge-capture-ingress-private',
 'knowledge-capture-processor-private'];
const idOwner='11111111-1111-4111-8111-111111111111';
const idInbox='22222222-2222-4222-8222-222222222222';
const binding=(name,type,extra={})=>({name,type,...extra});
function fixture(){
 return {
  'knowledge-forward-private':{
   bindings:[
    binding('KNOWLEDGE_DB','d1',{id:idOwner}),
    binding('KNOWLEDGE_DATA_KEY','secret_text'),
    binding('KNOWLEDGE_PRIVATE_WRITE_ACK','secret_text'),
    binding('KNOWLEDGE_MACHINE_CAPTURE_ACK','plain_text'),
    binding('KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX','secret_text'),
   ],versions:[{percentage:100}],schedules:[],
  },
  'knowledge-capture-ingress-private':{
   bindings:[
    binding('CAPTURE_INBOX_DB','d1',{id:idInbox}),
    binding('CAPTURE_INGRESS_ACK','plain_text'),
    binding('CAPTURE_INGRESS_URL','plain_text'),
    binding('CAPTURE_WEBHOOK_SECRET','secret_text'),
    binding('CAPTURE_INBOX_ROOT_HEX','secret_text'),
    binding('CAPTURE_INBOX_KEY_ID','plain_text'),
    binding('CAPTURE_REPOSITORIES_JSON','plain_text'),
   ],versions:[{percentage:100}],schedules:[],
  },
  'knowledge-capture-processor-private':{
   bindings:[
    binding('CAPTURE_INBOX_DB','d1',{id:idInbox}),
    binding('CAPTURE_PROCESSOR_ACK','plain_text'),
    binding('CAPTURE_INBOX_ROOT_HEX','secret_text'),
    binding('CAPTURE_INBOX_KEY_ID','plain_text'),
    binding('CAPTURE_MACHINE_AUTH_KEY_HEX','secret_text'),
    binding('KNOWLEDGE_CAPTURE_WRITER','service',{
     service:'knowledge-forward-private',entrypoint:'KnowledgeCaptureEntrypoint'}),
   ],versions:[{percentage:100}],schedules:[{cron:'*/5 * * * *'}],
  },
 };
}
test('complete metadata is reviewable but never authorizes a live release',()=>{
 const r=assessCaptureReleaseInventory(fixture());
 assert.deepEqual(r,{status:'METADATA_READY_FOR_SEPARATE_REVIEW',
  releaseAuthorized:false,liveCaptureVerified:false,findings:[]});
});
test('missing activation metadata, isolated DB or Cron fail readiness',()=>{
 const f=fixture();
 f['knowledge-forward-private'].bindings=f['knowledge-forward-private'].bindings
  .filter(x=>x.name!=='KNOWLEDGE_MACHINE_CAPTURE_ACK'&&x.name!=='KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX');
 f['knowledge-capture-ingress-private'].bindings=f['knowledge-capture-ingress-private'].bindings
  .filter(x=>x.name!=='CAPTURE_WEBHOOK_SECRET');
 f['knowledge-capture-processor-private'].bindings=f['knowledge-capture-processor-private'].bindings
  .filter(x=>x.name!=='KNOWLEDGE_CAPTURE_WRITER');
 f['knowledge-capture-processor-private'].schedules=[];
 const r=assessCaptureReleaseInventory(f);
 assert.equal(r.status,'NOT_READY');
 assert.deepEqual(r.findings,[
  'knowledge-capture-ingress-private:MISSING_CAPTURE_WEBHOOK_SECRET',
  'knowledge-capture-processor-private:MISSING_KNOWLEDGE_CAPTURE_WRITER',
  'knowledge-capture-processor-private:NO_PROCESSOR_CRON',
  'knowledge-forward-private:MISSING_KNOWLEDGE_MACHINE_CAPTURE_ACK',
  'knowledge-forward-private:MISSING_KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX',
 ]);
});
test('wrong service target, shared owner D1 and accidental extra privilege are rejected',()=>{
 const f=fixture();
 f['knowledge-capture-processor-private'].bindings.find(x=>x.name==='KNOWLEDGE_CAPTURE_WRITER').entrypoint='default';
 f['knowledge-capture-processor-private'].bindings.find(x=>x.name==='CAPTURE_INBOX_DB').id=idOwner;
 f['knowledge-capture-ingress-private'].bindings.push(binding('KNOWLEDGE_DATA_KEY','secret_text'));
 const out=assessCaptureReleaseInventory(f);
 assert.equal(out.status,'NOT_READY');
 assert.ok(out.findings.includes('knowledge-capture-processor-private:WRONG_SERVICE_TARGET'));
 assert.ok(out.findings.includes('knowledge-capture-ingress-private:UNEXPECTED_KNOWLEDGE_DATA_KEY'));
 assert.ok(out.findings.includes('CAPTURE_INBOX_MUST_NOT_USE_OWNER_DB'));
 assert.ok(out.findings.includes('CAPTURE_WORKERS_MUST_SHARE_INBOX_DB'));
});
test('malformed or duplicate metadata and incomplete deployment fail closed',()=>{
 const cases=[
  f=>{f['knowledge-capture-processor-private'].bindings.push(
   binding('CAPTURE_INBOX_DB','d1',{id:idInbox}));},
  f=>{f['knowledge-forward-private'].versions=[];},
  f=>{f['knowledge-capture-ingress-private'].bindings.find(x=>x.name==='CAPTURE_WEBHOOK_SECRET').type='plain_text';},
  f=>{f['knowledge-capture-processor-private'].schedules.push({cron:'0 1 * * *'});},
 ];
 for(const alter of cases){
  const f=fixture();alter(f);
  if(f['knowledge-capture-processor-private'].bindings.filter(x=>x.name==='CAPTURE_INBOX_DB').length>1)
   assert.throws(()=>assessCaptureReleaseInventory(f),/KNOWLEDGE_CAPTURE_PREFLIGHT_UNAVAILABLE/);
  else assert.equal(assessCaptureReleaseInventory(f).status,'NOT_READY');
 }
});
test('Cloudflare transport permits only GET inventory and hides tokens/secret values',async()=>{
 const state=fixture();
 const account='a'.repeat(32);
 const token='test-only-private-api-token-do-not-log';
 const called=[];
 const fetchImpl=async(url,options)=>{
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer '+token);
  const match=/\/workers\/scripts\/([^/]+)\/(settings|deployments|schedules)$/.exec(url);
  assert.ok(match);
  assert.ok(names.includes(match[1]));
  called.push(match[1]+'/'+match[2]);
  const w=state[match[1]];
  const result=match[2]==='settings'?{bindings:w.bindings.map(x=>({...x,
   text:'private-config-value-should-never-be-returned'}))}:
   match[2]==='deployments'?{deployments:[{versions:w.versions}]}:
   {schedules:w.schedules};
  return {ok:true,json:async()=>({success:true,result})};
 };
 const r=await readCaptureReleasePreflight({token,account,fetchImpl});
 assert.equal(r.status,'METADATA_READY_FOR_SEPARATE_REVIEW');
 assert.equal(called.length,9);
 assert.equal(new Set(called).size,9);
 assert.doesNotMatch(JSON.stringify(r),/test-only-private|private-config-value|11111111|22222222/);
});
test('provider errors and bad input do not pass as metadata ready',async()=>{
 await assert.rejects(readCaptureReleasePreflight({token:'x',account:'bad'}),
  /KNOWLEDGE_CAPTURE_PREFLIGHT_UNAVAILABLE/);
 for(const response of [
  {ok:false,status:403},
  {ok:true,json:async()=>({success:false,result:{}})},
  {ok:true,json:async()=>({success:true,result:{}})},
 ]){
  await assert.rejects(readCaptureReleasePreflight({
   token:'test-only',account:'a'.repeat(32),fetchImpl:async()=>response,
  }),/KNOWLEDGE_CAPTURE_PREFLIGHT_UNAVAILABLE/);
 }
});
