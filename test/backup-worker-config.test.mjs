import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BACKUP_ACK,BACKUP_CRON} from '../src/worker-cloudflare-backup.mjs';

const cfgPath=fileURLToPath(new URL('../ops/private-forward/wrangler.backup.json',import.meta.url));
const cfg=JSON.parse(readFileSync(cfgPath,'utf8'));

test('scheduled backup infrastructure config is cron-only and nonpublic',()=>{
  assert.equal(cfg.name,'knowledge-forward-backup-private');
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.preview_urls,false);
  assert.deepEqual(cfg.triggers.crons,[BACKUP_CRON]);
  assert.equal(cfg.main,'../../src/worker-cloudflare-backup.mjs');
  assert.match(readFileSync(resolve(dirname(cfgPath),cfg.main),'utf8'),/async scheduled\(controller,env\)/);
});

test('backup infrastructure config has only the intended D1, R2 and nonsecret bindings',()=>{
  assert.equal(cfg.d1_databases.length,1);
  assert.deepEqual(cfg.d1_databases[0],{binding:'BACKUP_DB',
    database_name:'knowledge-forward-private',database_id:'d942f8de-1f89-4942-adf7-e8ba00a72efa'});
  assert.deepEqual(cfg.r2_buckets,[{binding:'BACKUP_BUCKET',bucket_name:'knowledge-forward-backups-private'}]);
  assert.deepEqual(cfg.vars,{BACKUP_ACK,BACKUP_SPACE:'personal',BACKUP_KEY_ID:'owner-v1'});
  const complete=JSON.stringify(cfg);
  for(const forbidden of ['KNOWLEDGE_DATA_KEY','KNOWLEDGE_ACCESS_AUD','KNOWLEDGE_PRIVATE_WRITE_ACK','notion'])
    assert.ok(!complete.includes(forbidden));
  assert.equal(Object.hasOwn(cfg,'routes'),false);
});
