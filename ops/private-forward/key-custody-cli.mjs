#!/usr/bin/env node
/**
 * Run on a trusted owner's interactive computer only. Never on a CI runner.
 * The only mode displaying a plaintext secret requires explicit --show-key.
 */
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {
  createEncryptedKeyRecovery,unlockEncryptedKeyRecovery,
  saveEncryptedKeyRecovery,loadEncryptedKeyRecovery,
} from '../../src/forward-key-recovery.mjs';

const USAGE = [
  'Knowledge encrypted root-key recovery (owner device only)',
  '',
  '  node ops/private-forward/key-custody-cli.mjs create FILE [SCOPE] [KEY_ID]',
  '  node ops/private-forward/key-custody-cli.mjs verify FILE',
  '  node ops/private-forward/key-custody-cli.mjs reveal FILE --show-key',
  '',
  'Create never prints a plaintext key. Verify checks the encrypted copy.',
  'Reveal explicitly displays the decrypted key only on the local terminal.',
  'Never run this utility in ChatGPT, shared CI, or a recorded terminal session.',
].join('\n');

async function askHidden(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('An interactive owner-controlled terminal is required');
  }
  process.stdout.write(label);
  const hidden = new Writable({write(_chunk,_encoding,callback){callback();}});
  const prompt = createInterface({input:process.stdin,output:hidden,terminal:true});
  try {
    return await new Promise((resolve,reject)=>{
      prompt.question('',resolve);
      prompt.once('close',()=>reject(new Error('Passphrase input was interrupted')));
    });
  } finally {
    prompt.close();
    process.stdout.write('\n');
  }
}
async function main(args) {
  const [command,filePath,scope='personal',keyId='owner-v1',extra]=args;
  if (!filePath || !['create','verify','reveal'].includes(command)) {
    process.stdout.write(USAGE+'\n');
    process.exitCode=1;
    return;
  }
  if (command==='create') {
    if (extra!==undefined) throw new Error('Unexpected create argument');
    const passphrase=await askHidden('Enter a new long, unique recovery passphrase (hidden): ');
    const confirm=await askHidden('Repeat the recovery passphrase (hidden): ');
    if(passphrase!==confirm)throw new Error('Passphrases do not match');
    const kit=createEncryptedKeyRecovery({scope,keyId,passphrase});
    await saveEncryptedKeyRecovery(filePath,kit);
    const loaded=await loadEncryptedKeyRecovery(filePath);
    const unlocked=unlockEncryptedKeyRecovery(loaded,passphrase);
    process.stdout.write('Encrypted recovery file created and immediately verified.\n');
    process.stdout.write('Scope: '+unlocked.scope+'; key ID: '+unlocked.keyId+
      '; SHA-256 fingerprint prefix: '+unlocked.fingerprint+'\n');
    process.stdout.write('Move the encrypted file and passphrase to SEPARATE owner-controlled secure locations.\n');
    process.stdout.write('This command did NOT install the key in Cloudflare or enable writes.\n');
    return;
  }
  if (scope!=='personal'||keyId!=='owner-v1'||extra!==undefined) {
    if(command!=='reveal'||scope!=='--show-key'||keyId!=='owner-v1'||extra!==undefined)
      throw new Error('Unexpected arguments; use the documented syntax');
  }
  if (command==='reveal' && scope!=='--show-key') {
    throw new Error('Explicit --show-key is required to display plaintext secret');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Do not run key recovery in a non-interactive or logged environment');
  }
  const kit=await loadEncryptedKeyRecovery(filePath);
  const passphrase=await askHidden('Recovery passphrase (hidden): ');
  const result=unlockEncryptedKeyRecovery(kit,passphrase);
  process.stdout.write('Recovery successful. Scope: '+result.scope+'; key ID: '+
    result.keyId+'; fingerprint: '+result.fingerprint+'\n');
  if(command==='reveal') {
    process.stdout.write('SENSITIVE: the following key must NOT be copied to ChatGPT, GitHub, or messages.\n');
    process.stdout.write('Cloudflare Worker secret KNOWLEDGE_DATA_KEY (paste directly into the trusted dashboard):\n');
    process.stdout.write(result.rootKeyHex+'\n');
    process.stdout.write('Set KNOWLEDGE_KEY_ID to '+result.keyId+' on the SAME Worker.\n');
  }
}
main(process.argv.slice(2)).catch(error=>{
  process.stderr.write('Recovery utility refused: '+String(error?.message||'unknown error')+'\n');
  process.exitCode=1;
});
