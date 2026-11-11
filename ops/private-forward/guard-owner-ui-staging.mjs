/**
 * Read-only Cloudflare metadata check for a future separate owner UI stage.
 * Do not use this as a deploy command or as evidence of Access-policy approval.
 */
import {readOwnerUiStagingTopology} from '../../src/forward-owner-ui-staging-guard.mjs';

async function main(){
 if(process.argv.length!==2||
   process.env.KNOWLEDGE_UI_STAGE_GUARD_ACK!=='READ_ONLY_STAGING_REVIEW_V1')
   throw Error('KNOWLEDGE_UI_STAGE_READ_ONLY_UNAVAILABLE');
 const report=await readOwnerUiStagingTopology({
  account:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,
  productionOrigin:process.env.KNOWLEDGE_PRODUCTION_ORIGIN,
  stagingOrigin:process.env.KNOWLEDGE_STAGING_ORIGIN
 });
 process.stdout.write(JSON.stringify(report)+'\n');
 // A topology match is never sufficient to authorize deployment. The caller
 // must separately verify real Access policies, secret/key isolation, seeded
 // synthetic D1, active script version and rollback.
 if(report.status!=='STAGING_METADATA_SEPARATED')process.exitCode=2;
}
main().catch(()=>{
 process.stderr.write('KNOWLEDGE_UI_STAGE_READ_ONLY_UNAVAILABLE\n');
 process.exitCode=1;
});
