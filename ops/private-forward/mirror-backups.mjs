/**
 * Owner-controlled POSIX-only mirror of ciphertext-only R2 backup objects.
 * Token is passed through the trusted host environment; no owner key needed.
 */
import {createReadOnlyR2Client} from '../../src/forward-backup-cloudflare-client.mjs';
import {mirrorScheduledBackupCiphertext} from '../../src/forward-backup-offsite-mirror.mjs';

async function main(){
  if(process.argv.length!==3||
     process.env.KNOWLEDGE_OFFSITE_MIRROR_ACK!=='OWNER_ENCRYPTED_DESTINATION_REVIEWED_V1'||
     !process.env.KNOWLEDGE_BACKUP_SCOPE||
     !process.env.KNOWLEDGE_BACKUP_KEY_ID||
     !process.env.KNOWLEDGE_BACKUP_FIRST_DUE)
    throw new Error('KNOWLEDGE_OFFSITE_MIRROR_CONFIGURATION_REQUIRED');
  const client=createReadOnlyR2Client({
    token:process.env.CLOUDFLARE_API_TOKEN,
    account:process.env.CLOUDFLARE_ACCOUNT_ID,
    bucket:process.env.KNOWLEDGE_BACKUP_BUCKET,
  });
  const summary=await mirrorScheduledBackupCiphertext({
    ...client,scope:process.env.KNOWLEDGE_BACKUP_SCOPE,
    keyId:process.env.KNOWLEDGE_BACKUP_KEY_ID,
    firstDue:process.env.KNOWLEDGE_BACKUP_FIRST_DUE,
    targetDirectory:process.argv[2],
  });
  console.log(JSON.stringify(summary)); // No token, keys, paths or ciphertext.
}
main().catch(e=>{
  const text=String(e?.message??'');
  console.error(/^KNOWLEDGE_(OFFSITE_MIRROR|BACKUP_HEALTH)_[A-Z0-9_]+$/.test(text)
    ?text:'KNOWLEDGE_OFFSITE_MIRROR_FAILED');
  process.exitCode=1;
});
