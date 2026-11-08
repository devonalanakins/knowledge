import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,chmod,rm,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {searchFixture,syntheticPassphrase} from './support/forward-search-fixture.mjs';
import {verifyOrRestoreForwardD1Sql,MAX_SQL_EXPORT_BYTES} from '../src/forward-consistent-sql-restore.mjs';

const tables=['knowledge_instance','knowledge_pages','knowledge_revisions'];
const schema=readFileSync(new URL('../ops/private-forward/schema.sql',import.meta.url),'utf8');
function quote(value){
  return Number.isInteger(value)?String(value):"'"+String(value).replaceAll("'","''")+"'";
}
function makeDump(database,{omitHistory=false,damagePage=false,unexpected='',extra='',columns=false}={}){
  let output='PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n'+schema+'\n';
  for(const table of tables){
    let rows=database.prepare('SELECT * FROM '+table).all();
    if(table==='knowledge_revisions'&&omitHistory)rows=rows.slice(1);
    if(table==='knowledge_pages'&&damagePage&&rows.length)
      rows[0]={...rows[0],sealed:rows[0].sealed.replace('knowledge-sealed-v1','malformed')};
    for(const row of rows){
      const names=Object.keys(row);
      const colNames=columns?' ('+names.map(x=>'"'+x+'"').join(',')+')':'';
      output+='INSERT INTO "'+table+'"'+colNames+' VALUES('+Object.values(row).map(quote).join(',')+');\n';
    }
  }
  return output+unexpected+'COMMIT;\n'+extra;
}
function checksum(text){return createHash('sha256').update(text).digest('hex');}
async function sample({pages=3,dumpOptions={}}={}){
  const fixture=await searchFixture({pages});
  const sql=makeDump(fixture.database,dumpOptions);
  const folder=await mkdtemp(join(tmpdir(),'knowledge-offline-sql-'));
  const sourceFile=join(folder,'export.sql');
  await writeFile(sourceFile,sql,{mode:0o600});await chmod(sourceFile,0o600);
  const params={sourceFile,expectedSha256:checksum(sql),kit:fixture.kit,passphrase:syntheticPassphrase};
  return {fixture,sql,folder,sourceFile,params,
    async close(){fixture.close();await rm(folder,{recursive:true,force:true});}};
}
const expectRefused=async(work)=>assert.rejects(work,/KNOWLEDGE_SQL_RECOVERY_REFUSED/);

test('rebuilds only canonical ciphertext schema; verifies 732 fictional records beyond old 500-page ceiling',async()=>{
  const f=await sample({pages:732});
  try{
    const out=await verifyOrRestoreForwardD1Sql({...f.params,targetDir:join(f.folder,'restore')});
    assert.equal(out.status,'SQL_EXPORT_VERIFIED');
    assert.equal(out.restored,true);
    assert.deepEqual(out.counts,{pages:732,revisions:732,instances:1});
    assert.equal(out.sha256,f.params.expectedSha256);
    const original=f.fixture.database,restored=new DatabaseSync(out.sqliteFile);
    try{
      for(const table of tables){
        const source=original.prepare('SELECT * FROM '+table+' ORDER BY 1').all();
        const copy=restored.prepare('SELECT * FROM '+table+' ORDER BY 1').all();
        assert.deepEqual(copy,source);
      }
      assert.throws(()=>restored.exec('DELETE FROM knowledge_revisions'),/immutable/);
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    }finally{restored.close();}
    const info=await stat(out.sqliteFile);
    assert.equal(info.mode&0o777,0o600);
  }finally{await f.close();}
});

test('verify-only does not create files and accepts explicit INSERT column lists',async()=>{
  const f=await sample({dumpOptions:{columns:true}});
  try{
    const before=(await stat(f.folder)).mode;
    const output=await verifyOrRestoreForwardD1Sql(f.params);
    assert.equal(output.restored,false);
    assert.equal(output.counts.pages,3);
    assert.equal((await stat(f.folder)).mode,before);
    assert.ok(!JSON.stringify(output).includes('Synthetic photon'));
    assert.ok(!JSON.stringify(output).includes('0123456789abcdef'));
  }finally{await f.close();}
});

