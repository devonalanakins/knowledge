/**
 * Isolated, cron-only encrypted-row backup Worker for the forward Knowledge D1.
 *
 * This Worker never receives KNOWLEDGE_DATA_KEY, never decrypts anything,
 * does not serve a public HTTP API, and NEVER deletes backup objects.
 * A separate human-controlled off-provider copy remains a release requirement.
 */
export const BACKUP_CRON = '0 8 * * *'; // 08:00 UTC, once daily.
export const BACKUP_ACK = 'OWNER_ONLY_CIPHERTEXT_SCHEDULED_V1';
export const BACKUP_FORMAT = 'knowledge-forward-ciphertext-backup-v1';
const MAX_PAGES = 500;
const MAX_REVISIONS = 64_000;
const MAX_SNAPSHOT_BYTES = 25_000_000;
const PATH_KEY = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID = /^[a-z0-9-]{1,32}$/;
const SPACE = /^[a-z][a-z0-9-]{0,63}$/;
const VALID_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const sql = Object.freeze([
  'SELECT id, key_check FROM knowledge_instance ORDER BY id',
  'SELECT path_key, version, sealed, updated_at FROM knowledge_pages ORDER BY path_key',
  'SELECT path_key, version, sealed, created_at FROM knowledge_revisions ORDER BY path_key, version',
]);
const encoder = new TextEncoder();
const invalid = () => new Error('KNOWLEDGE_BACKUP_INVALID_SOURCE');
const object = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (x, names) => object(x) && Object.keys(x).length === names.length &&
  names.every(n => Object.hasOwn(x, n));
function isTime(s) {
  return typeof s === 'string' && VALID_TIME.test(s) &&
    !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s;
}
function checkSealed(s, keyId) {
  if (typeof s !== 'string' || s.length < 30 || s.length > 32000) throw invalid();
  let parsed;
  try { parsed = JSON.parse(s); } catch { throw invalid(); }
  if (!exact(parsed, ['format','keyId','nonce','data']) ||
      parsed.format !== 'knowledge-sealed-v1' || parsed.keyId !== keyId ||
      typeof parsed.nonce !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(parsed.nonce) ||
      typeof parsed.data !== 'string' || !/^[A-Za-z0-9_-]{24,31000}$/.test(parsed.data))
    throw invalid();
}
function checkRows(tables, keyId) {
  const [instance, pages, revisions] = tables;
  if (![instance, pages, revisions].every(Array.isArray) ||
      instance.length > 1 || pages.length > MAX_PAGES ||
      revisions.length > MAX_REVISIONS ||
      (pages.length > 0 && instance.length !== 1))
    throw invalid();
  for (const row of instance)
    if (!exact(row,['id','key_check']) || row.id !== 1 || !PATH_KEY.test(row.key_check)) throw invalid();
  const byPath = new Map();
  for (const row of pages) {
    if (!exact(row,['path_key','version','sealed','updated_at']) ||
        !PATH_KEY.test(row.path_key) || !Number.isInteger(row.version) ||
        row.version < 1 || row.version > 128 || !isTime(row.updated_at) ||
        byPath.has(row.path_key))
      throw invalid();
    checkSealed(row.sealed,keyId);
    byPath.set(row.path_key,{current:row, revisions:new Map()});
  }
  for (const row of revisions) {
    if (!exact(row,['path_key','version','sealed','created_at']) ||
        !PATH_KEY.test(row.path_key) || !Number.isInteger(row.version) ||
        row.version < 1 || row.version > 128 || !isTime(row.created_at) ||
        !byPath.has(row.path_key))
      throw invalid();
    checkSealed(row.sealed,keyId);
    const history=byPath.get(row.path_key).revisions;
    if (history.has(row.version)) throw invalid();
    history.set(row.version,row);
  }
  for (const {current,revisions:history} of byPath.values()) {
    if (history.size !== current.version) throw invalid();
    for(let v=1;v<=current.version;v++)
      if (!history.has(v)) throw invalid();
    const latest=history.get(current.version);
    if (latest.sealed!==current.sealed || latest.created_at!==current.updated_at)
      throw invalid();
  }
  if (revisions.length !== [...byPath.values()].reduce((n,x)=>n+x.current.version,0))
    throw invalid();
}
/**
 * Batch SELECTs run in one D1 SQL transaction, so the three tables represent
 * one coherent view even if a page is updated concurrently by another Worker.
 */
