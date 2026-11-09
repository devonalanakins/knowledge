/**
 * Read-only Cloudflare capture preflight. No secrets, D1 rows, or user content
 * are requested or returned. This cannot activate or certify ingestion.
 */
const API='https://api.cloudflare.com/client/v4';
const ACCOUNT=/^[0-9a-f]{32}$/i;
const EXPECTED={
  'knowledge-forward-private': {
    required:{KNOWLEDGE_DB:'d1',KNOWLEDGE_DATA_KEY:'secret_text',
      KNOWLEDGE_PRIVATE_WRITE_ACK:'secret_text',
      KNOWLEDGE_MACHINE_CAPTURE_ACK:'plain_text',
      KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX:'secret_text'},
    absent:['CAPTURE_WEBHOOK_SECRET','CAPTURE_INBOX_ROOT_HEX',
      'CAPTURE_INBOX_DB','CAPTURE_MACHINE_AUTH_KEY_HEX'],
  },
  'knowledge-capture-ingress-private':{
    required:{CAPTURE_INBOX_DB:'d1',CAPTURE_INGRESS_ACK:'plain_text',
      CAPTURE_INGRESS_URL:'plain_text',CAPTURE_WEBHOOK_SECRET:'secret_text',
      CAPTURE_INBOX_ROOT_HEX:'secret_text',CAPTURE_INBOX_KEY_ID:'plain_text',
      CAPTURE_REPOSITORIES_JSON:'plain_text'},
    absent:['KNOWLEDGE_DATA_KEY','KNOWLEDGE_CAPTURE_WRITER','CAPTURE_MACHINE_AUTH_KEY_HEX'],
  },
  'knowledge-capture-processor-private':{
    required:{CAPTURE_INBOX_DB:'d1',CAPTURE_PROCESSOR_ACK:'plain_text',
      CAPTURE_INBOX_ROOT_HEX:'secret_text',CAPTURE_INBOX_KEY_ID:'plain_text',
      CAPTURE_MACHINE_AUTH_KEY_HEX:'secret_text',KNOWLEDGE_CAPTURE_WRITER:'service'},
    absent:['KNOWLEDGE_DATA_KEY','CAPTURE_WEBHOOK_SECRET','KNOWLEDGE_ACCESS_EMAIL'],
  },
};
const keys=Object.keys(EXPECTED);
const fail=()=>{throw Error('KNOWLEDGE_CAPTURE_PREFLIGHT_UNAVAILABLE');};
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function list(v){return Array.isArray(v)?v:null;}
function nameOnly(binding){
  if(!object(binding)||typeof binding.name!=='string'||typeof binding.type!=='string')fail();
  return {name:binding.name,type:binding.type,
    ...(binding.type==='service'?{service:binding.service,entrypoint:binding.entrypoint}:{}),
    ...(binding.type==='d1'?{id:binding.id}:{}),
  };
}
export function assessCaptureReleaseInventory(input){
  if(!object(input)||!keys.every(k=>object(input[k])))fail();
  const findings=[];
  const seenDb={};
  for(const name of keys){
    const w=input[name];
    const bindings=list(w.bindings),schedules=list(w.schedules),versions=list(w.versions);
    if(!bindings||!schedules||!versions)fail();
    const found=new Map();
    for(const value of bindings){
      const b=nameOnly(value);
      if(found.has(b.name))fail();
      found.set(b.name,b);
    }
    for(const [required,type] of Object.entries(EXPECTED[name].required)){
      const b=found.get(required);
      if(!b)findings.push(name+':MISSING_'+required);
      else if(b.type!==type)findings.push(name+':WRONG_TYPE_'+required);
    }
    for(const forbidden of EXPECTED[name].absent)
      if(found.has(forbidden))findings.push(name+':UNEXPECTED_'+forbidden);
    if(name==='knowledge-capture-processor-private'){
      const service=found.get('KNOWLEDGE_CAPTURE_WRITER');
      if(service && (service.service!=='knowledge-forward-private'||
         service.entrypoint!=='KnowledgeCaptureEntrypoint'))
        findings.push(name+':WRONG_SERVICE_TARGET');
      if(schedules.length!==1||schedules[0]?.cron!=='*/5 * * * *')
        findings.push(name+':NO_PROCESSOR_CRON');
    }else if(schedules.length)findings.push(name+':UNEXPECTED_SCHEDULE');
    if(versions.length!==1||versions[0].percentage!==100)
      findings.push(name+':DEPLOYMENT_NOT_STABLE');
    const db=found.get(name==='knowledge-forward-private'?'KNOWLEDGE_DB':'CAPTURE_INBOX_DB');
    if(db?.type==='d1'&&typeof db.id==='string')seenDb[name]=db.id;
    else findings.push(name+':DB_ID_NOT_ATTESTED');
  }
  if(seenDb['knowledge-forward-private']&&
     Object.entries(seenDb).some(([name,id])=>name!=='knowledge-forward-private'&&id===seenDb['knowledge-forward-private']))
    findings.push('CAPTURE_INBOX_MUST_NOT_USE_OWNER_DB');
  if(seenDb['knowledge-capture-ingress-private']&&seenDb['knowledge-capture-processor-private']&&
     seenDb['knowledge-capture-ingress-private']!==seenDb['knowledge-capture-processor-private'])
    findings.push('CAPTURE_WORKERS_MUST_SHARE_INBOX_DB');
  // This is only a metadata readiness gate; values, permissions, and live
  // write/readback have not been tested, even if all metadata checks pass.
  return {status:findings.length?'NOT_READY':'METADATA_READY_FOR_SEPARATE_REVIEW',
    releaseAuthorized:false,liveCaptureVerified:false,findings:findings.sort()};
}
export async function readCaptureReleasePreflight({token,account,fetchImpl=fetch}={}){
  if(typeof token!=='string'||!token.trim()||typeof account!=='string'||
     !ACCOUNT.test(account)||typeof fetchImpl!=='function')fail();
  const result={};
  for(const name of keys){
    async function get(suffix){
      let response,data;
      try{
        response=await fetchImpl(API+'/accounts/'+account+'/workers/scripts/'+name+'/'+suffix,{
          method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token,
            'Cache-Control':'no-store'}});
        if(!response?.ok)fail();
        data=await response.json();
      }catch{fail();}
      if(data?.success!==true||!object(data.result))fail();
      return data.result;
    }
    const settings=await get('settings');
    const deployments=await get('deployments');
    const schedule=await get('schedules');
    const bindings=list(settings.bindings);
    const d=list(deployments.deployments);
    const crons=list(schedule.schedules);
    if(!bindings||!d||!crons)fail();
    result[name]={bindings:bindings.map(nameOnly),versions:d[0]?.versions||[],
      schedules:crons.map(s=>({cron:s.cron}))};
  }
  return assessCaptureReleaseInventory(result);
}
