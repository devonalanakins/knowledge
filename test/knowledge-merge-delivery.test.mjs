import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const file=new URL('../.github/workflows/knowledge-merge-delivery.yml',import.meta.url);
const workflow=readFileSync(file,'utf8');
const start="          node --input-type=module <<'NODE'\n";
const end="\n          NODE";
const begin=workflow.indexOf(start);
assert.ok(begin>=0,'expected inline JavaScript runner');
const finish=workflow.indexOf(end,begin+start.length);
assert.ok(finish>begin,'expected closed inline runner');
const script=workflow.slice(begin+start.length,finish).split('\n')
  .map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');

const entry={
  action:'closed',number:44,
  repository:{id:1446728034,full_name:'devonalanakins/knowledge'},
  pull_request:{
    number:44,merged:true,merge_commit_sha:'a'.repeat(40),
    merged_at:'2026-11-08T18:07:00.000Z',
    title:'UNTRUSTED TITLE NEVER SEND',
    body:'PRIVATE PR DESCRIPTION MUST NOT SEND',
    user:{login:'UNTRUSTED_IDENTITY'},
  },
};
const endpoint='https://knowledge-capture-ingress-private.devonakins.workers.dev/github';
const fixtureSecret='fictional-github-actions-HMAC-key-at-least-32-bytes';
function run(event=entry,{env={},status=202,endpointUrl=endpoint}={}){
  const root=mkdtempSync(join(tmpdir(),'knowledge-actions-delivery-'));
  try{
    const eventFile=join(root,'event.json');
    writeFileSync(eventFile,JSON.stringify(event),{mode:0o600});
    // Inject ONLY into a local subprocess; no real network calls.
    const stub=String.raw`import {createHmac as testHmac} from 'node:crypto';
globalThis.fetch=async(url,options)=>{
  const expected='sha256='+testHmac('sha256',process.env.KNOWLEDGE_CAPTURE_SIGNING_SECRET)
    .update(options.body,'utf8').digest('hex');
  console.log('FICTIONAL_DELIVERY:'+JSON.stringify({
    url,method:options.method,redirect:options.redirect,
    status:process.env.TEST_RESPONSE_STATUS,body:JSON.parse(options.body),
    signatureValid:options.headers['X-Hub-Signature-256']===expected,
    githubEvent:options.headers['X-GitHub-Event'],
    deliveryId:options.headers['X-GitHub-Delivery'],
  }));
  return {status:Number(process.env.TEST_RESPONSE_STATUS)};
};`;
    const processResult=spawnSync(process.execPath,['--input-type=module'],{
      input:stub+'\n'+script+'\n',encoding:'utf8',timeout:10000,
      env:{
        ...process.env,GITHUB_EVENT_PATH:eventFile,
        GITHUB_REPOSITORY:'devonalanakins/knowledge',
        KNOWLEDGE_CAPTURE_DELIVERY_ACK:'OWNER_APPROVED_GITHUB_CAPTURE_V1',
        KNOWLEDGE_CAPTURE_INGRESS_URL:endpointUrl,
        KNOWLEDGE_CAPTURE_SIGNING_SECRET:fixtureSecret,
        TEST_RESPONSE_STATUS:String(status),...env,
      },
    });
    assert.equal(processResult.error,undefined,String(processResult.error));
    const line=processResult.stdout.split('\n').find(x=>x.startsWith('FICTIONAL_DELIVERY:'));
    return {status:processResult.status,stderr:processResult.stderr,
      stdout:processResult.stdout,request:line?JSON.parse(line.slice('FICTIONAL_DELIVERY:'.length)):null};
  }finally{rmSync(root,{recursive:true,force:true});}
}
test('workflow is opt-in, avoids checkout/untrusted PR code, has no API token permissions',()=>{
  assert.match(workflow,/^on:\s*\n\s*pull_request:\s*\n\s*types: \[closed\]/m);
  assert.match(workflow,/^permissions: \{\}$/m);
  assert.match(workflow,/github\.event\.pull_request\.merged == true/);
  assert.match(workflow,/vars\.KNOWLEDGE_CAPTURE_DELIVERY_ACK == 'OWNER_APPROVED_GITHUB_CAPTURE_V1'/);
  assert.doesNotMatch(workflow,/actions\/checkout|pull_request_target|workflow_run|npm install|npm ci|curl\s/i);
  assert.doesNotMatch(workflow,/\\$\\{\\{\s*github\.event\.pull_request\.(title|body)/);
});
test('only a small signed, allowlisted GitHub merge receipt is delivered; it is not saved Knowledge',()=>{
  const res=run();
  assert.equal(res.status,0,res.stderr);
  assert.equal(res.request?.url,endpoint);
  assert.equal(res.request.method,'POST');
  assert.equal(res.request.redirect,'error');
  assert.equal(res.request.status,'202');
  assert.equal(res.request.signatureValid,true);
  assert.equal(res.request.githubEvent,'pull_request');
  assert.match(res.request.deliveryId,/^[0-9a-f]{8}-[0-9a-f-]{27,32}$/);
  assert.deepEqual(res.request.body,{
    action:'closed',number:44,
    repository:{id:1446728034,full_name:'devonalanakins/knowledge'},
    pull_request:{number:44,merged:true,merge_commit_sha:'a'.repeat(40),
      merged_at:'2026-11-08T18:07:00.000Z'},
  });
  assert.doesNotMatch(res.stdout,/UNTRUSTED|PRIVATE PR DESCRIPTION/);
  assert.match(res.stdout,/durably queued \(not yet saved\)/);
  assert.doesNotMatch(res.stdout, new RegExp(fixtureSecret));
});
test('wrong repo identity, unmerged PR, conflicting number or sha never send a webhook',()=>{
  const invalid=[
    {...entry,repository:{...entry.repository,id:1}},
    {...entry,action:'opened'},
    {...entry,pull_request:{...entry.pull_request,merged:false}},
    {...entry,pull_request:{...entry.pull_request,number:123}},
    {...entry,pull_request:{...entry.pull_request,merge_commit_sha:'b'.repeat(39)}},
  ];
  for(const item of invalid){
    const res=run(item);
    assert.notEqual(res.status,0);
    assert.equal(res.request,null);
    assert.match(res.stderr,/KNOWLEDGE_MERGE_DELIVERY_NOT_AUTHORIZED_EVENT/);
  }
  const wrongEnv=run(entry,{env:{GITHUB_REPOSITORY:'different/repo'}});
  assert.notEqual(wrongEnv.status,0);
  assert.equal(wrongEnv.request,null);
});
test('disabled acknowledgment, absent signing secret and invalid URLs fail without transport',()=>{
  const cases=[
    {env:{KNOWLEDGE_CAPTURE_DELIVERY_ACK:''},error:'DISABLED'},
    {env:{KNOWLEDGE_CAPTURE_SIGNING_SECRET:''},error:'SIGNING_KEY_UNAVAILABLE'},
    {endpointUrl:'http://knowledge-capture-ingress-private.devonakins.workers.dev/github',error:'INVALID_ENDPOINT'},
    {endpointUrl:'https://other-service.devonakins.workers.dev/github',error:'INVALID_ENDPOINT'},
    {endpointUrl:endpoint+'?token=secret',error:'INVALID_ENDPOINT'},
    {endpointUrl:'https://user:pass@knowledge-capture-ingress-private.devonakins.workers.dev/github',error:'INVALID_ENDPOINT'},
  ];
  for(const scenario of cases){
    const res=run(entry,scenario);
    assert.notEqual(res.status,0);
    assert.equal(res.request,null);
    assert.match(res.stderr,new RegExp('KNOWLEDGE_MERGE_DELIVERY_'+scenario.error));
    assert.doesNotMatch(res.stderr,/fictional-github-actions-HMAC/);
  }
});
test('non-202 outcomes and transport errors cannot masquerade as a saved receipt',()=>{
  for(const status of [200,204,401,403,429,500,503]){
    const res=run(entry,{status});
    assert.notEqual(res.status,0);
    assert.equal(res.request?.signatureValid,true);
    assert.match(res.stderr,/KNOWLEDGE_MERGE_DELIVERY_NOT_ENQUEUED/);
    assert.doesNotMatch(res.stdout,/not yet saved/);
  }
});
