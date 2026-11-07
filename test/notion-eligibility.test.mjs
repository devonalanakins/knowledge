import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessNotionSourceEligibility} from '../src/notion-eligibility.mjs';

const A='11111111111111111111111111111111';
const B='22222222222222222222222222222222';
const C='33333333333333333333333333333333';
const HASH='a'.repeat(64);
function setup(){
 const preflight={format:'knowledge-notion-preflight-v1',
   summary:{workspaceCoverageVerified:true,byType:{markdown:2,database_csv:0,html:0,asset:0},
     databaseCsvRows:0,warnings:{}},
   entries:[
     {originalNotionId:A,parentNotionId:null,type:'markdown',sha256:HASH,
       bytes:65,missingLocalLinks:0,remoteNotionLinks:0},
     {originalNotionId:B,parentNotionId:A,type:'markdown',sha256:HASH,
       bytes:72,missingLocalLinks:0,remoteNotionLinks:0},
   ]};
 const inventory={format:'knowledge-notion-inventory-v1',
   enumerationComplete:true,records:[
     {id:A,kind:'page',scope:'devonstation',accessible:true},
     {id:B,kind:'page',scope:'devonstation',accessible:true},
   ]};
 const classifications=[
   {id:A,portal:'independent-software',recordType:'project',title:'Knowledge',
     status:'active',sourceUrl:'https://example.org/a',links:[{targetId:B,type:'supports'}]},
   {id:B,portal:'independent-software',recordType:'evidence',title:'Test evidence',
     status:'verified',parentId:A,sourceUrl:'https://example.org/b',links:[]},
 ];
 const handling={format:'knowledge-notion-handling-v1',records:[
   {id:A,scope:'devonstation',sensitivity:'ordinary',ownership:'owner-controlled',disposition:'consider'},
   {id:B,scope:'devonstation',sensitivity:'ordinary',ownership:'owner-controlled',disposition:'consider'},
 ]};
 const policy={format:'knowledge-notion-eligibility-policy-v1',mode:'ASSESS_ONLY',scopes:['devonstation']};
 return {preflight,inventory,classifications,handling,policy};
}
const codes=report=>report.findings.map(x=>x.code);
test('G17 clean fictional records remain assessment candidates, never import authorization',()=>{
 const report=assessNotionSourceEligibility(setup());
 assert.equal(report.mode,'PRIVATE_METADATA_ASSESSMENT_ONLY');
 assert.deepEqual(report.totals,{
   sourceRecords:2,assessmentCandidates:2,requiresReview:0,
   excludeOrArchive:0,organizationalBlockers:0,globalBlockers:0,
 });
 assert.equal(report.byScope.devonstation.total,2);
 assert.equal(report.assessments[1].proposedPath,'independent-software/evidence/test-evidence');
 for(const x of ['sourceCoverageIndependentlyCertified','sensitivityClassificationIndependentlyCertified',
   'accessAndConsentVerified','realDataImportAuthorized','importExecuted','cutoverApproved'])
   assert.equal(report[x],false,x);
});
test('G17 clinically sensitive, secrets, third-party and archive-only records are excluded',()=>{
 const fx=setup();
 fx.handling.records[0].sensitivity='clinical';
 fx.handling.records[1].sensitivity='secrets';
 let report=assessNotionSourceEligibility(fx);
 assert.equal(report.totals.excludeOrArchive,2);
 assert.ok(codes(report).includes('CLINICAL_DATA_EXCLUDED'));
 assert.ok(codes(report).includes('CREDENTIALS_EXCLUDED'));
 fx.handling.records[0].sensitivity='ordinary';
 fx.handling.records[0].ownership='third-party';
 fx.handling.records[1].sensitivity='ordinary';
 fx.handling.records[1].disposition='archive-only';
 report=assessNotionSourceEligibility(fx);
 assert.equal(report.totals.excludeOrArchive,2);
 assert.ok(codes(report).includes('THIRD_PARTY_RIGHTS_REQUIRED'));
 assert.ok(codes(report).includes('ARCHIVE_ONLY'));
});
test('G17 family, personal and professional work remain subject to additional privacy gates',()=>{
 const fx=setup();
 fx.inventory.records[0].scope='family';
 fx.inventory.records[1].scope='cristy';
 fx.policy.scopes=['family','cristy'];
 fx.handling.records[0].scope='family';fx.handling.records[1].scope='cristy';
 fx.classifications[0].portal='personal-family';
 fx.classifications[1].portal='cristy-professional';
 fx.classifications[1].parentId=null;
 fx.preflight.entries[1].parentNotionId=null;
 const report=assessNotionSourceEligibility(fx);
 assert.equal(report.totals.assessmentCandidates,0);
 assert.ok(report.assessments.some(x=>x.reasons.includes('SEPARATE_PRIVATE_OR_CLINICAL_REVIEW_REQUIRED')));
 assert.ok(codes(report).includes('ORGANIZATIONAL_BLOCKERS_REMAIN'));
 fx.inventory.records[0].scope='personal';
 fx.handling.records[0].scope='personal';fx.handling.records[0].sensitivity='personal';
 fx.policy.scopes=['personal','cristy'];
 const updated=assessNotionSourceEligibility(fx);
 assert.ok(codes(updated).includes('PRIVATE_HANDLING_REVIEW_REQUIRED'));
});
test('G17 incomplete exports, missing record identities and false full-coverage claims block progress',()=>{
 const fx=setup();
 fx.preflight.summary.workspaceCoverageVerified=false;
 fx.inventory.enumerationComplete=false;
 fx.inventory.records.push({id:C,kind:'database_row',scope:'devonstation',accessible:false});
 fx.preflight.summary.databaseCsvRows=4;
 fx.preflight.summary.warnings={NO_NOTION_ID:1};
 fx.preflight.summary.byType.database_csv=1;
 const result=assessNotionSourceEligibility(fx);
 for(const code of ['INVENTORY_ENUMERATION_NOT_CONFIRMED','EXPORT_COVERAGE_NOT_CONFIRMED',
   'SOURCE_IDENTITY_COVERAGE_INCOMPLETE','UNRESOLVED_EXPORT_WARNINGS',
   'NON_MARKDOWN_FIDELITY_NOT_VERIFIED','ORGANIZATIONAL_BLOCKERS_REMAIN'])
   assert.ok(codes(result).includes(code),code);
 assert.ok(result.assessments.some(x=>x.reasons.includes('INACCESSIBLE_SOURCE')));
 assert.equal(result.cutoverApproved,false);
});
test('G17 unknown scope, sensitivity or ownership and mismatched scope remain under review',()=>{
 const fx=setup();
 fx.inventory.records[0].scope='unknown';
 fx.handling.records[0].sensitivity='unknown';
 fx.handling.records[0].ownership='unknown';
 fx.handling.records[1].scope='anevum';
 fx.handling.records[1].approved=true; // untrusted assertion cannot approve
 const report=assessNotionSourceEligibility(fx);
 assert.ok(codes(report).includes('UNKNOWN_SOURCE_SCOPE'));
 assert.ok(codes(report).includes('SENSITIVITY_UNKNOWN'));
 assert.ok(codes(report).includes('OWNERSHIP_UNKNOWN'));
 assert.ok(codes(report).includes('HANDLING_SCOPE_MISMATCH'));
 assert.ok(codes(report).includes('SELF_REPORTED_APPROVAL_NOT_AUTHORITY'));
 assert.equal(report.totals.assessmentCandidates,0);
});
test('G17 duplicates and handling IDs absent from independent inventory are blockers',()=>{
 const fx=setup();
 fx.handling.records.push({...fx.handling.records[0]});
 fx.handling.records.push({...fx.handling.records[0],id:C});
 fx.preflight.entries.push({...fx.preflight.entries[0]});
 const result=assessNotionSourceEligibility(fx);
 assert.ok(codes(result).includes('DUPLICATE_HANDLING_ID'));
 assert.ok(codes(result).includes('HANDLING_ID_WITHOUT_SOURCE'));
 assert.ok(codes(result).includes('DUPLICATE_SOURCE_ID'));
 assert.ok(result.totals.globalBlockers>0);
});
test('G17 self-described approvals, source text, client or password fields are never copied to the report',()=>{
 const fx=setup(),secret='PRIVATE_RECORD_BODY_SHOULD_NOT_APPEAR';
 fx.preflight.entries[0].body=secret;
 fx.inventory.records[0].privateNotes=secret;
 fx.handling.records[0].body=secret;
 fx.handling.records[1].password=secret;
 fx.handling.records[0].reviewedBy='Owner';
 fx.handling.records[0].consent=true;
 const report=assessNotionSourceEligibility(fx);
 assert.equal(JSON.stringify(report).includes(secret),false);
 assert.ok(codes(report).includes('SELF_REPORTED_APPROVAL_NOT_AUTHORITY'));
 assert.equal(report.realDataImportAuthorized,false);
});
test('G17 rejects malformed policy, excessive records, unknown scopes and non-assessment mode',()=>{
 const fx=setup();
 for(const policy of [{...fx.policy,mode:'MIGRATE'}, {...fx.policy,scopes:['devonstation','devonstation']},
   {...fx.policy,scopes:['all']},{...fx.policy,scopes:[]}])
   assert.throws(()=>assessNotionSourceEligibility({...fx,policy}),{code:'INVALID_POLICY'});
 assert.throws(()=>assessNotionSourceEligibility({...fx,handling:{}}),{code:'INVALID_REVIEW_INPUT'});
});
