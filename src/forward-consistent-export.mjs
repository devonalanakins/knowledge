/**
 * Source-only, manually gated point-in-time D1 export for a separate Workflow.
 * D1's REST export holds a provider-side database lock. NEVER place the API
 * token on the regular ciphertext backup Worker or enable a schedule by default.
 *
 * The selected tables contain encrypted content. The SQL dump still exposes
 * database metadata and must remain in a private bucket.
 */
import {createHash, randomUUID} from 'node:crypto';

export const CONSISTENT_EXPORT_ACK = 'OWNER_REVIEWED_D1_EXPORT_V1';
export const CONSISTENT_EXPORT_FORMAT = 'knowledge-forward-d1-sql-export-v1';
export const CONSISTENT_EXPORT_LIMIT = 512 * 1024 * 1024;
const TABLES = Object.freeze(['knowledge_instance','knowledge_pages','knowledge_revisions']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT = /^[0-9a-f]{32}$/i;
const SCOPE = /^[a-z][a-z0-9-]{0,63}$/;
const KEY_ID = /^[a-z0-9-]{1,32}$/;
const BOOKMARK = /^[0-9a-f-]{16,128}$/i;
const HOST = /^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])?$/;
const MAX_API_BYTES = 32 * 1024;
const noRetry = Object.freeze({retries:{limit:0,delay:'10 seconds'},timeout:'10 minutes'});
const fail = () => new Error('KNOWLEDGE_CONSISTENT_EXPORT_REFUSED');

function settings(env, step, fetchImpl) {
  if (!env || env.CONSISTENT_EXPORT_ACK !== CONSISTENT_EXPORT_ACK ||
      !ACCOUNT.test(env.EXPORT_ACCOUNT_ID) || !UUID.test(env.EXPORT_DATABASE_ID) ||
      !SCOPE.test(env.EXPORT_SCOPE) || !KEY_ID.test(env.EXPORT_KEY_ID) ||
      typeof env.EXPORT_D1_API_TOKEN !== 'string' || env.EXPORT_D1_API_TOKEN.length < 16 ||
      typeof env.EXPORT_SIGNED_HOST !== 'string' || !HOST.test(env.EXPORT_SIGNED_HOST) ||
      env.EXPORT_SIGNED_HOST !== env.EXPORT_SIGNED_HOST.toLowerCase() ||
      !env.EXPORT_SIGNED_HOST.includes('.') ||
      env.EXPORT_SIGNED_HOST.startsWith('localhost') ||
      env.EXPORT_SIGNED_HOST.endsWith('.localhost') ||
      !env.EXPORT_BUCKET || typeof env.EXPORT_BUCKET.put !== 'function' ||
      typeof env.EXPORT_BUCKET.get !== 'function' ||
      typeof step?.do !== 'function' || typeof step?.sleep !== 'function' ||
      typeof fetchImpl !== 'function' ||
      env.KNOWLEDGE_DATA_KEY !== undefined ||
      env.KNOWLEDGE_PRIVATE_WRITE_ACK !== undefined)
    throw fail();
  return {
    api:'https://api.cloudflare.com/client/v4/accounts/' + env.EXPORT_ACCOUNT_ID +
      '/d1/database/' + env.EXPORT_DATABASE_ID + '/export',
    account:env.EXPORT_ACCOUNT_ID, database:env.EXPORT_DATABASE_ID,
    scope:env.EXPORT_SCOPE, keyId:env.EXPORT_KEY_ID,
    token:env.EXPORT_D1_API_TOKEN, signedHost:env.EXPORT_SIGNED_HOST,
    bucket:env.EXPORT_BUCKET,
  };
}

