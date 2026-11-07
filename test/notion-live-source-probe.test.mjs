import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,chmod,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encryptSnapshot} from '../src/backup.mjs';
import {probeSelectedNotionSource} from '../src/notion-live-source-probe.mjs';
import {runProtectedNotionSourceProbe} from '../src/notion-live-source-probe-cli.mjs';

const PAGE='11111111-1111-1111-1111-111111111111';
const PAGE2='22222222-2222-2222-2222-222222222222';
const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ID=PAGE.replaceAll('-','');
const ID2=PAGE2.replaceAll('-','');
const SOURCE=DS.replaceAll('-','');
const PASS='synthetic G23 private source probe passphrase more than twenty four bytes';
const TOKEN='synthetic-notion-token-not-usable-for-any-real-access';
const NAME='PRIVATE SYNTHETIC NONCLINICAL NAME DO NOT PRINT';
const EDITED='2026-11-06T12:00:00.000Z';
const parent={type:'data_source_id',data_source_id:DS};
const properties={Title:{id:'title',type:'title',title:[
 {type:'text',plain_text:NAME,text:{content:NAME}},
]}};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const cli=fileURLToPath(new URL('../src/notion-live-source-probe-cli.mjs',import.meta.url));
const norm=x=>x.replaceAll('-','');
function inventoryFor(ids=[PAGE]){
 const records=ids.map((id,i)=>({
   sourceId:norm(id),dataSourceId:SOURCE,scope:'anevum',
   register:i===0?'canon-articles':'project-register',
   lastEdited:EDITED,parent,properties,sourceUrl:'https://www.notion.so/'+norm(id),
   unresolvedRelations:0,archived:false,inTrash:false,
 }));
 const immutable=records.map(record=>({
  id:record.sourceId,source:record.dataSourceId,
  edited:record.lastEdited,scope:record.scope,register:record.register,
  digest:hash(record.properties),
 })).sort((a,b)=>a.id.localeCompare(b.id));
 return {
  format:'knowledge-notion-api-source-metadata-v1',
  sourceApiVersion:'2025-09-03',
  scope:'EXPLICIT_CONFIG_ONLY',
  identityFingerprint:hash(immutable),
  uniqueSourceRecords:records.length,records,
 };
}
function selectionFor(ids=[PAGE]){
 return {format:'knowledge-notion-content-selection-v1',
   mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',
   sourceIds:ids};
}
function pageFor(id){
 return {
  object:'page',id,parent,last_edited_time:EDITED,
  url:'https://www.notion.so/'+norm(id),
  properties,archived:false,in_trash:false,
 };
}
function clientFor(ids=[PAGE],mutator=null){
 const requests=[];
 const byId=new Map(ids.map(id=>[norm(id),pageFor(id)]));
 return {requests,client:{request:async path=>{
  requests.push(path);
  const id=path.replace('/v1/pages/','');
  if(!path.startsWith('/v1/pages/')||!byId.has(id))
   throw Error('Only selected GET page routes are allowed in G23 tests');
  const response=JSON.parse(JSON.stringify(byId.get(id)));
  return mutator?mutator(response,requests.length):response;
 }}};
}
async function fixture({inventory=inventoryFor(),selection=selectionFor()}={}){
 const root=await mkdtemp(join(tmpdir(),'knowledge-g23-'));
 await chmod(root,0o700);
 const vault=join(root,'vault');await mkdir(vault,{mode:0o700});
 const inventoryFile=join(root,'original.enc'),
   selectionFile=join(root,'selected.json'),
   outputFile=join(vault,'reserved-output.enc');
 await writeFile(inventoryFile,JSON.stringify(encryptSnapshot(inventory,PASS)),
  {mode:0o600,flag:'wx'});
 await writeFile(selectionFile,JSON.stringify(selection),{mode:0o600,flag:'wx'});
 return {root,vault,inventoryFile,selectionFile,outputFile};
}
async function withFixture(fn,options={}){
 const fx=await fixture(options);
 try{return await fn(fx)}
 finally{await rm(fx.root,{recursive:true,force:true})}
}
const opts=(fx,client)=>({
 inventoryFile:fx.inventoryFile,selectionFile:fx.selectionFile,
 outputFile:fx.outputFile,passphrase:PASS,token:TOKEN,
 client,allowLiveRead:true,operatorReviewedNonclinicalSample:true,
});

