/**
 * G17 — private, metadata-only Notion source triage.
 *
 * This DOES NOT read page bodies, grant data access, verify legal ownership,
 * approve migration or write to Knowledge. Even a clean report is not consent.
 */
import {reconcileNotionInventory} from './notion-coverage.mjs';
import {planOrganizedMigration} from './organization.mjs';

const ID=/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const SHA=/^[a-f0-9]{64}$/i;
const VALID_SCOPES=new Set(['personal','family','devonstation','anevum','cristy','mizvo','external']);
const SENSITIVITY=new Set(['ordinary','personal','professional','clinical','secrets','unknown']);
const OWNERSHIP=new Set(['owner-controlled','third-party','unknown']);
const DISPOSITION=new Set(['consider','archive-only','exclude']);
const MAX_RECORDS=100000;
function obj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function id(x){return typeof x==='string'&&ID.test(x)?x.replaceAll('-','').toLowerCase():null;}
function fail(code,message){const e=new TypeError(message);e.code=code;throw e;}
function asRows(value,format){
 if(!obj(value)||value.format!==format||!Array.isArray(value.records)||
   value.records.length>MAX_RECORDS)
   fail('INVALID_REVIEW_INPUT','Private eligibility manifest has invalid format or size');
 return value.records;
}
/**
 * Return a sensitive, private review document. Only its summary is suitable for
 * diagnostics; even that should not be written to a public CI log of real data.
 */
