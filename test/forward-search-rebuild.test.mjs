import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,chmod,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createForwardSearchRebuildReader} from '../src/forward-ciphertext-restore.mjs';
import {createEncryptedKeyRecovery} from '../src/forward-key-recovery.mjs';
import {createSearchRebuildSqliteAdapter} from '../src/forward-search-rebuild-sqlite.mjs';
import {startSearchRebuild,rebuildSearchBatch,verifySearchIndex} from '../src/forward-search-rebuild.mjs';
import {searchFixture,syntheticPassphrase} from './support/forward-search-fixture.mjs';
const digest=d=>createHash('sha256').update(JSON.stringify([
 d.prepare('SELECT * FROM knowledge_pages ORDER BY path_key').all(),
 d.prepare('SELECT * FROM knowledge_revisions ORDER BY path_key,version').all(),
 d.prepare('SELECT * FROM knowledge_instance ORDER BY id').all(),
])).digest('hex');
async function finish(f,limit=20){
 let r=await startSearchRebuild(f);
 while(r.state==='building')r=await rebuildSearchBatch({...f,limit});
 return verifySearchIndex({...f,limit,markProgress:true});
}

test('rebuild resumes across a reopened ciphertext database and independently verifies every page',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'knowledge-reindex-'));
 let f;
 try{
   const path=join(parent,'cipher.sqlite');f=await searchFixture({pages:137,path});f.install();await chmod(path,0o600);
   const before=digest(f.database);
   await startSearchRebuild(f);
   assert.deepEqual(await rebuildSearchBatch({...f,limit:25}),{state:'building',processed:25,batchPages:25});
   const kit=f.kit;f.close();
   const database=new DatabaseSync(path);
   const reader=await createForwardSearchRebuildReader({kit,passphrase:syntheticPassphrase});
   f={database,reader,db:createSearchRebuildSqliteAdapter(database),close:()=>database.close()};
   assert.equal((await startSearchRebuild(f)).state,'building');
   const receipt=await finish(f,25);
   assert.equal(receipt.verified,true);assert.equal(receipt.pages,137);
   assert.equal(digest(database),before);
   assert.equal(database.prepare('SELECT state FROM knowledge_search_rebuild_progress').get().state,'verified');
   assert.throws(()=>database.exec('DELETE FROM knowledge_revisions'),/immutable/);
 }finally{f?.close();await rm(parent,{recursive:true,force:true});}
});

test('failed derived-index write rolls back both terms and progress, and retry is repeatable',async()=>{
 const f=await searchFixture();
 try{
   f.install();await startSearchRebuild(f);
   const realReader=f.reader;
   const reader={...realReader,indexStatements:async(db,row,page)=>[
     ...await realReader.indexStatements(db,row,page),
     db.prepare('INSERT INTO knowledge_search_terms(token_key,path_key) SELECT token_key,path_key FROM knowledge_search_terms WHERE path_key=?').bind(row.path_key),
   ]};
   await assert.rejects(rebuildSearchBatch({...f,reader}));
   assert.equal(f.database.prepare('SELECT processed FROM knowledge_search_rebuild_progress').get().processed,0);
   assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM knowledge_search_terms').get().n,0);
   assert.equal((await finish(f)).pages,17);
   const original=f.database.prepare('SELECT * FROM knowledge_search_terms ORDER BY token_key,path_key').all();
   await startSearchRebuild({...f,restart:true});await finish(f);
   assert.deepEqual(f.database.prepare('SELECT * FROM knowledge_search_terms ORDER BY token_key,path_key').all(),original);
 }finally{f.close();}
});

test('unreviewed SQLite triggers and altered immutable guards cannot mutate source during reindexing',async()=>{
 const f=await searchFixture();
 try{
   f.install();await startSearchRebuild(f);const before=digest(f.database);
   f.database.exec("CREATE TRIGGER sqliteXhostile AFTER INSERT ON knowledge_search_terms BEGIN UPDATE knowledge_pages SET sealed='damaged'; END");
   await assert.rejects(rebuildSearchBatch(f),/exact reviewed ciphertext schema/);
   assert.equal(digest(f.database),before);
   assert.equal(f.database.prepare('SELECT processed FROM knowledge_search_rebuild_progress').get().processed,0);
   f.database.exec('DROP TRIGGER sqliteXhostile');
   f.database.exec("CREATE TEMP TRIGGER hostile_temp_trigger AFTER INSERT ON main.knowledge_search_terms BEGIN UPDATE knowledge_pages SET sealed='damaged'; END");
   await assert.rejects(rebuildSearchBatch(f),/exact reviewed ciphertext schema/);
   assert.equal(digest(f.database),before);
   f.database.exec('DROP TRIGGER hostile_temp_trigger');
   f.database.exec('DROP TRIGGER knowledge_revisions_immutable_delete');
   assert.throws(()=>createSearchRebuildSqliteAdapter(f.database),/exact reviewed ciphertext schema/);
 }finally{f.close();}
});

