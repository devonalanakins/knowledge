import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker, {handlePrivateKnowledgeWorker} from '../src/worker-cloudflare-private.mjs';

const resource='https://knowledge.example.test/mcp';
const key='0123456789abcdef'.repeat(4);
const ddl='CREATE TABLE knowledge_instance (id INTEGER PRIMARY KEY CHECK(id=1),key_check TEXT NOT NULL);'+
 'CREATE TABLE knowledge_pages (path_key TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 128),sealed TEXT NOT NULL,updated_at TEXT NOT NULL);'+
 'CREATE TABLE knowledge_revisions (path_key TEXT NOT NULL REFERENCES knowledge_pages(path_key),version INTEGER NOT NULL,sealed TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(path_key,version));';
class SqliteD1 {
  constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(ddl);}
  prepare(sql) {
    const outer=this;
    return {
      bind(...params){
        return {
          async first(){return outer.db.prepare(sql).get(...params)??null;},
          async all(){return {results:outer.db.prepare(sql).all(...params)};},
          async run(){const result=outer.db.prepare(sql).run(...params);return {meta:{changes:Number(result.changes)}};},
        };
      },
      async first(){return outer.db.prepare(sql).get()??null;},
      async all(){return {results:outer.db.prepare(sql).all()};},
      async run(){const result=outer.db.prepare(sql).run();return {meta:{changes:Number(result.changes)}};},
    };
  }
  async batch(queries) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results=[];
      for(const stmt of queries)results.push(await stmt.run());
      this.db.exec('COMMIT');
      return results;
    } catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close(){this.db.close();}
}
function setup() {
  const db=new SqliteD1();
  const env={
    KNOWLEDGE_PRIVATE_WORKER_ACK:'OWNER_ONLY_DRAFTS_NO_IMPORT',
    KNOWLEDGE_PRIVATE_WRITE_ACK:'DRAFT_CAPTURE_ALLOWED',
    KNOWLEDGE_WORKER_RESOURCE:resource,
    KNOWLEDGE_ACCESS_AUD:'fictional-test-access-aud',
    KNOWLEDGE_ACCESS_EMAIL:'owner@example.test',
    KNOWLEDGE_SPACE:'personal',
    KNOWLEDGE_KEY_ID:'v1',
    KNOWLEDGE_DATA_KEY:key,
    KNOWLEDGE_DB:db,
  };
  return {db,env,close:()=>db.close()};
}
const access=(aud='fictional-test-access-aud',email='owner@example.test')=>({
  access:{aud,getIdentity:async()=>({email})},
});
const message=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
const call=(name,args={})=>message('tools/call',{name,arguments:args});
function draft(body='Initial synthetic content',expectedVersion=0){
  return {path:'projects/test/overview',title:'Synthetic work',body,
    sourceUrl:'https://example.org/source',expectedVersion};
}
async function rpc(env,requestMessage,{ctx=access(),at=resource,method='POST',headers={},body}={}) {
  const req=new Request(at,{
    method,headers:{
      'Content-Type':'application/json',
      'Accept':'application/json, text/event-stream',
      'MCP-Protocol-Version':'2025-11-25',...headers,
    },...(method==='POST'?{body:body??JSON.stringify(requestMessage)}:{}),
  });
  const response=await handlePrivateKnowledgeWorker(req,env,ctx);
  return {status:response.status,headers:response.headers,
    json:response.status===202?null:await response.json()};
}
function structured(response){return response.json.result.structuredContent;}
function code(response){return JSON.parse(response.json.result.content[0].text)?.error?.code;}

test('forward Knowledge refuses missing secrets, binding, explicit acknowledgments or unsafe resource',async()=>{
  const fx=setup();
  try {
    for(const broken of [null,{},
      {...fx.env,KNOWLEDGE_PRIVATE_WORKER_ACK:''},
      {...fx.env,KNOWLEDGE_ACCESS_EMAIL:'Owner@example.test'},
      {...fx.env,KNOWLEDGE_DATA_KEY:'not-a-key'},
      {...fx.env,KNOWLEDGE_DB:null},
      {...fx.env,KNOWLEDGE_WORKER_RESOURCE:'http://knowledge.example.test/mcp'},
      {...fx.env,KNOWLEDGE_WORKER_RESOURCE:resource+'?token=secret'},
      {...fx.env,KNOWLEDGE_SPACE:'cristy private'}]) {
      const response=await rpc(broken,message('tools/list'));
      assert.equal(response.status,503);
    }
    assert.equal(fx.db.db.prepare('SELECT count(*) AS n FROM knowledge_pages').get().n,0);
  }finally{fx.close()}
});

