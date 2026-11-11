import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handlePublicShareViewer,renderPublicSnapshot} from '../src/worker-cloudflare-share-viewer.mjs';

const origin='https://share.knowledge.example.test';
const token='A'.repeat(43);
const tokenHash=createHash('sha256').update(token).digest('hex');
const instant=Date.parse('2026-11-11T18:00:00.000Z');
const valid={
  token_hash:tokenHash,
  title:'Reviewed one-page brief',
  body:'# Our next meeting\n\n**Decision:** bring the budget.\n\n[[projects/private/notes|Private detail]]\n\n<script>alert(1)</script>',
  shared_version:3,
  approval_status:'approved',
  approved_at:'2026-11-11T17:00:00.000Z',
  expires_at:'2026-11-18T17:00:00.000Z',
  revoked_at:null,
};
const url=origin+'/s/'+token;
function fixture(record=valid){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../ops/private-forward/public-snapshot-schema.sql',import.meta.url),'utf8'));
 const fields=['token_hash','title','body','shared_version','approval_status','approved_at','expires_at','revoked_at'];
 const values=fields.map(key=>record[key]);
 db.prepare('INSERT INTO knowledge_public_snapshots('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')').run(...values);
 const d1={prepare(sql){return{bind(...params){return{async first(){return db.prepare(sql).get(...params)??null;}};}};}};
 return {db,env:{KNOWLEDGE_PUBLIC_SHARE_ACK:'REVIEWED_IMMUTABLE_SNAPSHOTS_ONLY_V1',KNOWLEDGE_SHARE_ORIGIN:origin,KNOWLEDGE_SHARE_DB:d1},close:()=>db.close()};
}
async function view(env,{at=url,method='GET',now=instant}={}){
 const response=await handlePublicShareViewer(new Request(at,{method}),env,{now});
 return {status:response.status,headers:response.headers,body:await response.text()};
}
test('an explicitly approved copy renders read-only with no owner navigation or executable HTML',async()=>{
 const f=fixture();try{
   const result=await view(f.env);
   assert.equal(result.status,200);
   assert.match(result.body,/Reviewed one-page brief/);
   assert.match(result.body,/<strong>Decision:<\/strong>/);
   assert.match(result.body,/Revision 3/);
   assert.match(result.body,/&lt;script&gt;/);
   assert.doesNotMatch(result.body,/<script\b|href="\/wiki\//);
   assert.doesNotMatch(result.body,/projects\/private\/notes/);
   assert.match(result.body,/Private detail/);
   assert.doesNotMatch(result.body,/href="\/wiki|Edit draft|Version history|DEVONSTATION|\/mcp/);
   assert.equal(result.headers.get('referrer-policy'),'no-referrer');
   assert.match(result.headers.get('cache-control'),/no-store/);
   assert.match(result.headers.get('content-security-policy'),/default-src 'none'/);
   assert.match(result.headers.get('x-robots-tag'),/noindex/);
   assert.doesNotMatch(result.body,new RegExp(token));
   assert.doesNotMatch(result.body,new RegExp(tokenHash));
 }finally{f.close();}
});
test('anonymous viewer is GET/HEAD-only and never has a write or token creation route',async()=>{
 const f=fixture();try{
   assert.equal((await view(f.env,{method:'HEAD'})).status,200);
   assert.equal((await view(f.env,{method:'HEAD'})).body,'');
   for(const method of ['POST','PUT','DELETE','PATCH'])
     assert.equal((await view(f.env,{method})).status,404);
   for(const at of [origin+'/s/'+token+'?show=all',origin+'/s/',origin+'/mcp',
      origin+'/wiki',origin+'/s/'+token+'/',origin+'/api/shares',origin+'/s/'+'B'.repeat(43),
      'https://private.knowledge.example.test/s/'+token])
     assert.equal((await view(f.env,{at})).status,404);
 }finally{f.close();}
});
test('revoked and expired snapshots are equally unavailable without leaking metadata',async()=>{
 const f=fixture();try{
   const missing=await view(f.env,{at:origin+'/s/'+'Z'.repeat(43)});
   const expired=await view(f.env,{now:Date.parse('2026-11-18T17:00:00.000Z')});
   assert.equal(expired.status,404);
   assert.equal(expired.body,missing.body);
   f.db.prepare('UPDATE knowledge_public_snapshots SET revoked_at=? WHERE token_hash=?')
     .run('2026-11-12T00:00:00.000Z',tokenHash);
   const revoked=await view(f.env);
   assert.equal(revoked.status,404);
   assert.equal(revoked.body,missing.body);
   assert.doesNotMatch(revoked.body,/Reviewed one-page brief|business\/|token_hash/);
 }finally{f.close();}
});
test('viewer fails closed on missing approval, malformed data, missing DB and misbound origin',async()=>{
 const f=fixture();try{
   const missing={...f.env};delete missing.KNOWLEDGE_PUBLIC_SHARE_ACK;
   assert.equal((await view(missing)).status,503);
   assert.equal((await view({...f.env,KNOWLEDGE_SHARE_ORIGIN:'http://share.knowledge.example.test'})).status,503);
   f.db.exec('DROP TABLE knowledge_public_snapshots');
   const broken=await view(f.env);
   assert.equal(broken.status,503);
   assert.doesNotMatch(broken.body,/SELECT|private|token_hash/);
   assert.throws(()=>renderPublicSnapshot({...valid,approval_status:'pending'}),/INVALID_SHARE_SNAPSHOT/);
   assert.throws(()=>renderPublicSnapshot({...valid,expires_at:valid.approved_at}),/INVALID_SHARE_SNAPSHOT/);
 }finally{f.close();}
});
test('schema keeps approved content immutable and disallows deletion, while permitting revoke',()=>{
 const f=fixture();try{
   assert.throws(()=>f.db.prepare('UPDATE knowledge_public_snapshots SET body = ? WHERE token_hash = ?').run('changed',tokenHash));
   assert.throws(()=>f.db.prepare('UPDATE knowledge_public_snapshots SET shared_version = ? WHERE token_hash = ?').run(4,tokenHash));
   assert.throws(()=>f.db.prepare('DELETE FROM knowledge_public_snapshots WHERE token_hash = ?').run(tokenHash));
   assert.throws(()=>f.db.prepare('INSERT INTO knowledge_public_snapshots (token_hash,title,body,shared_version,approval_status,approved_at,expires_at) VALUES (?,?,?,?,?,?,?)').run('c'.repeat(64),'bad','public',1,'pending',valid.approved_at,valid.expires_at));
   assert.equal(f.db.prepare('UPDATE knowledge_public_snapshots SET revoked_at = ? WHERE token_hash = ?').run('2026-11-12T17:00:00.000Z',tokenHash).changes,1);
 }finally{f.close();}
});
