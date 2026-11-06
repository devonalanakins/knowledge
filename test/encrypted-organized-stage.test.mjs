import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,chmod,writeFile,readFile,readdir,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {KnowledgeStore} from '../src/knowledge.mjs';
import {writeEncryptedSyntheticStage,inspectEncryptedSyntheticStage,
  verifyEncryptedSyntheticStage} from '../src/encrypted-organized-stage.mjs';
import {decryptSnapshot,encryptSnapshot} from '../src/backup.mjs';

const A='11111111111111111111111111111111';
const B='22222222222222222222222222222222';
const passphrase='synthetic fixture password independently kept and longer than twenty-four bytes';
const fingerprint=t=>createHash('sha256').update(t).digest('hex');
async function fixture() {
 const outer=await mkdtemp(join(tmpdir(),'knowledge-g16-'));
 await chmod(outer,0o700);
 const root=join(outer,'originals'),privateDir=join(outer,'private');
 await mkdir(root,{mode:0o700});await mkdir(privateDir,{mode:0o700});
 const source=[
  {id:A,parent:null,path:'Knowledge '+A+'.md',title:'Knowledge',
   type:'project',body:'# SYNTHETIC FIXTURE\nFictional source only. SECRET_FIXTURE_STRING_NOT_IN_DISK. π\n'},
  {id:B,parent:A,path:'Evidence '+B+'.md',title:'Evidence',
   type:'evidence',body:'# SYNTHETIC FIXTURE\nThe second fictional source is preserved exactly.\n'}
 ];
 const preflight={format:'knowledge-notion-preflight-v1',
   summary:{workspaceCoverageVerified:true},entries:[]};
 const inventory={format:'knowledge-notion-inventory-v1',enumerationComplete:true,records:[]};
 const classifications=[];
 for(const item of source){
   await writeFile(join(root,item.path),item.body,{mode:0o600});
   preflight.entries.push({originalNotionId:item.id,parentNotionId:item.parent,
     relativePath:item.path,type:'markdown',sha256:fingerprint(item.body),
     bytes:Buffer.byteLength(item.body),missingLocalLinks:0,remoteNotionLinks:0});
   inventory.records.push({id:item.id,scope:'devonstation',kind:'page',accessible:true});
   classifications.push({id:item.id,portal:'independent-software',
     recordType:item.type,title:item.title,status:'verified',
     sourceUrl:'https://example.org/fictional/'+item.id,
     ...(item.parent?{parentId:item.parent}:{}),aliases:['Original '+item.title],
     links:item.id===A?[{targetId:B,type:'supports'}]:[]});
 }
 return {outer,root,privateDir,source,outputFile:join(privateDir,'knowledge.enc'),
   args:{root,preflight,inventory,classifications,scope:'devonstation',
     outputFile:join(privateDir,'knowledge.enc'),passphrase,syntheticOnly:true}};
}
async function withFixture(fn){
 const fx=await fixture();
 try{return await fn(fx);}finally{await rm(fx.outer,{recursive:true,force:true});}
}
test('G16 stores only encrypted ciphertext and restores original text, statuses, hierarchy and backlinks in memory',()=>withFixture(async fx=>{
 const originals=await Promise.all(fx.source.map(x=>readFile(join(fx.root,x.path))));
 const result=await writeEncryptedSyntheticStage(fx.args);
 assert.equal(result.format,'knowledge-synthetic-encrypted-stage-v1');
 assert.equal(result.encryptedFileWritten,true);
 assert.equal(result.plaintextDatabaseWritten,false);
 assert.equal(result.privateDataImported,false);
 assert.equal(result.productionReady,false);
 assert.equal(result.stagedPages,2);
 assert.equal(result.stagedRelations,2);
 assert.deepEqual(await readdir(fx.privateDir),['knowledge.enc']);
 const file=await readFile(fx.outputFile,'utf8');
 assert.ok(file.includes('"aes-256-gcm"'));
 assert.ok(!file.includes('SECRET_FIXTURE_STRING_NOT_IN_DISK'));
 assert.ok(!file.includes('Fictional source only'));
 assert.ok(!file.includes(A));
 assert.ok(!file.includes('"sources"'));
 assert.equal((await lstat(fx.outputFile)).mode&0o777,0o600);
 const verified=await inspectEncryptedSyntheticStage({
   encryptedFile:fx.outputFile,passphrase,syntheticOnly:true});
 assert.equal(verified.archiveSha256,result.archiveSha256);
 const archive=decryptSnapshot(JSON.parse(file),passphrase);
 assert.equal(archive.payload.sources.length,2);
 assert.equal(archive.payload.edges.length,2);
 assert.equal(archive.payload.sources[1].original_parent_id,A);
 assert.equal(archive.payload.sources[1].proposed_parent_id,A);
 assert.equal(archive.payload.sources[0].color,'purple');
 assert.deepEqual(JSON.parse(archive.payload.sources[0].aliases_json),['Original Knowledge']);
 const restored=new KnowledgeStore();
 try{
   const {restoreSyntheticOrganizedArchive}=await import('../src/organized-stage.mjs');
   restoreSyntheticOrganizedArchive(restored,archive,{syntheticOnly:true});
   const a=restored.getPage('devonstation','independent-software/project/knowledge');
   const b=restored.getPage('devonstation','independent-software/evidence/evidence');
   assert.equal(a.body,fx.source[0].body);
   assert.equal(b.body,fx.source[1].body);
   assert.equal(a.status,'draft');
   assert.ok(restored.getLinkedPages('devonstation',b.path)
     .some(x=>x.path===a.path&&x.direction==='incoming'&&x.kind==='supports'));
 }finally{restored.close();}
 for(let i=0;i<fx.source.length;i++)
   assert.deepEqual(await readFile(join(fx.root,fx.source[i].path)),originals[i]);
}));
test('G16 encrypted reader rejects wrong passphrase, ciphertext tampering and invalid archive',()=>withFixture(async fx=>{
 await writeEncryptedSyntheticStage(fx.args);
 const envelope=JSON.parse(await readFile(fx.outputFile,'utf8'));
 assert.throws(()=>verifyEncryptedSyntheticStage(envelope,'wrong password but at least twenty-four bytes',{syntheticOnly:true}),{code:'INVALID_BACKUP'});
 assert.throws(()=>verifyEncryptedSyntheticStage(envelope,passphrase),{code:'PRIVATE_DATA_BLOCKED'});
 const altered=structuredClone(envelope);
 altered.ciphertext='A'+altered.ciphertext.slice(1);
 assert.throws(()=>verifyEncryptedSyntheticStage(altered,passphrase,{syntheticOnly:true}),{code:'INVALID_BACKUP'});
 const fake=encryptSnapshot({format:'wrong-document'},passphrase);
 assert.throws(()=>verifyEncryptedSyntheticStage(fake,passphrase,{syntheticOnly:true}),{code:'INVALID_ARCHIVE'});
}));
test('G16 refuses non-fictional, stale or incomplete original without any output',()=>withFixture(async fx=>{
 const originalPath=join(fx.root,fx.source[0].path);
 const privateText='# REAL SOURCE\nNot a fictional fixture.\n';
 await writeFile(originalPath,privateText,{mode:0o600});
 fx.args.preflight.entries[0].sha256=fingerprint(privateText);
 fx.args.preflight.entries[0].bytes=Buffer.byteLength(privateText);
 await assert.rejects(writeEncryptedSyntheticStage(fx.args),{code:'PRIVATE_DATA_BLOCKED'});
 assert.deepEqual(await readdir(fx.privateDir),[]);
 await writeFile(originalPath,fx.source[0].body,{mode:0o600});
 fx.args.preflight.entries[0].sha256=fingerprint(fx.source[0].body);
 fx.args.preflight.entries[0].bytes=Buffer.byteLength(fx.source[0].body);
 fx.args.classifications[0].title='Evidence';
 fx.args.classifications[0].recordType='evidence';
 await assert.rejects(writeEncryptedSyntheticStage(fx.args),{code:'ORGANIZATION_BLOCKED'});
 assert.deepEqual(await readdir(fx.privateDir),[]);
 fx.args.classifications[0].title='Knowledge';
 fx.args.classifications[0].recordType='project';
 await writeFile(originalPath,fx.source[0].body+'tamper',{mode:0o600});
 await assert.rejects(writeEncryptedSyntheticStage(fx.args),{code:'SOURCE_CHANGED'});
 assert.deepEqual(await readdir(fx.privateDir),[]);
}));
test('G16 no-clobber and wrong destination prevent publication',()=>withFixture(async fx=>{
 await assert.rejects(writeEncryptedSyntheticStage({...fx.args,syntheticOnly:false}),
   {code:'PRIVATE_DATA_BLOCKED'});
 await assert.rejects(writeEncryptedSyntheticStage({...fx.args,
   outputFile:join(fx.root,'forbidden.enc')}),{code:'UNSAFE_DESTINATION'});
 assert.deepEqual(await readdir(fx.privateDir),[]);
 const existing=Buffer.from('EXISTING CONTENT NOT TO REPLACE');
 await writeFile(fx.outputFile,existing,{mode:0o600});
 await assert.rejects(writeEncryptedSyntheticStage(fx.args),{code:'ALREADY_EXISTS'});
 assert.deepEqual(await readFile(fx.outputFile),existing);
}));
test('G16 symlinks, permissive directories, permissive ciphertext and invalid output extension fail closed',()=>withFixture(async fx=>{
 await assert.rejects(writeEncryptedSyntheticStage({...fx.args,
   outputFile:join(fx.privateDir,'stage.sqlite')}),{code:'INVALID_INPUT'});
 const alias=join(fx.outer,'alias');
 await symlink(fx.privateDir,alias);
 await assert.rejects(writeEncryptedSyntheticStage({...fx.args,
   outputFile:join(alias,'bad.enc')}),{code:'UNSAFE_DESTINATION'});
 await chmod(fx.privateDir,0o755);
 await assert.rejects(writeEncryptedSyntheticStage(fx.args),{code:'UNSAFE_DESTINATION'});
 await chmod(fx.privateDir,0o700);
 await writeEncryptedSyntheticStage(fx.args);
 await chmod(fx.outputFile,0o644);
 await assert.rejects(inspectEncryptedSyntheticStage({
   encryptedFile:fx.outputFile,passphrase,syntheticOnly:true}),{code:'UNSAFE_ENVELOPE'});
}));
