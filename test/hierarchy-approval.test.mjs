import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {HIERARCHY_RECEIPT_FORMAT,signHierarchyApproval,verifyHierarchyApproval} from '../src/hierarchy-approval.mjs';
import {planOrganizedMigration} from '../src/organization.mjs';

const A='11111111111111111111111111111111',B='22222222222222222222222222222222';
const SHA=createHash('sha256').update('SYNTHETIC ORIGINAL').digest('hex');
const ISSUED='2026-11-06T12:00:00.000Z',EXPIRES='2026-11-13T12:00:00.000Z';
const NOW=Date.parse('2026-11-06T13:00:00.000Z');
const path='independent-software/evidence/source-evidence';
const reason='Move fictional source to the reviewed evidence subject register';
const pair=generateKeyPairSync('ed25519');
const privateKeyPem=pair.privateKey.export({format:'pem',type:'pkcs8'});
const publicKeyPem=pair.publicKey.export({format:'pem',type:'spki'});
const trust=Object.freeze({'owner-key-1':{enabled:true,scopes:['devonstation'],publicKeyPem}});
function values(overrides={}){
 return {approvalId:'abcdefabcdefabcdefabcdefabcdefab',signerId:'owner-key-1',
  issuedAt:ISSUED,expiresAt:EXPIRES,sourceId:B,scope:'devonstation',
  sourceSha256:SHA,fromParentId:A,toParentId:null,toPath:path,reason,...overrides};
}
function expected(){const {sourceId,scope,sourceSha256,fromParentId,toParentId,toPath,reason}=values();
 return {sourceId,scope,sourceSha256,fromParentId,toParentId,toPath,reason};}
