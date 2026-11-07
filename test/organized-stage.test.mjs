import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,chmod,writeFile,readFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {KnowledgeStore} from '../src/knowledge.mjs';
import {stageOrganizedSyntheticNotion,exportSyntheticOrganizedArchive,
  restoreSyntheticOrganizedArchive} from '../src/organized-stage.mjs';

const A='11111111111111111111111111111111';
const B='22222222222222222222222222222222';
const C='33333333333333333333333333333333';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const outer=await mkdtemp(join(tmpdir(),'knowledge-g15-'));
 await chmod(outer,0o700);
 const root=join(outer,'originals'),privateDir=join(outer,'owner-only');
 await mkdir(root,{mode:0o700});await mkdir(privateDir,{mode:0o700});
 const items=[
  {id:A,parent:null,relativePath:'Knowledge '+A+'.md',
   title:'Knowledge',recordType:'project',body:'# SYNTHETIC FIXTURE\nFictional root subject with Unicode: π.\n'},
  {id:B,parent:A,relativePath:'Evidence '+B+'.md',
   title:'Build evidence',recordType:'evidence',body:'# SYNTHETIC FIXTURE\nSynthetic source receipt and no personal records.\n'},
 ];
 const preflight={format:'knowledge-notion-preflight-v1',
  summary:{workspaceCoverageVerified:true},entries:[]};
 const inventory={format:'knowledge-notion-inventory-v1',
  enumerationComplete:true,records:[]};
 const classifications=[];
 for(const item of items){
  await writeFile(join(root,item.relativePath),item.body,{mode:0o600});
  preflight.entries.push({originalNotionId:item.id,parentNotionId:item.parent,
    relativePath:item.relativePath,type:'markdown',
    sha256:sha(Buffer.from(item.body)),bytes:Buffer.byteLength(item.body),
    missingLocalLinks:0,remoteNotionLinks:0});
  inventory.records.push({id:item.id,scope:'devonstation',accessible:true,kind:'page'});
  classifications.push({id:item.id,portal:'independent-software',
   recordType:item.recordType,title:item.title,status:'verified',
   sourceUrl:'https://example.org/fictional/'+item.id,
   ...(item.parent?{parentId:item.parent}:{}),aliases:['Synthetic '+item.title],
   links:item.id===A?[{targetId:B,type:'supports'}]:[]});
 }
 const outputDb=join(privateDir,'staged.sqlite');
 const args={root,preflight,inventory,classifications,scope:'devonstation',
   outputDb,syntheticOnly:true};
 return {outer,root,privateDir,outputDb,args,items};
}
async function cleanup(fx){
 const {rm}=await import('node:fs/promises');
 await rm(fx.outer,{recursive:true,force:true});
}
async function assertNoOutput(fx){
 assert.equal((await readdir(fx.privateDir)).length,0);
}
test('G15 stages exact fictional markdown at canonical paths with original ancestry and backlinks',async()=>{
 const fx=await fixture();
 try{
  const originals=await Promise.all(fx.items.map(x=>readFile(join(fx.root,x.relativePath))));
  const result=await stageOrganizedSyntheticNotion(fx.args);
  assert.equal(result.format,'knowledge-synthetic-organized-stage-v1');
  assert.equal(result.stagedPages,2);
  assert.equal(result.stagedRelations,2);
  assert.equal(result.privateDataImported,false);
  assert.equal(result.productionReady,false);
  assert.equal(result.cutoverApproved,false);
  const st=await lstat(fx.outputDb);assert.equal(st.mode&0o777,0o600);
  const store=new KnowledgeStore(fx.outputDb);
  try{
   const a=store.getPage('devonstation','independent-software/project/knowledge');
   const b=store.getPage('devonstation','independent-software/evidence/build-evidence');
   assert.ok(a&&b);assert.equal(a.body,fx.items[0].body);
   assert.equal(b.body,fx.items[1].body);
   assert.equal(a.status,'draft');assert.equal(b.status,'draft');
   const metadata=store.db.prepare('SELECT * FROM synthetic_sources ORDER BY source_id').all();
   assert.deepEqual(metadata.map(x=>x.source_id),[A,B]);
   assert.equal(metadata[1].original_parent_id,A);
   assert.equal(metadata[1].proposed_parent_id,A);
   assert.equal(metadata[0].color,'purple');
   assert.deepEqual(JSON.parse(metadata[0].aliases_json),['Synthetic Knowledge']);
   const edges=store.db.prepare('SELECT kind FROM synthetic_edges ORDER BY kind').all();
   assert.deepEqual(edges.map(e=>e.kind),['contains','supports']);
   assert.ok(store.getLinkedPages('devonstation',b.path)
    .some(x=>x.direction==='incoming'&&x.kind==='supports'&&x.path===a.path));
   const archive=exportSyntheticOrganizedArchive(store,'devonstation');
   assert.equal(archive.sha256,result.recoveredSha256);
   const restored=new KnowledgeStore();
   try{
    const r=restoreSyntheticOrganizedArchive(restored,archive,{syntheticOnly:true});
    assert.equal(r.restored,true);
    assert.equal(r.sha256,archive.sha256);
    assert.equal(restored.getPage('devonstation',b.path).body,fx.items[1].body);
    assert.deepEqual(restored.db.prepare('SELECT kind FROM synthetic_edges ORDER BY kind').all(),edges);
   }finally{restored.close();}
  }finally{store.close();}
  for(let i=0;i<fx.items.length;i++){
   assert.deepEqual(await readFile(join(fx.root,fx.items[i].relativePath)),originals[i]);
  }
 }finally{await cleanup(fx);}
});
test('G15 refuses non-synthetic source despite valid checksum, preserving no-output rollback',async()=>{
 const fx=await fixture();
 try{
  const file=join(fx.root,fx.items[0].relativePath);
  const content='# PRIVATE EXPORT\nMust never be staged.\n';
  await writeFile(file,content);
  fx.args.preflight.entries[0].sha256=sha(Buffer.from(content));
  fx.args.preflight.entries[0].bytes=Buffer.byteLength(content);
  await assert.rejects(()=>stageOrganizedSyntheticNotion(fx.args),{code:'PRIVATE_DATA_BLOCKED'});
  await assertNoOutput(fx);
 }finally{await cleanup(fx);}
});
test('G15 detects altered originals, incomplete source coverage and unresolved relationships',async()=>{
 const fx=await fixture();
 try{
  const file=join(fx.root,fx.items[1].relativePath);
  await writeFile(file,fx.items[1].body+'tampered');
  await assert.rejects(()=>stageOrganizedSyntheticNotion(fx.args),{code:'SOURCE_CHANGED'});
  await assertNoOutput(fx);
  await writeFile(file,fx.items[1].body);
  fx.args.preflight.summary.workspaceCoverageVerified=false;
  await assert.rejects(()=>stageOrganizedSyntheticNotion(fx.args),{code:'ORGANIZATION_BLOCKED'});
  await assertNoOutput(fx);
  fx.args.preflight.summary.workspaceCoverageVerified=true;
  fx.args.classifications[0].links.push({targetId:C,type:'supports'});
  await assert.rejects(()=>stageOrganizedSyntheticNotion(fx.args),{code:'ORGANIZATION_BLOCKED'});
  await assertNoOutput(fx);
 }finally{await cleanup(fx);}
});
test('G15 never overwrites an existing target or writes into original export',async()=>{
 const fx=await fixture();
 try{
  await assert.rejects(()=>stageOrganizedSyntheticNotion({
   ...fx.args,syntheticOnly:false}),{code:'PRIVATE_DATA_BLOCKED'});
  await assertNoOutput(fx);
  await assert.rejects(()=>stageOrganizedSyntheticNotion({
   ...fx.args,outputDb:join(fx.root,'forbidden.sqlite')}),{code:'UNSAFE_DESTINATION'});
  await assertNoOutput(fx);
  const initial=await stageOrganizedSyntheticNotion(fx.args);
  assert.equal(initial.stagedPages,2);
  const before=await readFile(fx.outputDb);
  await assert.rejects(()=>stageOrganizedSyntheticNotion(fx.args),{code:'ALREADY_EXISTS'});
  assert.deepEqual(await readFile(fx.outputDb),before);
  assert.deepEqual(await readdir(fx.privateDir),['staged.sqlite']);
 }finally{await cleanup(fx);}
});
test('G15 rejects malformed or conflicting encyclopedia classification without publication',async()=>{
 const fx=await fixture();
 try{
  fx.args.classifications[1].title='Knowledge';
  fx.args.classifications[1].recordType='project';
  await assert.rejects(()=>stageOrganizedSyntheticNotion(fx.args),{code:'ORGANIZATION_BLOCKED'});
  await assertNoOutput(fx);
 }finally{await cleanup(fx);}
});
test('G15 recovery rejects changed archives and refuses a non-synthetic restore',async()=>{
 const fx=await fixture();
 try{
  await stageOrganizedSyntheticNotion(fx.args);
  const store=new KnowledgeStore(fx.outputDb);
  try{
   const archive=exportSyntheticOrganizedArchive(store,'devonstation');
   const forged=structuredClone(archive);
   forged.payload.sources[0].color='red';
   const restored=new KnowledgeStore();
   try{
    assert.throws(()=>restoreSyntheticOrganizedArchive(restored,forged,{syntheticOnly:true}),
     {code:'INVALID_ARCHIVE'});
    assert.equal(restored.getSpace('devonstation'),null);
    assert.throws(()=>restoreSyntheticOrganizedArchive(restored,archive),
     {code:'PRIVATE_DATA_BLOCKED'});
    assert.equal(restored.getSpace('devonstation'),null);
   }finally{restored.close();}
  }finally{store.close();}
 }finally{await cleanup(fx);}
});

