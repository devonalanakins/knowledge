#!/usr/bin/env node
/**
 * G22 — offline reconciliation of independently encrypted source inventory
 * and selected Notion content capture. No network, import or disk restore.
 * The authenticated archives must be stored in owner-only directories.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decryptSnapshot} from './backup.mjs';
import {readProtectedEnvelope,verifyEncryptedNotionContent} from './notion-content-cli.mjs';
import {reconcileNotionInventoryWithContent} from './notion-dual-archive-reconcile.mjs';

function reject(code,message){const error=new Error(message);error.code=code;throw error;}
export async function inspectEncryptedNotionArchivePair({
 inventoryFile,contentFile,passphrase,
}={}){
 if(typeof inventoryFile!=='string'||typeof contentFile!=='string'||
   !inventoryFile.trim()||!contentFile.trim()||
   !inventoryFile.endsWith('.enc')||!contentFile.endsWith('.enc'))
   reject('INVALID_ARGS','Two distinct protected .enc archive paths required');
 const source=resolve(inventoryFile),captured=resolve(contentFile);
 if(source===captured)reject('INVALID_ARGS','Inventory and content must be different files');
 const [inventoryEnvelope,contentEnvelope]=await Promise.all([
   readProtectedEnvelope(source),readProtectedEnvelope(captured),
 ]);
 const contentCheck=verifyEncryptedNotionContent(contentEnvelope,passphrase);
 const sourceData=decryptSnapshot(inventoryEnvelope,passphrase);
 const contentData=decryptSnapshot(contentEnvelope,passphrase);
 const compared=reconcileNotionInventoryWithContent(sourceData,contentData);
 return {
   ...compared,
   encryptedArchivesIndividuallyVerified:true,
   encryptedArchivePairReconciled:true,
   selectedNotionFileReferences:contentCheck.notionFileReferences,
   missingSelectedNotionFileBytes:contentCheck.missingNotionFileBytes,
   unsupportedSelectedExternalFiles:contentCheck.unsupportedExternalFiles,
   pendingSelectedUploadFiles:contentCheck.pendingUploadFiles,
   selectedSourceFileReferencesAccounted:
     contentCheck.selectedSourceFileReferencesAccounted,
   independentRealNotionReadPerformed:false,
   sourcePermissionsCertified:false,
   independentlyRestoredIntoKnowledge:false,
   productionReady:false,cutoverApproved:false,
 };
}
export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==2)reject('INVALID_ARGS',
   'Usage: notion:api:reconcile-archives INVENTORY.enc CONTENT.enc');
 process.umask(0o077);
 const report=await inspectEncryptedNotionArchivePair({
   inventoryFile:args[0],contentFile:args[1],
   passphrase:env.KNOWLEDGE_BACKUP_PASSPHRASE,
 });
 process.stdout.write(JSON.stringify(report)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
   const code=typeof error.code==='string'&&/^[A-Z_]{3,50}$/.test(error.code)?
     error.code:'ARCHIVE_RECONCILIATION_FAILED';
   process.stderr.write(code+
     ': Protected offline archive reconciliation failed; no source was modified\n');
   process.exitCode=1;
 });
}
