#!/usr/bin/env node
/**
 * Offline G11: write a PRIVATE encrypted organization review plan.
 * This CLI never imports Notion contents, updates the wiki, or prints identities.
 */
import {constants} from 'node:fs';
import {lstat,realpath,open,mkdtemp,chmod,link,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planOrganizedMigration} from './organization.mjs';
import {encryptSnapshot} from './backup.mjs';

const MAX_INPUT=16*1024*1024;
class PrivatePlanError extends Error {
 constructor(code,message){super(message);this.code=code;}
}
function fail(code,message){throw new PrivatePlanError(code,message);}
function approvedPrivateFile(st) {
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0) return false;
 if(typeof process.getuid==='function'&&st.uid!==process.getuid())return false;
 return true;
}
async function privateJson(name){
 const full=resolve(name),st=await lstat(full);
 if(!approvedPrivateFile(st)||st.size<2||st.size>MAX_INPUT||await realpath(full)!==full)
   fail('PRIVATE_INPUT_REQUIRED','Only regular owner-only input files within 16 MiB are accepted');
 const file=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat();
  if(!approvedPrivateFile(before)||before.size!==st.size)
    fail('PRIVATE_INPUT_REQUIRED','Private input changed or lacks owner-only permissions');
  const bytes=await file.readFile();
  const after=await file.stat();
  if(!approvedPrivateFile(after)||bytes.byteLength!==before.size||before.ino!==after.ino||
     before.mtimeMs!==after.mtimeMs)fail('SOURCE_CHANGED','Private input changed during read');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('INVALID_INPUT','Private input must contain valid UTF-8 JSON');}
 }finally{await file.close();}
}
/**
 * Writes a fresh encrypted envelope via no-clobber hard link. Parent must be a
 * real owner-only directory. Nothing is written inside the source exports.
 */
export async function writePrivateOrganizationReview({preflightFile,inventoryFile,classificationFile,outputFile,passphrase,trustedReviewersFile=null}){
 if([preflightFile,inventoryFile,classificationFile,outputFile].some(x=>typeof x!=='string'||!x.trim()))
   fail('INVALID_ARGS','Four explicit local file paths are required');
 if(trustedReviewersFile!==null && (typeof trustedReviewersFile!=='string'||!trustedReviewersFile.trim()))
   fail('INVALID_ARGS','Trusted reviewer file must be an explicit private JSON path');
 const paths=[preflightFile,inventoryFile,classificationFile,...(trustedReviewersFile?[trustedReviewersFile]:[])].map(x=>resolve(x)),
   dest=resolve(outputFile);
 if(!dest.endsWith('.enc')||paths.includes(dest))fail('UNSAFE_OUTPUT','Choose a separate .enc output file');
 const parent=dirname(dest),st=await lstat(parent);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
    typeof process.getuid==='function'&&st.uid!==process.getuid()||
    await realpath(parent)!==parent) fail('UNSAFE_OUTPUT','Output parent must be a real owner-only directory');
 const inputs=await Promise.all(paths.map(privateJson));
 const [preflight,inventory,classifications,trustFile]=inputs;
 let trustedReviewers={},approvalOptions={};
 if(trustedReviewersFile){
   if(!trustFile||trustFile.format!=='knowledge-hierarchy-trust-v1'||
      !trustFile.reviewers||typeof trustFile.reviewers!=='object'||
      Array.isArray(trustFile.reviewers)||
      !Array.isArray(trustFile.consumedIds)||!Array.isArray(trustFile.revokedIds)||
      trustFile.consumedIds.length>10000||trustFile.revokedIds.length>10000||
      [...trustFile.consumedIds,...trustFile.revokedIds].some(
       x=>typeof x!=='string'||!/^[a-f0-9]{32}$/.test(x)))
     fail('INVALID_TRUST_FILE','Invalid protected hierarchy reviewer trust/ledger file');
   trustedReviewers=trustFile.reviewers;
   approvalOptions={consumedIds:new Set(trustFile.consumedIds),
     revokedIds:new Set(trustFile.revokedIds)};
 }
 const plan=planOrganizedMigration({preflight,inventory,classifications,trustedReviewers,approvalOptions});
 const envelope=encryptSnapshot(plan,passphrase);
 const temp=await mkdtemp(join(parent,'.knowledge-review-'));
 try{
  await chmod(temp,0o700);
  const draft=join(temp,'plan.enc');
  await writeFile(draft,JSON.stringify(envelope)+'\n',{flag:'wx',mode:0o600});
  await link(draft,dest); // atomic no-clobber; never replaces an existing plan
 }finally{await rm(temp,{recursive:true,force:true});}
 return {format:plan.format,encryptedPlanWritten:true,classificationCounts:plan.counts,
   blockingFindings:plan.blockingFindings,reviewFindings:plan.findings.length-plan.blockingFindings,
   imported:false,sourceCoverageCertified:false,cutoverApproved:false};
}
export async function main(args=process.argv.slice(2),environment=process.env){
 if(args.length!==4 && args.length!==5)
   fail('INVALID_ARGS','Usage: organization:review PREVIEW.json INVENTORY.json CLASSIFICATIONS.json OUTPUT.enc [TRUSTED_REVIEWERS.json]');
 process.umask(0o077);
 const result=await writePrivateOrganizationReview({
  preflightFile:args[0],inventoryFile:args[1],classificationFile:args[2],outputFile:args[3],
  passphrase:environment.KNOWLEDGE_BACKUP_PASSPHRASE,
  trustedReviewersFile:args[4]??null,
 });
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(e=>{
  const known=e instanceof PrivatePlanError||
    ['INVALID_BACKUP','INVALID_INPUT','QUOTA_EXCEEDED'].includes(e?.code);
  process.stderr.write((known?e.code:'REVIEW_FAILED')+': '+
    (known?e.message:'Private review failed; check input shape and permissions')+'\n');
  process.exitCode=1;
 });
}
