import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeStore } from '../src/knowledge.mjs';
import { ENCRYPTED_BACKUP_FORMAT, encryptSnapshot, decryptSnapshot } from '../src/backup.mjs';

const phrase='test-only random-looking long backup phrase 9876543210';
function snapshot(){const store=new KnowledgeStore();store.createSpace('personal','Test');store.capturePage('personal',{path:'synthetic/entry',title:'Entry',body:'Never expose this synthetic private text.'});const snap=store.exportSpace('personal');store.close();return snap;}
const mutateBase64=value=>value.slice(0,-5)+(value.at(-5)==='A'?'B':'A')+value.slice(-4);

test('encrypted backup round trip authenticates content without exposing plaintext',()=>{
 const original=snapshot();const first=encryptSnapshot(original,phrase),second=encryptSnapshot(original,phrase);
 assert.equal(first.format,ENCRYPTED_BACKUP_FORMAT);
 assert.notEqual(first.ciphertext,second.ciphertext);
 assert.equal(JSON.stringify(first).includes('Never expose'),false);
 assert.deepEqual(decryptSnapshot(first,phrase),original);
 assert.deepEqual(decryptSnapshot(second,phrase),original);
});
test('wrong backup secret, tampered content, tag, nonce and KDF settings fail closed',()=>{
 const envelope=encryptSnapshot(snapshot(),phrase);
 for(const bad of [
  [envelope,'incorrect backup passphrase of sufficient length'],
  [{...envelope,ciphertext:mutateBase64(envelope.ciphertext)},phrase],
  [{...envelope,cipher:{...envelope.cipher,tag:mutateBase64(envelope.cipher.tag)}},phrase],
  [{...envelope,cipher:{...envelope.cipher,nonce:mutateBase64(envelope.cipher.nonce)}},phrase],
  [{...envelope,kdf:{...envelope.kdf,N:1}},phrase],
  [{...envelope, extra:'unexpected'},phrase],
 ]) assert.throws(()=>decryptSnapshot(bad[0],bad[1]),{code:'INVALID_BACKUP'});
 assert.throws(()=>encryptSnapshot(snapshot(),'weak'),{code:'INVALID_INPUT'});
});
test('CLI exports encrypted files by default and restores safely with correct secret',()=>{
 const dir=mkdtempSync(join(tmpdir(),'knowledge-encrypted-test-'));
 const original=join(dir,'source.sqlite'),target=join(dir,'target.sqlite'),output=join(dir,'backup.json');
 const seed=new KnowledgeStore(original);seed.createSpace('personal','Test');seed.capturePage('personal',{path:'projects/synthetic',title:'Synthetic',body:'PRIVATE_TEST_CANARY'});seed.close();
 const cli=(db,args,passphrase)=>spawnSync(process.execPath,['src/cli.mjs','--db',db,...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,KNOWLEDGE_BACKUP_PASSPHRASE:passphrase}});
 let r=cli(original,['export','personal',output],phrase);assert.equal(r.status,0,r.stderr);
 assert.equal(statSync(output).mode & 0o777,0o600);
 assert.equal(readFileSync(output,'utf8').includes('PRIVATE_TEST_CANARY'),false);
 r=cli(target,['restore',output],'incorrect backup passphrase of sufficient length');assert.notEqual(r.status,0);
 r=cli(target,['restore',output],phrase);assert.equal(r.status,0,r.stderr);
 const loaded=new KnowledgeStore(target);try{assert.equal(loaded.getPage('personal','projects/synthetic').body,'PRIVATE_TEST_CANARY');}finally{loaded.close();}
});
