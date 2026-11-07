import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,writeFile,readFile,readdir,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptSnapshot,decryptSnapshot} from '../src/backup.mjs';
import {writeEncryptedNotionContent,verifyEncryptedNotionContent} from '../src/notion-content-cli.mjs';

const A='11111111-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222';
const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const normalize=id=>id.replaceAll('-','');
const PASS='synthetic read-only export passphrase longer than twenty four utf8 bytes';
const PROPS={Name:{type:'title',title:[{type:'text',plain_text:'PRIVATE SYNTHETIC ARTICLE'}]}};
const URL='https://www.notion.so/'+normalize(A);
const parent={type:'data_source_id',data_source_id:DS};
const last='2026-11-06T12:00:00.000Z';
const inventory={
 format:'knowledge-notion-api-source-metadata-v1',identityFingerprint:'b'.repeat(64),
 records:[{sourceId:normalize(A),register:'canon-encyclopedia',
   scope:'anevum',dataSourceId:normalize(DS),sourceUrl:URL,
   lastEdited:last,parent,properties:PROPS,
   archived:false,inTrash:false,unresolvedRelations:0}],
 };
const selection={format:'knowledge-notion-content-selection-v1',
 mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',sourceIds:[A]};
function client(){
 const calls=[];
 return {calls,request:async path=>{
   calls.push(path);
   if(path==='/v1/pages/'+normalize(A))
     return {object:'page',id:A,parent,url:URL,last_edited_time:last,
       properties:PROPS,archived:false,in_trash:false};
   if(path==='/v1/blocks/'+normalize(A)+'/children?page_size=100')
     return {results:[{object:'block',id:B,type:'paragraph',has_children:false,
       paragraph:{rich_text:[{type:'text',plain_text:'SENSITIVE FICTIONAL BLOCK',
         text:{content:'SENSITIVE FICTIONAL BLOCK'}}]}}],
       has_more:false,next_cursor:null};
   throw Error('Unexpected path in synthetic fixture '+path);
 }};
}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'knowledge-g19-'));
 await chmod(root,0o700);
 const folder=join(root,'private');await mkdir(folder,{mode:0o700});
 const inventoryFile=join(root,'source.enc');
 const selectionFile=join(root,'selection.json');
 const outputFile=join(folder,'content.enc');
 await writeFile(inventoryFile,JSON.stringify(encryptSnapshot(inventory,PASS)),{mode:0o600});
 await writeFile(selectionFile,JSON.stringify(selection),{mode:0o600});
 return {root,folder,inventoryFile,selectionFile,outputFile};
}
async function withFixture(action){
 const fx=await fixture();
 try{return await action(fx);}finally{await rm(fx.root,{recursive:true,force:true})}
}
test('G19 real-content handoff stores ciphertext only and reconstructs native blocks after decryption',()=>withFixture(async fx=>{
 const api=client();
 const result=await writeEncryptedNotionContent({...fx,passphrase:PASS,client:api});
 assert.equal(result.verified,true);
 assert.equal(result.capturedPages,1);
 assert.equal(result.capturedBlocks,1);
 assert.equal(result.encryptedArchiveWritten,true);
 assert.equal(result.realDataImported,false);
 assert.equal(result.productionReady,false);
 assert.deepEqual(await readdir(fx.folder),['content.enc']);
 assert.equal((await lstat(fx.outputFile)).mode&0o777,0o600);
 const saved=await readFile(fx.outputFile,'utf8');
 assert.match(saved,/"aes-256-gcm"/);
 assert.ok(!saved.includes('PRIVATE SYNTHETIC ARTICLE'));
 assert.ok(!saved.includes('SENSITIVE FICTIONAL BLOCK'));
 assert.ok(!saved.includes(normalize(A)));
 const restored=decryptSnapshot(JSON.parse(saved),PASS);
 assert.equal(restored.pages[0].blocks[0].block.paragraph.rich_text[0].plain_text,
   'SENSITIVE FICTIONAL BLOCK');
 assert.equal(verifyEncryptedNotionContent(JSON.parse(saved),PASS).verified,true);
 assert.equal(restored.sourceCoverageCertified,false);
 assert.equal(restored.originalHistoryPreserved,false);
 assert.equal(api.calls.filter(x=>x.includes('/v1/pages/')).length,3);
}));
test('G19 wrong passphrase, symlink and permissive input/output are rejected before publishing',()=>withFixture(async fx=>{
 const base={...fx,passphrase:PASS,client:client()};
 await assert.rejects(()=>writeEncryptedNotionContent({...base,passphrase:
   'different fake password over 24 bytes long'}),{code:'INVALID_BACKUP'});
 assert.deepEqual(await readdir(fx.folder),[]);
 await chmod(fx.selectionFile,0o644);
 await assert.rejects(()=>writeEncryptedNotionContent(base),{code:'PRIVATE_INPUT_REQUIRED'});
 await chmod(fx.selectionFile,0o600);
 const linkDir=join(fx.root,'alias');await symlink(fx.folder,linkDir);
 await assert.rejects(()=>writeEncryptedNotionContent({
   ...base,outputFile:join(linkDir,'payload.enc')}),{code:'UNSAFE_STORAGE'});
 await chmod(fx.folder,0o755);
 await assert.rejects(()=>writeEncryptedNotionContent(base),{code:'UNSAFE_STORAGE'});
 await chmod(fx.folder,0o700);
 assert.deepEqual(await readdir(fx.folder),[]);
}));
test('G19 no-clobber, unauthorized selection, and changed original block prevent output',()=>withFixture(async fx=>{
 const base={...fx,passphrase:PASS,client:client()};
 await writeFile(fx.outputFile,'DO NOT OVERWRITE',{mode:0o600});
 await assert.rejects(()=>writeEncryptedNotionContent(base),{code:'ALREADY_EXISTS'});
 assert.equal(await readFile(fx.outputFile,'utf8'),'DO NOT OVERWRITE');
 await rm(fx.outputFile);
 await writeFile(fx.selectionFile,JSON.stringify({
   ...selection,mode:'ALL_WORKSPACE'}),{mode:0o600});
 await assert.rejects(()=>writeEncryptedNotionContent(base),{code:'INVALID_SELECTION'});
 assert.deepEqual(await readdir(fx.folder),[]);
}));
test('G19 complete post-seal source recheck catches change before final encrypted publication',()=>withFixture(async fx=>{
 let request=0;
 const api=client();
 const original=api.request;
 api.request=async path=>{
   if(path.includes('/v1/pages/')){
     request++;
     if(request===3){
       return {object:'page',id:A,parent,url:URL,
         last_edited_time:'2026-11-06T17:00:00.000Z',properties:PROPS};
     }
   }
   return original(path);
 };
 await assert.rejects(()=>writeEncryptedNotionContent({
   ...fx,passphrase:PASS,client:api,
 }),{code:'SOURCE_CHANGED'});
 assert.deepEqual(await readdir(fx.folder),[]);
}));
test('G19 encrypted archive verifier fails for altered ciphertext and forged archive digest',()=>withFixture(async fx=>{
 await writeEncryptedNotionContent({...fx,passphrase:PASS,client:client()});
 const original=JSON.parse(await readFile(fx.outputFile,'utf8'));
 const tampered=structuredClone(original);
 tampered.ciphertext=(original.ciphertext[0]==='A'?'B':'A')+original.ciphertext.slice(1);
 assert.throws(()=>verifyEncryptedNotionContent(tampered,PASS),{code:'INVALID_BACKUP'});
 const archive=decryptSnapshot(original,PASS);
 const changed=structuredClone(archive);
 changed.pages[0].page.icon='new';
 const forged=encryptSnapshot(changed,PASS);
 assert.throws(()=>verifyEncryptedNotionContent(forged,PASS),{code:'INVALID_ARCHIVE'});
}));

