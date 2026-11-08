/**
 * Second, independent source check for an Actions-signed merge receipt.
 * The sender HMAC proves only possession of the Actions signing key; the
 * owner ingress must verify the actual merged PR with GitHub before D1.
 *
 * Only the public GitHub PR read API is used; no owner, Cloudflare, or
 * recovery credential is needed. Public repos only until a separately
 * reviewed least-privilege private-repo reader exists.
 */
import {isAuthenticatedGitHubMerge} from './forward-github-capture.mjs';
import {revalidateMergeReceipt} from './forward-receipt-policy.mjs';

const ID=/^github:pr-merge:([1-9]\d*):([1-9]\d*):([0-9a-f]{40})$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_BODY=1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});
const reject=code=>{const e=new Error('KNOWLEDGE_SOURCE_'+code);e.code=code;throw e;};

async function boundedJson(response) {
  const length=response.headers?.get?.('content-length');
  if(length!==null&&length!==undefined&&/^\d+$/.test(length)&&
     Number(length)>MAX_BODY)reject('SOURCE_UNAVAILABLE');
  if(!/^application\/(?:json|vnd\.github\+json)(?:\s*;|$)/i
      .test(response.headers?.get?.('content-type')??''))
    reject('SOURCE_UNAVAILABLE');
  if(!response.body?.getReader)reject('SOURCE_UNAVAILABLE');
  let bytes=0;const chunks=[];
  const reader=response.body.getReader();
  try {
    for (;;) {
      const part=await reader.read();
      if(part.done)break;
      if(!(part.value instanceof Uint8Array))reject('SOURCE_UNAVAILABLE');
      bytes+=part.value.byteLength;
      if(bytes>MAX_BODY)reject('SOURCE_UNAVAILABLE');
      chunks.push(part.value);
    }
  }catch{reject('SOURCE_UNAVAILABLE');}
  if(bytes===0)reject('SOURCE_UNAVAILABLE');
  const all=new Uint8Array(bytes);let offset=0;
  for(const part of chunks){all.set(part,offset);offset+=part.byteLength;}
  try {
    const parsed=JSON.parse(decoder.decode(all));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
      reject('SOURCE_UNAVAILABLE');
    return parsed;
  }catch{reject('SOURCE_UNAVAILABLE');}
}

/**
 * Validates a candidate obtained from the private HMAC-verifying parser.
 * The allowlist and canonical event key, URL, path and scope must all match.
 * Fail-closed statuses:
 *   MERGE_NOT_CONFIRMED -> signed bytes contradict GitHub's merge record
 *   SOURCE_UNAVAILABLE  -> GitHub transport/response cannot be trusted; retry
 */
export async function confirmGitHubMergeAuthority(candidate,repositories,{
  fetchImpl=fetch,
}={}){
  if(!isAuthenticatedGitHubMerge(candidate)||
     !repositories||typeof repositories!=='object'||
     typeof fetchImpl!=='function')reject('MERGE_NOT_CONFIRMED');
  const match=ID.exec(candidate.eventKey??'');
  if(!match)reject('MERGE_NOT_CONFIRMED');
  const repoId=Number(match[1]),number=Number(match[2]),sha=match[3];
  if(!Number.isSafeInteger(repoId)||!Number.isSafeInteger(number))
    reject('MERGE_NOT_CONFIRMED');

  // Match the canonical source URL, not a caller-provided arbitrary API URL.
  const entries=Object.entries(repositories).filter(([name,spec])=>
    REPO.test(name)&&spec?.repoId===repoId&&spec?.scope==='personal'&&
    candidate.sourceUrl==='https://github.com/'+name+'/pull/'+number&&
    candidate.path===spec.pathPrefix+'/pr-'+number&&
    revalidateMergeReceipt(candidate,{
      repoId,repoName:name,pathPrefix:spec.pathPrefix,
    })!==null);
  if(entries.length!==1)reject('MERGE_NOT_CONFIRMED');
  const [name]=entries[0];
  const [owner,repo]=name.split('/');
  const url='https://api.github.com/repos/'+encodeURIComponent(owner)+
    '/'+encodeURIComponent(repo)+'/pulls/'+number;
  let response;
  try {
    response=await fetchImpl(url,{method:'GET',redirect:'error',
      signal:AbortSignal.timeout(8000),
      headers:{Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28'},
    });
  }catch{reject('SOURCE_UNAVAILABLE');}
  if(response?.status!==200)reject('SOURCE_UNAVAILABLE');
  const pr=await boundedJson(response);

  if(pr.number!==number||pr.state!=='closed'||pr.merged!==true||
     pr.merge_commit_sha!==sha||
     pr.base?.ref!=='main'||pr.base?.repo?.id!==repoId||
     pr.base.repo.full_name!==name||
     typeof pr.merged_at!=='string'||
     !Number.isFinite(Date.parse(pr.merged_at))||
     new Date(pr.merged_at).toISOString()!==candidate.mergedAt)
    reject('MERGE_NOT_CONFIRMED');
  return true;
}
