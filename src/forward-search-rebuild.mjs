/** Bounded owner-local blind-index rebuilding. Never exposed as an MCP tool. */
const KEY=/^[A-Za-z0-9_-]{43}$/;
const PROGRESS='SELECT format_version,substr(instance_check,1,44) AS instance_check,substr(after_key,1,44) AS after_key,processed,substr(state,1,16) AS state FROM knowledge_search_rebuild_progress WHERE id = 1';
const fail=()=>Object.assign(new Error('Private search rebuild refused; verify the source and retry'),{code:'SEARCH_REBUILD_REFUSED'});
function check({db,reader,limit}){
  if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function'||
     !reader||!['verifyInstance','authenticatePage','expectedTerms','indexStatements'].every(k=>typeof reader[k]==='function')||
     !Number.isInteger(limit)||limit<1||limit>25)throw fail();
}
async function pageBatch(db,after,limit){
  if(after!==''&&!KEY.test(after))throw fail();
  const result=await db.prepare('SELECT substr(path_key,1,44) AS path_key,version,CASE WHEN length(sealed)<=32000 THEN sealed ELSE NULL END AS sealed,substr(updated_at,1,32) AS updated_at FROM knowledge_pages WHERE path_key > ? ORDER BY knowledge_pages.path_key LIMIT ?')
    .bind(after,limit+1).all();
  if(!Array.isArray(result?.results)||result.results.length>limit+1)throw fail();
  let prior=after;
  for(const row of result.results){
    if(!KEY.test(row.path_key)||row.path_key<=prior)throw fail();
    prior=row.path_key;
  }
  return {rows:result.results.slice(0,limit),hasMore:result.results.length>limit};
}
async function authenticateCurrent(db,reader,row){
  const page=await reader.authenticatePage(row);
  const revision=await db.prepare('SELECT CASE WHEN length(sealed)<=32000 THEN sealed ELSE NULL END AS sealed,substr(created_at,1,32) AS created_at FROM knowledge_revisions WHERE path_key = ? AND version = ?')
    .bind(row.path_key,row.version).first();
  if(revision?.sealed!==row.sealed||revision.created_at!==row.updated_at)throw fail();
  return page;
}

/** Start/reset progress only after authenticating the existing database marker. */
export async function startSearchRebuild({db,reader,restart=false}={}){
  check({db,reader,limit:20});
  if(typeof restart!=='boolean')throw fail();
  const marker=await reader.verifyInstance(db);
  const previous=await db.prepare(PROGRESS).first();
  if(previous&&(previous.instance_check!==marker||previous.format_version!==1))throw fail();
  if(!previous||restart){
    await db.prepare("INSERT INTO knowledge_search_rebuild_progress(id,format_version,instance_check,after_key,processed,state) VALUES (1,1,?,'',0,'building') ON CONFLICT(id) DO UPDATE SET after_key='',processed=0,state='building'")
      .bind(marker).run();
  }
  return {state:previous&&!restart?previous.state:'building'};
}

/** Index writes and the progress cursor commit atomically, including an empty tail. */
export async function rebuildSearchBatch({db,reader,limit=20}={}){
  check({db,reader,limit});
  const marker=await reader.verifyInstance(db);
  const p=await db.prepare(PROGRESS).first();
  if(!p||p.format_version!==1||p.instance_check!==marker||p.state!=='building'||
     !Number.isSafeInteger(p.processed)||p.processed<0)throw fail();
  const batch=await pageBatch(db,p.after_key,limit);
  const writes=[];
  for(const row of batch.rows){
    const page=await authenticateCurrent(db,reader,row);
    writes.push(...await reader.indexStatements(db,row,page));
  }
  const after=batch.rows.at(-1)?.path_key??p.after_key;
  const state=batch.hasMore?'building':'built';
  writes.push(db.prepare('UPDATE knowledge_search_rebuild_progress SET after_key=?,processed=?,state=? WHERE id=1 AND instance_check=? AND after_key=? AND processed=? AND state=\'building\'')
    .bind(after,p.processed+batch.rows.length,state,marker,p.after_key,p.processed));
  const results=await db.batch(writes);
  if(!Array.isArray(results)||results.length!==writes.length||results.at(-1)?.meta?.changes!==1)throw fail();
  return {state,processed:p.processed+batch.rows.length,batchPages:batch.rows.length};
}

/** Full independent traversal, not a trust decision based on the progress cursor. */
export async function verifySearchIndex({db,reader,limit=20,markProgress=false}={}){
  check({db,reader,limit});
  if(typeof db.withConsistentRead!=='function'||typeof markProgress!=='boolean')throw fail();
  return db.withConsistentRead(async()=>{
    const marker=await reader.verifyInstance(db);
    let after='',pages=0,tokens=0;
    for(;;){
      const batch=await pageBatch(db,after,limit);
      for(const row of batch.rows){
        const page=await authenticateCurrent(db,reader,row);
        const expected=(await reader.expectedTerms(page)).sort();
        const stored=await db.prepare('SELECT substr(token_key,1,44) AS token_key FROM knowledge_search_terms WHERE path_key = ? ORDER BY knowledge_search_terms.token_key LIMIT 1025').bind(row.path_key).all();
        const version=await db.prepare('SELECT version FROM knowledge_search_versions WHERE path_key = ?').bind(row.path_key).first();
        if(version?.version!==row.version||!Array.isArray(stored?.results)||
           stored.results.length!==expected.length||stored.results.some((x,i)=>x.token_key!==expected[i]))throw fail();
        pages++;tokens+=expected.length;
      }
      after=batch.rows.at(-1)?.path_key??after;
      if(!batch.hasMore)break;
    }
    // Detect orphan rows as well as missing or forged term membership.
    const extra=await db.prepare('SELECT s.path_key FROM knowledge_search_versions s LEFT JOIN knowledge_pages p ON p.path_key=s.path_key WHERE p.path_key IS NULL UNION ALL SELECT t.path_key FROM knowledge_search_terms t LEFT JOIN knowledge_pages p ON p.path_key=t.path_key WHERE p.path_key IS NULL LIMIT 1').first();
    if(extra)throw fail();
    if(markProgress){
      const result=await db.prepare("UPDATE knowledge_search_rebuild_progress SET state='verified',processed=? WHERE id=1 AND instance_check=? AND state IN ('built','verified')")
        .bind(pages,marker).run();
      if(result?.meta?.changes!==1)throw fail();
    }
    return {verified:true,pages,tokens};
  });
}
