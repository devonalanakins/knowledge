/**
 * Read-only Cloudflare Access independent-MFA metadata gate for the isolated
 * Knowledge owner UI stage. A positive report is NEVER proof of real login,
 * edge enforcement, or authorization to enable routing or release production.
 */
const STAGE='knowledge-owner-ui-stage';
const STAGE_HOST='knowledge-owner-ui-stage.devonakins.workers.dev';
const ACCOUNT=/^[a-f0-9]{32}$/i;
const SAFE_ID=/^[a-zA-Z0-9_-]{1,128}$/;
const OWNER_EMAIL=/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const WEB_MFA=new Set(['totp','biometrics','security_key']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);

function methods(config){
 if(!obj(config)||!Array.isArray(config.allowed_authenticators)||
    config.allowed_authenticators.length===0)return null;
 const a=config.allowed_authenticators;
 if(a.some(x=>typeof x!=='string'||!WEB_MFA.has(x))||new Set(a).size!==a.length)
   return null;
 return new Set(a);
}
function duration(value){
 if(typeof value!=='string'||!/^(0|[1-9]\d*)(m|h)$/.test(value))return false;
 const n=Number.parseInt(value,10)*(value.endsWith('h')?60:1);
 return Number.isSafeInteger(n)&&n<=43200;
}
function subset(candidate,parent){
 return candidate!==null&&parent!==null&&[...candidate].every(x=>parent.has(x));
}
function policyIsExactOwner(p){
 if(!obj(p)||p.decision!=='allow'||!Array.isArray(p.include)||p.include.length!==1||
    !Array.isArray(p.require)||p.require.length||
    !Array.isArray(p.exclude)||p.exclude.length)return false;
 const rule=p.include[0];
 if(!obj(rule)||Object.keys(rule).length!==1||!obj(rule.email)||
    Object.keys(rule.email).length!==1)return false;
 const email=rule.email.email;
 return typeof email==='string'&&email.length<=254&&
    email===email.toLowerCase()&&OWNER_EMAIL.test(email);
}

export function verifyOwnerUiMfaReadiness({organization,stageApp,stagePolicies,subdomain}={}){
 const findings=[];
 const orgMethods=methods(organization?.mfa_config);
 if(!orgMethods||!duration(organization?.mfa_config?.session_duration))
   findings.push('ORGANIZATION_INDEPENDENT_MFA_NOT_CONFIGURED');
 const appConfig=stageApp?.mfa_config;
 const appMethods=methods(appConfig);
 if(!obj(stageApp)||stageApp.type!=='self_hosted'||stageApp.domain!==STAGE_HOST)
   findings.push('STAGING_ACCESS_APPLICATION_MISMATCH');
 // Presence of allowed methods is not evidence of enforcement: an app that
 // inherits a non-enforcing organization default must not pass this gate.
 // Cloudflare's custom independent-MFA setting uses mfa_disabled:false.
 if(stageApp?.mfa_disabled===true||appConfig?.mfa_disabled!==false||
    !appMethods||!duration(appConfig?.session_duration)||
    !subset(appMethods,orgMethods))
   findings.push('STAGING_APP_MFA_NOT_REQUIRED');
 if(!Array.isArray(stagePolicies)||stagePolicies.length!==1||
    !policyIsExactOwner(stagePolicies[0])){
   findings.push('STAGING_OWNER_POLICY_UNVERIFIED');
 } else {
   const p=stagePolicies[0];
   const pc=p.mfa_config;
   // Missing policy configuration inherits the app. A present custom policy
   // must affirmatively enforce MFA rather than silently overriding the app.
   if(p.mfa_disabled===true||
      (pc!==undefined&&(pc?.mfa_disabled!==false||
        !subset(methods(pc),appMethods)||!duration(pc.session_duration))))
     findings.push('STAGING_POLICY_MFA_EXEMPTION_OR_DRIFT');
 }
 if(!obj(subdomain)||subdomain.enabled!==false)
   findings.push('STAGING_SUBDOMAIN_NOT_DISABLED');
 return {
   status:findings.length?'BLOCKED':'MFA_METADATA_CONFIGURED',
   findings:findings.sort(),stageSubdomainDisabled:subdomain?.enabled===false,
   actualMfaChallengeVerified:false,edgeAccessEnforcementVerified:false,
   ownerBrowserVerified:false,productionReleaseAuthorized:false,
   stagingRouteChangeAuthorized:false,
 };
}

function unavailable(){throw new Error('KNOWLEDGE_UI_MFA_READ_ONLY_UNAVAILABLE')}
async function cfGet({account,token,fetchImpl,path}){
 let response;
 try {
  response=await fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+account+path,{
   method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token,
    'Cache-Control':'no-store'},signal:AbortSignal.timeout(12000)});
 }catch{unavailable()}
 if(!response?.ok)unavailable();
 let parsed;
 try{parsed=await response.json()}catch{unavailable()}
 if(parsed?.success!==true||!own(parsed,'result')||
    (parsed.result_info?.total_pages!==undefined&&
     (!Number.isInteger(parsed.result_info.total_pages)||
      parsed.result_info.total_pages>1)))unavailable();
 return parsed.result;
}
export async function readOwnerUiMfaReadiness({account,token,fetchImpl=fetch}={}){
 if(typeof account!=='string'||!ACCOUNT.test(account)||
    typeof token!=='string'||token.length<10||typeof fetchImpl!=='function')unavailable();
 const [organization,apps,subdomain]=await Promise.all([
  cfGet({account,token,fetchImpl,path:'/access/organizations'}),
  cfGet({account,token,fetchImpl,path:'/access/apps?per_page=100'}),
  cfGet({account,token,fetchImpl,path:'/workers/scripts/'+STAGE+'/subdomain'}),
 ]);
 if(!Array.isArray(apps)||apps.length>=100)unavailable();
 const matching=apps.filter(x=>x?.type==='self_hosted'&&x.domain===STAGE_HOST);
 if(matching.length!==1||typeof matching[0].id!=='string'||
    !SAFE_ID.test(matching[0].id))return verifyOwnerUiMfaReadiness({organization,subdomain});
 const id=matching[0].id;
 const [stageApp,stagePolicies]=await Promise.all([
  cfGet({account,token,fetchImpl,path:'/access/apps/'+id}),
  cfGet({account,token,fetchImpl,path:'/access/apps/'+id+'/policies?per_page=100'}),
 ]);
 if(!Array.isArray(stagePolicies)||stagePolicies.length>=100)unavailable();
 return verifyOwnerUiMfaReadiness({organization,stageApp,stagePolicies,subdomain});
}
