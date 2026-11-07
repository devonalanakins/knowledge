import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectNotionExport } from '../src/notion-export.mjs';
import { decryptSnapshot } from '../src/backup.mjs';

const ID1='1234567890abcdef1234567890abcdef';
const ID2='abcdef1234567890abcdef1234567890';
const ID3='fedcba0987654321fedcba0987654321';
const SECRET='synthetic private company fact';
const script=fileURLToPath(new URL('../src/notion-export.mjs',import.meta.url));
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'knowledge-notion-fixture-'));
 await mkdir(join(dir,'Personal '+ID1));
 await writeFile(join(dir,'Personal '+ID1,'Overview '+ID2+'.md'),`# Overview\n\n${SECRET}\n\n[Reference](../Project%20${ID3}.md)\n`);
 await writeFile(join(dir,'Project '+ID3+'.md'),'# Project\n\n[External](https://www.notion.so/1234567890abcdef1234567890abcdef)');
 await writeFile(join(dir,'Table '+ID1+'.csv'),'Name,Notes\n"First","This\nspans rows"\nSecond,Value\n');
 await writeFile(join(dir,'image.png'),Buffer.from([0x89,0x50,0x4e,0x47,0x00,0x01]));
 await writeFile(join(dir,'index.html'),'<html><body><a href="overview.html">Sitemap</a></body></html>');
 return dir;
}

test('inspect extracted workspace, fingerprint all bytes, count CSV quoted newlines, and preserve parent IDs',async()=>{
 const dir=await fixture();const report=await inspectNotionExport(dir);
 assert.equal(report.format,'knowledge-notion-preflight-v1');
 assert.equal(report.summary.inspectedFiles,5);
 assert.deepEqual(report.summary.byType,{markdown:2,database_csv:1,html:0,asset:1,sitemap:1});
 assert.equal(report.summary.databaseCsvRows,2);
 assert.equal(report.summary.missingLocalLinks,0);
 assert.equal(report.summary.unresolvedRemoteNotionLinks,1);
 assert.equal(report.summary.imported,false);
 assert.equal(report.summary.workspaceCoverageVerified,false);
 const entry=report.entries.find(e=>e.relativePath.includes('Overview'));
 assert.equal(entry.parentNotionId,ID1);
 assert.equal(entry.originalNotionId,ID2);
 assert.equal(entry.linkCount,1);
 assert.equal(entry.sha256.length,64);
 assert.equal(JSON.stringify(report).includes(SECRET),false);
 assert.equal(report.summary.warnings.DUPLICATE_NOTION_ID,undefined); // the parent directory and CSV have different entity types
});

test('broken, malformed and remote links are reported, never declared resolved',async()=>{
 const dir=await fixture();
 await writeFile(join(dir,'broken '+ID3+'.md'),'[Missing](secret.md) [Wrong](%zz.md) [Remote](https://notion.so/some-page)');
 const result=await inspectNotionExport(dir);
 assert.equal(result.summary.missingLocalLinks,2);
 assert.equal(result.summary.unresolvedRemoteNotionLinks,2);
 assert.equal(result.summary.warnings.BROKEN_LOCAL_LINK,1);
 assert.equal(result.summary.warnings.UNVERIFIED_LINK,1);
 assert.equal(result.summary.fullFidelityCertified,false);
});

test('export inspector refuses symlinks, size overflow and entry overflow',async()=>{
 const dir=await fixture();
 await assert.rejects(()=>inspectNotionExport(dir,{maxEntries:3}),{code:'TOO_MANY_FILES'});
 await assert.rejects(()=>inspectNotionExport(dir,{maxTotalBytes:10}),{code:'TOO_LARGE'});
 await symlink(join(dir,'image.png'),join(dir,'escape-link.png'));
 await assert.rejects(()=>inspectNotionExport(dir),{code:'UNSAFE_EXPORT'});
 await assert.rejects(()=>inspectNotionExport(join(dir,'escape-link.png')),{code:'INVALID_ROOT'});
});

test('unsafely encoded markdown link and failed CSV parsing are explicit warnings',async()=>{
 const dir=await fixture();
 await writeFile(join(dir,'Unverified '+ID3+'.csv'),'Title,Body\n"Incomplete,field\n');
 const report=await inspectNotionExport(dir);
 assert.equal(report.summary.warnings.UNVERIFIED_CSV,1);
 assert.equal(report.entries.find(x=>x.relativePath.includes('Unverified')).csvRows,null);
});

test('optional manifest is AES-GCM encrypted and not printed or overwritten',async()=>{
 const dir=await fixture();const out=join(await mkdtemp(join(tmpdir(),'knowledge-manifest-')),'report.enc');
 const env={...process.env,KNOWLEDGE_BACKUP_PASSPHRASE:'synthetic integration passphrase with entropy 9999'};
 const invocation=()=>spawnSync(process.execPath,[script,dir,out],{env,encoding:'utf8'});
 const first=invocation();
 assert.equal(first.status,0,'the known-good fixture has no missing link warnings');
 assert.equal(first.stdout.includes(SECRET),false);
 const encrypted=await readFile(out,'utf8');
 assert.equal(encrypted.includes(SECRET),false);
 assert.equal((await stat(out)).mode & 0o777,0o600);
 const manifest=decryptSnapshot(JSON.parse(encrypted),env.KNOWLEDGE_BACKUP_PASSPHRASE);
 assert.equal(manifest.summary.inspectedFiles,5);
 const again=invocation();assert.equal(again.status,1,'never overwrite an existing archive');
 const files=await readdir(dir);assert.equal(files.length,5,'inspection did not change source directory');
});

test('duplicate original Notion IDs trigger manual review instead of silent merges',async()=>{
 const dir=await fixture();
 await writeFile(join(dir,'Duplicate '+ID2+'.md'),'# deliberately same export identity');
 const report=await inspectNotionExport(dir);
 assert.equal(report.summary.warnings.DUPLICATE_NOTION_ID,2);
 assert.equal(report.summary.fullFidelityCertified,false);
});
