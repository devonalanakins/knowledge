import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseForwardCiphertextSnapshot} from '../src/forward-ciphertext-restore.mjs';
import worker,{BACKUP_ACK,BACKUP_CRON,BACKUP_FORMAT,createCiphertextSnapshot,runScheduledBackup}
  from '../src/worker-cloudflare-backup.mjs';

const pathKey=Buffer.alloc(32,3).toString('base64url');
const marker=Buffer.alloc(32,2).toString('base64url');
const iso='2026-11-07T23:49:38.272Z';
const older='2026-11-07T23:46:05.691Z';
const seal=i=>JSON.stringify({format:'knowledge-sealed-v1',keyId:'owner-v1',
  nonce:Buffer.alloc(12,i).toString('base64url'),
  data:Buffer.alloc(64,i).toString('base64url')});
function fixture(){
  const old=seal(1),current=seal(2);
  const tables=[
    [{id:1,key_check:marker}],
    [{path_key:pathKey,version:2,sealed:current,updated_at:iso}],
    [{path_key:pathKey,version:1,sealed:old,created_at:older},
      {path_key:pathKey,version:2,sealed:current,created_at:iso}],
  ];
  const db={
    prepared:[],batchCalls:0,
    prepare(query){this.prepared.push(query);return {query};},
    async batch(queries){
      this.batchCalls++;
      assert.equal(queries.length,3);
      assert.deepEqual(queries.map(x=>x.query),this.prepared.slice(-3));
      return tables.map(results=>({success:true,results:structuredClone(results)}));
    },
  };
  const saved=new Map();
  const bucket={
    getCalls:0,putCalls:0,deleteCalls:0,
    async put(key,bytes,options){
      this.putCalls++;
      assert.equal(options.onlyIf.get('If-None-Match'),'*');
      assert.equal(options.httpMetadata.contentType,'application/json');
      if(saved.has(key))return null;
      saved.set(key,new Uint8Array(bytes));
      return {key,size:bytes.byteLength};
    },
    async get(key){
      this.getCalls++;
      const bytes=saved.get(key);
      return bytes?{arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;
    },
    async delete(){this.deleteCalls++;throw Error('No automatic deletions allowed');},
  };
  const env={BACKUP_ACK,BACKUP_SPACE:'personal',BACKUP_KEY_ID:'owner-v1',
    BACKUP_DB:db,BACKUP_BUCKET:bucket};
  const event={cron:BACKUP_CRON,scheduledTime:Date.parse('2026-11-08T08:00:00.000Z')};
  return {env,tables,saved,db,bucket,event};
}

test('scheduled backup takes three transactional D1 reads and produces offline-compatible ciphertext backup',async()=>{
  const f=fixture();
  const receipt=await runScheduledBackup(f.event,f.env);
  assert.equal(f.db.batchCalls,1);
  assert.equal(f.bucket.putCalls,1);
  assert.equal(f.bucket.getCalls,1);
  assert.equal(f.bucket.deleteCalls,0);
  assert.match(receipt.objectKey,/^automated\/personal\/owner-v1\/2026-11-08T08-00-00-000Z-[0-9a-f-]+\.json$/);
  const bytes=f.saved.get(receipt.objectKey);
  assert.equal(bytes.length,receipt.bytes);
  const parsed=parseForwardCiphertextSnapshot(bytes,{expectedSha256:receipt.sha256});
  assert.equal(parsed.snapshot.format,BACKUP_FORMAT);
  assert.equal(parsed.snapshot.status,'automatic-owner-ciphertext');
  assert.deepEqual(receipt.counts,{pages:1,revisions:2,instances:1});
  assert.deepEqual(parsed.snapshot.tables.knowledge_revisions,f.tables[2]);
  assert.ok(!JSON.stringify(parsed.snapshot).includes('Fictional acceptance record'));
  assert.equal(f.bucket.deleteCalls,0);
});

test('scheduled backup never overwrites earlier copies or prunes any R2 objects',async()=>{
  const f=fixture();
  const a=await runScheduledBackup(f.event,f.env);
  const b=await runScheduledBackup(f.event,f.env);
  assert.notEqual(a.objectKey,b.objectKey);
  assert.equal(f.saved.size,2);
  assert.equal(f.bucket.deleteCalls,0);
  assert.equal(f.db.batchCalls,2);
});

test('wrong cron and explicit acknowledgment fail before reading or writing D1/R2',async()=>{
  const f=fixture();
  await assert.rejects(runScheduledBackup({...f.event,cron:'* * * * *'},f.env),/NOT_SCHEDULED/);
  await assert.rejects(runScheduledBackup(f.event,{...f.env,BACKUP_ACK:''}),/DISABLED/);
  await assert.rejects(runScheduledBackup(f.event,{...f.env,BACKUP_KEY_ID:'Owner-v1'}),/DISABLED/);
  assert.equal(f.db.batchCalls,0);
  assert.equal(f.bucket.putCalls,0);
});

test('invalid pages, missing history, wrong key ID and missing instance never reach R2',async()=>{
  const mutations=[
    t=>{t[0]=[];},
    t=>{t[1][0].sealed='raw plaintext';},
    t=>{t[1][0].version=3;},
    t=>{t[2].pop();},
    t=>{t[2][0].path_key='bad';},
    t=>{t[2][1].sealed=JSON.stringify({...JSON.parse(t[2][1].sealed),keyId:'other'});},
    t=>{t[0][0].key_check='not-a-key';},
    t=>{t[2][1].created_at=older;},
  ];
  for(const change of mutations){
    const f=fixture();
    const malformed=structuredClone(f.tables);change(malformed);
    f.env.BACKUP_DB.batch=async()=>malformed.map(results=>({success:true,results}));
    await assert.rejects(runScheduledBackup(f.event,f.env),/INVALID_SOURCE/);
    assert.equal(f.bucket.putCalls,0);
    assert.equal(f.saved.size,0);
  }
});

test('empty or uninitialized database cannot produce a misleading successful backup',async()=>{
  const f=fixture();
  f.env.BACKUP_DB.batch=async()=>[
    {success:true,results:[]},{success:true,results:[]},{success:true,results:[]},
  ];
  await assert.rejects(runScheduledBackup(f.event,f.env),/INVALID_SOURCE/);
  assert.equal(f.bucket.putCalls,0);
});

test('D1 responses without explicit success and noncanonical ciphertext are rejected',async()=>{
  const f=fixture();
  f.env.BACKUP_DB.batch=async()=>[
    {results:structuredClone(f.tables[0])},
    {success:true,results:structuredClone(f.tables[1])},
    {success:true,results:structuredClone(f.tables[2])},
  ];
  await assert.rejects(runScheduledBackup(f.event,f.env),/INVALID_SOURCE/);
  assert.equal(f.bucket.putCalls,0);

  const invalidSeals=[
    {nonce:'A'.repeat(15),data:'A'.repeat(24)},
    {nonce:Buffer.alloc(12,1).toString('base64url'),data:'A'.repeat(25)},
    {nonce:Buffer.alloc(12,1).toString('base64url'),data:'!'.repeat(30)},
  ];
  for(const fields of invalidSeals){
    const sample=fixture(),tables=structuredClone(sample.tables);
    tables[1][0].sealed=JSON.stringify({...JSON.parse(tables[1][0].sealed),...fields});
    tables[2][1].sealed=tables[1][0].sealed;
    sample.env.BACKUP_DB.batch=async()=>tables.map(results=>({success:true,results}));
    await assert.rejects(runScheduledBackup(sample.event,sample.env),/INVALID_SOURCE/);
    assert.equal(sample.bucket.putCalls,0);
  }
});

test('corrupted R2 readback fails and never deletes either the bad object or older backups',async()=>{
  const f=fixture();
  f.env.BACKUP_BUCKET.get=async()=>({arrayBuffer:async()=>Buffer.from('modified').buffer.slice(0)});
  await assert.rejects(runScheduledBackup(f.event,f.env),/READBACK_FAILED/);
  assert.equal(f.bucket.putCalls,1);
  assert.equal(f.bucket.deleteCalls,0);
});

test('public HTTP requests cannot access scheduled backup content or trigger copies',async()=>{
  const f=fixture();
  const response=await worker.fetch(new Request('https://backup.example.test/'),f.env);
  assert.equal(response.status,404);
  assert.equal(await response.text(),'');
  assert.equal(f.db.batchCalls,0);
  assert.equal(f.bucket.putCalls,0);
});
