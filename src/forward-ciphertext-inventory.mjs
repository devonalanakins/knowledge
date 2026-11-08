/**
 * Owner-local ciphertext source-inventory witness for SQL export parity.
 *
 * This is NOT a signature, a recovered-key proof or a provider API client.
 * Derive the expected witness independently from a frozen trusted source;
 * an inventory calculated from the export itself cannot prove completeness.
 * Never log or publish an inventory from an owner's private records.
 */
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export const FORWARD_INVENTORY_FORMAT='knowledge-forward-ciphertext-inventory-v1';
const REFUSED='KNOWLEDGE_SOURCE_INVENTORY_REFUSED';
const HASH=/^[0-9a-f]{64}$/;
const columns=Object.freeze({
  knowledge_instance:['id','key_check'],
  knowledge_pages:['path_key','version','sealed','updated_at'],
  knowledge_revisions:['path_key','version','sealed','created_at'],
});
const maximum=Object.freeze({
  knowledge_instance:1,
  knowledge_pages:100_000,
  knowledge_revisions:1_000_000,
});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,names)=>plain(v)&&Object.keys(v).length===names.length&&
  names.every(n=>Object.hasOwn(v,n));
const fail=()=>new Error(REFUSED);

function writeField(hash,value){
  let tag,bytes;
  if(typeof value==='string'){
    tag=0x73;bytes=Buffer.from(value,'utf8');
  }else if(Number.isSafeInteger(value)&&value>=0){
    tag=0x69;bytes=Buffer.from(String(value),'ascii');
  }else throw fail();
  if(bytes.length>50_000)throw fail();
  const size=Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  hash.update(Buffer.from([tag]));
  hash.update(size);
  hash.update(bytes);
}

/**
 * BINARY ordering, fixed field order and length-prefixed encoding guarantee
 * that two different sets of ciphertext rows cannot share a serialization.
 * One local SQLite read transaction covers all three queries.
 */
export function inventoryForwardCiphertextSqlite(database){
  if(!(database instanceof DatabaseSync))throw fail();
  const tables={};
  let inTransaction=false;
  try{
    database.exec('BEGIN');
    inTransaction=true;
    for(const [table,fields] of Object.entries(columns)){
      const hash=createHash('sha256');
      hash.update(FORWARD_INVENTORY_FORMAT+'\0'+table+'\0');
      const statement=database.prepare(
        'SELECT '+fields.join(',')+' FROM '+table+
        ' ORDER BY '+(table==='knowledge_instance'?'id':'path_key COLLATE BINARY')+
        (table==='knowledge_revisions'?',version':'')
      );
      let count=0;
      for(const row of statement.iterate()){
        count++;
        if(count>maximum[table])throw fail();
        hash.update(Buffer.from([0x52]));
        for(const field of fields)writeField(hash,row[field]);
      }
      tables[table]={count,sha256:hash.digest('hex')};
    }
    database.exec('ROLLBACK');
    inTransaction=false;
    if(tables.knowledge_instance.count!==1||
       tables.knowledge_revisions.count<tables.knowledge_pages.count)throw fail();
    return {format:FORWARD_INVENTORY_FORMAT,tables};
  }catch{
    if(inTransaction)try{database.exec('ROLLBACK');}catch{}
    throw fail();
  }
}

/** No private row content is returned; mismatch details are deliberately generic. */
export function assertForwardCiphertextInventory(database,expected){
  if(!exact(expected,['format','tables'])||
     expected.format!==FORWARD_INVENTORY_FORMAT||
     !exact(expected.tables,Object.keys(columns)))throw fail();
  const actual=inventoryForwardCiphertextSqlite(database);
  for(const table of Object.keys(columns)){
    const entry=expected.tables[table];
    if(!exact(entry,['count','sha256'])||
       !Number.isSafeInteger(entry.count)||entry.count<0||
       entry.count>maximum[table]||!HASH.test(entry.sha256)||
       entry.count!==actual.tables[table].count||
       entry.sha256!==actual.tables[table].sha256)throw fail();
  }
  return true;
}
