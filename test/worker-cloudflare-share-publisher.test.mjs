import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleSharePublisher} from '../src/worker-cloudflare-share-publisher.mjs';
import {handlePublicShareViewer} from '../src/worker-cloudflare-share-viewer.mjs';

const publishOrigin='https://owner-share.example.test';
const publicOrigin='https://share.knowledge.example.test';
const aud='synthetic-owner-access-audience';
const key='0123456789abcdef'.repeat(4);
const owner='owner@example.test';
const when=Date.parse('2026-11-11T19:30:00.000Z');
const access=(email=owner,audience=aud)=>({access:{aud:audience,getIdentity:async()=>({email})}});
const approved='PUBLIC_NONCLINICAL_REVIEWED';
const confirm='PUBLISH THIS SNAPSHOT';
const body='# Approved briefing\n\n**Agenda**\n\n- Review budget\n- Questions from group\n\n[External](https://example.com/reference)\n\n<script>alert(1)</script>';
const title='Synthetic public workshop note';

class D1 {
 constructor(){
  this.db=new DatabaseSync(':memory:');
  this.db.exec(readFileSync(new URL('../ops/private-forward/public-snapshot-schema.sql',import.meta.url),'utf8'));
 }
 prepare(sql){
  const that=this;
  return {
   bind(...params){return {
    async first(){return that.db.prepare(sql).get(...params)??null;},
    async all(){return {results:that.db.prepare(sql).all(...params)};},
    async run(){const result=that.db.prepare(sql).run(...params);return {meta:{changes:Number(result.changes)}};},
   };},
   async all(){return {results:that.db.prepare(sql).all()};},
  };
 }
 close(){this.db.close();}
}
function fixture(){
 const db=new D1();
 const env={
  KNOWLEDGE_SHARE_PUBLISH_ACK:'OWNER_REVIEWED_NONCLINICAL_SNAPSHOT_V1',
  KNOWLEDGE_SHARE_DB_SCOPE_ACK:'ISOLATED_PUBLIC_SNAPSHOTS_ONLY_V1',
  KNOWLEDGE_SHARE_PUBLISH_ORIGIN:publishOrigin,
  KNOWLEDGE_SHARE_PUBLIC_ORIGIN:publicOrigin,
  KNOWLEDGE_SHARE_ACCESS_AUD:aud,
  KNOWLEDGE_SHARE_ACCESS_EMAIL:owner,
  KNOWLEDGE_SHARE_APPROVAL_KEY:key,
  KNOWLEDGE_SHARE_DB:db,
 };
 const viewer={
  KNOWLEDGE_PUBLIC_SHARE_ACK:'REVIEWED_IMMUTABLE_SNAPSHOTS_ONLY_V1',
  KNOWLEDGE_SHARE_ORIGIN:publicOrigin,
  KNOWLEDGE_SHARE_DB:db,
 };
 return {db,env,viewer,close(){db.close()}};
}
async function publish(env,path,method='GET',values=null,{ctx=access(),now=when,headers={}}={}){
 const request=new Request(publishOrigin+path,{
  method,headers:{...(values?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},
  ...(values?{body:new URLSearchParams(values).toString()}:{}),
 });
 const response=await handleSharePublisher(request,env,ctx,{now});
 return {status:response.status,text:await response.text(),headers:response.headers};
}
function hidden(html,name){
 const match=new RegExp('<input type="hidden" name="'+name+'" value="([^"]+)">').exec(html);
 assert.ok(match,'Missing '+name+' field');
 return match[1];
}
async function prepare(fx,{copy=body,heading=title,now=when}={}){
 const start=await publish(fx.env,'/share/new','GET',null,{now});
 assert.equal(start.status,200);
 assert.match(start.text,/reviewed snapshot/i);
 const issued=hidden(start.text,'issued'),csrf=hidden(start.text,'csrf');
 const fields={title:heading,body:copy,classification:approved,issued,csrf};
 const preview=await publish(fx.env,'/share/preview','POST',fields,{now:now+1000});
 assert.equal(preview.status,200);
 const proof=hidden(preview.text,'proof');
 return {issued,proof,fields,preview};
}
async function view(fx,token,{now=when+2000}={}){
 const response=await handlePublicShareViewer(new Request(publicOrigin+'/s/'+token),fx.viewer,{now});
 return {status:response.status,body:await response.text(),headers:response.headers};
}
test('owner explicitly reviews, issues a seven-day copy, and revokes it with verified readback',async()=>{
 const fx=fixture();try{
  const pre=await prepare(fx);
  assert.match(pre.preview.text,/No link has been issued/);
  assert.match(pre.preview.text,/Review the exact public copy/);
  assert.match(pre.preview.text,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(pre.preview.text,/href="https:\/\/example.com\/reference/);
  const issued=await publish(fx.env,'/share/create','POST',{
   title,body,issued:pre.issued,proof:pre.proof,confirmation:confirm
  },{now:when+2000});
  assert.equal(issued.status,200);
  const match=new RegExp(publicOrigin+'/s/([A-Za-z0-9_-]{43})').exec(issued.text);
  assert.ok(match,'Valid public capability link must be shown to owner');
  const token=match[1];
  const hash=createHash('sha256').update(token).digest('hex');
  const row=fx.db.db.prepare('SELECT * FROM knowledge_public_snapshots').get();
  assert.equal(row.token_hash,hash);
  assert.match(row.review_proof_hash,/^[0-9a-f]{64}$/);
  assert.ok(row.review_proof_hash!==pre.proof);
  assert.equal(row.body,body);
  assert.equal(row.title,title);
  assert.equal(row.shared_version,1);
  assert.equal(row.approval_status,'approved');
  assert.equal(Date.parse(row.expires_at)-Date.parse(row.approved_at),7*24*60*60*1000);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_public_snapshots').get().n,1);
  assert.doesNotMatch(JSON.stringify(row),new RegExp(token));
  const readable=await view(fx,token);
  assert.equal(readable.status,200);
  assert.match(readable.body,/Synthetic public workshop note/);
  assert.match(readable.body,/Review budget/);
  assert.match(readable.body,/&lt;script&gt;/);
  assert.doesNotMatch(readable.body,/href="https:\/\/example.com\/reference/);
  const managed=await publish(fx.env,'/share/manage','GET',null,{now:when+3000});
  assert.equal(managed.status,200);
  assert.match(managed.text,/Synthetic public workshop note/);
  assert.doesNotMatch(managed.text,new RegExp(token));
  const revoked=await publish(fx.env,'/share/revoke','POST',{
   tokenHash: hidden(managed.text,'tokenHash'),
   issued:hidden(managed.text,'issued'),csrf:hidden(managed.text,'csrf'),
  },{now:when+3500});
  assert.equal(revoked.status,200);
  assert.match(revoked.text,/Snapshot revoked/);
  const check=fx.db.db.prepare('SELECT revoked_at FROM knowledge_public_snapshots WHERE token_hash=?').get(hash);
  assert.ok(check?.revoked_at);
  assert.equal((await view(fx,token)).status,404);
 }finally{fx.close();}
});

test('stale and tampered approval, wrong identity and wrong origin fail closed',async()=>{
 const fx=fixture();try{
  assert.equal((await publish({...fx.env,KNOWLEDGE_SHARE_PUBLISH_ACK:''},'/share/new')).status,503);
  assert.equal((await publish({...fx.env,KNOWLEDGE_SHARE_DB_SCOPE_ACK:''},'/share/new')).status,503);
  assert.equal((await publish({...fx.env,KNOWLEDGE_SHARE_PUBLISH_ORIGIN:'http://owner-share.example.test'},'/share/new')).status,503);
  assert.equal((await publish(fx.env,'/share/new','GET',null,{ctx:access('stranger@example.test')})).status,403);
  assert.equal((await publish(fx.env,'/share/manage','GET',null,{ctx:access(owner,'different-aud')})).status,403);
  assert.equal((await publish(fx.env,'/share/create?unsafe=1','POST',{x:'y'})).status,404);
  assert.equal((await publish(fx.env,'/share/revoke','GET')).status,404);
  const pre=await prepare(fx);
  for(const attempt of [
   {title,body:body+' changed',issued:pre.issued,proof:pre.proof,confirmation:confirm},
   {title,body,issued:pre.issued,proof:'a'.repeat(64),confirmation:confirm},
   {title,body,issued:pre.issued,proof:pre.proof,confirmation:'maybe'},
  ]){
   assert.equal((await publish(fx.env,'/share/create','POST',attempt,{now:when+2000})).status,403);
  }
  assert.equal((await publish(fx.env,'/share/create','POST',{
   title,body,issued:pre.issued,proof:pre.proof,confirmation:confirm,
  },{now:when+16*60*1000})).status,403);
  assert.equal((await publish(fx.env,'/share/create','POST',{
   title,body,issued:pre.issued,proof:pre.proof,confirmation:confirm,
  },{ctx:access('stranger@example.test'),now:when+2000})).status,403);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_public_snapshots').get().n,0);
 }finally{fx.close();}
});
test('unreviewed links, unknown fields and duplicated approvals are refused',async()=>{
 const fx=fixture();try{
  const start=await publish(fx.env,'/share/new');
  const issued=hidden(start.text,'issued'),csrf=hidden(start.text,'csrf');
  for(const copy of [
   '[[business/private/record]]','Contains ]] a private link','   ',
  ]){
   const result=await publish(fx.env,'/share/preview','POST',
    {title,body:copy,classification:approved,issued,csrf});
   assert.equal(result.status,400);
  }
  const noAttestation=await publish(fx.env,'/share/preview','POST',
   {title,body,classification:'unreviewed',issued,csrf});
  assert.equal(noAttestation.status,400);
  const extras=await publish(fx.env,'/share/preview','POST',
   {title,body,classification:approved,issued,csrf,unexpected:'hack'});
  assert.equal(extras.status,400);
  const pre=await prepare(fx);
  const posted={title,body,issued:pre.issued,proof:pre.proof,confirmation:confirm};
  assert.equal((await publish(fx.env,'/share/create','POST',posted,{now:when+2000})).status,200);
  // A repeated valid confirmation must NOT mint another capability.
  const duplicate=await publish(fx.env,'/share/create','POST',posted,{now:when+2200});
  assert.equal(duplicate.status,503);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_public_snapshots').get().n,1);
  const management=await publish(fx.env,'/share/manage','GET',null,{now:when+3000});
  const fields={
   tokenHash:hidden(management.text,'tokenHash'),
   issued:hidden(management.text,'issued'),
   csrf:hidden(management.text,'csrf')
  };
  assert.equal((await publish(fx.env,'/share/revoke','POST',{...fields,csrf:'invalid'},{now:when+3500})).status,403);
  assert.equal((await publish(fx.env,'/share/revoke','POST',fields,{now:when+3500})).status,200);
  assert.equal((await publish(fx.env,'/share/revoke','POST',fields,{now:when+3700})).status,404);
 }finally{fx.close();}
});
test('provider errors do not reveal public tokens, document content or secret material',async()=>{
 const fx=fixture();try{
  const pre=await prepare(fx);
  const fallbackEnv={...fx.env,KNOWLEDGE_SHARE_DB:{
   prepare(){throw new Error('Synthetic internal database exception with private source data')}
  }};
  const result=await publish(fallbackEnv,'/share/create','POST',{
   title,body,issued:pre.issued,proof:pre.proof,confirmation:confirm
  },{now:when+2000});
  assert.equal(result.status,503);
  assert.doesNotMatch(result.text,/private source data|Synthetic public workshop note|01234567/);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_public_snapshots').get().n,0);
 }finally{fx.close();}
});
