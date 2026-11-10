/**
 * Owner-local, password-encrypted recovery for the two independent keys
 * required by GitHub-to-Knowledge capture. NO live provider calls.
 *
 * Never generate or reveal these production credentials in ChatGPT,
 * browser automation, shared CI, logs, or public source control.
 */
import {createHash,randomBytes} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {lstat,open,readFile} from 'node:fs/promises';
import {encryptSnapshot,decryptSnapshot} from './backup.mjs';

export const CAPTURE_CREDENTIAL_RECOVERY_FORMAT='knowledge-capture-key-recovery-v1';
const PRIVATE_FORMAT='knowledge-capture-keys-v1';
const HEX=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9-]{1,32}$/;
const LIMIT=8192;
const own=(x,k)=>Object.hasOwn(x,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>own(x,k));
const failure=()=>Error('KNOWLEDGE_CAPTURE_KEY_RECOVERY_UNAVAILABLE');
function validId(keyId){
 if(typeof keyId!=='string'||!ID.test(keyId))throw failure();
}
function fingerprint(value){
 return createHash('sha256').update(Buffer.from(value,'hex')).digest('hex').slice(0,16);
}
function validate(kit){
 if(!exact(kit,['format','keyId','sealed'])||
    kit.format!==CAPTURE_CREDENTIAL_RECOVERY_FORMAT||
    typeof kit.keyId!=='string'||!ID.test(kit.keyId)||
    Buffer.byteLength(JSON.stringify(kit),'utf8')>LIMIT)throw failure();
}
/**
 * Create random, independent 256-bit capture inbox and machine HMAC keys,
 * sealed under the existing password-backed AES-256-GCM/scrypt envelope.
 * The return value NEVER contains the plaintext keys.
 */
export function createCaptureCredentialRecovery({keyId='inbox-v1',passphrase}={}){
 validId(keyId);
 const inbox=randomBytes(32),machine=randomBytes(32);
 try{
  return {format:CAPTURE_CREDENTIAL_RECOVERY_FORMAT,keyId,
   sealed:encryptSnapshot({
    format:PRIVATE_FORMAT,keyId,
    captureInboxRootHex:inbox.toString('hex'),
    captureMachineAuthHex:machine.toString('hex'),
   },passphrase)};
 }finally{inbox.fill(0);machine.fill(0);}
}
/**
 * Only call in an owner-controlled local process for verification/installation.
 * Return plaintext keys in memory, never in the encrypted file or routine CLI
 * output. Both keys are required by different Worker bindings.
 */
export function unlockCaptureCredentialRecovery(kit,passphrase){
 validate(kit);
 let inner;
 try{inner=decryptSnapshot(kit.sealed,passphrase);}catch{throw failure();}
 if(!exact(inner,['format','keyId','captureInboxRootHex','captureMachineAuthHex'])||
    inner.format!==PRIVATE_FORMAT||inner.keyId!==kit.keyId||
    !HEX.test(inner.captureInboxRootHex)||
    !HEX.test(inner.captureMachineAuthHex)||
    inner.captureInboxRootHex===inner.captureMachineAuthHex)throw failure();
 return {keyId:inner.keyId,
  captureInboxRootHex:inner.captureInboxRootHex,
  captureMachineAuthHex:inner.captureMachineAuthHex,
  inboxFingerprint:fingerprint(inner.captureInboxRootHex),
  machineFingerprint:fingerprint(inner.captureMachineAuthHex)};
}
export async function saveCaptureCredentialRecovery(path,kit){
 if(typeof path!=='string'||!path.trim()||path.includes('\0'))throw failure();
 validate(kit);
 const payload=JSON.stringify(kit,null,2)+'\n';
 if(Buffer.byteLength(payload,'utf8')>LIMIT)throw failure();
 const flags=fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL|
   (fsConstants.O_NOFOLLOW||0);
 let file;
 try{
  file=await open(path,flags,0o600);
  await file.writeFile(payload,{encoding:'utf8'});
  await file.sync();
 }finally{await file?.close();}
}
export async function loadCaptureCredentialRecovery(path){
 if(typeof path!=='string'||!path.trim()||path.includes('\0'))throw failure();
 let file;
 try{
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>LIMIT)throw failure();
  const content=await readFile(path,'utf8');
  file=JSON.parse(content);
 }catch{throw failure();}
 validate(file);
 return file;
}
