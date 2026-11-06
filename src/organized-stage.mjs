/**
 * G15: reversible synthetic-only Notion Markdown staging with wiki organization.
 * Never use with real personal, family, business, client or clinical material.
 * The source export is read-only; no private production importer is enabled.
 */
import {createHash} from 'node:crypto';
import {lstat,realpath,mkdtemp,chmod,link,rm} from 'node:fs/promises';
import {resolve,dirname,join,relative,sep,isAbsolute} from 'node:path';
import {KnowledgeStore,MAX_CAPTURE_BODY_BYTES} from './knowledge.mjs';
import {readVerifiedNotionMarkdown} from './notion-stage.mjs';
import {planOrganizedMigration} from './organization.mjs';

export const SYNTHETIC_ORGANIZED_ARCHIVE='knowledge-synthetic-organized-archive-v1';
const MARKER='# SYNTHETIC FIXTURE\n';
const MAX_PAGES=20;
const MAX_EDGES=200;
const MAX_BYTES=MAX_CAPTURE_BODY_BYTES;
const UUID=/^[a-f0-9]{32}$/;
const SHA=/^[a-f0-9]{64}$/;
const BASE_KINDS=new Map([['related','relates'],['supports','supports'],
  ['supersedes','supersedes'],['depends','depends']]);
