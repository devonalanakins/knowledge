import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,chmod,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encryptSnapshot} from '../src/backup.mjs';
import {inspectEncryptedNotionContentArchive} from '../src/notion-content-verify-cli.mjs';

const PASS='synthetic temporary test archive password with more than 24 bytes';
const PAGE='11111111-1111-1111-1111-111111111111';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const secret='HIDDEN SYNTHETIC PRIVATE ARTICLE';
const cli=fileURLToPath(new URL('../src/notion-content-verify-cli.mjs',import.meta.url));
function archive({reference=false}={}){
 const source={sourceId:PAGE,page:{id:PAGE,properties:{
  Title:{type:'title',title:[{type:'text',plain_text:secret}]},
  ...(reference?{File:{type:'files',files:[{
    type:'file',file:{notionSignedDownloadUrlOmitted:true},
  }]}}:{}),
 }},blocks:[],resolvedRelationProperties:[],warnings:[]};
 const body={format:'knowledge-notion-private-content-batch-v1',
   pages:[{...source,contentSha256:hash(source)}],
   counts:{pages:1,blocks:0,resolvedRelationItems:0,
     capturedAttachmentFiles:0,capturedAttachmentBytes:0,
     unresolvedReferences:0},
   attachments:[],mediaBytesCaptured:false,
   attachmentCoverageCertified:false,
   realDataImported:false,cutoverApproved:false};
 return {...body,archiveSha256:hash(body)};
}
async function fixture(source=archive()){
 const directory=await mkdtemp(join(tmpdir(),'knowledge-g20c-'));
 await chmod(directory,0o700);
 const file=join(directory,'private.enc');
 await writeFile(file,JSON.stringify(encryptSnapshot(source,PASS))+'\n',
   {mode:0o600,flag:'wx'});
 return {directory,file};
}
async function withFixture(handler,source=archive()){
 const fx=await fixture(source);
 try{await handler(fx)}finally{await rm(fx.directory,{force:true,recursive:true})}
}
test('G20C private offline inspection emits only aggregate, no content, and never needs Notion token',
 ()=>withFixture(async({file})=>{
 const report=await inspectEncryptedNotionContentArchive({
  archiveFile:file,passphrase:PASS,
 });
 assert.equal(report.verified,true);
 assert.equal(report.encryptedArchiveInspected,true);
 assert.equal(report.notionFileReferences,0);
 assert.equal(report.missingNotionFileBytes,0);
 assert.equal(report.selectedSourceFileReferencesAccounted,true);
 assert.equal(report.independentSourceCertified,false);
 assert.equal(report.attachmentCoverageCertified,false);
 assert.equal(report.productionReady,false);
 assert.equal(report.notionCutoverApproved,false);
 assert.ok(!JSON.stringify(report).includes(secret));
 assert.ok(!JSON.stringify(report).includes(PAGE));
 const child=spawnSync(process.execPath,[cli,file],{
  env:{...process.env,KNOWLEDGE_BACKUP_PASSPHRASE:PASS,
    NOTION_API_TOKEN:''},encoding:'utf8',
 });
 assert.equal(child.status,0,child.stderr);
 const printed=JSON.parse(child.stdout);
 assert.equal(printed.verified,true);
 assert.equal(printed.notionCutoverApproved,false);
 assert.ok(!child.stdout.includes(secret));
 assert.ok(!child.stdout.includes(PAGE));
 assert.equal(child.stderr,'');
}));
test('G20C offline inspector reports missing attachment bytes instead of certifying completeness',
 ()=>withFixture(async({file})=>{
 const result=await inspectEncryptedNotionContentArchive({
  archiveFile:file,passphrase:PASS,
 });
 assert.equal(result.notionFileReferences,1);
 assert.equal(result.missingNotionFileBytes,1);
 assert.equal(result.selectedSourceFileReferencesAccounted,false);
 assert.equal(result.independentSourceCertified,false);
 },archive({reference:true})));
test('G20C private inspection rejects world-readable files, incorrect password and tampering',
 ()=>withFixture(async({file})=>{
 await assert.rejects(()=>inspectEncryptedNotionContentArchive({
  archiveFile:file,passphrase:'incorrect synthetic password with more than 24 bytes',
 }),{code:'INVALID_BACKUP'});
 await chmod(file,0o644);
 await assert.rejects(()=>inspectEncryptedNotionContentArchive({
  archiveFile:file,passphrase:PASS,
 }),{code:'UNSAFE_STORAGE'});
 await chmod(file,0o600);
 const saved=JSON.parse(await readFile(file,'utf8'));
 saved.ciphertext=(saved.ciphertext[0]==='A'?'B':'A')+saved.ciphertext.slice(1);
 await writeFile(file,JSON.stringify(saved)+'\n',{mode:0o600});
 await assert.rejects(()=>inspectEncryptedNotionContentArchive({
  archiveFile:file,passphrase:PASS,
 }),{code:'INVALID_BACKUP'});
 const child=spawnSync(process.execPath,[cli,file],{
  env:{...process.env,KNOWLEDGE_BACKUP_PASSPHRASE:PASS},
  encoding:'utf8',
 });
 assert.notEqual(child.status,0);
 assert.equal(child.stdout,'');
 assert.ok(!child.stderr.includes(secret));
 assert.ok(!child.stderr.includes(PAGE));
}));
test('G20C inspector rejects non-archive file paths before any read',async()=>{
 await assert.rejects(()=>inspectEncryptedNotionContentArchive({
  archiveFile:'/tmp/unspecified.json',passphrase:PASS,
 }),{code:'INVALID_ARGS'});
 const child=spawnSync(process.execPath,[cli],{
  env:{...process.env,KNOWLEDGE_BACKUP_PASSPHRASE:PASS},
  encoding:'utf8',
 });
 assert.notEqual(child.status,0);
 assert.equal(child.stdout,'');
});
