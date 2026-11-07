#!/usr/bin/env node
/**
 * G17: encrypted, metadata-only Notion eligibility review.
 * Reads only separately supplied private JSON manifests; never opens original
 * Notion page contents or writes to Knowledge. No import action exists here.
 */
import {constants} from 'node:fs';
import {lstat,realpath,mkdtemp,chmod,link,rm,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateJson} from './organization-review-cli.mjs';
import {assessNotionSourceEligibility} from './notion-eligibility.mjs';
import {encryptSnapshot} from './backup.mjs';

function fail(code,message){const e=new Error(message);e.code=code;throw e;}
export async function writeEncryptedNotionEligibilityReview({
 preflightFile,inventoryFile,classificationFile,handlingFile,policyFile,
 outputFile,passphrase,
}={}){
 const paths=[preflightFile,inventoryFile,classificationFile,handlingFile,policyFile,outputFile];
 if(paths.some(p=>typeof p!=='string'||!p.trim()))
   fail('INVALID_ARGS','Five private JSON inputs and a separate encrypted output are required');
 const sourcePaths=paths.slice(0,5).map(p=>resolve(p)),dest=resolve(outputFile);
 if(!dest.endsWith('.enc')||sourcePaths.includes(dest)||new Set(sourcePaths).size!==sourcePaths.length)
   fail('UNSAFE_OUTPUT','Encrypted output must differ from all private input files');
 const parent=dirname(dest),st=await lstat(parent);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
    (typeof process.getuid==='function'&&st.uid!==process.getuid())||
    await realpath(parent)!==parent)
   fail('UNSAFE_OUTPUT','Output must be within an owner-only real directory');
 try{await lstat(dest);fail('ALREADY_EXISTS','Encrypted output already exists');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const [preflight,inventory,classifications,handling,policy]=await Promise.all(
   sourcePaths.map(privateJson));
 const review=assessNotionSourceEligibility({
   preflight,inventory,classifications,handling,policy,
 });
 const envelope=encryptSnapshot(review,passphrase);
 const temp=await mkdtemp(join(parent,'.knowledge-eligibility-'));
 try{
   await chmod(temp,0o700);
   const tempFile=join(temp,'review.enc');
   await writeFile(tempFile,JSON.stringify(envelope)+'\n',{flag:'wx',mode:0o600});
   // Atomic no-clobber publication; only ciphertext is ever persisted here.
   await link(tempFile,dest);
 }finally{await rm(temp,{recursive:true,force:true});}
 return {format:review.format,mode:review.mode,summary:review.totals,
   encryptedReportWritten:true,realDataImportAuthorized:false,
   importExecuted:false,cutoverApproved:false};
}
export async function main(args=process.argv.slice(2),environment=process.env){
 if(args.length!==6)fail('INVALID_ARGS',
   'Usage: notion:eligibility PREFLIGHT.json INVENTORY.json CLASSIFICATIONS.json HANDLING.json POLICY.json REVIEW.enc');
 process.umask(0o077);
 const result=await writeEncryptedNotionEligibilityReview({
   preflightFile:args[0],inventoryFile:args[1],classificationFile:args[2],
   handlingFile:args[3],policyFile:args[4],outputFile:args[5],
   passphrase:environment.KNOWLEDGE_BACKUP_PASSPHRASE,
 });
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
   const known=new Set(['INVALID_ARGS','UNSAFE_OUTPUT','ALREADY_EXISTS','INVALID_POLICY',
     'INVALID_REVIEW_INPUT','INVALID_BACKUP','INVALID_INPUT','QUOTA_EXCEEDED',
     'PRIVATE_INPUT_REQUIRED','SOURCE_CHANGED','INVALID_INVENTORY']);
   process.stderr.write((known.has(error.code)?error.code:'ELIGIBILITY_FAILED')+
     ': Private eligibility review failed; inspect local input, access, and safety gates\n');
   process.exitCode=1;
 });
}