test('forward Knowledge requires direct Cloudflare Access audience, owner and exact endpoint',async()=>{
  const fx=setup();
  try {
    for(const ctx of [null,{},access('wrong-aud'),access(undefined,'stranger@example.test'),
      {access:{aud:fx.env.KNOWLEDGE_ACCESS_AUD,getIdentity:async()=>{throw Error('identity failed')}}},
      {access:{aud:fx.env.KNOWLEDGE_ACCESS_AUD,getIdentity:async()=>null}}]) {
      const response=await rpc(fx.env,message('tools/list'),{ctx,headers:{'Cf-Access-Jwt-Assertion':'forged'}});
      assert.equal(response.status,403);
    }
    assert.equal((await rpc(fx.env,message('tools/list'),{at:'https://other.example.test/mcp'})).status,404);
    assert.equal((await rpc(fx.env,message('tools/list'),{at:resource+'?page=1'})).status,404);
    assert.equal((await rpc(fx.env,message('tools/list'),{method:'GET'})).status,405);
    assert.equal((await rpc(fx.env,message('tools/list'),{headers:{Accept:'text/plain'}})).status,406);
    assert.equal((await rpc(fx.env,message('tools/list'),{headers:{'Content-Type':'text/plain'}})).status,415);
    assert.equal((await rpc(fx.env,message('tools/list'),{headers:{'MCP-Protocol-Version':'1.0'}})).status,400);
    assert.equal((await rpc(fx.env,message('tools/list'),{body:'bad json'})).status,400);
    assert.equal((await rpc(fx.env,message('tools/list'),{body:'a'.repeat(33000)})).status,413);
  }finally{fx.close()}
});

test('forward Knowledge creates, encrypts, reads, searches and updates with exact versions',async()=>{
  const fx=setup();
  try {
    const init=await rpc(fx.env,message('initialize',{
      protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'},
    }));
    assert.equal(init.status,200);
    assert.match(init.json.result.instructions,/untrusted/i);
    let r=await rpc(fx.env,message('tools/list'));
    assert.deepEqual(r.json.result.tools.map(x=>x.name),[
      'knowledge_list','knowledge_search','knowledge_read','knowledge_capture_draft']);
    assert.equal(r.json.result.tools[3].annotations.readOnlyHint,false);
    assert.equal(r.json.result.tools[3].inputSchema.required.includes('expectedVersion'),true);
    r=await rpc(fx.env,call('knowledge_capture_draft',draft()));
    assert.equal(r.status,200);
    assert.equal(structured(r).action,'created');
    assert.equal(structured(r).version,1);
    const row=fx.db.db.prepare('SELECT path_key,version,sealed FROM knowledge_pages').get();
    assert.ok(row);
    assert.equal(row.version,1);
    assert.ok(!JSON.stringify(row).includes('Synthetic work'));
    assert.ok(!JSON.stringify(row).includes('projects/test'));
    assert.ok(!JSON.stringify(row).includes('Initial synthetic content'));
    r=await rpc(fx.env,call('knowledge_read',{path:draft().path}));
    assert.equal(structured(r).page.body,draft().body);
    assert.equal(structured(r).page.sourceUrl,draft().sourceUrl);
    r=await rpc(fx.env,call('knowledge_search',{query:'synthetic content'}));
    assert.equal(structured(r).results.length,1);
    r=await rpc(fx.env,call('knowledge_list',{limit:5}));
    assert.equal(structured(r).pages.length,1);
    r=await rpc(fx.env,call('knowledge_capture_draft',draft(draft().body,1)));
    assert.equal(structured(r).action,'unchanged');
    r=await rpc(fx.env,call('knowledge_capture_draft',{
      path:draft().path,title:'Synthetic work',body:'Updated private draft',expectedVersion:1,
    }));
    assert.equal(structured(r).action,'updated');
    assert.equal(structured(r).version,2);
    assert.equal(fx.db.db.prepare('SELECT count(*) AS n FROM knowledge_revisions').get().n,2);
    assert.equal(fx.db.db.prepare('SELECT version FROM knowledge_pages').get().version,2);
    r=await rpc(fx.env,call('knowledge_read',{path:draft().path}));
    assert.equal(structured(r).page.body,'Updated private draft');
    assert.equal(structured(r).page.sourceUrl,draft().sourceUrl);
    assert.equal(worker.fetch,handlePrivateKnowledgeWorker);
  }finally{fx.close()}
});

