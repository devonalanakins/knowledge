import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,chmodSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ApprovalLedger} from '../src/approval-ledger.mjs';
import {signHierarchyApproval} from '../src/hierarchy-approval.mjs';

const A='11111111111111111111111111111111';
const B='22222222222222222222222222222222';
const SHA='a'.repeat(64);
const NOW=Date.parse('2026-11-06T13:00:00.000Z');
const ISSUED='2026-11-06T12:00:00.000Z';
const EXPIRES='2026-11-13T12:00:00.000Z';
const reason='Move fictional reference into the reviewed evidence register';
const path='independent-software/evidence/source-evidence';
const pair=generateKeyPairSync('ed25519');
const pem=pair.privateKey.export({format:'pem',type:'pkcs8'});
const trust={'owner-key-1':{enabled:true,scopes:['devonstation'],
  publicKeyPem:pair.publicKey.export({format:'pem',type:'spki'})}};
function receipt(approvalId='abcabcabcabcabcabcabcabcabcabcab') {
 return signHierarchyApproval({
  approvalId,signerId:'owner-key-1',issuedAt:ISSUED,expiresAt:EXPIRES,
  sourceId:B,scope:'devonstation',sourceSha256:SHA,fromParentId:A,
  toParentId:null,toPath:path,reason,
 },pem);
}
const expected={sourceId:B,scope:'devonstation',sourceSha256:SHA,
 fromParentId:A,toParentId:null,toPath:path,reason};
