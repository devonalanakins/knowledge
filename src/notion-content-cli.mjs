#!/usr/bin/env node
/**
 * G19: encrypt a bounded, explicit Notion page-content capture before disk.
 * PRIVATE source data is never written to public source control or logs.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,realpath,open,writeFile,link,mkdtemp,chmod,rm} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateJson} from './organization-review-cli.mjs';
import {createReadOnlyNotionClient} from './notion-api-source.mjs';
import {captureSelectedNotionContent,NOTION_CONTENT_FORMAT} from './notion-content-export.mjs';
import {capturePaginatedRelationProperties} from './notion-relation-recovery.mjs';
import {encryptSnapshot,decryptSnapshot} from './backup.mjs';

const MAX_ENCRYPTED_INPUT=40_000_000;
const SHA=/^[a-f0-9]{64}$/;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function ensure(ok,code,message){if(!ok)fail(code,message)}
async function protectedDirectory(path){
 const st=await lstat(path);
 ensure(st.isDirectory()&&!st.isSymbolicLink()&&
   (st.mode&0o077)===0&&await realpath(path)===path&&
   (typeof process.getuid!=='function'||st.uid===process.getuid()),
   'UNSAFE_STORAGE','Owner-only real directory required');
}
async function readProtectedEnvelope(file){
 await protectedDirectory(dirname(file));
 const st=await lstat(file);
 ensure(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&
   st.size>=2&&st.size<=MAX_ENCRYPTED_INPUT&&
   (typeof process.getuid!=='function'||st.uid===process.getuid()),
   'UNSAFE_STORAGE','Existing encrypted inventory must be private and bounded');
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
   const before=await fd.stat();
   ensure(before.ino===st.ino&&before.dev===st.dev&&
     before.size===st.size,'SOURCE_CHANGED','Inventory changed before reading');
   const raw=await fd.readFile();
   const after=await fd.stat();
   ensure(after.ino===before.ino&&after.dev===before.dev&&
     before.size===after.size&&before.mtimeMs===after.mtimeMs&&
     raw.byteLength===before.size,'SOURCE_CHANGED','Inventory changed during reading');
   try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))}
   catch{fail('INVALID_ARCHIVE','Encrypted inventory envelope is invalid')}
 }finally{await fd.close()}
}
export function verifyEncryptedNotionContent(envelope,passphrase){
 const saved=decryptSnapshot(envelope,passphrase);
 ensure(saved?.format===NOTION_CONTENT_FORMAT&&SHA.test(saved.archiveSha256||''),
   'INVALID_ARCHIVE','Not a Notion content archive');
 const {archiveSha256,...contents}=saved;
 ensure(hash(contents)===archiveSha256&&
   Array.isArray(saved.pages)&&saved.pages.length>=1&&saved.pages.length<=8&&
   saved.counts?.pages===saved.pages.length&&
   saved.counts.blocks===saved.pages.reduce((n,p)=>n+(p.blocks?.length||0),0)&&
   (saved.counts.resolvedRelationItems===undefined||
     saved.counts.resolvedRelationItems===saved.pages.reduce((total,p)=>total+
       (p.resolvedRelationProperties??[]).reduce((n,relation)=>n+
         (relation.relatedPageIds?.length??0),0),0))&&
   saved.realDataImported===false&&saved.cutoverApproved===false,
   'INVALID_ARCHIVE','Notion content archive failed verification');
 for(const page of saved.pages){
   const {contentSha256,...data}=page;
   ensure(SHA.test(contentSha256||'')&&hash(data)===contentSha256,
     'INVALID_ARCHIVE','Page content checksum mismatch');
   for(const property of page.resolvedRelationProperties??[]){
     const {sha256,...resolved}=property;
     ensure(SHA.test(sha256||'')&&hash(resolved)===sha256&&
       resolved.complete===true&&Array.isArray(resolved.relatedPageIds),
       'INVALID_ARCHIVE','Paginated relation checksum mismatch');
   }
 }
 return {verified:true,format:NOTION_CONTENT_FORMAT,archiveSha256,
   capturedPages:saved.counts.pages,capturedBlocks:saved.counts.blocks,
   pendingReferences:saved.counts.unresolvedReferences,
   realDataImported:false,cutoverApproved:false};
}
/**
 * Input: existing encrypted G18 metadata and explicit 0600 selection file.
 * No Notion/Knowledge mutations. Writes only a new encrypted .enc handoff.
 */
