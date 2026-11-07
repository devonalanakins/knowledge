#!/usr/bin/env node
/**
 * G20C — owner-local, offline encrypted Notion archive inspection.
 * Reads one protected .enc file, decrypts in process memory, checks internal
 * source/file provenance and emits only aggregate evidence and release NO-GOs.
 * This is NOT a recovery into the live Knowledge database.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readProtectedEnvelope,verifyEncryptedNotionContent} from './notion-content-cli.mjs';

function fail(code,message){const error=new Error(message);error.code=code;throw error;}
export async function inspectEncryptedNotionContentArchive({
 archiveFile,passphrase,
}={}){
 if(typeof archiveFile!=='string'||!archiveFile.trim()||
   !archiveFile.endsWith('.enc'))
   fail('INVALID_ARGS','One protected Notion content .enc archive path is required');
 const input=resolve(archiveFile);
 const ciphertext=await readProtectedEnvelope(input);
 const report=verifyEncryptedNotionContent(ciphertext,passphrase);
 return {...report,encryptedArchiveInspected:true,
   independentSourceCertified:false,attachmentCoverageCertified:false,
   productionReady:false,notionCutoverApproved:false};
}
export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==1)fail('INVALID_ARGS',
  'Usage: notion:api:verify-content PRIVATE_CONTENT.enc');
 process.umask(0o077);
 const report=await inspectEncryptedNotionContentArchive({
  archiveFile:args[0],passphrase:env.KNOWLEDGE_BACKUP_PASSPHRASE,
 });
 process.stdout.write(JSON.stringify(report)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
   const code=typeof error.code==='string'&&/^[A-Z_]{3,50}$/.test(error.code)?
     error.code:'CONTENT_VERIFY_FAILED';
   process.stderr.write(code+
     ': Protected content archive inspection failed; no source was modified\n');
   process.exitCode=1;
 });
}