function relationRecoveryClient({changeAfterSeal=false}={}){
 const related={...PROPS,Related:{id:'rel',type:'relation',
   has_more:true,relation:[{id:B}]}};
 const routes=[];
 let relationReads=0;
 return {props:related,routes,request:async path=>{
   routes.push(path);
   if(path==='/v1/pages/'+normalize(A))
     return {object:'page',id:A,parent,url:URL,last_edited_time:last,
       properties:related,archived:false,in_trash:false};
   if(path==='/v1/blocks/'+normalize(A)+'/children?page_size=100')
     return {object:'list',results:[],has_more:false,next_cursor:null};
   if(path==='/v1/pages/'+normalize(A)+'/properties/rel?page_size=100'){
     relationReads++;
     return {object:'list',has_more:false,next_cursor:null,results:[{
       object:'property_item',id:'rel',type:'relation',
       relation:{id:changeAfterSeal&&relationReads===2?
         '33333333-3333-3333-3333-333333333333':B},
     }]};
   }
   throw Error('Unexpected synthetic relation route '+path);
 }};
}
async function configureRelations(fx,api){
 const changed={...inventory,records:[{
   ...inventory.records[0],properties:api.props,unresolvedRelations:1,
 }]};
 await writeFile(fx.inventoryFile,
   JSON.stringify(encryptSnapshot(changed,PASS)),{mode:0o600});
 await writeFile(fx.selectionFile,JSON.stringify({
   ...selection,resolvePaginatedRelations:true,
 }),{mode:0o600});
}
test('G20 relation recovery is encrypted and independently revalidated before publication',
  ()=>withFixture(async fx=>{
 const api=relationRecoveryClient();
 await configureRelations(fx,api);
 const result=await writeEncryptedNotionContent({
   ...fx,passphrase:PASS,client:api,
 });
 assert.equal(result.verified,true);
 const saved=JSON.parse(await readFile(fx.outputFile,'utf8'));
 assert.equal(verifyEncryptedNotionContent(saved,PASS).verified,true);
 const restored=decryptSnapshot(saved,PASS);
 assert.equal(restored.counts.resolvedRelationItems,1);
 assert.deepEqual(restored.pages[0].resolvedRelationProperties[0].relatedPageIds,
   [normalize(B)]);
 assert.deepEqual(await readdir(fx.folder),['content.enc']);
 assert.equal(api.routes.filter(x=>x.includes('/properties/rel')).length,2);
 assert.equal(api.routes.filter(x=>x.includes('/v1/pages/')).length,5);
}));
test('G20 changing a relation after encryption aborts publication without leaking plaintext',
  ()=>withFixture(async fx=>{
 const api=relationRecoveryClient({changeAfterSeal:true});
 await configureRelations(fx,api);
 await assert.rejects(()=>writeEncryptedNotionContent({
   ...fx,passphrase:PASS,client:api,
 }),{code:'RELATION_SOURCE_CHANGED'});
 assert.deepEqual(await readdir(fx.folder),[]);
}));