test('incorrect receipt SHA, wrong recovered key/scope and missing histories fail closed with no output',async()=>{
  const f=await sample(),other=await searchFixture({scope:'anevum'});
  try{
    await expectRefused(verifyOrRestoreForwardD1Sql({...f.params,expectedSha256:'0'.repeat(64),
      targetDir:join(f.folder,'wrong-hash')}));
    await expectRefused(verifyOrRestoreForwardD1Sql({...f.params,kit:other.kit,
      targetDir:join(f.folder,'wrong-kit')}));
    assert.rejects(stat(join(f.folder,'wrong-hash')));
    const bad=makeDump(f.fixture.database,{omitHistory:true});
    await writeFile(f.sourceFile,bad,{mode:0o600});
    await expectRefused(verifyOrRestoreForwardD1Sql({...f.params,expectedSha256:checksum(bad),
      targetDir:join(f.folder,'missing-history')}));
    await assert.rejects(stat(join(f.folder,'missing-history')));
  }finally{other.close();await f.close();}
});

test('mutated authenticated ciphertext rejects full restore before acceptance',async()=>{
  const f=await sample();
  try{
    const bad=makeDump(f.fixture.database,{damagePage:true});
    await writeFile(f.sourceFile,bad,{mode:0o600});
    await expectRefused(verifyOrRestoreForwardD1Sql({...f.params,
      expectedSha256:checksum(bad),targetDir:join(f.folder,'tampered')}));
    await assert.rejects(stat(join(f.folder,'tampered')));
  }finally{await f.close();}
});

test('untrusted SQL cannot execute DDL, DML, PRAGMA, ATTACH, or read other tables',async()=>{
  for(const unexpected of [
    'DELETE FROM knowledge_pages;\n',
    "ATTACH DATABASE '/tmp/unsafe' AS leak;\n",
    "UPDATE knowledge_revisions SET sealed='bad';\n",
    "INSERT INTO foreign_data VALUES('bad');\n",
    'PRAGMA writable_schema=ON;\n',
    'DROP TABLE knowledge_pages;\n',
  ]){
    const f=await sample({dumpOptions:{unexpected}});
    try{
      await expectRefused(verifyOrRestoreForwardD1Sql({...f.params,
        targetDir:join(f.folder,'reject')}));
      await assert.rejects(stat(join(f.folder,'reject')));
    }finally{await f.close();}
  }
});

test('rejects unwanted SQL statements after COMMIT, unexpected table declaration and duplicate rows',async()=>{
  for(const options of [
    {extra:'DELETE FROM knowledge_pages;\n'},
    {unexpected:'CREATE TABLE foreign_data(x text);\n'},
    {unexpected:"INSERT INTO \"knowledge_instance\" VALUES(1,'duplicate');\n"},
  ]){
    const f=await sample({dumpOptions:options});
    try{await expectRefused(verifyOrRestoreForwardD1Sql(f.params));}
    finally{await f.close();}
  }
});

test('rejects reusing a destination, relaxed source permissions and source symlinks',async()=>{
  const f=await sample();
  try{
    await expectRefused(verifyOrRestoreForwardD1Sql({...f.params,targetDir:f.folder}));
    await chmod(f.sourceFile,0o644);
    await expectRefused(verifyOrRestoreForwardD1Sql(f.params));
    await chmod(f.sourceFile,0o600);
    const link=join(f.folder,'link.sql');
    await symlink(f.sourceFile,link);
    await expectRefused(verifyOrRestoreForwardD1Sql({...f.params,sourceFile:link}));
  }finally{await f.close();}
});

test('oversized input and invalid UTF-8 refuse before decrypting or executing SQL',async()=>{
  const f=await sample();
  try{
    const file=await import('node:fs/promises');
    await file.truncate(f.sourceFile,MAX_SQL_EXPORT_BYTES+1);
    await expectRefused(verifyOrRestoreForwardD1Sql(f.params));
    const bad=Buffer.concat([Buffer.from(f.sql),Buffer.from([0xff,0xfe])]);
    await writeFile(f.sourceFile,bad,{mode:0o600});
    await expectRefused(verifyOrRestoreForwardD1Sql({...f.params,
      expectedSha256:checksum(bad)}));
  }finally{await f.close();}
});