test('wrong key/workspace, tampered ciphertext and mismatched immutable current revision fail before indexing',async()=>{
 const f=await searchFixture(),wrong=await searchFixture({scope:'anevum'});
 try{
   f.install();
   await assert.rejects(startSearchRebuild({...f,reader:wrong.reader}));
   const wrongKit=createEncryptedKeyRecovery({scope:'personal',keyId:'owner-v1',passphrase:syntheticPassphrase});
   const wrongKey=await createForwardSearchRebuildReader({kit:wrongKit,passphrase:syntheticPassphrase});
   await assert.rejects(startSearchRebuild({...f,reader:wrongKey}));
   assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM knowledge_search_rebuild_progress').get().n,0);
   await startSearchRebuild(f);
   f.database.prepare('UPDATE knowledge_pages SET sealed=?').run('tampered');
   await assert.rejects(rebuildSearchBatch(f));
   assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM knowledge_search_terms').get().n,0);
 }finally{f.close();wrong.close();}
 const mismatch=await searchFixture();
 try{
   mismatch.install();await startSearchRebuild(mismatch);
   mismatch.database.exec("UPDATE knowledge_pages SET updated_at='2026-11-07T01:00:00.000Z'");
   await assert.rejects(rebuildSearchBatch(mismatch));
 }finally{mismatch.close();}
 const missing=await searchFixture();
 try{
   missing.install();await startSearchRebuild(missing);
   missing.database.exec('DROP TRIGGER knowledge_revisions_immutable_delete; DELETE FROM knowledge_revisions');
   await assert.rejects(rebuildSearchBatch(missing));
   assert.equal(missing.database.prepare('SELECT COUNT(*) AS n FROM knowledge_search_terms').get().n,0);
 }finally{missing.close();}
});

test('new authenticated records after the rebuild prevent a false complete verification',async()=>{
 const f=await searchFixture(),larger=await searchFixture({pages:18});
 try{
   f.install();await finish(f);
   const known=new Set(f.database.prepare('SELECT path_key FROM knowledge_pages').all().map(x=>x.path_key));
   const row=larger.database.prepare('SELECT * FROM knowledge_pages').all().find(x=>!known.has(x.path_key));
   f.database.prepare('INSERT INTO knowledge_pages(path_key,version,sealed,updated_at) VALUES(?,?,?,?)').run(row.path_key,row.version,row.sealed,row.updated_at);
   f.database.prepare('INSERT INTO knowledge_revisions(path_key,version,sealed,created_at) VALUES(?,?,?,?)').run(row.path_key,row.version,row.sealed,row.updated_at);
   await assert.rejects(verifySearchIndex(f));
   await startSearchRebuild({...f,restart:true});
   assert.equal((await finish(f)).pages,18);
 }finally{f.close();larger.close();}
});

test('empty marked databases finish without an unbounded or repeated tail read',async()=>{
 const f=await searchFixture({pages:0});
 try{
   f.install();assert.deepEqual(await finish(f),{verified:true,pages:0,tokens:0});
   await assert.rejects(rebuildSearchBatch(f));
   await assert.rejects(rebuildSearchBatch({...f,limit:26}));
 }finally{f.close();}
});

test('forged completion checkpoints, deleted terms and extra terms cannot obtain a verification receipt',async()=>{
 const f=await searchFixture();
 try{
   f.install();await startSearchRebuild(f);
   f.database.exec("UPDATE knowledge_search_rebuild_progress SET state='built',processed=17");
   await assert.rejects(verifySearchIndex({...f,markProgress:true}));
   await startSearchRebuild({...f,restart:true});await finish(f);
   const term=f.database.prepare('SELECT * FROM knowledge_search_terms LIMIT 1').get();
   f.database.prepare('DELETE FROM knowledge_search_terms WHERE token_key=? AND path_key=?').run(term.token_key,term.path_key);
   await assert.rejects(verifySearchIndex(f));
   await startSearchRebuild({...f,restart:true});await finish(f);
   f.database.prepare('INSERT INTO knowledge_search_terms(token_key,path_key) VALUES(?,?)').run('A'.repeat(43),term.path_key);
   await assert.rejects(verifySearchIndex(f));
 }finally{f.close();}
});