test('G15 a forged self-consistent archive fails preflight without mutating the target',async()=>{
 const fx=await fixture();
 try{
  await stageOrganizedSyntheticNotion(fx.args);
  const store=new KnowledgeStore(fx.outputDb);
  try{
   const archive=exportSyntheticOrganizedArchive(store,'devonstation');
   const tampered=structuredClone(archive);
   tampered.payload.sources[0].source_sha256='f'.repeat(64);
   tampered.sha256=sha(Buffer.from(JSON.stringify(tampered.payload)));
   const destination=new KnowledgeStore();
   try{
    assert.throws(()=>restoreSyntheticOrganizedArchive(destination,tampered,{syntheticOnly:true}),
     {code:'STAGE_INTEGRITY'});
    assert.equal(destination.getSpace('devonstation'),null);
    assert.equal(destination.db.prepare('SELECT COUNT(*) AS total FROM records').get().total,0);
   }finally{destination.close();}
  }finally{store.close();}
 }finally{await cleanup(fx);}
});
test('G15 export refuses unregistered extra wiki articles or nonmatching backlink data',async()=>{
 const fx=await fixture();
 try{
  await stageOrganizedSyntheticNotion(fx.args);
  const store=new KnowledgeStore(fx.outputDb);
  try{
   const snapshot=exportSyntheticOrganizedArchive(store,'devonstation');
   store.capturePage('devonstation',{path:'independent-software/project/extra',
     title:'Extra',body:'# SYNTHETIC FIXTURE\nExtra page not present in source inventory.'});
   assert.throws(()=>exportSyntheticOrganizedArchive(store,'devonstation'),{code:'STAGE_INTEGRITY'});
   assert.ok(snapshot.sha256);
  }finally{store.close();}
 }finally{await cleanup(fx);}
});
