/**
 * Isolated scheduled processor for encrypted GitHub merge receipts.
 *
 * No public HTTP API, no Access spoofing, no owner root encryption key.
 * Reads only the dedicated capture D1 and invokes a narrow, named,
 * independently HMAC-authenticated same-account service-binding RPC.
 */
import {claimCapture,processCapture} from './forward-capture-inbox.mjs';
import {signCaptureReceipt} from './forward-capture-machine-auth.mjs';

export const PROCESSOR_CRON='*/5 * * * *'; // 5-minute bounded retry drain.
export const PROCESSOR_ACK='OWNER_ONLY_SIGNED_MERGE_PROCESSOR_V1';
const MAX_BATCH=10;

function config(env){
 if(!env||env.CAPTURE_PROCESSOR_ACK!==PROCESSOR_ACK||
    typeof env.CAPTURE_INBOX_ROOT_HEX!=='string'||
    !/^[0-9a-f]{64}$/.test(env.CAPTURE_INBOX_ROOT_HEX)||
    typeof env.CAPTURE_INBOX_KEY_ID!=='string'||
    !/^[a-z0-9-]{1,32}$/.test(env.CAPTURE_INBOX_KEY_ID)||
    typeof env.CAPTURE_MACHINE_AUTH_KEY_HEX!=='string'||
    !/^[0-9a-f]{64}$/.test(env.CAPTURE_MACHINE_AUTH_KEY_HEX)||
    env.CAPTURE_MACHINE_AUTH_KEY_HEX===env.CAPTURE_INBOX_ROOT_HEX||
    !env.CAPTURE_INBOX_DB||typeof env.CAPTURE_INBOX_DB.prepare!=='function'||
    typeof env.CAPTURE_INBOX_DB.batch!=='function'||
    !env.KNOWLEDGE_CAPTURE_WRITER||
    typeof env.KNOWLEDGE_CAPTURE_WRITER.saveMergeReceipt!=='function')
   throw Error('KNOWLEDGE_CAPTURE_PROCESSOR_DISABLED');
 return env;
}
function clock(value){
 if(!Number.isSafeInteger(value)||value<0)throw Error('INVALID_CAPTURE_CLOCK');
 return value;
}
/**
 * Each item is claimed with an optimistic time-limited D1 lease.
 * Exact Knowledge readback is performed by the internal receiver and
 * attested by its narrow RPC response. Unknown RPC responses fail closed.
 */
export async function drainCaptureInbox(env,{now=Date.now(),limit=MAX_BATCH}={}){
 config(env);clock(now);
 if(!Number.isInteger(limit)||limit<1||limit>MAX_BATCH)throw Error('INVALID_CAPTURE_BATCH');
 const summary={attempted:0,saved:0,pending:0,blocked:0,failed:0,stale:0};
 for(let i=0;i<limit;i++){
  const lease=await claimCapture({db:env.CAPTURE_INBOX_DB,
   rootHex:env.CAPTURE_INBOX_ROOT_HEX,keyId:env.CAPTURE_INBOX_KEY_ID,now});
  if(!lease)break;
  summary.attempted++;
  const adapter={
   async saveReceipt(candidate){
    const signature=await signCaptureReceipt(candidate,env.CAPTURE_MACHINE_AUTH_KEY_HEX,now);
    // Neither the source payload nor the machine secret is logged.
    return env.KNOWLEDGE_CAPTURE_WRITER.saveMergeReceipt({candidate,...signature});
   },
  };
  const result=await processCapture({
   db:env.CAPTURE_INBOX_DB,rootHex:env.CAPTURE_INBOX_ROOT_HEX,
   keyId:env.CAPTURE_INBOX_KEY_ID,lease,adapter,now,
  });
  if(result.status==='SAVED')summary.saved++;
  else if(result.status==='BLOCKED')summary.blocked++;
  else if(result.status==='FAILED')summary.failed++;
  else if(result.status==='STALE_LEASE')summary.stale++;
  else summary.pending++;
 }
 return summary;
}
export default {
 async fetch(){return new Response(null,{status:404,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
 }});},
 async scheduled(controller,env){
  if(controller?.cron!==PROCESSOR_CRON||
     !Number.isFinite(controller.scheduledTime))
    throw Error('KNOWLEDGE_CAPTURE_NOT_SCHEDULED');
  try{
   const receipt=await drainCaptureInbox(env,{now:Date.now()});
   // Emit only aggregate state counts; never source bodies or keys.
   console.log('Knowledge capture drain',JSON.stringify(receipt));
  }catch{
   console.error('Knowledge capture drain unavailable');
   throw Error('KNOWLEDGE_CAPTURE_DRAIN_FAILED');
  }
 },
};
