/** Local SQLite adapter. It has no Cloudflare API client or network capability. */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const schemaQuery="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY name";
let expected;
function expectedObjects(){
  if(expected)return expected;
  const reference=new DatabaseSync(':memory:');
  try{
    reference.exec(readFileSync(new URL('../ops/private-forward/schema.sql',import.meta.url),'utf8'));
    const required=new Set(reference.prepare(schemaQuery).all().map(x=>x.name));
    for(const path of ['search-index-v1.sql','search-rebuild-v1.sql'])
      reference.exec(readFileSync(new URL('../ops/private-forward/'+path,import.meta.url),'utf8'));
    expected={required,objects:new Map(reference.prepare(schemaQuery).all().map(x=>[x.name,JSON.stringify(x)]))};
    return expected;
  }finally{reference.close();}
}
function verifySchema(database){
  const {required,objects}=expectedObjects(),rows=database.prepare(schemaQuery).all();
  const present=new Set(rows.map(x=>x.name));
  if([...required].some(name=>!present.has(name))||
     rows.some(row=>objects.get(row.name)!==JSON.stringify(row))||
     database.prepare('SELECT COUNT(*) AS n FROM sqlite_temp_master').get().n!==0||
     database.prepare('PRAGMA database_list').all().some(x=>!['main','temp'].includes(x.name))||
     database.prepare('PRAGMA foreign_keys').get().foreign_keys!==1)
    throw new Error('Private rebuild requires the exact reviewed ciphertext schema');
}
export function createSearchRebuildSqliteAdapter(database){
  if(!(database instanceof DatabaseSync))throw new Error('Private local SQLite database required');
  database.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
  verifySchema(database);
  let inTransaction=false;
  async function transaction(fn){
    if(inTransaction)throw new Error('Nested private search transactions are not supported');
    database.exec('BEGIN IMMEDIATE');inTransaction=true;
    try{verifySchema(database);const result=await fn();database.exec('COMMIT');return result;}
    catch(e){database.exec('ROLLBACK');throw e;}
    finally{inTransaction=false;}
  }
  return {
    prepare(sql){
      function bound(params){return {
        async first(){return database.prepare(sql).get(...params)??null;},
        async all(){return {results:database.prepare(sql).all(...params)};},
        async run(){
          const execute=()=>({meta:{changes:Number(database.prepare(sql).run(...params).changes)}});
          return inTransaction?execute():transaction(execute);
        },
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