function hash(buffer){return createHash('sha256').update(buffer).digest('hex');}
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function ensure(ok,code,message){if(!ok)fail(code,message);}
function inside(root,target){
 const p=relative(root,target);return p===''||(!p.startsWith('..'+sep)&&p!=='..'&&!isAbsolute(p));
}
function stageSchema(store){
 store.db.exec('CREATE TABLE IF NOT EXISTS synthetic_sources ('+
   'source_id TEXT PRIMARY KEY, scope TEXT NOT NULL, canonical_path TEXT NOT NULL UNIQUE,'+
   'record_id TEXT NOT NULL UNIQUE, source_sha256 TEXT NOT NULL, source_bytes INTEGER NOT NULL,'+
   'source_path TEXT NOT NULL, original_parent_id TEXT, proposed_parent_id TEXT,'+
   'portal TEXT NOT NULL, color TEXT NOT NULL, record_type TEXT NOT NULL,'+
   'lifecycle TEXT NOT NULL, canon_status TEXT, aliases_json TEXT NOT NULL,'+
   'FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE RESTRICT);'+
   'CREATE TABLE IF NOT EXISTS synthetic_edges ('+
   'from_id TEXT NOT NULL REFERENCES synthetic_sources(source_id),'+
   'to_id TEXT NOT NULL REFERENCES synthetic_sources(source_id),'+
   'kind TEXT NOT NULL,PRIMARY KEY(from_id,to_id,kind));');
}
function rows(store,table,order){
 return store.db.prepare('SELECT * FROM '+table+' ORDER BY '+order).all();
}
function verifyStage(store,scope){
 const sources=rows(store,'synthetic_sources','source_id');
 const edges=rows(store,'synthetic_edges','from_id,to_id,kind');
 ensure(sources.length>=1&&sources.length<=MAX_PAGES,'STAGE_INTEGRITY','Invalid source count');
 ensure(edges.length<=MAX_EDGES,'STAGE_INTEGRITY','Excessive relationship count');
 ensure(store.listPages(scope,1000).length===sources.length,'STAGE_INTEGRITY',
   'Every staged wiki page must correspond to exactly one original');
 const byId=new Map(sources.map(s=>[s.source_id,s]));
 ensure(byId.size===sources.length,'STAGE_INTEGRITY','Duplicate original IDs');
 for(const source of sources){
  ensure(UUID.test(source.source_id)&&SHA.test(source.source_sha256) &&
    source.scope===scope,'STAGE_INTEGRITY','Invalid staged source scope/hash');
  const page=store.getPage(scope,source.canonical_path);
  ensure(page && page.id===source.record_id && page.title &&
    page.status==='draft' && page.body.startsWith(MARKER) &&
    Buffer.byteLength(page.body,'utf8')===source.source_bytes &&
    hash(Buffer.from(page.body,'utf8'))===source.source_sha256,
  'STAGE_INTEGRITY','Staged wiki content differs from original synthetic source');
  ensure(Array.isArray(JSON.parse(source.aliases_json)),
    'STAGE_INTEGRITY','Invalid staged alias structure');
 }
 const semantic=new Set();
 for(const e of edges){
  ensure(UUID.test(e.from_id)&&UUID.test(e.to_id)&&e.from_id!==e.to_id&&
    byId.has(e.from_id)&&byId.has(e.to_id)&&
    ['contains','related','supports','supersedes','depends','cites'].includes(e.kind),
    'STAGE_INTEGRITY','Invalid staged relationship');
  if(e.kind==='contains'){
   ensure(byId.get(e.to_id).proposed_parent_id===e.from_id,
     'STAGE_INTEGRITY','Staged hierarchy does not match its relationship graph');
  }
  if(BASE_KINDS.has(e.kind)){
   const from=byId.get(e.from_id).record_id,to=byId.get(e.to_id).record_id;
   semantic.add([from,to,BASE_KINDS.get(e.kind)].join(':'));
  }
 }
 const stored=new Set(store.exportSpace(scope).payload.links.map(l=>[
   l.fromId,l.toId,l.kind].join(':')));
 ensure(stored.size===semantic.size &&
   [...semantic].every(k=>stored.has(k)),
   'STAGE_INTEGRITY','The recoverable backlink graph differs from classified links');
 return {sources,edges};
}
/** Portable recovery envelope. This includes fictional content and is NOT encrypted. */
export function exportSyntheticOrganizedArchive(store,scope){
 const {sources,edges}=verifyStage(store,scope);
 const payload={scope,snapshot:store.exportSpace(scope),sources,edges};
 return {format:SYNTHETIC_ORGANIZED_ARCHIVE,payload,sha256:hash(JSON.stringify(payload))};
}
/** Restore only into a fresh synthetic-only empty KnowledgeStore. */
export function restoreSyntheticOrganizedArchive(store,archive,{syntheticOnly=false}={}){
 ensure(syntheticOnly===true,'PRIVATE_DATA_BLOCKED','Synthetic-only restoration required');
 ensure(archive?.format===SYNTHETIC_ORGANIZED_ARCHIVE &&
   archive.payload && SHA.test(archive.sha256||'') &&
   hash(JSON.stringify(archive.payload))===archive.sha256,
   'INVALID_ARCHIVE','Staging recovery envelope was modified');
 const {scope,snapshot,sources,edges}=archive.payload;
 ensure(typeof scope==='string'&&Array.isArray(sources)&&Array.isArray(edges)&&
   sources.length>=1&&sources.length<=MAX_PAGES&&edges.length<=MAX_EDGES&&
   !store.getSpace(scope),'INVALID_ARCHIVE','Restore needs an empty target');
 // This is only an isolated synthetic target. Never invoke on a live store.
 store.restoreSpace(snapshot);
 stageSchema(store);
 const put=store.db.prepare('INSERT INTO synthetic_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 for(const s of sources){
  const keys=['source_id','scope','canonical_path','record_id','source_sha256','source_bytes',
   'source_path','original_parent_id','proposed_parent_id','portal','color','record_type',
   'lifecycle','canon_status','aliases_json'];
  ensure(Object.keys(s).length===keys.length &&
   keys.every(k=>Object.hasOwn(s,k)),'INVALID_ARCHIVE','Unknown staging metadata');
  put.run(...keys.map(k=>s[k]));
 }
 const edge=store.db.prepare('INSERT INTO synthetic_edges VALUES (?,?,?)');
 for(const e of edges){
  ensure(Object.keys(e).length===3 && ['from_id','to_id','kind'].every(k=>Object.hasOwn(e,k)),
    'INVALID_ARCHIVE','Unknown relationship metadata');
  edge.run(e.from_id,e.to_id,e.kind);
 }
 const restored=exportSyntheticOrganizedArchive(store,scope);
 ensure(restored.sha256===archive.sha256,'STAGE_INTEGRITY','Staged archive could not be recovered exactly');
 return {restored:true,sha256:restored.sha256,sources:sources.length,edges:edges.length};
}
/**
 * Build a brand-new local database under a private destination directory.
 * A failing transaction or source change never replaces an existing target.
 */
