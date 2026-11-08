/**
 * Read-only, cron-only Cloudflare R2 health watchdog for encrypted forward records.
 * Separate from the D1-writing backup Worker, with NO owner key or public API.
 * Missing/corrupt scheduled backups throw a constant operational error suitable
 * for private Workers Observability (alert delivery is a separate release gate).
 */
import {checkRows} from './worker-cloudflare-backup.mjs';

export const WATCHDOG_CRON='0 10 * * *';
export const WATCHDOG_ACK='OWNER_ONLY_CIPHERTEXT_HEALTH_V1';
const BACKUP_FORMAT='knowledge-forward-ciphertext-backup-v1';
const PREFIX='automated/';
const MAX_BYTES=25_000_000;
const MAX_OBJECTS=10;
const PAGE_SIZE=100;
const SHA=/^[0-9a-f]{64}$/;
const SPACE=/^[a-z][a-z0-9-]{0,63}$/;
const KEY_ID=/^[a-z0-9-]{1,32}$/;
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const decoder=new TextDecoder('utf-8',{fatal:true});
const fail=code=>{throw new Error('KNOWLEDGE_BACKUP_WATCHDOG_'+code);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const binaryCompare=(a,b)=>a<b?-1:a>b?1:0;

function utcDay(date){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))fail('INVALID_CLOCK');
  return date.toISOString().slice(0,10);
}
function configured(env){
  if(!env||env.BACKUP_WATCHDOG_ACK!==WATCHDOG_ACK||
     !SPACE.test(env.BACKUP_WATCHDOG_SPACE)||
     !KEY_ID.test(env.BACKUP_WATCHDOG_KEY_ID)||
     !env.BACKUP_WATCHDOG_BUCKET||
     typeof env.BACKUP_WATCHDOG_BUCKET.list!=='function'||
     typeof env.BACKUP_WATCHDOG_BUCKET.get!=='function'||
     typeof env.BACKUP_WATCHDOG_FIRST_DUE!=='string')
    fail('DISABLED');
  const first=new Date(env.BACKUP_WATCHDOG_FIRST_DUE+'T00:00:00.000Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(env.BACKUP_WATCHDOG_FIRST_DUE)||
     !Number.isFinite(first.getTime())||
     utcDay(first)!==env.BACKUP_WATCHDOG_FIRST_DUE)fail('DISABLED');
  return first.getTime();
}
function expectedDate(now){
  const time=now.getTime();
  if(!Number.isFinite(time))fail('INVALID_CLOCK');
  // Auditor executes at 10:00 UTC, 30 minutes beyond the 09:30 grace.
  const midnight=Math.floor(time/86_400_000)*86_400_000;
  const due=(time>=midnight+9*3_600_000+30*60_000)?midnight:midnight-86_400_000;
  return new Date(due).toISOString().slice(0,10);
}
function backupObjectName(key,prefix,date){
  if(typeof key!=='string'||!key.startsWith(prefix))fail('INVALID_LIST');
  const suffix=key.slice(prefix.length);
  const match=new RegExp('^'+date+'T(\\d\\d)-(\\d\\d)-(\\d\\d)-(\\d{3})Z-'+UUID+'\\.json$','i').exec(suffix);
  if(!match)fail('INVALID_NAME');
  const stamp=date+'T'+match[1]+':'+match[2]+':'+match[3]+'.'+match[4]+'Z';
  const parsed=Date.parse(stamp);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==stamp)fail('INVALID_NAME');
  const offset=parsed-Date.parse(date+'T08:00:00.000Z');
  if(offset<0||offset>90*60_000)fail('INVALID_NAME');
}
async function loadObjects(bucket,prefix,date){
  const out=[],seen=new Set();let cursor;
  for(let i=0;i<4;i++){
    const result=await bucket.list({
      prefix:prefix+date,limit:PAGE_SIZE,include:['customMetadata'],
      ...(cursor?{cursor}:{}),
    });
    if(!result||!Array.isArray(result.objects))fail('INVALID_LIST');
    for(const item of result.objects){
      backupObjectName(item?.key,prefix,date);
      if(seen.has(item.key))fail('DUPLICATE');
      seen.add(item.key);
      out.push(item);
      if(out.length>MAX_OBJECTS)fail('EXCESSIVE_GENERATIONS');
    }
    if(!result.truncated)return out;
    if(typeof result.cursor!=='string'||!result.cursor||result.cursor===cursor)
      fail('INVALID_CURSOR');
    cursor=result.cursor;
  }
  fail('PAGINATION_LIMIT');
}
function validateSnapshot(source,scope,keyId){
  if(!exact(source,['format','scope','keyId','schemaVersion','status','tables'])||
     source.format!==BACKUP_FORMAT||source.scope!==scope||
     source.keyId!==keyId||source.schemaVersion!==1||
     source.status!=='automatic-owner-ciphertext'||
     !exact(source.tables,['knowledge_instance','knowledge_pages','knowledge_revisions']))
    fail('INVALID_SNAPSHOT');
  try {
    checkRows([source.tables.knowledge_instance,source.tables.knowledge_pages,
      source.tables.knowledge_revisions],keyId);
  }catch{fail('INVALID_SNAPSHOT');}
  return {pages:source.tables.knowledge_pages.length,
    revisions:source.tables.knowledge_revisions.length,
    instances:source.tables.knowledge_instance.length};
}
async function digest(bytes){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    value=>value.toString(16).padStart(2,'0')).join('');
}

