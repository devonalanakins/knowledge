import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {verifyOwnerUiMfaReadiness,readOwnerUiMfaReadiness}
 from '../src/forward-owner-ui-mfa-readiness.mjs';

const host='knowledge-owner-ui-stage.devonakins.workers.dev';
const owner='fictional.owner@example.test';
const policy=()=>({decision:'allow',include:[{email:{email:owner}}],
 require:[],exclude:[]});
function fixture(){
 return {
  organization:{mfa_config:{allowed_authenticators:['security_key','totp'],session_duration:'24h'}},
  stageApp:{id:'stage-app-id',type:'self_hosted',domain:host,
   mfa_config:{allowed_authenticators:['security_key'],session_duration:'0m',mfa_disabled:false}},
  stagePolicies:[policy()],subdomain:{enabled:false,previews_enabled:false}
 };
}
test('fully configured independent MFA metadata is never live or release assurance',()=>{
 const r=verifyOwnerUiMfaReadiness(fixture());
 assert.deepEqual(r,{status:'MFA_METADATA_CONFIGURED',findings:[],
  stageSubdomainDisabled:true,stagePreviewDisabled:true,actualMfaChallengeVerified:false,
  edgeAccessEnforcementVerified:false,ownerBrowserVerified:false,
  productionReleaseAuthorized:false,stagingRouteChangeAuthorized:false});
 assert.doesNotMatch(JSON.stringify(r),/fictional\.owner|stage-app-id/);
});
test('current no-MFA configuration fails closed',()=>{
 const f=fixture();delete f.organization.mfa_config;delete f.stageApp.mfa_config;
 const r=verifyOwnerUiMfaReadiness(f);
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.findings.includes('ORGANIZATION_INDEPENDENT_MFA_NOT_CONFIGURED'));
 assert.ok(r.findings.includes('STAGING_APP_MFA_NOT_REQUIRED'));
});
test('MFA exemptions and configuration drift block even when organization is configured',()=>{
 const cases=[
  f=>{f.organization.mfa_config.allowed_authenticators=['piv_key'];},
  f=>{f.organization.mfa_config.session_duration='9999h';},
  f=>{f.stageApp.mfa_config.allowed_authenticators=['totp','biometrics'];},
  f=>{f.stageApp.mfa_config.session_duration='unknown';},
  f=>{f.stageApp.mfa_disabled=true;},
  f=>{delete f.stageApp.mfa_config.mfa_disabled;},
  f=>{f.stageApp.mfa_config.mfa_disabled=true;},
  f=>{f.stagePolicies[0].mfa_disabled=true;},
  f=>{f.stagePolicies[0].mfa_config={allowed_authenticators:['totp'],session_duration:'1h'};},
  f=>{f.stagePolicies[0].mfa_config={allowed_authenticators:[],session_duration:'1h'};},
  f=>{f.stagePolicies[0].mfa_config={mfa_disabled:true};},
  f=>{f.stagePolicies[0].mfa_config={allowed_authenticators:['security_key'],session_duration:'1h'};},
  f=>{f.stageApp.domain='knowledge-forward-private.devonakins.workers.dev';},
 ];
 for(const change of cases){const f=fixture();change(f);
  assert.equal(verifyOwnerUiMfaReadiness(f).status,'BLOCKED');}
});
test('MFA methods with no explicit stage enforcement must not pass when org default is off',()=>{
 const f=fixture();f.organization.mfa_required_for_all_apps=false;
 delete f.stageApp.mfa_config.mfa_disabled;
 const r=verifyOwnerUiMfaReadiness(f);
 assert.equal(r.status,'BLOCKED');
 assert.ok(r.findings.includes('STAGING_APP_MFA_NOT_REQUIRED'));
 assert.equal(r.stagingRouteChangeAuthorized,false);
});
test('explicit narrow stage MFA and custom policy requirement can pass metadata only',()=>{
 const f=fixture();f.organization.mfa_required_for_all_apps=false;
 f.stagePolicies[0].mfa_config={mfa_disabled:false,
  allowed_authenticators:['security_key'],session_duration:'0m'};
 const r=verifyOwnerUiMfaReadiness(f);
 assert.equal(r.status,'MFA_METADATA_CONFIGURED');
 assert.equal(r.actualMfaChallengeVerified,false);
});
test('unrouted stage and single explicit owner policy required',()=>{
 for(const change of [
  f=>{f.subdomain.enabled=true;},
  f=>{f.subdomain.previews_enabled=true;},
  f=>{f.subdomain=null;},
  f=>{f.stagePolicies[0].include=[{everyone:{}}];},
  f=>{f.stagePolicies.push(policy());},
  f=>{f.stagePolicies[0].decision='bypass';},
  f=>{f.stagePolicies[0].include=[{email:{email:'WRONG@EXAMPLE.TEST'}}];},
  f=>{f.stagePolicies[0].require=[{everyone:{}}];},
 ]){const f=fixture();change(f);
  assert.equal(verifyOwnerUiMfaReadiness(f).status,'BLOCKED');}
});
test('reader makes five fixed Cloudflare GETs only, never reports identity or credentials',async()=>{
 const f=fixture(),calls=[],account='a'.repeat(32),token='synthetic-read-only-token';
 const fetchImpl=async(url,opts)=>{
  const u=new URL(url);calls.push({url:u,opts});
  assert.equal(u.origin,'https://api.cloudflare.com');
  const p=u.pathname;
  const result=p.endsWith('/access/organizations')?f.organization:
   p.endsWith('/access/apps')?[{id:'stage-app-id',type:'self_hosted',domain:host}]:
   p.endsWith('/subdomain')?f.subdomain:
   p.endsWith('/access/apps/stage-app-id')?f.stageApp:
   p.endsWith('/access/apps/stage-app-id/policies')?f.stagePolicies:undefined;
  assert.notEqual(result,undefined,'unexpected API request');
  return {ok:true,json:async()=>({success:true,result,result_info:{total_pages:1}})};
 };
 const r=await readOwnerUiMfaReadiness({account,token,fetchImpl});
 assert.equal(r.status,'MFA_METADATA_CONFIGURED');
 assert.equal(calls.length,5);
 assert.ok(calls.every(x=>x.opts.method==='GET'&&x.opts.redirect==='error'&&
  x.opts.headers.Authorization==='Bearer '+token));
 assert.doesNotMatch(JSON.stringify(r),/synthetic-read-only|fictional\.owner|stage-app-id/);
});
test('provider 403, multi-page apps and unsafe account fail closed',async()=>{
 const opts={account:'a'.repeat(32),token:'synthetic-read-only-token'};
 await assert.rejects(readOwnerUiMfaReadiness({...opts,fetchImpl:async()=>({ok:false,status:403})}),
  /KNOWLEDGE_UI_MFA_READ_ONLY_UNAVAILABLE/);
 await assert.rejects(readOwnerUiMfaReadiness({...opts,fetchImpl:async()=>({
  ok:true,json:async()=>({success:true,result:[],result_info:{total_pages:2}})
 })}),/KNOWLEDGE_UI_MFA_READ_ONLY_UNAVAILABLE/);
 await assert.rejects(readOwnerUiMfaReadiness({...opts,account:'../../oops'}),
  /KNOWLEDGE_UI_MFA_READ_ONLY_UNAVAILABLE/);
});
test('manual CLI cannot run without explicit ack',()=>{
 const child=spawnSync(process.execPath,
  ['ops/private-forward/guard-owner-ui-mfa.mjs'],
  {encoding:'utf8',env:{...process.env,KNOWLEDGE_UI_MFA_GUARD_ACK:''}});
 assert.equal(child.status,1);
 assert.match(child.stderr,/KNOWLEDGE_UI_MFA_READ_ONLY_UNAVAILABLE/);
 assert.equal(child.stdout,'');
});


