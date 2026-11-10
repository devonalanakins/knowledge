#!/usr/bin/env node
/**
 * Owner-only INTERACTIVE offline capture key custody.
 * No network access, Cloudflare modifications, environment key export,
 * GitHub Actions secret management or background operations.
 */
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {
  createCaptureCredentialRecovery,
  unlockCaptureCredentialRecovery,
  saveCaptureCredentialRecovery,
  loadCaptureCredentialRecovery,
} from '../../src/forward-capture-credential-recovery.mjs';

const USAGE = [
  'Knowledge capture credentials (trusted owner computer, offline only)',
  '',
  '  node ops/private-forward/capture-key-custody-cli.mjs create FILE [KEY_ID]',
  '  node ops/private-forward/capture-key-custody-cli.mjs verify FILE',
  '  node ops/private-forward/capture-key-custody-cli.mjs reveal FILE --show-keys',
  '',
  'Create seals two independent random keys in one passphrase-encrypted kit.',
  'Verify decrypts and fingerprints the keys without printing their values.',
  'Reveal explicitly displays secrets for owner-only private Cloudflare setup.',
  'Never run in ChatGPT, CI, a shared terminal, a recorded session or a log.',
].join('\n');

function requireLocalTTY(){
  if(!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI==='true')
    throw Error('TRUSTED_OWNER_INTERACTIVE_TERMINAL_REQUIRED');
}
async function askHidden(label){
  requireLocalTTY();
  process.stdout.write(label);
  const hidden=new Writable({write(_chunk,_enc,done){done();}});
  const terminal=createInterface({input:process.stdin,output:hidden,terminal:true});
  try{
    return await new Promise((resolve,reject)=>{
      terminal.question('',resolve);
      terminal.once('close',()=>reject(Error('OWNER_PASSPHRASE_INPUT_INTERRUPTED')));
    });
  }finally{
    terminal.close();
    process.stdout.write('\n');
  }
}
function fingerprintReceipt(key){
  return 'Key ID: '+key.keyId+
    '; inbox fingerprint: '+key.inboxFingerprint+
    '; machine fingerprint: '+key.machineFingerprint;
}
async function main(args){
  const [command,path,third,fourth]=args;
  if(!path||fourth!==undefined||
    !['create','verify','reveal'].includes(command)){
    process.stdout.write(USAGE+'\n');
    process.exitCode=1;
    return;
  }
  requireLocalTTY();
  if(command==='create'){
    const keyId=third===undefined?'inbox-v1':third;
    const passphrase=await askHidden('New unique recovery passphrase (hidden): ');
    const repeated=await askHidden('Repeat recovery passphrase (hidden): ');
    if(passphrase!==repeated)throw Error('CAPTURE_RECOVERY_PASSPHRASES_DO_NOT_MATCH');
    const kit=createCaptureCredentialRecovery({keyId,passphrase});
    await saveCaptureCredentialRecovery(path,kit);
    const loaded=await loadCaptureCredentialRecovery(path);
    const recovered=unlockCaptureCredentialRecovery(loaded,passphrase);
    process.stdout.write('Encrypted offline capture recovery kit created and verified.\n');
    process.stdout.write(fingerprintReceipt(recovered)+'\n');
    process.stdout.write('Store encrypted kit and passphrase in independent owner-controlled locations.\n');
    process.stdout.write('No Cloudflare Worker, GitHub configuration or public endpoint was changed.\n');
    return;
  }
  if(command==='verify'&&third!==undefined)throw Error('CAPTURE_RECOVERY_UNEXPECTED_ARGUMENT');
  if(command==='reveal'&&third!=='--show-keys')
    throw Error('EXPLICIT_SHOW_KEYS_REQUIRED');
  const kit=await loadCaptureCredentialRecovery(path);
  const passphrase=await askHidden('Recovery passphrase (hidden): ');
  const recovered=unlockCaptureCredentialRecovery(kit,passphrase);
  process.stdout.write('Capture recovery verified. '+fingerprintReceipt(recovered)+'\n');
  if(command==='reveal'){
    process.stdout.write('SENSITIVE: these are production-capable secret values. Do not copy into GitHub, ChatGPT, emails or logs.\n');
    process.stdout.write('Cloudflare ingress + processor CAPTURE_INBOX_ROOT_HEX:\n');
    process.stdout.write(recovered.captureInboxRootHex+'\n');
    process.stdout.write('Cloudflare owner KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX and processor CAPTURE_MACHINE_AUTH_KEY_HEX:\n');
    process.stdout.write(recovered.captureMachineAuthHex+'\n');
    process.stdout.write('CAPTURE_INBOX_KEY_ID must match '+recovered.keyId+' on ingress and processor.\n');
    process.stdout.write('Store and transfer secrets ONLY through an owner-approved private channel.\n');
  }
}
main(process.argv.slice(2)).catch(error=>{
  process.stderr.write('Capture key custody refused: '+String(error?.message||'unavailable')+'\n');
  process.exitCode=1;
});
