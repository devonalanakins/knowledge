/**
 * G8: an OFFLINE-only, synthetic original-source access gate.
 *
 * This has no HTTP route and no production identity integration. Trusted owner
 * configuration supplies a registry of encrypted originals and pre-hashed bearer
 * credentials. A required durable audit callback must complete before plaintext
 * can leave the gate. Revocation is in-process only until a persistent authority
 * and key-rotation design is implemented.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

const ID = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const PRINCIPAL = /^[a-z][a-z0-9-]{0,63}$/;
const SCOPES = new Set(['personal', 'family', 'devonstation', 'anevum', 'cristy', 'mizvo', 'external']);
const MAX_TOKEN_BYTES = 1024;
const MAX_AUDIT_BYTES = 1024 * 1024;
const secureHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function validId(value) {
  if(typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if(!ID.test(lower) && !UUID.test(lower)) return null;
  return lower.replaceAll('-', '');
}
export class ArchiveAccessError extends Error {
  constructor(code, message) { super(message); this.name = 'ArchiveAccessError'; this.code = code; }
}
function invalidConfig(message) { throw new ArchiveAccessError('INVALID_CONFIG', message); }
function refused() { return new ArchiveAccessError('ACCESS_DENIED', 'Original not accessible to this credential'); }
function auditError() { return new ArchiveAccessError('AUDIT_UNAVAILABLE', 'Audit unavailable; access blocked'); }

/** Hash only randomly generated, high-entropy credentials. This is not a password KDF. */
export function hashArchiveCredential(token) {
  if(typeof token !== 'string' || Buffer.byteLength(token, 'utf8') < 32 || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES)
    throw new ArchiveAccessError('INVALID_CREDENTIAL', 'Expected a high-entropy credential of at least 32 UTF-8 bytes');
  return secureHash(token);
}

/**
 * Trusted policy maps EXACT original IDs to files; callers NEVER supply paths,
 * hashes or archive passphrases. Scope-specific grant is mandatory even for an
 * operator. An actual identity provider and durable revocation are NOT present.
 */
export class SyntheticArchiveAccessGate {
  #sources = new Map();
  #principals = new Map();
  #audit;
  #reader;
  #passphrase;
  #now;
  #auditKey;

  constructor({ sources, principals, audit, reader, passphrase, auditKey, now = () => Date.now() }) {
    if(!Array.isArray(sources) || sources.length < 1 || sources.length > 20000) invalidConfig('Bounded trusted source registry required');
    if(!Array.isArray(principals) || principals.length < 1 || principals.length > 100) invalidConfig('Bounded trusted principals required');
    if(typeof audit !== 'function' || typeof reader !== 'function') invalidConfig('Audit and verified source reader required');
    if(typeof passphrase !== 'string' || Buffer.byteLength(passphrase,'utf8') < 24) invalidConfig('External archive decryption key required');
    if(typeof now !== 'function') invalidConfig('Time source required');
    if(!Buffer.isBuffer(auditKey) || auditKey.length < 32) invalidConfig('Independent 32-byte audit pseudonym key required');
    for(const src of sources) {
      if(!isObject(src)) invalidConfig('Invalid registered source');
      const id = validId(src.originalNotionId);
      if(!id || !SCOPES.has(src.scope) || typeof src.sha256 !== 'string' || !SHA.test(src.sha256.toLowerCase()) ||
         typeof src.file !== 'string' || !isAbsolute(src.file) || basename(src.file) !== id + '.source.enc' || this.#sources.has(id))
        invalidConfig('Invalid or duplicate trusted original mapping');
      this.#sources.set(id, Object.freeze({originalNotionId:id,scope:src.scope,sha256:src.sha256.toLowerCase(),file:resolve(src.file)}));
    }
    const hashes = new Set();
    for(const p of principals) {
      if(!isObject(p) || typeof p.id !== 'string' || !PRINCIPAL.test(p.id) || this.#principals.has(p.id) ||
        typeof p.tokenHash !== 'string' || !SHA.test(p.tokenHash.toLowerCase()) || hashes.has(p.tokenHash.toLowerCase()) ||
        !Array.isArray(p.scopes) || p.scopes.length < 1 || p.scopes.some(scope => !SCOPES.has(scope)) ||
        !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= 0 ||
        (p.revoked !== undefined && typeof p.revoked !== 'boolean')) invalidConfig('Invalid or duplicate principal grant');
      const hash = p.tokenHash.toLowerCase();
      hashes.add(hash);
      this.#principals.set(p.id, {id:p.id,hash:Buffer.from(hash,'hex'),scopes:new Set(p.scopes),expiresAt:p.expiresAt,revoked:p.revoked === true});
    }
    this.#audit=audit;
    this.#reader=reader;
    this.#passphrase=passphrase;
    this.#now=now;
    this.#auditKey=Buffer.from(auditKey);
  }

  /** Trusted local operator only; no network route, persistent revocation TBD. */
  revokePrincipal(id) {
    const grant=this.#principals.get(id);
    if(!grant) throw new ArchiveAccessError('UNKNOWN_PRINCIPAL', 'No matching configured principal');
    grant.revoked=true;
  }

  #principalFor(token) {
    let selected=null;
    if(typeof token !== 'string' || Buffer.byteLength(token,'utf8') < 32 || Buffer.byteLength(token,'utf8') > MAX_TOKEN_BYTES) return null;
    const hash = Buffer.from(secureHash(token), 'hex');
    // Compare to every configured hash, not plaintext credentials.
    for(const principal of this.#principals.values()) if(timingSafeEqual(hash,principal.hash)) selected=principal;
    return selected;
  }

  #pseudonym(kind, value) {
    return createHmac('sha256',this.#auditKey).update(kind+':'+value,'utf8').digest('hex').slice(0,24);
  }

  async #record(event) {
    try { await this.#audit(Object.freeze(event)); }
    catch { throw auditError(); }
  }

  async read({ bearerToken, originalNotionId, scope } = {}) {
    const requestedId=validId(originalNotionId);
    const clock=this.#now();
    if(!Number.isSafeInteger(clock) || clock < 0 || clock > 8_640_000_000_000_000) throw auditError();
    const person=this.#principalFor(bearerToken);
    const src=requestedId ? this.#sources.get(requestedId) : null;
    const event={at:new Date(clock).toISOString(),principalKey:person?this.#pseudonym('principal',person.id):'anonymous',
      sourceKey:requestedId?this.#pseudonym('source',requestedId):'invalid',outcome:'denied'};
    if(!person || person.revoked || clock >= person.expiresAt || !SCOPES.has(scope) || !src || src.scope !== scope || !person.scopes.has(scope)) {
      await this.#record(event);
      throw refused();
    }
    // Verify durable logging *before* reading any plaintext.
    await this.#record({...event,outcome:'authorized'});
    let result;
    try {
      result=await this.#reader({file:src.file,passphrase:this.#passphrase,expectedScope:src.scope,
        expectedNotionId:src.originalNotionId,expectedSha256:src.sha256});
      if(!isObject(result) || result.scope!==src.scope || validId(result.originalNotionId)!==src.originalNotionId ||
        result.sha256!==src.sha256 || typeof result.text!=='string' || !Number.isSafeInteger(result.bytes) ||
        result.bytes!==Buffer.byteLength(result.text,'utf8') || secureHash(result.text)!==src.sha256) {
        throw new Error('Source verification mismatch');
      }
    } catch {
      await this.#record({...event,outcome:'source_failed'});
      throw new ArchiveAccessError('SOURCE_UNAVAILABLE','Authorized source could not be verified');
    }
    // Audit failure must prevent plaintext from leaving this function.
    await this.#record({...event,outcome:'delivered'});
    return Object.freeze({originalNotionId:src.originalNotionId,scope:src.scope,sha256:src.sha256,bytes:result.bytes,text:result.text});
  }
}

