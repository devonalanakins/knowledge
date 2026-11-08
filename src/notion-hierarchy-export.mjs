/**
 * Read-only, bounded Notion recovery of selected page/database hierarchies.
 * All private source content is passed only to an owner-local sink.
 * No Notion writes, public logs, or automatic Knowledge production imports.
 */
import {capturePaginatedRelationProperties} from './notion-relation-recovery.mjs';

const ID=/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const SCOPES=new Set(['anevum','devonstation','mizvo','cristy','family','personal','migration-quarantine']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>String(x).replaceAll('-','').toLowerCase();
const valid=x=>typeof x==='string'&&ID.test(x);
function countFileReferences(value){
 let count=0;
 function walk(node){
  if(Array.isArray(node)){for(const item of node)walk(item);return;}
  if(!object(node))return;
  if(node.type==='file'&&object(node.file)&&
   (typeof node.file.url==='string'||node.file.notionSignedDownloadUrlOmitted===true))
   count++;
  for(const child of Object.values(node))walk(child);
 }
 walk(value);return count;
}
function fail(code,message){const e=new Error(message);e.code=code;throw e}
function need(ok,code,message){if(!ok)fail(code,message)}
export function redactNotionFileUrls(value){
 if(Array.isArray(value))return value.map(redactNotionFileUrls);
 if(!object(value))return value;
 const out={};
 for(const [k,v] of Object.entries(value)){
  if(k==='file'&&object(v)&&typeof v.url==='string')
   out[k]={notionSignedDownloadUrlOmitted:true};
  else if(k==='expiry_time'&&typeof value.url==='string')continue;
  else out[k]=redactNotionFileUrls(v);
 }
 return out;
}
export function validateRecoveryRoots(roots){
 need(Array.isArray(roots)&&roots.length>0&&roots.length<=30,
  'INVALID_ROOT_SELECTION','Select one to thirty private Notion roots');
 const seen=new Set();
 return roots.map(item=>{
  need(object(item)&&valid(item.id)&&['page','database'].includes(item.kind)&&
   SCOPES.has(item.scope)&&/^[a-z][a-z0-9-]{2,63}$/.test(item.portal||''),
   'INVALID_ROOT_SELECTION','Invalid root or scope');
  const id=canonical(item.id);
  need(!seen.has(id),'DUPLICATE_ROOT','Repeated Notion root');
  seen.add(id);
  return {id,kind:item.kind,scope:item.scope,portal:item.portal};
 });
}
export async function captureRecoveryHierarchy({client,roots,sink,approved=false}={}){
 need(approved===true,'RECOVERY_NOT_AUTHORIZED','Private read-only capture approval required');
 need(client&&typeof client.request==='function'&&
  sink&&typeof sink.page==='function'&&typeof sink.database==='function',
  'INVALID_CLIENT','Private sink and read-only client required');
 const selected=validateRecoveryRoots(roots);
 const seenPages=new Map(),seenDatabases=new Map();
 const audit={roots:selected.length,pages:0,databases:0,dataSources:0,
  blocks:0,relationsResolved:0,mediaReferencesUncaptured:0,
  unexpandedProperties:0,bytes:0};
 const pageRechecks=[],databaseRechecks=[];
 function budget(x){
  audit.bytes+=Buffer.byteLength(JSON.stringify(x),'utf8');
  need(audit.bytes<=300000000,'SOURCE_LIMIT_EXCEEDED','Source size limit exceeded');
 }
 async function paginate(path,body=null){
  const results=[],cursors=new Set();
  let cursor=null,rounds=0;
  do{
   need(++rounds<=300,'SOURCE_LIMIT_EXCEEDED','Notion pagination limit exceeded');
   const response=body===null?
    await client.request(path+'?page_size=100'+(cursor?'&start_cursor='+cursor:'')):
    await client.request(path,{method:'POST',
     body:{...body,page_size:100,...(cursor?{start_cursor:cursor}:{})}});
   need(object(response)&&Array.isArray(response.results)&&
    response.results.length<=100&&typeof response.has_more==='boolean',
    'INVALID_NOTION_RESPONSE','Invalid Notion response page');
   budget(response);
   results.push(...response.results);
   if(response.has_more){
    const next=response.next_cursor;
    need(typeof next==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(next)&&
     !cursors.has(next)&&response.results.length>0,
     'INVALID_NOTION_CURSOR','Missing or repeated cursor');
    cursors.add(next);cursor=next;
   }else cursor=null;
  }while(cursor);
  return results;
 }
 async function blocksFor(id,depth){
  need(depth<=28,'SOURCE_LIMIT_EXCEEDED','Block nesting too deep');
  const list=await paginate('/v1/blocks/'+canonical(id)+'/children');
  const out=[],ids=new Set();
  for(const block of list){
   need(object(block)&&block.object==='block'&&valid(block.id)&&
    typeof block.type==='string'&&!ids.has(canonical(block.id)),
    'INVALID_NOTION_BLOCK','Malformed or repeated Notion block');
   ids.add(canonical(block.id));
   need(++audit.blocks<=250000,'SOURCE_LIMIT_EXCEEDED','Block count limit exceeded');
   const mediaType=['image','video','audio','pdf','file'].includes(block.type);
   audit.mediaReferencesUncaptured+=Math.max(countFileReferences(block),mediaType?1:0);
   const sanitized=redactNotionFileUrls(block);
   if(block.has_children&&!['child_page','child_database'].includes(block.type))
    sanitized.child_blocks=await blocksFor(block.id,depth+1);
   out.push(sanitized);
  }
  return out;
 }
 function childrenOf(blocks){
  const output=[];
  function walk(items){
   for(const block of items){
    if(block.type==='child_page'||block.type==='child_database')
     output.push({id:canonical(block.id),kind:block.type==='child_page'?'page':'database'});
    if(Array.isArray(block.child_blocks))walk(block.child_blocks);
   }
  }
  walk(blocks);
  return output;
 }
 async function visitPage(id,ctx,depth){
  need(depth<=28&&audit.pages<6000,'SOURCE_LIMIT_EXCEEDED','Page limit exceeded');
  const key=canonical(id),existing=seenPages.get(key);
  if(existing){
   need(existing===ctx.scope,'CROSS_SCOPE_SOURCE','Same page appears in different private scopes');
   return;
  }
  seenPages.set(key,ctx.scope);
  const original=await client.request('/v1/pages/'+key);
  need(original?.object==='page'&&valid(original.id)&&
   canonical(original.id)===key&&object(original.properties)&&
   !original.archived&&!original.in_trash,
   'INVALID_NOTION_PAGE','Page missing, archived or malformed');
  budget(original);
  audit.mediaReferencesUncaptured+=countFileReferences(original);
  audit.unexpandedProperties+=Object.values(original.properties).filter(p=>
   object(p)&&p.has_more===true&&p.type!=='relation').length;
  const pending=Object.values(original.properties).filter(p=>
   object(p)&&p.type==='relation'&&p.has_more===true);
  const rel=pending.length?await capturePaginatedRelationProperties({
   client,page:original,source:{sourceId:key,unresolvedRelations:pending.length},
   enabled:true
  }):{relations:[]};
  audit.relationsResolved+=rel.relations.length;
  const blocks=await blocksFor(key,depth);
  const page=redactNotionFileUrls(original);
  await sink.page({...ctx,id:key,page,blocks,relations:rel.relations});
  audit.pages++;
  pageRechecks.push({id:key,edit:original.last_edited_time,parent:original.parent});
  for(const child of childrenOf(blocks)){
   const next={...ctx,parentId:key,ancestors:[...ctx.ancestors,key]};
   if(child.kind==='page')await visitPage(child.id,next,depth+1);
   else await visitDatabase(child.id,next,depth+1);
  }
 }
 async function visitDatabase(id,ctx,depth){
  need(depth<=28,'SOURCE_LIMIT_EXCEEDED','Database nesting too deep');
  const key=canonical(id),existing=seenDatabases.get(key);
  if(existing){
   need(existing===ctx.scope,'CROSS_SCOPE_SOURCE','Database crossed workspace scope');
   return;
  }
  seenDatabases.set(key,ctx.scope);
  const original=await client.request('/v1/databases/'+key);
  need(original?.object==='database'&&valid(original.id)&&
   canonical(original.id)===key&&Array.isArray(original.data_sources)&&
   original.data_sources.length>0&&original.data_sources.length<=25,
   'INVALID_NOTION_DATABASE','Database or sources unavailable');
  budget(original);
  await sink.database({...ctx,id:key,database:redactNotionFileUrls(original)});
  audit.databases++;
  databaseRechecks.push({id:key,sources:original.data_sources.map(x=>canonical(x.id))});
  for(const dataSource of original.data_sources){
   need(valid(dataSource?.id),'INVALID_NOTION_DATABASE','Invalid data source ID');
   const sourceId=canonical(dataSource.id);
   const source=await client.request('/v1/data_sources/'+sourceId);
   need(source?.object==='data_source'&&canonical(source.id)===sourceId,
    'INVALID_NOTION_DATABASE','Data source metadata mismatch');
   budget(source);
   audit.dataSources++;
   const rows=await paginate('/v1/data_sources/'+sourceId+'/query',{});
   const rowIds=new Set();
   for(const row of rows){
    need(row?.object==='page'&&valid(row.id)&&
     !rowIds.has(canonical(row.id)),
     'INVALID_NOTION_ROW','Invalid or duplicate database row');
    rowIds.add(canonical(row.id));
    await visitPage(row.id,{...ctx,parentId:key,
     ancestors:[...ctx.ancestors,key]},depth+1);
   }
  }
 }
 for(const root of selected){
  const ctx={scope:root.scope,portal:root.portal,rootId:root.id,
   parentId:null,ancestors:[]};
  if(root.kind==='page')await visitPage(root.id,ctx,0);
  else await visitDatabase(root.id,ctx,0);
 }
 for(const previous of pageRechecks){
  const updated=await client.request('/v1/pages/'+previous.id);
  need(updated?.last_edited_time===previous.edit&&
   JSON.stringify(updated?.parent??null)===JSON.stringify(previous.parent??null)&&
   !updated?.archived&&!updated?.in_trash,
   'SOURCE_CHANGED','Notion page changed during recovery');
 }
 for(const previous of databaseRechecks){
  const updated=await client.request('/v1/databases/'+previous.id);
  need(JSON.stringify(updated?.data_sources?.map(x=>canonical(x.id)))===
    JSON.stringify(previous.sources),
   'SOURCE_CHANGED','Notion database source membership changed');
 }
 return {...audit,format:'knowledge-notion-private-hierarchy-v1',
  sourceUnmodified:true,mediaFullyRecovered:audit.mediaReferencesUncaptured===0,
  propertyPaginationComplete:audit.unexpandedProperties===0,
  fullWorkspaceCoverageVerified:false,permissionsVerified:false,
  sourceRevisionHistoryPreserved:false,productionReady:false,
  cutoverApproved:false};
}
