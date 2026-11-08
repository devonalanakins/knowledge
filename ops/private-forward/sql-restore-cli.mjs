#!/usr/bin/env node
/** Offline owner-only SQL export recovery. No Cloudflare API or network calls. */
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {loadEncryptedKeyRecovery} from '../../src/forward-key-recovery.mjs';
import {privateSqlRecoveryFile,verifyOrRestoreForwardD1Sql} from '../../src/forward-consistent-sql-restore.mjs';

const usage='Usage: npm run knowledge:sql:restore -- verify EXPORT_SQL RECOVERY_JSON --sha256 SHA256 [--inventory SOURCE_INVENTORY_JSON]\n'+
  '   or: npm run knowledge:sql:restore -- restore EXPORT_SQL RECOVERY_JSON NEW_PRIVATE_FOLDER --sha256 SHA256 [--inventory SOURCE_INVENTORY_JSON]';
function refused(){throw new Error('KNOWLEDGE_SQL_RECOVERY_REFUSED');}
async function hiddenPassphrase(){
  const mute=new Writable({write(_part,_enc,next){next();}});
  const prompt=createInterface({input:process.stdin,output:mute,terminal:true});
  process.stdout.write('Existing recovery passphrase (hidden): ');
  try{
    return await new Promise((resolve,reject)=>{
      prompt.question('',resolve);
      prompt.once('close',()=>reject(new Error('Passphrase entry interrupted')));
    });
  }finally{prompt.close();process.stdout.write('\n');}
}
async function main(args){
  if(process.platform==='win32'||typeof process.getuid!=='function'||
     !process.stdin.isTTY||!process.stdout.isTTY)refused();
  const [mode,sqlPath,keyPath,...rest]=args;
  const verifying=mode==='verify'&&(rest.length===2||rest.length===4)&&
    rest[0]==='--sha256'&&(rest.length===2||rest[2]==='--inventory');
  const restoring=mode==='restore'&&(rest.length===3||rest.length===5)&&
    rest[1]==='--sha256'&&(rest.length===3||rest[3]==='--inventory');
  if(!sqlPath||!keyPath||(!verifying&&!restoring))throw new Error(usage);
  const expectedSha256=restoring?rest[2]:rest[1];
  if(!/^[0-9a-f]{64}$/.test(expectedSha256))refused();
  const source=await privateSqlRecoveryFile(sqlPath);
  const recovery=await privateSqlRecoveryFile(keyPath);
  if(source.path===recovery.path)refused();
  const kit=await loadEncryptedKeyRecovery(recovery.path);
  const inventoryPath=verifying?(rest.length===4?rest[3]:undefined):
    (rest.length===5?rest[4]:undefined);
  let expectedInventory;
  if(inventoryPath!==undefined){
    const inventoryFile=await privateSqlRecoveryFile(inventoryPath);
    if([source.path,recovery.path].includes(inventoryFile.path)||
       inventoryFile.info.size<1||inventoryFile.info.size>4096)refused();
    try{expectedInventory=JSON.parse(await readFile(inventoryFile.path,'utf8'));}
    catch{refused();}
  }
  const passphrase=await hiddenPassphrase();
  const receipt=await verifyOrRestoreForwardD1Sql({
    sourceFile:source.path,kit,passphrase,expectedSha256,expectedInventory,
    ...(restoring?{targetDir:resolve(rest[0])}:{}),
  });
  process.stdout.write('D1 SQL EXPORT VERIFIED: every encrypted current page and historical revision authenticated.\n');
  process.stdout.write('Scope: '+receipt.scope+'; key ID: '+receipt.keyId+'; pages: '+
    receipt.counts.pages+'; revisions: '+receipt.counts.revisions+'.\n');
  process.stdout.write('Original SQL SHA-256: '+receipt.sha256+'\n');
  process.stdout.write(receipt.sourceParity==='MATCHED'?
    'Independent source-row inventory: MATCHED (provenance still requires review).\n':
    'Source completeness: NOT CHECKED; authenticated records may be an incomplete subset.\n');
  if(restoring)process.stdout.write('Isolated ciphertext-only restore: '+receipt.sqliteFile+'\n');
  else process.stdout.write('Verify-only: no output file created.\n');
  process.stdout.write('No plaintext record, recovery key or passphrase printed. No remote resources changed.\n');
}
main(process.argv.slice(2)).catch(error=>{
  process.stderr.write(error?.message===usage?usage+'\n':
    'Offline Knowledge SQL recovery refused: check the source, owner key, hash and private file protections.\n');
  process.exitCode=1;
});