/**
 * Optional local audit sink: owner-only, bounded append-only JSONL with fsync.
 * No plaintext, filenames, token hashes, secrets or source titles in entries.
 * NOT tamper-evident or encrypted; production requires a dedicated secure log.
 */
export async function createProtectedLocalAudit(path, { maxBytes=MAX_AUDIT_BYTES } = {}) {
  if(typeof path !== 'string' || !isAbsolute(path) || !Number.isSafeInteger(maxBytes) || maxBytes < 128 || maxBytes > MAX_AUDIT_BYTES)
    invalidConfig('Use an absolute audit path and an explicit bounded size');
  const filename=resolve(path),parent=dirname(filename);
  const ps=await lstat(parent);
  if(!ps.isDirectory() || ps.isSymbolicLink() || await realpath(parent)!==parent) invalidConfig('Audit directory is not trusted');
  const flags=constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW;
  const handle=await open(filename,flags,0o600);
  let queue=Promise.resolve();
  try {
    const st=await handle.stat();
    if(!st.isFile() || st.nlink!==1 || (st.mode & 0o077)!==0 || st.size > maxBytes) invalidConfig('Audit file must be a restricted local regular file');
  }catch(e){await handle.close();throw e;}
  let closed=false,failed=false;
  const write=(event)=>{
    const task=queue.then(async()=>{
      if(closed || failed) throw new Error('Audit file unavailable');
      const safe={at:event?.at,principalKey:event?.principalKey,sourceKey:event?.sourceKey,outcome:event?.outcome};
      if(!/^\d{4}-\d\d-\d\dT/.test(safe.at) || !/^(anonymous|[a-f0-9]{24})$/.test(safe.principalKey) ||
         !/^(invalid|[a-f0-9]{24})$/.test(safe.sourceKey) || !['denied','authorized','source_failed','delivered'].includes(safe.outcome))
        throw new Error('Invalid audit event');
      const line=Buffer.from(JSON.stringify(safe)+'\n','utf8');
      const st=await handle.stat();
      if(st.size + line.length > maxBytes) throw new Error('Audit capacity exhausted');
      const res=await handle.write(line,0,line.length,null);
      if(res.bytesWritten !== line.length) throw new Error('Audit short write');
      await handle.sync();
    }).catch(e=>{ failed=true; throw e; });
    queue=task.catch(()=>{});
    return task;
  };
  return {write, close:async()=>{await queue;closed=true;await handle.close();}};
}
