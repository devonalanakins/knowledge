/** Read-only Access MFA impact inventory. Never changes policies or routes. */
import {readAccessMfaImpact} from '../../src/forward-access-mfa-impact.mjs';

async function main(){
 if(process.argv.length!==2||
    process.env.KNOWLEDGE_ACCESS_IMPACT_ACK!=='READ_ONLY_ALL_ACCESS_APPS_V1')
   throw new Error('KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE');
 const result=await readAccessMfaImpact({
  account:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,
 });
 process.stdout.write(JSON.stringify(result)+'\n');
 process.exitCode=2; // Explicit owner review is always required.
}
main().catch(()=>{
 process.stderr.write('KNOWLEDGE_ACCESS_MFA_IMPACT_UNAVAILABLE\n');
 process.exitCode=1;
});
