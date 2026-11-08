/**
 * Execute the exact checked-in GitHub Actions sender with a synthetic local
 * Cloudflare ingress, encrypted D1 inbox, narrow machine RPC and owner
 * readback. This never connects to GitHub or Cloudflare production.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const workflow=readFileSync(new URL('../.github/workflows/knowledge-merge-delivery.yml',import.meta.url),'utf8');
const beginMarker="          node --input-type=module <<'NODE'\n";
const begin=workflow.indexOf(beginMarker);
const end=workflow.indexOf('\n          NODE',begin+beginMarker.length);
assert.ok(begin>=0&&end>begin,'expected checked-in Actions sender');
const sender=workflow.slice(begin+beginMarker.length,end).split('\n')
  .map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
const owner='devonalanakins/knowledge';
const event={
  action:'closed',number:45,
  repository:{id:1446728034,full_name:owner},
  pull_request:{
    number:45,merged:true,merge_commit_sha:'c'.repeat(40),
    base:{ref:'main',repo:{id:1446728034,full_name:'devonalanakins/knowledge'}},
    merged_at:'2026-11-08T18:21:35.000Z',
    title:'UNTRUSTED TITLE should not be forwarded',
    body:'UNTRUSTED PRIVATE BODY must not be forwarded',
    user:{login:'UNTRUSTED USER'},
    head:{repo:{full_name:'untrusted/fork'}},
  },
};
const url='https://knowledge-capture-ingress-private.devonakins.workers.dev/github';
const signingKey='FICTIONAL_ONLY_sender_ingress_contract_key_2026_11_08';

function run(input=event,environment={}){
  const dir=mkdtempSync(join(tmpdir(),'knowledge-actions-contract-'));
  try{
    const path=join(dir,'event.json');
    writeFileSync(path,JSON.stringify(input),{mode:0o600});
    const executable="import './test/support/knowledge-actions-wire-fixture.mjs';\n"+sender+"\n";
    const proc=spawnSync(process.execPath,['--input-type=module'],{
      cwd:process.cwd(),input:executable,encoding:'utf8',timeout:25000,
      maxBuffer:1024*1024,
      env:{
        ...process.env,GITHUB_EVENT_PATH:path,
        GITHUB_REPOSITORY:owner,
        KNOWLEDGE_CAPTURE_DELIVERY_ACK:'OWNER_APPROVED_GITHUB_CAPTURE_V1',
        KNOWLEDGE_CAPTURE_INGRESS_URL:url,
        KNOWLEDGE_CAPTURE_SIGNING_SECRET:signingKey,
        TEST_INBOX_KEY:'b1'.repeat(32),
        TEST_MACHINE_KEY:'c2'.repeat(32),
        TEST_OWNER_KEY:'d3'.repeat(32),
        ...environment,
      },
    });
    assert.equal(proc.error,undefined,String(proc.error));
    const line=proc.stdout.split('\n').find(x=>x.startsWith('KNOWLEDGE_WIRE_CONTRACT:'));
    return {exit:proc.status,stdout:proc.stdout,stderr:proc.stderr,
      receipt:line?JSON.parse(line.slice('KNOWLEDGE_WIRE_CONTRACT:'.length)):null};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('real Actions sender -> authenticated ingress -> encrypted receipt -> private RPC -> owner readback',()=>{
  const r=run();
  assert.equal(r.exit,0,r.stderr);
  assert.deepEqual(r.receipt,{
    status:'SYNTHETIC_CAPTURE_COMPLETED',
    ingress:202,duplicate:202,tampered:401,
    processed:{attempted:1,saved:1,pending:0,blocked:0,failed:0,stale:0},
    queueSize:1,queueState:'saved',queueAttempts:1,
    encryptedQueueHasPrivateText:false,
    ownerPages:1,ownerRevisions:1,encryptedOwnerHasPrivateText:false,
    headMatchesRevision:true,
    readback:{
      path:'engineering/knowledge/pr-45',version:1,status:'draft',
      bodyHasUntrusted:false,
      sourceUrl:'https://github.com/devonalanakins/knowledge/pull/45',
    },
  });
  assert.match(r.stdout,/durably queued \(not yet saved\)/);
  assert.doesNotMatch(r.stdout,/UNTRUSTED|PRIVATE BODY|FICTIONAL_ONLY_sender/);
});
test('the actual Actions sender rejects an unapproved repository ID before ingress',()=>{
  const r=run({...event,repository:{...event.repository,id:1}});
  assert.notEqual(r.exit,0);
  assert.match(r.stderr,/KNOWLEDGE_MERGE_DELIVERY_NOT_AUTHORIZED_EVENT/);
  assert.doesNotMatch(r.stdout,/durably queued/);
});
test('non-main or unknown base repo is rejected before signed transport',()=>{
  const cases=[
    {...event,pull_request:{...event.pull_request,base:{...event.pull_request.base,ref:'release'}}},
    {...event,pull_request:{...event.pull_request,base:{ref:'main',repo:{id:10,full_name:'devonalanakins/knowledge'}}}},
    {...event,pull_request:{...event.pull_request,base:null}},
  ];
  for(const sample of cases){
    const r=run(sample);
    assert.notEqual(r.exit,0);
    assert.match(r.stderr,/KNOWLEDGE_MERGE_DELIVERY_NOT_AUTHORIZED_EVENT/);
    assert.doesNotMatch(r.stdout,/durably queued/);
  }
});
test('no signing key or disabled activation never invokes the synthetic ingress',()=>{
  for(const env of [
    {KNOWLEDGE_CAPTURE_DELIVERY_ACK:''},
    {KNOWLEDGE_CAPTURE_SIGNING_SECRET:''},
  ]){
    const r=run(event,env);
    assert.notEqual(r.exit,0);
    assert.doesNotMatch(r.stdout,/durably queued/);
  }
});
