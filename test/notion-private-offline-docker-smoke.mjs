#!/usr/bin/env node
/**
 * G24 GitHub CI synthetic Docker smoke; never uses live Notion data.
 * Checks non-root execution, the protected vault, network denial and
 * read-only mount. Image pull/build is outside the runtime boundary.
 */
import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeSyntheticVault,PASSPHRASE,PAGE} from './support/notion-private-offline-fixture.mjs';

const image='knowledge-private-offline:g24';
const uid=typeof process.getuid==='function'?process.getuid():null;
const gid=typeof process.getgid==='function'?process.getgid():null;
if(uid===null||gid===null||uid===0)
 throw Error('G24 Docker smoke requires non-root Unix host identity');
const fx=await makeSyntheticVault();
function dockerRun(flags,args=[],input=''){
 const result=spawnSync('docker',[...flags,...args],{
  input,encoding:'utf8',timeout:60000,maxBuffer:1024*1024,
 });
 if(result.error)throw result.error;
 return result;
}
try{
 const security=[
  'run','--rm','-i',
  '--network','none','--read-only','--cap-drop','ALL',
  '--security-opt','no-new-privileges',
  '--pids-limit','64','--memory','256m','--cpus','1',
  '--user',uid+':'+gid,
  '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700',
  '--mount','type=bind,source='+fx.vault+',target=/vault,readonly',
 ];
 const files=['/vault/inventory.enc','/vault/selection.json',
  '/vault/content.enc','/vault/reserved.enc'];
 const run=dockerRun([...security,image],files,PASSPHRASE);
 assert.equal(run.status,0,'G24 container verification failed: '+run.stderr);
 const report=JSON.parse(run.stdout.trim());
 assert.equal(report.sourceSelectionMatchesArchive,true);
 assert.equal(report.selectedPages,1);
 assert.equal(report.networkRequestsMade,false);
 assert.equal(report.contentArchiveWritten,false);
 assert.equal(report.sourcePermissionsCertified,false);
 assert.equal(report.productionReady,false);
 assert.equal(report.cutoverApproved,false);
 assert.ok(!run.stdout.includes(PASSPHRASE));
 assert.ok(!run.stdout.includes(PAGE));

 // The process must not write to the bind-mounted source vault.
 const attemptWrite=[
  "const fs=await import('node:fs');",
  "try { fs.writeFileSync('/vault/attack.txt','unauthorized'); process.exit(7) }",
  "catch (error) {",
  "if (error.code==='EACCES'||error.code==='EROFS') process.exit(0);",
  "process.exit(8) }",
 ].join('\n');
 const fileTest=dockerRun([...security,'--entrypoint','node',image],
  ['--input-type=module','-e',attemptWrite]);
 assert.equal(fileTest.status,0,'G24 vault write denial did not hold');

 // External HTTPS must be unreachable during networkless execution.
 const attemptNetwork=[
  "try {",
  "await fetch('https://example.com/',{signal:AbortSignal.timeout(1800)});",
  "process.exit(7)",
  "} catch { process.exit(0) }",
 ].join('\n');
 const networkTest=dockerRun([...security,'--entrypoint','node',image],
  ['--input-type=module','-e',attemptNetwork]);
 assert.equal(networkTest.status,0,'G24 network denial did not hold');

 assert.deepEqual((await readdir(fx.vault)).sort(),
  ['content.enc','inventory.enc','selection.json']);
 process.stdout.write('G24 synthetic Docker smoke PASS: private archive, no external network, read-only vault, non-root\n');
}finally{await fx.cleanup()}
