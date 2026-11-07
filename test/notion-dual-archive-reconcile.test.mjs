import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,chmod,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encryptSnapshot} from '../src/backup.mjs';
import {reconcileNotionInventoryWithContent} from '../src/notion-dual-archive-reconcile.mjs';
import {inspectEncryptedNotionArchivePair} from '../src/notion-dual-archive-cli.mjs';

const PAGE='11111111-1111-1111-1111-111111111111';
const REL='22222222-2222-2222-2222-222222222222';
const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ID=PAGE.replaceAll('-','');
const SOURCE=DS.replaceAll('-','');
const LAST='2026-11-06T12:00:00.000Z';
const SOURCE_URL='https://www.notion.so/'+ID;
const PASS='only synthetic source material encrypted with an independent long password';
const PRIVATE_TITLE='PRIVATE SYNTHETIC SOURCE TITLE DO NOT LOG';
const parent={type:'data_source_id',data_source_id:DS};
const props={Title:{id:'title',type:'title',title:[
  {type:'text',plain_text:PRIVATE_TITLE,text:{content:PRIVATE_TITLE}},
]}};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cli=fileURLToPath(new URL('../src/notion-dual-archive-cli.mjs',import.meta.url));

function sourceInventory(properties=props){
 const record={sourceId:ID,dataSourceId:SOURCE,scope:'anevum',
   register:'canon-articles',lastEdited:LAST,parent,
   properties,sourceUrl:SOURCE_URL,unresolvedRelations:
     Object.values(properties).filter(x=>x.type==='relation'&&x.has_more===true).length,
   archived:false,inTrash:false};
 const immutable=[{id:ID,source:SOURCE,edited:LAST,scope:'anevum',
   register:'canon-articles',digest:hash(properties)}];
 return {format:'knowledge-notion-api-source-metadata-v1',
   sourceApiVersion:'2025-09-03',scope:'EXPLICIT_CONFIG_ONLY',
   identityFingerprint:hash(immutable),uniqueSourceRecords:1,records:[record],
   sourceCoverageCertified:false,sourcePermissionsCertified:false};
}
function contentArchive(inventory,{properties=inventory.records[0].properties,
  resolvedRelationProperties=[]}={}){
 const page={sourceId:ID,register:'canon-articles',scope:'anevum',
   dataSourceId:SOURCE,parent,sourceUrl:URL,lastEdited:LAST,
   page:{id:PAGE,parent,properties,icon:null,cover:null,
     created_time:null,last_edited_time:LAST},
   blocks:[],resolvedRelationProperties,relationPaginationRequests:0,
   referencedNotionIds:[],warnings:[],
   hierarchyReconstructed:false,externalFilesCaptured:false};
 const body={
   format:'knowledge-notion-private-content-batch-v1',
   mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',
   sourceInventoryFingerprint:inventory.identityFingerprint,
   sourceIds:[ID],pages:[{...page,contentSha256:hash(page)}],
   counts:{pages:1,blocks:0,resolvedRelationItems:
     resolvedRelationProperties.reduce((n,p)=>n+p.relatedPageIds.length,0),
     unresolvedReferences:0,capturedAttachmentFiles:0,capturedAttachmentBytes:0},
   attachments:[],warnings:[],plaintextDiskWritten:false,
   mediaBytesCaptured:false,attachmentCoverageCertified:false,
   externalPermissionsCertified:false,sourceCoverageCertified:false,
   originalHistoryPreserved:false,realDataImported:false,cutoverApproved:false,
 };
 return {...body,archiveSha256:hash(body)};
}
async function fixture(inventory=sourceInventory(),
  content=contentArchive(inventory)){
 const root=await mkdtemp(join(tmpdir(),'knowledge-g22-'));
 await chmod(root,0o700);
 const inventoryFile=join(root,'g18.enc'),contentFile=join(root,'content.enc');
 await writeFile(inventoryFile,JSON.stringify(encryptSnapshot(inventory,PASS))+'\n',
   {mode:0o600,flag:'wx'});
 await writeFile(contentFile,JSON.stringify(encryptSnapshot(content,PASS))+'\n',
   {mode:0o600,flag:'wx'});
 return {root,inventoryFile,contentFile};
}
async function withFixture(handler,inventory=sourceInventory(),
  content=contentArchive(inventory)){
 const fx=await fixture(inventory,content);
 try{return await handler(fx);}
 finally{await rm(fx.root,{recursive:true,force:true})}
}

