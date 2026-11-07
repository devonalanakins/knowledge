import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {chmod,readFile,readdir,symlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {
 PASSPHRASE,PAGE,PAGE2,makeSyntheticVault,
} from './support/notion-private-offline-fixture.mjs';
import {
 inspectPrivateOfflineVault,readPassphraseFromStdin,
} from '../src/notion-private-offline-runner.mjs';

const runner=fileURLToPath(new URL('../src/notion-private-offline-runner.mjs',import.meta.url));
const paths=fx=>({
 inventoryFile:fx.inventoryFile,selectionFile:fx.selectionFile,
 contentFile:fx.contentFile,reservedOutputFile:fx.reservedOutputFile,
 passphrase:PASSPHRASE,
});
async function withVault(callback,options={}){
 const fx=await makeSyntheticVault(options);
 try{return await callback(fx)}
 finally{await fx.cleanup()}
}
test('G24 offline private vault verifies G18/G22 and exact G21 selection with no writes',
 ()=>withVault(async fx=>{
 const originalFetch=globalThis.fetch;
 let requestCount=0;
 globalThis.fetch=async()=>{
  requestCount++;
  throw new Error('Offline runner must not make network requests');
 };
 try{
  const report=await inspectPrivateOfflineVault(paths(fx));
  assert.equal(report.encryptedInventoryVerified,true);
  assert.equal(report.encryptedContentVerified,true);
  assert.equal(report.selectedArchivesReconciled,true);
  assert.equal(report.sourceSelectionMatchesArchive,true);
  assert.equal(report.selectedPages,1);
  assert.equal(report.notionFileReferences,0);
  assert.equal(report.missingNotionFileBytes,0);
  assert.equal(report.notionTokenRead,false);
  assert.equal(report.networkRequestsMade,false);
  assert.equal(report.contentArchiveWritten,false);
  assert.equal(report.knowledgeRecordsModified,false);
  assert.equal(report.sourcePermissionsCertified,false);
  assert.equal(report.runtimeNetworkIsolationIndependentlyCertified,false);
  assert.equal(report.productionReady,false);
  assert.equal(report.cutoverApproved,false);
  assert.equal(requestCount,0);
  assert.deepEqual((await readdir(fx.vault)).sort(),
   ['content.enc','inventory.enc','selection.json']);
  assert.ok(!JSON.stringify(report).includes(PAGE.replaceAll('-','')));
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC SECRET'));
 }finally{globalThis.fetch=originalFetch}
 }));
test('G24 standalone CLI reads passphrase only from stdin; stdout is aggregate-only',
 ()=>withVault(async fx=>{
 const child=spawnSync(process.execPath,[runner,
   fx.inventoryFile,fx.selectionFile,fx.contentFile,fx.reservedOutputFile,
 ],{input:PASSPHRASE,encoding:'utf8',
   env:{...process.env,NOTION_API_TOKEN:'FAKE_LEAK_DETECTOR_TOKEN'},
 });
 assert.equal(child.status,0,child.stderr);
 const report=JSON.parse(child.stdout);
 assert.equal(report.sourceSelectionMatchesArchive,true);
 assert.equal(report.networkRequestsMade,false);
 assert.equal(report.productionReady,false);
 assert.equal(child.stderr,'');
 assert.ok(!child.stdout.includes(PASSPHRASE));
 assert.ok(!child.stdout.includes('FAKE_LEAK_DETECTOR_TOKEN'));
 assert.ok(!child.stdout.includes(PAGE));
 assert.ok(!child.stdout.includes('SYNTHETIC SECRET'));
 assert.deepEqual((await readdir(fx.vault)).sort(),
   ['content.enc','inventory.enc','selection.json']);
 }));
test('G24 rejects valid but differently selected encrypted content snapshot',
 ()=>withVault(async fx=>{
 await assert.rejects(()=>inspectPrivateOfflineVault(paths(fx)),
  {code:'SELECTION_ARCHIVE_MISMATCH'});
 },{ids:[PAGE,PAGE2],selected:PAGE2,captured:PAGE}));
test('G24 rejects missing reserved output clearance, private input violations and symlinks',
 ()=>withVault(async fx=>{
 await chmod(fx.contentFile,0o644);
 await assert.rejects(()=>inspectPrivateOfflineVault(paths(fx)),
  {code:'UNSAFE_STORAGE'});
 await chmod(fx.contentFile,0o600);
 const replacement=fx.vault+'/symlink.enc';
 await symlink(fx.contentFile,replacement);
 await assert.rejects(()=>inspectPrivateOfflineVault({
   ...paths(fx),contentFile:replacement,
 }),{code:'UNSAFE_STORAGE'});
 await readFile(fx.inventoryFile);
 await assert.rejects(()=>inspectPrivateOfflineVault({
   ...paths(fx),reservedOutputFile:fx.contentFile,
 }),{code:'INVALID_ARGS'});
 await assert.rejects(()=>inspectPrivateOfflineVault({
   ...paths(fx),reservedOutputFile:fx.inventoryFile,
 }),{code:'INVALID_ARGS'});
 }));
test('G24 rejects invalid passphrases and plaintext stdin injection',
 async()=>{
 const valid=await readPassphraseFromStdin(
  Readable.from([Buffer.from(PASSPHRASE)]));
 assert.equal(valid,PASSPHRASE);
 for(const unsafe of [
  PASSPHRASE+'\n',PASSPHRASE+'\r',PASSPHRASE+'\0','short',
 ]){
  await assert.rejects(()=>readPassphraseFromStdin(
   Readable.from([Buffer.from(unsafe)])),{code:'INVALID_PASSPHRASE_INPUT'});
 }
 await assert.rejects(()=>readPassphraseFromStdin(
  Readable.from([Buffer.alloc(8193,65)])),
  {code:'INVALID_PASSPHRASE_INPUT'});
 });
test('G24 bad input never emits private source content or writes recovered files',
 ()=>withVault(async fx=>{
 const wrong=spawnSync(process.execPath,[
  runner,fx.inventoryFile,fx.selectionFile,fx.contentFile,
  fx.reservedOutputFile,
 ],{input:'incorrect private password that is long enough',encoding:'utf8'});
 assert.notEqual(wrong.status,0);
 assert.equal(wrong.stdout,'');
 assert.ok(!wrong.stderr.includes(PAGE));
 assert.ok(!wrong.stderr.includes(PASSPHRASE));
 assert.ok(!wrong.stderr.includes('SYNTHETIC SECRET'));
 assert.deepEqual((await readdir(fx.vault)).sort(),
  ['content.enc','inventory.enc','selection.json']);
 }));
