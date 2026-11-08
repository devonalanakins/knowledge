import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {searchFixture,syntheticPassphrase} from './support/forward-search-fixture.mjs';
import {inventoryForwardCiphertextSqlite,assertForwardCiphertextInventory}
  from '../src/forward-ciphertext-inventory.mjs';
import {verifyOrRestoreForwardD1Sql} from '../src/forward-consistent-sql-restore.mjs';
import {sealForwardOffsiteSql,openForwardOffsiteSql,FORWARD_OFFSITE_FORMAT}
  from '../src/forward-offsite-sql-vault.mjs';

const vaultPassphrase='fictional-offsite-vault-passphrase-separate-from-owner-kit';
const wrongPassphrase='fictional-incorrect-offsite-vault-passphrase';
const sha=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>Number.isInteger(x)?String(x):"'"+String(x).replaceAll("'","''")+"'";
const tables=['knowledge_instance','knowledge_pages','knowledge_revisions'];
const schema=readFileSync(new URL('../ops/private-forward/schema.sql',import.meta.url),'utf8');
function dump(db){
  let sql='PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n'+schema+'\n';
  for(const table of tables){
    for(const row of db.prepare('SELECT * FROM '+table+' ORDER BY 1').iterate()){
      sql+='INSERT INTO "'+table+'" VALUES('+Object.values(row).map(quote).join(',')+');\n';
    }
  }
  return sql+'COMMIT;\n';
}
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'knowledge-offsite-fictional-'));
  const f=await searchFixture({pages:14});
  const sql=dump(f.database);
  const sourceFile=join(dir,'fictional.sql');
  await writeFile(sourceFile,sql,{mode:0o600});
  return {dir,f,sql,sourceFile,expectedSha256:sha(sql),
    vaultFile:join(dir,'offsite.vault'),
    async close(){f.close();await rm(dir,{recursive:true,force:true});}};
}
async function refuse(p){
  await assert.rejects(p,e=>e?.message==='KNOWLEDGE_OFFSITE_SQL_REFUSED');
}

test('offsite vault encrypts fictional D1 SQL and fully recovers owner-authenticated history and independent parity',async()=>{
  const x=await fixture();
  try{
    const witness=inventoryForwardCiphertextSqlite(x.f.database);
    const sealed=await sealForwardOffsiteSql({
      sourceFile:x.sourceFile,targetFile:x.vaultFile,
      expectedSha256:x.expectedSha256,passphrase:vaultPassphrase,
    });
    assert.equal(sealed.format,FORWARD_OFFSITE_FORMAT);
    assert.equal(sealed.sha256,x.expectedSha256);
    assert.equal(sealed.bytes,Buffer.byteLength(x.sql));
    assert.equal((await stat(x.vaultFile)).mode&0o777,0o600);
    const ciphertext=await readFile(x.vaultFile);
    assert.ok(!ciphertext.includes(Buffer.from('Fictional indexed document')));
    assert.ok(!ciphertext.includes(Buffer.from('CREATE TABLE IF NOT EXISTS')));
    const verified=await openForwardOffsiteSql({
      archiveFile:x.vaultFile,expectedSha256:x.expectedSha256,
      passphrase:vaultPassphrase,
    });
    assert.equal(verified.verified,true);
    assert.equal(verified.recovered,false);
    const sqlFile=join(x.dir,'verified.sql');
    const recovered=await openForwardOffsiteSql({
      archiveFile:x.vaultFile,targetFile:sqlFile,
      expectedSha256:x.expectedSha256,passphrase:vaultPassphrase,
    });
    assert.equal(recovered.recovered,true);
    assert.equal((await stat(sqlFile)).mode&0o777,0o600);
    assert.deepEqual(await readFile(sqlFile),Buffer.from(x.sql));
    const restored=await verifyOrRestoreForwardD1Sql({
      sourceFile:sqlFile,expectedSha256:x.expectedSha256,
      kit:x.f.kit,passphrase:syntheticPassphrase,
      expectedInventory:witness,targetDir:join(x.dir,'restored'),
    });
    assert.equal(restored.sourceParity,'MATCHED');
    assert.deepEqual(restored.counts,{pages:14,revisions:14,instances:1});
    const db=new DatabaseSync(restored.sqliteFile,{readOnly:true});
    try{assert.equal(assertForwardCiphertextInventory(db,witness),true);}
    finally{db.close();}
  }finally{await x.close();}
});

