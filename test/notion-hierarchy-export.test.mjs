import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,readFile,readdir,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureRecoveryHierarchy,redactNotionFileUrls} from '../src/notion-hierarchy-export.mjs';
import {exportPrivateNotionHierarchy} from '../src/notion-hierarchy-private-cli.mjs';
import {importExtractedNotionExport} from '../src/notion-archive-import.mjs';
import {KnowledgeStore} from '../src/knowledge.mjs';

const A='11111111-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222';
const DB='33333333-3333-3333-3333-333333333333';
const ROW='44444444-4444-4444-4444-444444444444';
const IMAGE='55555555-5555-5555-5555-555555555555';
const BLOCK='66666666-6666-6666-6666-666666666666';
const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const now='2026-11-07T15:00:00.000Z';
const norm=s=>s.replaceAll('-','').toLowerCase();
const child=(id,type,title)=>({object:'block',id,
 type,has_children:true,[type]:{title}});
const page=(id,title,parent=null)=>({object:'page',id,
 parent:parent?{type:'page_id',page_id:parent}:{type:'workspace',workspace:true},
 created_time:now,last_edited_time:now,
 url:'https://www.notion.so/'+norm(id),
 archived:false,in_trash:false,properties:{
 Title:{id:'title',type:'title',title:[{plain_text:title}]},
 }});
