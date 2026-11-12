import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessAccessMfaImpact,readAccessMfaImpact} from '../src/forward-access-mfa-impact.mjs';
const stage='knowledge-owner-ui-stage.devonakins.workers.dev';
const org=()=>({mfa_required_for_all_apps:false,mfa_config:{allowed_authenticators:['security_key'],session_duration:'24h'}});
const app=(id,domain,config)=>({id,type:'self_hosted',domain,...(config===undefined?{}:{mfa_config:config})});
const pol=config=>({decision:'allow',include:[{email:{email:'fictional@example.test'}}],...
 (config===undefined?{}:{mfa_config:config})});
const fixture=()=>({organization:org(),records:[
 {application:app('stage-id',stage),policies:[pol()]},
 {application:app('other-id','other.example.test'),policies:[pol(),pol()]},
 ],subdomain:{enabled:false}});
test('complete sanitized read-only inventory never grants identity, route or deploy change',()=>{
 const f=fixture(),res=assessAccessMfaImpact(f);
 assert.deepEqual(res,{
  status:'OWNER_SECURITY_REVIEW_REQUIRED',inventoryComplete:true,
  applicationCount:2,policyCount:3,nonWebApplicationCount:0,
  applicationMfa:{inherit:2,custom:0,exempt:0,unknown:0},
  policyMfa:{inherit:3,custom:0,exempt:0,unknown:0},
  organizationMethodsConfigured:true,organizationGlobalEnforcementVerifiedOff:true,
  stageAccessApplicationUnique:true,stageMfaCustomConfigured:false,
  stageSubdomainDisabled:true,findings:[],actualMfaChallengeVerified:false,
  organizationChangeAuthorized:false,stageRouteChangeAuthorized:false,
  productionReleaseAuthorized:false,impactOfFutureChangesVerified:false,
 });
 assert.doesNotMatch(JSON.stringify(res),/stage-id|other-id|fictional@|other\.example/);
});
test('today: no organization MFA, unknown global default, all inherited still requires owner review',()=>{
 const f=fixture();f.organization={};
 const r=assessAccessMfaImpact(f);
 assert.deepEqual(r.findings,['ORGANIZATION_ALLOWED_MFA_NOT_CONFIGURED',
  'ORGANIZATION_GLOBAL_MFA_DEFAULT_NOT_VERIFIED_OFF']);
 assert.equal(r.organizationGlobalEnforcementVerifiedOff,false);
 assert.equal(r.productionReleaseAuthorized,false);
});
test('custom MFA, exemptions and ambiguous app/policy overrides are all visible in aggregates',()=>{
 const f=fixture();f.records[0].application.mfa_config={mfa_disabled:false,allowed_authenticators:['security_key'],session_duration:'0m'};
 f.records[1].application.mfa_config={mfa_disabled:true};
 f.records[1].policies[0].mfa_config={mfa_disabled:false,allowed_authenticators:['totp'],session_duration:'1h'};
 f.records[1].policies[1].mfa_config={unexpected:true};
 const r=assessAccessMfaImpact(f);
 assert.deepEqual(r.applicationMfa,{inherit:0,custom:1,exempt:1,unknown:0});
 assert.deepEqual(r.policyMfa,{inherit:1,custom:1,exempt:0,unknown:1});
 assert.equal(r.stageMfaCustomConfigured,true);
 for(const code of ['EXISTING_APPLICATION_MFA_OVERRIDES_REQUIRE_REVIEW',
  'EXISTING_POLICY_MFA_OVERRIDES_REQUIRE_REVIEW','UNRECOGNIZED_MFA_CONFIGURATION'])
   assert.ok(r.findings.includes(code),code);
});
test('stage absent, duplicate, or public subdomain must be called out without leaks',()=>{
 for(const mutate of [
  f=>{f.records[0].application.domain='wrong.example.test'},
  f=>{f.records[1].application.domain=stage},
 ]){
  const f=fixture();mutate(f);
  assert.ok(assessAccessMfaImpact(f).findings.includes('STAGING_ACCESS_APPLICATION_NOT_UNIQUE'));
 }
 const f=fixture();f.subdomain.enabled=true;
 assert.ok(assessAccessMfaImpact(f).findings.includes('STAGING_PUBLIC_SUBDOMAIN_NOT_DISABLED'));
});
test('reader uses only fixed GETs for every app; output does not include credentials or names',async()=>{
 const fixtureData=fixture(),calls=[],token='synthetic-token-12345678';
 const opts={account:'a'.repeat(32),token,fetchImpl:async(url,options)=>{
  calls.push({url,options});const p=new URL(url).pathname;
  let result;
  if(p.endsWith('/access/organizations'))result=fixtureData.organization;
  else if(p.endsWith('/access/apps'))result=fixtureData.records.map(x=>x.application);
  else if(p.endsWith('/subdomain'))result=fixtureData.subdomain;
  else if(p.endsWith('/access/apps/stage-id'))result=fixtureData.records[0].application;
  else if(p.endsWith('/access/apps/other-id'))result=fixtureData.records[1].application;
  else if(p.endsWith('/access/apps/stage-id/policies'))result=fixtureData.records[0].policies;
  else if(p.endsWith('/access/apps/other-id/policies'))result=fixtureData.records[1].policies;
  else assert.fail('Unexpected endpoint: '+p);
  return {ok:true,json:async()=>({success:true,result,result_info:{page:1,total_pages:1,count:Array.isArray(result)?result.length:0,total_count:Array.isArray(result)?result.length:0}})};
 }};
 const r=await readAccessMfaImpact(opts);
 assert.equal(calls.length,7);
 assert.equal(r.applicationCount,2);
 assert.ok(calls.every(x=>x.options.method==='GET'&&x.options.redirect==='error'&&
  x.options.headers.Authorization==='Bearer '+token));
 assert.doesNotMatch(JSON.stringify(r),/synthetic-token|other.example|stage-id|fictional@/);
});
test('API denial, pagination, duplicate IDs, and unexpected detail ID fail closed',async()=>{
 const opts={account:'a'.repeat(32),token:'synthetic-token-12345678'};
 const denied=async()=>({ok:false,status:403});
 await assert.rejects(readAccessMfaImpact({...opts,fetchImpl:denied}),
  /KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE/);
 const paged=async()=>({ok:true,json:async()=>({success:true,result:[],result_info:{total_pages:2}})});
 await assert.rejects(readAccessMfaImpact({...opts,fetchImpl:paged}),
  /KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE/);
 await assert.rejects(readAccessMfaImpact({...opts,account:'../../evil'}),
  /KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE/);
});
test('duplicate Access IDs and mismatched app details are unavailable, not review-complete',async()=>{
 const f=fixture(),token='synthetic-token-12345678';
 const options={account:'a'.repeat(32),token};
 for(const mode of ['duplicate','mismatch']){
  const fetchImpl=async url=>{
   const p=new URL(url).pathname;
   const results={
    '/access/organizations':f.organization,
    '/access/apps':mode==='duplicate'?[f.records[0].application,f.records[0].application]:f.records.map(x=>x.application),
    '/workers/scripts/knowledge-owner-ui-stage/subdomain':f.subdomain,
    '/access/apps/stage-id':mode==='mismatch'?app('wrong-id',stage):f.records[0].application,
    '/access/apps/stage-id/policies':f.records[0].policies,
    '/access/apps/other-id':f.records[1].application,
    '/access/apps/other-id/policies':f.records[1].policies,
   };
   const key=Object.keys(results).find(x=>p.endsWith(x));
   assert.ok(key,'Unexpected path: '+p);
   const result=results[key];
   return {ok:true,json:async()=>({success:true,result,result_info:{page:1,total_pages:1,count:Array.isArray(result)?result.length:0,total_count:Array.isArray(result)?result.length:0}})};
  };
  await assert.rejects(readAccessMfaImpact({...options,fetchImpl}),
   /KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE/);
 }
});
test('CLI defaults to no request and no stdout without manual acknowledgement',async()=>{
 const {spawnSync}=await import('node:child_process');
 const child=spawnSync(process.execPath,['ops/private-forward/review-access-mfa-impact.mjs'],{
  cwd:new URL('..',import.meta.url).pathname,encoding:'utf8',
  env:{...process.env,KNOWLEDGE_ACCESS_IMPACT_ACK:''},
 });
 assert.equal(child.status,1);
 assert.equal(child.stdout,'');
 assert.match(child.stderr,/KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE/);
});

