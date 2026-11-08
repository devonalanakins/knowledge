import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifySignedGitHubMerge} from '../src/forward-github-capture.mjs';
import {confirmGitHubMergeAuthority} from '../src/forward-capture-github-authority.mjs';

const repo='devonalanakins/knowledge',repoId=1446728034;
const sha='e'.repeat(40),number=49,mergedAt='2026-11-08T20:30:50Z';
const secret='FICTIONAL_SIGNING_KEY_FOR_AUTHORITY_CHECK_ONLY_2026';
const allowlist={[repo]:{repoId,scope:'personal',pathPrefix:'engineering/knowledge'}};
const url='https://api.github.com/repos/devonalanakins/knowledge/pulls/49';

async function candidate(){
  const event={action:'closed',number,
    repository:{id:repoId,full_name:repo},
    pull_request:{number,merged:true,merged_at:mergedAt,merge_commit_sha:sha}};
  const body=JSON.stringify(event);
  const sig='sha256='+createHmac('sha256',secret).update(body).digest('hex');
  return verifySignedGitHubMerge({body,headers:{
    'X-Hub-Signature-256':sig,
    'X-GitHub-Event':'pull_request',
    'X-GitHub-Delivery':'18c265da-01fb-487d-aedf-dc3ec3d0b9a1',
  },secret,repositories:allowlist});
}
function source(){
  return {number,state:'closed',merged:true,merged_at:mergedAt,
    merge_commit_sha:sha,base:{ref:'main',repo:{id:repoId,full_name:repo}},
    body:'UNTRUSTED SECRET MESSAGE MUST NOT BE STORED',
    title:'UNTRUSTED PR TITLE'};
}
const ok=body=>new Response(JSON.stringify(body),{
  status:200,headers:{'Content-Type':'application/json'},
});
const confirm=async (candidate,api=async()=>ok(source()),opts={})=>
  confirmGitHubMergeAuthority(candidate,allowlist,{fetchImpl:api,...opts});

test('independently authenticates signed public-PR evidence at exact official GitHub URL',async()=>{
  const input=await candidate(),requests=[];
  assert.equal(await confirm(input,async(u,options)=>{
    requests.push({u,options});return ok(source());
  }),true);
  assert.equal(requests.length,1);
  assert.equal(requests[0].u,url);
  assert.equal(requests[0].options.method,'GET');
  assert.equal(requests[0].options.redirect,'error');
  assert.equal(requests[0].options.headers.Accept,'application/vnd.github+json');
  assert.equal(Object.hasOwn(requests[0].options.headers,'Authorization'),false);
});
test('valid Actions HMAC cannot invent an unmerged PR, changed SHA, wrong base or altered merged timestamp',async()=>{
  const input=await candidate();
  const variations=[
    {merged:false},
    {state:'open'},
    {number:48},
    {merge_commit_sha:'f'.repeat(40)},
    {merged_at:'2026-11-07T20:30:50Z'},
    {base:{ref:'release',repo:{id:repoId,full_name:repo}}},
    {base:{ref:'main',repo:{id:1,full_name:repo}}},
    {base:{ref:'main',repo:{id:repoId,full_name:'other/knowledge'}}},
    {base:null},
  ];
  for(const override of variations){
    const value={...source(),...override};
    await assert.rejects(confirm(input,async()=>ok(value)),{code:'MERGE_NOT_CONFIRMED'},
      JSON.stringify(override));
  }
});
test('rejects unauthenticated copies, wrong scope mapping and unapproved record path without network',async()=>{
  const input=await candidate();
  let calls=0;const noNetwork=async()=>{calls++;throw Error('network should not run');};
  await assert.rejects(confirm({...input},noNetwork),{code:'MERGE_NOT_CONFIRMED'});
  await assert.rejects(confirm(input,noNetwork,{
    // This override does not affect the protected allowlist argument.
  }),{code:'SOURCE_UNAVAILABLE'});
  await assert.rejects(
    confirmGitHubMergeAuthority(input,{[repo]:{...allowlist[repo],pathPrefix:'other/path'}},
      {fetchImpl:noNetwork}),{code:'MERGE_NOT_CONFIRMED'});
  assert.equal(calls,1);
});
test('provider 401/403/404/429/503 and offline network never produce an accepted receipt',async()=>{
  const input=await candidate();
  for(const status of [301,302,401,403,404,429,500,503]){
    await assert.rejects(confirm(input,async()=>new Response(null,{status})),
      {code:'SOURCE_UNAVAILABLE'});
  }
  await assert.rejects(confirm(input,async()=>{throw Error('offline');}),
    {code:'SOURCE_UNAVAILABLE'});
});
test('malformed or oversized responses never count as GitHub verification',async()=>{
  const input=await candidate();
  const cases=[
    new Response('{bad-json',{status:200,headers:{'Content-Type':'application/json'}}),
    new Response('plain',{status:200,headers:{'Content-Type':'text/plain'}}),
    new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}),
    new Response(JSON.stringify(source()),{status:200,
      headers:{'Content-Type':'application/json','Content-Length':'1048577'}}),
    new Response('x'.repeat(1048600),{status:200,
      headers:{'Content-Type':'application/json'}}),
  ];
  for(const response of cases)
    await assert.rejects(confirm(input,async()=>response),{code:'SOURCE_UNAVAILABLE'});
});
