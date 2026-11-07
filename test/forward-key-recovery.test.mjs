import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,lstat,symlink,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  RECOVERY_FORMAT,createEncryptedKeyRecovery,unlockEncryptedKeyRecovery,
  saveEncryptedKeyRecovery,loadEncryptedKeyRecovery,
} from '../src/forward-key-recovery.mjs';

const passphrase='LOCAL-ONLY-backup-passphrase-very-long-and-unique-00001';
const create = (overrides={})=>createEncryptedKeyRecovery({
  scope:'personal',keyId:'owner-v1',passphrase,...overrides,
});
const unlock = (kit,secret=passphrase)=>unlockEncryptedKeyRecovery(kit,secret);

test('forward recovery kit stores a random 256-bit key only inside authenticated encryption',()=>{
  const a=create(),b=create();
  const x=unlock(a),y=unlock(b);
  assert.equal(a.format,RECOVERY_FORMAT);
  assert.equal(x.rootKeyHex.length,64);
  assert.match(x.rootKeyHex,/^[0-9a-f]{64}$/);
  assert.notEqual(x.rootKeyHex,y.rootKeyHex);
  assert.notEqual(x.fingerprint,y.fingerprint);
  assert.equal(x.scope,'personal');
  assert.equal(x.keyId,'owner-v1');
  assert.match(x.fingerprint,/^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(a).includes(x.rootKeyHex));
  assert.ok(!JSON.stringify(a).includes(x.fingerprint));
  assert.deepEqual(unlock(JSON.parse(JSON.stringify(a))),x);
});

test('forward recovery rejects wrong passphrases and ciphertext or metadata tampering',()=>{
  const a=create();
  assert.throws(()=>unlock(a,'different-long-passphrase-at-least-24-chars'),/recovery failed/);
  assert.throws(()=>unlock({...a,scope:'cristy'}),/recovery failed/);
  assert.throws(()=>unlock({...a,keyId:'owner-v2'}),/recovery failed/);
  assert.throws(()=>unlock({...a,unknown:true}),/recovery failed/);
  const sealed=structuredClone(a.sealed);
  sealed.cipher.tag=sealed.cipher.tag.slice(0,-2)+'xx';
  assert.throws(()=>unlock({...a,sealed}),/recovery failed/);
  assert.throws(()=>unlock({format:RECOVERY_FORMAT,scope:'personal',keyId:'v1',sealed:'x'}),/recovery failed/);
});

test('forward recovery rejects unsafe scope, key ID or weak passphrase before writing',()=>{
  for(const scope of ['Cristy','../other','family private','']) {
    assert.throws(()=>create({scope}),/Invalid Knowledge owner scope/);
  }
  for(const keyId of ['V1','v/1','', 'a'.repeat(33)]) {
    assert.throws(()=>create({keyId}),/Invalid Knowledge owner scope/);
  }
  assert.throws(()=>create({passphrase:'short'}),/independently stored backup passphrase/);
});

test('forward recovery file is exclusive, limited, not a symlink, and readable after copy',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'knowledge-key-test-'));
  try{
    const target=join(dir,'encrypted-key.json');
    const kit=create();
    await saveEncryptedKeyRecovery(target,kit);
    assert.equal((await lstat(target)).isFile(),true);
    if(process.platform!=='win32')assert.equal((await lstat(target)).mode & 0o777,0o600);
    const bytes=await readFile(target,'utf8');
    const key=unlock(kit);
    assert.ok(!bytes.includes(key.rootKeyHex));
    assert.ok(!bytes.includes(key.fingerprint));
    const saved=await loadEncryptedKeyRecovery(target);
    assert.deepEqual(unlock(saved),key);
    await assert.rejects(saveEncryptedKeyRecovery(target,create()),{code:'EEXIST'});
    assert.equal(await readFile(target,'utf8'),bytes);
    const linked=join(dir,'linked.json');
    await symlink(target,linked);
    await assert.rejects(loadEncryptedKeyRecovery(linked),/recovery failed/);
    const broken=join(dir,'broken.json');
    await writeFile(broken,'{bad json');
    await assert.rejects(loadEncryptedKeyRecovery(broken),/recovery failed/);
    const oversize=join(dir,'oversize.json');
    await writeFile(oversize,' '.repeat(8193));
    await assert.rejects(loadEncryptedKeyRecovery(oversize),/recovery failed/);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('forward owner CLI rejects noninteractive creation and never writes a plaintext key',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'knowledge-key-cli-'));
  try {
    const target=join(dir,'never-created.json');
    const cli=fileURLToPath(new URL('../ops/private-forward/key-custody-cli.mjs',import.meta.url));
    const child=spawnSync(process.execPath,[cli,'create',target],{
      encoding:'utf8',input:'do-not-write-this-passphrase\n',timeout:10000,
    });
    assert.notEqual(child.status,0);
    assert.match(child.stderr,/interactive owner-controlled terminal/);
    assert.doesNotMatch(child.stdout,/^[0-9a-f]{64}$/m);
    await assert.rejects(lstat(target),{code:'ENOENT'});
    const reveal=spawnSync(process.execPath,[cli,'reveal',target,'--show-key'],{
      encoding:'utf8',timeout:10000,
    });
    assert.notEqual(reveal.status,0);
    assert.doesNotMatch(reveal.stdout,/^[0-9a-f]{64}$/m);
  }finally{await rm(dir,{recursive:true,force:true})}
});
