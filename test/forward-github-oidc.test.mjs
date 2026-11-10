import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createSign,generateKeyPairSync} from 'node:crypto';
import {verifyGithubActionsOidcToken} from '../src/forward-github-oidc.mjs';
import {verifyOidcGitHubMerge,isAuthenticatedGitHubMerge}
 from '../src/forward-github-capture.mjs';

const repo='devonalanakins/knowledge',repoId=1446728034;
const endpoint='https://knowledge-capture-ingress-private.example.workers.dev/github';
const pushSha='a'.repeat(40),mergeSha='b'.repeat(40);
const now=Math.floor(Date.now()/1000);
const secretHeaders={'X-GitHub-Event':'pull_request',
 'X-GitHub-Delivery':'e7624b46-7e6c-49b2-a74c-4fdf0b726fac'};
const {privateKey,publicKey}=generateKeyPairSync('rsa',{
 modulusLength:2048,publicExponent:0x10001,
});
const jwk={...publicKey.export({format:'jwk'}),kid:'fictional-test-kid',
 kty:'RSA',use:'sig',alg:'RS256'};
const b64=value=>Buffer.from(JSON.stringify(value),'utf8').toString('base64url');
function payload(){
 return {knowledge_push_sha:pushSha,action:'closed',number:68,
  repository:{id:repoId,full_name:repo},
  pull_request:{number:68,merged:true,merge_commit_sha:mergeSha,
   merged_at:'2026-11-10T17:00:00Z'}};
}
function audience(body){
 return endpoint+'#sha256='+createHash('sha256').update(body).digest('hex');
}
function claims(aud){
 return {iss:'https://token.actions.githubusercontent.com',
  aud,sub:'repo:'+repo+':ref:refs/heads/main',
  repository:repo,repository_id:String(repoId),
  ref:'refs/heads/main',ref_type:'branch',event_name:'push',
  workflow_ref:repo+'/.github/workflows/knowledge-merge-delivery.yml@refs/heads/main',
  sha:pushSha,workflow_sha:pushSha,
  repository_visibility:'public',runner_environment:'github-hosted',
  run_id:'12345',run_attempt:'1',iat:now-5,nbf:now-5,exp:now+300};
}
function jwt(data,header={alg:'RS256',typ:'JWT',kid:jwk.kid}){
 const first=b64(header)+'.'+b64(data);
 return first+'.'+createSign('RSA-SHA256').update(first).sign(privateKey).toString('base64url');
}
let requests=[];
const jwksFetch=async (url,opts)=>{
 requests.push({url,method:opts.method,redirect:opts.redirect});
 return new Response(JSON.stringify({keys:[jwk]}),
  {status:200,headers:{'content-type':'application/json'}});
};
const repositories={[repo]:{scope:'personal',repoId,pathPrefix:'engineering/knowledge'}};
function fixture(change){
 const body=JSON.stringify(payload());
 const c={...claims(audience(body)),...change};
 return {body,c,token:jwt(c)};
}
test('short-lived GitHub-issued RS256 token verifies exact body audience and trusted main workflow',async()=>{
 requests=[];
 const f=fixture();
 const verified=await verifyGithubActionsOidcToken({
  token:f.token,audience:audience(f.body),repositories,fetchImpl:jwksFetch,now});
 assert.deepEqual(verified,{
  repository:repo,repositoryId:repoId,pushSha,
  workflowRef:repo+'/.github/workflows/knowledge-merge-delivery.yml@refs/heads/main',
 });
 assert.deepEqual(requests,[{
  url:'https://token.actions.githubusercontent.com/.well-known/jwks',
  method:'GET',redirect:'error',
 }]);
});
test('valid OIDC-bound merge candidate is marked authenticated and contains no PR content',async()=>{
 const f=fixture();
 const candidate=await verifyOidcGitHubMerge({
  body:f.body,endpoint,repositories,fetchImpl:jwksFetch,now,
  headers:{...secretHeaders,'X-Knowledge-Actions-OIDC':f.token},
 });
 assert.ok(isAuthenticatedGitHubMerge(candidate));
 assert.equal(candidate.eventKey,'github:pr-merge:'+repoId+':68:'+mergeSha);
 assert.equal(candidate.path,'engineering/knowledge/pr-68');
 assert.equal(candidate.scope,'personal');
 assert.doesNotMatch(candidate.body,/secrets|PR body|patient/);
});
test('changed request body cannot reuse a signed OIDC assertion',async()=>{
 const f=fixture();
 const changed=JSON.stringify({...payload(),number:69,pull_request:{
  ...payload().pull_request,number:69}});
 await assert.rejects(verifyOidcGitHubMerge({
  body:changed,endpoint,repositories,fetchImpl:jwksFetch,now,
  headers:{...secretHeaders,'X-Knowledge-Actions-OIDC':f.token},
 }),{code:'CLAIMS_REJECTED'});
});
test('GitHub OIDC identity rejects wrong repository, workflow, branch, issuer and unsupported events',async()=>{
 const f=fixture();
 const variants=[
  {repository_id:'999'},
  {repository:'other-owner/knowledge'},
  {sub:'repo:'+repo+':ref:refs/heads/feature'},
  {ref:'refs/heads/feature'},
  {ref_type:'tag'},
  {event_name:'pull_request_target'},
  {workflow_ref:repo+'/.github/workflows/other.yml@refs/heads/main'},
  {workflow_sha:'not-a-sha'},
  {runner_environment:'self-hosted'},
  {repository_visibility:'private'},
  {iss:'https://untrusted.example'},
  {run_attempt:'0'},
  {run_id:'bad'},
  {nbf:now+120},
  {exp:now-120},
  {iat:now+120},
  {exp:now+2000},
  {aud:audience(f.body)+'tampered'},
 ];
 for(const change of variants){
  const token=jwt({...f.c,...change});
  await assert.rejects(verifyGithubActionsOidcToken({
   token,audience:audience(f.body),repositories,fetchImpl:jwksFetch,now,
  }),{code:'CLAIMS_REJECTED'});
 }
});
test('missing, malformed, non-RS256 and tampered JWTs never authorize capture',async()=>{
 const f=fixture();
 const variants=[
  '', 'abc', f.token.slice(0,-5)+'AAAAA',
  jwt(f.c,{alg:'none',typ:'JWT',kid:jwk.kid}),
  jwt(f.c,{alg:'HS256',typ:'JWT',kid:jwk.kid}),
  jwt(f.c,{alg:'RS256',typ:'JWT',kid:'unknown'}),
 ];
 for(const token of variants){
  await assert.rejects(verifyGithubActionsOidcToken({
   token,audience:audience(f.body),repositories,fetchImpl:jwksFetch,now,
  }),/KNOWLEDGE_GITHUB_OIDC_/);
 }
 await assert.rejects(verifyOidcGitHubMerge({
  body:f.body,endpoint,repositories,fetchImpl:jwksFetch,now,
  headers:{...secretHeaders,'X-Knowledge-Actions-OIDC':f.token,
   'X-Hub-Signature-256':'sha256='+'0'.repeat(64)},
 }),{code:'INVALID_SIGNATURE'});
});
test('unavailable or malformed GitHub JWKS fails closed without trusting unsigned keys',async()=>{
 const f=fixture();
 for(const fetchImpl of [
  async()=>new Response(null,{status:503}),
  async()=>new Response('<html>bad</html>',{status:200,headers:{'content-type':'text/html'}}),
  async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}}),
  async()=>new Response(JSON.stringify({keys:[]}),{status:200,
   headers:{'content-type':'application/json'}}),
  async()=>{throw Error('offline');},
 ]){
  await assert.rejects(verifyGithubActionsOidcToken({
   token:f.token,audience:audience(f.body),repositories,fetchImpl,now,
  }),{code:'UNAVAILABLE'});
 }
});
test('no signature-only bypass if the source event disagrees with signed workflow push',async()=>{
 const p=payload();p.knowledge_push_sha='f'.repeat(40);
 const body=JSON.stringify(p),token=jwt(claims(audience(body)));
 await assert.rejects(verifyOidcGitHubMerge({
  body,endpoint,repositories,fetchImpl:jwksFetch,now,
  headers:{...secretHeaders,'X-Knowledge-Actions-OIDC':token},
 }),{code:'SCOPE_NOT_AUTHORIZED'});
});
