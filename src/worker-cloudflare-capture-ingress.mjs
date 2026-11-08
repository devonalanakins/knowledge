/**
 * Opt-in GitHub webhook ingress for PRIVATE Knowledge capture. Source-only.
 *
 * This Worker is a separate public-signature-authenticated intake surface.
 * It NEVER receives the Knowledge owner root key or the owner Access identity,
 * does not expose the owner MCP, and cannot directly read/write wiki pages.
 * It only enqueues minimal signed merge receipts into an isolated encrypted D1.
 */
import {verifySignedGitHubMerge} from './forward-github-capture.mjs';
import {confirmGitHubMergeAuthority} from './forward-capture-github-authority.mjs';
import {enqueueCapture} from './forward-capture-inbox.mjs';

export const INGRESS_ACK = 'SIGNED_GITHUB_CAPTURE_INBOX_V1';
const MAX_RAW_BYTES = 65_536;
const MAX_CONFIG_BYTES = 4_096;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8',{fatal:true});
const repoName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const pathPart = /^[a-z0-9][a-z0-9-]{0,63}$/;

function response(status) {
  return new Response(null,{status,headers:{
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'X-Robots-Tag':'noindex, nofollow',
  }});
}
function ownRecord(value) {
  return value && typeof value==='object' && !Array.isArray(value);
}
/** Missing, malformed, or overly broad config fails closed. */
function settings(env) {
  if (!env || env.CAPTURE_INGRESS_ACK !== INGRESS_ACK ||
      typeof env.CAPTURE_WEBHOOK_SECRET!=='string' ||
      encoder.encode(env.CAPTURE_WEBHOOK_SECRET).byteLength<32 ||
      typeof env.CAPTURE_INBOX_ROOT_HEX!=='string' ||
      !/^[0-9a-f]{64}$/.test(env.CAPTURE_INBOX_ROOT_HEX) ||
      typeof env.CAPTURE_INBOX_KEY_ID!=='string' ||
      !/^[a-z0-9-]{1,32}$/.test(env.CAPTURE_INBOX_KEY_ID) ||
      !env.CAPTURE_INBOX_DB ||
      typeof env.CAPTURE_INBOX_DB.prepare!=='function' ||
      typeof env.CAPTURE_INBOX_DB.batch!=='function' ||
      typeof env.CAPTURE_REPOSITORIES_JSON!=='string' ||
      encoder.encode(env.CAPTURE_REPOSITORIES_JSON).byteLength>MAX_CONFIG_BYTES)
    return null;

  let url, repositories;
  try {
    url = new URL(env.CAPTURE_INGRESS_URL);
    repositories = JSON.parse(env.CAPTURE_REPOSITORIES_JSON);
  } catch {return null;}
  if (url.href!==env.CAPTURE_INGRESS_URL ||
      url.protocol!=='https:' || !url.hostname.includes('.') ||
      url.username || url.password || url.search || url.hash ||
      url.pathname!=='/github' || !ownRecord(repositories) ||
      Object.keys(repositories).length<1 ||
      Object.keys(repositories).length>20) return null;
  for(const [name,spec] of Object.entries(repositories)) {
    if (!repoName.test(name) || !ownRecord(spec) ||
        Object.keys(spec).sort().join(',')!=='pathPrefix,repoId,scope' ||
        !Number.isSafeInteger(spec.repoId) || spec.repoId<=0 ||
        spec.scope!=='personal' ||
        typeof spec.pathPrefix!=='string' ||
        spec.pathPrefix.length>160 ||
        spec.pathPrefix.split('/').length>7 ||
        !spec.pathPrefix.split('/').every(part=>pathPart.test(part)))
      return null;
  }
  return {url:url.href,repositories};
}
/** Read exactly the signed request bytes with a hard bound, including chunked bodies. */
async function readRawBody(request) {
  if (!request.body) return null;
  const reader=request.body.getReader();
  const parts=[];
  let total=0;
  try {
    for (;;) {
      const {value,done}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))return null;
      total+=value.byteLength;
      if(total>MAX_RAW_BYTES){await reader.cancel().catch(()=>{});return null;}
      parts.push(value);
    }
  } catch {return null;}
  if(total===0)return null;
  const all=new Uint8Array(total);
  let n=0;
  for(const p of parts){all.set(p,n);n+=p.byteLength;}
  return all;
}

/**
 * HTTP responses never include a wiki path, a PR title, an event ID or any
 * ciphertext. No logs of raw delivery or user-provided payloads.
 */
export async function handleGitHubCaptureIngress(request,env) {
  let url;
  try{url=new URL(request.url);}catch{return response(404);}
  if(url.pathname!=='/github'||request.method!=='POST')return response(404);
  const cfg=settings(env);
  if(!cfg)return response(503);
  if(request.url!==cfg.url)return response(404);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))
    return response(415);
  if(request.headers.get('content-encoding') &&
     request.headers.get('content-encoding')!=='identity')return response(415);
  const length=request.headers.get('content-length');
  if(length && /^\d+$/.test(length) && Number(length)>MAX_RAW_BYTES)
    return response(413);
  const raw=await readRawBody(request);
  if(!raw)return response(413);
  let candidate;
  try {
    candidate=await verifySignedGitHubMerge({
      body:raw,headers:request.headers,secret:env.CAPTURE_WEBHOOK_SECRET,
      repositories:cfg.repositories,
    });
  } catch(e) {
    if(e?.code==='INVALID_SIGNATURE')return response(401);
    if(e?.code==='SCOPE_NOT_AUTHORIZED')return response(403);
    return response(e?.code==='INVALID_DELIVERY'?400:503);
  }
  if(!candidate)return response(204); // Signed but not an eligible PR merge.
  // The Actions HMAC authenticates the sender, not GitHub's merge facts.
  // Fail closed on source mismatch or GitHub outage BEFORE any inbox mutation.
  try {
    await confirmGitHubMergeAuthority(candidate,cfg.repositories);
  } catch(e) {
    return response(e?.code==='MERGE_NOT_CONFIRMED'?403:503);
  }
  try {
    const queued=await enqueueCapture({
      db:env.CAPTURE_INBOX_DB,rootHex:env.CAPTURE_INBOX_ROOT_HEX,
      keyId:env.CAPTURE_INBOX_KEY_ID,candidate,
    });
    // Acceptance means durable inbox receipt, NOT saved to Knowledge.
    if(!queued||!queued.deliveryKey)return response(503);
    return response(202);
  } catch {return response(503);}
}
export default {fetch:handleGitHubCaptureIngress};
