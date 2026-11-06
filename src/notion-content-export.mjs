/**
 * G19: bounded, explicit read-only Notion page-content capture into MEMORY.
 * This is a source archive, not a canonical Knowledge import or permission grant.
 * Never commit returned metadata/page bodies or signed file URLs to GitHub.
 */
import {createHash} from 'node:crypto';

const FORMAT='knowledge-notion-private-content-batch-v1';
const UUID=/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const CURSOR=/^[A-Za-z0-9_-]{1,180}$/;
const LIMITS=Object.freeze({
 pages:8,blocksPerPage:4000,listPagesPerPage:200,depth:12,clearBytes:20_000_000,
});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=id=>String(id).replaceAll('-','').toLowerCase();
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function requireValid(condition,code,message){if(!condition)fail(code,message);}
function validId(x){return typeof x==='string'&&UUID.test(x)}
function safePath(id){return canonical(id)}
function checkPage(page,source){
 requireValid(object(page)&&page.object==='page'&&validId(page.id)&&
   canonical(page.id)===source.sourceId&&
   page.last_edited_time===source.lastEdited&&
   JSON.stringify(page.parent??null)===JSON.stringify(source.parent??null)&&
   page.archived!==true&&page.in_trash!==true,
   'SOURCE_CHANGED','Notion page identity, parent, edit marker or state changed');
}
/**
 * Only ephemeral Notion-hosted signed asset download URLs are elided; ordinary
 * rich-text URLs, mentions, formatting, and original block JSON are preserved.
 * Media file BYTES and true revision/permission histories are not archived.
 */
