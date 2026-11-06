import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,chmod,mkdir,stat,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {decryptSnapshot} from '../src/backup.mjs';
import {writePrivateOrganizationReview} from '../src/organization-review-cli.mjs';

const A='11111111111111111111111111111111';
const passphrase='synthetic high entropy laboratory review key 2026';
const confidentialTitle='PRIVATE_SYNTHETIC_SUBJECT_NOT_FOR_LOGS';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'knowledge-g11-'));
 await chmod(root,0o700);
 const privateDir=join(root,'protected');
 await mkdir(privateDir,{mode:0o700});
 const inputs=[
  {format:'knowledge-notion-preflight-v1',summary:{workspaceCoverageVerified:false},
   entries:[{originalNotionId:A,parentNotionId:null,type:'markdown',sha256:'a'.repeat(64),
    bytes:50,missingLocalLinks:0,remoteNotionLinks:0}]},
  {format:'knowledge-notion-inventory-v1',enumerationComplete:true,
   records:[{id:A,kind:'page',scope:'devonstation',accessible:true}]},
  [{id:A,title:confidentialTitle,portal:'independent-software',
    recordType:'project',status:'active',sourceUrl:'https://example.org/fictional',links:[]}]
 ];
 const paths=[];
 for(let i=0;i<3;i++){
  const path=join(root,['preflight.json','inventory.json','classifications.json'][i]);
  await writeFile(path,JSON.stringify(inputs[i]),{mode:0o600});paths.push(path);
 }
 return {root,privateDir,paths,inputs,output:join(privateDir,'review.enc')};
}
const options=fx=>({preflightFile:fx.paths[0],inventoryFile:fx.paths[1],
 classificationFile:fx.paths[2],outputFile:fx.output,passphrase});
const cleanup=async fx=>rm(fx.root,{recursive:true,force:true});
test('G11 produces a private encrypted review; stdout contains only aggregate counts',async()=>{
 const fx=await fixture();
 try{
  const cli=spawnSync(process.execPath,['src/organization-review-cli.mjs',...fx.paths,fx.output],
   {cwd:process.cwd(),env:{...process.env,KNOWLEDGE_BACKUP_PASSPHRASE:passphrase},encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);
  assert.equal(cli.stderr,'');
  assert.doesNotMatch(cli.stdout,/PRIVATE_SYNTHETIC_SUBJECT|111111111111111111111111/);
  const summary=JSON.parse(cli.stdout);
  assert.equal(summary.imported,false);
  assert.equal(summary.cutoverApproved,false);
  assert.ok(summary.blockingFindings>=1);
  const st=await stat(fx.output);
  assert.equal(st.mode&0o777,0o600);
  const cipher=await readFile(fx.output,'utf8');
  assert.doesNotMatch(cipher,/PRIVATE_SYNTHETIC_SUBJECT|111111111111111111111111/);
  const plan=decryptSnapshot(JSON.parse(cipher),passphrase);
  assert.equal(plan.nodes[0].title,confidentialTitle);
  assert.equal(plan.mode,'METADATA_ONLY_PRIVATE_REVIEW');
  assert.equal(plan.imported,false);
  assert.deepEqual((await readdir(fx.privateDir)),['review.enc']);
 }finally{await cleanup(fx)}
});
test('G11 refuses overwrite, retaining the original encrypted review',async()=>{
 const fx=await fixture();
 try{
  const first=await writePrivateOrganizationReview(options(fx));
  assert.equal(first.encryptedPlanWritten,true);
  const before=await readFile(fx.output);
  await assert.rejects(()=>writePrivateOrganizationReview(options(fx)),{code:'EEXIST'});
  assert.deepEqual(await readFile(fx.output),before);
  assert.deepEqual(await readdir(fx.privateDir),['review.enc']);
 }finally{await cleanup(fx)}
});
test('G11 rejects world-readable, symlinked and unreadable trust inputs',async()=>{
 const fx=await fixture();
 try{
  await chmod(fx.paths[0],0o644);
  await assert.rejects(()=>writePrivateOrganizationReview(options(fx)),{code:'PRIVATE_INPUT_REQUIRED'});
  await chmod(fx.paths[0],0o600);
  await symlink(fx.paths[1],join(fx.root,'alias.json'));
  await assert.rejects(()=>writePrivateOrganizationReview({
   ...options(fx),inventoryFile:join(fx.root,'alias.json')
  }),{code:'PRIVATE_INPUT_REQUIRED'});
  const bad=await fixture();
  try{
   const missing={...options(bad),passphrase:'short'};
   await assert.rejects(()=>writePrivateOrganizationReview(missing),{code:'INVALID_INPUT'});
   assert.deepEqual(await readdir(bad.privateDir),[]);
  }finally{await cleanup(bad)}
 }finally{await cleanup(fx)}
});
test('G11 refuses an unprotected output directory before writing anything',async()=>{
 const fx=await fixture();
 try{
  await chmod(fx.privateDir,0o755);
  await assert.rejects(()=>writePrivateOrganizationReview(options(fx)),{code:'UNSAFE_OUTPUT'});
  assert.deepEqual(await readdir(fx.privateDir),[]);
 }finally{await cleanup(fx)}
});
