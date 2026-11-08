/** Read-only owner-run R2 health monitor. No record content or credentials output. */
import {auditScheduledBackups} from '../../src/forward-backup-health.mjs';
import {createReadOnlyR2Client} from '../../src/forward-backup-cloudflare-client.mjs';
import {parseForwardCiphertextSnapshot} from '../../src/forward-ciphertext-restore.mjs';

async function main(){
  if(process.argv.length!==2||!process.env.KNOWLEDGE_BACKUP_SCOPE||
     !process.env.KNOWLEDGE_BACKUP_KEY_ID||!process.env.KNOWLEDGE_BACKUP_FIRST_DUE)
    throw new Error('KNOWLEDGE_BACKUP_HEALTH_CONFIGURATION_REQUIRED');
  const client=createReadOnlyR2Client({token:process.env.CLOUDFLARE_API_TOKEN,
    account:process.env.CLOUDFLARE_ACCOUNT_ID,bucket:process.env.KNOWLEDGE_BACKUP_BUCKET});
  const result=await auditScheduledBackups({...client,
    parseSnapshot:parseForwardCiphertextSnapshot,scope:process.env.KNOWLEDGE_BACKUP_SCOPE,
    keyId:process.env.KNOWLEDGE_BACKUP_KEY_ID,firstDue:process.env.KNOWLEDGE_BACKUP_FIRST_DUE});
  console.log(JSON.stringify(result)); // dates, hashes and counts only
}
main().catch(err=>{
  console.error(/^KNOWLEDGE_BACKUP_HEALTH_[A-Z0-9_]+$/.test(err.message)
    ?err.message:'KNOWLEDGE_BACKUP_HEALTH_FAILED');
  process.exitCode=1;
});
