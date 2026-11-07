import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,chmod,writeFile,readFile,readdir,symlink,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {KnowledgeStore} from '../src/knowledge.mjs';
import {createKnowledgeServer} from '../src/server.mjs';
import {
 inventoryExtractedNotionExport,importExtractedNotionExport,validateScopeRules,
} from '../src/notion-archive-import.mjs';

const A='11111111111111111111111111111111';
const B='22222222222222222222222222222222';
const C='33333333333333333333333333333333';
const D='44444444444444444444444444444444';
const E='55555555555555555555555555555555';
const F='66666666666666666666666666666666';
const CLI=fileURLToPath(new URL('../src/notion-archive-import-cli.mjs',import.meta.url));
const RAW='# Original document\n\nA full-length uniqueTermDeep source.\n'+
 'A'.repeat(125_000)+'\n[Same scope](Next%20'+C+'.md)\n'+
 '[Cross scope](https://www.notion.so/'+D+')\n';
const hash=value=>createHash('sha256').update(value).digest('hex');
const rules=[
 {prefix:'Anevum '+A,spaceId:'anevum',portal:'anevum-works'},
 {prefix:'Professional '+D,spaceId:'cristy',portal:'cristy-professional'},
];
async function writePrivate(file,content){
 await writeFile(file,content,{mode:0o600,flag:'wx'});
}
async function fixture(){
 const home=await mkdtemp(join(tmpdir(),'knowledge-private-migration-'));
 await chmod(home,0o700);
 const root=join(home,'notion-source');
 await mkdir(root,{mode:0o700});
 const a=join(root,'Anevum '+A);
 const b=join(root,'Professional '+D);
 const assetFolder=join(a,'assets');
 await mkdir(a,{mode:0o700});await mkdir(b,{mode:0o700});
 await mkdir(assetFolder,{mode:0o700});
 await writePrivate(join(a,'Original '+B+'.md'),RAW);
 await writePrivate(join(a,'Next '+C+'.md'),'# Next record\n\nA second original');
 await writePrivate(join(a,'Source database '+E+'.csv'),'Title,Status\nProject,Active\n');
 await writePrivate(join(assetFolder,'logo.png'),Buffer.from('synthetic binary attachment'));
 await writePrivate(join(b,'Professional '+D+'.md'),
  '# Fictional professional document\nNo patient content');
 await writePrivate(join(root,'Unknown '+F+'.md'),'# Unclassified private source');
 const config=join(home,'mapping.json');
 await writePrivate(config,JSON.stringify({
  format:'knowledge-notion-scope-map-v1',rules,
 }));
 return {home,root,a,b,config,
  target:join(home,'knowledge-new'),
  cleanup:()=>rm(home,{force:true,recursive:true})};
}
async function withFixture(fn){
 const fx=await fixture();
 try{return await fn(fx)}finally{await fx.cleanup()}
}
const load=fx=>importExtractedNotionExport({
 sourceDir:fx.root,targetDir:fx.target,rules,allowPrivateImport:true,
});
test('Full import preserves long immutable original content, CSV, binary assets and private scopes',
 ()=>withFixture(async fx=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Notion migration must be offline')};
 try{
  const result=await load(fx);
  assert.equal(result.sourceDocuments,5);
  assert.equal(result.preservedOriginals,5);
  assert.equal(result.attachments,1);
  assert.equal(result.csvDatabaseFilesPreserved,1);
  assert.equal(result.unclassifiedSourceItems,1);
  assert.equal(result.originalBodiesPreserved,true);
  assert.equal(result.databaseRowsReconstructed,false);
  assert.equal(result.encryptedActiveDatabaseVerified,false);
  assert.equal(result.productionReady,false);
  assert.equal(result.cutoverApproved,false);
  assert.ok((await lstat(fx.target)).isDirectory());
  const store=new KnowledgeStore(join(fx.target,'knowledge.sqlite'));
  try{
   const original=store.getPage('anevum','anevum-works/original-document/'+B);
   assert.ok(original);
   assert.equal(original.body,RAW);
   assert.equal(original.hasOriginal,true);
   assert.equal(original.version,1);
   const archived=store.getNotionOriginal('anevum',original.path);
   assert.equal(archived.original_text,RAW);
   assert.equal(archived.source_sha256,hash(Buffer.from(RAW)));
   assert.equal(archived.parent_notion_id,A);
   assert.equal(store.searchPages('anevum','uniqueTermDeep')[0].id,original.id);
   assert.equal(store.getPage('cristy','anevum-works/original-document/'+B),null);
   const refs=store.db.prepare('SELECT * FROM notion_import_references WHERE from_record_id=?').all(original.id);
   assert.ok(refs.some(x=>x.target_notion_id===C&&x.target_record_id!==null));
   assert.ok(refs.some(x=>x.target_notion_id===D&&x.target_record_id===null));
   assert.ok(store.getLinkedPages('anevum',original.path).some(x=>x.direction==='outgoing'));
   const edited=store.updateRecord('anevum',original.id,1,{body:'Owner-edited current summary'});
   assert.equal(edited.version,2);
   assert.equal(store.getPage('anevum',original.path).body,'Owner-edited current summary');
   assert.equal(store.getNotionOriginal('anevum',original.path).original_text,RAW);
   assert.throws(()=>store.db.prepare('DELETE FROM notion_originals WHERE record_id=?').run(original.id));
   const item=store.db.prepare('SELECT * FROM notion_import_assets').get();
   assert.equal(item.bytes,Buffer.byteLength('synthetic binary attachment'));
   assert.equal((await readFile(join(fx.target,'assets',item.stored_name),'utf8')),
     'synthetic binary attachment');
  }finally{store.close()}
  assert.equal((await readFile(join(fx.a,'Original '+B+'.md'),'utf8')),RAW);
 }finally{globalThis.fetch=originalFetch}
 }));