const list=(results,has_more=false,next_cursor=null)=>({
 object:'list',results,has_more,next_cursor,
});
const roots=[{id:A,kind:'page',scope:'devonstation',portal:'independent-software'}];
function mock({changeOnSecondRead=false}={}){
 const routes=new Map();
 routes.set('/v1/pages/'+norm(A),page(A,'Root'));
 routes.set('/v1/pages/'+norm(B),page(B,'Child',A));
 routes.set('/v1/pages/'+norm(ROW),page(ROW,'Database Row',DB));
 routes.set('/v1/databases/'+norm(DB),{object:'database',id:DB,
  title:[{plain_text:'Tasks'}],data_sources:[{id:DS,name:'Tasks'}]});
 routes.set('/v1/data_sources/'+norm(DS),{object:'data_source',id:DS});
 routes.set('/v1/blocks/'+norm(A)+'/children?page_size=100',
  list([child(B,'child_page','Child'),child(DB,'child_database','Tasks')],true,'second'));
 routes.set('/v1/blocks/'+norm(A)+'/children?page_size=100&start_cursor=second',
  list([{object:'block',id:BLOCK,type:'paragraph',has_children:false,
   paragraph:{rich_text:[{plain_text:'Actual root text'}]}},
  {object:'block',id:IMAGE,type:'image',has_children:false,
   image:{type:'file',file:{url:'https://file.notion.so/signed?secret=TEST_ONLY',
    expiry_time:'2026-11-07T16:00:00.000Z'}}}]));
 routes.set('/v1/blocks/'+norm(B)+'/children?page_size=100',
  list([{object:'block',id:'77777777-7777-7777-7777-777777777777',
   type:'paragraph',has_children:false,
   paragraph:{rich_text:[{plain_text:'Child body'}]}}]));
 routes.set('/v1/blocks/'+norm(ROW)+'/children?page_size=100',
  list([{object:'block',id:'88888888-8888-8888-8888-888888888888',
   type:'paragraph',has_children:false,
   paragraph:{rich_text:[{plain_text:'Database row original text'}]}}]));
 const calls=[],reads=new Map();
 return {calls,client:{request:async(path,options={})=>{
   calls.push({path,method:options.method||'GET'});
   if(path==='/v1/data_sources/'+norm(DS)+'/query'){
     assert.equal(options.method,'POST');
     assert.equal(options.body.page_size,100);
     return list([page(ROW,'Database Row',DB)]);
   }
   const value=routes.get(path);
   if(!value)throw Error('Unexpected Notion synthetic route '+path);
   if(path.startsWith('/v1/pages/')){
     const read=(reads.get(path)||0)+1;reads.set(path,read);
     const copy=structuredClone(value);
     if(changeOnSecondRead&&path.endsWith(norm(A))&&read===2)
      copy.last_edited_time='2026-11-07T16:00:00Z';
     return copy;
   }
   return structuredClone(value);
 }}};
}
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'knowledge-notion-retirement-'));
 await chmod(dir,0o700);
 const source=join(dir,'roots.json'),dest=join(dir,'recovered');
 await writeFile(source,JSON.stringify({
  format:'knowledge-notion-recovery-roots-v1',roots,
 }),{mode:0o600,flag:'wx'});
 return {dir,source,dest,cleanup:()=>rm(dir,{recursive:true,force:true})};
}
async function withFixture(f){
 const item=await fixture();
 try{await f(item)}finally{await item.cleanup()}
}
test('Read-only recovery walks paginated blocks, child page and database rows',async()=>{
 const api=mock(),saved={pages:[],databases:[]};
 const report=await captureRecoveryHierarchy({
  roots,client:api.client,approved:true,
  sink:{page:async p=>saved.pages.push(p),
   database:async d=>saved.databases.push(d)},
 });
 assert.equal(report.pages,3);
 assert.equal(report.databases,1);
 assert.equal(report.dataSources,1);
 assert.equal(report.mediaReferencesUncaptured,1);
 assert.equal(report.mediaFullyRecovered,false);
 assert.equal(report.cutoverApproved,false);
 assert.equal(saved.pages[0].id,norm(A));
 assert.equal(saved.pages[1].parentId,norm(A));
 assert.equal(saved.pages[2].parentId,norm(DB));
 assert.equal(saved.databases[0].id,norm(DB));
 assert.ok(!JSON.stringify(saved).includes('secret=TEST_ONLY'));
 assert.equal(JSON.stringify(saved).includes('notionSignedDownloadUrlOmitted'),true);
 assert.ok(api.calls.every(call=>call.method==='GET'||
  (call.method==='POST'&&call.path.endsWith('/query'))));
 assert.equal(api.calls.filter(c=>c.path==='/v1/pages/'+norm(A)).length,2);
});
test('Recovery aborts on source edits, absent approval and malformed cursors',async()=>{
 const api=mock({changeOnSecondRead:true});
 await assert.rejects(()=>captureRecoveryHierarchy({
  roots,client:api.client,approved:true,
  sink:{page:async()=>{},database:async()=>{}},
 }),{code:'SOURCE_CHANGED'});
 const nope=mock();
 await assert.rejects(()=>captureRecoveryHierarchy({
  roots,client:nope.client,approved:false,
  sink:{page:async()=>{},database:async()=>{}},
 }),{code:'RECOVERY_NOT_AUTHORIZED'});
 assert.equal(nope.calls.length,0);
});
test('Private output contains correct Markdown hierarchy and source JSON, no temporary signed URLs',
 ()=>withFixture(async fx=>{
 const api=mock();
 const report=await exportPrivateNotionHierarchy({
  configFile:fx.source,targetDir:fx.dest,client:api.client,
  allowPrivateRecovery:true,encryptedHostStorageReviewed:true,
 });
 assert.equal(report.pages,3);
 assert.equal(report.sourceDocumentsWritten,4);
 assert.equal(report.sourceUnmodified,true);
 assert.equal(report.cutoverApproved,false);
 const prefix=join(fx.dest,'devonstation','independent-software-'+norm(A)+'-source');
 const root=join(prefix,'Root '+norm(A)+'.md');
 const rootContent=await readFile(root,'utf8');
 assert.ok(rootContent.includes('Actual root text'));
 assert.ok(rootContent.includes('Original Notion properties'));
 const childContent=await readFile(join(prefix,'Root '+norm(A),
  'Child '+norm(B)+'.md'),'utf8');
 assert.ok(childContent.includes('Child body'));
 const row=await readFile(join(prefix,'Root '+norm(A),
  'Tasks '+norm(DB),'Database Row '+norm(ROW)+'.md'),'utf8');
 assert.ok(row.includes('Database row original text'));
 const raw=await readFile(join(prefix,'Root '+norm(A)+'.notion.json'),'utf8');
 assert.ok(!raw.includes('TEST_ONLY'));
 assert.ok(raw.includes('notionSignedDownloadUrlOmitted'));
 assert.equal((await lstat(root)).mode&0o077,0);
 const map=JSON.parse(await readFile(join(fx.dest,'scope-map.json'),'utf8'));
 assert.equal(map.rules[0].prefix,'devonstation/independent-software-'+norm(A)+'-source');
 const entries=await readdir(fx.dir);
 assert.deepEqual(entries.sort(),['recovered','roots.json']);
 }));
