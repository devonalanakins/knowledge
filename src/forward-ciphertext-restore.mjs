/**
 * Offline, owner-controlled verification and restore of a forward Knowledge
 * ciphertext-only D1 export. Never uploads data or prints decrypted records.
 *
 * Import/export is intentionally separate from the live Worker. This module
 * reads the existing v1 row snapshot and never changes a Cloudflare resource.
 */
import {createHash, webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,chmod,readFile,lstat,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {unlockEncryptedKeyRecovery} from './forward-key-recovery.mjs';

export const FORWARD_CIPHERTEXT_FORMAT='knowledge-forward-ciphertext-backup-v1';
export const MAX_FORWARD_SNAPSHOT_BYTES=32*1024*1024;
const SPACE=/^[a-z][a-z0-9-]{0,63}$/;
const KEY_ID=/^[a-z0-9-]{1,32}$/;
const KEY=/^[A-Za-z0-9_-]{43}$/;
const PART=/^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH=/^[0-9a-f]{64}$/;
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const names=['knowledge_instance','knowledge_pages','knowledge_revisions'];
const schema=readFileSync(new URL('../ops/private-forward/schema.sql',import.meta.url),'utf8');
const fail=()=>new Error('Knowledge ciphertext recovery refused: invalid, incomplete, or unauthenticated snapshot');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const validTime=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString()===x;
const goodPath=x=>typeof x==='string'&&x.length>0&&x.length<=240&&x.split('/').length<=8&&x.split('/').every(y=>PART.test(y));
const version=x=>Number.isInteger(x)&&x>=1&&x<=128;
const bytes64=(s,max)=>{
  if(typeof s!=='string'||s.length===0||s.length>max||!/^[A-Za-z0-9_-]+$/.test(s))throw fail();
  const b=Buffer.from(s,'base64url');
  if(b.toString('base64url')!==s)throw fail();
  return b;
};
const sealedRecord=(json,keyId)=>{
  if(typeof json!=='string'||json.length>32000)throw fail();
  let data;
  try{data=JSON.parse(json);}catch{throw fail();}
  if(!exact(data,['format','keyId','nonce','data'])||data.format!=='knowledge-sealed-v1'||data.keyId!==keyId)throw fail();
  if(bytes64(data.nonce,24).length!==12||bytes64(data.data,31000).length<17)throw fail();
  return data;
};
/** Pure, bounded structural verification. Does not require or expose a key. */
export function parseForwardCiphertextSnapshot(input,{expectedSha256}={}){
  if(!(input instanceof Uint8Array)&&typeof input!=='string')throw fail();
  const bytes=typeof input==='string'?Buffer.from(input,'utf8'):Buffer.from(input);
  if(bytes.length===0||bytes.length>MAX_FORWARD_SNAPSHOT_BYTES)throw fail();
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if(expectedSha256!==undefined&&(!HASH.test(expectedSha256)||expectedSha256!==sha256))throw fail();
  let snapshot;
  try{snapshot=JSON.parse(decoder.decode(bytes));}catch{throw fail();}
  if(!exact(snapshot,['format','scope','keyId','schemaVersion','status','tables'])||
     snapshot.format!==FORWARD_CIPHERTEXT_FORMAT||!SPACE.test(snapshot.scope)||
     !KEY_ID.test(snapshot.keyId)||snapshot.schemaVersion!==1||
     typeof snapshot.status!=='string'||snapshot.status.length>100||
     !exact(snapshot.tables,names))throw fail();
  const tables=snapshot.tables;
  if(names.some(n=>!Array.isArray(tables[n]))||tables.knowledge_instance.length>1||
     tables.knowledge_pages.length>500||tables.knowledge_revisions.length>64000||
     tables.knowledge_revisions.length<tables.knowledge_pages.length)throw fail();
  if(tables.knowledge_pages.length&&tables.knowledge_instance.length!==1)throw fail();
  for(const m of tables.knowledge_instance){
    if(!exact(m,['id','key_check'])||m.id!==1||!KEY.test(m.key_check))throw fail();
  }
  const pages=new Map(),revisions=new Map();
  for(const row of tables.knowledge_pages){
    if(!exact(row,['path_key','version','sealed','updated_at'])||!KEY.test(row.path_key)||
       !version(row.version)||!validTime(row.updated_at)||pages.has(row.path_key))throw fail();
    sealedRecord(row.sealed,snapshot.keyId);
    pages.set(row.path_key,row);
  }
  for(const row of tables.knowledge_revisions){
    if(!exact(row,['path_key','version','sealed','created_at'])||!KEY.test(row.path_key)||
       !pages.has(row.path_key)||!version(row.version)||!validTime(row.created_at))throw fail();
    sealedRecord(row.sealed,snapshot.keyId);
    const byPath=revisions.get(row.path_key)||new Map();
    if(byPath.has(row.version))throw fail();
    byPath.set(row.version,row);
    revisions.set(row.path_key,byPath);
  }
  for(const [key,page] of pages){
    const revs=revisions.get(key);
    if(!revs||revs.size!==page.version)throw fail();
    for(let v=1;v<=page.version;v++)if(!revs.has(v))throw fail();
    const last=revs.get(page.version);
    if(last.sealed!==page.sealed||last.created_at!==page.updated_at)throw fail();
  }
  if(tables.knowledge_revisions.length!==[...pages.values()].reduce((n,p)=>n+p.version,0))throw fail();
  return {snapshot,sha256,bytes:bytes.length};
}

async function derive(rootKeyHex){
  const raw=Buffer.from(rootKeyHex,'hex');
  try{
    const hk=await webcrypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
    const context={name:'HKDF',hash:'SHA-256',salt:encoder.encode('Knowledge forward-only v1')};
    const aes=await webcrypto.subtle.deriveKey({...context,info:encoder.encode('content-encryption')},hk,{name:'AES-GCM',length:256},false,['decrypt']);
    const mac=await webcrypto.subtle.deriveKey({...context,info:encoder.encode('path-indexing')},hk,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
    return {aes,mac};
  }finally{raw.fill(0);}
}
async function hmac(mac,value){
  return Buffer.from(await webcrypto.subtle.sign('HMAC',mac,encoder.encode(value))).toString('base64url');
}
async function decryptRecord(keys,space,row,keyId){
  const seal=sealedRecord(row.sealed,keyId);
  const aad=encoder.encode('knowledge-record-v1\0'+space+'\0'+row.path_key+'\0'+row.version);
  let page;
  try{
    const buffer=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:bytes64(seal.nonce,24),additionalData:aad},keys.aes,bytes64(seal.data,31000));
    page=JSON.parse(decoder.decode(buffer));
  }catch{throw fail();}
  if(!exact(page,['path','title','body','status','sourceUrl','version','updatedAt'])||
     !goodPath(page.path)||typeof page.title!=='string'||page.title.trim()!==page.title||
     page.title.length<1||page.title.length>160||typeof page.body!=='string'||
     Buffer.byteLength(page.body,'utf8')>16384||page.status!=='draft'||
     (page.sourceUrl!==null&&(typeof page.sourceUrl!=='string'||!page.sourceUrl.startsWith('https://')))||
     page.version!==row.version||!validTime(page.updatedAt)||
     page.updatedAt!==(row.updated_at??row.created_at))throw fail();
  const pathKey=await hmac(keys.mac,'path-v1\0'+space+'\0'+page.path);
  if(pathKey!==row.path_key)throw fail();
  return page;
}
/** Prove every ciphertext revision decrypts with the actual owner-held root key. */
export async function verifyForwardCiphertextSnapshot(input,{kit,passphrase,expectedSha256}={}){
  const parsed=parseForwardCiphertextSnapshot(input,{expectedSha256});
  const {snapshot}=parsed;
  const result=unlockEncryptedKeyRecovery(kit,passphrase);
  if(result.scope!==snapshot.scope||result.keyId!==snapshot.keyId)throw fail();
  const keys=await derive(result.rootKeyHex);
  const marker=await hmac(keys.mac,'knowledge-instance-v1\0'+snapshot.scope+'\0'+snapshot.keyId);
  if(snapshot.tables.knowledge_instance.length&&snapshot.tables.knowledge_instance[0].key_check!==marker)throw fail();
  const pages=new Map(),histories=new Map();
  for(const row of snapshot.tables.knowledge_revisions){
    const page=await decryptRecord(keys,snapshot.scope,row,snapshot.keyId);
    const history=histories.get(row.path_key)||new Map();
    history.set(row.version,page);
    histories.set(row.path_key,history);
  }
  for(const row of snapshot.tables.knowledge_pages){
    const page=await decryptRecord(keys,snapshot.scope,row,snapshot.keyId);
    if(pages.has(page.path))throw fail();
    pages.set(page.path,page);
    if(JSON.stringify(histories.get(row.path_key)?.get(row.version))!==JSON.stringify(page))throw fail();
  }
  return {verified:true,sha256:parsed.sha256,bytes:parsed.bytes,scope:snapshot.scope,
    keyId:snapshot.keyId,fingerprint:result.fingerprint,
    counts:{pages:pages.size,revisions:snapshot.tables.knowledge_revisions.length,instances:snapshot.tables.knowledge_instance.length}};
}

