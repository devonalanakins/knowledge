import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow=readFileSync(new URL('../.github/workflows/knowledge-merge-delivery.yml',import.meta.url),'utf8');
const startMarker="          node --input-type=module <<'NODE'\n";
const start=workflow.indexOf(startMarker),end=workflow.indexOf('\n          NODE',start+startMarker.length);
assert.ok(start>=0&&end>start,'checked-in workflow has inline sender');
const script=workflow.slice(start+startMarker.length,end).split('\n')
  .map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
const sha='a'.repeat(40),repo='devonalanakins/knowledge',repoId=1446728034;
const endpoint='https://knowledge-capture-ingress-private.devonakins.workers.dev/github';
const signingSecret='synthetic-github-action-capture-hmac-2026-11-08-fully-fictional';
const token='synthetic-read-only-token-2026';
const event={
  ref:'refs/heads/main',after:sha,deleted:false,forced:false,created:false,
  distinct_size:1,commits:[{id:sha,message:'UNTRUSTED COMMIT BODY'}],
  repository:{id:repoId,full_name:repo},
};
const associated=[{
  number:44,state:'closed',merged_at:'2026-11-08T18:07:00.000Z',
  merge_commit_sha:sha,base:{ref:'main',repo:{id:repoId,full_name:repo}},
  title:'UNTRUSTED PR TITLE',body:'PRIVATE PR DESCRIPTION',
}];
function run(input=event,{env={},prs=associated,apiStatus=200,resultStatus=202,url=endpoint}={}){
 const root=mkdtempSync(join(tmpdir(),'knowledge-push-delivery-'));
 try{
  const eventFile=join(root,'event.json');
  writeFileSync(eventFile,JSON.stringify(input),{mode:0o600});
  const stub=[
   "import {createHmac as testHmac} from 'node:crypto';",
   "const apiStatus=Number(process.env.TEST_API_STATUS);",
   "const responseStatus=Number(process.env.TEST_RESPONSE_STATUS);",
   "const associated=JSON.parse(process.env.TEST_ASSOCIATED_PRS);",
   "globalThis.fetch=async(url,options)=>{",
   " if(url.startsWith('https://api.github.com/repos/')){",
   "  console.log('FICTIONAL_API:'+JSON.stringify({url,method:options.method,",
   "   authorized:options.headers.Authorization==='Bearer '+process.env.GITHUB_READ_TOKEN}));",
   "  return {status:apiStatus,json:async()=>associated};",
   " }",
   " const signature='sha256='+testHmac('sha256',process.env.KNOWLEDGE_CAPTURE_SIGNING_SECRET)",
   "  .update(options.body,'utf8').digest('hex');",
   " console.log('FICTIONAL_DELIVERY:'+JSON.stringify({url,method:options.method,",
   "  body:JSON.parse(options.body),status:responseStatus,",
   "  signatureValid:options.headers['X-Hub-Signature-256']===signature,",
   "  githubEvent:options.headers['X-GitHub-Event']}));",
   " return {status:responseStatus};",
   "};",
  ].join('\n');
  const p=spawnSync(process.execPath,['--input-type=module'],{
   input:stub+'\n'+script+'\n',encoding:'utf8',timeout:10000,
   env:{
    ...process.env,GITHUB_EVENT_PATH:eventFile,GITHUB_REPOSITORY:repo,
    GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_SHA:input?.after??sha,
    GITHUB_READ_TOKEN:token,
    KNOWLEDGE_CAPTURE_DELIVERY_ACK:'OWNER_APPROVED_GITHUB_CAPTURE_V1',
    KNOWLEDGE_CAPTURE_AUTH_MODE:'hmac_v1',
    KNOWLEDGE_CAPTURE_INGRESS_URL:url,KNOWLEDGE_CAPTURE_SIGNING_SECRET:signingSecret,
    TEST_API_STATUS:String(apiStatus),TEST_RESPONSE_STATUS:String(resultStatus),
    TEST_ASSOCIATED_PRS:JSON.stringify(prs),...env,
   },
  });
  assert.equal(p.error,undefined,String(p.error));
  const lines=p.stdout.split('\n');
  return {code:p.status,stdout:p.stdout,stderr:p.stderr,
   api:lines.filter(x=>x.startsWith('FICTIONAL_API:')).map(x=>JSON.parse(x.slice('FICTIONAL_API:'.length))),
   deliveries:lines.filter(x=>x.startsWith('FICTIONAL_DELIVERY:')).map(x=>JSON.parse(x.slice('FICTIONAL_DELIVERY:'.length)))};
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('trusted-main push only; no privileged PR target, checkout, or PR code execution',()=>{
 assert.match(workflow,/^on:\s*\n\s*push:\s*\n\s*branches: \[main\]/m);
 assert.doesNotMatch(workflow,/pull_request_target|actions\/checkout|workflow_run|npm install|npm ci|curl\s/i);
 assert.match(workflow,/^  contents: read$/m);
 assert.match(workflow,/^  pull-requests: read$/m);
 assert.match(workflow,/^  id-token: write$/m);
 assert.doesNotMatch(workflow,/pull-requests: write|contents: write/);
 assert.match(workflow,/vars\.KNOWLEDGE_CAPTURE_DELIVERY_ACK == 'OWNER_APPROVED_GITHUB_CAPTURE_V1'/);
});
test('GitHub commit lookup associates merge; only allowlisted metadata is signed and queued',()=>{
 const r=run();assert.equal(r.code,0,r.stderr);
 assert.equal(r.api.length,1);assert.match(r.api[0].url,new RegExp('/commits/'+sha+'/pulls'));
 assert.equal(r.api[0].authorized,true);assert.equal(r.deliveries.length,1);
 const out=r.deliveries[0];assert.equal(out.url,endpoint);assert.equal(out.method,'POST');
 assert.equal(out.signatureValid,true);assert.equal(out.githubEvent,'pull_request');
 assert.deepEqual(out.body,{action:'closed',number:44,repository:{id:repoId,full_name:repo},
  pull_request:{number:44,merged:true,merge_commit_sha:sha,merged_at:'2026-11-08T18:07:00.000Z'}});
 assert.match(r.stdout,/durably queued \(not yet saved\): 1/);
 assert.doesNotMatch(r.stdout,/PRIVATE PR DESCRIPTION|UNTRUSTED PR TITLE|UNTRUSTED COMMIT BODY/);
});
test('direct push, unrelated PR, wrong target and unmatched SHA produce no receipt',()=>{
 const variants=[[],[{...associated[0],state:'open'}],
  [{...associated[0],base:{...associated[0].base,ref:'release'}}],
  [{...associated[0],base:{...associated[0].base,repo:{id:1,full_name:repo}}}],
  [{...associated[0],merge_commit_sha:'b'.repeat(40)}]];
 for(const prs of variants){
  const r=run(event,{prs});assert.equal(r.code,0,r.stderr);
  assert.equal(r.deliveries.length,0);assert.match(r.stdout,/No qualifying merged PR/);
 }
});
test('forced push, non-main ref, wrong repo and incomplete history fail closed',()=>{
 const inputs=[
  {...event,forced:true},{...event,ref:'refs/heads/release'},
  {...event,repository:{...event.repository,id:1}},{...event,commits:[]},
  {...event,distinct_size:2},{...event,commits:[{id:'b'.repeat(40)}]},
  {...event,commits:[{id:sha},{id:sha}],distinct_size:2},
 ];
 for(const input of inputs){
  const r=run(input);assert.notEqual(r.code,0);
  assert.equal(r.api.length,0);assert.equal(r.deliveries.length,0);
  assert.match(r.stderr,/KNOWLEDGE_MERGE_DELIVERY_UNSUPPORTED_OR_UNTRUSTED_PUSH/);
 }
 const r=run(event,{env:{GITHUB_EVENT_NAME:'pull_request_target'}});
 assert.notEqual(r.code,0);assert.equal(r.deliveries.length,0);
});
test('GitHub API errors or incomplete result pages cannot claim queued or saved',()=>{
 for(const opts of [{apiStatus:403},{apiStatus:503},{prs:Array.from({length:100},()=>associated[0])}]){
  const r=run(event,opts);assert.notEqual(r.code,0);
  assert.equal(r.deliveries.length,0);assert.match(r.stderr,/KNOWLEDGE_MERGE_DELIVERY_GITHUB_LOOKUP_/);
 }
 const dup=run(event,{prs:[associated[0],associated[0]]});
 assert.notEqual(dup.code,0);assert.equal(dup.deliveries.length,0);
 assert.match(dup.stderr,/KNOWLEDGE_MERGE_DELIVERY_AMBIGUOUS_MERGE/);
});
test('disabled approval, absent key/token or unsafe URL never reach GitHub API',()=>{
 const cases=[{KNOWLEDGE_CAPTURE_DELIVERY_ACK:''},
  {KNOWLEDGE_CAPTURE_SIGNING_SECRET:''},{GITHUB_READ_TOKEN:''},
  {KNOWLEDGE_CAPTURE_INGRESS_URL:'http://knowledge-capture-ingress-private.devonakins.workers.dev/github'}];
 for(const env of cases){
  const r=run(event,{env});assert.notEqual(r.code,0);
  assert.equal(r.api.length,0);assert.equal(r.deliveries.length,0);
 }
});
test('non-202 receipt responses cannot masquerade as successfully queued',()=>{
 for(const resultStatus of [200,204,401,403,429,500,503]){
  const r=run(event,{resultStatus});assert.notEqual(r.code,0);
  assert.equal(r.deliveries.length,1);assert.match(r.stderr,/KNOWLEDGE_MERGE_DELIVERY_NOT_ENQUEUED/);
  assert.doesNotMatch(r.stdout,/durably queued/);
 }
});
