/**
 * G7: synthetic-only, individually recoverable, authenticated original Markdown capsules.
 *
 * These encrypted files live OUTSIDE the plaintext SQLite wiki, the public repo,
 * and the original ZIP. No HTTP/ChatGPT route is exported by this module.
 * A passphrase is not a substitute for an authenticated user/session.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, realpath, mkdir, rm, open } from 'node:fs/promises';
import { resolve, dirname, join, relative, sep, isAbsolute } from 'node:path';
import { encryptSnapshot, decryptSnapshot } from './backup.mjs';
import { planNotionSyntheticStage, readVerifiedNotionMarkdown } from './notion-stage.mjs';

const CAPSULE_FORMAT = 'knowledge-notion-original-capsule-v1';
const ID = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const SCOPES = new Set(['personal','family','devonstation','anevum','cristy','mizvo','external']);
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAX_CAPSULES = 20;

export class OriginalCapsuleError extends Error {
  constructor(code, message) { super(message); this.name='OriginalCapsuleError'; this.code=code; }
}
function deny(code, message) { throw new OriginalCapsuleError(code, message); }
function checkedId(value) {
  if(typeof value!=='string') deny('INVALID_SELECTION', 'Notion ID required');
  const id=value.toLowerCase().replaceAll('-','');
  if(!ID.test(id) || !(ID.test(value.toLowerCase()) || UUID.test(value.toLowerCase())))deny('INVALID_SELECTION','Invalid Notion ID');
  return id;
}
function checkedSha(value) {
  if(typeof value!=='string'||!SHA.test(value.toLowerCase()))deny('INVALID_SELECTION','Expected SHA-256 source fingerprint');
  return value.toLowerCase();
}
function checkedScope(value) {
  if(!SCOPES.has(value))deny('SCOPE_DENIED','Invalid or unauthorized scope');
  return value;
}
function object(value) {return value!==null && typeof value==='object' && !Array.isArray(value);}
function exactly(value, names) {return object(value) && Object.keys(value).length===names.length && names.every(key=>Object.hasOwn(value,key));}
function inside(root, target) {
  const rel=relative(root,target);
  return rel!=='' && rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel);
}
async function trustedDir(path) {
  const dest=resolve(path);
  const st=await lstat(dest);
  if(!st.isDirectory() || st.isSymbolicLink() || await realpath(dest)!==dest)deny('UNSAFE_DESTINATION','Directory must be real and local');
  return dest;
}
async function capsuleFile(file) {
  if(typeof file!=='string'||!file.trim())deny('INVALID_SELECTION','Encrypted source file required');
  const name=resolve(file), dir=await trustedDir(dirname(name));
  if(!inside(dir,name))deny('UNSAFE_SOURCE','Invalid encrypted source path');
  const st=await lstat(name);
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_ENVELOPE_BYTES)deny('UNSAFE_SOURCE','Capsule must be a bounded regular file');
  const f=await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before=await f.stat();
    if(!before.isFile()||before.size!==st.size||before.size>MAX_ENVELOPE_BYTES)deny('UNSAFE_SOURCE','Capsule changed during opening');
    const bytes=await f.readFile();
    const after=await f.stat();
    if(bytes.length!==before.size||after.size!==before.size||before.ino!==after.ino||before.dev!==after.dev||before.mtimeMs!==after.mtimeMs)deny('SOURCE_CHANGED','Capsule changed during read');
    let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{deny('INVALID_CAPSULE','Cannot decode encrypted capsule');}
    return json;
  } finally {await f.close();}
}
function validatePlaintext(payload,{scope,id,sha}) {
  if(!exactly(payload,['format','scope','originalNotionId','sourcePath','sha256','bytes','text'])||payload.format!==CAPSULE_FORMAT||payload.scope!==scope||payload.originalNotionId!==id||payload.sha256!==sha||typeof payload.sourcePath!=='string'||payload.sourcePath.length>2048||typeof payload.text!=='string'||!Number.isInteger(payload.bytes)||payload.bytes<0||payload.bytes>1024*1024)
    deny('INVALID_CAPSULE','Source identity or scope does not match');
  if(!payload.text.startsWith('# SYNTHETIC FIXTURE\n'))deny('PRIVATE_DATA_BLOCKED','Capsule was not explicitly generated for a synthetic test');
  if(Buffer.byteLength(payload.text,'utf8')!==payload.bytes || createHash('sha256').update(payload.text).digest('hex')!==sha)
    deny('SOURCE_CHANGED','Original source fingerprint verification failed');
  return payload;
}

/**
 * A trusted offline owner creates a NEW directory of encrypted capsules,
 * after checking original IDs, ownership, file fingerprints, and synthetic marker.
 * There is no mutation of existing archives, SQLite or original extracted export.
 */
