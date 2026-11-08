import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker,{WATCHDOG_ACK,WATCHDOG_CRON,auditDailyBackup}
  from '../src/worker-cloudflare-backup-watchdog.mjs';

const format='knowledge-forward-ciphertext-backup-v1',scope='personal',keyId='owner-v1';
const prefix='automated/personal/owner-v1/';
const uuid='62806674-3fe3-47e1-9423-e242e5f306e8';
const date='2026-11-08',timestamp='08-00-54-161';
const name=(day=date,time=timestamp,id=uuid)=>prefix+day+'T'+time+'Z-'+id+'.json';
const seal=value=>JSON.stringify({format:'knowledge-sealed-v1',keyId,
  nonce:Buffer.alloc(12,value).toString('base64url'),
  data:Buffer.alloc(64,value).toString('base64url')});
const index=Buffer.alloc(32,1).toString('base64url');
const marker=Buffer.alloc(32,2).toString('base64url');
const at='2026-11-08T08:00:00.000Z';
const snapshot=()=>({
  format,scope,keyId,schemaVersion:1,status:'automatic-owner-ciphertext',
  tables:{
    knowledge_instance:[{id:1,key_check:marker}],
    knowledge_pages:[{path_key:index,version:2,sealed:seal(2),updated_at:at}],
    knowledge_revisions:[
      {path_key:index,version:1,sealed:seal(1),created_at:'2026-11-08T07:59:00.000Z'},
      {path_key:index,version:2,sealed:seal(2),created_at:at},
    ],
  },
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture({content=snapshot(),dateValue=date}={}){
  const bytes=Buffer.from(JSON.stringify(content));
  const item={key:name(dateValue),size:bytes.length,
    customMetadata:{sha256:digest(bytes),format}};
  const calls={lists:0,gets:0,puts:0,deletes:0};
  const bucket={
    async list(options){
      calls.lists++;assert.ok(options.include.includes('customMetadata'));
      assert.match(options.prefix,/^automated\/personal\/owner-v1\/\d{4}-\d\d-\d\d$/);
      return {objects:[item],truncated:false};
    },
    async get(key){calls.gets++;assert.equal(key,item.key);
      return {size:bytes.length,arrayBuffer:async()=>bytes};},
    async put(){calls.puts++;throw Error('WATCHDOG_MUST_NOT_WRITE');},
    async delete(){calls.deletes++;throw Error('WATCHDOG_MUST_NOT_DELETE');},
  };
  const env={BACKUP_WATCHDOG_ACK:WATCHDOG_ACK,BACKUP_WATCHDOG_SPACE:scope,
    BACKUP_WATCHDOG_KEY_ID:keyId,BACKUP_WATCHDOG_FIRST_DUE:date,
    BACKUP_WATCHDOG_BUCKET:bucket};
  const controller={cron:WATCHDOG_CRON,scheduledTime:Date.parse('2026-11-08T10:00:00Z')};
  return {env,bucket,item,bytes,calls,controller};
}
test('genuine Cloudflare timestamp at 08:00:54.161Z passes read-only scheduled verification',async()=>{
  const f=fixture();
  const result=await auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z'));
  assert.deepEqual(result,{status:'PASS',day:date,checked:1,daysChecked:1,counts:{pages:1,revisions:2,instances:1}});
  assert.equal(f.calls.lists,1);assert.equal(f.calls.gets,1);
  assert.equal(f.calls.puts,0);assert.equal(f.calls.deletes,0);
});
test('scheduled handler runs only the intended Cron, with public HTTP always 404',async()=>{
  const f=fixture();
  assert.equal((await worker.fetch(new Request('https://watchdog.example.test/'))).status,404);
  assert.equal(f.calls.lists,0);
  await assert.rejects(worker.scheduled({...f.controller,cron:'* * * * *'},f.env),
    /WATCHDOG_NOT_SCHEDULED/);
  assert.equal(f.calls.lists,0);
  await worker.scheduled(f.controller,f.env);
  assert.equal(f.calls.puts+f.calls.deletes,0);
});
test('missing scheduled day is a failure, not a saved or healthy receipt',async()=>{
  const f=fixture();
  f.bucket.list=async()=>({objects:[],truncated:false});
  await assert.rejects(auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z')),
    /WATCHDOG_MISSING_DAY/);
  await assert.rejects(worker.scheduled(f.controller,f.env),/WATCHDOG_FAILED/);
  assert.equal(f.calls.gets,0);
});
test('first due-day pending is not falsely reported as a PASS',async()=>{
  const f=fixture();
  const env={...f.env,BACKUP_WATCHDOG_FIRST_DUE:'2026-11-10'};
  const r=await auditDailyBackup(env,new Date('2026-11-09T10:00:00Z'));
  assert.deepEqual(r,{status:'PENDING_FIRST_RUN',day:'2026-11-09',checked:0});
  assert.equal(f.calls.lists,0);
});
test('fails closed on missing or mismatched SHA-256, size, format and tampered data',async()=>{
  const mutations=[
    item=>{item.customMetadata.sha256='0'.repeat(64);},
    item=>{delete item.customMetadata.sha256;},
    item=>{item.size+=1;},
    item=>{item.customMetadata.format='plaintext';},
  ];
  for(const mutate of mutations){
    const f=fixture();mutate(f.item);
    await assert.rejects(auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z')),
      /KNOWLEDGE_BACKUP_WATCHDOG_(INVALID_METADATA|READBACK_MISMATCH|CHECKSUM_MISMATCH)/);
  }
  const corrupted=fixture();
  corrupted.bucket.get=async()=>({size:corrupted.bytes.length,arrayBuffer:async()=>Buffer.from('tampered')});
  await assert.rejects(auditDailyBackup(corrupted.env,new Date('2026-11-08T10:00:00Z')),
    /READBACK_MISMATCH/);
});
test('rejects malformed snapshot revision chain, wrong scope, plaintext and broken JSON',async()=>{
  const variants=[
    s=>{s.scope='other';},
    s=>{s.tables.knowledge_revisions=[];},
    s=>{s.tables.knowledge_pages[0].sealed='raw plaintext';},
    s=>{s.tables.knowledge_instance=[];},
    s=>{s.tables.knowledge_pages[0].version=3;},
  ];
  for(const change of variants){
    const data=snapshot();change(data);const f=fixture({content:data});
    await assert.rejects(auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z')),
      /WATCHDOG_INVALID_SNAPSHOT/);
  }
  const f=fixture();
  const body=Buffer.from('{invalid json');
  f.item.size=body.length;f.item.customMetadata.sha256=digest(body);
  f.bucket.get=async()=>({size:body.length,arrayBuffer:async()=>body});
  await assert.rejects(auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z')),
    /WATCHDOG_INVALID_SNAPSHOT/);
});
test('rejects invalid scheduled clock, off-schedule names and invalid first-due configuration',async()=>{
  for(const time of ['07-59-59-999','08-60-00-000','09-30-00-001',
    '24-00-00-000','08-00-60-000','08-99-00-000']){
    const f=fixture();f.item.key=name(date,time);
    await assert.rejects(auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z')),
      /WATCHDOG_INVALID_NAME/,time);
  }
  const f=fixture();
  await assert.rejects(auditDailyBackup({...f.env,BACKUP_WATCHDOG_FIRST_DUE:'2026-02-30'},
    new Date('2026-11-08T10:00:00Z')),/WATCHDOG_DISABLED/);
  await assert.rejects(auditDailyBackup(f.env,new Date(NaN)),/WATCHDOG_INVALID_CLOCK/);
  await assert.rejects(auditDailyBackup({...f.env,BACKUP_WATCHDOG_BUCKET:null},
    new Date('2026-11-08T10:00:00Z')),/WATCHDOG_DISABLED/);
});
test('rejects replayed object and invalid cursor without repeated reads',async()=>{
  const f=fixture();
  f.bucket.list=async()=>({objects:[f.item,f.item],truncated:false});
  await assert.rejects(auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z')),
    /WATCHDOG_DUPLICATE/);
  f.bucket.list=async()=>({objects:[],truncated:true,cursor:''});
  await assert.rejects(auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z')),
    /WATCHDOG_INVALID_CURSOR/);
  assert.equal(f.calls.gets,0);
});
test('valid paginated retry backup generations are all authenticated and counted',async()=>{
  const f=fixture();
  const second={...f.item,key:name(date,'08-00-55-000',
    '11111111-1111-4111-8111-111111111111')};
  f.bucket.list=async options=>options.cursor?
    {objects:[second],truncated:false}:{objects:[f.item],truncated:true,cursor:'after1'};
  f.bucket.get=async()=>({size:f.bytes.length,arrayBuffer:async()=>f.bytes});
  const result=await auditDailyBackup(f.env,new Date('2026-11-08T10:00:00Z'));
  assert.equal(result.status,'PASS');assert.equal(result.checked,2);
});

test('checks rolling seven-day continuity without unnecessarily downloading older generations',async()=>{
  const f=fixture();
  const days=['2026-11-08','2026-11-09','2026-11-10'];
  f.bucket.list=async options=>{
    const target=options.prefix.slice(-10);
    if(!days.includes(target))return {objects:[],truncated:false};
    return {objects:[{...f.item,key:name(target)}],truncated:false};
  };
  f.bucket.get=async key=>{
    assert.equal(key,name('2026-11-10'));
    f.calls.gets++;
    return {size:f.bytes.length,arrayBuffer:async()=>f.bytes};
  };
  const result=await auditDailyBackup(f.env,new Date('2026-11-10T10:00:00Z'));
  assert.equal(result.status,'PASS');
  assert.equal(result.day,'2026-11-10');
  assert.equal(result.daysChecked,3);
  assert.equal(result.checked,1);
  assert.equal(f.calls.gets,1);
});
test('missing earlier day is detected even when today’s snapshot is present',async()=>{
  const f=fixture();
  f.bucket.list=async options=>{
    const datePart=options.prefix.slice(-10);
    return {objects:datePart==='2026-11-08'?[]:[{...f.item,key:name(datePart)}],
      truncated:false};
  };
  await assert.rejects(auditDailyBackup(f.env,new Date('2026-11-09T10:00:00Z')),
    /KNOWLEDGE_BACKUP_WATCHDOG_MISSING_DAY/);
  assert.equal(f.calls.gets,0);
});
