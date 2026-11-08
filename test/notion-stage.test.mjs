import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, lstat, readFile, readdir, rename, symlink, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { KnowledgeStore } from '../src/knowledge.mjs';
import { inspectNotionExport } from '../src/notion-export.mjs';
import { planNotionSyntheticStage, readVerifiedNotionMarkdown, stageSyntheticNotionIndex } from '../src/notion-stage.mjs';

const A='11111111111111111111111111111111',B='22222222222222222222222222222222',C='33333333333333333333333333333333';
const seed=async()=>{
 const outer=await mkdtemp(join(tmpdir(),'knowledge-g6-'));
 const root=join(outer,'original');await mkdir(root);const protectedDir=join(outer,'protected');await mkdir(protectedDir);
 await mkdir(join(root,'Personal '+C));
 const originals=[
   {id:A,path:'Personal '+C+'/Project '+A+'.md',text:'# SYNTHETIC FIXTURE\nExample project notes that should not be imported into a live page.'},
   {id:B,path:'Reference '+B+'.md',text:'# SYNTHETIC FIXTURE\nSeparate fictional evidence that should remain only in the original.'},
 ];
 for(const x of originals)await writeFile(join(root,x.path),x.text,{mode:0o600});
 const preflight=await inspectNotionExport(root);
 const inventory={format:'knowledge-notion-inventory-v1',enumerationComplete:true,records:[
  {id:A,scope:'devonstation',kind:'page',accessible:true},
  {id:B,scope:'anevum',kind:'page',accessible:true},
  {id:C,scope:'cristy',kind:'page',accessible:false},
 ]};
 return {outer,root,protectedDir,originals,preflight,inventory};
};
const input=(fx,selectedIds=[A],scope='devonstation')=>({root:fx.root,preflight:fx.preflight,inventory:fx.inventory,selectedIds,scope});

test('scoped verified reader returns exactly fingerprinted source, with no automatic publication',async()=>{
 const fx=await seed();const result=await readVerifiedNotionMarkdown({...input(fx),originalNotionId:A});
 assert.equal(result.text,fx.originals[0].text);
 assert.equal(result.sha256,createHash('sha256').update(result.text).digest('hex'));
 assert.equal(result.scope,'devonstation');
 await assert.rejects(()=>readVerifiedNotionMarkdown({...input(fx,[B],'devonstation'),originalNotionId:B}),{code:'SCOPE_DENIED'});
 await assert.rejects(()=>readVerifiedNotionMarkdown({...input(fx,[C],'cristy'),originalNotionId:C}),{code:'SCOPE_DENIED'});
});

test('stage writes only metadata into a new owner-scoped SQLite database without copying source prose',async()=>{
 const fx=await seed(),db=join(fx.protectedDir,'index.sqlite');
 const original=await readFile(join(fx.root,fx.originals[0].path));
 const plan=planNotionSyntheticStage(input(fx));
 assert.equal(plan.items[0].sourceSha256,createHash('sha256').update(original).digest('hex'));
 assert.equal(plan.sourceCoverageCertified,false);
 const result=await stageSyntheticNotionIndex({...input(fx),outputDb:db,syntheticOnly:true});
 assert.equal(result.stagedPages,1);assert.equal(result.privateDataImported,false);
 assert.equal((await stat(db)).mode&0o777,0o600);
 const s=new KnowledgeStore(db);
 try{
  const pages=s.listPages('devonstation');assert.equal(pages.length,1);
  const entry=s.getPage('devonstation','notion/'+A);
  assert.equal(entry.status,'draft');assert.equal(entry.version,1);
  assert.match(entry.body,/CONTENT NOT IMPORTED/);
  assert.match(entry.body,/Original SHA-256/);
  assert.equal(entry.body.includes('Example project notes that should not be imported'),false);
  assert.equal(s.storageStats('devonstation').usedTextBytes<2000,true);
 }finally{s.close()}
 assert.deepEqual(await readFile(join(fx.root,fx.originals[0].path)),original);
 assert.deepEqual((await readdir(fx.protectedDir)).sort(),['index.sqlite']);
 await assert.rejects(()=>stageSyntheticNotionIndex({...input(fx),outputDb:db,syntheticOnly:true}),{code:'ALREADY_EXISTS'});
});

test('source bytes changed after inspection are rejected without creating database or temp files',async()=>{
 const fx=await seed(),db=join(fx.protectedDir,'preview.sqlite');
 await writeFile(join(fx.root,fx.originals[0].path),'# SYNTHETIC FIXTURE\nChanged after the original export was inspected.');
 await assert.rejects(()=>stageSyntheticNotionIndex({...input(fx),outputDb:db,syntheticOnly:true}),{code:'SOURCE_CHANGED'});
 assert.deepEqual(await readdir(fx.protectedDir),[]);
});

