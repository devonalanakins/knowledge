import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';

const read=rel=>readFileSync(new URL('../'+rel,import.meta.url),'utf8');
const configPath='ops/private-forward/wrangler.owner-ui.dryrun.json';
function filesIn(directory) {
 const result=[];
 for(const item of readdirSync(directory)) {
  const full=path.join(directory,item);
  if(statSync(full).isDirectory())result.push(...filesIn(full));
  else if(full.endsWith('.js')||full.endsWith('.mjs'))result.push(full);
 }
 return result;
}
test('private UI bundle manifest is intentionally non-routable and has no bindings',()=>{
 const config=JSON.parse(read(configPath));
 assert.deepEqual(Object.keys(config).sort(),[
  '$schema','name','main','compatibility_date','workers_dev','preview_urls'
 ].sort());
 assert.equal(config.name,'knowledge-private-ui-bundle-only');
 assert.equal(config.main,'../../src/worker-cloudflare-private.mjs',
   'bundle the actual protected UI Worker, not alternate RPC/capture ingress');
 assert.equal(config.compatibility_date,'2026-11-07');
 assert.equal(config.workers_dev,false);
 assert.equal(config.preview_urls,false);
 assert.doesNotMatch(JSON.stringify(config),/routes?|triggers|vars|secret|d1_databases|r2_buckets|service/);
 const worker=read('src/worker-cloudflare-private.mjs');
 assert.match(worker,/import \{knowledgeAppAssetResponse\} from '.\/forward-app-metadata\.mjs'/);
 assert.match(worker,/import \{ownerMarkdownDownloadResponse\} from '.\/forward-private-download\.mjs'/);
 assert.match(worker,/function browserRoute\(request,settings,env\)/);
 assert.match(worker,/ctx\?\.access/);
});
test('bundle workflow cannot publish assets or access production secrets',()=>{
 const workflow=read('.github/workflows/verify-private-ui-bundle.yml');
 assert.match(workflow,/permissions:\s*\n\s+contents: read/);
 assert.match(workflow,/--dry-run/);
 assert.match(workflow,/--config ops\/private-forward\/wrangler\.owner-ui\.dryrun\.json/);
 assert.match(workflow,/--outdir/);
 assert.doesNotMatch(workflow,/WRANGLER_API_TOKEN|CLOUDFLARE_API_TOKEN|workflow_dispatch|repository_dispatch|environment: production|wrangler secret|wrangler d1/i);
});
if(process.env.KNOWLEDGE_PRIVATE_UI_BUNDLE_DIR) {
 test('actual dry-run Worker bundle includes approved brand and authenticated UI routes',()=>{
  const files=filesIn(process.env.KNOWLEDGE_PRIVATE_UI_BUNDLE_DIR);
  assert.ok(files.length>0,'Wrangler did not emit a JavaScript Worker bundle');
  const joined=files.map(p=>readFileSync(p,'utf8')).join('\n');
  for(const required of [
   'knowledge-neural-k-2026-11-11',
   '/wiki/manifest.webmanifest',
   '/wiki/icon.svg',
   '/wiki/download/',
   'KNOWLEDGE_ACCESS_AUD',
   'OWNER_ONLY_BROWSER_READ_V1',
  ])assert.ok(joined.includes(required),'Missing Worker runtime invariant: '+required);
  assert.ok(joined.length>30000,'Unexpectedly tiny bundle');
 });
}
