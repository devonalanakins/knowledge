/**
 * Knowledge full-content migration from an EXTRACTED official Notion
 * Markdown/CSV export. Original text and copied attachments are preserved.
 * No Notion write API, public repository data, or existing Knowledge DB touch.
 *
 * The private source export must be extracted in an owner-only directory.
 * This builds a NEW private Knowledge instance under a fresh destination.
 * A valid staging result is not permission or final cutover certification.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {
  lstat,readdir,realpath,mkdtemp,mkdir,open,copyFile,chmod,
  rm,rename,writeFile,
} from 'node:fs/promises';
import {basename,dirname,join,relative,resolve,sep} from 'node:path';
import {KnowledgeStore} from './knowledge.mjs';
import {PORTALS} from './wiki-taxonomy.mjs';

const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-f0-9]{32}$/i;
const DOCUMENT=/\.(md|csv|html)$/i;
const MAX_FILES=50000;
const MAX_DOCUMENT_BYTES=16*1024*1024;
const MAX_SINGLE_ASSET=128*1024*1024;
const MAX_TOTAL_ASSETS=1024*1024*1024;
const MAX_DEPTH=40;
const MAX_PATH=1800;
const QUARANTINE={spaceId:'migration-quarantine',portal:'portfolio-infrastructure'};
const PORTALS_BY_ID=new Map(PORTALS.map(x=>[x.id,x]));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=x=>createHash('sha256').update(x).digest('hex');
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function insist(ok,code,message){if(!ok)fail(code,message)}
function cleanId(id){return typeof id==='string'&&ID.test(id)?id.toLowerCase():null}
function idOfName(name){
 const m=/(?:^|[\s_-])([a-f0-9]{32})$/i.exec(name.replace(/\.(md|csv|html)$/i,''));
 return m?m[1].toLowerCase():null;
}
function safeTitle(name){
 const raw=name.replace(/\.(md|csv|html)$/i,'').replace(/[\s_-][a-f0-9]{32}$/i,'').trim();
 return (raw||'Untitled Notion source').slice(0,160);
}
function relPath(value){
 insist(typeof value==='string'&&value.length>0&&value.length<=MAX_PATH&&
   !value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&
   !value.includes('\n')&&!value.includes('\r')&&
   value.split('/').every(x=>x.length>0&&x!=='.'&&x!=='..'),
   'INVALID_EXPORT_PATH','Invalid private Notion export member path');
 return value;
}
function prefixMatch(prefix,path){return prefix==='.'||path===prefix||path.startsWith(prefix+'/')}
export function validateScopeRules(rules){
 insist(Array.isArray(rules)&&rules.length>=1&&rules.length<=40,
  'INVALID_SCOPE_RULES','A reviewed private workspace-to-scope map is required');
 const normalized=[],seen=new Set();
 for(const rule of rules){
  insist(object(rule)&&typeof rule.prefix==='string'&&
    typeof rule.spaceId==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(rule.spaceId)&&
    typeof rule.portal==='string'&&PORTALS_BY_ID.has(rule.portal),
    'INVALID_SCOPE_RULES','Invalid explicit source rule');
  const prefix=rule.prefix==='.'?'.':relPath(rule.prefix);
  insist(!seen.has(prefix)&&rule.spaceId!=='migration-quarantine',
    'INVALID_SCOPE_RULES','Duplicate or reserved scope rule');
  seen.add(prefix);
  // Exact portal scope contracts prevent unreviewed cross-entity visibility.
  const portal=PORTALS_BY_ID.get(rule.portal);
  insist(portal.scopes.includes(rule.spaceId),
    'INVALID_SCOPE_RULES','Portal cannot be assigned to this workspace scope');
  normalized.push({prefix,spaceId:rule.spaceId,portal:rule.portal});
 }
 return normalized.sort((a,b)=>b.prefix.length-a.prefix.length);
}
function ruleFor(path,rules){return rules.find(rule=>prefixMatch(rule.prefix,path))??QUARANTINE}
async function privateNode(path,directory){
 const st=await lstat(path);
 insist((directory?st.isDirectory():st.isFile())&&!st.isSymbolicLink()&&
   (st.mode&0o077)===0&&
   (typeof process.getuid!=='function'||st.uid===process.getuid())&&
   (directory||st.nlink===1),
   'UNSAFE_EXPORT','All export files and directories must be owner-only regular nodes');
 return st;
}
async function digestFile(path,max){
 const first=await privateNode(path,false);
 insist(first.size<=max,'EXPORT_LIMIT_EXCEEDED','Export file exceeds safe import limit');
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const opened=await handle.stat();
  insist(opened.isFile()&&first.dev===opened.dev&&first.ino===opened.ino&&
    opened.size===first.size,'SOURCE_CHANGED','Source inode changed before read');
  const digest=createHash('sha256');
  let length=0;
  for await(const chunk of handle.createReadStream({autoClose:false})){
   length+=chunk.byteLength;
   insist(length<=max,'EXPORT_LIMIT_EXCEEDED','Export file changed beyond size limit');
   digest.update(chunk);
  }
  const after=await handle.stat();
  insist(first.dev===after.dev&&first.ino===after.ino&&
   first.size===after.size&&first.mtimeMs===after.mtimeMs&&length===first.size,
   'SOURCE_CHANGED','Source file changed during inspection');
  return {sha256:digest.digest('hex'),bytes:length};
 }finally{await handle.close()}
}
function parentIdFor(path){
 const segments=dirname(path).split('/');
 for(let i=segments.length-1;i>=0;i--){
  const id=idOfName(segments[i]);
  if(id)return id;
 }
 return null;
}
/** Returns private manifest metadata. Do not log the entries themselves. */
export async function inventoryExtractedNotionExport({sourceDir,rules}={}){
 const base=resolve(sourceDir??'');
 await privateNode(base,true);
 insist(await realpath(base)===base,'UNSAFE_EXPORT','Source root must not resolve through symlinks');
 const scoped=validateScopeRules(rules);
 const entries=[];
 let assetBytes=0;
 async function visit(dir,prefix,depth){
  insist(depth<=MAX_DEPTH,'EXPORT_LIMIT_EXCEEDED','Export directory nesting is too deep');
  await privateNode(dir,true);
  const children=(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  for(const child of children){
   insist(entries.length<MAX_FILES,'EXPORT_LIMIT_EXCEEDED','Export contains too many files');
   const rel=relPath(prefix?prefix+'/'+child.name:child.name);
   const full=join(dir,child.name);
   if(child.isSymbolicLink())fail('UNSAFE_EXPORT','Export must not contain symlinks');
   if(child.isDirectory()){await visit(full,rel,depth+1);continue;}
   insist(child.isFile(),'UNSAFE_EXPORT','Unsupported device or special file in export');
   const extension=DOCUMENT.exec(child.name)?.[1]?.toLowerCase();
   const kind=extension==='md'?'markdown':extension??'asset';
   const digest=await digestFile(full,kind==='asset'?MAX_SINGLE_ASSET:MAX_DOCUMENT_BYTES);
   if(kind==='asset'){
    assetBytes+=digest.bytes;
    insist(assetBytes<=MAX_TOTAL_ASSETS,'EXPORT_LIMIT_EXCEEDED','Notion attachment volume exceeds bounded import capacity');
   }
   const rule=ruleFor(rel,scoped);
   const id=kind==='asset'?null:idOfName(child.name);
   const key=id??hash(Buffer.from(rel,'utf8')).slice(0,32);
   entries.push({relativePath:rel,kind,sha256:digest.sha256,
     bytes:digest.bytes,spaceId:rule.spaceId,portal:rule.portal,
     title:kind==='asset'?null:safeTitle(child.name),
     notionId:id,parentNotionId:kind==='asset'?null:parentIdFor(rel),
     sourceKey:id?'notion:'+id:'path:'+key,slug:key,
     missingNotionId:kind!=='asset'&&!id});
  }
 }
 await visit(base,'',0);
 const sources=entries.filter(x=>x.kind!=='asset');
 insist(sources.length>0,'EMPTY_EXPORT','No source documents in extracted Notion export');
 const ids=new Set(),paths=new Set();
 for(const item of sources){
  insist(!paths.has(item.spaceId+':'+item.slug),
   'DUPLICATE_SOURCE','Source path would collide in one Knowledge workspace');
  paths.add(item.spaceId+':'+item.slug);
  if(item.notionId){
   insist(!ids.has(item.notionId),'DUPLICATE_SOURCE','One Notion source ID has multiple document origins');
   ids.add(item.notionId);
  }
 }
 return {sourceDir:base,entries,sourceCount:sources.length,
   attachmentCount:entries.length-sources.length,
   assetBytes,unmappedCount:entries.filter(x=>x.spaceId===QUARANTINE.spaceId).length,
   missingNotionIds:sources.filter(x=>x.missingNotionId).length,
   databaseExports:sources.filter(x=>x.kind==='csv').length};
}
function linkedNotionIds(text){
 const found=new Set();
 const re=/\]\(([^)\r\n]{1,3000})\)/g;
 for(const match of text.matchAll(re)){
  const href=match[1];
  let decoded;
  try{decoded=decodeURIComponent(href)}catch{decoded=href}
  if(!/\.md(?:[?#]|$)|notion\.so\//i.test(decoded))continue;
  const ids=decoded.match(/[a-f0-9]{32}/gi);
  if(ids?.length)found.add(ids.at(-1).toLowerCase());
 }
 return found;
}
async function safeNewTarget(sourceDir,targetDir){
 const dest=resolve(targetDir??'');
 insist(dest!==resolve(sourceDir)&&
   !dest.startsWith(resolve(sourceDir)+sep)&&
   !resolve(sourceDir).startsWith(dest+sep),
  'UNSAFE_DESTINATION','New Knowledge installation must be outside source export');
 const parent=dirname(dest);
 await privateNode(parent,true);
 insist(await realpath(parent)===parent,'UNSAFE_DESTINATION','Destination parent must be a real owner-only directory');
 try{await lstat(dest);fail('ALREADY_EXISTS','Knowledge destination must not already exist')}
 catch(e){if(e.code!=='ENOENT')throw e}
 return {dest,parent};
}
/**
 * Builds a fresh private instance using a staged sibling directory and
 * atomically renames it into place on the same filesystem.
 * Uses no network; importing never changes original Notion files.
 */
export async function importExtractedNotionExport({
 sourceDir,rules,targetDir,allowPrivateImport=false,
}={}){
 insist(allowPrivateImport===true,'PRIVATE_IMPORT_NOT_AUTHORIZED','Explicit private import approval required');
 const inventory=await inventoryExtractedNotionExport({sourceDir,rules});
 const {dest,parent}=await safeNewTarget(inventory.sourceDir,targetDir);
 const temp=await mkdtemp(join(parent,'.knowledge-notion-import-'));
 await chmod(temp,0o700);
 let store=null,committed=false;
 try{
  const assetsDir=join(temp,'assets');
  await mkdir(assetsDir,{mode:0o700});
  store=new KnowledgeStore(join(temp,'knowledge.sqlite'),
    {maxSpaceTextBytes:1024*1024*1024});
  const byScope=new Map(),byId=new Map();
  const scopes=[...new Set(inventory.entries.map(x=>x.spaceId))].sort();
  for(const scope of scopes){
   store.createSpace(scope,scope==='migration-quarantine'?'Unclassified Notion sources':scope);
  }
  const readOriginal=async item=>{
   const file=join(inventory.sourceDir,...item.relativePath.split('/'));
   const before=await digestFile(file,MAX_DOCUMENT_BYTES);
   insist(before.sha256===item.sha256&&before.bytes===item.bytes,
    'SOURCE_CHANGED','Source document changed since preflight');
   const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{
    const opened=await handle.stat();
    insist(opened.isFile()&&opened.size===before.bytes,
     'SOURCE_CHANGED','Source document size changed before open');
    const bytes=await handle.readFile();
    try{
     const after=await handle.stat();
     insist(bytes.byteLength===before.bytes&&hash(bytes)===before.sha256&&
       after.ino===opened.ino&&after.dev===opened.dev&&
       after.size===opened.size&&after.mtimeMs===opened.mtimeMs,
      'SOURCE_CHANGED','Source document changed during import');
     try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
     catch{fail('INVALID_EXPORT_ENCODING','Source document must be UTF-8')}
    }finally{bytes.fill(0)}
   }finally{await handle.close()}
  };
  const stamp=new Date().toISOString();
  for(const item of inventory.entries.filter(x=>x.kind!=='asset')){
   const content=await readOriginal(item);
   const space=item.spaceId;
   const path=item.portal+'/original-document/'+item.slug;
   const record=store.capturePage(space,{
    path,title:item.title,sourceUrl:item.notionId?
      'https://www.notion.so/'+item.notionId:null,
    body:'Imported original preserved in the private Knowledge source archive. Edit this wiki record to add a current summary.',
   });
   store.db.prepare('INSERT INTO notion_originals(space_id,record_id,source_key,notion_id,original_path,parent_notion_id,source_kind,source_sha256,source_bytes,original_text,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(space,record.id,item.sourceKey,item.notionId,
      item.relativePath,item.parentNotionId,item.kind,item.sha256,item.bytes,content,stamp);
   store.db.prepare('INSERT INTO notion_originals_fts(record_id,original_text) VALUES (?,?)')
    .run(record.id,content);
   if(!byScope.has(space))byScope.set(space,new Map());
   if(item.notionId){byScope.get(space).set(item.notionId,record.id);byId.set(item.notionId,{recordId:record.id,space})}
  }
  // Store references even when cross-scope; only same-scope links become
  // clickable. Cross-scope content is never exposed by auto-linking.
  let resolvedLinks=0,unresolvedLinks=0,crossScopeLinks=0;
  for(const item of inventory.entries.filter(x=>x.kind!=='asset')){
   const recordId=item.notionId?byId.get(item.notionId).recordId:
     store.getPage(item.spaceId,item.portal+'/original-document/'+item.slug).id;
   const content=store.db.prepare('SELECT original_text FROM notion_originals WHERE record_id=?').get(recordId).original_text;
   const references=[...linkedNotionIds(content)].map(id=>({id,kind:'link'}));
   if(item.parentNotionId)references.push({id:item.parentNotionId,kind:'parent'});
   const seen=new Set();
   for(const ref of references){
    if(ref.id===item.notionId||seen.has(ref.kind+':'+ref.id))continue;
    seen.add(ref.kind+':'+ref.id);
    const dest=byId.get(ref.id);
    const target=dest?.space===item.spaceId?dest.recordId:null;
    store.db.prepare('INSERT INTO notion_import_references(from_record_id,target_notion_id,target_record_id,relation_kind) VALUES (?,?,?,?)')
      .run(recordId,ref.id,target,ref.kind);
    if(target){
      try{store.link(item.spaceId,recordId,target,'relates')}catch(e){
       if(!/UNIQUE constraint failed/.test(String(e?.message)))throw e;
      }
      resolvedLinks++;
    }else{
      if(dest)crossScopeLinks++;
      else unresolvedLinks++;
    }
   }
  }
  // Binary attachments are copied to the NEW Knowledge source vault; never
  // referenced through an old Notion URL or a public web directory.
  const copied=new Set();
  for(const item of inventory.entries.filter(x=>x.kind==='asset')){
   const from=join(inventory.sourceDir,...item.relativePath.split('/'));
   const name=item.sha256;
   const to=join(assetsDir,name);
   if(!copied.has(name)){
    await copyFile(from,to,constants.COPYFILE_EXCL);
    await chmod(to,0o600);
    const actual=await digestFile(to,MAX_SINGLE_ASSET);
    insist(actual.sha256===item.sha256&&actual.bytes===item.bytes,
     'SOURCE_CHANGED','Copied attachment integrity check failed');
    const original=await digestFile(from,MAX_SINGLE_ASSET);
    insist(original.sha256===item.sha256&&original.bytes===item.bytes,
     'SOURCE_CHANGED','Original asset changed during copy');
    copied.add(name);
   }
   store.db.prepare('INSERT INTO notion_import_assets(original_path,space_id,sha256,bytes,stored_name) VALUES (?,?,?,?,?)')
     .run(item.relativePath,item.spaceId,item.sha256,item.bytes,name);
  }
  // Verify the completed DB and every asset before publishing the folder.
  const persisted=store.db.prepare('SELECT COUNT(*) AS count FROM notion_originals').get().count;
  const sourceFts=store.db.prepare('SELECT COUNT(*) AS count FROM notion_originals_fts').get().count;
  const assets=store.db.prepare('SELECT COUNT(*) AS count FROM notion_import_assets').get().count;
  insist(persisted===inventory.sourceCount&&sourceFts===persisted&&
    assets===inventory.attachmentCount,
    'IMPORT_RECONCILIATION_FAILED','Imported source count differs from original inventory');
  const report={
   format:'knowledge-notion-full-export-import-v1',mode:'NEW_PRIVATE_KNOWLEDGE_INSTANCE',
   sourceDocuments:inventory.sourceCount,preservedOriginals:persisted,
   attachments:assets,attachmentBytes:inventory.assetBytes,
   matchedReferences:resolvedLinks,unresolvedReferences:unresolvedLinks,
   privateCrossScopeReferences:crossScopeLinks,
   unclassifiedSourceItems:inventory.unmappedCount,
   missingNotionSourceIds:inventory.missingNotionIds,
   csvDatabaseFilesPreserved:inventory.databaseExports,
   classifiedSourcesRequiringReview:inventory.unmappedCount>0,
   originalBodiesPreserved:true,sourceExportUntouched:true,
   importedFromNotionAPI:false,externalNotionReconciliationComplete:false,
   originalNotionHistoryPreserved:false,
   databaseRowsReconstructed:false,sourcePermissionReviewComplete:false,
   encryptedActiveDatabaseVerified:false,
   productionReady:false,cutoverApproved:false,
  };
  store.close();store=null;
  await writeFile(join(temp,'import-report.json'),JSON.stringify(report,null,2)+'\n',
   {flag:'wx',mode:0o600});
  // The destination must still be absent. Failure keeps the previous system intact.
  await safeNewTarget(inventory.sourceDir,dest);
  await rename(temp,dest);
  committed=true;
  return report;
 }finally{
  if(store)store.close();
  if(!committed)await rm(temp,{recursive:true,force:true});
 }
}
