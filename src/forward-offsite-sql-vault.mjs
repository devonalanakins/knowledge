/**
 * Owner-local AES-256-GCM archive for encrypted Knowledge SQL exports.
 * Never receives a Knowledge root key or calls a cloud provider.
 * Binary format: magic | salt(16) | nonce(12) | uint64 length |
 * SHA-256(32) | AES-GCM ciphertext | tag(16).
 * Entire header is authenticated as GCM AAD; the original export SHA-256
 * MUST also be supplied independently when sealing or recovering.
 */
import {createCipheriv,createDecipheriv,createHash,randomBytes,scryptSync} from 'node:crypto';
import {constants as fsFlags} from 'node:fs';
import {open,lstat,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {MAX_SQL_EXPORT_BYTES,privateSqlRecoveryFile} from './forward-consistent-sql-restore.mjs';

export const FORWARD_OFFSITE_FORMAT='knowledge-forward-offsite-sql-v1';
const MAGIC=Buffer.from('KNOWLEDGE-OFFSITE-SQL-V1\n','ascii');
const SALT=16,NONCE=12,COUNT=8,DIGEST=32,TAG=16,CHUNK=64*1024;
const HEADER_BYTES=MAGIC.length+SALT+NONCE+COUNT+DIGEST;
export const MAX_OFFSITE_ARCHIVE_BYTES=HEADER_BYTES+MAX_SQL_EXPORT_BYTES+TAG;
const HEX=/^[0-9a-f]{64}$/;
const refused=()=>new Error('KNOWLEDGE_OFFSITE_SQL_REFUSED');
const owned=x=>typeof process.getuid==='function'&&x.uid===process.getuid();

function checkPassphrase(passphrase){
  if(typeof passphrase!=='string'||Buffer.byteLength(passphrase,'utf8')<24||
     Buffer.byteLength(passphrase,'utf8')>1024)throw refused();
}
function derive(passphrase,salt){
  checkPassphrase(passphrase);
  return scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
}
function checkSha(sha){
  if(typeof sha!=='string'||!HEX.test(sha))throw refused();
}
async function readExactly(handle,at,count){
  const out=Buffer.alloc(count);let offset=0;
  while(offset<count){
    const {bytesRead}=await handle.read(out,offset,count-offset,at+offset);
    if(bytesRead<=0)throw refused();
    offset+=bytesRead;
  }
  return out;
}
async function writeExactly(handle,buffer){
  let offset=0;
  while(offset<buffer.length){
    const {bytesWritten}=await handle.write(buffer,offset,buffer.length-offset,null);
    if(bytesWritten<=0)throw refused();
    offset+=bytesWritten;
  }
}
function sameFile(a,b){
  return a.isFile()&&b.isFile()&&a.dev===b.dev&&a.ino===b.ino&&
    a.size===b.size&&a.mtimeMs===b.mtimeMs;
}
async function trustedSource(file,max){
  const checked=await privateSqlRecoveryFile(file);
  if(checked.info.size<1||checked.info.size>max)throw refused();
  const handle=await open(checked.path,fsFlags.O_RDONLY|(fsFlags.O_NOFOLLOW||0));
  try{
    const info=await handle.stat();
    if(!sameFile(checked.info,info))throw refused();
    return {path:checked.path,handle,info};
  }catch{await handle.close();throw refused();}
}
async function newTarget(file,exclude){
  if(process.platform==='win32'||typeof process.getuid!=='function'||
     typeof file!=='string'||!file.trim()||file.includes('\0'))throw refused();
  const path=resolve(file),parent=await lstat(dirname(path));
  if(path===exclude||!parent.isDirectory()||parent.isSymbolicLink()||
     !owned(parent)||(parent.mode&0o777)!==0o700)throw refused();
  return path;
}
async function createNewFile(path){
  return open(path,fsFlags.O_CREAT|fsFlags.O_WRONLY|fsFlags.O_EXCL|
    (fsFlags.O_NOFOLLOW||0),0o600);
}
function makeHeader(size,sha){
  const salt=randomBytes(SALT),nonce=randomBytes(NONCE),length=Buffer.alloc(COUNT);
  length.writeBigUInt64BE(BigInt(size));
  return {salt,nonce,buffer:Buffer.concat([MAGIC,salt,nonce,length,Buffer.from(sha,'hex')])};
}
function inspectHeader(header,fileSize,expectedSha256){
  if(header.length!==HEADER_BYTES||!header.subarray(0,MAGIC.length).equals(MAGIC))
    throw refused();
  let at=MAGIC.length;
  const salt=header.subarray(at,at+=SALT),nonce=header.subarray(at,at+=NONCE);
  const n=header.readBigUInt64BE(at);at+=COUNT;
  if(n<1n||n>BigInt(MAX_SQL_EXPORT_BYTES))throw refused();
  const length=Number(n),sha=header.subarray(at,at+=DIGEST).toString('hex');
  if(sha!==expectedSha256||fileSize!==HEADER_BYTES+length+TAG)throw refused();
  return {header,salt,nonce,length,sha};
}

/** Stream an owner-downloaded SQL export into a new encrypted local archive. */
export async function sealForwardOffsiteSql({
  sourceFile,targetFile,expectedSha256,passphrase,
}={}){
  checkSha(expectedSha256);checkPassphrase(passphrase);
  let src,target,output,key,created=false,success=false;
  try{
    src=await trustedSource(sourceFile,MAX_SQL_EXPORT_BYTES);
    output=await newTarget(targetFile,src.path);
    const {salt,nonce,buffer}=makeHeader(src.info.size,expectedSha256);
    key=derive(passphrase,salt);
    const cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});
    cipher.setAAD(buffer);
    target=await createNewFile(output);created=true;
    await writeExactly(target,buffer);
    const hash=createHash('sha256');let at=0;
    while(at<src.info.size){
      const count=Math.min(CHUNK,src.info.size-at);
      const plaintext=await readExactly(src.handle,at,count);
      hash.update(plaintext);
      await writeExactly(target,cipher.update(plaintext));
      plaintext.fill(0);at+=count;
    }
    const end=cipher.final();
    if(end.length)await writeExactly(target,end);
    await writeExactly(target,cipher.getAuthTag());
    if(hash.digest('hex')!==expectedSha256||
       !sameFile(src.info,await src.handle.stat())||
       (await target.stat()).size!==HEADER_BYTES+src.info.size+TAG)throw refused();
    await target.sync();
    success=true;
    return {format:FORWARD_OFFSITE_FORMAT,sealed:true,
      sha256:expectedSha256,bytes:src.info.size,
      archiveBytes:HEADER_BYTES+src.info.size+TAG};
  }catch{throw refused();}
  finally{
    try{await target?.close();}catch{}
    if(created&&!success)try{await unlink(output);}catch{}
    try{await src?.handle?.close();}catch{}
    key?.fill(0);
  }
}
async function decryptPass(handle,info,key,tag,target){
  const cipher=createDecipheriv('aes-256-gcm',key,info.nonce,{authTagLength:16});
  cipher.setAAD(info.header);cipher.setAuthTag(tag);
  const hash=createHash('sha256');let at=0,bytes=0;
  while(at<info.length){
    const count=Math.min(CHUNK,info.length-at);
    const encrypted=await readExactly(handle,HEADER_BYTES+at,count);
    const clear=cipher.update(encrypted);
    hash.update(clear);
    if(target)await writeExactly(target,clear);
    clear.fill(0);
    bytes+=count;at+=count;
  }
  const last=cipher.final();hash.update(last);
  if(target&&last.length)await writeExactly(target,last);
  bytes+=last.length;
  if(bytes!==info.length||hash.digest('hex')!==info.sha)throw refused();
}