test('forward Knowledge rejects stale writers and cross-scope, unapproved or invalid operations',async()=>{
  const fx=setup();
  try {
    let r=await rpc(fx.env,call('knowledge_capture_draft',draft()));
    assert.equal(structured(r).version,1);
    for(const bad of [draft('Stale overwrite',0),draft('Wrong expectedVersion',2)]) {
      r=await rpc(fx.env,call('knowledge_capture_draft',bad));
      assert.equal(code(r),'VERSION_CONFLICT');
    }
    r=await rpc(fx.env,call('knowledge_capture_draft',{...draft(),status:'recorded'}));
    assert.equal(r.json.error.code,-32602);
    r=await rpc(fx.env,call('knowledge_capture_draft',{...draft(),space:'cristy'}));
    assert.equal(r.json.error.code,-32602);
    r=await rpc(fx.env,call('knowledge_capture_draft',{...draft(),expectedVersion:undefined}));
    assert.equal(code(r),'INVALID_INPUT');
    r=await rpc(fx.env,call('knowledge_capture_draft',{...draft(),sourceUrl:'https://user:secret@example.org'}));
    assert.equal(code(r),'INVALID_INPUT');
    r=await rpc(fx.env,call('knowledge_capture_draft',{...draft(),body:'x'.repeat(16385)}));
    assert.equal(code(r),'QUOTA_EXCEEDED');
    r=await rpc(fx.env,call('share_page',{}));
    assert.equal(r.json.error.code,-32602);
    r=await rpc(fx.env,call('knowledge_read',{path:'other/private'}));
    assert.equal(code(r),'NOT_FOUND');
    assert.equal(fx.db.db.prepare('SELECT count(*) AS n FROM knowledge_revisions').get().n,1);
  }finally{fx.close()}
});

test('forward Knowledge does not advertise or allow capture without private write acknowledgment',async()=>{
  const fx=setup();
  try {
    const env={...fx.env,KNOWLEDGE_PRIVATE_WRITE_ACK:''};
    let r=await rpc(env,message('tools/list'));
    assert.equal(r.json.result.tools.length,3);
    r=await rpc(env,call('knowledge_capture_draft',draft()));
    assert.equal(code(r),'FORBIDDEN');
    assert.equal(fx.db.db.prepare('SELECT count(*) AS n FROM knowledge_pages').get().n,0);
  }finally{fx.close()}
});

test('forward Knowledge detects altered sealed content, wrong key and discloses no plaintext',async()=>{
  const fx=setup();
  try {
    await rpc(fx.env,call('knowledge_capture_draft',draft()));
    let r=await rpc({...fx.env,KNOWLEDGE_DATA_KEY:'f'.repeat(64)},call('knowledge_read',{path:draft().path}));
    assert.equal(r.status,503);
    assert.equal(r.json.error,'STORAGE_UNAVAILABLE');
    assert.ok(!JSON.stringify(r.json).includes('Initial synthetic'));
    fx.db.db.prepare('UPDATE knowledge_pages SET sealed = ?').run('{"format":"knowledge-sealed-v1","keyId":"v1","nonce":"bad","data":"bad"}');
    r=await rpc(fx.env,call('knowledge_read',{path:draft().path}));
    assert.equal(code(r),'INVALID_CIPHERTEXT');
  }finally{fx.close()}
});

test('forward Knowledge stores revisions atomically or fails without claiming success',async()=>{
  const fx=setup();
  try {
    const original=fx.db.batch.bind(fx.db);
    fx.db.batch=async()=>{throw new Error('synthetic database failure')};
    let r=await rpc(fx.env,call('knowledge_capture_draft',draft()));
    assert.equal(code(r),'STORAGE_UNAVAILABLE');
    assert.equal(fx.db.db.prepare('SELECT count(*) AS n FROM knowledge_pages').get().n,0);
    fx.db.batch=original;
    r=await rpc(fx.env,call('knowledge_capture_draft',draft()));
    assert.equal(structured(r).version,1);
  }finally{fx.close()}
});
