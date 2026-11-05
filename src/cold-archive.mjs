/**
 * Stream-encrypt a complete Notion export ZIP into independent cold storage.
 * The file contains no plaintext names; not a general-purpose ZIP extractor.
 * Decryption writes temporary plaintext only in the caller-selected protected
 * directory and exposes it only after authentication succeeds.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, link, unlink, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
export class ArchiveError extends Error { constructor(code,message){ super(message);this.name='ArchiveError';this.code=code; } }

const MAGIC=Buffer.from('KARC1\0','ascii');
const AAD=Buffer.from('Knowledge:cold-archive:v1','utf8');
const MAX_HEADER_BYTES=1024;
const MAX_INPUT_BYTES=20*1024**3; // Gate; not a recommended archive size.
const SCRYPT={N:32768,r:8,p:1,maxmem:64*1024*1024};
const passphraseError=()=>new ArchiveError('INVALID_PASSPHRASE','Use a high-entropy independent archive passphrase of at least 24 UTF-8 bytes');
const invalidArchive=()=>new ArchiveError('INVALID_ARCHIVE','Archive is invalid, altered, or the passphrase is incorrect');
function secret(passphrase){if(typeof passphrase!=='string'||Buffer.byteLength(passphrase,'utf8')<24||Buffer.byteLength(passphrase,'utf8')>1024)throw passphraseError();}
async function checkedSource(path){
 const full=resolve(path), s=await lstat(full);
 if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_INPUT_BYTES)throw new ArchiveError('INVALID_SOURCE','Expected a regular export file under the size limit');
 return {full,size:s.size,mtimeMs:s.mtimeMs};
}
async function writeAll(handle,data){
 let n=0;while(n<data.length){const r=await handle.write(data,n,data.length-n,null);if(r.bytesWritten<1)throw new Error('Failed to write archive');n+=r.bytesWritten;}
}
function derive(passphrase,salt){return scryptSync(passphrase,salt,32,SCRYPT);}
const validB64=(str,len)=>typeof str==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(str)&&Buffer.from(str,'base64').length===len&&Buffer.from(str,'base64').toString('base64')===str;

export async function encryptColdArchive(input,output,passphrase){
 secret(passphrase);
 const source=await checkedSource(input),target=resolve(output);
 if(target===source.full)throw new ArchiveError('UNSAFE_DESTINATION','Do not overwrite the source export');
 const salt=randomBytes(16),nonce=randomBytes(12);
 const metadata=Buffer.from(JSON.stringify({format:'knowledge-cold-archive-v1',kdf:'scrypt-N32768-r8-p1',salt:salt.toString('base64'),nonce:nonce.toString('base64')}),'utf8');
 if(metadata.length>MAX_HEADER_BYTES)throw invalidArchive();
 const marker=Buffer.alloc(4);marker.writeUInt32BE(metadata.length);
 const header=Buffer.concat([MAGIC,marker,metadata]);
 const key=derive(passphrase,salt);
 let handle,created=false;
 try{
   handle=await open(target,'wx',0o600);created=true;
   await writeAll(handle,header);
   const cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});
   cipher.setAAD(Buffer.concat([AAD,header]));
   for await (const chunk of createReadStream(source.full,{highWaterMark:64*1024}))await writeAll(handle,cipher.update(chunk));
   await writeAll(handle,cipher.final());await writeAll(handle,cipher.getAuthTag());
   const after=await stat(source.full);
   if(after.size!==source.size || after.mtimeMs!==source.mtimeMs) throw new ArchiveError('SOURCE_CHANGED','Original export was modified during encryption');
   await handle.sync();await handle.close();handle=null;
   return {format:'knowledge-cold-archive-v1',sizeBytes:(await stat(target)).size};
 }catch(error){
   if(handle)await handle.close().catch(()=>{});
   if(created)await unlink(target).catch(()=>{});
   throw error;
 }finally{key.fill(0);}
}
export async function decryptColdArchive(input,output,passphrase){
 secret(passphrase);
 const source=await checkedSource(input),destination=resolve(output);
 if(destination===source.full)throw new ArchiveError('UNSAFE_DESTINATION','Do not overwrite the source archive');
 const inputHandle=await open(source.full,'r');let header,key,tempHandle,temp;
 try{
   const prefix=Buffer.alloc(MAGIC.length+4);
   if((await inputHandle.read(prefix,0,prefix.length,0)).bytesRead!==prefix.length||!prefix.subarray(0,MAGIC.length).equals(MAGIC))throw invalidArchive();
   const length=prefix.readUInt32BE(MAGIC.length);
   if(length<20||length>MAX_HEADER_BYTES)throw invalidArchive();
   const meta=Buffer.alloc(length);
   if((await inputHandle.read(meta,0,length,prefix.length)).bytesRead!==length)throw invalidArchive();
   let obj;try{obj=JSON.parse(meta.toString('utf8'));}catch{throw invalidArchive();}
   if(!obj||Object.keys(obj).sort().join('|')!=='format|kdf|nonce|salt'||obj.format!=='knowledge-cold-archive-v1'||obj.kdf!=='scrypt-N32768-r8-p1'||!validB64(obj.salt,16)||!validB64(obj.nonce,12))throw invalidArchive();
   const offset=prefix.length+length;
   if(source.size<offset+16)throw invalidArchive();
   const tag=Buffer.alloc(16);
   if((await inputHandle.read(tag,0,16,source.size-16)).bytesRead!==16)throw invalidArchive();
   header=Buffer.concat([prefix,meta]);key=derive(passphrase,Buffer.from(obj.salt,'base64'));
   const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(obj.nonce,'base64'),{authTagLength:16});
   decipher.setAAD(Buffer.concat([AAD,header]));decipher.setAuthTag(tag);
   temp=join(dirname(destination),'.knowledge-restore-'+randomUUID()+'.tmp');
   tempHandle=await open(temp,'wx',0o600);
   // The temporary file must be on a trusted encrypted disk. It is only made
   // accessible at destination after the AEAD tag has been verified.
   for await (const chunk of createReadStream(source.full,{start:offset,end:source.size-17,highWaterMark:64*1024}))await writeAll(tempHandle,decipher.update(chunk));
   await writeAll(tempHandle,decipher.final());
   await tempHandle.sync();await tempHandle.close();tempHandle=null;
   await link(temp,destination); // fail if a destination appears; never overwrite
   await unlink(temp);temp=null;
   return {format:'knowledge-cold-archive-v1',sizeBytes:source.size};
 }catch(error){
   if(tempHandle)await tempHandle.close().catch(()=>{});
   if(temp)await unlink(temp).catch(()=>{});
   if(error instanceof ArchiveError)throw error;
   throw invalidArchive();
 }finally{await inputHandle.close();key?.fill(0);}
}
