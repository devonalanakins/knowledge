#!/usr/bin/env node
/** Local trusted-owner archive utility; no network and no implicit source deletion. */
import { encryptColdArchive, decryptColdArchive } from './cold-archive.mjs';

const [action,source,target,...other]=process.argv.slice(2);
if(!['encrypt','decrypt'].includes(action)||!source||!target||other.length){
 console.error('Usage: node src/archive-cli.mjs encrypt|decrypt INPUT OUTPUT');
 process.exitCode=2;
}else{
 try{
  const secret=process.env.KNOWLEDGE_BACKUP_PASSPHRASE;
  const result=action==='encrypt' ? await encryptColdArchive(source,target,secret) : await decryptColdArchive(source,target,secret);
  process.stdout.write(JSON.stringify({result:'success',format:result.format,sizeBytes:result.sizeBytes,action})+'\n');
 }catch(error){
  // Do not expose filesystem locations or input-sensitive content in CLI errors.
  console.error(JSON.stringify({code:error.code||'ARCHIVE_ERROR',message:'Archive operation failed; verify paths, encryption key, and protected storage'}));
  process.exitCode=1;
 }
}