test('G22 reconciles independently sealed G18 inventory and G19 source metadata without network',
 ()=>withFixture(async fx=>{
 const report=await inspectEncryptedNotionArchivePair({...fx,passphrase:PASS});
 assert.equal(report.selectedPagesReconciled,1);
 assert.equal(report.originalInventoryPages,1);
 assert.equal(report.paginatedRelationPropertiesReconciled,0);
 assert.equal(report.encryptedInventoryFingerprintVerified,true);
 assert.equal(report.selectedSourceMetadataConsistent,true);
 assert.equal(report.selectedSourcePropertiesConsistent,true);
 assert.equal(report.encryptedArchivePairReconciled,true);
 assert.equal(report.selectedSourceFileReferencesAccounted,true);
 assert.equal(report.independentNotionSourceCertified,false);
 assert.equal(report.sourcePermissionsCertified,false);
 assert.equal(report.dataImported,false);
 assert.equal(report.productionReady,false);
 assert.equal(report.cutoverApproved,false);
 assert.ok(!JSON.stringify(report).includes(PRIVATE_TITLE));
 assert.ok(!JSON.stringify(report).includes(ID));
 const result=spawnSync(process.execPath,[cli,fx.inventoryFile,fx.contentFile],{
   encoding:'utf8',env:{...process.env,NOTION_API_TOKEN:'',
     KNOWLEDGE_BACKUP_PASSPHRASE:PASS},
 });
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).selectedPagesReconciled,1);
 assert.ok(!result.stdout.includes(PRIVATE_TITLE));
 assert.ok(!result.stdout.includes(PAGE));
 assert.equal(result.stderr,'');
}));
test('G22 refuses incomplete inventory fingerprint even when its envelope is valid',()=>{
 const inventory=sourceInventory(),content=contentArchive(inventory);
 inventory.records[0].properties.Title.title[0].plain_text='changed';
 assert.throws(()=>reconcileNotionInventoryWithContent(inventory,content),
   {code:'INVENTORY_FINGERPRINT_MISMATCH'});
});
test('G22 rejects altered source page metadata and property drift independently',()=>{
 for(const change of [
   page=>{page.page.properties.Title.title[0].plain_text='tampered'},
   page=>{page.page.parent={type:'page_id',page_id:REL}},
   page=>{page.page.last_edited_time='2026-11-06T13:00:00Z'},
   page=>{page.register='wrong-register'},
   page=>{page.dataSourceId=REL},
 ]){
   const inventory=sourceInventory();
   const content=contentArchive(inventory);
   change(content.pages[0]);
   assert.throws(()=>reconcileNotionInventoryWithContent(inventory,content));
 }
});
test('G22 selected-source ordering, unknown page IDs and repeats are denied',()=>{
 const inventory=sourceInventory(),content=contentArchive(inventory);
 content.sourceIds=[REL.replaceAll('-','')];
 assert.throws(()=>reconcileNotionInventoryWithContent(inventory,content),
   {code:'SOURCE_SELECTION_MISMATCH'});
 const duplicate=contentArchive(inventory);
 duplicate.pages.push(structuredClone(duplicate.pages[0]));
 duplicate.sourceIds.push(ID);
 assert.throws(()=>reconcileNotionInventoryWithContent(inventory,duplicate),
   {code:'SOURCE_SELECTION_MISMATCH'});
 const unknown=contentArchive(inventory);
 unknown.pages[0].sourceId=REL.replaceAll('-','');
 unknown.sourceIds=[unknown.pages[0].sourceId];
 assert.throws(()=>reconcileNotionInventoryWithContent(inventory,unknown),
   {code:'SOURCE_SELECTION_MISMATCH'});
});
test('G22 paginated relation reconstruction preserves original inventoried prefix',()=>{
 const related={...props,Related:{id:'related',
   type:'relation',has_more:true,relation:[{id:REL}]}};
 const inventory=sourceInventory(related);
 const proper={propertyName:'Related',propertyId:'related',partialCount:1,
   complete:true,relatedPageIds:[REL.replaceAll('-','')]};
 const content=contentArchive(inventory,{resolvedRelationProperties:[{
   ...proper,sha256:hash(proper),
 }]});
 assert.equal(reconcileNotionInventoryWithContent(inventory,content)
   .paginatedRelationPropertiesReconciled,1);
 const altered=structuredClone(content);
 altered.pages[0].resolvedRelationProperties[0].relatedPageIds[0]=PAGE.replaceAll('-','');
 assert.throws(()=>reconcileNotionInventoryWithContent(inventory,altered),
   {code:'SOURCE_RELATION_MISMATCH'});
 const missing=contentArchive(inventory,{resolvedRelationProperties:[]});
 assert.throws(()=>reconcileNotionInventoryWithContent(inventory,missing),
   {code:'SOURCE_RELATION_MISMATCH'});
});
test('G22 only compares two protected ciphertext inputs and never logs secrets on failure',
 ()=>withFixture(async fx=>{
 await assert.rejects(()=>inspectEncryptedNotionArchivePair({
   ...fx,contentFile:fx.inventoryFile,passphrase:PASS,
 }),{code:'INVALID_ARGS'});
 await assert.rejects(()=>inspectEncryptedNotionArchivePair({
   ...fx,passphrase:'incorrect independent passphrase over 24 bytes',
 }),{code:'INVALID_BACKUP'});
 await chmod(fx.inventoryFile,0o644);
 await assert.rejects(()=>inspectEncryptedNotionArchivePair({
   ...fx,passphrase:PASS,
 }),{code:'UNSAFE_STORAGE'});
 await chmod(fx.inventoryFile,0o600);
 const raw=JSON.parse(await readFile(fx.contentFile,'utf8'));
 raw.ciphertext=(raw.ciphertext[0]==='A'?'B':'A')+raw.ciphertext.slice(1);
 await writeFile(fx.contentFile,JSON.stringify(raw)+'\n',{mode:0o600});
 await assert.rejects(()=>inspectEncryptedNotionArchivePair({
   ...fx,passphrase:PASS,
 }),{code:'INVALID_BACKUP'});
 const result=spawnSync(process.execPath,[cli,fx.inventoryFile,fx.contentFile],{
   encoding:'utf8',env:{...process.env,
     KNOWLEDGE_BACKUP_PASSPHRASE:PASS},
 });
 assert.notEqual(result.status,0);
 assert.equal(result.stdout,'');
 assert.ok(!result.stderr.includes(PRIVATE_TITLE));
 assert.ok(!result.stderr.includes(ID));
}));
