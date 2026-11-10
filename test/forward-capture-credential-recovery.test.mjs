import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,lstat,symlink,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {
 CAPTURE_CREDENTIAL_RECOVERY_FORMAT,
 createCaptureCredentialRecovery,unlockCaptureCredentialRecovery,
 saveCaptureCredentialRecovery,loadCaptureCredentialRecovery,
} from '../src/forward-capture-credential-recovery.mjs';

const passphrase='FICTIONAL_OWNER_OFFLINE_RECOVERY_ONLY_minimum_24_characters_2026';
const create=(override={})=>createCaptureCredentialRecovery({
 keyId:'inbox-v1',passphrase,...override,
});
const unlock=(kit,password=passphrase)=>unlockCaptureCredentialRecovery(kit,password);

test('capture recovery seals two distinct 256-bit keys with independent random entropy',()=>{
 const a=create(),b=create();
 const x=unlock(a),y=unlock(b);
 assert.equal(a.format,CAPTURE_CREDENTIAL_RECOVERY_FORMAT);
 assert.deepEqual(Object.keys(a).sort(),['format','keyId','sealed']);
 assert.match(x.captureInboxRootHex,/^[0-9a-f]{64}$/);
 assert.match(x.captureMachineAuthHex,/^[0-9a-f]{64}$/);
 assert.notEqual(x.captureInboxRootHex,x.captureMachineAuthHex);
 assert.notEqual(x.captureInboxRootHex,y.captureInboxRootHex);
 assert.notEqual(x.captureMachineAuthHex,y.captureMachineAuthHex);
 assert.match(x.inboxFingerprint,/^[0-9a-f]{16}$/);
 assert.match(x.machineFingerprint,/^[0-9a-f]{16}$/);
 assert.notEqual(x.inboxFingerprint,x.machineFingerprint);
 assert.doesNotMatch(JSON.stringify(a),new RegExp(x.captureInboxRootHex));
 assert.doesNotMatch(JSON.stringify(a),new RegExp(x.captureMachineAuthHex));
 assert.doesNotMatch(JSON.stringify(a),new RegExp(x.inboxFingerprint));
 assert.deepEqual(unlock(JSON.parse(JSON.stringify(a))),x);
});
test('wrong passphrase, metadata tampering, ciphertext edits and unsafe key IDs fail closed',()=>{
 const kit=create();
 for(const mutation of [
  {...kit,keyId:'another-v1'},
  {...kit,format:'unknown'},
  {...kit,untrusted:'data'},
  {...kit,sealed:'garbage'},
  {...kit,sealed:{...kit.sealed,cipher:{...kit.sealed.cipher,tag:'AAAA'}}},
 ]){
  assert.throws(()=>unlock(mutation),/KNOWLEDGE_CAPTURE_KEY_RECOVERY_UNAVAILABLE/);
 }
 assert.throws(()=>unlock(kit,'wrong-but-sufficiently-long-passphrase-2026'),
  /KNOWLEDGE_CAPTURE_KEY_RECOVERY_UNAVAILABLE/);
 for(const keyId of ['','../owner','INBOX','different/path','x'.repeat(33)]){
  assert.throws(()=>create({keyId}),/KNOWLEDGE_CAPTURE_KEY_RECOVERY_UNAVAILABLE/);
 }
 assert.throws(()=>create({passphrase:'short'}),/independently stored backup passphrase/);
});
test('kit is written exclusively at 0600, survives exact readback, and refuses unsafe storage',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'knowledge-capture-key-test-'));
 try{
  const path=join(directory,'capture-recovery.json');
  const kit=create();
  await saveCaptureCredentialRecovery(path,kit);
  const stat=await lstat(path);
  assert.equal(stat.isFile(),true);
  if(process.platform!=='win32')assert.equal(stat.mode&0o777,0o600);
  const stored=await readFile(path,'utf8');
  const clear=unlock(kit);
  assert.ok(!stored.includes(clear.captureInboxRootHex));
  assert.ok(!stored.includes(clear.captureMachineAuthHex));
  assert.deepEqual(unlock(await loadCaptureCredentialRecovery(path)),clear);
  await assert.rejects(saveCaptureCredentialRecovery(path,create()),{code:'EEXIST'});
  assert.equal(await readFile(path,'utf8'),stored);
  const link=join(directory,'linked.json');
  await symlink(path,link);
  await assert.rejects(loadCaptureCredentialRecovery(link),
   /KNOWLEDGE_CAPTURE_KEY_RECOVERY_UNAVAILABLE/);
  await assert.rejects(saveCaptureCredentialRecovery(link,create()),{code:'EEXIST'});
  const invalid=join(directory,'malformed.json');
  await writeFile(invalid,'{malformed');
  await assert.rejects(loadCaptureCredentialRecovery(invalid),
   /KNOWLEDGE_CAPTURE_KEY_RECOVERY_UNAVAILABLE/);
  const huge=join(directory,'oversized.json');
  await writeFile(huge,' '.repeat(8193));
  await assert.rejects(loadCaptureCredentialRecovery(huge),
   /KNOWLEDGE_CAPTURE_KEY_RECOVERY_UNAVAILABLE/);
 }finally{await rm(directory,{force:true,recursive:true})}
});
test('owner CLI refuses non-interactive creation, verification and reveal without writing keys',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'capture-key-cli-test-'));
 try{
  const output=join(dir,'no-key.json');
  const command=new URL('../ops/private-forward/capture-key-custody-cli.mjs',import.meta.url).pathname;
  for(const args of [
    ['create',output],['verify',output],['reveal',output,'--show-keys'],
    ['reveal',output],['create',output,'inbox-v1','extra'],
  ]){
   const child=spawnSync(process.execPath,[command,...args],{
    input:'a-passphrase-we-would-never-use-2026\n',
    encoding:'utf8',timeout:10000,env:{...process.env,CI:'true'},
   });
   assert.notEqual(child.status,0,JSON.stringify(args));
   assert.doesNotMatch(child.stdout,/^[0-9a-f]{64}$/m);
   assert.doesNotMatch(child.stdout,/captureInboxRootHex|captureMachineAuthHex/);
  }
  await assert.rejects(lstat(output),{code:'ENOENT'});
 }finally{await rm(dir,{recursive:true,force:true})}
});
