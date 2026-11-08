import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {mkdtemp,readFile,readdir,writeFile,chmod,lstat,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mirrorScheduledBackupCiphertext} from '../src/forward-backup-offsite-mirror.mjs';

const scope='personal',keyId='owner-v1',firstDue='2026-11-08';
const prefix='automated/'+scope+'/'+keyId+'/';
const uuid1='62806674-3fe3-47e1-9423-e242e5f306e8';
const uuid2='11111111-1111-4111-8111-111111111111';
const knownRoot='0123456789abcdef'.repeat(4); // FICTIONAL only.
const passphraseNeverUsed='not-needed';
const b64=data=>Buffer.from(data).toString('base64url');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const md5=bytes=>createHash('md5').update(bytes).digest('hex');
async function encryptedFixture(){
 const raw=Buffer.from(knownRoot,'hex');
 const root=await webcrypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);raw.fill(0);
 const options={name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('Knowledge forward-only v1')};
 const aes=await webcrypto.subtle.deriveKey({...options,info:new TextEncoder().encode('content-encryption')},
   root,{name:'AES-GCM',length:256},false,['encrypt']);
 const mac=await webcrypto.subtle.deriveKey({...options,info:new TextEncoder().encode('path-indexing')},
   root,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const hmac=async message=>b64(await webcrypto.subtle.sign('HMAC',mac,new TextEncoder().encode(message)));
 const path='fictional/offsite-test',time='2026-11-07T19:00:00.000Z';
 const pathKey=await hmac('path-v1\0'+scope+'\0'+path);
 const instance=await hmac('knowledge-instance-v1\0'+scope+'\0'+keyId);
 const page={path,title:'Fictional offsite acceptance',body:'FICTIONAL RECORD ONLY',
  status:'draft',sourceUrl:null,version:1,updatedAt:time};
 const nonce=webcrypto.getRandomValues(new Uint8Array(12));
 const aad=new TextEncoder().encode('knowledge-record-v1\0'+scope+'\0'+pathKey+'\0'+page.version);
 const encrypted=await webcrypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad},
   aes,new TextEncoder().encode(JSON.stringify(page)));
 const sealed=JSON.stringify({format:'knowledge-sealed-v1',keyId,nonce:b64(nonce),data:b64(encrypted)});
 const snapshot={format:'knowledge-forward-ciphertext-backup-v1',scope,keyId,schemaVersion:1,
  status:'automatic-owner-ciphertext',
  tables:{knowledge_instance:[{id:1,key_check:instance}],
   knowledge_pages:[{path_key:pathKey,version:1,sealed,updated_at:time}],
   knowledge_revisions:[{path_key:pathKey,version:1,sealed,created_at:time}]}};
 const bytes=Buffer.from(JSON.stringify(snapshot));
 assert.ok(!bytes.toString('utf8').includes('FICTIONAL RECORD ONLY'));
 return bytes;
}
function obj(date,uuid,bytes){
 const key=prefix+date+'T08-00-54-161Z-'+uuid+'.json';
 return {key,size:bytes.length,etag:md5(bytes),custom_metadata:{
  format:'knowledge-forward-ciphertext-backup-v1',sha256:sha(bytes)}};
}
async function fixture(){
 const targetDirectory=await mkdtemp(join(tmpdir(),'knowledge-offsite-mirror-'));
 const bytes=await encryptedFixture();
 const objects=[obj('2026-11-08',uuid1,bytes),obj('2026-11-09',uuid2,bytes)];
 const source={listObjects:async()=>objects,readObject:async()=>bytes,scope,keyId,firstDue,
  now:new Date('2026-11-09T10:00:00.000Z'),targetDirectory};
 return {targetDirectory,bytes,objects,source,
  close:()=>rm(targetDirectory,{recursive:true,force:true})};
}
test('owner-local mirror copies genuine-format encrypted receipts with mode 0600, then retries idempotently',async()=>{
 const f=await fixture();try{
  const result=await mirrorScheduledBackupCiphertext(f.source);
  assert.deepEqual(result,{status:'PASS',created:2,unchanged:0,verified:2,
   dueDay:'2026-11-09',coverage:'RECENT_DUE_DAYS_ONLY'});
  const files=await readdir(f.targetDirectory);
  assert.equal(files.length,2);
  assert.ok(files.every(x=>x.startsWith(scope+'--'+keyId+'--')));
  for(const name of files){
   const path=join(f.targetDirectory,name),s=await lstat(path);
   assert.equal(s.mode&0o777,0o600);
   assert.equal(s.nlink,1);
   assert.equal(sha(await readFile(path)),sha(f.bytes));
  }
  const retry=await mirrorScheduledBackupCiphertext(f.source);
  assert.equal(retry.created,0);
  assert.equal(retry.unchanged,2);
  assert.equal((await readdir(f.targetDirectory)).length,2);
 }finally{await f.close();}
});
test('local corrupted backup refuses overwrite, including failed retry with unchanged bytes',async()=>{
 const f=await fixture();try{
  await mirrorScheduledBackupCiphertext(f.source);
  const name=scope+'--'+keyId+'--'+f.objects[0].key.slice(prefix.length);
  const path=join(f.targetDirectory,name),corrupt=Buffer.from('not the original backup');
  await writeFile(path,corrupt,{mode:0o600});
  await assert.rejects(mirrorScheduledBackupCiphertext(f.source),/EXISTING_FILE_MISMATCH/);
  assert.deepEqual(await readFile(path),corrupt);
 }finally{await f.close();}
});
test('refuses insecure destination modes and symlink directories without writing',async()=>{
 const f=await fixture();try{
  await chmod(f.targetDirectory,0o755);
  await assert.rejects(mirrorScheduledBackupCiphertext(f.source),/INSECURE_DESTINATION/);
  await chmod(f.targetDirectory,0o700);
  const path=f.targetDirectory+'-link';
  await symlink(f.targetDirectory,path);
  try{await assert.rejects(mirrorScheduledBackupCiphertext({...f.source,targetDirectory:path}),/INSECURE_DESTINATION/);}
  finally{await rm(path,{force:true});}
  assert.deepEqual(await readdir(f.targetDirectory),[]);
 }finally{await f.close();}
});
test('detects missing day, untrusted source checksum, and duplicate listing before writing',async()=>{
 const f=await fixture();try{
  await assert.rejects(mirrorScheduledBackupCiphertext({...f.source,
    listObjects:async()=>[f.objects[0]]}),/MISSING_DAY/);
  await assert.rejects(mirrorScheduledBackupCiphertext({...f.source,
    listObjects:async()=>[{...f.objects[0],custom_metadata:{
      ...f.objects[0].custom_metadata,sha256:'0'.repeat(64)}},f.objects[1]]}),/UNTRUSTED_OBJECT/);
  await assert.rejects(mirrorScheduledBackupCiphertext({...f.source,
    listObjects:async()=>[...f.objects,f.objects[0]]}),/DUPLICATE_OBJECT/);
  assert.deepEqual(await readdir(f.targetDirectory),[]);
 }finally{await f.close();}
});
test('partial transport failure retains one verified generation; subsequent retry resumes without clobbering it',async()=>{
 const f=await fixture();try{
  let n=0;
  const broken={...f.source,readObject:async()=>{n++;if(n===3)throw Error('fictional network outage');return f.bytes;}};
  await assert.rejects(mirrorScheduledBackupCiphertext(broken),/network outage/);
  assert.equal((await readdir(f.targetDirectory)).length,1);
  const retry=await mirrorScheduledBackupCiphertext(f.source);
  assert.equal(retry.created,1);
  assert.equal(retry.unchanged,1);
  assert.equal(retry.verified,2);
 }finally{await f.close();}
});
test('honors pending-first-run without creating a false successful mirror',async()=>{
 const f=await fixture();try{
  const result=await mirrorScheduledBackupCiphertext({...f.source,
    firstDue:'2026-11-10',now:new Date('2026-11-09T06:00:00.000Z'),
    listObjects:async()=>[]});
  assert.equal(result.status,'PENDING_FIRST_RUN');
  assert.equal(result.verified,0);
  assert.deepEqual(await readdir(f.targetDirectory),[]);
 }finally{await f.close();}
});