function withoutExpiringFileUrls(value){
 if(Array.isArray(value))return value.map(withoutExpiringFileUrls);
 if(!object(value))return value;
 const out={};
 for(const [key,child] of Object.entries(value)){
   if(key==='file'&&object(child)&&typeof child.url==='string'){
     out[key]={notionSignedDownloadUrlOmitted:true};
     continue;
   }
   if(key==='expiry_time'&&typeof value.url==='string')continue;
   out[key]=withoutExpiringFileUrls(child);
 }
 return out;
}
function addNotionReferences(value,refs){
 if(Array.isArray(value)){for(const x of value)addNotionReferences(x,refs);return;}
 if(!object(value))return;
 const p=value.mention?.page?.id;
 if(validId(p))refs.add(canonical(p));
 const q=value.link_to_page?.page_id;
 if(validId(q))refs.add(canonical(q));
 const target=value.synced_block?.synced_from?.block_id;
 if(validId(target))refs.add(canonical(target));
 for(const [key,child] of Object.entries(value)){
   if((key==='href'||key==='url')&&typeof child==='string'){
     const match=/https:\/\/(?:www\.)?notion\.so\/(?:[^?#\s]*?[-/])?([0-9a-f]{32})(?:[?#]|$)/i.exec(child);
     if(match)refs.add(match[1].toLowerCase());
   }else if(key!=='mention'&&key!=='link_to_page'&&key!=='synced_block')
     addNotionReferences(child,refs);
 }
}
function validateInventory(inventory,selection){
 requireValid(object(inventory)&&
   inventory.format==='knowledge-notion-api-source-metadata-v1'&&
   Array.isArray(inventory.records)&&
   typeof inventory.identityFingerprint==='string'&&
   /^[0-9a-f]{64}$/.test(inventory.identityFingerprint),
   'INVALID_INVENTORY','An independently collected encrypted G18 inventory is required');
 requireValid(object(selection)&&
   selection.format==='knowledge-notion-content-selection-v1'&&
   selection.mode==='OWNER_SELECTED_READ_ONLY'&&
   selection.scope==='anevum'&&Array.isArray(selection.sourceIds)&&
   selection.sourceIds.length>=1&&selection.sourceIds.length<=LIMITS.pages,
   'INVALID_SELECTION','Select 1–8 explicitly reviewed Anevum page IDs');
 const originalIds=new Set();
 const sources=new Map();
 for(const record of inventory.records){
   if(!validId(record?.sourceId)||!validId(record?.dataSourceId)||
     typeof record.lastEdited!=='string'||!object(record.parent)){
     fail('INVALID_INVENTORY','Stored inventory has invalid source records');
   }
   const key=canonical(record.sourceId);
   if(sources.has(key))fail('DUPLICATE_NOTION_RECORD','Repeated source identity');
   sources.set(key,record);
 }
 const chosen=[];
 for(const id of selection.sourceIds){
   requireValid(validId(id),'INVALID_SELECTION','Invalid selected source ID');
   const key=canonical(id);
   requireValid(!originalIds.has(key),'DUPLICATE_SELECTION','Selected page repeated');
   originalIds.add(key);
   const source=sources.get(key);
   requireValid(source?.scope==='anevum'&&source.archived===false&&
     source.inTrash===false&&object(source.properties)&&
     typeof source.register==='string',
     'SOURCE_SCOPE_BLOCKED','Requested page is inaccessible, archived, or not in the allowed scope');
   requireValid(source.unresolvedRelations===0,'UNRESOLVED_RELATIONS',
     'Selected page has unresolved paginated properties');
   chosen.push(source);
 }
 return chosen;
}
async function collectPage(client,source){
 const page=await client.request('/v1/pages/'+safePath(source.sourceId));
 checkPage(page,source);
 const safePage=withoutExpiringFileUrls({
   id:page.id,parent:page.parent,properties:page.properties,
   icon:page.icon??null,cover:page.cover??null,
   created_time:page.created_time??null,last_edited_time:page.last_edited_time,
 });
 const blocks=[],warnings=[],refs=new Set(),seen=new Set();
 const queue=[{id:source.sourceId,depth:0,parent:null}];
 let loads=0,bytes=Buffer.byteLength(JSON.stringify(safePage),'utf8');
 addNotionReferences(safePage.properties,refs);
 while(queue.length){
   const group=queue.shift();
   let cursor=null,order=0;
   const cursors=new Set();
   do{
     const path='/v1/blocks/'+safePath(group.id)+'/children?page_size=100'+
       (cursor?'&start_cursor='+encodeURIComponent(cursor):'');
     const data=await client.request(path);
     requireValid(object(data)&&Array.isArray(data.results)&&
       typeof data.has_more==='boolean'&&data.results.length<=100,
       'INVALID_CONTENT_RESPONSE','Notion returned an invalid block list');
     loads++;
     requireValid(loads<=LIMITS.listPagesPerPage,'CONTENT_LIMIT_EXCEEDED',
       'Page has too many block-list requests');
     for(const block of data.results){
       requireValid(object(block)&&block.object==='block'&&validId(block.id)&&
         typeof block.type==='string'&&block.type.length>0&&
         typeof block.has_children==='boolean'&&object(block[block.type]),
         'INVALID_CONTENT_RESPONSE','Invalid Notion block structure');
       const id=canonical(block.id);
       requireValid(!seen.has(id),'DUPLICATE_BLOCK','Repeated block ID or cycle');
       seen.add(id);
       requireValid(block.archived!==true&&block.in_trash!==true,
         'ARCHIVED_BLOCK','Archived content needs separate handling');
       const sanitized=withoutExpiringFileUrls(block);
       addNotionReferences(sanitized,refs);
       const entry={id,parentBlockId:group.id,depth:group.depth,order:order++,
         block:sanitized};
       blocks.push(entry);
       bytes+=Buffer.byteLength(JSON.stringify(entry),'utf8');
       requireValid(blocks.length<=LIMITS.blocksPerPage&&bytes<=LIMITS.clearBytes,
         'CONTENT_LIMIT_EXCEEDED','Page exceeds protected capture limits');
       if(block.has_children){
         if(['child_page','child_database'].includes(block.type)){
           warnings.push({code:'CHILD_PAGE_OR_DATABASE_NOT_EXPANDED',blockId:id});
         }else if(block.type==='synced_block'&&block.synced_block?.synced_from){
           warnings.push({code:'REMOTE_SYNCED_BLOCK_NOT_EXPANDED',blockId:id});
         }else{
           requireValid(group.depth<LIMITS.depth,'CONTENT_DEPTH_EXCEEDED',
             'Nested blocks exceed maximum traversal depth');
           queue.push({id,depth:group.depth+1,parent:group.id});
         }
       }
       // File refs survive in metadata, but signed download URLs and bytes do not.
       const details=block[block.type];
       if(['image','video','audio','pdf','file'].includes(block.type)||
         (object(details)&&details.file)||block.type==='link_preview')
         warnings.push({code:'MEDIA_BYTES_NOT_CAPTURED',blockId:id});
     }
     if(data.has_more){
       const next=data.next_cursor;
       requireValid(typeof next==='string'&&CURSOR.test(next)&&!cursors.has(next),
         'INVALID_NOTION_CURSOR','Child-list cursor did not advance');
       cursors.add(next);cursor=next;
     }else cursor=null;
   }while(cursor);
 }
 const latest=await client.request('/v1/pages/'+safePath(source.sourceId));
 checkPage(latest,source);
 const captured={sourceId:source.sourceId,register:source.register,
   scope:source.scope,dataSourceId:source.dataSourceId,
   parent:source.parent,sourceUrl:source.sourceUrl,
   lastEdited:source.lastEdited,page:safePage,blocks,
   referencedNotionIds:[...refs].sort(),warnings,
   hierarchyReconstructed:false,externalFilesCaptured:false};
 return {...captured,contentSha256:sha(captured)};
}
/**
 * The caller chooses a small set of owned/nonclinical Notion pages. No source
 * writes. Returned PRIVATE plaintext must immediately be encrypted and never
 * logged/posted/committed. One archive is not a complete Notion export.
 */
export async function captureSelectedNotionContent({
 client,inventory,selection,allowContentCapture=false,
}={}){
 requireValid(allowContentCapture===true,'CONTENT_CAPTURE_NOT_AUTHORIZED',
   'Explicit private read-only source capture mode required');
 requireValid(client&&typeof client.request==='function',
   'INVALID_CLIENT','Read-only Notion API client required');
 const sources=validateInventory(inventory,selection);
 const pages=[],warnings=[];let totalBlocks=0,bytes=0;
 for(const source of sources){
   const captured=await collectPage(client,source);
   pages.push(captured);
   totalBlocks+=captured.blocks.length;
   bytes+=Buffer.byteLength(JSON.stringify(captured),'utf8');
   requireValid(bytes<=LIMITS.clearBytes,'CONTENT_LIMIT_EXCEEDED',
     'Combined protected capture exceeds safe archive size');
   for(const warning of captured.warnings)warnings.push(warning);
 }
 const body={format:FORMAT,mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',
   sourceInventoryFingerprint:inventory.identityFingerprint,
   sourceIds:pages.map(p=>p.sourceId),pages,
   counts:{pages:pages.length,blocks:totalBlocks,
     unresolvedReferences:warnings.length},
   warnings,plaintextDiskWritten:false,mediaBytesCaptured:false,
   externalPermissionsCertified:false,sourceCoverageCertified:false,
   originalHistoryPreserved:false,realDataImported:false,
   cutoverApproved:false};
 return {...body,archiveSha256:sha(body)};
}
export const NOTION_CONTENT_FORMAT=FORMAT;