test('Private recovery output is importable as an isolated Knowledge wiki',
 ()=>withFixture(async fx=>{
 const api=mock();
 await exportPrivateNotionHierarchy({
  configFile:fx.source,targetDir:fx.dest,client:api.client,
  allowPrivateRecovery:true,encryptedHostStorageReviewed:true,
 });
 const config=JSON.parse(await readFile(join(fx.dest,'scope-map.json'),'utf8'));
 const destination=join(fx.dir,'knowledge-new');
 const result=await importExtractedNotionExport({
  sourceDir:fx.dest,targetDir:destination,rules:config.rules,
  allowPrivateImport:true,
 });
 assert.equal(result.sourceDocuments,4);
 assert.equal(result.preservedOriginals,4);
 assert.ok(result.attachments>=4);
 const store=new KnowledgeStore(join(destination,'knowledge.sqlite'));
 try{
  const found=store.searchPages('devonstation','Actual root text');
  assert.ok(found.length>=1);
  const root=store.getPage('devonstation',
   'independent-software/original-document/'+norm(A));
  assert.ok(root.body.includes('Actual root text'));
  const preserved=store.getNotionOriginal('devonstation',root.path);
  assert.equal(preserved.notion_id,norm(A));
  const child=store.getPage('devonstation',
   'independent-software/original-document/'+norm(B));
  assert.equal(child.hasOriginal,true);
  assert.equal(preserved.parent_notion_id,null);
  assert.equal(store.getNotionOriginal('devonstation',child.path).parent_notion_id,norm(A));
 }finally{store.close()}
 }));
test('Private recovery rejects existing destination, unsafe selection and incomplete provider reads',
 ()=>withFixture(async fx=>{
 await writeFile(fx.dest,'not allowed',{mode:0o600});
 const api=mock();
 await assert.rejects(()=>exportPrivateNotionHierarchy({
  configFile:fx.source,targetDir:fx.dest,client:api.client,
  allowPrivateRecovery:true,encryptedHostStorageReviewed:true,
 }),{code:'ALREADY_EXISTS'});
 assert.equal(api.calls.length,0);
 await rm(fx.dest);
 await chmod(fx.source,0o644);
 await assert.rejects(()=>exportPrivateNotionHierarchy({
  configFile:fx.source,targetDir:fx.dest,client:api.client,
  allowPrivateRecovery:true,encryptedHostStorageReviewed:true,
 }));
 assert.equal(api.calls.length,0);
 }));
test('Redaction removes expiring Notion file URL without mutating source',()=>{
 const raw={type:'file',file:{url:'https://file.notion.so/secret',
  expiry_time:'2026-11-07T16:00:00Z'}};
 const cleaned=redactNotionFileUrls(raw);
 assert.equal(cleaned.file.notionSignedDownloadUrlOmitted,true);
 assert.equal(raw.file.url,'https://file.notion.so/secret');
});

test('Provisional owner scope maps are not executable and make no API requests',
 ()=>withFixture(async fx=>{
 await writeFile(fx.source,JSON.stringify({
  format:'knowledge-notion-recovery-roots-v1',
  scopeReviewStatus:'PROVISIONAL_OWNER_REVIEW_REQUIRED',roots,
 }),{mode:0o600});
 const api=mock();
 await assert.rejects(()=>exportPrivateNotionHierarchy({
  configFile:fx.source,targetDir:fx.dest,
  client:api.client,allowPrivateRecovery:true,
  encryptedHostStorageReviewed:true,
 }),{code:'SCOPE_REVIEW_REQUIRED'});
 assert.deepEqual(api.calls,[]);
 await assert.rejects(()=>lstat(fx.dest),{code:'ENOENT'});
 }));
test('Media in page properties is counted even without media blocks',async()=>{
 const root={...page(A,'Root'),properties:{
  Title:{id:'title',type:'title',title:[{plain_text:'Root'}]},
  Files:{id:'files',type:'files',files:[
   {type:'file',file:{url:'https://file.notion.so/signed?secret=FILE',
    expiry_time:'2026-11-07T16:00:00Z'}},
  ]},
 }};
 const seen=[];
 const client={request:async(path)=>{
  if(path==='/v1/pages/'+norm(A))return structuredClone(root);
  if(path==='/v1/blocks/'+norm(A)+'/children?page_size=100')
   return list([]);
  throw Error('Unexpected synthetic path');
 }};
 const report=await captureRecoveryHierarchy({
  roots,approved:true,client,sink:{
   page:async x=>seen.push(x),database:async()=>{},
  },
 });
 assert.equal(report.pages,1);
 assert.equal(report.mediaReferencesUncaptured,1);
 assert.equal(report.mediaFullyRecovered,false);
 assert.ok(!JSON.stringify(seen).includes('secret=FILE'));
 });