test('G23 double-checks explicit Anevum source page metadata and returns aggregate-only evidence',
 ()=>withFixture(async fx=>{
 const spy=clientFor();
 const report=await runProtectedNotionSourceProbe(opts(fx,spy.client));
 assert.equal(report.selectedPagesCompared,1);
 assert.equal(report.selectedRegistersCompared,1);
 assert.equal(report.metadataReadRequests,2);
 assert.equal(report.encryptedInventoryFingerprintVerified,true);
 assert.equal(report.selectedPageIdentityMatched,true);
 assert.equal(report.selectedPageEditMarkersMatched,true);
 assert.equal(report.selectedPageParentMatched,true);
 assert.equal(report.selectedPagePropertiesMatched,true);
 assert.equal(report.blockBodiesRead,false);
 assert.equal(report.mediaBytesDownloaded,false);
 assert.equal(report.notionSourceMutated,false);
 assert.equal(report.sourcePermissionsCertified,false);
 assert.equal(report.independentNotionSourceCertified,false);
 assert.equal(report.privateRehearsalAuthorized,false);
 assert.equal(report.realSourceCaptureAuthorized,false);
 assert.equal(report.productionReady,false);
 assert.equal(report.cutoverApproved,false);
 assert.deepEqual(spy.requests,['/v1/pages/'+ID,'/v1/pages/'+ID]);
 assert.deepEqual(await readdir(fx.vault),[]);
 const printed=JSON.stringify(report);
 assert.ok(!printed.includes(ID)&&!printed.includes(PAGE));
 assert.ok(!printed.includes(NAME)&&!printed.includes(TOKEN));
}));
test('G23 checks each selected page twice and rejects edits after first pass',
 ()=>withFixture(async fx=>{
 const spy=clientFor([PAGE,PAGE2],(page,n)=>{
   if(n===3)page.last_edited_time='2026-11-06T13:00:00.000Z';
   return page;
 });
 await writeFile(fx.selectionFile,
   JSON.stringify(selectionFor([PAGE,PAGE2])),{mode:0o600});
 const inventory=inventoryFor([PAGE,PAGE2]);
 await writeFile(fx.inventoryFile,
   JSON.stringify(encryptSnapshot(inventory,PASS)),{mode:0o600});
 await assert.rejects(()=>runProtectedNotionSourceProbe(opts(fx,spy.client)),
  {code:'SOURCE_CHANGED'});
 assert.deepEqual(spy.requests,[
   '/v1/pages/'+ID,'/v1/pages/'+ID2,'/v1/pages/'+ID,
 ]);
 assert.deepEqual(await readdir(fx.vault),[]);
 }));
test('G23 fails closed on original page identity, parent, property, edit marker or archiving drift',
 ()=>withFixture(async fx=>{
 for(const change of [
   p=>{p.id=PAGE2},
   p=>{p.parent={type:'page_id',page_id:PAGE2}},
   p=>{p.properties.Title.title[0].plain_text='changed'},
   p=>{p.last_edited_time='2026-11-06T14:00:00Z'},
   p=>{p.archived=true},
 ]){
   const spy=clientFor([PAGE],change);
   await assert.rejects(()=>runProtectedNotionSourceProbe(opts(fx,spy.client)),
    {code:'SOURCE_CHANGED'});
   assert.equal(spy.requests.length,1);
 }
 assert.deepEqual(await readdir(fx.vault),[]);
 }));
