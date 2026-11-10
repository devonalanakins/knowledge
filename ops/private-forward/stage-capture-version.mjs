/**
 * Owner-only manual staging of already-reviewed, disabled capture Worker code.
 *
 * NEVER deploys traffic or adds routes, Cron, activation bindings or secrets.
 * Nothing runs without exact opt-in, existing-Worker baseline and valid remote
 * read-only guard. The command deliberately prints no Wrangler/provider output.
 */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readCaptureStagingGuard} from '../../src/forward-capture-staging-guard.mjs';
import {stageCaptureVersion} from '../../src/forward-capture-version-stage.mjs';
import {readCaptureVersionIds,readCaptureVersionMetadata}
 from '../../src/forward-capture-version-attestation.mjs';

function manifests(){
 const out={};
 for(const component of ['ingress','processor']){
  const file=new URL('./wrangler.capture-'+component+'.staged.json',import.meta.url);
  const doc=JSON.parse(readFileSync(file,'utf8'));
  out[doc.name]=doc;
 }
 return out;
}
async function main(){
 if(process.argv.length!==3||
    !['ingress','processor'].includes(process.argv[2])||
    process.env.KNOWLEDGE_CAPTURE_VERSION_STAGE_ACK!==
      'OWNER_APPROVED_NONPUBLIC_CAPTURE_VERSION_UPLOAD_V1'||
    !process.env.KNOWLEDGE_CAPTURE_EXPECTED_ACTIVE_VERSION||
    !process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_API_TOKEN)
   throw Error('KNOWLEDGE_CAPTURE_VERSION_STAGE_DISABLED');
 const all=manifests();
 const inspect=()=>readCaptureStagingGuard({
  account:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,
  manifests:all,
 });
 const result=await stageCaptureVersion({
  component:process.argv[2],
  ack:process.env.KNOWLEDGE_CAPTURE_VERSION_STAGE_ACK,
  expectedActiveVersion:process.env.KNOWLEDGE_CAPTURE_EXPECTED_ACTIVE_VERSION,
  manifests:all,
  inspect,
  captureVersionIds:component=>readCaptureVersionIds({
    account:process.env.CLOUDFLARE_ACCOUNT_ID,
    token:process.env.CLOUDFLARE_API_TOKEN,component,
  }),
  inspectVersion:(component,versionId)=>readCaptureVersionMetadata({
    account:process.env.CLOUDFLARE_ACCOUNT_ID,
    token:process.env.CLOUDFLARE_API_TOKEN,component,versionId,
  }),
  upload:plan=>{
   const r=spawnSync(plan.command,plan.args,{
    encoding:'utf8',timeout:120000,maxBuffer:256*1024,
    stdio:['ignore','pipe','pipe'],
    env:{...process.env,WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'},
   });
   if(r.error || r.signal || r.status!==0)
    return {status:1};
   return {status:0};
  },
 });
 console.log(JSON.stringify(result));
}
main().catch(()=>{
 console.error('KNOWLEDGE_CAPTURE_VERSION_STAGE_UNAVAILABLE');
 process.exitCode=1;
});
