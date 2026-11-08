import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {searchFixture,syntheticPassphrase} from './support/forward-search-fixture.mjs';
import {
  FORWARD_INVENTORY_FORMAT,inventoryForwardCiphertextSqlite,
  assertForwardCiphertextInventory,
} from '../src/forward-ciphertext-inventory.mjs';
import {verifyOrRestoreForwardD1Sql} from '../src/forward-consistent-sql-restore.mjs';

const schema=readFileSync(new URL('../ops/private-forward/schema.sql',import.meta.url),'utf8');
const tables=['knowledge_instance','knowledge_pages','knowledge_revisions'];
const quote=x=>Number.isInteger(x)?String(x):"'"+String(x).replaceAll("'","''")+"'";
function sqlFromSource(database,{excludePathKey}={}){
  let sql='PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n'+schema+'\n';
  for(const table of tables){
    for(const row of database.prepare('SELECT * FROM '+table).iterate()){
      if(row.path_key===excludePathKey)continue;
      sql+='INSERT INTO "'+table+'" VALUES('+
        Object.values(row).map(quote).join(',')+');\n';
    }
  }
  return sql+'COMMIT;\n';
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function withSource(work,{pages=12,onDisk=false}={}){
  const dir=await mkdtemp(join(tmpdir(),'knowledge-parity-fictional-'));
  const f=await searchFixture({pages,path:onDisk?join(dir,'original.sqlite'):':memory:'});
  try{return await work({dir,f});}
  finally{f.close();await rm(dir,{recursive:true,force:true});}
}

test('local independent inventory has deterministic table-separated ciphertext fingerprints',async()=>{
  await withSource(async({f})=>{
    const inventory=inventoryForwardCiphertextSqlite(f.database);
    assert.equal(inventory.format,FORWARD_INVENTORY_FORMAT);
    assert.equal(inventory.tables.knowledge_instance.count,1);
    assert.equal(inventory.tables.knowledge_pages.count,12);
    assert.equal(inventory.tables.knowledge_revisions.count,12);
    assert.match(inventory.tables.knowledge_pages.sha256,/^[0-9a-f]{64}$/);
    assert.equal(assertForwardCiphertextInventory(f.database,inventory),true);
    assert.deepEqual(inventoryForwardCiphertextSqlite(f.database),inventory);
    const forged=structuredClone(inventory);
    forged.tables.knowledge_pages.sha256='0'.repeat(64);
    assert.throws(()=>assertForwardCiphertextInventory(f.database,forged),
      /KNOWLEDGE_SOURCE_INVENTORY_REFUSED/);
    const forgedCount=structuredClone(inventory);
    forgedCount.tables.knowledge_revisions.count--;
    assert.throws(()=>assertForwardCiphertextInventory(f.database,forgedCount),
      /KNOWLEDGE_SOURCE_INVENTORY_REFUSED/);
  });
});

test('omitting a whole valid page and all its revisions passes authentication but fails independent parity',async()=>{
  await withSource(async({dir,f})=>{
    const inventory=inventoryForwardCiphertextSqlite(f.database);
    const removed=f.database.prepare('SELECT path_key FROM knowledge_pages ORDER BY path_key LIMIT 1').get().path_key;
    const incomplete=sqlFromSource(f.database,{excludePathKey:removed});
    const sourceFile=join(dir,'missing.sql');
    await writeFile(sourceFile,incomplete,{mode:0o600});
    const input={
      sourceFile,expectedSha256:sha(incomplete),
      kit:f.kit,passphrase:syntheticPassphrase,
    };
    const withoutWitness=await verifyOrRestoreForwardD1Sql(input);
    assert.equal(withoutWitness.counts.pages,11);
    assert.equal(withoutWitness.sourceParity,'NOT_CHECKED');
    await assert.rejects(
      verifyOrRestoreForwardD1Sql({
        ...input,expectedInventory:inventory,targetDir:join(dir,'refused-restore'),
      }),/KNOWLEDGE_SQL_RECOVERY_REFUSED/
    );
    await assert.rejects(stat(join(dir,'refused-restore')));
    assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,12);
  });
});

