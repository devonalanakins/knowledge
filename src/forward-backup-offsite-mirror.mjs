/**
 * Owner-local, read-only mirror of already encrypted Knowledge R2 snapshots.
 * Requires a trusted POSIX host and an independently encrypted 0700 directory.
 * Does not receive the Knowledge owner key or recovery passphrase.
 *
 * This copies ONLY forward personal-scope ciphertext rows, not Notion ZIPs,
 * historic attachments, sharing ACLs or a complete disaster-recovery system.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,unlink} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {auditScheduledBackups} from './forward-backup-health.mjs';
import {parseForwardCiphertextSnapshot} from './forward-ciphertext-restore.mjs';

const MAX_OBJECTS=10_000,MAX_FILE=32*1024*1024;
const SHA=/^[0-9a-f]{64}$/;
const MD5=/^[0-9a-f]{32}$/;
const SCOPE=/^[a-z][a-z0-9-]{0,63}$/;
const KEY_ID=/^[a-z0-9-]{1,32}$/;
const fail=code=>{throw new Error('KNOWLEDGE_OFFSITE_MIRROR_'+code);};
function digest(algorithm,bytes){return createHash(algorithm).update(bytes).digest('hex');}
function secureStat(s,kind){
  if(!s||!s.isFile?.()&&kind==='file'||!s.isDirectory?.()&&kind==='dir'||
     s.isSymbolicLink?.()||s.uid!==process.getuid()||s.mode&0o077||
     (kind==='file'&&s.nlink!==1))
    fail('INSECURE_DESTINATION');
}
async function privateDestination(directory){
  if(process.platform==='win32'||typeof process.getuid!=='function')fail('POSIX_REQUIRED');
  if(typeof directory!=='string'||!directory.trim()||directory.includes('\0'))
    fail('INVALID_DESTINATION');
  const path=resolve(directory);
  const s=await lstat(path).catch(()=>fail('INSECURE_DESTINATION'));
  secureStat(s,'dir');
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
    .catch(()=>fail('INSECURE_DESTINATION'));
  try{
    const live=await handle.stat();
    if(live.dev!==s.dev||live.ino!==s.ino)fail('INSECURE_DESTINATION');
    return {path,handle,stat:live};
  }catch(e){await handle.close();throw e;}
}
async function safeExisting(path,expectedSha,length){
  const fh=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
    .catch(()=>fail('EXISTING_FILE_UNREADABLE'));
  try{
    const s=await fh.stat();secureStat(s,'file');
    if(s.size!==length||s.size>MAX_FILE)fail('EXISTING_FILE_MISMATCH');
    const bytes=await fh.readFile();
    if(digest('sha256',bytes)!==expectedSha)fail('EXISTING_FILE_MISMATCH');
    return true;
  }finally{await fh.close();}
}
async function persistNew(path,directory,bytes,sha){
  let file,created=false;
  try{
    file=await open(path,
      constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    created=true;
    const s=await file.stat();secureStat(s,'file');
    await file.writeFile(bytes);
    await file.sync();
    if(digest('sha256',bytes)!==sha)fail('INVALID_CONTENT');
    await file.close();file=null;
    await directory.handle.sync(); // Durable file and containing directory metadata.
    return 'created';
  }catch(e){
    if(file)await file.close().catch(()=>{});
    if(created)await unlink(path).catch(()=>{});
    if(e?.code==='EEXIST'){
      await safeExisting(path,sha,bytes.length);
      return 'unchanged';
    }
    throw e;
  }
}
function verifyMetadata(obj,prefix,scope,keyId,bytes,parseSnapshot){
  if(!obj?.key?.startsWith(prefix)||!(bytes instanceof Uint8Array)||
     bytes.length>MAX_FILE||bytes.length!==obj.size||!SHA.test(obj.custom_metadata?.sha256)||
     typeof obj.etag!=='string'||!MD5.test(obj.etag.replaceAll('"','').toLowerCase()))
    fail('UNTRUSTED_OBJECT');
  const sha=obj.custom_metadata.sha256,md5=obj.etag.replaceAll('"','').toLowerCase();
  if(digest('sha256',bytes)!==sha||digest('md5',bytes)!==md5)
    fail('UNTRUSTED_OBJECT');
  let parsed;try{parsed=parseSnapshot(bytes,{expectedSha256:sha});}
  catch{fail('INVALID_SNAPSHOT');}
  if(parsed?.snapshot?.scope!==scope||parsed.snapshot.keyId!==keyId||
     parsed.snapshot.status!=='automatic-owner-ciphertext')
    fail('INVALID_SNAPSHOT');
  return sha;
}

/**
 * Mirror every listed authorized generation. The shared health auditor
 * rejects missing recent scheduled days, invalid/late filenames and bad
 * metadata before any local files are written. Earlier historical coverage
 * is not independently established by this function.
 */
export async function mirrorScheduledBackupCiphertext({listObjects,readObject,
  parseSnapshot=parseForwardCiphertextSnapshot,scope,keyId,firstDue,now=new Date(),
  targetDirectory,graceMinutes=90,lookbackDays=7}={}){
  if(!SCOPE.test(scope)||!KEY_ID.test(keyId)||
     typeof listObjects!=='function'||typeof readObject!=='function'||
     typeof parseSnapshot!=='function')fail('BAD_CONFIGURATION');
  const root=await privateDestination(targetDirectory);
  try{
    const prefix='automated/'+scope+'/'+keyId+'/';
    const entries=await listObjects(prefix);
    if(!Array.isArray(entries)||entries.length>MAX_OBJECTS)fail('INVALID_LIST');
    const audit=await auditScheduledBackups({
      listObjects:async()=>entries,readObject,parseSnapshot,
      scope,keyId,firstDue,now,graceMinutes,lookbackDays,
    });
    if(audit.status==='PENDING_FIRST_RUN')
      return {status:'PENDING_FIRST_RUN',created:0,unchanged:0,
        verified:0,dueDay:audit.expectedDay,coverage:'RECENT_DUE_DAYS_ONLY'};
    const names=new Set();
    // Check every destination filename before creating the first file.
    // A duplicate or traversal attempt must never cause a partial mirror.
    const work=entries.map(obj=>{
      const tail=obj.key.slice(prefix.length);
      if(!tail||basename(tail)!==tail||tail.includes('/')||tail.includes('\\'))
        fail('INVALID_NAME');
      const name=scope+'--'+keyId+'--'+tail;
      if(names.has(name))fail('DUPLICATE_OBJECT');
      names.add(name);
      return {obj,name};
    });
    let created=0,unchanged=0,verified=0;
    for(const {obj,name} of work){
      const path=join(root.path,name);
      const liveDir=await lstat(root.path);
      if(liveDir.dev!==root.stat.dev||liveDir.ino!==root.stat.ino)
        fail('INSECURE_DESTINATION');
      const bytes=await readObject(obj.key);
      const sha=verifyMetadata(obj,prefix,scope,keyId,bytes,parseSnapshot);
      const result=await persistNew(path,root,bytes,sha);
      if(result==='created')created++;else unchanged++;
      verified++;
    }
    return {status:'PASS',created,unchanged,verified,dueDay:audit.expectedDay,
      coverage:'RECENT_DUE_DAYS_ONLY'};
  }finally{await root.handle.close();}
}
