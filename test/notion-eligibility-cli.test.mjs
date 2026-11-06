import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,writeFile,readFile,readdir,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decryptSnapshot} from '../src/backup.mjs';
import {writeEncryptedNotionEligibilityReview} from '../src/notion-eligibility-cli.mjs';

const A='11111111111111111111111111111111';
const B='22222222222222222222222222222222';
const SHA='a'.repeat(64);
const passphrase='test synthetic source reviewer passphrase longer than twenty-four bytes';
function documents(){
 const preflight={format:'knowledge-notion-preflight-v1',
   summary:{workspaceCoverageVerified:true,byType:{markdown:2,html:0,database_csv:0,asset:0},
     databaseCsvRows:0,warnings:{}},
   entries:[
    {originalNotionId:A,parentNotionId:null,type:'markdown',sha256:SHA,bytes:50,
      missingLocalLinks:0,remoteNotionLinks:0},
    {originalNotionId:B,parentNotionId:A,type:'markdown',sha256:SHA,bytes:50,
      missingLocalLinks:0,remoteNotionLinks:0},
   ]};
 const inventory={format:'knowledge-notion-inventory-v1',
   enumerationComplete:true,records:[
    {id:A,kind:'page',scope:'devonstation',accessible:true},
    {id:B,kind:'page',scope:'devonstation',accessible:true},
   ]};
 const classifications=[
   {id:A,title:'Knowledge',portal:'independent-software',
     recordType:'project',status:'active',sourceUrl:'https://example.org/a',links:[]},
   {id:B,title:'Evidence',portal:'independent-software',
     recordType:'evidence',status:'verified',sourceUrl:'https://example.org/b',
     parentId:A,links:[{targetId:A,type:'supports'}]},
 ];
 const handling={format:'knowledge-notion-handling-v1',records:[
   {id:A,scope:'devonstation',sensitivity:'ordinary',ownership:'owner-controlled',disposition:'consider'},
   {id:B,scope:'devonstation',sensitivity:'ordinary',ownership:'owner-controlled',disposition:'consider'},
 ]};
 const policy={format:'knowledge-notion-eligibility-policy-v1',mode:'ASSESS_ONLY',
   scopes:['devonstation']};
 return [preflight,inventory,classifications,handling,policy];
}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'knowledge-g17-'));
 await chmod(root,0o700);
 const outDir=join(root,'review');
 await mkdir(outDir,{mode:0o700});
 const paths=['preflight','inventory','classifications','handling','policy']
   .map(n=>join(root,n+'.json'));
 const files=documents();
 for(let i=0;i<paths.length;i++)
   await writeFile(paths[i],JSON.stringify(files[i]),{mode:0o600});
 const outputFile=join(outDir,'eligibility.enc');
 const args={preflightFile:paths[0],inventoryFile:paths[1],
   classificationFile:paths[2],handlingFile:paths[3],policyFile:paths[4],
   outputFile,passphrase};
 return {root,outDir,paths,files,outputFile,args};
}
async function inFixture(action){
 const fx=await fixture();
 try{return await action(fx);}finally{await rm(fx.root,{recursive:true,force:true});}
}
test('G17 encrypted review writes ciphertext only and never claims data import readiness',()=>inFixture(async fx=>{
 const result=await writeEncryptedNotionEligibilityReview(fx.args);
 assert.equal(result.mode,'PRIVATE_METADATA_ASSESSMENT_ONLY');
 assert.equal(result.encryptedReportWritten,true);
 assert.equal(result.summary.assessmentCandidates,2);
 assert.equal(result.realDataImportAuthorized,false);
 assert.equal(result.importExecuted,false);
 assert.deepEqual(await readdir(fx.outDir),['eligibility.enc']);
 const body=await readFile(fx.outputFile,'utf8');
 assert.match(body,/"aes-256-gcm"/);
 assert.ok(!body.includes(A));
 assert.ok(!body.includes('independent-software'));
 assert.equal((await lstat(fx.outputFile)).mode&0o777,0o600);
 const report=decryptSnapshot(JSON.parse(body),passphrase);
 assert.equal(report.assessments.length,2);
 assert.equal(report.accessAndConsentVerified,false);
 assert.equal(report.cutoverApproved,false);
 assert.equal(report.assessments[0].sourceId,A);
}));
test('G17 privacy handling is encrypted and clinical exclusions remain visible after decrypting',()=>inFixture(async fx=>{
 fx.files[3].records[1].sensitivity='clinical';
 const secret='SYNTHETIC_PRIVATE_BODY_MUST_NOT_APPEAR';
 fx.files[3].records[0].body=secret;
 await writeFile(fx.paths[3],JSON.stringify(fx.files[3]),{mode:0o600});
 const result=await writeEncryptedNotionEligibilityReview(fx.args);
 assert.equal(result.summary.excludeOrArchive,1);
 const body=await readFile(fx.outputFile,'utf8');
 assert.ok(!body.includes(secret));
 const report=decryptSnapshot(JSON.parse(body),passphrase);
 assert.ok(report.assessments.some(x=>x.reasons.includes('CLINICAL_DATA_EXCLUDED')));
 assert.ok(!JSON.stringify(report).includes(secret));
 assert.equal(report.realDataImportAuthorized,false);
}));
test('G17 unsafe input permissions, output directory or missing password fail before publication',()=>inFixture(async fx=>{
 await chmod(fx.paths[2],0o644);
 await assert.rejects(()=>writeEncryptedNotionEligibilityReview(fx.args),
   {code:'PRIVATE_INPUT_REQUIRED'});
 assert.deepEqual(await readdir(fx.outDir),[]);
 await chmod(fx.paths[2],0o600);
 await chmod(fx.outDir,0o755);
 await assert.rejects(()=>writeEncryptedNotionEligibilityReview(fx.args),
   {code:'UNSAFE_OUTPUT'});
 await chmod(fx.outDir,0o700);
 await assert.rejects(()=>writeEncryptedNotionEligibilityReview({...fx.args,passphrase:'short'}),
   {code:'INVALID_INPUT'});
 assert.deepEqual(await readdir(fx.outDir),[]);
}));
test('G17 no-clobber and symlinked output paths cannot replace private data',()=>inFixture(async fx=>{
 const existing=Buffer.from('not overwritten');
 await writeFile(fx.outputFile,existing,{mode:0o600});
 await assert.rejects(()=>writeEncryptedNotionEligibilityReview(fx.args),{code:'ALREADY_EXISTS'});
 assert.deepEqual(await readFile(fx.outputFile),existing);
 const linked=join(fx.root,'symlinked-review');
 await symlink(fx.outDir,linked);
 await assert.rejects(()=>writeEncryptedNotionEligibilityReview({...fx.args,
   outputFile:join(linked,'other.enc')}),{code:'UNSAFE_OUTPUT'});
 await assert.rejects(()=>writeEncryptedNotionEligibilityReview({...fx.args,
   outputFile:fx.paths[0]}),{code:'UNSAFE_OUTPUT'});
}));
