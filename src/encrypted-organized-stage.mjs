/**
 * G16 — synthetic-only encrypted handoff. The complete Knowledge workspace is
 * staged and recovered in memory; only an AES-256-GCM envelope touches disk.
 * This is NOT a production importer, real-data storage approval or online API.
 */
import {constants} from 'node:fs';
import {lstat,realpath,mkdtemp,chmod,open,writeFile,link,rm} from 'node:fs/promises';
import {dirname,resolve,relative,sep,isAbsolute,join} from 'node:path';
import {KnowledgeStore} from './knowledge.mjs';
import {readVerifiedNotionMarkdown} from './notion-stage.mjs';
import {encryptSnapshot,decryptSnapshot} from './backup.mjs';
import {buildSyntheticOrganizedArchiveInMemory,
  restoreSyntheticOrganizedArchive} from './organized-stage.mjs';

const MAX_ENVELOPE_BYTES=40_000_000;
const FORMAT='knowledge-synthetic-encrypted-stage-v1';
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function ensure(ok,code,message){if(!ok)fail(code,message);}
function within(root,target) {
 const p=relative(root,target);
 return p===''||(!p.startsWith('..'+sep)&&p!=='..'&&!isAbsolute(p));
}
async function privateDirectory(directory){
 const st=await lstat(directory);
 ensure(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0 &&
   (typeof process.getuid!=='function'||st.uid===process.getuid()) &&
   await realpath(directory)===directory,
   'UNSAFE_DESTINATION','Destination must be an owner-only real directory');
}
async function readEncryptedFile(filename){
 const st=await lstat(filename);
 ensure(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0 &&
   (typeof process.getuid!=='function'||st.uid===process.getuid()) &&
   st.size>=2&&st.size<=MAX_ENVELOPE_BYTES&&await realpath(filename)===filename,
   'UNSAFE_ENVELOPE','Encrypted stage must be a regular private file');
 const descriptor=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
   const before=await descriptor.stat();
   ensure(before.ino===st.ino&&before.dev===st.dev&&before.size===st.size,
     'SOURCE_CHANGED','Encrypted archive changed during open');
   const bytes=await descriptor.readFile();
   const after=await descriptor.stat();
   ensure(after.ino===before.ino&&after.dev===before.dev&&
     after.size===before.size&&after.mtimeMs===before.mtimeMs&&
     bytes.byteLength===before.size,
     'SOURCE_CHANGED','Encrypted archive changed during read');
   let envelope;
   try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
   catch{fail('INVALID_ENVELOPE','Encrypted archive JSON is invalid');}
   return envelope;
 }finally{await descriptor.close();}
}
/** Decrypt and reconstruct the fictional Knowledge workspace in memory only. */
export function verifyEncryptedSyntheticStage(envelope,passphrase,{syntheticOnly=false}={}){
 ensure(syntheticOnly===true,'PRIVATE_DATA_BLOCKED','Synthetic verification mode is required');
 const archive=decryptSnapshot(envelope,passphrase);
 ensure(archive?.format==='knowledge-synthetic-organized-archive-v1',
   'INVALID_ARCHIVE','Not a synthetic organized archive');
 const recovered=new KnowledgeStore();
 try {
   const r=restoreSyntheticOrganizedArchive(recovered,archive,{syntheticOnly:true});
   return {format:FORMAT,verified:true,archiveSha256:r.sha256,
     stagedPages:r.sources,stagedRelations:r.edges,plaintextDatabaseWritten:false,
     privateDataImported:false,cutoverApproved:false};
 }finally{recovered.close();}
}
/** Read-only owner-local recovery check; never writes or publishes plaintext. */
export async function inspectEncryptedSyntheticStage({
 encryptedFile,passphrase,syntheticOnly=false,
}={}){
 ensure(syntheticOnly===true,'PRIVATE_DATA_BLOCKED','Synthetic verification mode is required');
 ensure(typeof encryptedFile==='string'&&encryptedFile.endsWith('.enc'),
   'INVALID_INPUT','An explicit encrypted archive path is required');
 const file=resolve(encryptedFile);
 await privateDirectory(dirname(file));
 return verifyEncryptedSyntheticStage(await readEncryptedFile(file),passphrase,
   {syntheticOnly:true});
}
/**
 * Export fictional markdown to a new encrypted file. No on-disk SQLite is
 * created; the temporary file already holds ciphertext, never source bodies.
 */
export async function writeEncryptedSyntheticStage({
 root,preflight,inventory,classifications,scope,outputFile,passphrase,
 syntheticOnly=false,trustedReviewers={},approvalOptions={},
}={}){
 ensure(syntheticOnly===true,'PRIVATE_DATA_BLOCKED','Only fictional staging is supported');
 ensure(typeof root==='string'&&root.trim()&&
   typeof outputFile==='string'&&outputFile.endsWith('.enc'),
   'INVALID_INPUT','Explicit source root and encrypted destination required');
 const sourceRoot=resolve(root),destination=resolve(outputFile);
 ensure(!within(sourceRoot,destination)&&destination!==sourceRoot,
   'UNSAFE_DESTINATION','Never write inside the source export');
 const parent=dirname(destination);
 await privateDirectory(parent);
 // No existing output, including symlinks. Hard-link publication never clobbers.
 try{await lstat(destination);fail('ALREADY_EXISTS','Target already exists');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const built=await buildSyntheticOrganizedArchiveInMemory({
   root,preflight,inventory,classifications,scope,syntheticOnly:true,
   trustedReviewers,approvalOptions,
 });
 const envelope=encryptSnapshot(built.archive,passphrase);
 const verification=verifyEncryptedSyntheticStage(envelope,passphrase,{syntheticOnly:true});
 ensure(verification.archiveSha256===built.archive.sha256,
   'STAGE_INTEGRITY','Archive round trip checksum mismatch');
 // The in-memory builder already rechecks every source before sealing. A
 // final independent source check immediately precedes atomic publication.
 const temp=await mkdtemp(join(parent,'.knowledge-encrypted-stage-'));
 try{
   await chmod(temp,0o700);
   const encryptedTemp=join(temp,'stage.enc');
   await writeFile(encryptedTemp,JSON.stringify(envelope)+'\n',{flag:'wx',mode:0o600});
   const fileCheck=await readEncryptedFile(encryptedTemp);
   const result=verifyEncryptedSyntheticStage(fileCheck,passphrase,{syntheticOnly:true});
   ensure(result.archiveSha256===built.archive.sha256,
     'STAGE_INTEGRITY','Encrypted file could not be restored');
   for(const source of built.archive.payload.sources) {
     const latest=await readVerifiedNotionMarkdown({
       root,preflight,inventory,scope,originalNotionId:source.source_id,
     });
     ensure(latest.sha256===source.source_sha256&&
       latest.bytes===source.source_bytes,
       'SOURCE_CHANGED','Original changed after archive encryption');
   }
   // Atomic and no-clobber: only the encrypted envelope reaches the destination.
   await link(encryptedTemp,destination);
   return {...result,encryptedFileWritten:true,originalsPreserved:true,
     stagedPages:built.stagedPages,stagedRelations:built.stagedRelations,
     reviewFindings:built.reviewFindings,productionReady:false};
 }finally{await rm(temp,{recursive:true,force:true});}
}
