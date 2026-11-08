/**
 * Deterministic nonclinical GitHub merge receipt.
 *
 * Used both by signed GitHub ingress and the separate internal-only
 * Knowledge machine writer. The writer reconstructs this content rather
 * than trusting arbitrary agent-supplied page text or status assertions.
 */
const fullNameRe=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const shaRe=/^[0-9a-f]{40}$/;
const partRe=/^[a-z0-9][a-z0-9-]{0,63}$/;
const eventRe=/^github:pr-merge:([1-9]\d*):([1-9]\d*):([0-9a-f]{40})$/;
const EXPECTED_FIELDS=[
 'kind','eventKey','path','title','body','sourceUrl','scope',
 'classification','sourceAuthenticated','mergedAt',
].sort().join(',');
function iso(value){
 if(typeof value!=='string'||value.length<10||value.length>64)throw Error('INVALID_MERGE_RECEIPT');
 const stamp=Date.parse(value);
 if(!Number.isFinite(stamp))throw Error('INVALID_MERGE_RECEIPT');
 return new Date(stamp).toISOString();
}
export function canonicalGitHubMergeReceipt({repoId,fullName,number,sha,mergedAt,pathPrefix}){
 if(!Number.isSafeInteger(repoId)||repoId<=0||
    typeof fullName!=='string'||!fullNameRe.test(fullName)||
    !Number.isSafeInteger(number)||number<=0||
    typeof sha!=='string'||!shaRe.test(sha)||
    typeof pathPrefix!=='string'||pathPrefix.length>160||
    pathPrefix.split('/').length>7||
    !pathPrefix.split('/').every(part=>partRe.test(part)))
   throw Error('INVALID_MERGE_RECEIPT');
 const at=iso(mergedAt);
 const path=pathPrefix+'/pr-'+number;
 if(path.length>240||path.split('/').length>8)throw Error('INVALID_MERGE_RECEIPT');
 const eventKey='github:pr-merge:'+repoId+':'+number+':'+sha;
 const sourceUrl='https://github.com/'+fullName+'/pull/'+number;
 const body=[
  '# GitHub merge receipt',
  '',
  'Status: SOURCE-EVENT VERIFIED (not an independent CI or production deployment check)',
  'Source: authenticated GitHub pull_request.closed event',
  'Event key: '+eventKey,
  'Repository: '+fullName,
  'Pull request: '+sourceUrl,
  'Merge commit: '+sha,
  'Reported merged at: '+at,
  '',
  'This record is a draft evidence receipt. It does not certify tests, deployment,',
  'scope grants, a human-approved decision, or access to private PR content.',
 ].join('\n');
 return Object.freeze({
  kind:'github.pr.merged',eventKey,path,
  title:'Merged '+fullName+' PR #'+number,
  body,sourceUrl,scope:'personal',classification:'nonclinical',
  sourceAuthenticated:true,mergedAt:at,
 });
}
/** Returns canonical receipt on exact match; null for any untrusted mutation. */
export function revalidateMergeReceipt(candidate,authorization){
 try {
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
     Object.keys(candidate).sort().join(',')!==EXPECTED_FIELDS||
     typeof candidate.eventKey!=='string'||typeof candidate.mergedAt!=='string'||
     !authorization||!Number.isSafeInteger(authorization.repoId)||
     typeof authorization.repoName!=='string'||
     typeof authorization.pathPrefix!=='string')return null;
  const match=eventRe.exec(candidate.eventKey);
  if(!match)return null;
  const repoId=Number(match[1]),number=Number(match[2]);
  if(repoId!==authorization.repoId)return null;
  const expected=canonicalGitHubMergeReceipt({
   repoId,number,sha:match[3],fullName:authorization.repoName,
   pathPrefix:authorization.pathPrefix,mergedAt:candidate.mergedAt,
  });
  return Object.keys(expected).every(k=>candidate[k]===expected[k])?expected:null;
 }catch{return null;}
}
