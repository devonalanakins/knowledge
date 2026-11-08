import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {CaptureInputError,verifySignedGitHubMerge,saveVerifiedGitHubMerge} from '../src/forward-github-capture.mjs';

const secret = 'fictional-github-webhook-secret-32-characters-plus';
const id='8fb147db-aa97-47ac-8213-b70c73a71fa3';
const sha='a'.repeat(40);
const allowlisted={'devonalanakins/knowledge':{scope:'personal',pathPrefix:'engineering/knowledge'}};
const fixture=()=>({
  action:'closed',
  number:31,
  repository:{id:12345,full_name:'devonalanakins/knowledge'},
  pull_request:{number:31,merged:true,merge_commit_sha:sha,merged_at:'2026-11-08T16:00:00Z',
    title:'Do not trust this title: secret or patient content',body:'sensitive fixture text'},
});
const signed=(data=fixture(),extra={})=>{
  const body=typeof data==='string'?data:JSON.stringify(data);
  const headers={
    'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex'),
    'x-github-event':'pull_request',
    'x-github-delivery':id,
    ...extra,
  };
  return {body,headers,secret,repositories:allowlisted};
};
const valid=()=>verifySignedGitHubMerge(signed());
function memoryAdapter(){
  const pages=new Map();
  const writes=[];
  return {
    pages,writes,
    async read(path){return pages.has(path)?{page:structuredClone(pages.get(path))}:null;},
    async capture(args){
      writes.push(args);
      const prior=pages.get(args.path);
      if(args.expectedVersion!==(prior?.version??0)){
        const e=new Error('Concurrent write');e.code='VERSION_CONFLICT';throw e;
      }
      pages.set(args.path,{...args,status:'draft',version:(prior?.version??0)+1});
    },
  };
}
test('signed merged event creates minimal nonclinical receipt without untrusted PR text',async()=>{
  const c=await valid();
  assert.equal(c.eventKey,'github:pr-merge:12345:31:'+sha);
  assert.equal(c.path,'engineering/knowledge/pr-31');
  assert.match(c.body,/SOURCE-EVENT VERIFIED/);
  assert.doesNotMatch(c.body,/patient content|sensitive fixture text/);
  assert.equal(c.sourceAuthenticated,true);
  assert.equal(c.scope,'personal');
  assert.equal(c.sourceUrl,'https://github.com/devonalanakins/knowledge/pull/31');
});
test('raw-body signature verification refuses tampering and unsigned events',async()=>{
  const v=signed();
  await assert.rejects(verifySignedGitHubMerge({...v,body:v.body+' '}),{code:'INVALID_SIGNATURE'});
  await assert.rejects(verifySignedGitHubMerge({...v,headers:{...v.headers,'x-hub-signature-256':'sha256='+'0'.repeat(64)}}),{code:'INVALID_SIGNATURE'});
  await assert.rejects(verifySignedGitHubMerge({...v,headers:{'x-github-event':'pull_request','x-github-delivery':id}}),{code:'INVALID_SIGNATURE'});
  await assert.rejects(verifySignedGitHubMerge({...v,secret:''}),{code:'SIGNING_KEY_UNAVAILABLE'});
});
test('reject unapproved repository and cross-workspace mappings',async()=>{
  const other=fixture();other.repository.full_name='someone/other';
  await assert.rejects(verifySignedGitHubMerge(signed(other)),{code:'SCOPE_NOT_AUTHORIZED'});
  await assert.rejects(verifySignedGitHubMerge({...signed(),repositories:{
    'devonalanakins/knowledge':{scope:'clinical',pathPrefix:'private/patients'}}}),{code:'SCOPE_NOT_AUTHORIZED'});
});
test('ignore nonmerge and unrelated webhook events',async()=>{
  const other=fixture();other.pull_request.merged=false;
  assert.equal(await verifySignedGitHubMerge(signed(other)),null);
  const opened=fixture();opened.action='opened';
  assert.equal(await verifySignedGitHubMerge(signed(opened)),null);
  assert.equal(await verifySignedGitHubMerge(signed(fixture(),{'x-github-event':'push'})),null);
});
test('reject invalid IDs, payload size, and invalid source commit',async()=>{
  const invalid=fixture();invalid.pull_request.merge_commit_sha='not-a-sha';
  await assert.rejects(verifySignedGitHubMerge(signed(invalid)),{code:'INVALID_DELIVERY'});
  const v=signed();
  await assert.rejects(verifySignedGitHubMerge({...v,headers:{...v.headers,'x-github-delivery':'bad'}}),{code:'INVALID_DELIVERY'});
  await assert.rejects(verifySignedGitHubMerge(signed('x'.repeat(65537))),{code:'INVALID_DELIVERY'});
  await assert.rejects(verifySignedGitHubMerge(signed('{not json')), {code:'INVALID_DELIVERY'});
});
test('create/readback marks saved; duplicate and distinct delivery ID cannot create new revisions',async()=>{
  const candidate=await valid();const db=memoryAdapter();
  const first=await saveVerifiedGitHubMerge(candidate,db);
  assert.deepEqual({status:first.status,action:first.action,version:first.version},{status:'SAVED',action:'created',version:1});
  const again=await saveVerifiedGitHubMerge(candidate,db);
  assert.deepEqual({status:again.status,action:again.action,version:again.version},{status:'SAVED',action:'unchanged',version:1});
  assert.equal(db.writes.length,1);
});
test('different preexisting content is never overwritten; routine status remains pending',async()=>{
  const candidate=await valid();const db=memoryAdapter();
  db.pages.set(candidate.path,{path:candidate.path,title:'Owner edited',body:'Keep this',sourceUrl:null,status:'draft',version:7});
  const saved=await saveVerifiedGitHubMerge(candidate,db);
  assert.equal(saved.status,'PENDING_KNOWLEDGE_UNSAVED');
  assert.equal(saved.reason,'EXISTING_RECORD_CONFLICT');
  assert.equal(db.writes.length,0);
  assert.equal(db.pages.get(candidate.path).body,'Keep this');
});
test('write failure/readback failure and missing capture adapter cannot fake success',async()=>{
  const candidate=await valid();
  const failed=await saveVerifiedGitHubMerge(candidate,{read:async()=>null,capture:async()=>{throw Error('offline');}});
  assert.equal(failed.status,'PENDING_KNOWLEDGE_UNSAVED');
  assert.equal(failed.reason,'WRITE_FAILED');
  const noReadback=await saveVerifiedGitHubMerge(candidate,{read:async()=>null,capture:async()=>({action:'created'})});
  assert.equal(noReadback.reason,'READBACK_MISMATCH');
  const readUnavailable=await saveVerifiedGitHubMerge(candidate,{read:async()=>{throw Error('offline');},capture:async()=>{}});
  assert.equal(readUnavailable.reason,'READ_UNAVAILABLE');
  await assert.rejects(saveVerifiedGitHubMerge({...candidate,scope:'professional'},memoryAdapter()),{code:'NOT_CAPTURE_ELIGIBLE'});
  await assert.rejects(saveVerifiedGitHubMerge(candidate,{}),{code:'INVALID_ADAPTER'});
});
test('stale-version race reconciles safely; mismatched concurrency remains pending',async()=>{
  const c=await valid();const db=memoryAdapter();let raced=false;
  const adapter={
    read:db.read,
    async capture(args) {
      if(!raced){
        raced=true;db.pages.set(c.path,{path:c.path,title:c.title,body:c.body,sourceUrl:c.sourceUrl,status:'draft',version:1});
        const e=Error('stale');e.code='VERSION_CONFLICT';throw e;
      }
      return db.capture(args);
    },
  };
  const saved=await saveVerifiedGitHubMerge(c,adapter);
  assert.equal(saved.status,'SAVED');
  assert.equal(saved.action,'unchanged');
  assert.equal(db.writes.length,0);
  const losing={read:async()=>null,capture:async()=>{const e=Error('stale');e.code='VERSION_CONFLICT';throw e;}};
  const pending=await saveVerifiedGitHubMerge(c,losing);
  assert.equal(pending.reason,'CONCURRENT_VERSION_CONFLICT');
});
