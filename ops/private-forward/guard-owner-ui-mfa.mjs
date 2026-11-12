/** Read-only gate; never changes Cloudflare settings or enables a route. */
import {readOwnerUiMfaReadiness} from '../../src/forward-owner-ui-mfa-readiness.mjs';

async function main(){
 if(process.argv.length!==2||
    process.env.KNOWLEDGE_UI_MFA_GUARD_ACK!=='READ_ONLY_OWNER_UI_MFA_REVIEW_V1')
   throw Error('KNOWLEDGE_UI_MFA_READ_ONLY_UNAVAILABLE');
 const report=await readOwnerUiMfaReadiness({
  account:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,
 });
 process.stdout.write(JSON.stringify(report)+'\n');
 if(report.status!=='MFA_METADATA_CONFIGURED')process.exitCode=2;
}
main().catch(()=>{
 process.stderr.write('KNOWLEDGE_UI_MFA_READ_ONLY_UNAVAILABLE\n');
 process.exitCode=1;
});
