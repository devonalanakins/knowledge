import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 readCaptureVersionIds,readCaptureVersionMetadata,attestCaptureUploadedVersion,
} from '../src/forward-capture-version-attestation.mjs';

const a='dae6bc51-cd11-4864-be2d-b15260f5dbf1';
const newId='c61011ae-a96d-4f17-a2e5-2b7fe0a506f6';
const dbId='147ab931-7675-43b2-a8fc-eba2a2b72545';
const account='a'.repeat(32),token='FICTIONAL_PRIVATE_CLOUDFLARE_TOKEN_DO_NOT_PRINT';
const valid=()=>({
 id:newId,createdOn:'2026-11-10T14:00:00Z',
 source:'api',trigger:'version_upload',compatibilityDate:'2026-11-07',
 handlers:['fetch'],
 bindings:[{name:'CAPTURE_INBOX_DB',type:'d1',databaseId:dbId}],
});
test('metadata-only provider GETs identify one exact new nonpublic capture version',async()=>{
 const observed=[];
 const fetchImpl=async(url,opts)=>{
  observed.push({url,method:opts.method,redirect:opts.redirect,
   signed:opts.headers.Authorization==='Bearer '+token});
  const result=url.endsWith('/versions?per_page=30')
   ?{items:[{id:newId},{id:a}]}
   :{id:newId,metadata:{created_on:'2026-11-10T14:00:00Z',source:'api'},
     annotations:{'workers/triggered_by':'version_upload'},
     resources:{
      script_runtime:{compatibility_date:'2026-11-07'},
      script:{handlers:['fetch']},
      bindings:[{name:'CAPTURE_INBOX_DB',type:'d1',database_id:dbId}],
     }};
  return {ok:true,json:async()=>({success:true,result})};
 };
 const args={account,token,component:'ingress',fetchImpl};
 const afterIds=await readCaptureVersionIds(args);
 const metadata=await readCaptureVersionMetadata({...args,versionId:newId});
 assert.deepEqual(afterIds,[newId,a]);
 assert.equal(metadata.bindings[0].databaseId,dbId);
 const receipt=attestCaptureUploadedVersion({component:'ingress',
  beforeIds:[a],afterIds,metadata});
 assert.deepEqual(receipt,{status:'PROVIDER_VERSION_ATTESTED',
  versionId:newId,component:'ingress',trafficActivated:false});
 assert.equal(observed.length,2);
 assert.ok(observed.every(r=>r.method==='GET'&&r.redirect==='error'&&r.signed));
 assert.ok(observed[0].url.endsWith('/knowledge-capture-ingress-private/versions?per_page=30'));
 assert.ok(observed[1].url.endsWith('/knowledge-capture-ingress-private/versions/'+newId));
 assert.doesNotMatch(JSON.stringify(receipt),/FICTIONAL_PRIVATE|147ab931/);
});
test('processor requires fetch and scheduled event handlers but no extra bindings',()=>{
 const data=valid();data.handlers=['scheduled','fetch'];
 assert.equal(attestCaptureUploadedVersion({component:'processor',
  beforeIds:[a],afterIds:[newId,a],metadata:data}).trafficActivated,false);
 for(const handlers of [['fetch'],['scheduled'],['fetch','scheduled','alarm']]){
  assert.throws(()=>attestCaptureUploadedVersion({component:'processor',
   beforeIds:[a],afterIds:[newId,a],metadata:{...data,handlers}}),
   /KNOWLEDGE_CAPTURE_VERSION_ATTESTATION_UNAVAILABLE/);
 }
});
test('wrong, missing, reused or ambiguous version identity never attests',()=>{
 const m=valid();
 const candidates=[
  {beforeIds:[a],afterIds:[a]},
  {beforeIds:[a],afterIds:[newId]},
  {beforeIds:[a],afterIds:[newId,a,newId]},
  {beforeIds:[a],afterIds:[newId,'f'.repeat(8)+'-f0d0-4ed0-8ff0-ffffffffffff',a]},
  {beforeIds:[a],afterIds:[newId,a],metadata:{...m,id:a}},
  {beforeIds:[a],afterIds:[newId,a],metadata:{...m,trigger:'upload'}},
  {beforeIds:[a],afterIds:[newId,a],metadata:{...m,compatibilityDate:'2026-11-08'}},
  {beforeIds:[a],afterIds:[newId,a],metadata:{...m,createdOn:'untrusted'}},
  {beforeIds:[a],afterIds:[newId,a],metadata:{...m,source:'unknown'}},
  {beforeIds:[a],afterIds:[newId,a],metadata:{...m,bindings:[{...m.bindings[0],databaseId:'d942f8de-1f89-4942-adf7-e8ba00a72efa'}]}},
  {beforeIds:[a],afterIds:[newId,a],metadata:{...m,bindings:[...m.bindings,{name:'CAPTURE_MACHINE_AUTH_KEY_HEX',type:'secret_text'}]}},
  {beforeIds:[a],afterIds:[newId,a],metadata:{...m,handlers:['fetch','scheduled']}},
 ];
 for(const item of candidates)
  assert.throws(()=>attestCaptureUploadedVersion({
   component:'ingress',beforeIds:[a],afterIds:[newId,a],metadata:m,...item}),
   /KNOWLEDGE_CAPTURE_VERSION_ATTESTATION_UNAVAILABLE/);
});
test('provider token, malformed version list and incorrect metadata fail closed',async()=>{
 const endpoint={account,token,component:'ingress'};
 for(const response of [
  {ok:false,status:403},
  {ok:true,json:async()=>({success:false,result:{items:[{id:a}]}})},
  {ok:true,json:async()=>({success:true,result:{items:[]}})},
  {ok:true,json:async()=>({success:true,result:{items:[{id:a},{id:a}]}})},
  {ok:true,json:async()=>({success:true,result:{items:[{id:'bad'}]}})},
 ]){
  await assert.rejects(readCaptureVersionIds({...endpoint,fetchImpl:async()=>response}),
   /KNOWLEDGE_CAPTURE_VERSION_ATTESTATION_UNAVAILABLE/);
 }
 for(const input of [
  {...endpoint,component:'owner'},
  {...endpoint,account:'invalid'},
  {...endpoint,token:''},
 ]){
  await assert.rejects(readCaptureVersionIds({...input,fetchImpl:async()=>{throw Error('should not call');}}),
   /KNOWLEDGE_CAPTURE_VERSION_ATTESTATION_UNAVAILABLE/);
 }
 await assert.rejects(readCaptureVersionMetadata({
  ...endpoint,versionId:'invalid',fetchImpl:async()=>{throw Error('should not call');},
 }),/KNOWLEDGE_CAPTURE_VERSION_ATTESTATION_UNAVAILABLE/);
});
