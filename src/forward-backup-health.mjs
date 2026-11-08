/**
 * Read-only continuity and checksum audit for Knowledge's daily encrypted R2 snapshots.
 * Does not decrypt records, change R2/D1, or make access-control decisions.
 */
import {createHash} from 'node:crypto';

const DAY_MS=86_400_000;
const NAME=/^(\d{4}-\d\d-\d\d)T08-00-00-000Z-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;
const SCOPE=/^[a-z][a-z0-9-]{0,63}$/;
const KEY_ID=/^[a-z0-9-]{1,32}$/;
const SHA=/^[0-9a-f]{64}$/;
const MD5=/^[0-9a-f]{32}$/;
const fail=(reason)=>{throw new Error('KNOWLEDGE_BACKUP_HEALTH_'+reason);};
function dayStart(input){
  if(typeof input!=='string'||!/^\d{4}-\d\d-\d\d$/.test(input))fail('BAD_CONFIGURATION');
  const n=Date.parse(input+'T00:00:00.000Z');
  if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==input)fail('BAD_CONFIGURATION');
  return n;
}
function isoDay(n){return new Date(n).toISOString().slice(0,10);}

/** The 08:00 UTC scheduled event must complete by 09:30 UTC by default. */
export function expectedBackupDay(now,{graceMinutes=90}={}){
  const ts=now instanceof Date?now.getTime():NaN;
  if(!Number.isFinite(ts)||!Number.isInteger(graceMinutes)||graceMinutes<15||graceMinutes>360)
    fail('BAD_CONFIGURATION');
  const today=Math.floor(ts/DAY_MS)*DAY_MS;
  return isoDay(ts>=today+8*60*60_000+graceMinutes*60_000?today:today-DAY_MS);
}

/**
 * listObjects returns R2 list entries; readObject returns Uint8Array;
 * parseSnapshot is the existing strict Knowledge ciphertext parser.
 * No content, credentials or source paths are returned in the report.
 */
export async function auditScheduledBackups({listObjects,readObject,parseSnapshot,now=new Date(),
  scope,keyId,firstDue,graceMinutes=90,lookbackDays=7}={}){
  if(!SCOPE.test(scope)||!KEY_ID.test(keyId)||
     typeof listObjects!=='function'||typeof readObject!=='function'||
     typeof parseSnapshot!=='function'||!Number.isInteger(lookbackDays)||
     lookbackDays<1||lookbackDays>30)fail('BAD_CONFIGURATION');
  const first=dayStart(firstDue),expected=expectedBackupDay(now,{graceMinutes});
  const expectedTs=dayStart(expected);
  const prefix=`automated/${scope}/${keyId}/`;
  const objects=await listObjects(prefix);
  if(!Array.isArray(objects)||objects.length>10_000)fail('INVALID_LIST');
  const byDay=new Map();
  for(const obj of objects){
    if(!obj||typeof obj.key!=='string'||!obj.key.startsWith(prefix))fail('INVALID_LIST');
    const match=NAME.exec(obj.key.slice(prefix.length));
    if(!match||dayStart(match[1])<first||dayStart(match[1])>expectedTs+DAY_MS||
       !Number.isSafeInteger(obj.size)||obj.size<1||obj.size>32*1024*1024||
       typeof obj.etag!=='string'||!MD5.test(obj.etag.replaceAll('"','').toLowerCase()))
      fail('INVALID_LIST');
    const existing=byDay.get(match[1])||[];
    existing.push(obj);
    if(existing.length>10)fail('EXCESSIVE_RETRIES');
    byDay.set(match[1],existing);
  }
  if(expectedTs<first)return {status:'PENDING_FIRST_RUN',firstDue,expectedDay:expected,checked:0};
  const missing=[];
  for(let t=Math.max(first,expectedTs-(lookbackDays-1)*DAY_MS);t<=expectedTs;t+=DAY_MS)
    if(!byDay.has(isoDay(t)))missing.push(isoDay(t));
  if(missing.length)fail('MISSING_DAY');
  const snapshots=byDay.get(expected)||[];
  const checked=[];
  for(const obj of snapshots){
    const data=await readObject(obj.key);
    if(!(data instanceof Uint8Array)||data.byteLength!==obj.size)fail('READBACK_MISMATCH');
    const md5=createHash('md5').update(data).digest('hex');
    if(md5!==obj.etag.replaceAll('"','').toLowerCase())fail('ETAG_MISMATCH');
    const sha256=createHash('sha256').update(data).digest('hex');
    if(!SHA.test(sha256))fail('CHECKSUM_MISMATCH');
    let parsed;
    try{parsed=parseSnapshot(data,{expectedSha256:sha256});}catch{fail('INVALID_SNAPSHOT');}
    const snapshot=parsed?.snapshot;
    if(snapshot?.scope!==scope||snapshot.keyId!==keyId||
       snapshot.status!=='automatic-owner-ciphertext')fail('INVALID_SNAPSHOT');
    checked.push({sha256,bytes:data.byteLength,
      pages:snapshot.tables.knowledge_pages.length,
      revisions:snapshot.tables.knowledge_revisions.length,
      instances:snapshot.tables.knowledge_instance.length});
  }
  return {status:'PASS',expectedDay:expected,firstDue,checked:checked.length,
    snapshots:checked};
}
