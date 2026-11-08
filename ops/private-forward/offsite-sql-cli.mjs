#!/usr/bin/env node
/** Owner-only offline archival; no provider, network or Knowledge root key. */
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {sealForwardOffsiteSql,openForwardOffsiteSql} from '../../src/forward-offsite-sql-vault.mjs';

const usage='Usage:\n'+
  '  npm run knowledge:sql:offsite -- seal SOURCE_SQL NEW_VAULT --sha256 RECEIPT_SHA256\n'+
  '  npm run knowledge:sql:offsite -- verify VAULT --sha256 RECEIPT_SHA256\n'+
  '  npm run knowledge:sql:offsite -- recover VAULT NEW_SQL_FILE --sha256 RECEIPT_SHA256';
const refuse=()=>new Error('KNOWLEDGE_OFFSITE_SQL_REFUSED');

async function askHidden(label){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw refuse();
  const mute=new Writable({write(_chunk,_encoding,next){next();}});
  const prompt=createInterface({input:process.stdin,output:mute,terminal:true});
  process.stdout.write(label);
  try{
    return await new Promise((resolve,reject)=>{
      prompt.question('',resolve);
      prompt.once('close',()=>reject(refuse()));
    });
  }finally{prompt.close();process.stdout.write('\n');}
}
async function main(args){
  if(process.platform==='win32'||typeof process.getuid!=='function'||
     !process.stdin.isTTY||!process.stdout.isTTY)throw refuse();
  const [command,...rest]=args;
  const seal=command==='seal'&&rest.length===4&&rest[2]==='--sha256';
  const verify=command==='verify'&&rest.length===3&&rest[1]==='--sha256';
  const recover=command==='recover'&&rest.length===4&&rest[2]==='--sha256';
  if(!seal&&!verify&&!recover)throw new Error(usage);
  const hash=verify?rest[2]:rest[3];
  if(!/^[0-9a-f]{64}$/.test(hash))throw refuse();
  const passphrase=await askHidden(seal?
    'New, independently held offsite archive passphrase (hidden): ':
    'Existing offsite archive passphrase (hidden): ');
  const receipt=seal?await sealForwardOffsiteSql({
    sourceFile:rest[0],targetFile:rest[1],expectedSha256:hash,passphrase,
  }):await openForwardOffsiteSql({
    archiveFile:rest[0],expectedSha256:hash,passphrase,
    ...(recover?{targetFile:rest[1]}:{}),
  });
  process.stdout.write('OFFSITE_SQL_VAULT_'+(seal?'SEALED':'AUTHENTICATED')+'\n');
  process.stdout.write('Source SQL SHA-256: '+receipt.sha256+
    '; bytes: '+receipt.bytes+'\n');
  if(recover)process.stdout.write('Private SQL recovery file: '+receipt.sqlFile+'\n');
  else if(verify)process.stdout.write('No recovered SQL file created.\n');
  process.stdout.write('Cryptographic archive integrity only: separately verify every Knowledge revision and source parity.\n');
  process.stdout.write('No remote operation or Knowledge key access occurred.\n');
}
main(process.argv.slice(2)).catch(error=>{
  process.stderr.write(error?.message===usage?usage+'\n':
    'Owner-local offsite vault refused: verify the receipt checksum, file permissions and passphrase.\n');
  process.exitCode=1;
});
