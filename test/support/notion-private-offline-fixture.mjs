/**
 * G24 synthetic-only test fixtures. Never add real Notion IDs or credentials.
 */
import {createHash} from 'node:crypto';
import {mkdtemp,chmod,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptSnapshot} from '../../src/backup.mjs';

export const PASSPHRASE='synthetic G24 private vault test passphrase over twenty four characters';
export const PAGE='11111111-1111-1111-1111-111111111111';
export const PAGE2='22222222-2222-2222-2222-222222222222';
const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TS='2026-11-06T12:00:00.000Z';
const PARENT={type:'data_source_id',data_source_id:DS};
const PROPS={Title:{id:'title',type:'title',title:[{
 type:'text',plain_text:'SYNTHETIC SECRET SOURCE ARTICLE',
 text:{content:'SYNTHETIC SECRET SOURCE ARTICLE'},
}]}};
const source=id=>id.replaceAll('-','');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function inventoryOf(ids=[PAGE]){
 const records=ids.map((id,index)=>({
  sourceId:source(id),dataSourceId:source(DS),scope:'anevum',
  register:index===0?'canon-articles':'companion-register',
  lastEdited:TS,parent:PARENT,properties:PROPS,
  sourceUrl:'https://www.notion.so/'+source(id),
  unresolvedRelations:0,archived:false,inTrash:false,
 }));
 const immutable=records.map(x=>({
  id:x.sourceId,source:x.dataSourceId,edited:x.lastEdited,
  scope:x.scope,register:x.register,digest:sha(x.properties),
 })).sort((a,b)=>a.id.localeCompare(b.id));
 return {
  format:'knowledge-notion-api-source-metadata-v1',
  identityFingerprint:sha(immutable),records,uniqueSourceRecords:records.length,
  scope:'EXPLICIT_CONFIG_ONLY',sourceApiVersion:'2025-09-03',
  sourceCoverageCertified:false,sourcePermissionsCertified:false,
 };
}
export function contentOf(inventory,id=PAGE){
 const original=inventory.records.find(r=>r.sourceId===source(id));
 if(!original)throw Error('Synthetic source missing');
 const page={
  sourceId:original.sourceId,scope:original.scope,
  register:original.register,dataSourceId:original.dataSourceId,
  lastEdited:original.lastEdited,parent:original.parent,
  sourceUrl:original.sourceUrl,
  page:{object:'page',id,parent:original.parent,properties:original.properties,
    last_edited_time:TS,icon:null,cover:null},
  blocks:[],resolvedRelationProperties:[],relationPaginationRequests:0,
  warnings:[],referencedNotionIds:[],hierarchyReconstructed:false,
  externalFilesCaptured:false,
 };
 const body={
  format:'knowledge-notion-private-content-batch-v1',
  mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',
  sourceInventoryFingerprint:inventory.identityFingerprint,
  sourceIds:[original.sourceId],
  pages:[{...page,contentSha256:sha(page)}],
  counts:{pages:1,blocks:0,resolvedRelationItems:0,
   capturedAttachmentFiles:0,capturedAttachmentBytes:0,
   unresolvedReferences:0},
  attachments:[],warnings:[],plaintextDiskWritten:false,
  mediaBytesCaptured:false,attachmentCoverageCertified:false,
  externalPermissionsCertified:false,sourceCoverageCertified:false,
  originalHistoryPreserved:false,realDataImported:false,cutoverApproved:false,
 };
 return {...body,archiveSha256:sha(body)};
}
export async function makeSyntheticVault({
 ids=[PAGE],selected=PAGE,captured=PAGE,root=null,
}={}){
 const parent=root??await mkdtemp(join(tmpdir(),'knowledge-g24-'));
 await chmod(parent,0o700);
 const vault=root?join(root,'vault'):parent;
 if(root)await mkdir(vault,{mode:0o700});
 const inventory=inventoryOf(ids);
 const files={
  inventoryFile:join(vault,'inventory.enc'),
  selectionFile:join(vault,'selection.json'),
  contentFile:join(vault,'content.enc'),
  reservedOutputFile:join(vault,'reserved.enc'),
 };
 await writeFile(files.inventoryFile,
   JSON.stringify(encryptSnapshot(inventory,PASSPHRASE))+'\n',
   {mode:0o600,flag:'wx'});
 await writeFile(files.selectionFile,JSON.stringify({
  format:'knowledge-notion-content-selection-v1',
  mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',
  sourceIds:[selected],
 }),{mode:0o600,flag:'wx'});
 await writeFile(files.contentFile,
   JSON.stringify(encryptSnapshot(contentOf(inventory,captured),PASSPHRASE))+'\n',
   {mode:0o600,flag:'wx'});
 return {
  root:parent,vault,...files,
  cleanup:async()=>rm(parent,{recursive:true,force:true}),
 };
}