export async function writeEncryptedNotionContent({
 inventoryFile,selectionFile,outputFile,passphrase,token,client=null,
}={}){
 if(typeof inventoryFile!=='string'||!inventoryFile.endsWith('.enc')||
   typeof selectionFile!=='string'||!selectionFile.endsWith('.json')||
   typeof outputFile!=='string'||!outputFile.endsWith('.enc'))
   fail('INVALID_ARGS','Encrypted inventory, private selection and .enc output required');
 const input=resolve(inventoryFile),choice=resolve(selectionFile),dest=resolve(outputFile);
 ensure(input!==dest&&choice!==dest&&input!==choice,
   'UNSAFE_OUTPUT','All paths must be separate');
 await protectedDirectory(dirname(dest));
 try{await lstat(dest);fail('ALREADY_EXISTS','The encrypted output already exists')}
 catch(e){if(e.code!=='ENOENT')throw e}
 const [envelope,selection]=await Promise.all([
   readProtectedEnvelope(input),privateJson(choice),
 ]);
 const inventory=decryptSnapshot(envelope,passphrase);
 ensure(inventory?.format==='knowledge-notion-api-source-metadata-v1',
   'INVALID_INVENTORY','Encrypted G18 Notion API metadata required');
 const api=client??createReadOnlyNotionClient({token});
 const content=await captureSelectedNotionContent({
   client:api,inventory,selection,allowContentCapture:true,
 });
 const encrypted=encryptSnapshot(content,passphrase);
 const recovered=verifyEncryptedNotionContent(encrypted,passphrase);
 ensure(recovered.archiveSha256===content.archiveSha256,
   'ARCHIVE_MISMATCH','Encrypted content recovery check failed');
 const parent=dirname(dest),temp=await mkdtemp(join(parent,'.knowledge-notion-content-'));
 try{
   await chmod(temp,0o700);
   const file=join(temp,'capture.enc');
   await writeFile(file,JSON.stringify(encrypted)+'\n',{mode:0o600,flag:'wx'});
   const persisted=await readProtectedEnvelope(file);
   const validated=verifyEncryptedNotionContent(persisted,passphrase);
   ensure(validated.archiveSha256===content.archiveSha256,
     'ARCHIVE_MISMATCH','Private ciphertext does not restore');
   // Fail closed if the selected originals changed during encryption/write.
   for(const page of content.pages){
     const current=await api.request('/v1/pages/'+page.sourceId);
     ensure(current?.last_edited_time===page.lastEdited&&
       JSON.stringify(current.parent??null)===JSON.stringify(page.parent??null)&&
       current.archived!==true&&current.in_trash!==true,
       'SOURCE_CHANGED','Original Notion page changed before publication');
     // A separate post-seal relation read detects a change to paginated
     // relation items even if page edit metadata has not advanced.
     if(page.resolvedRelationProperties?.length){
       const replay=await capturePaginatedRelationProperties({
         client:api,
         source:{sourceId:page.sourceId,
           unresolvedRelations:page.resolvedRelationProperties.length},
         page:current,enabled:true,
       });
       ensure(JSON.stringify(replay.relations)===
         JSON.stringify(page.resolvedRelationProperties),
         'RELATION_SOURCE_CHANGED','Relations changed before encrypted publication');
     }
   }
   await link(file,dest); // atomic, never clobber an existing destination
   return {...validated,encryptedArchiveWritten:true,
     mediaBytesCaptured:false,sourceCoverageCertified:false,
     productionReady:false};
 }finally{await rm(temp,{recursive:true,force:true})}
}
export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==3)fail('INVALID_ARGS',
   'Usage: notion:api:content ENCRYPTED_INVENTORY.enc PRIVATE_SELECTION.json OUTPUT.enc');
 process.umask(0o077);
 const result=await writeEncryptedNotionContent({
   inventoryFile:args[0],selectionFile:args[1],outputFile:args[2],
   token:env.NOTION_API_TOKEN,passphrase:env.KNOWLEDGE_BACKUP_PASSPHRASE,
 });
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
   const code=typeof error.code==='string'&&/^[A-Z_]{3,50}$/.test(error.code)?
     error.code:'CONTENT_ARCHIVE_FAILED';
   process.stderr.write(code+': Protected read-only capture failed; source not altered\n');
   process.exitCode=1;
 });
}
