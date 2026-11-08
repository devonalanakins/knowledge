/** Local SQLite adapter. It has no Cloudflare API client or network capability. */
import {DatabaseSync} from 'node:sqlite';
export function createSearchRebuildSqliteAdapter(database){
  if(!(database instanceof DatabaseSync))throw new Error('Private local SQLite database required');
  let inTransaction=false;
  async function transaction(fn){
    if(inTransaction)throw new Error('Nested private search transactions are not supported');
    database.exec('BEGIN IMMEDIATE');inTransaction=true;
    try{const result=await fn();database.exec('COMMIT');return result;}
    catch(e){database.exec('ROLLBACK');throw e;}
    finally{inTransaction=false;}
  }
  return {
    prepare(sql){
      function bound(params){return {
        async first(){return database.prepare(sql).get(...params)??null;},
        async all(){return {results:database.prepare(sql).all(...params)};},
        async run(){return {meta:{changes:Number(database.prepare(sql).run(...params).changes)}};},
      };}
      return {...bound([]),bind:(...params)=>bound(params)};
    },
    batch:statements=>transaction(async()=>{
      const out=[];for(const statement of statements)out.push(await statement.run());return out;
    }),
    // Verification holds a reserved write lock across the entire traversal.
    // Other SQLite writers cannot invalidate an already-verified earlier batch.
    withConsistentRead:transaction,
  };
}
