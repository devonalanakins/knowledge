import {readCaptureInboxHealth} from '../../src/forward-capture-health.mjs';

/** Private, owner-run CLI. No token or event identifiers in output. */
async function main(){
  if(process.argv.length!==2||
     process.env.KNOWLEDGE_CAPTURE_HEALTH_ACK!=='OWNER_PRIVATE_AGGREGATES_ONLY_V1')
    throw Error('KNOWLEDGE_CAPTURE_HEALTH_BAD_CONFIGURATION');
  const report=await readCaptureInboxHealth({
    token:process.env.CLOUDFLARE_API_TOKEN,
    account:process.env.CLOUDFLARE_ACCOUNT_ID,
    database:process.env.KNOWLEDGE_CAPTURE_INBOX_DATABASE_ID,
  });
  console.log(JSON.stringify(report));
  if(report.status==='ATTENTION_REQUIRED')process.exitCode=2;
}
main().catch(err=>{
  const safe=String(err?.message??'');
  console.error(/^KNOWLEDGE_CAPTURE_HEALTH_[A-Z_]+$/.test(safe)
    ?safe:'KNOWLEDGE_CAPTURE_HEALTH_FAILED');
  process.exitCode=1;
});
