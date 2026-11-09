import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../ops/private-forward/',import.meta.url));
const prefix='wrangler.capture-';
const manifests=[
 {file:prefix+'ingress.staged.json',name:'knowledge-capture-ingress-private',
  main:'../../src/worker-cloudflare-capture-ingress.mjs'},
 {file:prefix+'processor.staged.json',name:'knowledge-capture-processor-private',
  main:'../../src/worker-cloudflare-capture-processor.mjs'},
];
const captureDb='147ab931-7675-43b2-a8fc-eba2a2b72545';
const ownerDb='d942f8de-1f89-4942-adf7-e8ba00a72efa';
for(const {file,name,main} of manifests){
 test('staging '+name+' is disabled, private and pinned to separate capture D1',()=>{
  const configPath=resolve(root,file),config=JSON.parse(readFileSync(configPath,'utf8'));
  assert.deepEqual(Object.keys(config).sort(),[
   '$schema','compatibility_date','d1_databases','main','name',
   'preview_urls','workers_dev',
  ].sort());
  assert.equal(config.name,name);
  assert.equal(config.main,main);
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.match(config.compatibility_date,/^2026-11-08$/);
  assert.deepEqual(config.d1_databases,[{
   binding:'CAPTURE_INBOX_DB',
   database_name:'knowledge-capture-inbox-private',
   database_id:captureDb,
  }]);
  assert.notEqual(config.d1_databases[0].database_id,ownerDb);
  assert.ok(readFileSync(resolve(dirname(configPath),main),'utf8').length>100);
  for(const forbidden of [
   'routes','route','triggers','services','vars','secrets','unsafe',
   'observability','logpush','assets','env','placement','queues','r2_buckets',
  ]) assert.equal(Object.hasOwn(config,forbidden),false,forbidden);
  const serialized=JSON.stringify(config);
  for(const forbidden of [
   'KNOWLEDGE_DATA_KEY','KNOWLEDGE_ACCESS_AUD','KNOWLEDGE_ACCESS_EMAIL',
   'CAPTURE_WEBHOOK_SECRET','CAPTURE_INBOX_ROOT_HEX','CAPTURE_MACHINE_AUTH_KEY_HEX',
   'KNOWLEDGE_CAPTURE_WRITER','CAPTURE_INGRESS_ACK','CAPTURE_PROCESSOR_ACK',
  ]) assert.ok(!serialized.includes(forbidden),forbidden);
 });
}
test('staging ingress and processor share capture D1 and cannot use owner D1',()=>{
 const configs=manifests.map(x=>JSON.parse(readFileSync(resolve(root,x.file),'utf8')));
 assert.equal(configs[0].d1_databases[0].database_id,configs[1].d1_databases[0].database_id);
 assert.notEqual(configs[0].d1_databases[0].database_id,ownerDb);
 assert.notEqual(configs[1].d1_databases[0].database_id,ownerDb);
});
