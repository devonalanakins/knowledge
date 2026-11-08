/** Opt-in keyed term search; derived indexes contain no plaintext terms or bodies. */
const enc=new TextEncoder();
const MAX_TERMS=1024,MAX_QUERY_TERMS=8;
const error=(code,message)=>Object.assign(new Error(message),{code});
export function searchTerms(fields,{maximum=MAX_TERMS}={}){
  if(!Number.isInteger(maximum)||maximum<1||maximum>MAX_TERMS||
     !Array.isArray(fields)||fields.length>3||fields.some(f=>typeof f!=='string'))
    throw error('INVALID_INPUT','Invalid search content');
  if(fields.reduce((n,f)=>n+enc.encode(f).byteLength,0)>20_480)
    throw error('QUOTA_EXCEEDED','Search content limit exceeded');
  const terms=new Set();
  for(const field of fields){
    for(const match of field.normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)){
      terms.add(match[0]);
      if(terms.size>maximum)throw error('QUOTA_EXCEEDED','Search term limit exceeded');
    }
  }
  return [...terms].sort();
}
export async function keyedSearchTerms({key,space,terms}){
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(space))throw error('INVALID_INPUT','Invalid search scope');
  const out=[];
  // Sequential derivation bounds the number of outstanding cryptographic jobs.
  for(const term of terms){
    const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode('knowledge-search-v1\0'+space+'\0'+term)));
    out.push(btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''));
  }
  return out;
}
/** Append to the SAME batch as the page CAS and immutable revision insertion. */
export async function searchIndexStatements({db,key,space,page,pathKey,sealed}){
  const terms=searchTerms([page.path,page.title,page.body]);
  const hashes=await keyedSearchTerms({key,space,terms});
  return [
    db.prepare('DELETE FROM knowledge_search_terms WHERE path_key = ? AND EXISTS (SELECT 1 FROM knowledge_pages WHERE path_key = ? AND version = ? AND sealed = ?)')
      .bind(pathKey,pathKey,page.version,sealed),
    db.prepare('INSERT INTO knowledge_search_terms(token_key,path_key) SELECT value, ? FROM json_each(?) WHERE EXISTS (SELECT 1 FROM knowledge_pages WHERE path_key = ? AND version = ? AND sealed = ?)')
      .bind(pathKey,JSON.stringify(hashes),pathKey,page.version,sealed),
    db.prepare('INSERT INTO knowledge_search_versions(path_key,version) SELECT path_key,version FROM knowledge_pages WHERE path_key = ? AND version = ? AND sealed = ? ON CONFLICT(path_key) DO UPDATE SET version=excluded.version')
      .bind(pathKey,page.version,sealed),
  ];
}
/** Return at most 50 candidates, authenticated by the caller before disclosure. */
export async function indexedSearchCandidates({db,key,space,query}){
  if(typeof query!=='string'||query.length>200)throw error('INVALID_INPUT','Invalid search query');
  const terms=searchTerms([query],{maximum:MAX_QUERY_TERMS});
  if(!terms.length)return {rows:[],terms,truncated:false};
  // Refuse partial coverage rather than returning deceptively complete results.
  const missing=await db.prepare('SELECT p.path_key FROM knowledge_pages p LEFT JOIN knowledge_search_versions s ON s.path_key=p.path_key WHERE s.version IS NULL OR s.version <> p.version LIMIT 1').first();
  if(missing)throw error('SEARCH_INDEX_INCOMPLETE','Private search index needs verified rebuilding');
  const hashes=await keyedSearchTerms({key,space,terms});
  const result=await db.prepare('SELECT p.path_key,p.version,p.sealed FROM knowledge_pages p JOIN (SELECT path_key FROM knowledge_search_terms WHERE token_key IN (SELECT value FROM json_each(?)) GROUP BY path_key HAVING COUNT(*) = ?) matches ON matches.path_key=p.path_key ORDER BY p.path_key LIMIT 51')
    .bind(JSON.stringify(hashes),hashes.length).all();
  if(!Array.isArray(result?.results)||result.results.length>51)throw error('DB_ERROR','Private search unavailable');
  return {rows:result.results.slice(0,50),terms,truncated:result.results.length>50};
}
