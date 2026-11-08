#!/usr/bin/env node
/** Existing owner key stays in local memory. No network and no page-text output. */
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {lstat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {loadEncryptedKeyRecovery} from '../../src/forward-key-recovery.mjs';
import {createForwardSearchRebuildReader} from '../../src/forward-ciphertext-restore.mjs';
import {startSearchRebuild,rebuildSearchBatch,verifySearchIndex} from '../../src/forward-search-rebuild.mjs';
import {createSearchRebuildSqliteAdapter} from '../../src/forward-search-rebuild-sqlite.mjs';
const usage='Usage: knowledge:search:local -- rebuild|verify ENCRYPTED_SQLITE EXISTING_RECOVERY_JSON [--restart]';
const refusal=()=>new Error('PRIVATE_SEARCH_LOCAL_REFUSED');
async function privateFile(input){
  const path=resolve(input),file=await lstat(path),parent=await lstat(dirname(path));
  if(!file.isFile()||file.isSymbolicLink()||!parent.isDirectory()||parent.isSymbolicLink()||
     (file.mode&0o777)!==0o600||(parent.mode&0o777)!==0o700||
     file.uid!==process.getuid()||parent.uid!==process.getuid())throw refusal();
  return {path,info:file};
}
async function askHidden(){
  const output=new Writable({write(_chunk,_encoding,done){done();}});
  const prompt=createInterface({input:process.stdin,output,terminal:true});
  process.stdout.write('Existing recovery passphrase (hidden): ');
  try{return await new Promise((resolve,reject)=>{
    prompt.question('',resolve);prompt.once('close',()=>reject(refusal()));
  });}finally{prompt.close();process.stdout.write('\n');}
}
async function main(){
  const [command,databasePath,recoveryPath,flag,...extra]=process.argv.slice(2);
  if(!['rebuild','verify'].includes(command)||!databasePath||!recoveryPath||extra.length||
     (flag!==undefined&&(command!=='rebuild'||flag!=='--restart')))throw new Error(usage);
  // Windows ACL verification is not implemented. Never substitute a flag for it.
  if(process.platform==='win32'||typeof process.getuid!=='function'||
     !process.stdin.isTTY||!process.stdout.isTTY)throw refusal();
  const source=await privateFile(databasePath),recovery=await privateFile(recoveryPath);
  if(source.path===recovery.path)throw refusal();
  const kit=await loadEncryptedKeyRecovery(recovery.path);
  const reader=await createForwardSearchRebuildReader({kit,passphrase:await askHidden()});
  let database;
  try{
    database=new DatabaseSync(source.path,{enableForeignKeyConstraints:true});
    database.exec('PRAGMA busy_timeout=1000;');
    const opened=await lstat(source.path);
    if(opened.ino!==source.info.ino||opened.dev!==source.info.dev||opened.isSymbolicLink())throw refusal();
    const db=createSearchRebuildSqliteAdapter(database);
    await reader.verifyInstance(db); // wrong key/scope fails before schema writes
    if(command==='rebuild'){
      database.exec(readFileSync(new URL('search-index-v1.sql',import.meta.url),'utf8'));
      database.exec(readFileSync(new URL('search-rebuild-v1.sql',import.meta.url),'utf8'));
      let result=await startSearchRebuild({db,reader,restart:flag==='--restart'});
      while(result.state==='building'){
        result=await rebuildSearchBatch({db,reader});
        process.stdout.write(JSON.stringify({state:result.state,processed:result.processed})+'\n');
      }
    }
    const receipt=await verifySearchIndex({db,reader,markProgress:command==='rebuild'});
    process.stdout.write(JSON.stringify({status:'LOCAL_DERIVED_INDEX_VERIFIED',...receipt})+'\n');
    process.stdout.write('No production resource, source record, immutable revision or root key was changed.\n');
  }finally{database?.close();}
}
main().catch(e=>{
  process.stderr.write(e?.message===usage?usage+'\n':'Private local search operation refused. Verify the private files, existing key, schema and source integrity. No content or secret is printed.\n');
  process.exitCode=1;
});
