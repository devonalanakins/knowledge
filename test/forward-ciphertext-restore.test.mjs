import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {mkdtemp,readFile,rm,symlink,writeFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createEncryptedKeyRecovery,unlockEncryptedKeyRecovery} from '../src/forward-key-recovery.mjs';
import {encryptSnapshot} from '../src/backup.mjs';
import {
  parseForwardCiphertextSnapshot,verifyForwardCiphertextSnapshot,
  restoreForwardCiphertextSnapshot,readLocalCiphertextSnapshot,
} from '../src/forward-ciphertext-restore.mjs';
const passphrase='synthetic-test-passphrase-not-real-and-at-least-24-chars';
const enc=new TextEncoder();
const keyId='owner-v1';
const scope='personal';
const pagePath='acceptance/fictional-draft';
const title='Synthetic recovery content';
const texts=['Completely synthetic version one','Completely synthetic version two'];
const date=['2026-11-07T19:00:00.000Z','2026-11-07T19:01:00.000Z'];
const base64=x=>Buffer.from(x).toString('base64url');
async function fixture({paths=[pagePath],fixedKey=false}={}){
  const kit=fixedKey?{format:'knowledge-forward-key-recovery-v1',scope,keyId,
    sealed:encryptSnapshot({format:'knowledge-forward-root-key-v1',scope,keyId,
      rootKeyHex:'0123456789abcdef'.repeat(4)},passphrase)}:
    createEncryptedKeyRecovery({scope,keyId,passphrase});
  const {rootKeyHex}=unlockEncryptedKeyRecovery(kit,passphrase);
  const raw=Buffer.from(rootKeyHex,'hex');
  const hk=await webcrypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);raw.fill(0);
  const context={name:'HKDF',hash:'SHA-256',salt:enc.encode('Knowledge forward-only v1')};
  const aes=await webcrypto.subtle.deriveKey({...context,info:enc.encode('content-encryption')},hk,{name:'AES-GCM',length:256},false,['encrypt']);
  const mac=await webcrypto.subtle.deriveKey({...context,info:enc.encode('path-indexing')},hk,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
  const hmac=async x=>base64(await webcrypto.subtle.sign('HMAC',mac,enc.encode(x)));
  const instance=await hmac('knowledge-instance-v1\0'+scope+'\0'+keyId);
  const revisions=[],pages=[];
  for(const path of paths){
  const pathKey=await hmac('path-v1\0'+scope+'\0'+path);
  for(let i=0;i<2;i++){
    const page={path,title,body:texts[i],status:'draft',sourceUrl:null,version:i+1,updatedAt:date[i]};
    const nonce=webcrypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await webcrypto.subtle.encrypt({name:'AES-GCM',iv:nonce,
      additionalData:enc.encode('knowledge-record-v1\0'+scope+'\0'+pathKey+'\0'+(i+1))},aes,enc.encode(JSON.stringify(page)));
    revisions.push({path_key:pathKey,version:i+1,
      sealed:JSON.stringify({format:'knowledge-sealed-v1',keyId,nonce:base64(nonce),data:base64(ciphertext)}),created_at:date[i]});
  }
  pages.push({path_key:pathKey,version:2,sealed:revisions.at(-1).sealed,updated_at:date[1]});
  }
  const snapshot={format:'knowledge-forward-ciphertext-backup-v1',scope,keyId,schemaVersion:1,
    status:'synthetic-only',tables:{
      knowledge_instance:[{id:1,key_check:instance}],
      knowledge_pages:pages,
      knowledge_revisions:revisions,
    }};
  const bytes=Buffer.from(JSON.stringify(snapshot),'utf8');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  return {snapshot,bytes,kit,sha256};
}

