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
import {parseNotionDatabaseCsv} from '../src/notion-csv-rows.mjs';
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
  assert.equal(result.preservedOriginals,6);
  assert.equal(result.csvRowsImported,1);
  assert.equal(result.attachments,1);
  assert.equal(result.csvDatabaseFilesPreserved,1);
  assert.equal(result.unclassifiedSourceItems,1);
  assert.equal(result.originalBodiesPreserved,true);
  assert.equal(result.databaseRowsReconstructed,true);
  assert.equal(result.notionDatabaseViewsRebuilt,false);
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
   assert.throws(()=>store.exportSpace('anevum'),
     {code:'SOURCE_ARCHIVE_BACKUP_REQUIRED'});
   assert.equal(store.searchPages('anevum','uniqueTermDeep')[0].id,original.id);
   const row=store.getPage('anevum','anevum-works/database-row/'+E+'-1');
   assert.ok(row.body.includes('- Title: Project'));
   assert.ok(row.body.includes('- Status: Active'));
   assert.ok(store.searchPages('anevum','Active').some(page=>page.id===row.id));
   const preservedRow=store.getNotionOriginal('anevum',row.path);
   assert.equal(preservedRow.source_kind,'csv-row');
   assert.equal(JSON.parse(preservedRow.original_text).values[0],'Project');
   assert.ok(store.getLinkedPages('anevum',row.path).some(x=>x.direction==='outgoing'));
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
 assert.equal(JSON.parse(approved.stdout).preservedOriginals,6);
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

test('Notion CSV parser preserves quoted delimiters, embedded newlines and exact ordered values',()=>{
 const rows=parseNotionDatabaseCsv(
  'Name,Status,Notes\r\n"Alpha, One",Active,"Line 1\nLine 2"\r\n"Beta ""Quote""",Done,""\n');
 assert.equal(rows.length,2);
 assert.equal(rows[0].title,'Alpha, One');
 assert.equal(rows[0].fields.Notes,'Line 1\nLine 2');
 assert.deepEqual(JSON.parse(rows[1].originalJson).values,
  ['Beta "Quote"','Done','']);
});
test('Notion CSV parser rejects malformed rows, duplicate headers and broken quotes',()=>{
 for(const value of [
  'Name,Name\nA,B',
  'Title,Status\nA',
  'Title,Status\nA,B,C',
  'Name,Status\n"Never closed,Active',
  'Name,Status\nA"bad",Active',
 ]){
  assert.throws(()=>parseNotionDatabaseCsv(value),{code:'INVALID_CSV'});
 }
});

test('Notion _all CSV view links matching sibling Markdown pages without duplicating them',
 ()=>withFixture(async fx=>{
 const DATABASE='88888888888888888888888888888888';
 const CANONICAL='77777777777777777777777777777777';
 const ALT='99999999999999999999999999999999';
 const folder=join(fx.a,'Canon Registry');
 await mkdir(folder,{mode:0o700});
 await writePrivate(join(folder,'Matched '+CANONICAL+'.md'),
  '# Matched\n\nCanonical original document');
 await writePrivate(join(folder,'Repeated '+ALT+'.md'),
  '# Repeated\n\nSecond original document');
 await writePrivate(join(fx.a,'Canon Registry '+DATABASE+'_all.csv'),
  'Name,Status\nMatched,Verified\nUnmatched,Pending\nRepeated,Recorded\n');
 const report=await load(fx);
 assert.equal(report.csvRowsImported,4);
 assert.equal(report.csvRowsMatchedToExistingPages,3);
 assert.equal(report.csvRowsCreatedAsNewEntries,1);
 assert.equal(report.csvRowsNeedingIdentityReview,0);
 assert.equal(report.csvDatabaseFilesPreserved,2);
 const store=new KnowledgeStore(join(fx.target,'knowledge.sqlite'));
 try{
  const matched=store.getPage('anevum','anevum-works/original-document/'+CANONICAL);
  assert.ok(matched);
  const csv=store.db.prepare(
    "SELECT record_id,matching_mode,headers_json,values_json FROM notion_csv_rows WHERE database_notion_id=? AND row_index=1"
  ).get(DATABASE);
  assert.equal(csv.record_id,matched.id);
  assert.equal(csv.matching_mode,'exact_title');
  assert.deepEqual(JSON.parse(csv.values_json),['Matched','Verified']);
  assert.ok(store.searchPages('anevum','Verified').some(x=>x.id===matched.id));
  const extra=store.db.prepare(
    "SELECT record_id,matching_mode FROM notion_csv_rows WHERE database_notion_id=? AND row_index=2"
  ).get(DATABASE);
  assert.equal(extra.matching_mode,'new_row');
  assert.notEqual(extra.record_id,matched.id);
  const originals=store.db.prepare(
   "SELECT COUNT(*) AS n FROM notion_originals WHERE original_path LIKE ?"
  ).get('%Canon Registry%').n;
  assert.equal(originals,4);
  const uniqueMarkdown=store.db.prepare(
   "SELECT COUNT(*) AS n FROM notion_originals WHERE notion_id=?"
  ).get(CANONICAL).n;
  assert.equal(uniqueMarkdown,1);
 }finally{store.close()}
 }));