test('symlink file, symlink parent and unsafe traversal are rejected',async()=>{
 const fx=await seed();const path=fx.originals[0].path;
 const manifest=structuredClone(fx.preflight);
 const entry=manifest.entries.find(e=>e.originalNotionId===A);
 entry.relativePath='../outside.md';
 await assert.rejects(()=>readVerifiedNotionMarkdown({...input(fx),preflight:manifest,originalNotionId:A}),{code:'UNSAFE_SOURCE'});
 const malicious=structuredClone(fx.preflight),entry2=malicious.entries.find(e=>e.originalNotionId===A);
 entry2.relativePath='Personal '+C+'/../Reference '+B+'.md';
 await assert.rejects(()=>readVerifiedNotionMarkdown({...input(fx),preflight:malicious,originalNotionId:A}),{code:'UNSAFE_SOURCE'});
 await symlink(fx.root,join(fx.outer,'alias'));
 await assert.rejects(()=>readVerifiedNotionMarkdown({...input(fx),root:join(fx.outer,'alias'),originalNotionId:A}),{code:'UNSAFE_SOURCE'});
 const aliasDir=join(fx.root,'Alias '+C);await symlink(join(fx.root,'Personal '+C),aliasDir);
 const aliasManifest=structuredClone(fx.preflight);aliasManifest.entries.find(e=>e.originalNotionId===A).relativePath='Alias '+C+'/Project '+A+'.md';
 await assert.rejects(()=>readVerifiedNotionMarkdown({...input(fx),preflight:aliasManifest,originalNotionId:A}),{code:'UNSAFE_SOURCE'});
 const leafPath=join(fx.root,path),safeCopy=join(fx.root,'Personal '+C,'other.md');
 await rename(leafPath,safeCopy);
 await symlink(safeCopy,leafPath);
 await assert.rejects(()=>readVerifiedNotionMarkdown({...input(fx),originalNotionId:A}),{code:'UNSAFE_SOURCE'});
});

test('duplicate exported IDs, inaccessible ownership, unsupported material and unresolved links block staging',async()=>{
 const fx=await seed();
 const dup=structuredClone(fx.preflight);dup.entries.push({...dup.entries.find(e=>e.originalNotionId===A)});
 assert.throws(()=>planNotionSyntheticStage({...input(fx),preflight:dup}),{code:'AMBIGUOUS_SOURCE'});
 const badScope=structuredClone(fx.inventory);badScope.records[0].scope='family';
 assert.throws(()=>planNotionSyntheticStage({...input(fx),inventory:badScope}),{code:'SCOPE_DENIED'});
 const badLink=structuredClone(fx.preflight);badLink.entries.find(e=>e.originalNotionId===A).remoteNotionLinks=1;
 assert.throws(()=>planNotionSyntheticStage({...input(fx),preflight:badLink}),{code:'UNVERIFIED_SOURCE'});
 const invalid=structuredClone(fx.preflight);invalid.entries.find(e=>e.originalNotionId===A).type='database_csv';
 assert.throws(()=>planNotionSyntheticStage({...input(fx),preflight:invalid}),{code:'UNVERIFIED_SOURCE'});
 assert.throws(()=>planNotionSyntheticStage({...input(fx),selectedIds:[A,A]}),{code:'INVALID_SELECTION'});
 assert.throws(()=>planNotionSyntheticStage({...input(fx),selectedIds:[A+'----']}),{code:'INVALID_SELECTION'});
 assert.throws(()=>planNotionSyntheticStage({...input(fx),selectedIds:[B],scope:'devonstation'}),{code:'SCOPE_DENIED'});
});

test('the only supported staging mode is explicitly synthetic; cannot write into exported originals',async()=>{
 const fx=await seed();
 await assert.rejects(()=>stageSyntheticNotionIndex({...input(fx),outputDb:join(fx.protectedDir,'x.sqlite')}),{code:'PRIVATE_DATA_BLOCKED'});
 await assert.rejects(()=>stageSyntheticNotionIndex({...input(fx),outputDb:join(fx.root,'index.sqlite'),syntheticOnly:true}),{code:'UNSAFE_DESTINATION'});
 const changed=fx.originals[0].text.replace('# SYNTHETIC FIXTURE\n','# original private source\n');
 await writeFile(join(fx.root,fx.originals[0].path),changed);
 const revised=await inspectNotionExport(fx.root);
 await assert.rejects(()=>stageSyntheticNotionIndex({...input(fx),preflight:revised,outputDb:join(fx.protectedDir,'x.sqlite'),syntheticOnly:true}),{code:'PRIVATE_DATA_BLOCKED'});
 assert.deepEqual(await readdir(fx.protectedDir),[]);
});
