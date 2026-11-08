#!/usr/bin/env node
/**
 * Offline source witness generation for a FROZEN, owner-local fictional
 * ciphertext SQLite source. No network, recovery key or SQL export required.
 * This witness is NOT a signature or an authentication of its own provenance.
 */
import {open,lstat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {privateSqlRecoveryFile} from '../../src/forward-consistent-sql-restore.mjs';
import {inventoryForwardCiphertextSqlite} from '../../src/forward-ciphertext-inventory.mjs';

const usage='Usage: npm run knowledge:sql:inventory -- FROZEN_CIPHERTEXT_SQLITE NEW_PRIVATE_INVENTORY_JSON';
const refused=()=>new Error('KNOWLEDGE_SOURCE_INVENTORY_REFUSED');
const owned=x=>typeof process.getuid==='function' && x.uid===process.getuid();

async function main(args){
  if(args.length!==2||process.platform==='win32'||typeof process.getuid!=='function')
    throw refused();
  const [sourcePath,outputPath]=args;
  const source=await privateSqlRecoveryFile(sourcePath);
  if(typeof outputPath!=='string'||!outputPath.trim()||outputPath.includes('\0'))throw refused();
  const target=resolve(outputPath),parent=await lstat(dirname(target));
  if(target===source.path||!parent.isDirectory()||parent.isSymbolicLink()||
     !owned(parent)||(parent.mode&0o777)!==0o700)throw refused();
  let db;
  try{
    db=new DatabaseSync(source.path,{readOnly:true});
    db.exec('PRAGMA query_only=ON;');
    if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||
       db.prepare('PRAGMA foreign_key_check').all().length)throw refused();
    const witness=inventoryForwardCiphertextSqlite(db);
    const unchanged=await lstat(source.path);
    if(unchanged.ino!==source.info.ino||unchanged.dev!==source.info.dev||
       unchanged.size!==source.info.size||unchanged.mtimeMs!==source.info.mtimeMs)
      throw refused();
    db.close();db=undefined;
    let file;
    try{
      file=await open(target,'wx',0o600);
      await file.writeFile(JSON.stringify(witness,null,2)+'\n','utf8');
      await file.sync();
    }finally{await file?.close();}
    process.stdout.write('Private ciphertext inventory created from a local SQLite source.\n');
    process.stdout.write('This is not an authenticated source snapshot or provider-export acceptance.\n');
  }finally{db?.close();}
}
main(process.argv.slice(2)).catch(error=>{
  process.stderr.write(error?.message===usage?usage+'\n':
    'Private SQL source inventory refused; check the frozen source, directory permissions and new output path.\n');
  process.exitCode=1;
});
