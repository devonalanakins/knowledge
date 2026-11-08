import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CAPTURE_HEALTH_SQL,evaluateCaptureInboxHealth,readCaptureInboxHealth}
 from '../src/forward-capture-health.mjs';

const now=new Date('2026-11-08T18:00:00.000Z');
const instant='2026-11-08T17:55:00.000Z';
const row=(state,n,extra={})=>({
 state,n,max_attempts:0,earliest_next_at:null,earliest_lease_until:null,...extra,
});
const cfg={token:'fictional-token',account:'a'.repeat(32),
 database:'11111111-1111-4111-8111-111111111111',now};
test('empty capture inbox is not a verified Knowledge save',()=>{
 const report=evaluateCaptureInboxHealth([],{now});
 assert.equal(report.status,'NO_EVENTS');
 assert.equal(report.total,0);
 assert.equal(report.evidence,'INBOX_LEDGER_ONLY_NOT_KNOWLEDGE_READBACK');
 assert.equal(JSON.stringify(report).includes('delivery_key'),false);
});
test('queued, leased and saved states are distinct from failed or blocked receipts',()=>{
 const rows=[row('saved',3),row('queued',1,{earliest_next_at:instant}),
   row('leased',2,{earliest_lease_until:'2026-11-08T18:01:00.000Z'})];
 const report=evaluateCaptureInboxHealth(rows,{now});
 assert.equal(report.status,'IN_PROGRESS');
 assert.equal(report.pending,3);assert.equal(report.total,6);
 assert.equal(report.staleQueued,false);
 assert.equal(report.staleLeased,false);
 assert.equal(evaluateCaptureInboxHealth([row('saved',3)],{now}).status,'LEDGER_SAVED_ONLY');
});
test('blocked, failed, overdue next-at and stuck leased receipts require attention',()=>{
 const cases=[
  [row('blocked',1),'exceptions'],
  [row('failed',2,{max_attempts:8}),'exceptions'],
  [row('queued',1,{earliest_next_at:'2026-11-08T17:00:00.000Z'}),'staleQueued'],
  [row('leased',1,{earliest_lease_until:'2026-11-08T17:50:00.000Z'}),'staleLeased'],
 ];
 for(const [entry,indicator] of cases){
  const report=evaluateCaptureInboxHealth([entry],{now});
  assert.equal(report.status,'ATTENTION_REQUIRED');
  assert.ok(report[indicator],indicator);
 }
});
test('exact boundaries avoid false positives',()=>{
 const r=evaluateCaptureInboxHealth([
  row('queued',1,{earliest_next_at:'2026-11-08T17:30:00.000Z'}),
  row('leased',1,{earliest_lease_until:'2026-11-08T17:58:00.000Z'}),
 ],{now});
 assert.equal(r.status,'IN_PROGRESS');
});
test('unknown states, duplicate groups, malformed clock or absurd data fail closed',()=>{
 const bad=[
  [row('unknown',1)],
  [row('saved',1),row('saved',1)],
  [row('saved',0)],
  [row('failed',-1)],
  [row('queued',1,{earliest_next_at:'2026-11-08T17:60:00.000Z'})],
  [row('leased',1,{earliest_lease_until:'broken'})],
  [row('saved',1,{max_attempts:101})],
 ];
 for(const rows of bad)
  assert.throws(()=>evaluateCaptureInboxHealth(rows,{now}),/KNOWLEDGE_CAPTURE_HEALTH_INVALID_RESPONSE/);
 assert.throws(()=>evaluateCaptureInboxHealth([],{now:new Date(NaN)}),/BAD_CLOCK/);
 assert.throws(()=>evaluateCaptureInboxHealth([],{now,queueGraceMs:-1}),/BAD_CONFIGURATION/);
});
test('read-only fixed SELECT uses least disclosure, no raw rows in report',async()=>{
 let calls=0;
 const transport=async(url,options)=>{
  calls++;assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.match(url,/\/d1\/database\/11111111-1111-4111-8111-111111111111\/query$/);
  assert.equal(JSON.parse(options.body).sql,CAPTURE_HEALTH_SQL);
  assert.doesNotMatch(options.body,/sealed|delivery_key|SELECT \*/i);
  return {ok:true,headers:new Headers(),json:async()=>({
   success:true,result:[{success:true,results:[
    row('saved',2),row('failed',1,{max_attempts:8}),
   ]}],
  })};
 };
 const result=await readCaptureInboxHealth({...cfg,fetchImpl:transport});
 assert.equal(calls,1);
 assert.equal(result.status,'ATTENTION_REQUIRED');
 assert.equal(result.totals.failed,1);
 assert.equal(JSON.stringify(result).includes('fictional-token'),false);
});
test('provider errors, malformed API output and wrong credentials never yield healthy',async()=>{
 const variations=[
  async()=>{throw Error('token and private data in provider error');},
  async()=>({ok:false,status:403}),
  async()=>({ok:true,headers:new Headers(),json:async()=>({success:true,result:[]})}),
  async()=>({ok:true,headers:new Headers(),json:async()=>({success:true,result:[{success:true,results:[row('unexpected',1)]}]})}),
 ];
 for(const fetchImpl of variations)
  await assert.rejects(readCaptureInboxHealth({...cfg,fetchImpl}),
    /KNOWLEDGE_CAPTURE_HEALTH_(PROVIDER_UNAVAILABLE|INVALID_RESPONSE)/);
 await assert.rejects(readCaptureInboxHealth({...cfg,account:'invalid'}),
    /BAD_CONFIGURATION/);
});