/** Public for fictional tests; does not write to D1, R2, or any other service. */
export async function auditDailyBackup(env,now=new Date()){
  const first=configured(env);
  const day=expectedDate(now);
  if(Date.parse(day+'T00:00:00.000Z')<first)
    return {status:'PENDING_FIRST_RUN',day,checked:0};
  const bucket=env.BACKUP_WATCHDOG_BUCKET;
  const prefix=PREFIX+env.BACKUP_WATCHDOG_SPACE+'/'+env.BACKUP_WATCHDOG_KEY_ID+'/';
  const items=await loadObjects(bucket,prefix,day);
  if(!items.length)fail('MISSING_DAY');
  let counts;
  for(const item of items){
    if(!Number.isSafeInteger(item.size)||item.size<=0||item.size>MAX_BYTES||
       !SHA.test(item.customMetadata?.sha256)||
       item.customMetadata.format!==BACKUP_FORMAT)
      fail('INVALID_METADATA');
    const object=await bucket.get(item.key);
    if(!object||typeof object.arrayBuffer!=='function')fail('MISSING_OBJECT');
    if(typeof object.size==='number'&&object.size!==item.size)
      fail('READBACK_MISMATCH');
    const buffer=await object.arrayBuffer();
    const bytes=new Uint8Array(buffer);
    if(bytes.length!==item.size||bytes.length>MAX_BYTES)fail('READBACK_MISMATCH');
    const sha=await digest(bytes);
    if(sha!==item.customMetadata.sha256)fail('CHECKSUM_MISMATCH');
    let snapshot;
    try {snapshot=JSON.parse(decoder.decode(bytes));}
    catch {fail('INVALID_SNAPSHOT');}
    counts=validateSnapshot(snapshot,env.BACKUP_WATCHDOG_SPACE,env.BACKUP_WATCHDOG_KEY_ID);
  }
  return {status:'PASS',day,checked:items.length,counts};
}

export default {
  async fetch(){
    return new Response(null,{status:404,headers:{
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    }});
  },
  async scheduled(controller,env){
    if(controller?.cron!==WATCHDOG_CRON||
       !Number.isFinite(controller.scheduledTime))
      fail('NOT_SCHEDULED');
    try{
      const result=await auditDailyBackup(env,new Date(controller.scheduledTime));
      if(result.status!=='PASS')fail('NOT_DUE');
      // Only non-sensitive aggregate operational health; no object keys.
      console.log('Knowledge scheduled backup health verified',
        JSON.stringify({day:result.day,checked:result.checked,counts:result.counts}));
    }catch{
      console.error('Knowledge scheduled backup health FAILED');
      throw new Error('KNOWLEDGE_BACKUP_WATCHDOG_FAILED');
    }
  },
};