export async function stageSyntheticOriginalCapsules({root,preflight,inventory,scope,selectedIds,outputDir,passphrase,syntheticOnly=false}) {
  if(syntheticOnly!==true)deny('PRIVATE_DATA_BLOCKED','Only fictional test content is permitted');
  checkedScope(scope);
  const plan=planNotionSyntheticStage({preflight,inventory,scope,selectedIds});
  if(plan.items.length>MAX_CAPSULES)deny('INVALID_SELECTION','Too many originals');
  if(typeof outputDir!=='string'||!outputDir.trim())deny('UNSAFE_DESTINATION','Fresh output directory required');
  const rootPath=await trustedDir(root),target=resolve(outputDir),parent=await trustedDir(dirname(target));
  if(target===rootPath||inside(rootPath,target)||target===parent)deny('UNSAFE_DESTINATION','Encrypted originals must live outside export');

  // Verify and encrypt ALL source bytes in memory before creating output files.
  const envelopes=[];
  for(const item of plan.items){
    const source=await readVerifiedNotionMarkdown({root,preflight,inventory,scope,originalNotionId:item.originalNotionId});
    if(!source.text.startsWith('# SYNTHETIC FIXTURE\n'))deny('PRIVATE_DATA_BLOCKED','Real Notion data is not permitted');
    const payload={format:CAPSULE_FORMAT,scope,originalNotionId:source.originalNotionId,sourcePath:source.relativePath,sha256:source.sha256,bytes:source.bytes,text:source.text};
    const encoded=Buffer.from(JSON.stringify(encryptSnapshot(payload,passphrase))+'\n','utf8');
    if(encoded.length>MAX_ENVELOPE_BYTES)deny('QUOTA_EXCEEDED','Encrypted original exceeds capsule size');
    envelopes.push({filename:item.originalNotionId+'.source.enc',encoded});
  }
  // mkdir is exclusive; no existing directory or file is ever overwritten.
  await mkdir(target,{mode:0o700});
  try{
    for(const item of envelopes){
      const handle=await open(join(target,item.filename),'wx',0o600);
      try{await handle.writeFile(item.encoded);await handle.sync();}finally{await handle.close();}
    }
    return {format:'knowledge-original-capsule-set-v1',mode:'SYNTHETIC_ONLY',scope,encryptedOriginals:envelopes.length,originalsPreserved:true,privateDataImported:false};
  }catch(err){
    await rm(target,{recursive:true,force:true});
    throw err;
  }
}

/**
 * Read one encrypted original into a trusted process only after explicit identity
 * and scope checks. A network handler MUST add real authenticated authorization.
 */
export async function readSyntheticOriginalCapsule({file,passphrase,expectedScope,expectedNotionId,expectedSha256}) {
  const scope=checkedScope(expectedScope),id=checkedId(expectedNotionId),sha=checkedSha(expectedSha256);
  const envelope=await capsuleFile(file);
  let decoded;
  try{decoded=decryptSnapshot(envelope,passphrase);}catch{
    deny('INVALID_CAPSULE','Encrypted capsule invalid, altered or key incorrect');
  }
  return validatePlaintext(decoded,{scope,id,sha});
}