const SAMPLE_URL='https://file.notion.so/synthetic?id=test-only-expiring-token';
const FILE_DATA=Buffer.from('FICTIONAL SOURCE FILE BYTES','utf8');
function fileCaptureClient(){
 const calls=[];
 return {calls,request:async path=>{
   calls.push(path);
   if(path==='/v1/pages/'+normalize(A))
     return {object:'page',id:A,parent,url:URL,last_edited_time:last,
       properties:PROPS,archived:false,in_trash:false};
   if(path==='/v1/blocks/'+normalize(A)+'/children?page_size=100')
     return {results:[{object:'block',id:B,type:'image',has_children:false,
       image:{type:'file',caption:[],file:{
         url:SAMPLE_URL,expiry_time:'2026-11-06T12:30:00.000Z',
       }}}],has_more:false,next_cursor:null};
   throw Error('Unexpected synthetic file API request '+path);
 }};
}
async function enableFileCapture(fx){
 await writeFile(fx.selectionFile,JSON.stringify({...selection,
   captureNotionFiles:true,approvedNotionFileHosts:['file.notion.so'],
 }),{mode:0o600});
}
test('G20B selected Notion asset bytes survive protected encrypted archive and independent recovery',
 ()=>withFixture(async fx=>{
 await enableFileCapture(fx);
 let requests=0;
 const result=await writeEncryptedNotionContent({...fx,passphrase:PASS,
   client:fileCaptureClient(),
   attachmentNow:()=>Date.parse('2026-11-06T12:00:00Z'),
   attachmentFetcher:async(uri,options)=>{
     requests++;
     assert.equal(uri,SAMPLE_URL);
     assert.equal(options.redirect,'error');
     assert.equal(options.credentials,'omit');
     return new Response(FILE_DATA,{status:200,headers:{
       'content-type':'application/pdf',
     }});
   },
 });
 assert.equal(requests,1);
 assert.equal(result.verified,true);
 assert.equal(result.capturedAttachmentFiles,1);
 assert.equal(result.capturedAttachmentBytes,FILE_DATA.length);
 assert.equal(result.mediaBytesCaptured,true);
 assert.equal(result.attachmentCoverageCertified,false);
 assert.equal(result.productionReady,false);
 assert.deepEqual(await readdir(fx.folder),['content.enc']);
 assert.equal((await lstat(fx.outputFile)).mode&0o777,0o600);
 const raw=await readFile(fx.outputFile,'utf8');
 assert.ok(!raw.includes('FICTIONAL SOURCE FILE'));
 assert.ok(!raw.includes('test-only-expiring-token'));
 assert.ok(!raw.includes(SAMPLE_URL));
 const envelope=JSON.parse(raw);
 const checked=verifyEncryptedNotionContent(envelope,PASS);
 assert.equal(checked.capturedAttachmentFiles,1);
 const recovered=decryptSnapshot(envelope,PASS);
 assert.equal(recovered.mediaBytesCaptured,true);
 assert.equal(recovered.attachmentCoverageCertified,false);
 assert.deepEqual(recovered.pages[0].warnings,[]);
 assert.equal(recovered.pages[0].blocks[0].block.image.file.notionSignedDownloadUrlOmitted,true);
 assert.equal(recovered.attachments[0].sourcePageId,normalize(A));
 assert.equal(recovered.attachments[0].sourceBlockId,normalize(B));
 assert.equal(Buffer.from(recovered.attachments[0].base64,'base64').toString(),
   FILE_DATA.toString());
 assert.equal(JSON.stringify(recovered).includes('test-only-expiring-token'),false);
}));
test('G20B denied download cannot publish partially prepared encrypted archive',
 ()=>withFixture(async fx=>{
 await enableFileCapture(fx);
 await assert.rejects(()=>writeEncryptedNotionContent({
   ...fx,passphrase:PASS,client:fileCaptureClient(),
   attachmentNow:()=>Date.parse('2026-11-06T12:00:00Z'),
   attachmentFetcher:async()=>new Response(null,{status:302,headers:{
     location:'https://127.0.0.1/private',
   }}),
 }),{code:'ASSET_DOWNLOAD_FAILED'});
 assert.deepEqual(await readdir(fx.folder),[]);
}));
test('G20B capture opt-in cannot proceed without reviewed Notion-host allowlist',
 ()=>withFixture(async fx=>{
 await writeFile(fx.selectionFile,JSON.stringify({...selection,
   captureNotionFiles:true,
 }),{mode:0o600});
 let called=0;
 await assert.rejects(()=>writeEncryptedNotionContent({
   ...fx,passphrase:PASS,client:fileCaptureClient(),
   attachmentFetcher:async()=>{called++;return new Response(FILE_DATA)},
 }),{code:'ASSET_HOSTS_REQUIRED'});
 assert.equal(called,0);
 assert.deepEqual(await readdir(fx.folder),[]);
}));
