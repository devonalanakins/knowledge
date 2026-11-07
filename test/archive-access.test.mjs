import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveAccessError, hashArchiveCredential, SyntheticArchiveAccessGate, createProtectedLocalAudit } from '../src/archive-access.mjs';

const A='a'.repeat(32),B='b'.repeat(32);
const textA='# SYNTHETIC FIXTURE\nPrivate example A.';
const textB='# SYNTHETIC FIXTURE\nSeparate example B.';
const sha=x=>createHash('sha256').update(x).digest('hex');
const tokenA=randomBytes(40).toString('hex'),tokenB=randomBytes(40).toString('hex');
const key='synthetic independent encryption passphrase 1234567890';
const auditKey=randomBytes(32);
const root='/private/synthetic';
const sources=[{originalNotionId:A,scope:'devonstation',sha256:sha(textA),file:`${root}/${A}.source.enc`},{originalNotionId:B,scope:'family',sha256:sha(textB),file:`${root}/${B}.source.enc`}];
const principals=[{id:'devon',tokenHash:hashArchiveCredential(tokenA),scopes:['devonstation'],expiresAt:5000000},{id:'family',tokenHash:hashArchiveCredential(tokenB),scopes:['family'],expiresAt:5000000}];
const original=({expectedNotionId,expectedScope,expectedSha256})=>{
  const text=expectedNotionId===A?textA:textB;
  return {originalNotionId:expectedNotionId,scope:expectedScope,sha256:expectedSha256,bytes:Buffer.byteLength(text),text};
};
const create=(overrides={})=>{
 const events=[];let reads=0;
 const instance=new SyntheticArchiveAccessGate({sources,principals,passphrase:key,auditKey,now:()=>1000,
  reader:async arg=>{reads++;return original(arg)},audit:async event=>{events.push(event)},...overrides});
 return {instance,events,getReads:()=>reads};
};
const request=(token=tokenA,id=A,scope='devonstation')=>({bearerToken:token,originalNotionId:id,scope});

test('G8 authorizes by trusted source registry, principal grant and SHA-256, never request paths',async()=>{
 const {instance,events,getReads}=create();
 const result=await instance.read({...request(),file:'/tmp/alternate',sha256:'f'.repeat(64),passphrase:'incorrect'});
 assert.equal(result.text,textA);assert.equal(result.sha256,sha(textA));assert.equal(getReads(),1);
 assert.deepEqual(events.map(x=>x.outcome),['authorized','delivered']);
 assert.equal(JSON.stringify(events).includes(textA),false);
 assert.equal(JSON.stringify(events).includes(tokenA),false);
 assert.equal(JSON.stringify(events).includes(root),false);
});

test('G8 unknown token, wrong scope, wrong ID, expired and revoked grants cannot decrypt',async()=>{
 const {instance,getReads,events}=create();
 for(const input of [request('x'.repeat(40)),request(tokenA,B,'family'),request(tokenA,B,'devonstation'),request(tokenB,A),request(tokenA,'not-an-id')]){
  await assert.rejects(()=>instance.read(input),{code:'ACCESS_DENIED'});
 }
 instance.revokePrincipal('devon');
 await assert.rejects(()=>instance.read(request()),{code:'ACCESS_DENIED'});
 assert.equal(getReads(),0);
 assert.equal(events.every(x=>x.outcome==='denied'),true);
 const {instance:expired}=create({now:()=>5000000});
 await assert.rejects(()=>expired.read(request()),{code:'ACCESS_DENIED'});
});

test('G8 absent audit or audit failure blocks access, and no original is read',async()=>{
 assert.throws(()=>new SyntheticArchiveAccessGate({sources,principals,passphrase:key,reader:original}),{code:'INVALID_CONFIG'});
 let readCount=0;
 const {instance}=create({audit:async()=>{throw new Error('Disk full')},reader:async()=>{readCount++;return original({expectedNotionId:A,expectedScope:'devonstation',expectedSha256:sha(textA)})}});
 await assert.rejects(()=>instance.read(request()),{code:'AUDIT_UNAVAILABLE'});
 assert.equal(readCount,0);
});

test('G8 mismatched decrypted source body, wrong hash, or reader failure cannot escape',async()=>{
 for(const reader of [
  async()=>({...original({expectedNotionId:A,expectedScope:'devonstation',expectedSha256:sha(textA)}),text:'wrong text'}),
  async()=>{throw new Error('Secret access path /private/token')},
 ]){
  const {instance,events}=create({reader});
  await assert.rejects(()=>instance.read(request()),{code:'SOURCE_UNAVAILABLE'});
  assert.deepEqual(events.map(x=>x.outcome),['authorized','source_failed']);
 }
});

test('G8 final audit must succeed before decrypted plaintext is returned',async()=>{
 let delivered=0;
 const {instance}=create({audit:async(event)=>{if(event.outcome==='delivered'){delivered++;throw new Error('Failed append')} }});
 await assert.rejects(()=>instance.read(request()),{code:'AUDIT_UNAVAILABLE'});
 assert.equal(delivered,1);
});

test('G8 rejects malformed, duplicated or ambiguous grant configurations',()=>{
 for(const invalid of [
  {sources:[...sources,sources[0]]},
  {sources:[{...sources[0],file:'/tmp/other.enc'}]},
  {principals:[...principals,{...principals[0],id:'someone'}]},
  {principals:[{...principals[0],scopes:['cristy/wrong']}]},
  {principals:[{...principals[0],expiresAt:NaN}]},
 ]) assert.throws(()=>create(invalid),{code:'INVALID_CONFIG'});
 assert.throws(()=>hashArchiveCredential('short'),{code:'INVALID_CREDENTIAL'});
});

test('G8 local audit sink stores bounded pseudonymous events with 0600 permissions',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'knowledge-g8-'));
 const filename=join(directory,'access.jsonl');
 const sink=await createProtectedLocalAudit(filename,{maxBytes:850});
 try{
  const {instance}=create({audit:sink.write});
  await instance.read(request());
  await assert.rejects(()=>instance.read(request('x'.repeat(40))),{code:'ACCESS_DENIED'});
 }finally{await sink.close();}
 const content=await readFile(filename,'utf8');
 assert.equal((await stat(filename)).mode & 0o777,0o600);
 assert.equal(content.includes(textA),false);
 assert.equal(content.includes(tokenA),false);
 assert.equal(content.includes(A),false);
 assert.deepEqual(content.trim().split('\n').map(x=>JSON.parse(x).outcome),['authorized','delivered','denied']);
});

test('G8 full audit buffer refuses later reads without delivering source material',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'knowledge-g8-'));
 const filename=join(directory,'full.jsonl');
 const sink=await createProtectedLocalAudit(filename,{maxBytes:230});
 try{
  const {instance}=create({audit:sink.write});
  await assert.rejects(()=>instance.read(request()),{code:'AUDIT_UNAVAILABLE'});
 }finally{await sink.close();}
});
