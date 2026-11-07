import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {KnowledgeStore} from '../src/knowledge.mjs';

const mergeScript=fileURLToPath(new URL('../ops/private-notion/merge-recovery.py',import.meta.url));
const OLD_ID='11111111111111111111111111111111';
const NEW_ID='22222222222222222222222222222222';
const CHILD_ID='33333333333333333333333333333333';
const ROOT='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TEXT='# Synthetic original\n\nPrivate source preserved intact.\n';
const SPACE='anevum';
const PORTAL='anevum-works';
const sha=s=>createHash('sha256').update(s).digest('hex');

async function privateFile(path,contents){
 await writeFile(path,contents,{mode:0o600,flag:'wx'});
 await chmod(path,0o600);
}
async function privateDir(path){
 await mkdir(path,{mode:0o700,recursive:true});
 await chmod(path,0o700);
}
async function fixture(){
 const home=await mkdtemp(join(tmpdir(),'knowledge-private-merge-ci-'));
 await chmod(home,0o700);
 const base=join(home,'base'),recovery=join(home,'recovery'),output=join(home,'merged');
 await privateDir(base);
 await privateDir(join(base,'assets'));
 const store=new KnowledgeStore(join(base,'knowledge.sqlite'));
 try{
  store.createSpace(SPACE,'Synthetic private source');
  const record=store.capturePage(SPACE,{
   path:PORTAL+'/original-document/'+OLD_ID,
   title:'Existing source',body:'Source preserved in archive',
   sourceUrl:'https://www.notion.so/'+OLD_ID,
  });
  const now=new Date().toISOString();
  store.db.prepare('INSERT INTO notion_originals(space_id,record_id,source_key,notion_id,original_path,parent_notion_id,source_kind,source_sha256,source_bytes,original_text,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
   .run(SPACE,record.id,'notion:'+OLD_ID,OLD_ID,'initial/Existing '+OLD_ID+'.md',null,'markdown',sha(TEXT),Buffer.byteLength(TEXT),TEXT,now);
  store.db.prepare('INSERT INTO notion_originals_fts(record_id,original_text) VALUES (?,?)').run(record.id,TEXT);
 }finally{store.close()}
 await chmod(join(base,'knowledge.sqlite'),0o600);
 await privateDir(recovery);
 const folder=join(recovery,SPACE,PORTAL+'-'+ROOT+'-source');
 await privateDir(folder);
 return {home,base,recovery,output,folder,cleanup:()=>rm(home,{recursive:true,force:true})};
}
async function addSource(fx,id,title,body,parentId=null){
 const stem=title+' '+id;
 const original=join(fx.folder,stem+'.md'),metadata=join(fx.folder,stem+'.notion.json');
 await privateFile(original,body);
 await privateFile(metadata,JSON.stringify({
  format:'knowledge-notion-original-page-v1',
  originalId:id,rootId:ROOT,scope:SPACE,portal:PORTAL,parentId,
  page:{object:'page',id},blocks:[],relations:[],
 }));
}
async function finalizeRecovery(fx,count){
 await privateFile(join(fx.recovery,'scope-map.json'),JSON.stringify({
  format:'knowledge-notion-scope-map-v1',
  rules:[{prefix:SPACE+'/'+PORTAL+'-'+ROOT+'-source',spaceId:SPACE,portal:PORTAL}],
 }));
 await privateFile(join(fx.recovery,'recovery-report.json'),JSON.stringify({
  format:'knowledge-notion-private-hierarchy-v1',
  sourceUnmodified:true,cutoverApproved:false,sourceDocumentsWritten:count,
  mediaReferencesUncaptured:0,unexpandedProperties:0,
 }));
}
function execute(base,recovery,output){
 return spawnSync('python3',[mergeScript,base,recovery,output],{
  encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024,
 });
}
test('Private merge adds new originals, retains duplicate evidence, and resolves in-scope parent',async()=>{
 const fx=await fixture();
 try{
  await addSource(fx,OLD_ID,'Existing source',TEXT);
  await addSource(fx,NEW_ID,'New page','# New page\n\nRecovered body text.\n');
  await addSource(fx,CHILD_ID,'Nested page','# Nested page\n',NEW_ID);
  await finalizeRecovery(fx,3);
  const run=execute(fx.base,fx.recovery,fx.output);
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(run.stdout);
  assert.equal(report.originalRecordsRetained,1);
  assert.equal(report.newSourceRecords,2);
  assert.equal(report.matchingDuplicateSources,1);
  assert.equal(report.mergedRecords,3);
  assert.equal(report.productionReady,false);
  assert.equal(report.notionRetirementApproved,false);
  assert.ok(!run.stdout.includes('Recovered body'));
  assert.ok(!run.stdout.includes(OLD_ID));
  assert.equal(run.stderr,'');
  const db=new KnowledgeStore(join(fx.output,'knowledge.sqlite'));
  try{
   assert.equal(db.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   assert.equal(db.db.prepare('PRAGMA foreign_key_check').all().length,0);
   assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM records').get().n,3);
   assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM notion_originals').get().n,3);
   assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM notion_originals_fts').get().n,3);
   const parent=db.getPage(SPACE,PORTAL+'/original-document/'+NEW_ID);
   const child=db.getPage(SPACE,PORTAL+'/original-document/'+CHILD_ID);
   assert.ok(parent.body.includes('Recovered body text'));
   assert.ok(child.hasOriginal);
   const refs=db.db.prepare('SELECT target_record_id FROM notion_import_references WHERE from_record_id=? AND relation_kind=?')
    .all(child.id,'parent');
   assert.equal(refs.length,1);
   assert.equal(refs[0].target_record_id,parent.id);
   assert.ok(db.getLinkedPages(SPACE,child.path).some(link=>link.direction==='outgoing'));
   const originals=db.db.prepare("SELECT COUNT(*) AS n FROM notion_import_assets WHERE original_path LIKE 'recovered:%'").get().n;
   assert.equal(originals,3);
  }finally{db.close()}
  const originalDb=new KnowledgeStore(join(fx.base,'knowledge.sqlite'));
  try{assert.equal(originalDb.db.prepare('SELECT COUNT(*) AS n FROM records').get().n,1)}
  finally{originalDb.close()}
 }finally{await fx.cleanup()}
});
test('Private merge refuses a changed source ID without publishing output',async()=>{
 const fx=await fixture();
 try{
  await addSource(fx,OLD_ID,'Existing source','# Modified source, same ID\n');
  await finalizeRecovery(fx,1);
  const run=execute(fx.base,fx.recovery,fx.output);
  assert.notEqual(run.status,0);
  assert.equal(run.stdout,'');
  assert.match(run.stderr,/CONFLICTING_SOURCE_OR_SCOPE/);
  await assert.rejects(()=>stat(fx.output),{code:'ENOENT'});
 }finally{await fx.cleanup()}
});
test('Private merge refuses destination nested within original source',async()=>{
 const fx=await fixture();
 try{
  await addSource(fx,NEW_ID,'New page','# New page\n');
  await finalizeRecovery(fx,1);
  const run=execute(fx.base,fx.recovery,join(fx.base,'unsafe-output'));
  assert.notEqual(run.status,0);
  assert.equal(run.stdout,'');
  assert.match(run.stderr,/INVALID_DESTINATION/);
 }finally{await fx.cleanup()}
});


test('Private merge refuses orphan recovered metadata before output publication',async()=>{
 const fx=await fixture();
 try{
  await addSource(fx,NEW_ID,'New page','# New page\n');
  const orphanId='44444444444444444444444444444444';
  await privateFile(join(fx.folder,'Orphan '+orphanId+'.notion.json'),JSON.stringify({
   format:'knowledge-notion-original-page-v1',
   originalId:orphanId,rootId:ROOT,scope:SPACE,portal:PORTAL,parentId:null,
   page:{object:'page',id:orphanId},blocks:[],relations:[],
  }));
  await finalizeRecovery(fx,1);
  const run=execute(fx.base,fx.recovery,fx.output);
  assert.notEqual(run.status,0);
  assert.equal(run.stdout,'');
  assert.match(run.stderr,/RECOVERY_PAIR_MISMATCH/);
  await assert.rejects(()=>stat(fx.output),{code:'ENOENT'});
  const db=new KnowledgeStore(join(fx.base,'knowledge.sqlite'));
  try{assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM records').get().n,1)}
  finally{db.close()}
 }finally{await fx.cleanup()}
});

test('Private merge refuses unexpected recovery files instead of ignoring them',async()=>{
 const fx=await fixture();
 try{
  await addSource(fx,NEW_ID,'New page','# New page\n');
  await privateFile(join(fx.folder,'unreviewed-extra.txt'),'unreviewed source');
  await finalizeRecovery(fx,1);
  const run=execute(fx.base,fx.recovery,fx.output);
  assert.notEqual(run.status,0);
  assert.equal(run.stdout,'');
  assert.match(run.stderr,/UNEXPECTED_RECOVERY_FILE/);
  await assert.rejects(()=>stat(fx.output),{code:'ENOENT'});
 }finally{await fx.cleanup()}
});
