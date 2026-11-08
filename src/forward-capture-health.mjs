/**
 * Read-only operational health for the separate encrypted GitHub capture inbox.
 * Never SELECT sealed content, delivery keys, event bodies, or owner records.
 * This checks ledger state only; "saved" cannot substitute for independent
 * Knowledge record readback or prove an authorized webhook is installed.
 */
const API='https://api.cloudflare.com/client/v4';
const HEX32=/^[0-9a-f]{32}$/i;
const STATES=['queued','leased','saved','blocked','failed'];
const STATE_SET=new Set(STATES);
const DEFAULT_QUEUE_GRACE_MS=30*60_000;
const DEFAULT_LEASE_GRACE_MS=2*60_000;

// Fixed, aggregate-only SQL: never accept user-supplied queries.
export const CAPTURE_HEALTH_SQL=[
  'SELECT state, COUNT(*) AS n, MAX(attempts) AS max_attempts,',
  'MIN(next_at) AS earliest_next_at, MIN(lease_until) AS earliest_lease_until',
  'FROM knowledge_capture_inbox GROUP BY state ORDER BY state',
].join(' ');

const fail=(reason)=>{throw new Error('KNOWLEDGE_CAPTURE_HEALTH_'+reason);};
function canonicalTime(value) {
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    fail('INVALID_RESPONSE');
  const ms=Date.parse(value);
  if(!Number.isSafeInteger(ms)||new Date(ms).toISOString()!==value)
    fail('INVALID_RESPONSE');
  return ms;
}
function duration(value,max){
  if(!Number.isSafeInteger(value)||value<0||value>max)fail('BAD_CONFIGURATION');
  return value;
}
/** Validate every aggregate; refuse unknown states, duplicate groups and partial results. */
export function evaluateCaptureInboxHealth(rows,{now=new Date(),
  queueGraceMs=DEFAULT_QUEUE_GRACE_MS,
  leaseGraceMs=DEFAULT_LEASE_GRACE_MS}={}){
  duration(queueGraceMs,24*60*60_000);
  duration(leaseGraceMs,60*60_000);
  const instant=now instanceof Date?now.getTime():NaN;
  if(!Number.isSafeInteger(instant)||instant<0)fail('BAD_CLOCK');
  if(!Array.isArray(rows)||rows.length>STATES.length)fail('INVALID_RESPONSE');
  const totals=Object.fromEntries(STATES.map(k=>[k,0]));
  let maxAttempts=0,staleQueued=false,staleLeased=false;
  const seen=new Set();
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||
       !STATE_SET.has(row.state)||seen.has(row.state)||
       !Number.isSafeInteger(row.n)||row.n<1||row.n>1_000_000_000||
       !Number.isSafeInteger(row.max_attempts)||row.max_attempts<0||
       row.max_attempts>100)
      fail('INVALID_RESPONSE');
    seen.add(row.state);
    totals[row.state]=row.n;
    maxAttempts=Math.max(maxAttempts,row.max_attempts);
    if(row.state==='queued'){
      const next=canonicalTime(row.earliest_next_at);
      staleQueued=instant-next>queueGraceMs;
    }
    if(row.state==='leased'){
      const lease=canonicalTime(row.earliest_lease_until);
      staleLeased=instant-lease>leaseGraceMs;
    }
  }
  const total=Object.values(totals).reduce((a,b)=>a+b,0);
  const attention=totals.blocked>0||totals.failed>0||staleQueued||staleLeased;
  const status=attention?'ATTENTION_REQUIRED':total===0?'NO_EVENTS':
    totals.queued+totals.leased>0?'IN_PROGRESS':'LEDGER_SAVED_ONLY';
  return {status,observedAt:new Date(instant).toISOString(),totals,
    total,pending:totals.queued+totals.leased,exceptions:totals.blocked+totals.failed,
    staleQueued,staleLeased,maxAttempts,
    evidence:'INBOX_LEDGER_ONLY_NOT_KNOWLEDGE_READBACK'};
}
/**
 * Owner-controlled CLI adapter. Requires an appropriately scoped Cloudflare
 * token; Cloudflare's D1 /query API uses POST even for the fixed SELECT.
 * Never trust request arguments to populate SQL or reveal response rows.
 */
export async function readCaptureInboxHealth({token,account,database,
  fetchImpl=fetch,now=new Date()}={}){
  if(typeof token!=='string'||!token.trim()||!HEX32.test(account)||
     !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(database)||
     typeof fetchImpl!=='function')fail('BAD_CONFIGURATION');
  let response;
  try {
    response=await fetchImpl(
      API+'/accounts/'+account+'/d1/database/'+database+'/query',
      {method:'POST',redirect:'error',headers:{
        Authorization:'Bearer '+token,'Content-Type':'application/json',
        'Cache-Control':'no-store',
      },body:JSON.stringify({sql:CAPTURE_HEALTH_SQL})}
    );
  } catch{fail('PROVIDER_UNAVAILABLE');}
  if(!response?.ok)fail('PROVIDER_UNAVAILABLE');
  const size=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(size)&&size>16_384)fail('INVALID_RESPONSE');
  let parsed;
  try{parsed=await response.json();}catch{fail('INVALID_RESPONSE');}
  if(parsed?.success!==true||!Array.isArray(parsed.result)||
     parsed.result.length!==1||parsed.result[0]?.success!==true||
     !Array.isArray(parsed.result[0]?.results))
    fail('INVALID_RESPONSE');
  return evaluateCaptureInboxHealth(parsed.result[0].results,{now});
}
