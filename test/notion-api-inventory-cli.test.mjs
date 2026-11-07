import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,writeFile,readFile,readdir,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decryptSnapshot} from '../src/backup.mjs';
import {writeEncryptedNotionApiInventory} from '../src/notion-api-inventory-cli.mjs';

const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ID='11111111-1111-1111-1111-111111111111';
const PASS='fictional secret passphrase longer than the required minimum length';
const fixturePage={
 object:'page',id:ID,url:'https://www.notion.so/'+ID.replaceAll('-',''),
 last_edited_time:'2026-11-06T12:00:00.000Z',
 properties:{Name:{type:'title',title:[{plain_text:'SYNTHETIC PRIVATE TITLE'}]}},
 parent:{type:'data_source_id',data_source_id:DS},
};
const fakeClient={request:async(path,{method,body})=>{
 assert.match(path,/^\/v1\/data_sources\/[a-f0-9]+\/query$/);
 assert.equal(method,'POST');
 assert.equal(body.page_size,100);
 return {results:[fixturePage],has_more:false,next_cursor:null};
}};
async function setup(){
 const base=await mkdtemp(join(tmpdir(),'knowledge-g18-'));
 await chmod(base,0o700);
 const dest=join(base,'owner-only');await mkdir(dest,{mode:0o700});
 const configFile=join(base,'sources.json'),outputFile=join(dest,'source-metadata.enc');
 const config={format:'knowledge-notion-api-source-config-v1',registers:[
   {dataSourceId:DS,scope:'anevum',register:'canon-encyclopedia',expectedCount:1},
 ]};
 await writeFile(configFile,JSON.stringify(config),{mode:0o600});
 return {base,dest,configFile,outputFile,config};
}
async function withSetup(fn){
 const fx=await setup();
 try{return await fn(fx)}finally{await rm(fx.base,{recursive:true,force:true})}
}
test('G18 private CLI writes only encrypted Notion metadata and verifies restoration',()=>withSetup(async fx=>{
 const result=await writeEncryptedNotionApiInventory({
   configFile:fx.configFile,outputFile:fx.outputFile,
   passphrase:PASS,client:fakeClient,
 });
 assert.equal(result.uniqueSourceRecords,1);
 assert.equal(result.warningCount,0);
 assert.equal(result.realDataImported,false);
 assert.equal(result.cutoverApproved,false);
 assert.deepEqual(await readdir(fx.dest),['source-metadata.enc']);
 assert.equal((await lstat(fx.outputFile)).mode&0o777,0o600);
 const saved=await readFile(fx.outputFile,'utf8');
 assert.match(saved,/"aes-256-gcm"/);
 assert.ok(!saved.includes(ID.replaceAll('-','')));
 assert.ok(!saved.includes('SYNTHETIC PRIVATE TITLE'));
 const report=decryptSnapshot(JSON.parse(saved),PASS);
 assert.equal(report.records[0].sourceId,ID.replaceAll('-',''));
 assert.equal(report.records[0].properties.Name.title[0].plain_text,'SYNTHETIC PRIVATE TITLE');
 assert.equal(report.sourcePermissionsCertified,false);
}));
test('G18 private CLI fails closed for no-clobber, symlink and permissive config',()=>withSetup(async fx=>{
 await chmod(fx.configFile,0o644);
 await assert.rejects(()=>writeEncryptedNotionApiInventory({
   configFile:fx.configFile,outputFile:fx.outputFile,
   passphrase:PASS,client:fakeClient,
 }),{code:'PRIVATE_INPUT_REQUIRED'});
 assert.deepEqual(await readdir(fx.dest),[]);
 await chmod(fx.configFile,0o600);
 const linked=join(fx.base,'linked');await symlink(fx.dest,linked);
 await assert.rejects(()=>writeEncryptedNotionApiInventory({
   configFile:fx.configFile,outputFile:join(linked,'not-created.enc'),
   passphrase:PASS,client:fakeClient,
 }),{code:'UNSAFE_OUTPUT'});
 const prior=Buffer.from('EXISTING MUST REMAIN UNTOUCHED');
 await writeFile(fx.outputFile,prior,{mode:0o600});
 await assert.rejects(()=>writeEncryptedNotionApiInventory({
   configFile:fx.configFile,outputFile:fx.outputFile,
   passphrase:PASS,client:fakeClient,
 }),{code:'ALREADY_EXISTS'});
 assert.deepEqual(await readFile(fx.outputFile),prior);
}));
test('G18 rejects unsupported config and weak encryption passphrase without plaintext output',()=>withSetup(async fx=>{
 const unknown={...fx.config,token:'DONT_STORE_TOKEN_IN_CONFIG'};
 await writeFile(fx.configFile,JSON.stringify(unknown),{mode:0o600});
 await assert.rejects(()=>writeEncryptedNotionApiInventory({
   configFile:fx.configFile,outputFile:fx.outputFile,
   passphrase:PASS,client:fakeClient,
 }),{code:'INVALID_CONFIG'});
 assert.deepEqual(await readdir(fx.dest),[]);
 await writeFile(fx.configFile,JSON.stringify(fx.config),{mode:0o600});
 await assert.rejects(()=>writeEncryptedNotionApiInventory({
   configFile:fx.configFile,outputFile:fx.outputFile,
   passphrase:'short',client:fakeClient,
 }),{code:'INVALID_INPUT'});
 assert.deepEqual(await readdir(fx.dest),[]);
}));