test('actual staging shape passes metadata using policy MFA only, without app override',()=>{
 const f=fixture();
 f.organization={mfa_config:{allowed_authenticators:['totp','security_key','biometrics'],session_duration:'1h'}};
 delete f.stageApp.mfa_config;
 f.stagePolicies[0].mfa_config={allowed_authenticators:['totp','security_key','biometrics'],
  session_duration:'1h',mfa_disabled:false};
 const report=verifyOwnerUiMfaReadiness(f);
 assert.equal(report.status,'MFA_METADATA_CONFIGURED');
 assert.deepEqual(report.findings,[]);
 assert.equal(report.stageSubdomainDisabled,true);
 assert.equal(report.stagePreviewDisabled,true);
 assert.equal(report.actualMfaChallengeVerified,false);
 assert.equal(report.stagingRouteChangeAuthorized,false);
});

test('policy-only MFA fails closed for exemptions, missing enforcement, unknown method, and preview access',()=>{
 const baseline=fixture();
 baseline.organization={mfa_config:{allowed_authenticators:['totp','security_key','biometrics'],session_duration:'1h'}};
 delete baseline.stageApp.mfa_config;
 baseline.stagePolicies[0].mfa_config={allowed_authenticators:['totp','security_key','biometrics'],
  session_duration:'1h',mfa_disabled:false};
 const cases=[
  [f=>{delete f.stagePolicies[0].mfa_config},'STAGING_APP_MFA_NOT_REQUIRED'],
  [f=>{f.stagePolicies[0].mfa_config.mfa_disabled=true},'STAGING_POLICY_MFA_EXEMPTION_OR_DRIFT'],
  [f=>{delete f.stagePolicies[0].mfa_config.mfa_disabled},'STAGING_POLICY_MFA_EXEMPTION_OR_DRIFT'],
  [f=>{f.stagePolicies[0].mfa_config.allowed_authenticators=['unexpected']},'STAGING_POLICY_MFA_EXEMPTION_OR_DRIFT'],
  [f=>{f.stagePolicies[0].mfa_config.allowed_authenticators=['piv_key']},'STAGING_POLICY_MFA_EXEMPTION_OR_DRIFT'],
  [f=>{f.stagePolicies[0].mfa_config.session_duration='9999h'},'STAGING_POLICY_MFA_EXEMPTION_OR_DRIFT'],
  [f=>{f.stagePolicies[0].mfa_disabled=true},'STAGING_POLICY_MFA_EXEMPTION_OR_DRIFT'],
  [f=>{f.subdomain.previews_enabled=true},'STAGING_PREVIEW_URLS_NOT_DISABLED'],
  [f=>{delete f.subdomain.previews_enabled},'STAGING_PREVIEW_URLS_NOT_DISABLED'],
 ];
 for(const [mutate,expected] of cases){
  const f=structuredClone(baseline);mutate(f);
  const r=verifyOwnerUiMfaReadiness(f);
  assert.equal(r.status,'BLOCKED',expected);
  assert.ok(r.findings.includes(expected),expected);
  assert.equal(r.productionReleaseAuthorized,false);
 }
});