export async function stageOrganizedSyntheticNotion({
 root,preflight,inventory,classifications,scope,outputDb,syntheticOnly=false,
 trustedReviewers={},approvalOptions={},
}={}){
 ensure(syntheticOnly===true,'PRIVATE_DATA_BLOCKED','Only fictional fixture staging is enabled');
 ensure(typeof scope==='string'&&typeof outputDb==='string'&&outputDb.trim(),
   'INVALID_INPUT','Explicit scope and output path required');
 const report=planOrganizedMigration({
   preflight,inventory,classifications,trustedReviewers,approvalOptions,
 });
 ensure(report.blockingFindings===0,'ORGANIZATION_BLOCKED','Unresolved organizational findings prevent staging');
 const nodes=report.nodes.filter(n=>n.scope===scope);
 ensure(nodes.length>=1&&nodes.length<=MAX_PAGES,'LIMIT_EXCEEDED','Select one synthetic workspace with 1-20 pages');
 ensure(report.edges.length<=MAX_EDGES,'LIMIT_EXCEEDED','Relationship limit exceeded');
 const originalRoot=resolve(root),dest=resolve(outputDb),parent=dirname(dest);
 ensure(!inside(originalRoot,dest)&&dest!=='/:memory:'&&dest!==originalRoot,
   'UNSAFE_DESTINATION','Destination cannot touch the original export');
 const st=await lstat(parent);
 ensure(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0 &&
   await realpath(parent)===parent &&
   (typeof process.getuid!=='function'||st.uid===process.getuid()),
   'UNSAFE_DESTINATION','Staging directory must be an owner-only real directory');
 try{await lstat(dest);fail('ALREADY_EXISTS','Staging output already exists')}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const originals=new Map();
 for(const node of nodes){
  const source=await readVerifiedNotionMarkdown({
    root,preflight,inventory,scope,originalNotionId:node.id,
  });
  ensure(source.text.startsWith(MARKER) &&
    Buffer.byteLength(source.text,'utf8')<=MAX_BYTES,
    'PRIVATE_DATA_BLOCKED','Only small fictional Markdown bodies may enter staging');
  ensure(source.sha256===node.sourceSha256,'SOURCE_CHANGED','Organizational source hash changed');
  originals.set(node.id,source);
 }
 const temp=await mkdtemp(join(parent,'.knowledge-organized-'));
 let store=null,restored=null;
 try{
  await chmod(temp,0o700);
  const db=join(temp,'wiki.sqlite');
  store=new KnowledgeStore(db);
  store.createSpace(scope,'Synthetic staged '+scope);
  stageSchema(store);
  const recordIds=new Map();
  const put=store.db.prepare('INSERT INTO synthetic_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const node of nodes){
   const source=originals.get(node.id);
   const page=store.capturePage(scope,{path:node.path,title:node.title,
     body:source.text,sourceUrl:node.sourceUrl});
   recordIds.set(node.id,page.id);
   put.run(node.id,scope,node.path,page.id,node.sourceSha256,source.bytes,
     source.relativePath,node.originalParentId,node.parentId,node.portal,node.color,
     node.recordType,node.status,node.canonStatus,JSON.stringify(node.aliases));
  }
  const putEdge=store.db.prepare('INSERT INTO synthetic_edges VALUES (?,?,?)');
  for(const edge of report.edges){
   if(!recordIds.has(edge.from)||!recordIds.has(edge.to))continue;
   putEdge.run(edge.from,edge.to,edge.type);
   const mapped=BASE_KINDS.get(edge.type);
   if(mapped)store.link(scope,recordIds.get(edge.from),recordIds.get(edge.to),mapped);
  }
  const archive=exportSyntheticOrganizedArchive(store,scope);
  restored=new KnowledgeStore();
  restoreSyntheticOrganizedArchive(restored,archive,{syntheticOnly:true});
  restored.close();restored=null;
  store.close();store=null;
  // Recheck originals immediately before publishing the new hardlinked database.
  for(const node of nodes){
   const current=await readVerifiedNotionMarkdown({
    root,preflight,inventory,scope,originalNotionId:node.id,
   });
   ensure(current.sha256===node.sourceSha256,'SOURCE_CHANGED','Original changed before publication');
  }
  await link(db,dest); // atomic create-if-absent, no replacement, source remains unchanged
  return {format:'knowledge-synthetic-organized-stage-v1',
    mode:'SYNTHETIC_FICTIONAL_ONLY',stagedPages:nodes.length,
    stagedRelations:report.edges.filter(e=>recordIds.has(e.from)&&recordIds.has(e.to)).length,
    recoveredSha256:archive.sha256,reviewFindings:report.findings.length,
    originalsPreserved:true,privateDataImported:false,productionReady:false,
    cutoverApproved:false};
 }finally{
  restored?.close();store?.close();
  await rm(temp,{recursive:true,force:true});
 }
}