test('wrong offsite passphrase, external checksum and tampered ciphertext/tag refuse without creating SQL',async()=>{
  const x=await fixture();
  try{
    await sealForwardOffsiteSql({
      sourceFile:x.sourceFile,targetFile:x.vaultFile,
      expectedSha256:x.expectedSha256,passphrase:vaultPassphrase,
    });
    await refuse(openForwardOffsiteSql({
      archiveFile:x.vaultFile,targetFile:join(x.dir,'wrong-key.sql'),
      expectedSha256:x.expectedSha256,passphrase:wrongPassphrase,
    }));
    await assert.rejects(stat(join(x.dir,'wrong-key.sql')));
    await refuse(openForwardOffsiteSql({
      archiveFile:x.vaultFile,targetFile:join(x.dir,'wrong-receipt.sql'),
      expectedSha256:'0'.repeat(64),passphrase:vaultPassphrase,
    }));
    await assert.rejects(stat(join(x.dir,'wrong-receipt.sql')));
    const original=await readFile(x.vaultFile);
    for(const offset of [0,Math.floor(original.length/2),original.length-1]){
      const changed=Buffer.from(original);
      changed[offset]^=1;
      await writeFile(x.vaultFile,changed,{mode:0o600});
      await refuse(openForwardOffsiteSql({
        archiveFile:x.vaultFile,targetFile:join(x.dir,'tampered.sql'),
        expectedSha256:x.expectedSha256,passphrase:vaultPassphrase,
      }));
      await assert.rejects(stat(join(x.dir,'tampered.sql')));
    }
    await writeFile(x.vaultFile,original.subarray(0,original.length-7),{mode:0o600});
    await refuse(openForwardOffsiteSql({
      archiveFile:x.vaultFile,expectedSha256:x.expectedSha256,
      passphrase:vaultPassphrase,
    }));
    await writeFile(x.vaultFile,original,{mode:0o600});
    assert.equal((await openForwardOffsiteSql({
      archiveFile:x.vaultFile,expectedSha256:x.expectedSha256,
      passphrase:vaultPassphrase,
    })).verified,true);
  }finally{await x.close();}
});

test('seal refuses wrong source receipt and cannot overwrite existing archive',async()=>{
  const x=await fixture();
  try{
    await refuse(sealForwardOffsiteSql({
      sourceFile:x.sourceFile,targetFile:x.vaultFile,
      expectedSha256:'0'.repeat(64),passphrase:vaultPassphrase,
    }));
    await assert.rejects(stat(x.vaultFile));
    const first=await sealForwardOffsiteSql({
      sourceFile:x.sourceFile,targetFile:x.vaultFile,
      expectedSha256:x.expectedSha256,passphrase:vaultPassphrase,
    });
    const untouched=await readFile(x.vaultFile);
    await refuse(sealForwardOffsiteSql({
      sourceFile:x.sourceFile,targetFile:x.vaultFile,
      expectedSha256:x.expectedSha256,passphrase:vaultPassphrase,
    }));
    assert.deepEqual(await readFile(x.vaultFile),untouched);
    assert.equal(first.sealed,true);
    const outputFile=join(x.dir,'already-exists.sql');
    await writeFile(outputFile,'do-not-overwrite',{mode:0o600});
    await refuse(openForwardOffsiteSql({
      archiveFile:x.vaultFile,targetFile:outputFile,
      expectedSha256:x.expectedSha256,passphrase:vaultPassphrase,
    }));
    assert.equal(await readFile(outputFile,'utf8'),'do-not-overwrite');
  }finally{await x.close();}
});

test('rejects insecure file permissions and inadequate or empty passphrases',async()=>{
  const x=await fixture();
  try{
    await chmod(x.sourceFile,0o644);
    await refuse(sealForwardOffsiteSql({
      sourceFile:x.sourceFile,targetFile:x.vaultFile,
      expectedSha256:x.expectedSha256,passphrase:vaultPassphrase,
    }));
    await chmod(x.sourceFile,0o600);
    await refuse(sealForwardOffsiteSql({
      sourceFile:x.sourceFile,targetFile:x.vaultFile,
      expectedSha256:x.expectedSha256,passphrase:'short',
    }));
    await assert.rejects(stat(x.vaultFile));
  }finally{await x.close();}
});

test('streaming vault roundtrips SQL-sized fictional bytes beyond the legacy 25 MB JSON envelope',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'knowledge-offsite-large-'));
  try{
    const large=Buffer.alloc(26*1024*1024,0x51);
    const sourceFile=join(dir,'large-fictional.sql'),vaultFile=join(dir,'large.vault');
    await writeFile(sourceFile,large,{mode:0o600});
    const expectedSha256=sha(large);
    const result=await sealForwardOffsiteSql({
      sourceFile,targetFile:vaultFile,expectedSha256,passphrase:vaultPassphrase,
    });
    assert.equal(result.bytes,large.length);
    const verified=await openForwardOffsiteSql({
      archiveFile:vaultFile,expectedSha256,passphrase:vaultPassphrase,
    });
    assert.equal(verified.bytes,large.length);
    assert.equal(verified.verified,true);
    assert.ok((await stat(vaultFile)).size>large.length);
  }finally{await rm(dir,{recursive:true,force:true});}
});
