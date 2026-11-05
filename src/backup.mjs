/** Password-encrypted portable backup envelopes for trusted local owner tooling. */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { KnowledgeError } from './knowledge.mjs';

export const ENCRYPTED_BACKUP_FORMAT = 'knowledge-encrypted-snapshot-v1';
const AAD = Buffer.from('Knowledge:encrypted-snapshot:v1','utf8');
const MAX_CLEAR_BYTES = 25_000_000;
const MAX_CIPHER_BYTES = MAX_CLEAR_BYTES + 16;
const KDF = Object.freeze({ name:'scrypt', N:32768, r:8, p:1 });
const MAXMEM = 64 * 1024 * 1024;
const invalid = () => new KnowledgeError('INVALID_BACKUP', 'Encrypted backup is invalid, tampered with, or uses an incorrect passphrase');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysExactly = (value, allowed) => object(value) &&
  Object.keys(value).length === allowed.length && allowed.every(x=>Object.hasOwn(value,x));
function requirePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || Buffer.byteLength(passphrase,'utf8') < 24 || Buffer.byteLength(passphrase,'utf8') > 1024) {
    throw new KnowledgeError('INVALID_INPUT', 'Provide an independently stored backup passphrase of at least 24 UTF-8 bytes');
  }
}
function strictBase64(s, expectedBytes) {
  if (typeof s !== 'string' || s.length > 40_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw invalid();
  const buf=Buffer.from(s,'base64');
  if (buf.toString('base64') !== s || (expectedBytes !== null && buf.length !== expectedBytes)) throw invalid();
  return buf;
}
function derive(passphrase,salt) {
  return scryptSync(passphrase,salt,32,{N:KDF.N,r:KDF.r,p:KDF.p,maxmem:MAXMEM});
}
export function encryptSnapshot(snapshot,passphrase) {
  requirePassphrase(passphrase);
  const clear=Buffer.from(JSON.stringify(snapshot),'utf8');
  if (clear.length > MAX_CLEAR_BYTES) throw new KnowledgeError('QUOTA_EXCEEDED','Snapshot exceeds encrypted backup safety limit');
  const salt=randomBytes(16), iv=randomBytes(12), key=derive(passphrase,salt);
  try {
    const cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});
    cipher.setAAD(AAD);
    const ciphertext=Buffer.concat([cipher.update(clear),cipher.final()]);
    return {
      format:ENCRYPTED_BACKUP_FORMAT,
      kdf:{...KDF,salt:salt.toString('base64')},
      cipher:{name:'aes-256-gcm',nonce:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')},
      ciphertext:ciphertext.toString('base64'),
    };
  } finally { key.fill(0);clear.fill(0); }
}
export function decryptSnapshot(envelope,passphrase) {
  requirePassphrase(passphrase);
  if (!keysExactly(envelope,['format','kdf','cipher','ciphertext']) || envelope.format !== ENCRYPTED_BACKUP_FORMAT ||
    !keysExactly(envelope.kdf,['name','N','r','p','salt']) ||
    envelope.kdf.name !== KDF.name || envelope.kdf.N !== KDF.N || envelope.kdf.r !== KDF.r || envelope.kdf.p !== KDF.p ||
    !keysExactly(envelope.cipher,['name','nonce','tag']) || envelope.cipher.name !== 'aes-256-gcm') throw invalid();
  const salt=strictBase64(envelope.kdf.salt,16);
  const iv=strictBase64(envelope.cipher.nonce,12);
  const tag=strictBase64(envelope.cipher.tag,16);
  const ciphertext=strictBase64(envelope.ciphertext,null);
  if (ciphertext.length > MAX_CIPHER_BYTES) throw invalid();
  const key=derive(passphrase,salt);
  let plaintext;
  try {
    const decipher=createDecipheriv('aes-256-gcm',key,iv,{authTagLength:16});
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    plaintext=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    if (plaintext.length > MAX_CLEAR_BYTES) throw invalid();
    try{return JSON.parse(plaintext.toString('utf8'));}
    catch {throw invalid();}
  } catch(error) {
    if (error instanceof KnowledgeError) throw error;
    throw invalid();
  } finally {key.fill(0);plaintext?.fill(0);}
}
