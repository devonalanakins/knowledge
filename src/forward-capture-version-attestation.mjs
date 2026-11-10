/**
 * Read-only Cloudflare attestation of a newly uploaded, NONDEPLOYED
 * capture Worker version. This module never retrieves secret values,
 * script source, D1 rows or owner Knowledge records.
 */
const API='https://api.cloudflare.com/client/v4';
const ACCOUNT=/^[0-9a-f]{32}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMES=Object.freeze({
 ingress:'knowledge-capture-ingress-private',
 processor:'knowledge-capture-processor-private',
});
const INBOX='147ab931-7675-43b2-a8fc-eba2a2b72545';
const abort=()=>{throw Error('KNOWLEDGE_CAPTURE_VERSION_ATTESTATION_UNAVAILABLE');};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validIds=items=>Array.isArray(items)&&items.length>0&&items.length<30&&
 items.every(id=>typeof id==='string'&&UUID.test(id))&&new Set(items).size===items.length;

function credential(args){
 if(!object(args)||typeof args.token!=='string'||!args.token.trim()||
    typeof args.account!=='string'||!ACCOUNT.test(args.account)||
    !Object.hasOwn(NAMES,args.component??'')||
    typeof args.fetchImpl!=='function')abort();
}
async function get(args,path){
 credential(args);
 let response,json;
 try{
  response=await args.fetchImpl(API+'/accounts/'+args.account+
   '/workers/scripts/'+NAMES[args.component]+'/'+path,{
    method:'GET',redirect:'error',
    signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+args.token,'Cache-Control':'no-store'},
   });
  if(!response?.ok)abort();
  json=await response.json();
 }catch{abort();}
 if(json?.success!==true||!object(json.result))abort();
 return json.result;
}
/** Snapshot before/after upload: only Cloudflare-assigned version IDs. */
export async function readCaptureVersionIds({
 account,token,component,fetchImpl=fetch,
}={}){
 const result=await get({account,token,component,fetchImpl},'versions?per_page=30');
 if(!Array.isArray(result.items)||result.items.length<1||
    result.items.length>=30)abort();
 const ids=result.items.map(v=>v?.id);
 if(!validIds(ids))abort();
 return ids;
}
/** Read one specific version's metadata; discard unrelated provider fields. */
export async function readCaptureVersionMetadata({
 account,token,component,versionId,fetchImpl=fetch,
}={}){
 if(typeof versionId!=='string'||!UUID.test(versionId))abort();
 const value=await get({account,token,component,fetchImpl},
  'versions/'+encodeURIComponent(versionId));
 if(value.id!==versionId||!object(value.resources)||
    !object(value.resources.script_runtime)||!object(value.resources.script)||
    !object(value.metadata)||!object(value.annotations)||
    !Array.isArray(value.resources.bindings)||
    !Array.isArray(value.resources.script.handlers))abort();
 return {
  id:value.id,
  createdOn:value.metadata.created_on,
  source:value.metadata.source,
  trigger:value.annotations['workers/triggered_by'],
  compatibilityDate:value.resources.script_runtime.compatibility_date,
  handlers:value.resources.script.handlers,
  bindings:value.resources.bindings.map(b=>({
   name:b.name,type:b.type,databaseId:b.database_id,
  })),
 };
}
/**
 * An uploader's exit status isn't proof a fresh version exists.
 * We require one new ID, no vanished previous IDs, matching module handlers,
 * an isolated D1 and a version-upload marker. Never infer active traffic.
 */
export function attestCaptureUploadedVersion({
 component,beforeIds,afterIds,metadata,
}={}){
 if(!Object.hasOwn(NAMES,component??'')||!validIds(beforeIds)||
    !validIds(afterIds)||!object(metadata))abort();
 const old=new Set(beforeIds);
 if(!beforeIds.every(id=>afterIds.includes(id)))abort();
 const created=afterIds.filter(id=>!old.has(id));
 if(created.length!==1||metadata.id!==created[0]||
    typeof metadata.createdOn!=='string'||
    !Number.isFinite(Date.parse(metadata.createdOn))||
    metadata.source!=='api'||metadata.trigger!=='version_upload'||
    metadata.compatibilityDate!=='2026-11-07'||!Array.isArray(metadata.bindings)||
    metadata.bindings.length!==1||
    metadata.bindings[0]?.name!=='CAPTURE_INBOX_DB'||
    metadata.bindings[0]?.type!=='d1'||
    metadata.bindings[0]?.databaseId!==INBOX||
    !Array.isArray(metadata.handlers))abort();
 const actual=metadata.handlers.slice().sort().join(',');
 const expected=(component==='processor'?['fetch','scheduled']:['fetch']).sort().join(',');
 if(actual!==expected)abort();
 return {status:'PROVIDER_VERSION_ATTESTED',versionId:created[0],
  component,trafficActivated:false};
}
