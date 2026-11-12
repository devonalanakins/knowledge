/**
 * Read-only, fail-closed staging topology guard for the existing private
 * Knowledge Worker. Never deploys, provisions, mutates or requests secret values.
 *
 * This guard checks resource separation and narrow Access policy metadata. It
 * cannot prove edge enforcement, MFA, cryptographic key isolation, authenticated browser
 * behavior, synthetic-only D1 contents and rollback require separate evidence.
 */
const PROD='knowledge-forward-private';
const STAGE='knowledge-owner-ui-stage';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT=/^[0-9a-f]{32}$/i;
const SAFE_ID=/^[A-Za-z0-9_-]{1,128}$/;
const EMAIL=/^[a-z0-9.!#$%&'+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const REQUIRED=new Map([
 ['KNOWLEDGE_DB','d1'],
 ['KNOWLEDGE_ACCESS_AUD','secret_text'],
 ['KNOWLEDGE_ACCESS_EMAIL','secret_text'],
 ['KNOWLEDGE_PRIVATE_WORKER_ACK','secret_text'],
 ['KNOWLEDGE_WORKER_RESOURCE','secret_text'],
 ['KNOWLEDGE_SPACE','secret_text'],
 ['KNOWLEDGE_KEY_ID','secret_text'],
 ['KNOWLEDGE_DATA_KEY','secret_text'],
 ['KNOWLEDGE_BROWSER_ACK','secret_text'],
 ['KNOWLEDGE_ACCEPTANCE_ONLY_ACK','secret_text'],
]);
const FORBIDDEN=new Set([
 'KNOWLEDGE_PRIVATE_WRITE_ACK','KNOWLEDGE_OWNER_EDITOR_ACK',
 'KNOWLEDGE_OWNER_SHARE_PREVIEW_ACK','KNOWLEDGE_MACHINE_CAPTURE_ACK',
 'KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX','KNOWLEDGE_CAPTURE_WRITER',
]);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
function originHost(raw) {
 if(typeof raw!=='string')return null;
 try {
  const u=new URL(raw);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&
    (u.pathname==='/'||u.pathname==='')&&u.hostname.includes('.')?u.hostname:null;
 }catch{return null}
}
function dbBinding(settings) {
 if(!obj(settings)||!Array.isArray(settings.bindings))return null;
 const b=settings.bindings.filter(x=>x?.name==='KNOWLEDGE_DB');
 if(b.length!==1||b[0].type!=='d1')return null;
 const id=b[0].database_id??b[0].id;
 if(b[0].database_id!==undefined&&b[0].id!==undefined&&b[0].id!==b[0].database_id)return null;
 return typeof id==='string'&&UUID.test(id)?id:null;
}
function validApp(app,host){
 return obj(app)&&app.domain===host&&app.type==='self_hosted' &&
   typeof app.id==='string'&&SAFE_ID.test(app.id);
}
function checkedOwnerAddress(policies){
 // A single allow/email criterion is the only topology we can independently
 // compare without collecting or outputting an owner's private identity.
 if(!Array.isArray(policies)||policies.length!==1)return null;
 const p=policies[0];
 if(!obj(p)||p.decision!=='allow'||!Array.isArray(p.include)||p.include.length!==1||
    !Array.isArray(p.require)||p.require.length>0||
    !Array.isArray(p.exclude)||p.exclude.length>0)return null;
 const rule=p.include[0];
 if(!obj(rule)||Object.keys(rule).length!==1||!obj(rule.email)||
   Object.keys(rule.email).length!==1)return null;
 const email=rule.email.email;
 return typeof email==='string'&&email.length<=254&&email===email.toLowerCase()&&
   EMAIL.test(email)?email:null;
}
function output(findings,found,policyMetadataMatch=false){
 return {status:findings.length?'BLOCKED':'STAGING_METADATA_SEPARATED',
  findings:[...new Set(findings)].sort(),stagingWorkerFound:Boolean(found),
  deploymentAuthorized:false,accessPolicyVerified:false,
  accessPolicyMetadataMatch:Boolean(policyMetadataMatch),
  secretValuesVerified:false,syntheticDataVerified:false,
  hostedOwnerFlowVerified:false,rollbackVerified:false};
}
export function verifyOwnerUiStagingTopology({production,staging,databases,apps,
 policies,productionOrigin,stagingOrigin}={}){
 const findings=[];
 const prodHost=originHost(productionOrigin),stageHost=originHost(stagingOrigin);
 if(!prodHost||!stageHost||prodHost===stageHost)
   findings.push('HOSTS_INVALID_OR_NOT_ISOLATED');
 if(!Array.isArray(databases)||!Array.isArray(apps)){
   findings.push('PROVIDER_INVENTORY_INCOMPLETE');
   return output(findings,Boolean(staging));
 }
 const prodEmail=checkedOwnerAddress(policies?.production);
 const stageEmail=checkedOwnerAddress(policies?.staging);
 if(!prodEmail)findings.push('PRODUCTION_OWNER_POLICY_UNVERIFIED');
 if(!stageEmail)findings.push('STAGING_OWNER_POLICY_UNVERIFIED');
 if(prodEmail&&stageEmail&&prodEmail!==stageEmail)
   findings.push('STAGING_OWNER_POLICY_MISMATCH');
 const prodDb=dbBinding(production),stageDb=dbBinding(staging);
 if(!prodDb)findings.push('PRODUCTION_DATABASE_UNATTESTED');
 if(!staging) findings.push('STAGING_WORKER_MISSING');
 else if(!stageDb)findings.push('STAGING_DATABASE_BINDING_MISSING');
 if(prodDb&&stageDb&&prodDb===stageDb)
   findings.push('PRODUCTION_DATABASE_REUSED');
 if(staging) {
   const bs=Array.isArray(staging.bindings)?staging.bindings:[];
   if(!Array.isArray(staging.bindings))findings.push('STAGING_BINDINGS_UNREADABLE');
   for(const [name,type] of REQUIRED) {
     if(bs.filter(b=>b?.name===name&&b?.type===type).length!==1)
       findings.push('STAGING_REQUIRED_BINDING_MISSING_OR_WRONG_TYPE');
   }
   if(bs.some(b=>FORBIDDEN.has(b?.name)||!REQUIRED.has(b?.name)) ||
     bs.length!==REQUIRED.size)findings.push('STAGING_UNEXPECTED_OR_PRIVILEGED_BINDINGS');
   if(staging.compatibility_date!=='2026-11-07'||
      !Array.isArray(staging.compatibility_flags)||staging.compatibility_flags.length)
      findings.push('STAGING_COMPATIBILITY_DRIFT');
 }
 // Database identity is not enough: only a separately named D1 is acceptable.
 const stageDbs=databases.filter(d=>d?.uuid===stageDb);
 if(!stageDb||stageDbs.length!==1||stageDbs[0]?.name!=='knowledge-owner-ui-stage')
   findings.push('DEDICATED_STAGING_DATABASE_MISSING');
 const prodDbs=databases.filter(d=>d?.uuid===prodDb);
 if(!prodDb||prodDbs.length!==1||prodDbs[0]?.name!=='knowledge-forward-private')
   findings.push('PRODUCTION_DATABASE_INVENTORY_DRIFT');
 if(prodHost && apps.filter(a=>validApp(a,prodHost)).length!==1)
   findings.push('PRODUCTION_ACCESS_APPLICATION_NOT_FOUND');
 if(stageHost) {
   const stageApps=apps.filter(a=>validApp(a,stageHost));
   if(stageApps.length!==1)findings.push('DEDICATED_STAGING_ACCESS_APP_MISSING');
   if(apps.some(a=>a?.domain===stageHost&&a?.domain===prodHost))
     findings.push('PRODUCTION_ACCESS_APPLICATION_REUSED');
   if(stageApps.length===1&&apps.some(a=>a?.domain===prodHost&&a?.id===stageApps[0].id))
     findings.push('PRODUCTION_ACCESS_APPLICATION_REUSED');
 }
 return output(findings,Boolean(staging),Boolean(prodEmail&&stageEmail&&prodEmail===stageEmail));
}
function unavailable(){throw new Error('KNOWLEDGE_UI_STAGE_READ_ONLY_UNAVAILABLE')}
async function cfGet({account,token,fetchImpl,path,optional404=false}){
 const url='https://api.cloudflare.com/client/v4/accounts/'+account+path;
 let response;
 try {
  response=await fetchImpl(url,{method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+token,'Cache-Control':'no-store'},
   signal:AbortSignal.timeout(12000)});
 } catch {unavailable()}
 if(optional404&&response.status===404)return null;
 if(!response.ok)unavailable();
 let value;
 try{value=await response.json()}catch{unavailable()}
 if(value?.success!==true||!own(value,'result'))unavailable();
 if(value.result_info?.total_pages>1 ||
    (Array.isArray(value.result)&&value.result.length>=100&&!Number.isInteger(value.result_info?.total_pages)))
    unavailable();
 return value.result;
}
export async function readOwnerUiStagingTopology({account,token,productionOrigin,
 stagingOrigin,fetchImpl=fetch}={}){
 if(typeof account!=='string'||!ACCOUNT.test(account)||
    typeof token!=='string'||token.length<10||typeof fetchImpl!=='function'||
    !originHost(productionOrigin)||!originHost(stagingOrigin))unavailable();
 // Paths are fixed; no user-supplied host or script can redirect the token.
 const [production,staging,databases,apps]=await Promise.all([
   cfGet({account,token,fetchImpl,path:'/workers/scripts/'+PROD+'/settings'}),
   cfGet({account,token,fetchImpl,path:'/workers/scripts/'+STAGE+'/settings',
     optional404:true}),
   cfGet({account,token,fetchImpl,path:'/d1/database?per_page=100'}),
   cfGet({account,token,fetchImpl,path:'/access/apps?per_page=100'}),
 ]);
 if(!Array.isArray(databases)||!Array.isArray(apps))unavailable();
 const prodHost=originHost(productionOrigin),stageHost=originHost(stagingOrigin);
 const findApp=host=>apps.filter(x=>validApp(x,host));
 const prodApps=findApp(prodHost),stageApps=findApp(stageHost);
 // A missing or duplicate app cannot be treated as proof of owner restriction.
 // When absent we report BLOCKED; when present a failed policy API read aborts.
 const [productionPolicies,stagingPolicies]=await Promise.all([
   prodApps.length===1?cfGet({account,token,fetchImpl,
     path:'/access/apps/'+prodApps[0].id+'/policies'}):null,
   stageApps.length===1?cfGet({account,token,fetchImpl,
     path:'/access/apps/'+stageApps[0].id+'/policies'}):null,
 ]);
 return verifyOwnerUiStagingTopology({production,staging,databases,apps,
   policies:{production:productionPolicies,staging:stagingPolicies},
   productionOrigin,stagingOrigin});
}