/** Verify first; only then optionally create a private decrypted SQL file. */
export async function openForwardOffsiteSql({
  archiveFile,expectedSha256,passphrase,targetFile,
}={}){
  checkSha(expectedSha256);checkPassphrase(passphrase);
  let src,target,output,key,created=false,success=false;
  try{
    src=await trustedSource(archiveFile,MAX_OFFSITE_ARCHIVE_BYTES);
    const buffer=await readExactly(src.handle,0,HEADER_BYTES);
    const info=inspectHeader(buffer,src.info.size,expectedSha256);
    const tag=await readExactly(src.handle,HEADER_BYTES+info.length,TAG);
    key=derive(passphrase,info.salt);
    // Pass one authenticates the complete encrypted file without writing SQL.
    await decryptPass(src.handle,info,key,tag,null);
    if(targetFile!==undefined){
      output=await newTarget(targetFile,src.path);
      target=await createNewFile(output);created=true;
      // Pass two authenticates again while restoring the encrypted SQL rows.
      await decryptPass(src.handle,info,key,tag,target);
      if((await target.stat()).size!==info.length)throw refused();
      await target.sync();
    }
    if(!sameFile(src.info,await src.handle.stat()))throw refused();
    success=true;
    return {format:FORWARD_OFFSITE_FORMAT,verified:true,sha256:info.sha,
      bytes:info.length,recovered:targetFile!==undefined,
      ...(targetFile!==undefined?{sqlFile:output}:{})};
  }catch{throw refused();}
  finally{
    try{await target?.close();}catch{}
    if(created&&!success)try{await unlink(output);}catch{}
    try{await src?.handle?.close();}catch{}
    key?.fill(0);
  }
}