export async function createCiphertextSnapshot(env) {
  if (!env || env.BACKUP_ACK !== BACKUP_ACK || !SPACE.test(env.BACKUP_SPACE) ||
      !KEY_ID.test(env.BACKUP_KEY_ID) || !env.BACKUP_DB ||
      typeof env.BACKUP_DB.batch !== 'function' || !env.BACKUP_BUCKET ||
      typeof env.BACKUP_BUCKET.put !== 'function' ||
      typeof env.BACKUP_BUCKET.get !== 'function') throw new Error('KNOWLEDGE_BACKUP_DISABLED');
  const result = await env.BACKUP_DB.batch(sql.map(q => env.BACKUP_DB.prepare(q)));
  if (!Array.isArray(result) || result.length !== 3 ||
      result.some(x => x?.success === false || !Array.isArray(x?.results)))
    throw invalid();
  const data = result.map(x => x.results);
  checkRows(data,env.BACKUP_KEY_ID);
  const snapshot = {
    format:BACKUP_FORMAT, scope:env.BACKUP_SPACE, keyId:env.BACKUP_KEY_ID,
    schemaVersion:1, status:'automatic-owner-ciphertext', tables:{
      knowledge_instance:data[0], knowledge_pages:data[1], knowledge_revisions:data[2],
    },
  };
  const bytes=encoder.encode(JSON.stringify(snapshot));
  if (!bytes.length || bytes.length > MAX_SNAPSHOT_BYTES) throw invalid();
  return {bytes,counts:{
    pages:data[1].length, revisions:data[2].length, instances:data[0].length,
  }};
}
const hex = buffer => Array.from(new Uint8Array(buffer),n=>n.toString(16).padStart(2,'0')).join('');
export async function runScheduledBackup(event,env) {
  if (!event || event.cron !== BACKUP_CRON || !Number.isFinite(event.scheduledTime))
    throw new Error('KNOWLEDGE_BACKUP_NOT_SCHEDULED');
  const time=new Date(event.scheduledTime);
  if(Number.isNaN(time.getTime())) throw new Error('KNOWLEDGE_BACKUP_NOT_SCHEDULED');
  const {bytes,counts}=await createCiphertextSnapshot(env);
  const sha256=hex(await crypto.subtle.digest('SHA-256',bytes));
  const stamp=time.toISOString().replace(/[:.]/g,'-');
  const objectKey='automated/'+env.BACKUP_SPACE+'/'+env.BACKUP_KEY_ID+'/'+
    stamp+'-'+crypto.randomUUID()+'.json';
  const created=await env.BACKUP_BUCKET.put(objectKey,bytes,{
    onlyIf:new Headers({'If-None-Match':'*'}),
    httpMetadata:{contentType:'application/json'},
    customMetadata:{sha256, format:BACKUP_FORMAT},
  });
  if (!created) throw new Error('KNOWLEDGE_BACKUP_WRITE_FAILED');
  const got=await env.BACKUP_BUCKET.get(objectKey);
  if (!got || typeof got.arrayBuffer !== 'function') throw new Error('KNOWLEDGE_BACKUP_READBACK_FAILED');
  const readback=new Uint8Array(await got.arrayBuffer());
  const verify=hex(await crypto.subtle.digest('SHA-256',readback));
  if (verify !== sha256 || readback.byteLength !== bytes.byteLength)
    throw new Error('KNOWLEDGE_BACKUP_READBACK_FAILED');
  return {objectKey,sha256,bytes:bytes.length,counts};
}
export default {
  async fetch() {
    return new Response(null,{status:404,headers:{
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    }});
  },
  async scheduled(controller,env) {
    // No recovery secret is bound; only ciphertext rows are accessible.
    try {
      const receipt=await runScheduledBackup(controller,env);
      console.log('Knowledge ciphertext backup complete',JSON.stringify({
        key:receipt.objectKey,sha256:receipt.sha256,counts:receipt.counts,
      }));
    } catch {
      console.error('Knowledge ciphertext backup failed (no data logged)');
      throw new Error('KNOWLEDGE_BACKUP_FAILED');
    }
  },
};