test('verification holds a SQLite write lock across all batches and refuses unsupported adapters',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'knowledge-reindex-lock-'));let f,other;
 try{
   const path=join(parent,'cipher.sqlite');f=await searchFixture({path});f.install();await finish(f);
   other=new DatabaseSync(path);other.exec('PRAGMA busy_timeout=0');
   const authenticate=f.reader.authenticatePage;let attempts=0;
   const reader={...f.reader,authenticatePage:async row=>{
     assert.throws(()=>other.exec("DELETE FROM knowledge_search_terms"),/locked/);attempts++;
     return authenticate(row);
   }};
   assert.equal((await verifySearchIndex({...f,reader,limit:3})).pages,17);
   assert.equal(attempts,17);
   await assert.rejects(verifySearchIndex({...f,db:{...f.db,withConsistentRead:undefined}}));
 }finally{other?.close();f?.close();await rm(parent,{recursive:true,force:true});}
});

test('large rebuild keeps encrypted page reads bounded to 26 rows and verifies 3312 records',async()=>{
 const f=await searchFixture({pages:3312});
 try{
   f.install();let largest=0;
   const prepare=f.db.prepare;
   f.db.prepare=sql=>{
     const stmt=prepare(sql);
     if(!sql.includes('CASE WHEN length(sealed)'))return stmt;
     return {bind(...args){const bound=stmt.bind(...args);return {...bound,all:async()=>{
       const r=await bound.all();largest=Math.max(largest,r.results.length);return r;
     }};}};
   };
   const receipt=await finish(f,25);
   assert.equal(receipt.pages,3312);assert.equal(largest,26);
 }finally{f.close();}
});

test('local CLI refuses noninteractive use without opening files or printing input',()=>{
 const cli=fileURLToPath(new URL('../ops/private-forward/rebuild-search-cli.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[cli,'rebuild','/does-not-exist/cipher.sqlite','/does-not-exist/key.json'],{encoding:'utf8',input:'fictional-secret',timeout:10000});
 assert.notEqual(r.status,0);assert.match(r.stderr,/operation refused/);assert.doesNotMatch(r.stdout,/fictional-secret/);
});

test('real local CLI rebuilds, resumes, verifies and repairs synthetic ciphertext without leaking secrets',
 {skip:process.platform==='win32'},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'knowledge-reindex-cli-'));let f;
 try{
   const path=join(parent,'cipher.sqlite'),kitPath=join(parent,'recovery.json');
   f=await searchFixture({pages:5,path});const before=digest(f.database);
   await chmod(path,0o600);await writeFile(kitPath,JSON.stringify(f.kit),{mode:0o600});f.close();f=null;
   const cli=fileURLToPath(new URL('../ops/private-forward/rebuild-search-cli.mjs',import.meta.url));
   const run=(command,flag)=>{
     const program=`import json,os,pty,select,sys,time,signal\nc=json.load(sys.stdin)\npid,fd=pty.fork()\nif pid==0: os.execv(c['args'][0],c['args'])\nout=b''; sent=False; status=None; deadline=time.monotonic()+20\nwhile time.monotonic()<deadline:\n ready,_,_=select.select([fd],[],[],0.1)\n if ready:\n  try: b=os.read(fd,65536)\n  except OSError: break\n  if not b: break\n  out+=b\n  if b'Existing recovery passphrase (hidden): ' in out and not sent:\n   os.write(fd,(c['passphrase']+'\\n').encode());sent=True\n done,st=os.waitpid(pid,os.WNOHANG)\n if done: status=st;break\nif status is None:\n done,st=os.waitpid(pid,os.WNOHANG)\n if done: status=st\n else:\n  os.kill(pid,signal.SIGKILL);_,status=os.waitpid(pid,0)\nos.close(fd)\nprint(json.dumps({'status':os.waitstatus_to_exitcode(status),'output':out.decode(errors='replace')}))`;
     const result=spawnSync('python3',['-c',program],{encoding:'utf8',timeout:25000,
       input:JSON.stringify({args:[process.execPath,cli,command,path,kitPath,...(flag?[flag]:[])],passphrase:syntheticPassphrase})});
     assert.equal(result.status,0,result.stderr);const r=JSON.parse(result.stdout);
     assert.ok(!r.output.includes(syntheticPassphrase));
     assert.ok(!r.output.includes('0123456789abcdef'.repeat(4)));
     assert.doesNotMatch(r.output,/Synthetic photon|fictional\/rebuild-/);
     return r;
   };
   assert.equal(run('rebuild').status,0);assert.equal(run('rebuild').status,0);
   assert.equal(run('verify').status,0);
   let db=new DatabaseSync(path);assert.equal(digest(db),before);db.exec('DELETE FROM knowledge_search_terms');db.close();
   assert.notEqual(run('verify').status,0);
   const fixed=run('rebuild','--restart');assert.equal(fixed.status,0);assert.match(fixed.output,/LOCAL_DERIVED_INDEX_VERIFIED/);
   db=new DatabaseSync(path);assert.equal(digest(db),before);db.close();
   await chmod(parent,0o755);
   assert.notEqual(run('verify').status,0);
 }finally{f?.close();await rm(parent,{recursive:true,force:true});}
});
