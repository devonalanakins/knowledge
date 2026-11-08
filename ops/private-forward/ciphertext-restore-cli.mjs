#!/usr/bin/env node
/** Trusted local-only; never prints recovered secret or decrypted Knowledge content. */
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {loadEncryptedKeyRecovery} from '../../src/forward-key-recovery.mjs';
import {
  readLocalCiphertextSnapshot,verifyForwardCiphertextSnapshot,
  restoreForwardCiphertextSnapshot,
} from '../../src/forward-ciphertext-restore.mjs';

const USAGE=`Owner-only, OFFLINE encrypted Knowledge data recovery (no network calls)

  npm run knowledge:forward:restore -- verify SNAPSHOT_JSON RECOVERY_JSON --sha256 EXPECTED_SHA256
  npm run knowledge:forward:restore -- restore SNAPSHOT_JSON RECOVERY_JSON NEW_DIRECTORY --sha256 EXPECTED_SHA256

The snapshot contains ciphertext, not readable wiki pages. Use only a trusted
owner-controlled computer and an encrypted disk/USB. Never share the key,
recovery passphrase, downloaded snapshots, or terminal recordings in chat.
No Cloudflare database or secret is changed by this command.`;
async function askHidden(label){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('An interactive owner-controlled terminal is required');
  process.stdout.write(label);
  const hidden=new Writable({write(_chunk,_enc,done){done();}});
  const prompt=createInterface({input:process.stdin,output:hidden,terminal:true});
  try{
    return await new Promise((resolve,reject)=>{
      prompt.question('',resolve);
      prompt.once('close',()=>reject(new Error('Recovery passphrase input was interrupted')));
    });
  }finally{prompt.close();process.stdout.write('\n');}
}
async function main(args){
  const [command,snapshotPath,recoveryPath,...rest]=args;
  const verifying=command==='verify'&&rest.length===2&&rest[0]==='--sha256';
  const restoring=command==='restore'&&rest.length===3&&rest[1]==='--sha256';
  if(!snapshotPath||!recoveryPath||(!verifying&&!restoring))throw new Error(USAGE);
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Do not run private Knowledge recovery in CI or recorded/non-interactive terminals');
  const targetDir=restoring?rest[0]:undefined;
  const expectedSha256=restoring?rest[2]:rest[1];
  if(!/^[0-9a-f]{64}$/.test(expectedSha256))throw new Error('Supply the exact expected SHA-256 from the verified private backup receipt');
  const bytes=await readLocalCiphertextSnapshot(snapshotPath);
  const kit=await loadEncryptedKeyRecovery(recoveryPath);
  const passphrase=await askHidden('Recovery passphrase (hidden): ');
  const options={kit,passphrase,expectedSha256};
  const result=restoring?
    await restoreForwardCiphertextSnapshot(bytes,{...options,targetDir}):
    await verifyForwardCiphertextSnapshot(bytes,options);
  process.stdout.write('Verified encrypted Knowledge snapshot and EVERY historical revision.\n');
  process.stdout.write('Scope: '+result.scope+'; key ID: '+result.keyId+'; key fingerprint: '+result.fingerprint+'\n');
  process.stdout.write('SHA-256: '+result.sha256+'; pages: '+result.counts.pages+'; revisions: '+result.counts.revisions+'\n');
  if(restoring)process.stdout.write('RESTORE VERIFIED: encrypted SQLite file created at '+result.sqliteFile+'\n');
  else process.stdout.write('VERIFY PASSED. No files or remote resources were modified.\n');
  process.stdout.write('No decrypted page body or root secret was printed.\n');
}
main(process.argv.slice(2)).catch(e=>{
  const message=String(e?.message||'Unknown error');
  const safeMessage=message===USAGE?USAGE:/non-interactive|interactive owner-controlled terminal|recorded\//.test(message)?'An interactive owner-controlled terminal is required':'Validation, passphrase, source file, or output-directory check failed';
  process.stderr.write('Offline Knowledge recovery refused: '+safeMessage+'\n');
  process.exitCode=1;
});