test('Importer refuses existing destinations and source changes without partial publication',
 ()=>withFixture(async fx=>{
 await mkdir(fx.target,{mode:0o700});
 await assert.rejects(()=>load(fx),{code:'ALREADY_EXISTS'});
 await rm(fx.target,{recursive:true});
 await symlink(join(fx.a,'Next '+C+'.md'),join(fx.a,'private-link.md'));
 await assert.rejects(()=>load(fx),{code:'UNSAFE_EXPORT'});
 await assert.rejects(()=>lstat(fx.target),{code:'ENOENT'});
 }));
test('Duplicate Notion source identifiers fail before creating a Knowledge destination',
 ()=>withFixture(async fx=>{
 await writePrivate(join(fx.a,'Other '+B+'.md'),'# duplicated source ID');
 await assert.rejects(()=>load(fx),{code:'DUPLICATE_SOURCE'});
 await assert.rejects(()=>lstat(fx.target),{code:'ENOENT'});
 }));
test('Import policy is explicit and a scope portal cannot be used across entities',
 ()=>withFixture(async fx=>{
 assert.throws(()=>validateScopeRules([
  {prefix:'Anevum',spaceId:'cristy',portal:'anevum-works'},
 ]),{code:'INVALID_SCOPE_RULES'});
 await assert.rejects(()=>importExtractedNotionExport({
  sourceDir:fx.root,targetDir:fx.target,rules,allowPrivateImport:false,
 }),{code:'PRIVATE_IMPORT_NOT_AUTHORIZED'});
 await assert.rejects(()=>lstat(fx.target),{code:'ENOENT'});
 }));
test('Owner-only source constraints refuse world-readable export nodes',
 ()=>withFixture(async fx=>{
 await chmod(join(fx.a,'Original '+B+'.md'),0o644);
 await assert.rejects(()=>inventoryExtractedNotionExport({
  sourceDir:fx.root,rules,
 }),{code:'UNSAFE_EXPORT'});
 await assert.rejects(()=>lstat(fx.target),{code:'ENOENT'});
 }));
test('Protected import CLI writes a private new destination and suppresses source titles in stdout',
 ()=>withFixture(async fx=>{
 const denied=spawnSync(process.execPath,[CLI,fx.root,fx.config,fx.target],{
  encoding:'utf8',env:{...process.env,KNOWLEDGE_PRIVATE_EXPORT_IMPORT:''},
 });
 assert.notEqual(denied.status,0);
 assert.equal(denied.stdout,'');
 const approved=spawnSync(process.execPath,[CLI,fx.root,fx.config,fx.target],{
  encoding:'utf8',env:{...process.env,
   KNOWLEDGE_PRIVATE_EXPORT_IMPORT:'I_APPROVE',
   KNOWLEDGE_PRIVATE_STORAGE_REVIEWED:'ENCRYPTED_AND_PRIVATE'},
 });
 assert.equal(approved.status,0,approved.stderr);
 assert.equal(JSON.parse(approved.stdout).preservedOriginals,5);
 assert.ok(!approved.stdout.includes('Original document'));
 assert.ok(!approved.stdout.includes(B));
 assert.ok(!approved.stderr.includes('Original document'));
 assert.ok(!approved.stderr.includes(B));
 assert.ok(!approved.stderr.includes('synthetic binary attachment'));
 assert.equal((await lstat(join(fx.target,'knowledge.sqlite'))).mode&0o077,0);
 assert.deepEqual((await readdir(fx.target)).sort(),
  ['assets','import-report.json','knowledge.sqlite']);
 }));

test('Imported Notion originals are owner-readable and never publicly available by URL',
 ()=>withFixture(async fx=>{
 await load(fx);
 const store=new KnowledgeStore(join(fx.target,'knowledge.sqlite'));
 const server=createKnowledgeServer(store,{
  ownerToken:'o'.repeat(36),agentToken:'a'.repeat(36),space:'anevum',
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const url=base+'/original/anevum/anevum-works/original-document/'+B;
  const anon=await fetch(url,{redirect:'manual'});
  assert.equal(anon.status,303);
  assert.equal(anon.headers.get('location'),'/login');
  const login=await fetch(base+'/login',{method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({token:'o'.repeat(36)}),
   redirect:'manual',
  });
  assert.equal(login.status,303);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const source=await fetch(url,{headers:{cookie}});
  assert.equal(source.status,200);
  assert.equal(source.headers.get('x-content-type-options'),'nosniff');
  assert.equal(await source.text(),RAW);
  const cross=await fetch(base+'/original/anevum/cristy-professional/original-document/'+D,
   {headers:{cookie}});
  assert.equal(cross.status,404);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  store.close();
 }
 }));