export function assessNotionSourceEligibility({
 preflight,inventory,classifications=[],handling,policy,
 trustedReviewers={},approvalOptions={},
}={}){
 if(!obj(policy)||policy.format!=='knowledge-notion-eligibility-policy-v1'||
   policy.mode!=='ASSESS_ONLY'||!Array.isArray(policy.scopes)||
   policy.scopes.length<1||policy.scopes.length>VALID_SCOPES.size||
   policy.scopes.some(s=>!VALID_SCOPES.has(s))||
   new Set(policy.scopes).size!==policy.scopes.length)
   fail('INVALID_POLICY','Explicit bounded assessment-only workspace scopes required');
 const records=asRows(handling,'knowledge-notion-handling-v1');
 const coverage=reconcileNotionInventory(preflight,inventory);
 const organized=planOrganizedMigration({
   preflight,inventory,classifications,trustedReviewers,approvalOptions,
 });
 const findings=[],seen=new Set();
 function flag(code,sourceId=null,kind='review'){
   const signature=code+':'+sourceId;
   if(!seen.has(signature)){findings.push({code,sourceId,kind});seen.add(signature);}
 }
 const handled=new Map();
 for(const item of records){
   const key=id(item?.id);
   if(!key){flag('INVALID_HANDLING_ID',null,'blocker');continue;}
   if(handled.has(key)){flag('DUPLICATE_HANDLING_ID',key,'blocker');continue;}
   handled.set(key,item);
 }
 const exports=new Map();
 for(const item of (preflight.entries||[])){
   const key=id(item?.originalNotionId);
   if(!key)continue;
   if(exports.has(key))flag('DUPLICATE_SOURCE_ID',key,'blocker');
   else exports.set(key,item);
 }
 const scoped=new Map();
 for(const item of inventory.records){
   const key=id(item?.id);
   if(!key){flag('INVALID_INVENTORY_ID',null,'blocker');continue;}
   if(scoped.has(key))flag('DUPLICATE_INVENTORY_ID',key,'blocker');
   else scoped.set(key,item);
 }
 if(inventory.enumerationComplete!==true)
   flag('INVENTORY_ENUMERATION_NOT_CONFIRMED',null,'blocker');
 // A caller-set boolean is not independent proof of source completeness.
 if(preflight.summary?.workspaceCoverageVerified!==true)
   flag('EXPORT_COVERAGE_NOT_CONFIRMED',null,'blocker');
 const cs=coverage.summary;
 if(cs.missingExportedPagesOrDatabases||cs.databaseRowsWithoutIdMatch||
    cs.extraExportIds||cs.duplicateInventoryIds||cs.inaccessibleInventoryIds||
    cs.recordsWithUnknownScope||cs.csvRowsWithoutRecordReconciliation)
   flag('SOURCE_IDENTITY_COVERAGE_INCOMPLETE',null,'blocker');
 if(cs.preflightWarnings)flag('UNRESOLVED_EXPORT_WARNINGS',null,'blocker');
 if((preflight.summary?.byType?.html||0)>0||
    (preflight.summary?.byType?.database_csv||0)>0)
   flag('NON_MARKDOWN_FIDELITY_NOT_VERIFIED',null,'blocker');
 if((preflight.summary?.byType?.asset||0)>0)
   flag('ASSET_FIDELITY_NOT_VERIFIED',null,'review');
 if(organized.blockingFindings>0)
   flag('ORGANIZATIONAL_BLOCKERS_REMAIN',null,'blocker');
 const orgIssuesById=new Map();
 for(const f of organized.findings){
   if(f.severity!=='blocker'||!f.id)continue;
   const key=id(f.id);
   if(!key)continue;
   if(!orgIssuesById.has(key))orgIssuesById.set(key,[]);
   orgIssuesById.get(key).push(f.code);
 }
 const assessments=[];
 for(const [sourceId,source] of scoped){
   const row=handled.get(sourceId);
   const file=exports.get(sourceId);
   const reasons=[];
   const add=code=>{if(!reasons.includes(code))reasons.push(code);};
   if(!policy.scopes.includes(source.scope))add('OUTSIDE_REQUESTED_SCOPE');
   if(source.scope==='unknown'||!VALID_SCOPES.has(source.scope))add('UNKNOWN_SOURCE_SCOPE');
   if(source.scope==='external')add('EXTERNAL_SOURCE_NEEDS_SEPARATE_RIGHTS');
   if(source.accessible!==true)add('INACCESSIBLE_SOURCE');
   if(source.kind!=='page'&&source.kind!=='database_row')add('UNSUPPORTED_RECORD_KIND');
   if(!file)add('ORIGINAL_EXPORT_MISSING');
   else{
     if(file.type!=='markdown')add('NOT_MARKDOWN_FIDELITY');
     if(!SHA.test(file.sha256||'')||!Number.isSafeInteger(file.bytes)||file.bytes<0)
       add('SOURCE_FINGERPRINT_UNVERIFIED');
     if(file.missingLocalLinks>0||file.remoteNotionLinks>0)
       add('SOURCE_LINKS_UNRESOLVED');
   }
   for(const code of orgIssuesById.get(sourceId)||[])add('ORGANIZATION_'+code);
   if(!row)add('NO_HANDLING_CLASSIFICATION');
   else{
     if(row.scope!==source.scope)add('HANDLING_SCOPE_MISMATCH');
     if(!SENSITIVITY.has(row.sensitivity))add('UNCLASSIFIED_SENSITIVITY');
     if(!OWNERSHIP.has(row.ownership))add('UNVERIFIED_OWNERSHIP');
     if(!DISPOSITION.has(row.disposition))add('INVALID_DISPOSITION');
     if(row.sensitivity==='clinical')add('CLINICAL_DATA_EXCLUDED');
     if(row.sensitivity==='secrets')add('CREDENTIALS_EXCLUDED');
     if(row.sensitivity==='unknown')add('SENSITIVITY_UNKNOWN');
     if(row.ownership==='third-party')add('THIRD_PARTY_RIGHTS_REQUIRED');
     if(row.ownership==='unknown')add('OWNERSHIP_UNKNOWN');
     if(row.disposition==='exclude')add('EXPLICITLY_EXCLUDED');
     if(row.disposition==='archive-only')add('ARCHIVE_ONLY');
     if(source.scope==='family'||source.scope==='cristy')
       add('SEPARATE_PRIVATE_OR_CLINICAL_REVIEW_REQUIRED');
     if(source.scope==='personal'||row.sensitivity==='personal'||row.sensitivity==='professional')
       add('PRIVATE_HANDLING_REVIEW_REQUIRED');
     // A mutable classification is never authenticated approval.
     if(row.reviewedBy||row.approved||row.consent)
       add('SELF_REPORTED_APPROVAL_NOT_AUTHORITY');
   }
   const excluded=['CLINICAL_DATA_EXCLUDED','CREDENTIALS_EXCLUDED',
     'THIRD_PARTY_RIGHTS_REQUIRED','EXPLICITLY_EXCLUDED','ARCHIVE_ONLY'];
   const status=excluded.some(x=>reasons.includes(x))?'EXCLUDE_OR_ARCHIVE':
     reasons.length?'REQUIRES_REVIEW':'ASSESSMENT_CANDIDATE';
   assessments.push({sourceId,scope:source.scope,status,reasons,
     sourceSha256:file?.sha256??null,
     proposedPath:organized.nodes.find(n=>n.id===sourceId)?.path??null});
   for(const code of reasons)flag(code,sourceId,
     status==='EXCLUDE_OR_ARCHIVE'?'excluded':'review');
 }
 for(const sourceId of handled.keys())if(!scoped.has(sourceId))
   flag('HANDLING_ID_WITHOUT_SOURCE',sourceId,'blocker');
 assessments.sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
 findings.sort((a,b)=>String(a.sourceId).localeCompare(String(b.sourceId))||
   a.code.localeCompare(b.code));
 const byScope=Object.fromEntries([...VALID_SCOPES].map(scope=>[
   scope,{total:0,assessmentCandidates:0,requiresReview:0,excludeOrArchive:0}
 ]));
 for(const item of assessments){
   const scope=byScope[item.scope];if(!scope)continue;
   scope.total++;
   if(item.status==='ASSESSMENT_CANDIDATE')scope.assessmentCandidates++;
   if(item.status==='REQUIRES_REVIEW')scope.requiresReview++;
   if(item.status==='EXCLUDE_OR_ARCHIVE')scope.excludeOrArchive++;
 }
 const totals={sourceRecords:assessments.length,
   assessmentCandidates:assessments.filter(x=>x.status==='ASSESSMENT_CANDIDATE').length,
   requiresReview:assessments.filter(x=>x.status==='REQUIRES_REVIEW').length,
   excludeOrArchive:assessments.filter(x=>x.status==='EXCLUDE_OR_ARCHIVE').length,
   organizationalBlockers:organized.blockingFindings,
   globalBlockers:findings.filter(x=>x.sourceId===null&&x.kind==='blocker').length};
 return {format:'knowledge-notion-eligibility-review-v1',
   mode:'PRIVATE_METADATA_ASSESSMENT_ONLY',requestedScopes:[...policy.scopes],
   totals,byScope,assessments,findings,
   // Never infer permission, data fidelity or true source completeness from
   // mutable metadata; they require independently verified external evidence.
   sourceCoverageIndependentlyCertified:false,
   sensitivityClassificationIndependentlyCertified:false,
   accessAndConsentVerified:false,
   realDataImportAuthorized:false,importExecuted:false,cutoverApproved:false};
}
