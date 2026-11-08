import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,chmod,mkdir,writeFile,readFile,readdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encryptSnapshot} from '../src/backup.mjs';
import {preflightNotionCapture} from '../src/notion-capture-preflight.mjs';

const PAGE='11111111-1111-1111-1111-111111111111';
const DATA='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PASS='a fictional private archive passphrase longer than 24 bytes';
const TOKEN='synthetic-no-live-notion-token';
const CLI=fileURLToPath(new URL('../src/notion-capture-preflight-cli.mjs',import.meta.url));
const props={Title:{type:'title',title:[{type:'text',plain_text:'DO NOT PRINT SYNTHETIC PRIVATE DATA'}]}};
const inventory={format:'knowledge-notion-api-source-metadata-v1',
 identityFingerprint:'a'.repeat(64),
 records:[{sourceId:PAGE.replaceAll('-',''),scope:'anevum',
   register:'canon-articles',dataSourceId:DATA.replaceAll('-',''),
   sourceUrl:'https://www.notion.so/'+PAGE.replaceAll('-',''),
   lastEdited:'2026-11-06T12:00:00.000Z',
   parent:{type:'data_source_id',data_source_id:DATA},
   properties:props,unresolvedRelations:0,archived:false,inTrash:false}]};
const selection={format:'knowledge-notion-content-selection-v1',
 mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',sourceIds:[PAGE]};
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'knowledge-preflight-'));
 await chmod(root,0o700);
 const folder=join(root,'vault');await mkdir(folder,{mode:0o700});
 const inventoryFile=join(root,'inventory.enc');
 const selectionFile=join(root,'selection.json');
 const outputFile=join(folder,'sample.enc');
 await writeFile(inventoryFile,JSON.stringify(encryptSnapshot(inventory,PASS)),
   {mode:0o600});
 await writeFile(selectionFile,JSON.stringify(selection),{mode:0o600});
 return {root,folder,inventoryFile,selectionFile,outputFile};
}
async function withFixture(action){
 const fx=await fixture();try{return await action(fx)}
 finally{await rm(fx.root,{recursive:true,force:true})}
}
const args=fx=>({inventoryFile:fx.inventoryFile,
 selectionFile:fx.selectionFile,outputFile:fx.outputFile,
 passphrase:PASS,token:TOKEN});
