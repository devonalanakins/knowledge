/**
 * G21 — local-only Notion capture readiness preflight.
 * No network requests, no Notion reads, no writable source operations.
 * Answers whether bounded private capture prerequisites exist, NOT whether
 * content is authorized or an independent network/permission review passed.
 */
import {constants} from 'node:fs';
import {lstat,realpath,open} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {privateJson} from './organization-review-cli.mjs';
import {readProtectedEnvelope} from './notion-content-cli.mjs';
import {decryptSnapshot} from './backup.mjs';
import {validateInventory} from './notion-content-export.mjs';

const MAX_FILE_BYTES=40_000_000;
function reject(code,message){const e=new Error(message);e.code=code;throw e;}
function requireValid(condition,code,message){if(!condition)reject(code,message);}
async function ownerDirectory(name){
 const path=resolve(name),st=await lstat(path);
 requireValid(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&
   await realpath(path)===path&&
   (typeof process.getuid!=='function'||st.uid===process.getuid()),
   'UNSAFE_STORAGE','Private output parent must be a real owner-controlled directory');
 return path;
}
async function safeDestination(file,inputPaths){
 const target=resolve(file),dir=await ownerDirectory(dirname(target));
 requireValid(target.endsWith('.enc')&&!inputPaths.includes(target),
   'UNSAFE_OUTPUT','New .enc output must not overlap an input');
 try{
  const stat=await lstat(target);
  if(stat)reject('ALREADY_EXISTS','Private output path already exists');
 }catch(error){if(error.code!=='ENOENT')throw error}
 return dir;
}
function tokenPresent(token){
 return typeof token==='string'&&token.length>=8&&token.length<=2048&&
   !/[\r\n]/.test(token);
}
/**
 * Even a "readyForPrivateRehearsal" response is deliberately false: the
 * runtime has not proved real Notion source consent, DNS/egress, source ACL,
 * provider file host compatibility, or completed an independent restore.
 */
export async function preflightNotionCapture({
 inventoryFile,selectionFile,outputFile,passphrase,token,
}={}){
 requireValid([inventoryFile,selectionFile,outputFile].every(x=>
   typeof x==='string'&&x.trim()),'INVALID_ARGS',
 'Protected inventory, owner selection and new .enc output are required');
 const input=resolve(inventoryFile),selectionPath=resolve(selectionFile),
   destination=resolve(outputFile);
 requireValid(new Set([input,selectionPath,destination]).size===3&&
   input.endsWith('.enc')&&selectionPath.endsWith('.json'),
   'UNSAFE_OUTPUT','Three distinct .enc/.json/.enc paths required');
 await safeDestination(destination,[input,selectionPath]);
 const [encrypted,selection]=await Promise.all([
   readProtectedEnvelope(input),privateJson(selectionPath),
 ]);
 const inventory=decryptSnapshot(encrypted,passphrase);
 const chosen=validateInventory(inventory,selection);
 requireValid(chosen.length>=1&&chosen.length<=8,'INVALID_SELECTION',
   'Protected source selection exceeds allowed page count');
 const hasPaginatedRelations=chosen.some(x=>x.unresolvedRelations>0);
 const opts={relations:selection.resolvePaginatedRelations===true,
   files:selection.captureNotionFiles===true};
 let approvedHosts=0;
 if(opts.files){
   const hosts=selection.approvedNotionFileHosts;
   requireValid(Array.isArray(hosts)&&hosts.length>=1&&hosts.length<=4&&
     hosts.every(x=>typeof x==='string'&&x.length>0)&&
     new Set(hosts).size===hosts.length,
     'ASSET_HOSTS_REQUIRED','Explicit private file host allowlist required');
   approvedHosts=hosts.length;
 }
 const keyOk=tokenPresent(token);
 return {
   format:'knowledge-notion-capture-preflight-v1',
   selectedPages:chosen.length,
   selectedSourceRegisters:new Set(chosen.map(x=>x.register)).size,
   paginatedRelationPages:chosen.filter(x=>x.unresolvedRelations>0).length,
   relationPaginationSelected:opts.relations,
   fileByteCaptureSelected:opts.files,
   approvedFileHostCount:approvedHosts,
   protectedInputsVerified:true,
   protectedOutputLocationVerified:true,
   encryptedInventoryOpened:true,
   separateRuntimeTokenConfigured:keyOk,
   localPreflightPassed:keyOk,
   // Operator attestation alone is NOT proof of independent network safety.
   restrictedEgressVerified:false,sourcePermissionCertified:false,
   independentNotionSourceVerified:false,independentRestoreVerified:false,
   privateRehearsalAuthorized:false,liveCapturePerformed:false,
   dataImported:false,productionReady:false,cutoverApproved:false,
 };
}