/** Restore only to a newly created private directory. Never clobber an existing database. */
export async function restoreForwardCiphertextSnapshot(input,{kit,passphrase,expectedSha256,targetDir}={}){
  const verified=await verifyForwardCiphertextSnapshot(input,{kit,passphrase,expectedSha256});
  if(typeof targetDir!=='string'||!targetDir.trim()||targetDir.includes('\0'))throw fail();
  const destination=resolve(targetDir);
  const parent=dirname(destination);
  const info=await lstat(parent);
  if(!info.isDirectory()||info.isSymbolicLink())throw fail();
  const tables=parseForwardCiphertextSnapshot(input,{expectedSha256}).snapshot.tables;
  await mkdir(destination,{mode:0o700}); // atomic refusal if destination already exists
  let db;
  try{
    db=new DatabaseSync(join(destination,'knowledge-restore.sqlite'));
    db.exec('PRAGMA foreign_keys=ON;');
    db.exec(schema);
    db.exec('BEGIN IMMEDIATE;');
    try{
      const instance=db.prepare('INSERT INTO knowledge_instance(id,key_check) VALUES (?,?)');
      const page=db.prepare('INSERT INTO knowledge_pages(path_key,version,sealed,updated_at) VALUES (?,?,?,?)');
      const revision=db.prepare('INSERT INTO knowledge_revisions(path_key,version,sealed,created_at) VALUES (?,?,?,?)');
      for(const r of tables.knowledge_instance)instance.run(r.id,r.key_check);
      for(const r of tables.knowledge_pages)page.run(r.path_key,r.version,r.sealed,r.updated_at);
      for(const r of tables.knowledge_revisions)revision.run(r.path_key,r.version,r.sealed,r.created_at);
      db.exec('COMMIT;');
    }catch(e){db.exec('ROLLBACK;');throw e;}
    for(const name of names){
      const rows=db.prepare('SELECT * FROM '+name+(name==='knowledge_revisions'?' ORDER BY path_key,version':' ORDER BY '+(name==='knowledge_pages'?'path_key':'id'))).all();
      const expected=[...tables[name]].sort((a,b)=>
        name==='knowledge_instance'?a.id-b.id:
        name==='knowledge_pages'?a.path_key.localeCompare(b.path_key):
        a.path_key.localeCompare(b.path_key)||a.version-b.version);
      if(JSON.stringify(rows)!==JSON.stringify(expected))throw fail();
    }
    if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||
       db.prepare('PRAGMA foreign_key_check').all().length)throw fail();
    db.close();db=null;
    if(process.platform!=='win32')await chmod(join(destination,'knowledge-restore.sqlite'),0o600);
    return {...verified,restored:true,sqliteFile:join(destination,'knowledge-restore.sqlite')};
  }catch(e){
    try{db?.close();}catch{}
    await rm(destination,{recursive:true,force:true});
    throw e;
  }
}

/** Bound read and reject symlinks before parsing an owner-downloaded ciphertext file. */
export async function readLocalCiphertextSnapshot(filePath){
  if(typeof filePath!=='string'||!filePath||filePath.includes('\0'))throw fail();
  const info=await lstat(filePath);
  if(!info.isFile()||info.isSymbolicLink()||info.size===0||info.size>MAX_FORWARD_SNAPSHOT_BYTES)throw fail();
  return readFile(filePath);
}
