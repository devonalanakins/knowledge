/**
 * Read-only deployment drift guard. Never deploys or accesses secret values.
 * Requires exact metadata agreement before any separately approved rollout.
 */
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPECTED=['knowledge-capture-ingress-private','knowledge-capture-processor-private'];
const error=()=>{throw Error('KNOWLEDGE_CAPTURE_STAGING_GUARD_UNAVAILABLE');};
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function verifyCaptureStagingGuard({manifests,workers}){
 if(!obj(manifests)||!obj(workers)||Object.keys(manifests).sort().join(',')!==EXPECTED.slice().sort().join(',')||
   Object.keys(workers).sort().join(',')!==EXPECTED.slice().sort().join(','))error();
 const findings=[],rollback={};let inboxId=null;
 for(const name of EXPECTED){
  const m=manifests[name],w=workers[name];
  if(!obj(m)||!obj(w)||m.name!==name||m.workers_dev!==false||m.preview_urls!==false||
    !Array.isArray(m.d1_databases)||m.d1_databases.length!==1||
    !Array.isArray(w.bindings)||!Array.isArray(w.schedules)||!Array.isArray(w.versions)||
    !obj(w.subdomain))error();
  const allowed=['$schema','compatibility_date','d1_databases','main','name','preview_urls','workers_dev'];
  if(Object.keys(m).some(k=>!allowed.includes(k)))findings.push(name+':UNREVIEWED_CONFIG_KEY');
  if(typeof m.compatibility_date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(m.compatibility_date))error();
  if(m.compatibility_date!==w.compatibility_date)findings.push(name+':COMPATIBILITY_DRIFT');
  if(!Array.isArray(w.compatibility_flags)||w.compatibility_flags.length)
    findings.push(name+':COMPATIBILITY_FLAGS_UNREVIEWED');
  if(w.subdomain.enabled!==false||w.subdomain.previews_enabled!==false)
    findings.push(name+':PUBLIC_SURFACE_ENABLED');
  if(w.schedules.length)findings.push(name+':UNEXPECTED_SCHEDULE');
  if(w.versions.length!==1||w.versions[0]?.percentage!==100||
     !ID.test(w.versions[0]?.version_id??''))findings.push(name+':ROLLBACK_VERSION_UNVERIFIED');
  else rollback[name]=w.versions[0].version_id;
  const db=m.d1_databases[0];
  if(db.binding!=='CAPTURE_INBOX_DB'||db.database_name!=='knowledge-capture-inbox-private'||
     !ID.test(db.database_id??''))error();
  if(db.database_id=== 'd942f8de-1f89-4942-adf7-e8ba00a72efa')findings.push(name+':OWNER_DB_FORBIDDEN');
  if(inboxId!==null&&inboxId!==db.database_id)findings.push(name+':STAGED_INBOX_MISMATCH');
  inboxId=db.database_id;
  if(w.bindings.length!==1||w.bindings[0]?.name!=='CAPTURE_INBOX_DB'||
     w.bindings[0]?.type!=='d1'||w.bindings[0]?.database_id!==db.database_id)
    findings.push(name+':REMOTE_BINDING_DRIFT');
 }
 return {status:findings.length?'BLOCKED':'STAGING_METADATA_MATCH',
  deploymentAuthorized:false,liveCaptureVerified:false,
  findings:findings.sort(),rollbackVersions:rollback};
}
export async function readCaptureStagingGuard({account,token,manifests,fetchImpl=fetch}){
 if(typeof account!=='string'||!/^[0-9a-f]{32}$/i.test(account)||
    typeof token!=='string'||!token||typeof fetchImpl!=='function')error();
 const workers={};
 for(const name of EXPECTED){
  const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+name+'/';
  async function get(suffix){
   let response,data;
   try{
    response=await fetchImpl(base+suffix,{method:'GET',redirect:'error',
      headers:{Authorization:'Bearer '+token,'Cache-Control':'no-store'}});
    if(!response?.ok)error();
    data=await response.json();
   }catch{error();}
   if(data?.success!==true||!obj(data.result))error();
   return data.result;
  }
  const [settings,deployments,schedules,subdomain]=await Promise.all([
   get('settings'),get('deployments'),get('schedules'),get('subdomain')]);
  if(!Array.isArray(settings.bindings)||!Array.isArray(deployments.deployments)||
     !Array.isArray(schedules.schedules))error();
  workers[name]={compatibility_date:settings.compatibility_date,
   compatibility_flags:settings.compatibility_flags,
   bindings:settings.bindings.map(b=>({name:b.name,type:b.type,
    database_id:b.database_id})),
   schedules:schedules.schedules.map(s=>({cron:s.cron})),
   versions:deployments.deployments[0]?.versions||[],
   subdomain:{enabled:subdomain.enabled,previews_enabled:subdomain.previews_enabled}};
 }
 return verifyCaptureStagingGuard({manifests,workers});
}
