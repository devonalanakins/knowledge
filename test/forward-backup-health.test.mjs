import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {expectedBackupDay,auditScheduledBackups} from '../src/forward-backup-health.mjs';

const scope='personal',keyId='owner-v1',firstDue='2026-11-08';
const prefix=`automated/${scope}/${keyId}/`;
const key=date=>`${prefix}${date}T08-00-00-000Z-11111111-1111-4111-8111-111111111111.json`;
const body=Buffer.from('fictional ciphertext-only fixture');
const md5=createHash('md5').update(body).digest('hex');
const row=date=>({key:key(date),size:body.length,etag:md5,custom_metadata:{sha256:createHash('sha256').update(body).digest('hex'),format:'knowledge-forward-ciphertext-backup-v1'}});
const fakeParser=(bytes,{expectedSha256})=>{
  assert.equal(expectedSha256,createHash('sha256').update(bytes).digest('hex'));
  return {snapshot:{scope,keyId,status:'automatic-owner-ciphertext',tables:{
    knowledge_pages:[1],knowledge_revisions:[1,2],knowledge_instance:[1],
  }}};
};
const base={scope,keyId,firstDue,parseSnapshot:fakeParser,
  now:new Date('2026-11-08T10:00:00.000Z'),listObjects:async()=>[row('2026-11-08')],
  readObject:async()=>new Uint8Array(body)};

test('uses 08:00 UTC plus grace, including before first scheduled run',()=>{
  assert.equal(expectedBackupDay(new Date('2026-11-08T09:29:59Z')),'2026-11-07');
  assert.equal(expectedBackupDay(new Date('2026-11-08T09:30:00Z')),'2026-11-08');
  assert.equal(expectedBackupDay(new Date('2026-11-09T00:00:00Z')),'2026-11-08');
  assert.throws(()=>expectedBackupDay(new Date('bad')),/BAD_CONFIGURATION/);
});
test('reports pending before the first configured due day without a false missed-backup alarm',async()=>{
  const r=await auditScheduledBackups({...base,now:new Date('2026-11-08T02:00:00Z'),listObjects:async()=>[]});
  assert.equal(r.status,'PENDING_FIRST_RUN');
  assert.equal(r.checked,0);
});
test('reads and hashes observed daily object against R2 ETag with metadata-only receipt',async()=>{
  const result=await auditScheduledBackups(base);
  assert.equal(result.status,'PASS');
  assert.equal(result.checked,1);
  assert.deepEqual(result.snapshots[0],{
    sha256:createHash('sha256').update(body).digest('hex'),bytes:body.length,
    pages:1,revisions:2,instances:1,
  });
  assert.doesNotMatch(JSON.stringify(result),/fictional ciphertext-only fixture/);
});
test('refuses missing or skipped daily snapshot, including prior day in lookback',async()=>{
  await assert.rejects(auditScheduledBackups({...base,listObjects:async()=>[]}),/MISSING_DAY/);
  await assert.rejects(auditScheduledBackups({...base,now:new Date('2026-11-09T11:00:00Z')}),/MISSING_DAY/);
});
test('detects readback tampering, metadata mismatch, and invalid snapshot format',async()=>{
  await assert.rejects(auditScheduledBackups({...base,readObject:async()=>Buffer.from('tampered')}),/READBACK_MISMATCH/);
  await assert.rejects(auditScheduledBackups({...base,listObjects:async()=>[{...row(firstDue),etag:'0'.repeat(32)}]}),/ETAG_MISMATCH/);
  await assert.rejects(auditScheduledBackups({...base,listObjects:async()=>[{...row(firstDue),custom_metadata:{...row(firstDue).custom_metadata,sha256:'0'.repeat(64)}}]}),/CHECKSUM_MISMATCH/);
  await assert.rejects(auditScheduledBackups({...base,parseSnapshot:()=>{throw new Error('bad')}}),/INVALID_SNAPSHOT/);
  await assert.rejects(auditScheduledBackups({...base,parseSnapshot:()=>({snapshot:{scope:'other',keyId,status:'automatic-owner-ciphertext'}})}),/INVALID_SNAPSHOT/);
});
test('rejects unexpected keys, unbounded retries, missing metadata and invalid dates',async()=>{
  await assert.rejects(auditScheduledBackups({...base,listObjects:async()=>[{...row(firstDue),key:prefix+'bad.json'}]}),/INVALID_LIST/);
  await assert.rejects(auditScheduledBackups({...base,listObjects:async()=>[row(firstDue),...Array(10).fill(row(firstDue))]}),/EXCESSIVE_RETRIES/);
  await assert.rejects(auditScheduledBackups({...base,listObjects:async()=>[{...row(firstDue),etag:null}]}),/INVALID_LIST/);
  await assert.rejects(auditScheduledBackups({...base,firstDue:'2026-13-01'}),/BAD_CONFIGURATION/);
});

const observedDispatch='2026-11-08T08-00-54-161Z-62806674-3fe3-47e1-9423-e242e5f306e8.json';
const customDispatch=(clock,day='2026-11-08')=>({
  ...row(day),
  key:`${prefix}${day}T${clock}Z-62806674-3fe3-47e1-9423-e242e5f306e8.json`,
});

test('accepts actual observed Cloudflare R2 scheduled backup filename without falsely alerting',async()=>{
  const fixture={...row('2026-11-08'),key:prefix+observedDispatch};
  const result=await auditScheduledBackups({...base,listObjects:async()=>[fixture]});
  assert.equal(result.status,'PASS');
  assert.equal(result.checked,1);
  assert.equal(result.expectedDay,'2026-11-08');
  assert.equal(result.snapshots[0].bytes,body.length);
});
test('accepts bounded dispatch seconds/minutes/milliseconds and configured grace',async()=>{
  for(const clock of ['08-00-00-000','08-00-54-161','08-59-59-999','09-30-00-000']){
    const result=await auditScheduledBackups({...base,listObjects:async()=>[customDispatch(clock)]});
    assert.equal(result.status,'PASS',clock);
  }
  const short=await auditScheduledBackups({...base,graceMinutes:60,
    listObjects:async()=>[customDispatch('09-00-00-000')]});
  assert.equal(short.status,'PASS');
});
test('rejects impossible, premature, late and excess-grace scheduled timestamps',async()=>{
  for(const clock of [
    '07-59-59-999','09-30-00-001','10-00-00-000','08-60-00-000',
    '08-00-60-000','08-99-00-000','24-00-00-000'
  ]){
    await assert.rejects(auditScheduledBackups({...base,
      listObjects:async()=>[customDispatch(clock)]}),/INVALID_LIST/,clock);
  }
  await assert.rejects(auditScheduledBackups({...base,graceMinutes:60,
    listObjects:async()=>[customDispatch('09-00-00-001')]}),/INVALID_LIST/);
  await assert.rejects(auditScheduledBackups({...base,
    listObjects:async()=>[customDispatch('08-00-54-161','2026-11-31')]}),/BAD_CONFIGURATION|INVALID_LIST/);
});