test('G21 offline preflight verifies protected inputs, selected pages and no production authorization',
 ()=>withFixture(async fx=>{
 const report=await preflightNotionCapture(args(fx));
 assert.equal(report.localPreflightPassed,true);
 assert.equal(report.selectedPages,1);
 assert.equal(report.selectedSourceRegisters,1);
 assert.equal(report.fileByteCaptureSelected,false);
 assert.equal(report.separateRuntimeTokenConfigured,true);
 assert.equal(report.privateRehearsalAuthorized,false);
 assert.equal(report.restrictedEgressVerified,false);
 assert.equal(report.independentRestoreVerified,false);
 assert.equal(report.productionReady,false);
 assert.equal(report.liveCapturePerformed,false);
 assert.deepEqual(await readdir(fx.folder),[]);
 assert.ok(!JSON.stringify(report).includes(PAGE));
 assert.ok(!JSON.stringify(report).includes('DO NOT PRINT'));
 const child=spawnSync(process.execPath,[CLI,fx.inventoryFile,fx.selectionFile,fx.outputFile],{
   encoding:'utf8',env:{...process.env,KNOWLEDGE_BACKUP_PASSPHRASE:PASS,
     NOTION_API_TOKEN:TOKEN},
 });
 assert.equal(child.status,0,child.stderr);
 assert.equal(JSON.parse(child.stdout).localPreflightPassed,true);
 assert.equal(child.stderr,'');
 assert.ok(!child.stdout.includes(PAGE));
 assert.ok(!child.stdout.includes(TOKEN));
 assert.deepEqual(await readdir(fx.folder),[]);
}));
test('G21 missing runtime token reports lack of prerequisite without claiming readiness',
 ()=>withFixture(async fx=>{
 const report=await preflightNotionCapture({...args(fx),token:undefined});
 assert.equal(report.separateRuntimeTokenConfigured,false);
 assert.equal(report.localPreflightPassed,false);
 assert.equal(report.privateRehearsalAuthorized,false);
 const child=spawnSync(process.execPath,[CLI,fx.inventoryFile,fx.selectionFile,fx.outputFile],{
   encoding:'utf8',env:{...process.env,KNOWLEDGE_BACKUP_PASSPHRASE:PASS,
     NOTION_API_TOKEN:''},
 });
 assert.equal(child.status,0,child.stderr);
 assert.equal(JSON.parse(child.stdout).localPreflightPassed,false);
}));
test('G21 rejects wrong password, changed sensitivity scope, nonexistent or repeated source',
 ()=>withFixture(async fx=>{
 await assert.rejects(()=>preflightNotionCapture({...args(fx),
   passphrase:'wrong fictional password over 24 bytes long'}),
   {code:'INVALID_BACKUP'});
 for(const invalid of [
   {...selection,scope:'cristy'},
   {...selection,sourceIds:[]},
   {...selection,sourceIds:[PAGE,PAGE]},
   {...selection,sourceIds:['33333333-3333-3333-3333-333333333333']},
 ]){
   await writeFile(fx.selectionFile,JSON.stringify(invalid),{mode:0o600});
   await assert.rejects(()=>preflightNotionCapture(args(fx)));
 }
 assert.deepEqual(await readdir(fx.folder),[]);
}));
test('G21 protects private files and output directory, never overwrites existing evidence',
 ()=>withFixture(async fx=>{
 const valid=args(fx);
 await chmod(fx.selectionFile,0o644);
 await assert.rejects(()=>preflightNotionCapture(valid),{code:'PRIVATE_INPUT_REQUIRED'});
 await chmod(fx.selectionFile,0o600);
 await chmod(fx.inventoryFile,0o644);
 await assert.rejects(()=>preflightNotionCapture(valid),{code:'UNSAFE_STORAGE'});
 await chmod(fx.inventoryFile,0o600);
 await chmod(fx.folder,0o755);
 await assert.rejects(()=>preflightNotionCapture(valid),{code:'UNSAFE_STORAGE'});
 await chmod(fx.folder,0o700);
 const link=join(fx.root,'linked');await symlink(fx.folder,link);
 await assert.rejects(()=>preflightNotionCapture({...valid,
   outputFile:join(link,'new.enc')}),{code:'UNSAFE_STORAGE'});
 await writeFile(fx.outputFile,'keep existing evidence',{mode:0o600});
 await assert.rejects(()=>preflightNotionCapture(valid),{code:'ALREADY_EXISTS'});
 assert.equal(await readFile(fx.outputFile,'utf8'),'keep existing evidence');
}));
test('G21 rejects unapproved attachment hosts and requires exact optional configuration',
 ()=>withFixture(async fx=>{
 for(const hosts of [[],['evil.example.com'],['file.notion.so','file.notion.so']]){
   await writeFile(fx.selectionFile,JSON.stringify({...selection,
     captureNotionFiles:true,approvedNotionFileHosts:hosts}),{mode:0o600});
   await assert.rejects(()=>preflightNotionCapture(args(fx)));
 }
 await writeFile(fx.selectionFile,JSON.stringify({...selection,
   captureNotionFiles:true,approvedNotionFileHosts:['file.notion.so']}),{mode:0o600});
 const report=await preflightNotionCapture(args(fx));
 assert.equal(report.approvedFileHostCount,1);
 assert.equal(report.fileByteCaptureSelected,true);
 assert.equal(report.restrictedEgressVerified,false);
 assert.deepEqual(await readdir(fx.folder),[]);
}));
test('G21 never makes a source HTTP request even if global fetch fails or a URL is supplied',
 ()=>withFixture(async fx=>{
 const original=globalThis.fetch;
 let count=0;
 globalThis.fetch=async()=>{count++;throw Error('Network must not be used')};
 try{
   const report=await preflightNotionCapture(args(fx));
   assert.equal(report.localPreflightPassed,true);
   assert.equal(count,0);
 }finally{globalThis.fetch=original}
}));