test('G23 requires separate live-read opt-in and nonclinical sample review before I/O',
 ()=>withFixture(async fx=>{
 const spy=clientFor();
 await assert.rejects(()=>runProtectedNotionSourceProbe({
   ...opts(fx,spy.client),allowLiveRead:false,
 }),{code:'SOURCE_PROBE_NOT_AUTHORIZED'});
 await assert.rejects(()=>runProtectedNotionSourceProbe({
   ...opts(fx,spy.client),operatorReviewedNonclinicalSample:false,
 }),{code:'NONCLINICAL_REVIEW_REQUIRED'});
 await assert.rejects(()=>runProtectedNotionSourceProbe({
   ...opts(fx,spy.client),token:undefined,
 }),{code:'NOTION_TOKEN_REQUIRED'});
 assert.deepEqual(spy.requests,[]);
 assert.deepEqual(await readdir(fx.vault),[]);
 }));
test('G23 rejects a modified encrypted inventory fingerprint before network access',
 ()=>withFixture(async fx=>{
 const invalid=inventoryFor();
 invalid.identityFingerprint='a'.repeat(64);
 await writeFile(fx.inventoryFile,
   JSON.stringify(encryptSnapshot(invalid,PASS)),{mode:0o600});
 const spy=clientFor();
 await assert.rejects(()=>runProtectedNotionSourceProbe(opts(fx,spy.client)),
  {code:'INVENTORY_FINGERPRINT_MISMATCH'});
 assert.deepEqual(spy.requests,[]);
 }));
test('G23 rejects selection from a different scope before network access',
 ()=>withFixture(async fx=>{
 await writeFile(fx.selectionFile,
   JSON.stringify({...selectionFor(),scope:'cristy'}),{mode:0o600});
 const spy=clientFor();
 await assert.rejects(()=>runProtectedNotionSourceProbe(opts(fx,spy.client)),
  {code:'INVALID_SELECTION'});
 assert.deepEqual(spy.requests,[]);
 }));
test('G23 blocks unsafe input and reserved destination paths before network access',
 ()=>withFixture(async fx=>{
 const spy=clientFor();
 await chmod(fx.selectionFile,0o644);
 await assert.rejects(()=>runProtectedNotionSourceProbe(opts(fx,spy.client)),
  {code:'PRIVATE_INPUT_REQUIRED'});
 await chmod(fx.selectionFile,0o600);
 await writeFile(fx.outputFile,'existing protected evidence',{mode:0o600});
 await assert.rejects(()=>runProtectedNotionSourceProbe(opts(fx,spy.client)),
  {code:'ALREADY_EXISTS'});
 assert.deepEqual(spy.requests,[]);
 }));
test('G23 CLI refuses network access without both explicit operator opt-ins',
 ()=>withFixture(async fx=>{
 for(const [live,review] of [['',''],['I_APPROVE','']]){
 const child=spawnSync(process.execPath,
   [cli,fx.inventoryFile,fx.selectionFile,fx.outputFile],{
     encoding:'utf8',env:{...process.env,
       KNOWLEDGE_LIVE_NOTION_METADATA_PROBE:live,
       KNOWLEDGE_NONCLINICAL_SAMPLE_REVIEWED:review,
       KNOWLEDGE_BACKUP_PASSPHRASE:PASS,NOTION_API_TOKEN:TOKEN},
   });
 assert.notEqual(child.status,0);
 assert.equal(child.stdout,'');
 assert.ok(!child.stderr.includes(PAGE));
 assert.ok(!child.stderr.includes(NAME));
 assert.ok(!child.stderr.includes(TOKEN));
 }
 assert.deepEqual(await readdir(fx.vault),[]);
 }));
test('G23 pure probe always requires explicit selected inventory and returns no source identifiers',
 async()=>{
 const inventory=inventoryFor(),selection=selectionFor();
 const spy=clientFor();
 await assert.rejects(()=>probeSelectedNotionSource({
  inventory,selection,client:spy.client,allowRead:false,
 }),{code:'SOURCE_PROBE_NOT_AUTHORIZED'});
 assert.deepEqual(spy.requests,[]);
 });
