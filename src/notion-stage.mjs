/**
 * G6: verified, deliberately limited Notion SOURCE READER + synthetic-only wiki staging.
 * This is NOT a production importer and never copies original page text into the wiki.
 * Caller-supplied metadata is untrusted until independently checked against the files.
 */
import { constants, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, mkdtemp, chmod, link, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative, sep, isAbsolute } from 'node:path';
import { KnowledgeStore } from './knowledge.mjs';
import { ExportInspectionError } from './notion-export.mjs';

const ID=/^[a-f0-9]{32}$/i;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/i;
const ALLOWED_SCOPES=new Set(['personal','family','devonstation','anevum','cristy','mizvo','external']);
const MAX_PILOT=20;
const MAX_SINGLE_FILE=1024*1024;
function fail(code, message){throw new ExportInspectionError(code,message);}
function isObject(x){return x!==null && typeof x==='object' && !Array.isArray(x);}
function normalizedId(id){
 if(typeof id!=='string')fail('INVALID_SELECTION','Expected Notion ID');
 const normalized=id.toLowerCase().replaceAll('-','');
 if(!ID.test(normalized)||!(ID.test(id)||UUID.test(id)))fail('INVALID_SELECTION','Malformed Notion ID');
 return normalized;
}
function safeRel(p){
 if(typeof p!=='string'||p.length===0||p.length>2048||p.includes('\\')||p.includes('\0')||p.includes('\r')||p.includes('\n')||isAbsolute(p))fail('UNSAFE_SOURCE','Invalid archive member path');
 const parts=p.split('/');
 if(parts.some(v=>!v||v==='.'||v==='..'||v.includes(':')))fail('UNSAFE_SOURCE','Unsafe archive member path');
 return parts;
}
function inRoot(root,other){const r=relative(root,other);return r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);}
function nameFromPath(p,id){
 const name=basename(p).replace(/\.md$/i,'').replace(new RegExp('[ _-]'+id+'$','i'),'').trim();
 return (name||'Untitled Notion page').slice(0,140);
}
function preflightEntry(preflight,id){
 if(!isObject(preflight)||preflight.format!=='knowledge-notion-preflight-v1'||!Array.isArray(preflight.entries)||preflight.entries.length>100000)
  fail('INVALID_PREFLIGHT','Expected bounded Notion export preflight');
 const matching=preflight.entries.filter(e=>isObject(e)&&e.originalNotionId&&normalizedId(e.originalNotionId)===id);
 if(matching.length!==1)fail('AMBIGUOUS_SOURCE','Original ID is missing or duplicated in the export');
 const entry=matching[0];
 if(entry.type!=='markdown'||!SHA.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>MAX_SINGLE_FILE||entry.missingLocalLinks!==0||entry.remoteNotionLinks!==0)
  fail('UNVERIFIED_SOURCE','Only one fully linked small Markdown original may be staged');
 safeRel(entry.relativePath);
 return entry;
}
function inventoryEntry(inventory,id,scope){
 if(!isObject(inventory)||inventory.format!=='knowledge-notion-inventory-v1'||!Array.isArray(inventory.records)||inventory.records.length>100000)
  fail('INVALID_INVENTORY','Expected independently collected Notion ID inventory');
 const matching=inventory.records.filter(r=>isObject(r)&&r.id&&normalizedId(r.id)===id);
 if(matching.length!==1)fail('AMBIGUOUS_ID','Missing or duplicate inventory record');
 const record=matching[0];
 if(record.kind!=='page'||record.accessible!==true||record.scope!==scope)
  fail('SCOPE_DENIED','Page is inaccessible, in another scope, or not a page');
 return record;
}

/** Planning produces metadata ONLY. Caller must independently authenticate its inputs. */
export function planNotionSyntheticStage({preflight,inventory,scope,selectedIds}){
 if(!ALLOWED_SCOPES.has(scope))fail('SCOPE_DENIED','Explicit supported scope required');
 if(!Array.isArray(selectedIds)||selectedIds.length===0||selectedIds.length>MAX_PILOT)
  fail('INVALID_SELECTION','Select 1–20 explicit original Notion page IDs');
 const seen=new Set(), items=[];
 for(const rawId of selectedIds){
  const id=normalizedId(rawId);
  if(seen.has(id))fail('INVALID_SELECTION','Duplicate staged source ID');
  seen.add(id);
  inventoryEntry(inventory,id,scope);
  const entry=preflightEntry(preflight,id);
  items.push({originalNotionId:id,scope,sourcePath:entry.relativePath,sourceSha256:entry.sha256.toLowerCase(),sourceBytes:entry.bytes,title:nameFromPath(entry.relativePath,id),wikiPath:'notion/'+id});
 }
 return {format:'knowledge-notion-stage-plan-v1',status:'PREVIEW_ONLY',sourceCoverageCertified:false,privateDataApproved:false,items};
}

/**
 * Authorize reading by the separately classified source inventory, then verify
 * stored hash, size, path and UTF-8. No serving endpoint; caller must protect the returned text.
 */
