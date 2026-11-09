import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
const base='/tmp/knowledge-capture-bundles';
for(const component of ['ingress','processor']){
 test('Wrangler generated nonempty '+component+' Worker bundle without deployment',()=>{
  const dir=join(base,component);
  const filenames=readdirSync(dir);
  assert.ok(filenames.length>0,'dry-run output missing');
  const candidates=filenames.filter(name=>/\.(?:js|mjs)$/.test(name));
  assert.ok(candidates.length>0,'no compiled JavaScript module emitted');
  const bundled=candidates.map(name=>{
   const file=join(dir,name),stat=statSync(file);
   assert.ok(stat.isFile()&&stat.size>100&&stat.size<10_000_000);
   return readFileSync(file,'utf8');
  }).join('\n');
  assert.ok(bundled.includes('CAPTURE_'), 'expected capture code in emitted bundle');
  assert.ok(!filenames.some(name=>/\.env|secret|token/i.test(name)));
 });
}
