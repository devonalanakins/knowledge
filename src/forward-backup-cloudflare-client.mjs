/** Minimal read-only Cloudflare R2 API adapter for Knowledge backup monitoring. */
const API='https://api.cloudflare.com/client/v4';
const ACCOUNT=/^[0-9a-f]{32}$/i;
const BUCKET=/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
export function createReadOnlyR2Client({token,account,bucket,fetchImpl=fetch}={}){
  if(typeof token!=='string'||!token.trim()||!ACCOUNT.test(account)||
     !BUCKET.test(bucket)||typeof fetchImpl!=='function')
    throw new Error('KNOWLEDGE_BACKUP_HEALTH_CONFIGURATION_REQUIRED');
  async function get(path){
    const res=await fetchImpl(API+path,{method:'GET',redirect:'error',
      headers:{Authorization:`Bearer ${token}`,'Cache-Control':'no-store'}});
    if(!res.ok)throw new Error(`KNOWLEDGE_BACKUP_HEALTH_API_STATUS_${res.status}`);
    return res;
  }
  async function listObjects(prefix){
    if(typeof prefix!=='string'||!/^automated\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(prefix))
      throw new Error('KNOWLEDGE_BACKUP_HEALTH_INVALID_PREFIX');
    const all=[];const seen=new Set();let cursor;
    for(let i=0;i<20;i++){
      const query=new URLSearchParams({prefix,per_page:'500'});
      if(cursor)query.set('cursor',cursor);
      const res=await get(`/accounts/${account}/r2/buckets/${bucket}/objects?${query}`);
      const body=await res.json();
      const objects=Array.isArray(body.result)?body.result:body.result?.objects;
      if(body.success!==true||!Array.isArray(objects))
        throw new Error('KNOWLEDGE_BACKUP_HEALTH_API_LIST');
      all.push(...objects);
      if(all.length>10_000)throw new Error('KNOWLEDGE_BACKUP_HEALTH_TOO_MANY_OBJECTS');
      const truncated=body.result_info?.is_truncated??body.result?.truncated??false;
      if(!truncated)return all;
      cursor=body.result_info?.cursor??body.result?.cursor;
      if(typeof cursor!=='string'||!cursor||seen.has(cursor))
        throw new Error('KNOWLEDGE_BACKUP_HEALTH_CURSOR');
      seen.add(cursor);
    }
    throw new Error('KNOWLEDGE_BACKUP_HEALTH_PAGINATION');
  }
  async function readObject(key){
    if(typeof key!=='string'||!/^automated\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.json$/.test(key))
      throw new Error('KNOWLEDGE_BACKUP_HEALTH_INVALID_KEY');
    // Cloudflare R2 requires slash characters in object keys to stay literal.
    const encoded=key.split('/').map(encodeURIComponent).join('/');
    const res=await get(`/accounts/${account}/r2/buckets/${bucket}/objects/${encoded}`);
    if(Number(res.headers.get('content-length'))>32*1024*1024)
      throw new Error('KNOWLEDGE_BACKUP_HEALTH_OVERSIZE');
    // Stream with a hard byte cap even if Content-Length is missing or dishonest.
    if(!res.body)throw new Error('KNOWLEDGE_BACKUP_HEALTH_EMPTY_RESPONSE');
    const reader=res.body.getReader(),parts=[];let length=0;
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        if(!(value instanceof Uint8Array))throw new Error('KNOWLEDGE_BACKUP_HEALTH_INVALID_BYTES');
        length+=value.byteLength;
        if(length>32*1024*1024)throw new Error('KNOWLEDGE_BACKUP_HEALTH_OVERSIZE');
        parts.push(value);
      }
    }finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    return bytes;
  }
  return {listObjects,readObject};
}