test('offline ciphertext snapshot decrypts every synthetic revision without exposing source text',async()=>{
  const f=await fixture();
  const text=f.bytes.toString('utf8');
  assert.ok(!text.includes(texts[0]));
  assert.ok(!text.includes(texts[1]));
  const structure=parseForwardCiphertextSnapshot(f.bytes,{expectedSha256:f.sha256});
  assert.equal(structure.bytes,f.bytes.length);
  const verified=await verifyForwardCiphertextSnapshot(f.bytes,{kit:f.kit,passphrase,expectedSha256:f.sha256});
  assert.equal(verified.verified,true);
  assert.deepEqual(verified.counts,{pages:1,revisions:2,instances:1});
  assert.equal(verified.keyId,'owner-v1');
  assert.deepEqual(Object.keys(verified).sort(),['bytes','counts','fingerprint','keyId','scope','sha256','verified'].sort());
  assert.ok(!JSON.stringify(verified).includes(texts[0]));
  assert.ok(!JSON.stringify(verified).includes(texts[1]));
  assert.ok(!JSON.stringify(verified).includes(unlockEncryptedKeyRecovery(f.kit,passphrase).rootKeyHex));
});

test('multi-page restore compares opaque HMAC indexes with SQLite BINARY order, independent of locale',async()=>{
 const paths=Array.from({length:16},(_,i)=>'fictional/restore-'+i);
 const f=await fixture({paths,fixedKey:true});
 const keys=f.snapshot.tables.knowledge_pages.map(x=>x.path_key);
 assert.notDeepEqual([...keys].sort(),[...keys].sort((a,b)=>a.localeCompare(b)),
   'fixture must expose locale/BINARY ordering difference');
 const dir=await mkdtemp(join(tmpdir(),'knowledge-many-restore-'));
 try{
   const out=await restoreForwardCiphertextSnapshot(f.bytes,{kit:f.kit,passphrase,
     expectedSha256:f.sha256,targetDir:join(dir,'new')});
   assert.equal(out.restored,true);
   assert.deepEqual(out.counts,{pages:16,revisions:32,instances:1});
   const db=new DatabaseSync(out.sqliteFile);
   try{
     assert.deepEqual(db.prepare('SELECT path_key FROM knowledge_pages ORDER BY path_key').all().map(x=>x.path_key),[...keys].sort());
     assert.equal(db.prepare('SELECT count(*) AS n FROM knowledge_revisions').get().n,32);
     assert.throws(()=>db.exec('DELETE FROM knowledge_revisions'),/immutable/);
   }finally{db.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('offline ciphertext restore creates a new private SQLite database and preserves immutable history',async()=>{
  const f=await fixture();
  const parent=await mkdtemp(join(tmpdir(),'knowledge-forward-offline-'));
  try{
    const destination=join(parent,'new-restore');
    const result=await restoreForwardCiphertextSnapshot(f.bytes,{kit:f.kit,passphrase,expectedSha256:f.sha256,targetDir:destination});
    assert.equal(result.restored,true);
    assert.equal((await lstat(result.sqliteFile)).isFile(),true);
    const sqlite=new DatabaseSync(result.sqliteFile);
    try{
      const rows=sqlite.prepare('SELECT path_key,version,sealed,updated_at FROM knowledge_pages').all();
      assert.equal(JSON.stringify(rows),JSON.stringify(f.snapshot.tables.knowledge_pages));
      const revisions=sqlite.prepare('SELECT path_key,version,sealed,created_at FROM knowledge_revisions ORDER BY version').all();
      assert.equal(JSON.stringify(revisions),JSON.stringify(f.snapshot.tables.knowledge_revisions));
      assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.throws(()=>sqlite.prepare('UPDATE knowledge_revisions SET sealed=?').run('broken'),/immutable/);
    }finally{sqlite.close();}
    await assert.rejects(restoreForwardCiphertextSnapshot(f.bytes,{kit:f.kit,passphrase,expectedSha256:f.sha256,targetDir:destination}),{code:'EEXIST'});
    assert.deepEqual(await readFile(result.sqliteFile),await readFile(join(destination,'knowledge-restore.sqlite')));
    if(process.platform!=='win32'){
      assert.equal((await lstat(destination)).mode&0o777,0o700);
      assert.equal((await lstat(result.sqliteFile)).mode&0o777,0o600);
    }
  }finally{await rm(parent,{recursive:true,force:true});}
});

test('ciphertext snapshot rejects bad checksums, incomplete or duplicate revisions, changed identifiers and malformed rows',async()=>{
  const f=await fixture();
  const mutations=[
    x=>{x.extra=true;},
    x=>{x.format='other';},
    x=>{x.tables.knowledge_pages[0].version=3;},
    x=>{x.tables.knowledge_revisions.pop();},
    x=>{x.tables.knowledge_revisions.push(x.tables.knowledge_revisions[0]);},
    x=>{x.tables.knowledge_revisions[0].path_key='x';},
    x=>{x.tables.knowledge_revisions[0].sealed='plain';},
    x=>{x.tables.knowledge_revisions[1].sealed='other';},
    x=>{x.tables.knowledge_pages[0].updated_at='2026-not-a-date';},
    x=>{x.tables.knowledge_instance=[];},
    x=>{x.tables.knowledge_instance[0].id=2;},
    x=>{x.tables.knowledge_revisions[1].created_at='2026-11-07T10:00:00.000Z';},
  ];
  for(const mutate of mutations){
    const x=structuredClone(f.snapshot);mutate(x);
    assert.throws(()=>parseForwardCiphertextSnapshot(JSON.stringify(x)));
  }
  assert.throws(()=>parseForwardCiphertextSnapshot(f.bytes,{expectedSha256:'a'.repeat(64)}));
  assert.throws(()=>parseForwardCiphertextSnapshot(' '.repeat(32*1024*1024+1)));
  assert.throws(()=>parseForwardCiphertextSnapshot(Buffer.from([0xff,0xfe,0xff])));
});

test('offline verification fails closed on wrong key, wrong recovery passphrase and tampered ciphertext',async()=>{
  const f=await fixture();
  const wrongKit=createEncryptedKeyRecovery({scope,keyId,passphrase});
  await assert.rejects(verifyForwardCiphertextSnapshot(f.bytes,{kit:wrongKit,passphrase,expectedSha256:f.sha256}));
  await assert.rejects(verifyForwardCiphertextSnapshot(f.bytes,{kit:f.kit,passphrase:'wrong-long-secret-and-never-a-real-secret'}));
  const changed=structuredClone(f.snapshot);
  changed.tables.knowledge_pages[0].sealed=changed.tables.knowledge_revisions[1].sealed;
  const sealed=JSON.parse(changed.tables.knowledge_pages[0].sealed);
  sealed.data=sealed.data.slice(0,-3)+'abc';
  changed.tables.knowledge_pages[0].sealed=JSON.stringify(sealed);
  changed.tables.knowledge_revisions[1].sealed=JSON.stringify(sealed);
  await assert.rejects(verifyForwardCiphertextSnapshot(JSON.stringify(changed),{kit:f.kit,passphrase}));
  const marker=structuredClone(f.snapshot);marker.tables.knowledge_instance[0].key_check='0'.repeat(43);
  await assert.rejects(verifyForwardCiphertextSnapshot(JSON.stringify(marker),{kit:f.kit,passphrase}));
  const wrongIndex=structuredClone(f.snapshot);
  const other='a'.repeat(43);
  wrongIndex.tables.knowledge_pages[0].path_key=other;
  wrongIndex.tables.knowledge_revisions.forEach(r=>r.path_key=other);
  await assert.rejects(verifyForwardCiphertextSnapshot(JSON.stringify(wrongIndex),{kit:f.kit,passphrase}));
});

test('owner-local snapshot input rejects symlinks and the CLI refuses noninteractive recovery',async()=>{
  const f=await fixture();
  const parent=await mkdtemp(join(tmpdir(),'knowledge-forward-source-'));
  try{
    const path=join(parent,'cipher.json'),link=join(parent,'link.json');
    await writeFile(path,f.bytes);
    assert.deepEqual(await readLocalCiphertextSnapshot(path),f.bytes);
    await symlink(path,link);
    await assert.rejects(readLocalCiphertextSnapshot(link));
    const cli=fileURLToPath(new URL('../ops/private-forward/ciphertext-restore-cli.mjs',import.meta.url));
    const p=spawnSync(process.execPath,[cli,'verify',path,path,'--sha256',f.sha256],{encoding:'utf8',input:'not-a-secret\n',timeout:10000});
    assert.notEqual(p.status,0);
    assert.match(p.stderr,/non-interactive terminals|interactive owner-controlled terminal/);
    assert.doesNotMatch(p.stdout,new RegExp(texts[0]));
  }finally{await rm(parent,{recursive:true,force:true});}
});
