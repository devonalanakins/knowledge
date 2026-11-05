import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encryptSnapshot } from '../src/backup.mjs';
import { readSyntheticOriginalCapsule } from '../src/original-capsules.mjs';
import { hashArchiveCredential, SyntheticArchiveAccessGate, createProtectedLocalAudit } from '../src/archive-access.mjs';

const notionId='c'.repeat(32);
const originalText='# SYNTHETIC FIXTURE\nOne protected original, recoverable without storing it in wiki search.';
const sourceSha=createHash('sha256').update(originalText).digest('hex');
const key='synthetic independent archival key for test only 2394578';

test('G8 authenticated local gate decrypts a genuine G7 capsule and durably records only metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'knowledge-access-integration-'));
  const sourceRoot=join(root,'sources');await mkdir(sourceRoot,{mode:0o700});
  const file=join(sourceRoot,notionId+'.source.enc');
  const envelope=encryptSnapshot({format:'knowledge-notion-original-capsule-v1',scope:'devonstation',originalNotionId:notionId,
    sourcePath:'Example '+notionId+'.md',sha256:sourceSha,bytes:Buffer.byteLength(originalText,'utf8'),text:originalText},key);
  await writeFile(file,JSON.stringify(envelope)+'\n',{mode:0o600,flag:'wx'});
  const token=randomBytes(48).toString('hex');
  const sink=await createProtectedLocalAudit(join(root,'audit.jsonl'));
  const gate=new SyntheticArchiveAccessGate({
    sources:[{originalNotionId:notionId,scope:'devonstation',sha256:sourceSha,file}],
    principals:[{id:'devon-owner',tokenHash:hashArchiveCredential(token),scopes:['devonstation'],expiresAt:Date.now()+300000}],
    passphrase:key,auditKey:randomBytes(32),reader:readSyntheticOriginalCapsule,audit:sink.write,
  });
  try{
    const got=await gate.read({bearerToken:token,originalNotionId:notionId,scope:'devonstation'});
    assert.equal(got.text,originalText);
    await assert.rejects(()=>gate.read({bearerToken:token,originalNotionId:notionId,scope:'family'}),{code:'ACCESS_DENIED'});
    gate.revokePrincipal('devon-owner');
    await assert.rejects(()=>gate.read({bearerToken:token,originalNotionId:notionId,scope:'devonstation'}),{code:'ACCESS_DENIED'});
  }finally{await sink.close();}
  assert.equal((await readFile(file,'utf8')).includes(originalText),false);
  const log=await readFile(join(root,'audit.jsonl'),'utf8');
  assert.deepEqual(log.trim().split('\n').map(x=>JSON.parse(x).outcome),['authorized','delivered','denied','denied']);
  assert.equal(log.includes(originalText),false);
  assert.equal(log.includes(notionId),false);
  assert.equal(log.includes(token),false);
  assert.equal(log.includes(key),false);
});
