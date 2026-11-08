/**
 * One-shot FICTIONAL Cloudflare runtime acceptance test for Knowledge capture.
 *
 * This module is never the production intake or owner Worker. It requires
 * its own empty canary D1 instances, synthetic-only secrets and a separately
 * bound canary KnowledgeCaptureEntrypoint. No public routes or user data.
 */
import {handleGitHubCaptureIngress} from './worker-cloudflare-capture-ingress.mjs';
import {drainCaptureInbox} from './worker-cloudflare-capture-processor.mjs';
import {listCaptureStates} from './forward-capture-inbox.mjs';

export const CANARY_CRON='* * * * *';
export const CANARY_ACK='FICTIONAL_RUNTIME_CANARY_V1';
export const CANARY_NUMBER=900000;
export const CANARY_REPO='devonalanakins/knowledge';
export const CANARY_REPO_ID=1446728034;
const CONTENT_TYPE='application/json';
const web=new TextEncoder();

function config(env) {
  if(env?.CAPTURE_CANARY_ACK!==CANARY_ACK||
     env.CAPTURE_PROCESSOR_ACK!=='OWNER_ONLY_SIGNED_MERGE_PROCESSOR_V1'||
     env.CAPTURE_INGRESS_ACK!=='SIGNED_GITHUB_CAPTURE_INBOX_V1'||
     env.CAPTURE_INGRESS_URL!=='https://capture-canary.example.test/github'||
     typeof env.CAPTURE_WEBHOOK_SECRET!=='string'||
     web.encode(env.CAPTURE_WEBHOOK_SECRET).byteLength<32||
     typeof env.CAPTURE_REPOSITORIES_JSON!=='string')throw Error('CANARY_UNAVAILABLE');
  let allow;
  try {allow=JSON.parse(env.CAPTURE_REPOSITORIES_JSON);}catch{throw Error('CANARY_UNAVAILABLE');}
  const entries=Object.entries(allow);
  if(entries.length!==1||entries[0][0]!==CANARY_REPO||
     entries[0][1]?.repoId!==CANARY_REPO_ID||
     entries[0][1]?.scope!=='personal'||
     entries[0][1]?.pathPrefix!=='acceptance/github-canary')
   throw Error('CANARY_UNAVAILABLE');
}
function sample() {
  return {
    action:'closed',number:CANARY_NUMBER,
    repository:{id:CANARY_REPO_ID,full_name:CANARY_REPO},
    pull_request:{number:CANARY_NUMBER,merged:true,
      merge_commit_sha:'f'.repeat(40),merged_at:'2026-11-08T00:00:00.000Z',
      title:'FICTIONAL RUNTIME ACCEPTANCE - NO REAL GITHUB EVENT',
      body:'Fictional synthetic acceptance; do not treat as a real GitHub merge'},
  };
}
/**
 * This generates a fake GitHub HMAC locally; it does NOT prove that GitHub
 * delivered anything. Provider verification covers the actual Workers
 * cryptography, D1 bindings, named RPC and receipt readback end to end.
 */
export async function runRuntimeCanary(env,now=Date.now()){
  config(env);
  if(!Number.isSafeInteger(now)||now<0)throw Error('INVALID_CANARY_CLOCK');
  const raw=JSON.stringify(sample());
  const key=await crypto.subtle.importKey('raw',web.encode(env.CAPTURE_WEBHOOK_SECRET),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=new Uint8Array(await crypto.subtle.sign('HMAC',key,web.encode(raw)));
  const request=new Request(env.CAPTURE_INGRESS_URL,{
    method:'POST',headers:{
      'Content-Type':CONTENT_TYPE,'X-GitHub-Event':'pull_request',
      'X-GitHub-Delivery':'18c119de-024e-4827-8568-41297e0e993e',
      'X-Hub-Signature-256':'sha256='+Array.from(signed,x=>x.toString(16).padStart(2,'0')).join(''),
    },body:raw,
  });
  const ingress=await handleGitHubCaptureIngress(request,env);
  if(ingress.status!==202)throw Error('CANARY_INGRESS_UNVERIFIED');
  const summary=await drainCaptureInbox(env,{now,limit:1});
  if(summary.attempted!==1 && summary.attempted!==0)
    throw Error('CANARY_DELIVERY_INDETERMINATE');
  if(summary.pending||summary.blocked||summary.failed||summary.stale)
    throw Error('CANARY_CAPTURE_NOT_SAVED');
  // A zero-attempt run is acceptable only if the SAME encrypted receipt was
  // previously acknowledged SAVED. Never call a delayed, blocked or failed
  // delivery a successful duplicate.
  const ledger=await listCaptureStates({db:env.CAPTURE_INBOX_DB,limit:10});
  if(ledger.length!==1||ledger[0].state!=='saved')
    throw Error('CANARY_LEDGER_NOT_SAVED');
  if(summary.saved!==1 && summary.attempted!==0)
    throw Error('CANARY_DELIVERY_INDETERMINATE');
  return {status:summary.saved===1?'SAVED_AND_READBACK_VERIFIED':'ALREADY_SAVED',
    ingested:true,summary};
}

export default {
  async fetch(){return new Response(null,{status:404,headers:{
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  }});},
  async scheduled(controller,env){
    if(controller?.cron!==CANARY_CRON)throw Error('CANARY_NOT_SCHEDULED');
    // Synthetic-only aggregate metadata; no keys, payloads or private pages.
    const result=await runRuntimeCanary(env,Date.now());
    console.log('Knowledge capture fictional runtime canary',result.status);
  },
};
