/** Read-only Access MFA impact inventory. Never authorizes writes or routing. */
const STAGE_HOST='knowledge-owner-ui-stage.devonakins.workers.dev';
const ACCOUNT=/^[a-f0-9]{32}$/i, ID=/^[a-zA-Z0-9_-]{1,128}$/;
const METHODS=new Set(['totp','biometrics','security_key','piv_key','ssh_fido2_key']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const failure=()=>{throw new Error('KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE')};

function duration(s){
 if(typeof s!=='string'||!/^(0|[1-9]\d*)(m|h)$/.test(s))return false;
 const minutes=Number.parseInt(s,10)*(s.endsWith('h')?60:1);
 return Number.isSafeInteger(minutes)&&minutes<=43200;
}
function methods(c){
 return object(c)&&Array.isArray(c.allowed_authenticators)&&c.allowed_authenticators.length>0&&
  c.allowed_authenticators.every(x=>typeof x==='string'&&METHODS.has(x))&&
  new Set(c.allowed_authenticators).size===c.allowed_authenticators.length;
}
function classifyMfa(c){
 if(c==null)return 'inherit';
 if(!object(c))return 'unknown';
 if(c.mfa_disabled===true)return 'exempt';
 if(c.mfa_disabled===false&&methods(c)&&duration(c.session_duration))return 'custom';
 return 'unknown';
}
function tally(){return {inherit:0,custom:0,exempt:0,unknown:0}}

/** Only fixed aggregate counts and status flags leave this boundary. */
export function assessAccessMfaImpact({organization,records,subdomain}={}){
 if(!object(organization)||!Array.isArray(records)||records.length===0||records.length>=100||
    !records.every(r=>object(r)&&object(r.application)&&Array.isArray(r.policies)&&
     r.policies.length<100&&r.policies.every(object)))failure();
 const apps=tally(),policies=tally(),findings=[];
 let stageCount=0,stageHasCustomMfa=false,policyCount=0,nonWebAppCount=0;
 for(const {application,policies:rules} of records){
  if(application.domain===STAGE_HOST){stageCount++;stageHasCustomMfa=classifyMfa(application.mfa_config)==='custom'}
  if(application.type!=='self_hosted')nonWebAppCount++;
  apps[classifyMfa(application.mfa_config)]++;
  for(const policy of rules){policies[classifyMfa(policy.mfa_config)]++;policyCount++}
 }
 if(!methods(organization.mfa_config)||!duration(organization.mfa_config?.session_duration))
  findings.push('ORGANIZATION_ALLOWED_MFA_NOT_CONFIGURED');
 if(organization.mfa_required_for_all_apps!==false)
  findings.push('ORGANIZATION_GLOBAL_MFA_DEFAULT_NOT_VERIFIED_OFF');
 if(stageCount!==1)findings.push('STAGING_ACCESS_APPLICATION_NOT_UNIQUE');
 if(!object(subdomain)||subdomain.enabled!==false)
  findings.push('STAGING_PUBLIC_SUBDOMAIN_NOT_DISABLED');
 if(apps.custom+apps.exempt>0)findings.push('EXISTING_APPLICATION_MFA_OVERRIDES_REQUIRE_REVIEW');
 if(policies.custom+policies.exempt>0)findings.push('EXISTING_POLICY_MFA_OVERRIDES_REQUIRE_REVIEW');
 if(apps.unknown+policies.unknown>0)findings.push('UNRECOGNIZED_MFA_CONFIGURATION');
 if(nonWebAppCount>0)findings.push('NON_WEB_ACCESS_APPLICATIONS_REQUIRE_REVIEW');
 return {
  status:'OWNER_SECURITY_REVIEW_REQUIRED',inventoryComplete:true,
  applicationCount:records.length,policyCount,nonWebApplicationCount:nonWebAppCount,
  applicationMfa:apps,policyMfa:policies,
  organizationMethodsConfigured:methods(organization.mfa_config)&&duration(organization.mfa_config.session_duration),
  organizationGlobalEnforcementVerifiedOff:organization.mfa_required_for_all_apps===false,
  stageAccessApplicationUnique:stageCount===1,stageMfaCustomConfigured:stageCount===1&&stageHasCustomMfa,
  stageSubdomainDisabled:subdomain?.enabled===false,
  findings:findings.sort(),
  actualMfaChallengeVerified:false,organizationChangeAuthorized:false,
  stageRouteChangeAuthorized:false,productionReleaseAuthorized:false,
  impactOfFutureChangesVerified:false,
 };
}
async function get({account,token,fetchImpl,path,collection=false}){
 let response,body;
 try{
  response=await fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+account+path,{
   method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token,'Cache-Control':'no-store'},
   signal:AbortSignal.timeout(12000),
  });
  if(!response?.ok)failure();
  body=await response.json();
 }catch{failure()}
 if(body?.success!==true||!own(body,'result')||
    (collection&&(!Array.isArray(body.result)||!object(body.result_info)||
     body.result_info.page!==1||body.result_info.total_pages!==1||
     body.result_info.count!==body.result.length||
     body.result_info.total_count!==body.result.length)))failure();
 return body.result;
}
/** Complete 1-99 application inventory; bounded concurrency and pagination fail closed. */
export async function readAccessMfaImpact({account,token,fetchImpl=fetch}={}){
 if(typeof account!=='string'||!ACCOUNT.test(account)||typeof token!=='string'||
    token.length<10||typeof fetchImpl!=='function')failure();
 const [organization,apps,subdomain]=await Promise.all([
  get({account,token,fetchImpl,path:'/access/organizations'}),
  get({account,token,fetchImpl,path:'/access/apps?per_page=100',collection:true}),
  get({account,token,fetchImpl,path:'/workers/scripts/knowledge-owner-ui-stage/subdomain'}),
 ]);
 if(!object(organization)||!Array.isArray(apps)||apps.length===0||apps.length>=100)failure();
 const ids=new Set();
 for(const a of apps){
  if(!object(a)||typeof a.id!=='string'||!ID.test(a.id)||ids.has(a.id))failure();
  ids.add(a.id);
 }
 const records=[];
 for(let i=0;i<apps.length;i+=4){
  const batch=await Promise.all(apps.slice(i,i+4).map(async item=>{
   const [application,policies]=await Promise.all([
    get({account,token,fetchImpl,path:'/access/apps/'+item.id}),
    get({account,token,fetchImpl,path:'/access/apps/'+item.id+'/policies?per_page=100',collection:true}),
   ]);
   if(!object(application)||application.id!==item.id||
      !Array.isArray(policies)||policies.length>=100)failure();
   return {application,policies};
  }));
  records.push(...batch);
 }
 return assessAccessMfaImpact({organization,records,subdomain});
}
