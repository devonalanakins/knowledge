import {readCaptureReleasePreflight} from '../../src/forward-capture-release-preflight.mjs';

/** Owner-run metadata-only check. Requires a read-only Workers API token. */
async function main(){
 if(process.argv.length!==2||
    process.env.KNOWLEDGE_CAPTURE_PREFLIGHT_ACK!=='READ_ONLY_METADATA_V1')
   throw Error('KNOWLEDGE_CAPTURE_PREFLIGHT_UNAVAILABLE');
 const report=await readCaptureReleasePreflight({
  token:process.env.CLOUDFLARE_API_TOKEN,
  account:process.env.CLOUDFLARE_ACCOUNT_ID,
 });
 console.log(JSON.stringify(report));
 if(report.status!=='METADATA_READY_FOR_SEPARATE_REVIEW')process.exitCode=2;
}
main().catch(()=>{
 console.error('KNOWLEDGE_CAPTURE_PREFLIGHT_UNAVAILABLE');
 process.exitCode=1;
});