function fixture(){
 return {
  preflight:{format:'knowledge-notion-preflight-v1',summary:{workspaceCoverageVerified:true},entries:[
   {originalNotionId:A,parentNotionId:null,type:'markdown',sha256:SHA,bytes:100,missingLocalLinks:0,remoteNotionLinks:0},
   {originalNotionId:B,parentNotionId:A,type:'markdown',sha256:SHA,bytes:100,missingLocalLinks:0,remoteNotionLinks:0},
  ]},
  inventory:{format:'knowledge-notion-inventory-v1',enumerationComplete:true,records:[
   {id:A,scope:'devonstation',accessible:true,kind:'page'},
   {id:B,scope:'devonstation',accessible:true,kind:'page'},
  ]},
  classifications:[
   {id:A,portal:'independent-software',recordType:'project',title:'Knowledge',
    status:'active',sourceUrl:'https://example.org/a',links:[]},
   {id:B,portal:'independent-software',recordType:'evidence',title:'Source evidence',
    status:'verified',sourceUrl:'https://example.org/b',links:[],parentChangeApproved:true,
    parentChangeReason:reason,parentId:null},
  ],
 };
}
function findings(r){return r.findings.map(x=>x.code);}
test('G13 Ed25519 receipt authenticates exactly one scoped hierarchy move',()=>{
 const receipt=signHierarchyApproval(values(),privateKeyPem);
 assert.equal(receipt.format,HIERARCHY_RECEIPT_FORMAT);
 assert.equal(verifyHierarchyApproval(receipt,expected(),trust,{now:NOW}),true);
 for(const key of ['sourceId','scope','sourceSha256','fromParentId','toParentId','toPath','reason']){
  assert.equal(verifyHierarchyApproval(receipt,{...expected(),[key]:'different'},trust,{now:NOW}),false,key);
 }
 assert.equal(verifyHierarchyApproval({...receipt,reason:'Changed after signing'},expected(),trust,{now:NOW}),false);
 assert.equal(verifyHierarchyApproval({...receipt,signature:receipt.signature.slice(1)},expected(),trust,{now:NOW}),false);
 assert.equal(verifyHierarchyApproval({...receipt,added:'untrusted'},expected(),trust,{now:NOW}),false);
});
test('G13 denies expired, not-yet-issued, revoked, consumed and untrusted receipts',()=>{
 const receipt=signHierarchyApproval(values(),privateKeyPem);
 assert.equal(verifyHierarchyApproval(receipt,expected(),trust,{now:Date.parse(EXPIRES)}),false);
 assert.equal(verifyHierarchyApproval(receipt,expected(),trust,{now:NOW-90*60*1000}),false);
 assert.equal(verifyHierarchyApproval(receipt,expected(),trust,{now:NOW,consumedIds:new Set([receipt.approvalId])}),false);
 assert.equal(verifyHierarchyApproval(receipt,expected(),trust,{now:NOW,revokedIds:new Set([receipt.approvalId])}),false);
 assert.equal(verifyHierarchyApproval(receipt,expected(),{}, {now:NOW}),false);
 assert.equal(verifyHierarchyApproval(receipt,expected(),{
  'owner-key-1':{enabled:false,scopes:['devonstation'],publicKeyPem}
 },{now:NOW}),false);
 assert.equal(verifyHierarchyApproval(receipt,expected(),{
  'owner-key-1':{enabled:true,scopes:['anevum'],publicKeyPem}
 },{now:NOW}),false);
 const stranger=generateKeyPairSync('ed25519');
 assert.equal(verifyHierarchyApproval(receipt,expected(),{
  'owner-key-1':{enabled:true,scopes:['devonstation'],
   publicKeyPem:stranger.publicKey.export({format:'pem',type:'spki'})}
 },{now:NOW}),false);
});
test('G13 signer rejects malformed, overly broad or non-Ed25519 approval statements',()=>{
 for(const invalid of [
  {approvalId:'not-a-uuid'},{scope:'all'},{sourceSha256:'not-a-hash'},
  {fromParentId:null,toParentId:null},{toParentId:B},{toPath:'../export'},
  {toPath:'personal/../private'},{reason:'short'},
  {issuedAt:'tomorrow'},{expiresAt:ISSUED},
  {expiresAt:'2027-02-06T12:00:00.000Z'}
 ]){
  assert.throws(()=>signHierarchyApproval(values(invalid),privateKeyPem),TypeError);
 }
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>signHierarchyApproval(values(),rsa.privateKey.export({format:'pem',type:'pkcs8'})),TypeError);
});
test('G13 planner ignores editable approval flag; independently trusted receipt must match source and move',()=>{
 const fx=fixture();
 let result=planOrganizedMigration(fx);
 assert.ok(findings(result).includes('UNREVIEWED_SOURCE_HIERARCHY'));
 fx.classifications[1].hierarchyApproval=signHierarchyApproval(values(),privateKeyPem);
 result=planOrganizedMigration({...fx,trustedReviewers:trust,approvalOptions:{now:NOW}});
 assert.ok(!findings(result).includes('UNREVIEWED_SOURCE_HIERARCHY'));
 assert.ok(!findings(result).includes('UNVERIFIED_HIERARCHY_APPROVAL'));
 assert.equal(result.imported,false);
 assert.equal(result.cutoverApproved,false);
 const revised=structuredClone(fx);
 revised.classifications[1].title='Different evidence name';
 result=planOrganizedMigration({...revised,trustedReviewers:trust,approvalOptions:{now:NOW}});
 assert.ok(findings(result).includes('UNVERIFIED_HIERARCHY_APPROVAL'));
 const tampered=structuredClone(fx);
 tampered.preflight.entries[1].sha256='f'.repeat(64);
 result=planOrganizedMigration({...tampered,trustedReviewers:trust,approvalOptions:{now:NOW}});
 assert.ok(findings(result).includes('UNVERIFIED_HIERARCHY_APPROVAL'));
 result=planOrganizedMigration({...fx,trustedReviewers:trust,approvalOptions:{
  now:NOW,consumedIds:new Set([fx.classifications[1].hierarchyApproval.approvalId])}});
 assert.ok(findings(result).includes('UNVERIFIED_HIERARCHY_APPROVAL'));
});
test('G13 approval receipt never appears in published migration-plan node summaries',()=>{
 const fx=fixture();
 fx.classifications[1].hierarchyApproval=signHierarchyApproval(values(),privateKeyPem);
 const report=planOrganizedMigration({...fx,trustedReviewers:trust,approvalOptions:{now:NOW}});
 assert.equal(JSON.stringify(report).includes(fx.classifications[1].hierarchyApproval.signature),false);
 assert.equal(JSON.stringify(report).includes(privateKeyPem),false);
});