function privateDir() {
 const dir=mkdtempSync(join(tmpdir(),'knowledge-g14-'));chmodSync(dir,0o700);
 return {dir,db:join(dir,'approvals.sqlite')};
}
function withLedger(fn){
 const l=new ApprovalLedger(':memory:',{syntheticOnly:true});
 try{return fn(l);}finally{l.close();}
}
test('G14 no ledger may be written without explicit synthetic-only guard',()=>{
 assert.throws(()=>new ApprovalLedger(),{code:'SYNTHETIC_ONLY'});
 const f=privateDir();
 try{
  assert.throws(()=>new ApprovalLedger(f.db),{code:'SYNTHETIC_ONLY'});
  assert.throws(()=>new ApprovalLedger(':memory:',{readOnly:true}),{code:'LEDGER_MISSING'});
  assert.throws(()=>new ApprovalLedger(f.db,{readOnly:true}),{code:'LEDGER_MISSING'});
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('G14 signed consumption persists, blocks replay and survives reopening',()=>{
 const f=privateDir(),r=receipt();
 try{
  const l=new ApprovalLedger(f.db,{syntheticOnly:true});
  const initial=l.audit();
  assert.deepEqual(initial,{valid:true,count:0,headHash:'0'.repeat(64)});
  const consumed=l.consume(r,expected,trust,{now:NOW});
  assert.equal(consumed.recorded,true);
  assert.equal(consumed.action,'consumed');
  assert.equal(consumed.count,1);
  assert.equal(l.status(r.approvalId),'consumed');
  assert.equal(l.isFinalized(r.approvalId),true);
  assert.equal(statSync(f.db).mode&0o777,0o600);
  assert.throws(()=>l.consume(r,expected,trust,{now:NOW}),{code:'UNVERIFIED_APPROVAL'});
  assert.throws(()=>l.revoke(r.approvalId,{now:NOW}),{code:'ALREADY_FINALIZED'});
  l.close();
  const reopened=new ApprovalLedger(f.db,{readOnly:true});
  try{
   assert.deepEqual(reopened.audit({expectedHead:consumed.headHash}),{
    valid:true,count:1,headHash:consumed.headHash});
   assert.equal(reopened.status(r.approvalId),'consumed');
   assert.throws(()=>reopened.revoke('12341234123412341234123412341234',{now:NOW}),{code:'READ_ONLY'});
  }finally{reopened.close();}
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('G14 revocation is exclusive with consumption and never exposes original approval IDs',()=>withLedger(l=>{
 const r=receipt();
 const revoked=l.revoke(r.approvalId,{now:NOW});
 assert.equal(revoked.action,'revoked');
 assert.equal(l.status(r.approvalId),'revoked');
 assert.throws(()=>l.consume(r,expected,trust,{now:NOW}),{code:'UNVERIFIED_APPROVAL'});
 assert.throws(()=>l.revoke(r.approvalId,{now:NOW}),{code:'ALREADY_FINALIZED'});
 const rows=l.db.prepare('SELECT * FROM approval_events').all();
 assert.equal(rows.length,1);
 const serialized=JSON.stringify(rows);
 assert.ok(!serialized.includes(r.approvalId));
 assert.ok(!serialized.includes(reason));
 assert.ok(!serialized.includes(r.signature));
 assert.ok(!serialized.includes(pem));
}));
test('G14 atomic conflict protection works across independent ledger handles',()=>{
 const f=privateDir(),r=receipt();
 let a,b;
 try{
  a=new ApprovalLedger(f.db,{syntheticOnly:true});
  b=new ApprovalLedger(f.db,{syntheticOnly:true});
  const first=a.consume(r,expected,trust,{now:NOW});
  assert.equal(first.count,1);
  assert.throws(()=>b.consume(r,expected,trust,{now:NOW}),{code:'UNVERIFIED_APPROVAL'});
  assert.equal(b.audit().count,1);
 }finally{a?.close();b?.close();rmSync(f.dir,{recursive:true,force:true});}
});
test('G14 modified or untrusted signatures are rejected without any ledger record',()=>withLedger(l=>{
 const r=receipt();
 const modified={...r,toPath:'independent-software/evidence/forged'};
 assert.throws(()=>l.consume(modified,expected,trust,{now:NOW}),{code:'UNVERIFIED_APPROVAL'});
 assert.throws(()=>l.consume(r,{...expected,sourceSha256:'f'.repeat(64)},trust,{now:NOW}),{code:'UNVERIFIED_APPROVAL'});
 assert.throws(()=>l.consume(r,expected,{}, {now:NOW}),{code:'UNVERIFIED_APPROVAL'});
 assert.throws(()=>l.consume(r,expected,trust,{now:Date.parse(EXPIRES)}),{code:'UNVERIFIED_APPROVAL'});
 assert.deepEqual(l.audit(),{valid:true,count:0,headHash:'0'.repeat(64)});
}));
test('G14 refuses symlink and world-readable ledger paths',()=>{
 const f=privateDir();
 try{
  let l=new ApprovalLedger(f.db,{syntheticOnly:true});l.close();
  chmodSync(f.db,0o644);
  assert.throws(()=>new ApprovalLedger(f.db,{readOnly:true}),{code:'UNSAFE_LEDGER_PATH'});
  chmodSync(f.db,0o600);
  symlinkSync(f.db,join(f.dir,'alias.sqlite'));
  assert.throws(()=>new ApprovalLedger(join(f.dir,'alias.sqlite'),{readOnly:true}),{code:'UNSAFE_LEDGER_PATH'});
  chmodSync(f.dir,0o755);
  assert.throws(()=>new ApprovalLedger(f.db,{readOnly:true}),{code:'UNSAFE_LEDGER_PATH'});
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('G14 hash-chain audit fails closed on modified SQLite rows',()=>{
 const f=privateDir(),r=receipt();
 try{
  const l=new ApprovalLedger(f.db,{syntheticOnly:true});
  const head=l.consume(r,expected,trust,{now:NOW}).headHash;l.close();
  let db=new DatabaseSync(f.db);
  db.exec('DROP TRIGGER approval_events_no_update');
  db.prepare('UPDATE approval_events SET recorded_at=? WHERE seq=1')
   .run('2026-11-06T14:00:00.000Z');
  db.close();
  assert.throws(()=>new ApprovalLedger(f.db,{readOnly:true}),{code:'LEDGER_INTEGRITY'});
  assert.notEqual(head,'0'.repeat(64));
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('G14 an external anchored head detects deletion even if a shortened chain remains valid',()=>{
 const f=privateDir();
 try{
  const l=new ApprovalLedger(f.db,{syntheticOnly:true});
  const r1=receipt(),r2=receipt('dddddddddddddddddddddddddddddddd');
  const first=l.consume(r1,expected,trust,{now:NOW});
  const second=l.consume(r2,expected,trust,{now:NOW});
  assert.equal(l.audit({expectedHead:second.headHash}).valid,true);
  l.close();
  const db=new DatabaseSync(f.db);
  db.exec('DROP TRIGGER approval_events_no_delete');
  db.prepare('DELETE FROM approval_events WHERE seq=2').run();
  db.close();
  const reader=new ApprovalLedger(f.db,{readOnly:true});
  try{
   assert.equal(reader.audit().valid,true,
     'Without an external head anchor, a truncated chain cannot be proven complete');
   assert.equal(reader.audit({expectedHead:second.headHash}).valid,false);
   assert.equal(reader.audit({expectedHead:first.headHash}).valid,true);
  }finally{reader.close();}
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
