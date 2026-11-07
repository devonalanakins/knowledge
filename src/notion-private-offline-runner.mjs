#!/usr/bin/env node
/**
 * G24: verify a protected Notion source selection and its two encrypted
 * archives inside a network-disabled, read-only container.
 *
 * This is an OFFLINE verification entrypoint. It never accepts a Notion token,
 * makes HTTP requests, captures content, changes Knowledge, or writes files.
 * The passphrase arrives via stdin, not container arguments/environment.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateJson} from './organization-review-cli.mjs';
import {preflightNotionCapture} from './notion-capture-preflight.mjs';
import {readProtectedEnvelope} from './notion-content-cli.mjs';
import {decryptSnapshot} from './backup.mjs';
import {inspectEncryptedNotionArchivePair} from './notion-dual-archive-cli.mjs';

const INPUT_MAX_BYTES=8192;
const normalized=id=>id.replaceAll('-','').toLowerCase();
function reject(code,message){const error=new Error(message);error.code=code;throw error;}
function ensure(ok,code,message){if(!ok)reject(code,message);}

/**
 * The stream contains only the passphrase bytes and MUST be passed from a
 * private host prompt or protected secret source (no echo or log).
 */
export async function readPassphraseFromStdin(stream=process.stdin){
 const chunks=[];let total=0;
 for await(const chunk of stream){
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
  total+=bytes.length;
  if(total>INPUT_MAX_BYTES){
   for(const b of chunks)b.fill(0);
   bytes.fill(0);
   reject('INVALID_PASSPHRASE_INPUT','Passphrase stream exceeds safe limit');
  }
  chunks.push(bytes);
 }
 const payload=Buffer.concat(chunks,total);
 for(const b of chunks)b.fill(0);
 try{
  const value=new TextDecoder('utf-8',{fatal:true}).decode(payload);
  ensure(value.length>=24&&value.length<=INPUT_MAX_BYTES&&
    !/[\r\n\0]/.test(value),'INVALID_PASSPHRASE_INPUT',
    'Passphrase must be a single protected nonempty line');
  return value;
 }catch(error){
  if(error.code)throw error;
  reject('INVALID_PASSPHRASE_INPUT','Passphrase is not valid UTF-8');
 }finally{payload.fill(0)}
}

/**
 * The output reservation is checked by G21 but never created.
 * The G22 archive compare must agree with the owner's G21 selection too;
 * otherwise a valid but unrelated archive could be misrepresented as ready.
 */
export async function inspectPrivateOfflineVault({
 inventoryFile,selectionFile,contentFile,reservedOutputFile,passphrase,
}={}){
 ensure([inventoryFile,selectionFile,contentFile,reservedOutputFile]
   .every(x=>typeof x==='string'&&x.trim().length>0),
  'INVALID_ARGS','Four separate private vault paths required');
 const paths=[inventoryFile,selectionFile,contentFile,reservedOutputFile]
   .map(resolve);
 ensure(new Set(paths).size===4&&
   paths[0].endsWith('.enc')&&paths[1].endsWith('.json')&&
   paths[2].endsWith('.enc')&&paths[3].endsWith('.enc'),
  'INVALID_ARGS','Protected inputs and reserved destination must be distinct');

 // No token is accepted: G21 validates protection/selection but correctly
 // leaves its "ready for live capture" and token flags false.
 const preflight=await preflightNotionCapture({
  inventoryFile:paths[0],selectionFile:paths[1],
  outputFile:paths[3],passphrase,token:undefined,
 });
 ensure(preflight.protectedInputsVerified===true&&
   preflight.protectedOutputLocationVerified===true,
   'PRIVATE_PREFLIGHT_FAILED','Private source preflight failed');

 const checked=await inspectEncryptedNotionArchivePair({
  inventoryFile:paths[0],contentFile:paths[2],passphrase,
 });
 const [selected,archiveEnvelope]=await Promise.all([
  privateJson(paths[1]),readProtectedEnvelope(paths[2]),
 ]);
 const archive=decryptSnapshot(archiveEnvelope,passphrase);
 const expected=selected.sourceIds.map(normalized);
 ensure(Array.isArray(archive.sourceIds)&&
   archive.sourceIds.length===expected.length&&
   archive.sourceIds.every((id,index)=>
     typeof id==='string'&&normalized(id)===expected[index]),
   'SELECTION_ARCHIVE_MISMATCH',
   'Encrypted content is from a different owner-selected source batch');

 return {
  format:'knowledge-private-offline-review-v1',
  encryptedInventoryVerified:true,
  encryptedContentVerified:true,
  selectedArchivesReconciled:true,
  sourceSelectionMatchesArchive:true,
  selectedPages:checked.selectedPagesReconciled,
  originalInventoryPages:checked.originalInventoryPages,
  paginatedRelationProperties:checked.paginatedRelationPropertiesReconciled,
  notionFileReferences:checked.selectedNotionFileReferences,
  missingNotionFileBytes:checked.missingSelectedNotionFileBytes,
  unsupportedExternalFiles:checked.unsupportedSelectedExternalFiles,
  pendingUploadFiles:checked.pendingSelectedUploadFiles,
  selectedSourceFileReferencesAccounted:
    checked.selectedSourceFileReferencesAccounted,
  ownerOnlyInputPermissionsChecked:true,
  // A Docker runtime must enforce --network none and mount restrictions.
  // The offline JavaScript verifier cannot independently attest its host.
  runtimeNetworkIsolationIndependentlyCertified:false,
  privateRehearsalAuthorized:false,
  sourceOwnershipCertified:false,
  sourcePermissionsCertified:false,
  independentNotionSourceCertified:false,
  independentRestoreIntoKnowledgeVerified:false,
  notionTokenRead:false,networkRequestsMade:false,
  contentArchiveWritten:false,knowledgeRecordsModified:false,
  productionReady:false,cutoverApproved:false,
 };
}
export async function main(args=process.argv.slice(2),stream=process.stdin){
 if(args.length!==4)reject('INVALID_ARGS',
  'Usage: private-offline-runner INVENTORY.enc SELECTION.json CONTENT.enc RESERVED.enc');
 process.umask(0o077);
 const passphrase=await readPassphraseFromStdin(stream);
 const report=await inspectPrivateOfflineVault({
  inventoryFile:args[0],selectionFile:args[1],contentFile:args[2],
  reservedOutputFile:args[3],passphrase,
 });
 process.stdout.write(JSON.stringify(report)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
  const code=typeof error.code==='string'&&/^[A-Z_]{3,60}$/.test(error.code)?
   error.code:'OFFLINE_VERIFICATION_FAILED';
  process.stderr.write(code+
   ': Private offline archive verification failed; no files were changed\n');
  process.exitCode=1;
 });
}
