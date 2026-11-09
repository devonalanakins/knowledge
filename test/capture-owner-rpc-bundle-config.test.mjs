import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=new URL('../ops/private-forward/wrangler.owner-rpc.dryrun.json',import.meta.url);
const config=JSON.parse(readFileSync(manifest,'utf8'));

test('owner machine RPC bundle manifest is compile-only, not the deployed Knowledge Worker',()=>{
  assert.deepEqual(Object.keys(config).sort(),[
    '$schema','compatibility_date','main','name','preview_urls','workers_dev',
  ].sort());
  assert.equal(config.name,'knowledge-owner-rpc-bundle-only');
  assert.notEqual(config.name,'knowledge-forward-private');
  assert.equal(config.main,'../../src/worker-cloudflare-private-rpc.mjs');
  assert.equal(config.compatibility_date,'2026-11-07');
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  for(const forbidden of [
    'routes','route','triggers','services','vars','secrets','unsafe',
    'observability','logpush','assets','env','placement','queues','r2_buckets',
    'd1_databases','kv_namespaces','durable_objects',
  ]) assert.equal(Object.hasOwn(config,forbidden),false,forbidden);
});
test('compile-only entrypoint still exports the private named RPC and existing HTTP worker',()=>{
  const module=readFileSync(new URL('../src/worker-cloudflare-private-rpc.mjs',import.meta.url),'utf8');
  assert.match(module,/export class KnowledgeCaptureEntrypoint extends WorkerEntrypoint/);
  assert.match(module,/async saveMergeReceipt\(payload\)/);
  assert.match(module,/handlePrivateMergeCapture\(this\.env,payload\)/);
  assert.match(module,/export default ownerWorker/);
  assert.doesNotMatch(JSON.stringify(config),/KNOWLEDGE_DATA_KEY|KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX|CAPTURE_MACHINE_AUTH_KEY_HEX/);
});