test('missing list pagination metadata or mismatched totals never produces complete inventory',async()=>{
 const f=fixture(),opts={account:'a'.repeat(32),token:'synthetic-token-12345678'};
 for(const mode of ['missing','underreported','extra-page']){
  const fetchImpl=async url=>{
   const path=new URL(url).pathname;
   const result=path.endsWith('/access/organizations')?f.organization:
    path.endsWith('/access/apps')?f.records.map(x=>x.application):
    path.endsWith('/subdomain')?f.subdomain:
    path.endsWith('/access/apps/stage-id')?f.records[0].application:
    path.endsWith('/access/apps/stage-id/policies')?f.records[0].policies:
    path.endsWith('/access/apps/other-id')?f.records[1].application:
    path.endsWith('/access/apps/other-id/policies')?f.records[1].policies:null;
   assert.notEqual(result,null);
   const list=Array.isArray(result);
   const info={page:1,total_pages:mode==='extra-page'?2:1,
    count:list?result.length:0,total_count:list?result.length:0};
   if(mode==='underreported'&&path.endsWith('/access/apps'))info.total_count=1;
   return {ok:true,json:async()=>({success:true,result,
    ...(mode==='missing'&&list?{}:{result_info:info})})};
  };
  await assert.rejects(readAccessMfaImpact({...opts,fetchImpl}),
   /KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE/);
 }
});
