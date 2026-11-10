/**
 * Read-only verification of the live BOUND BUT DISABLED capture release.
 * Unlike forward-capture-staging-guard, this requires the processor's
 * single named private owner RPC binding. Never loads secret values.
 */
const INGRESS='knowledge-capture-ingress-private';
const PROCESSOR='knowledge-capture-processor-private';
const OWNER='knowledge-forward-private';
const NAMES=[INGRESS,PROCESSOR,OWNER];
const CAPTURE_DB='147ab931-7675-43b2-a8fc-eba2a2b72545';
const OWNER_DB='d942f8de-1f89-4942-adf7-e8ba00a72efa';
const COMPAT='2026-11-07';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT=/^[0-9a-f]{32}$/i;
const OWN=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=()=>{throw Error('KNOWLEDGE_CAPTURE_BOUND_GUARD_UNAVAILABLE');};
const BINDINGS=[
 ['KNOWLEDGE_ACCESS_AUD','secret_text'],['KNOWLEDGE_ACCESS_EMAIL','secret_text'],
 ['KNOWLEDGE_BROWSER_ACK','secret_text'],['KNOWLEDGE_DATA_KEY','secret_text'],
 ['KNOWLEDGE_DB','d1'],['KNOWLEDGE_KEY_ID','secret_text'],
 ['KNOWLEDGE_OWNER_EDITOR_ACK','secret_text'],
 ['KNOWLEDGE_PRIVATE_WORKER_ACK','secret_text'],
 ['KNOWLEDGE_PRIVATE_WRITE_ACK','secret_text'],
 ['KNOWLEDGE_SPACE','secret_text'],['KNOWLEDGE_WORKER_RESOURCE','secret_text'],
];
function exactKeys(value,keys){
 return OWN(value)&&Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
}
function hasBinding(bindings,name,type){
 return bindings.some(b=>b.name===name&&b.type===type);
}
function onlyUniqueBindings(bindings,expected){
 return bindings.length===expected.length&&new Set(bindings.map(b=>b.name)).size===bindings.length&&
  expected.every(([name,type])=>hasBinding(bindings,name,type));
}
function validateManifest(config,component){
 const isProcessor=component==='processor';
 const keys=['$schema','name','main','compatibility_date','workers_dev','preview_urls','d1_databases',
  ...(isProcessor?['services']:[])];
 if(!exactKeys(config,keys)||config.name!==(isProcessor?PROCESSOR:INGRESS)||
  config.main!=='../../src/worker-cloudflare-capture-'+component+'.mjs'||
  config.compatibility_date!==COMPAT||config.workers_dev!==false||
  config.preview_urls!==false||!Array.isArray(config.d1_databases)||
  config.d1_databases.length!==1||
  !exactKeys(config.d1_databases[0],['binding','database_name','database_id'])||
  config.d1_databases[0].binding!=='CAPTURE_INBOX_DB'||
  config.d1_databases[0].database_name!=='knowledge-capture-inbox-private'||
  config.d1_databases[0].database_id!==CAPTURE_DB)fail();
 if(isProcessor&&(!Array.isArray(config.services)||config.services.length!==1||
  !exactKeys(config.services[0],['binding','service','entrypoint'])||
  config.services[0].binding!=='KNOWLEDGE_CAPTURE_WRITER'||
  config.services[0].service!==OWNER||
  config.services[0].entrypoint!=='KnowledgeCaptureEntrypoint'))fail();
}
function bindingMatches(wanted,live,role){
 if(role==='owner')return onlyUniqueBindings(live,BINDINGS)&&
  live.some(b=>b.name==='KNOWLEDGE_DB'&&b.type==='d1'&&b.database_id===OWNER_DB);
 const expected=[['CAPTURE_INBOX_DB','d1'],
  ...(role==='processor'?[['KNOWLEDGE_CAPTURE_WRITER','service']]:[])];
 return onlyUniqueBindings(live,expected)&&
  live.some(b=>b.name==='CAPTURE_INBOX_DB'&&b.type==='d1'&&b.database_id===CAPTURE_DB)&&
  (role!=='processor'||live.some(b=>b.name==='KNOWLEDGE_CAPTURE_WRITER'&&
   b.service===OWNER&&b.entrypoint==='KnowledgeCaptureEntrypoint'&&
   (b.environment===undefined||b.environment==='production')));
}
function verifyWorkers(workers,expectedVersions,findings){
 if(!exactKeys(workers,NAMES)||!exactKeys(expectedVersions,NAMES)||!
  NAMES.every(name=>typeof expectedVersions[name]==='string'&&UUID.test(expectedVersions[name])))fail();
 const rollback={};
 for(const [name,role] of [[INGRESS,'ingress'],[PROCESSOR,'processor'],[OWNER,'owner']]){
  const w=workers[name];
  if(!OWN(w)||!Array.isArray(w.bindings)||!Array.isArray(w.versionBindings)||
   !Array.isArray(w.versions)||!Array.isArray(w.schedules)||
   !Array.isArray(w.handlers)||!Array.isArray(w.namedHandlers)||
   !OWN(w.subdomain)||!Array.isArray(w.compatibilityFlags))fail();
  if(w.compatibilityDate!==COMPAT||w.versionCompatibilityDate!==COMPAT||
   w.compatibilityFlags.length)findings.push(name+':COMPATIBILITY_DRIFT');
  if(w.versions.length!==1||w.versions[0]?.percentage!==100||
   w.versions[0]?.version_id!==expectedVersions[name]||
   w.versionId!==expectedVersions[name])findings.push(name+':ACTIVE_VERSION_DRIFT');
  else rollback[name]=w.versionId;
  if(w.schedules.length)findings.push(name+':UNEXPECTED_SCHEDULE');
  if(w.subdomain.enabled!==(role==='owner')||
    w.subdomain.previews_enabled!==false)
   findings.push(name+':PUBLIC_SURFACE_DRIFT');
  if(!bindingMatches(BINDINGS,w.bindings,role)||
    !bindingMatches(BINDINGS,w.versionBindings,role))
   findings.push(name+':BINDING_DRIFT');
  if(role==='owner'){
   if(!w.namedHandlers.includes('KnowledgeCaptureEntrypoint')||
      w.handlers.slice().sort().join(',')!=='fetch')
     findings.push(name+':OWNER_RPC_ENTRYPOINT_MISSING');
  } else {
   const handlers=role==='processor'?['fetch','scheduled']:['fetch'];
   if(w.handlers.slice().sort().join(',')!==handlers.sort().join(','))
     findings.push(name+':HANDLER_DRIFT');
  }
 }
 return rollback;
}
export function verifyBoundDisabledCapture({manifests,workers,expectedVersions,routing}={}){
 if(!exactKeys(manifests,[INGRESS,PROCESSOR]))fail();
 validateManifest(manifests[INGRESS],'ingress');
 validateManifest(manifests[PROCESSOR],'processor');
 if(!OWN(routing)||!Array.isArray(routing.domains)||!Array.isArray(routing.routes)||
  routing.allPagesReviewed!==true)fail();
 const findings=[];
 const rollbackVersions=verifyWorkers(workers,expectedVersions,findings);
 for(const item of [...routing.routes,...routing.domains]){
  if(!OWN(item)||typeof item.script!=='string')fail();
  if(item.script===INGRESS||item.script===PROCESSOR)
   findings.push(item.script+':UNEXPECTED_PUBLIC_ROUTE');
 }
 return {status:findings.length?'BLOCKED':'BOUND_DISABLED_MATCH',
  findings:[...new Set(findings)].sort(),rollbackVersions,
  deploymentAuthorized:false,activationAuthorized:false,liveCaptureVerified:false};
}
/** Read-only Cloudflare API inventory. Never serializes secrets or route URLs. */
export async function readBoundDisabledCapture({
 account,token,expectedVersions,manifests,fetchImpl=fetch,
}={}){
 if(typeof account!=='string'||!ACCOUNT.test(account)||
    typeof token!=='string'||!token.trim()||typeof fetchImpl!=='function')fail();
 const root='https://api.cloudflare.com/client/v4/';
 async function get(path){
  let response,json;
  try{
   response=await fetchImpl(root+path,{method:'GET',redirect:'error',
    headers:{Authorization:'Bearer '+token,'Cache-Control':'no-store'},
    signal:AbortSignal.timeout(10000)});
   if(!response?.ok)fail();
   json=await response.json();
  }catch{fail();}
  if(json?.success!==true||json.result===undefined)fail();
  return json;
 }
 const workerState={};
 for(const name of NAMES){
  const prefix='accounts/'+account+'/workers/scripts/'+name+'/';
  const [settings,deployments,cron,sub]=await Promise.all([
   get(prefix+'settings'),get(prefix+'deployments'),get(prefix+'schedules'),
   get(prefix+'subdomain'),
  ]);
  const active=deployments.result?.deployments?.[0]?.versions;
  if(!Array.isArray(active)||active.length!==1||
   !UUID.test(active[0]?.version_id??''))fail();
  const details=(await get(prefix+'versions/'+active[0].version_id)).result;
  if(!OWN(details)||!Array.isArray(details.resources?.bindings)||
   !Array.isArray(details.resources?.script?.handlers)||
   !Array.isArray(settings.result?.bindings)||
   !Array.isArray(cron.result?.schedules)||!OWN(sub.result))fail();
  workerState[name]={
   compatibilityDate:settings.result.compatibility_date,
   versionCompatibilityDate:details.resources?.script_runtime?.compatibility_date,
   compatibilityFlags:settings.result.compatibility_flags??[],
   bindings:settings.result.bindings.map(b=>({
    name:b.name,type:b.type,database_id:b.database_id,
    service:b.service,entrypoint:b.entrypoint,environment:b.environment,
   })),
   versionBindings:details.resources.bindings.map(b=>({
    name:b.name,type:b.type,database_id:b.database_id,
    service:b.service,entrypoint:b.entrypoint,environment:b.environment,
   })),
   versions:active.map(x=>({version_id:x.version_id,percentage:x.percentage})),
   versionId:details.id,
   handlers:details.resources.script.handlers,
   namedHandlers:(details.resources.script.named_handlers??[]).map(x=>x.name),
   schedules:cron.result.schedules.map(x=>({cron:x.cron})),
   subdomain:{enabled:sub.result.enabled,previews_enabled:sub.result.previews_enabled},
  };
 }
 const domains=await get('accounts/'+account+'/workers/domains');
 if(!Array.isArray(domains.result))fail();
 if(domains.result_info?.total_pages>1)fail();
 const zones=await get('zones?account.id='+account+'&per_page=100');
 if(!Array.isArray(zones.result)||zones.result.length>100||
  zones.result_info?.total_pages>1)fail();
 const routes=[];
 for(const zone of zones.result){
  if(typeof zone?.id!=='string'||!ACCOUNT.test(zone.id))fail();
  const list=await get('zones/'+zone.id+'/workers/routes?per_page=100');
  if(!Array.isArray(list.result)||list.result.length>100||
   list.result_info?.total_pages>1)fail();
  routes.push(...list.result.map(item=>({script:item.script??''})));
 }
 return verifyBoundDisabledCapture({
  manifests,workers:workerState,expectedVersions,
  routing:{domains:domains.result.map(d=>({script:d.service??d.script??''})),
   routes,allPagesReviewed:true},
 });
}