test('a real sqlite3 .dump generated independently by Python restores exact fictional ciphertext',async()=>{
  await withSource(async({dir,f})=>{
    const witness=inventoryForwardCiphertextSqlite(f.database);
    const source=join(dir,'original.sqlite');
    await chmod(source,0o600);
    // This invokes the standard SQLite dump writer in a second process.
    // It is NOT a Cloudflare provider export and uses only fictional ciphertext.
    const output=join(dir,'sqlite-standard.sql');
    const code=[
      'import sqlite3, sys, os',
      'db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)',
      'fd=os.open(sys.argv[2],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)',
      'with os.fdopen(fd,"w",encoding="utf-8",newline="\\n") as dst:',
      '  for statement in db.iterdump():',
      '    dst.write(statement+"\\n")',
      'db.close()',
    ].join('\n');
    const processResult=spawnSync('python3',['-c',code,source,output],
      {encoding:'utf8',timeout:30_000});
    assert.equal(processResult.status,0,'fictional sqlite3 .dump must succeed');
    assert.equal(processResult.signal,null);
    const exported=await readFile(output);
    const result=await verifyOrRestoreForwardD1Sql({
      sourceFile:output,expectedSha256:sha(exported),
      kit:f.kit,passphrase:syntheticPassphrase,
      expectedInventory:witness,targetDir:join(dir,'verified-restore'),
    });
    assert.equal(result.sourceParity,'MATCHED');
    assert.equal(result.restored,true);
    assert.deepEqual(result.counts,{pages:12,revisions:12,instances:1});
    const recovered=new DatabaseSync(result.sqliteFile,{readOnly:true});
    try{
      assert.equal(assertForwardCiphertextInventory(recovered,witness),true);
      for(const table of tables){
        const original=f.database.prepare('SELECT * FROM '+table+' ORDER BY 1').all();
        const restored=recovered.prepare('SELECT * FROM '+table+' ORDER BY 1').all();
        assert.deepEqual(restored,original);
      }
    }finally{recovered.close();}
  },{onDisk:true});
});

test('owner CLI creates a private, exclusive inventory witness from a frozen fictional SQLite source',async()=>{
  await withSource(async({dir,f})=>{
    const source=join(dir,'original.sqlite'),dest=join(dir,'source-inventory.json');
    await chmod(source,0o600);
    const run=()=>spawnSync(process.execPath,[
      'ops/private-forward/sql-inventory-cli.mjs',source,dest,
    ],{encoding:'utf8',timeout:30_000});
    const first=run();
    assert.equal(first.status,0,'source inventory CLI must succeed on owner-private fictional input');
    assert.deepEqual(JSON.parse(await readFile(dest,'utf8')),
      inventoryForwardCiphertextSqlite(f.database));
    assert.equal((await stat(dest)).mode&0o777,0o600);
    const repeated=run();
    assert.notEqual(repeated.status,0,'inventory file must not be overwritten');
    assert.ok(!first.stdout.includes('Synthetic photon'));
  },{onDisk:true});
});

test('wrong inventory metadata and malformed digest never signal source parity',async()=>{
  await withSource(async({dir,f})=>{
    const inventory=inventoryForwardCiphertextSqlite(f.database);
    const sql=sqlFromSource(f.database);
    const sourceFile=join(dir,'valid.sql');
    await writeFile(sourceFile,sql,{mode:0o600});
    for(const malformed of [
      {...inventory,format:'unknown'},
      {...inventory,tables:{...inventory.tables,extra:{count:0,sha256:'0'.repeat(64)}}},
      {...inventory,tables:{...inventory.tables,knowledge_pages:{
        count:12,sha256:'not-a-digest'}}},
    ]){
      await assert.rejects(verifyOrRestoreForwardD1Sql({
        sourceFile,expectedSha256:sha(sql),kit:f.kit,
        passphrase:syntheticPassphrase,expectedInventory:malformed,
      }),/KNOWLEDGE_SQL_RECOVERY_REFUSED/);
    }
  });
});
