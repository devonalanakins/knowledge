/**
 * Owner-controlled encrypted recovery for a forward Knowledge Worker key.
 *
 * Generate on a trusted owner device, not in ChatGPT, GitHub Actions, or a
 * shared runner. Recovery output never contains a plaintext root key.
 */
import {createHash,randomBytes} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {lstat,open,readFile} from 'node:fs/promises';
import {encryptSnapshot,decryptSnapshot} from './backup.mjs';

export const RECOVERY_FORMAT = 'knowledge-forward-key-recovery-v1';
const INNER_FORMAT = 'knowledge-forward-root-key-v1';
const MAX_KIT_BYTES = 8192;
const SPACE = /^[a-z][a-z0-9-]{0,63}$/;
const KEY_ID = /^[a-z0-9-]{1,32}$/;
const HEX = /^[0-9a-f]{64}$/;
const own = (x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const isObject = x=>x !== null && typeof x === 'object' &&
  !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const exactly = (value,names)=>isObject(value) &&
  Object.keys(value).length === names.length && names.every(name=>own(value,name));
function validateIdentity(scope,keyId) {
  if (typeof scope !== 'string' || !SPACE.test(scope) ||
      typeof keyId !== 'string' || !KEY_ID.test(keyId)) {
    throw new Error('Invalid Knowledge owner scope or key identifier');
  }
}
function invalid() {
  return new Error('Encrypted Knowledge key recovery failed; check the file and passphrase');
}
function fingerprint(hex) {
  return createHash('sha256').update(Buffer.from(hex,'hex')).digest('hex').slice(0,16);
}

/** Never returns raw key material; only a password-encrypted envelope. */
export function createEncryptedKeyRecovery({scope='personal',keyId='owner-v1',passphrase}={}) {
  validateIdentity(scope,keyId);
  const key = randomBytes(32);
  try {
    const sealed=encryptSnapshot({
      format:INNER_FORMAT,scope,keyId,rootKeyHex:key.toString('hex'),
    },passphrase);
    return {format:RECOVERY_FORMAT,scope,keyId,sealed};
  } finally {key.fill(0);}
}

/** Returns the secret only in trusted local memory for explicit owner recovery. */
export function unlockEncryptedKeyRecovery(kit,passphrase) {
  if (!exactly(kit,['format','scope','keyId','sealed']) ||
    kit.format !== RECOVERY_FORMAT) throw invalid();
  validateIdentity(kit.scope,kit.keyId);
  if (Buffer.byteLength(JSON.stringify(kit),'utf8')>MAX_KIT_BYTES) throw invalid();
  let inner;
  try {inner=decryptSnapshot(kit.sealed,passphrase);} catch {throw invalid();}
  if (!exactly(inner,['format','scope','keyId','rootKeyHex']) ||
    inner.format!==INNER_FORMAT || inner.scope!==kit.scope ||
    inner.keyId!==kit.keyId || typeof inner.rootKeyHex!=='string' ||
    !HEX.test(inner.rootKeyHex)) throw invalid();
  return {scope:inner.scope,keyId:inner.keyId,
    rootKeyHex:inner.rootKeyHex, fingerprint:fingerprint(inner.rootKeyHex)};
}

/** Fail if target exists; never overwrite an earlier recovery kit. */
export async function saveEncryptedKeyRecovery(filePath,kit) {
  if (typeof filePath!=='string' || !filePath.trim() || filePath.includes('\0'))
    throw new Error('Provide a recovery file path');
  if (!exactly(kit,['format','scope','keyId','sealed']) ||
      kit.format!==RECOVERY_FORMAT) throw invalid();
  const text=JSON.stringify(kit,null,2)+'\n';
  if(Buffer.byteLength(text,'utf8')>MAX_KIT_BYTES) throw invalid();
  const flags=fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL|
    (fsConstants.O_NOFOLLOW||0);
  let file;
  try {
    file=await open(filePath,flags,0o600);
    await file.writeFile(text,{encoding:'utf8'});
    await file.sync();
  }finally{await file?.close();}
}

export async function loadEncryptedKeyRecovery(filePath) {
  if (typeof filePath!=='string' || !filePath.trim() || filePath.includes('\0'))
    throw invalid();
  const info=await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size>MAX_KIT_BYTES)
    throw invalid();
  let parsed;
  try {parsed=JSON.parse(await readFile(filePath,'utf8'));} catch {throw invalid();}
  if (!exactly(parsed,['format','scope','keyId','sealed']) ||
      parsed.format!==RECOVERY_FORMAT) throw invalid();
  return parsed;
}