export async function readVerifiedNotionMarkdown({root,preflight,inventory,scope,originalNotionId}){
 const plan=planNotionSyntheticStage({preflight,inventory,scope,selectedIds:[originalNotionId]});
 const entry=plan.items[0];
 const base=resolve(root);
 const rootStat=await lstat(base);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||await realpath(base)!==base)
  fail('UNSAFE_SOURCE','Original root must be a real directory, never a symlink');
 const parts=safeRel(entry.sourcePath);
 let walk=base;
 for(const part of parts.slice(0,-1)){
  walk=join(walk,part);const st=await lstat(walk);
  if(!st.isDirectory()||st.isSymbolicLink()||!inRoot(base,walk)||!inRoot(base,await realpath(walk)))fail('UNSAFE_SOURCE','Unsafe parent directory');
 }
 const full=join(base,...parts);
 if(!inRoot(base,full))fail('UNSAFE_SOURCE','Source escapes root');
 const leaf=await lstat(full);
 if(!leaf.isFile()||leaf.isSymbolicLink())fail('UNSAFE_SOURCE','Source leaf must be a regular file');
 const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await handle.stat();
  if(!before.isFile()||before.size!==entry.sourceBytes||before.size>MAX_SINGLE_FILE)fail('SOURCE_CHANGED','Source metadata changed');
  // Read by the already-open descriptor, not a path that could be substituted.
  const chunks=[];let bytes=0;const hash=createHash('sha256');
  for await (const chunk of handle.createReadStream({autoClose:false,highWaterMark:64*1024})){
    bytes+=chunk.length;if(bytes>MAX_SINGLE_FILE||bytes>entry.sourceBytes)fail('SOURCE_CHANGED','Source grew during read');
    hash.update(chunk);chunks.push(chunk);
  }
  const after=await handle.stat();
  if(bytes!==entry.sourceBytes||before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||hash.digest('hex')!==entry.sourceSha256)
   fail('SOURCE_CHANGED','Original source hash or attributes changed since inspection');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}
  catch{fail('INVALID_ENCODING','Invalid original Markdown text');}
  return {originalNotionId:entry.originalNotionId,scope,relativePath:entry.sourcePath,sha256:entry.sourceSha256,bytes,text};
 }finally{await handle.close();}
}

/**
 * G6 gated demonstration: build a new independent, read-only-to-consumers wiki
 * INDEX of explicitly selected synthetic pages. It never imports page bodies.
 * The full original remains in protected cold storage, with retrieval still gated.
 */
export async function stageSyntheticNotionIndex({root,preflight,inventory,scope,selectedIds,outputDb,syntheticOnly=false}){
 if(syntheticOnly!==true)fail('PRIVATE_DATA_BLOCKED','Only an explicitly synthetic staging pilot is enabled');
 const plan=planNotionSyntheticStage({preflight,inventory,scope,selectedIds});
 if(typeof outputDb!=='string'||!outputDb.trim()||outputDb===':memory:')fail('UNSAFE_DESTINATION','Output must be a new local database path');
 const dest=resolve(outputDb),base=resolve(root);
 if(dest===base||inRoot(base,dest))fail('UNSAFE_DESTINATION','Never write a staging database inside the source export');
 const parent=dirname(dest),parentStat=await lstat(parent);
 if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||await realpath(parent)!==parent)
  fail('UNSAFE_DESTINATION','Output parent must be a trusted real directory');
 try{await lstat(dest);fail('ALREADY_EXISTS','Staging target already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 // Verify every original and a synthetic-only marker before writing any SQLite data.
 for(const item of plan.items){
  const original=await readVerifiedNotionMarkdown({root,preflight,inventory,scope,originalNotionId:item.originalNotionId});
  if(!original.text.startsWith('# SYNTHETIC FIXTURE\n'))fail('PRIVATE_DATA_BLOCKED','No real Notion content may enter the staging preview');
 }
 const tempDir=await mkdtemp(join(parent,'.knowledge-stage-'));
 let store;
 try{
  await chmod(tempDir,0o700);
  const db=join(tempDir,'index.sqlite');store=new KnowledgeStore(db);store.createSpace(scope,'Synthetic '+scope+' index');
  for(const item of plan.items){
   const body=[
    'Archived Notion source — metadata-only demonstration.',
    'Original Notion ID: '+item.originalNotionId,
    'Original SHA-256: '+item.sourceSha256,
    'Original archive member: '+item.sourcePath,
    'CONTENT NOT IMPORTED. ARCHIVE RETRIEVAL NOT YET APPROVED.',
    'Permission scope: '+scope,
   ].join('\n');
   store.capturePage(scope,{path:item.wikiPath,title:item.title,body});
  }
  store.close();store=null;
  await link(db,dest); // atomic no-clobber: existing destinations are never overwritten
  return {format:'knowledge-notion-stage-result-v1',mode:'SYNTHETIC_METADATA_ONLY',scope,stagedPages:plan.items.length,originalsPreserved:true,sourceCoverageCertified:false,privateDataImported:false,databasePath:dest};
 }finally{if(store)store.close();await rm(tempDir,{recursive:true,force:true});}
}
