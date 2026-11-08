import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptColdArchive, decryptColdArchive } from '../src/cold-archive.mjs';
const key='synthetic independent archival key, not for real production';
async function temp(){return mkdtemp(join(tmpdir(),'knowledge-archive-test-'))}
test('streamed archive protects source bytes and restores exact binary ZIP',async()=>{
 const dir=await temp(),source=join(dir,'source.zip'),enc=join(dir,'protected.enc'),dest=join(dir,'restored.zip');
 const original=Buffer.concat([Buffer.from('PK\x03\x04','latin1'),Buffer.from('fake original file contents; synthetic only'.repeat(10000))]);
 await writeFile(source,original);
 const a=await encryptColdArchive(source,enc,key);
 assert.ok(a.sizeBytes>0);
 assert.equal((await readFile(enc)).includes(Buffer.from('fake original file')),false);
 assert.equal((await stat(enc)).mode&0o777,0o600);
 await decryptColdArchive(enc,dest,key);
 assert.deepEqual(await readFile(dest),original);
 assert.deepEqual(await readFile(source),original);
});
test('wrong key, ciphertext modification, header modification and truncation reject without a visible destination',async()=>{
 const dir=await temp(),source=join(dir,'original.zip'),enc=join(dir,'encrypted'),bad=join(dir,'modified');
 await writeFile(source,Buffer.from('PK\x03\x04hello'.repeat(1000),'latin1'));
 await encryptColdArchive(source,enc,key);
 const original=await readFile(enc);
 const mutations=[['wrong-key',original,'invalid synthetic archive passphrase 123456789'],['ciphertext',Buffer.from(original),key],['header',Buffer.from(original),key],['truncated',original.subarray(0,original.length-11),key]];
 mutations[1][1][original.length-30]^=42;
 mutations[2][1][10]^=1;
 for(const [name,content,passphrase]of mutations){
  await writeFile(bad,content);
  const output=join(dir,'decrypted-'+name+'.zip');
  await assert.rejects(()=>decryptColdArchive(bad,output,passphrase));
  await assert.rejects(()=>access(output));
 }
});
test('encryption does not overwrite existing archives or source input',async()=>{
 const dir=await temp(),source=join(dir,'original.zip'),destination=join(dir,'protected.enc');
 await writeFile(source,'source');await writeFile(destination,'existing archive');
 await assert.rejects(()=>encryptColdArchive(source,destination,key));
 assert.equal((await readFile(destination,'utf8')),'existing archive');
 await assert.rejects(()=>encryptColdArchive(source,source,key),{code:'UNSAFE_DESTINATION'});
});
test('restoration does not overwrite a destination file',async()=>{
 const dir=await temp(),source=join(dir,'original.zip'),enc=join(dir,'protected.enc'),destination=join(dir,'restored.zip');
 await writeFile(source,'synthetic');await encryptColdArchive(source,enc,key);
 await writeFile(destination,'do not replace this content');
 await assert.rejects(()=>decryptColdArchive(enc,destination,key));
 assert.equal(await readFile(destination,'utf8'),'do not replace this content');
});