async function readJsonBounded(response) {
  if (!response?.ok || !response.body) throw fail();
  const reader=response.body.getReader();
  const chunks=[];let length=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw fail();
      length+=value.byteLength;
      if (length>MAX_API_BYTES) throw fail();
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(length);let offset=0;
  for (const part of chunks) {bytes.set(part,offset);offset+=part.byteLength;}
  let json;
  try { json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch {throw fail();}
  if (!json || json.success !== true || !json.result ||
      typeof json.result !== 'object' || Array.isArray(json.result)) throw fail();
  return json.result;
}

async function exportRequest(cfg,fetchImpl,payload) {
  const response=await fetchImpl(cfg.api,{
    method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json',Authorization:'Bearer ' + cfg.token},
    body:JSON.stringify(payload),
  });
  return readJsonBounded(response);
}

function checkedSignedUrl(value, host) {
  if (typeof value !== 'string' || value.length>4096) throw fail();
  let url;
  try {url=new URL(value);} catch {throw fail();}
  if (url.protocol!=='https:' || url.hostname!==host || url.port ||
      url.username || url.password || url.hash || url.pathname==='/') throw fail();
  return url.href;
}

async function digestR2Object(object,maxBytes=CONSISTENT_EXPORT_LIMIT) {
  if (!object?.body || typeof object.body.getReader!=='function') throw fail();
  const reader=object.body.getReader();
  const hash=createHash('sha256');let bytes=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw fail();
      bytes+=value.byteLength;
      if (bytes>maxBytes) throw fail();
      hash.update(value);
    }
  } finally {reader.releaseLock();}
  if (bytes===0) throw fail();
  return {bytes,sha256:hash.digest('hex')};
}

/**
 * Workflows preserves step.do results, so no signed download URLs or API keys
 * are placed into its durable step outputs. Pending polling uses explicit
 * sleeps; start, R2 upload and its readback are never blindly retried.
 */
export async function runConsistentD1Export({env,step,fetchImpl=fetch}={}) {
  const cfg=settings(env,step,fetchImpl);
  const bookmark=await step.do('start bounded D1 export',noRetry,async()=>{
    const result=await exportRequest(cfg,fetchImpl,{
      output_format:'polling',dump_options:{compatibility:'d1',tables:TABLES},
    });
    if (!BOOKMARK.test(result.at_bookmark)) throw fail();
    return result.at_bookmark;
  });
  if (!BOOKMARK.test(bookmark)) throw fail();
  const objectKey=await step.do('name immutable export',noRetry,async()=>{
    return 'consistent/' + cfg.scope + '/' + cfg.keyId + '/' +
      new Date().toISOString().replace(/[:.]/g,'-') + '-' + randomUUID() + '.sql';
  });
  if (!/^consistent\/[a-z0-9-]+\/[a-z0-9-]+\/[0-9TZ-]+-[0-9a-f-]{36}\.sql$/.test(objectKey))
    throw fail();
  for(let attempt=0;attempt<20;attempt++){
    const outcome=await step.do('poll and retain D1 export '+attempt,noRetry,async()=>{
      const result=await exportRequest(cfg,fetchImpl,{current_bookmark:bookmark});
      if (result.at_bookmark!==undefined && result.at_bookmark!==bookmark) throw fail();
      if (result.signed_url===undefined || result.signed_url===null)
        return {status:'PENDING'};
      const signed=checkedSignedUrl(result.signed_url,cfg.signedHost);
      const downloaded=await fetchImpl(signed,{method:'GET',redirect:'error'});
      if (!downloaded?.ok || !downloaded.body || downloaded.status!==200) throw fail();
      const contentLength=downloaded.headers.get('content-length');
      if (!/^[1-9][0-9]*$/.test(contentLength||'')) throw fail();
      const length=Number(contentLength);
      if (!Number.isSafeInteger(length) || length>CONSISTENT_EXPORT_LIMIT) throw fail();
      const stored=await cfg.bucket.put(objectKey,downloaded.body,{
        onlyIf:new Headers({'If-None-Match':'*'}),
        httpMetadata:{contentType:'application/sql'},
        customMetadata:{format:CONSISTENT_EXPORT_FORMAT,scope:cfg.scope,
          keyId:cfg.keyId,bookmark},
      });
      if (!stored || stored.size!==length) throw fail();
      const readback=await cfg.bucket.get(objectKey);
      if (!readback || readback.size!==length) throw fail();
      const receipt=await digestR2Object(readback);
      if (receipt.bytes!==length) throw fail();
      return {status:'STORED',format:CONSISTENT_EXPORT_FORMAT,
        scope:cfg.scope,keyId:cfg.keyId,bookmark,
        objectKey,bytes:receipt.bytes,sha256:receipt.sha256};
    });
    if (outcome?.status==='STORED') return outcome;
    if (outcome?.status!=='PENDING') throw fail();
    if (attempt<19) await step.sleep('wait for D1 export '+attempt,'30 seconds');
  }
  throw new Error('KNOWLEDGE_CONSISTENT_EXPORT_NOT_READY');
}
