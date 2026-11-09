import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker, {handlePrivateKnowledgeWorker,handlePrivateMergeCapture} from '../src/worker-cloudflare-private.mjs';
import {canonicalGitHubMergeReceipt} from '../src/forward-receipt-policy.mjs';
import {signCaptureReceipt} from '../src/forward-capture-machine-auth.mjs';
import {searchIndexStatements} from '../src/forward-private-search.mjs';

const resource='https://knowledge.example.test/mcp';
const key='0123456789abcdef'.repeat(4);
const ddl=readFileSync(new URL('../ops/private-forward/schema.sql',import.meta.url),'utf8');
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

// Independently construct only fictional ciphertext to exercise reads beyond
// the still-enforced 500-page WRITE gate without bypassing that production gate.
async function seedPaginationFixture(fx,count){
 const enc=new TextEncoder();
 const root=await crypto.subtle.importKey('raw',Buffer.from(key,'hex'),'HKDF',false,['deriveKey']);
 const ctx={name:'HKDF',hash:'SHA-256',salt:enc.encode('Knowledge forward-only v1')};
 const aes=await crypto.subtle.deriveKey({...ctx,info:enc.encode('content-encryption')},root,{name:'AES-GCM',length:256},false,['encrypt']);
 const mac=await crypto.subtle.deriveKey({...ctx,info:enc.encode('path-indexing')},root,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const sign=async s=>Buffer.from(await crypto.subtle.sign('HMAC',mac,enc.encode(s))).toString('base64url');
 fx.db.db.prepare('INSERT INTO knowledge_instance(id,key_check) VALUES (1,?)').run(await sign('knowledge-instance-v1\0personal\0v1'));
 const stmt=fx.db.db.prepare('INSERT INTO knowledge_pages(path_key,version,sealed,updated_at) VALUES (?,?,?,?)');
 for(let i=0;i<count;i++){
   const path='fictional/page-'+i.toString().padStart(5,'0');
   const pathKey=await sign('path-v1\0personal\0'+path);
   const p={path,title:'Fictional page '+i,body:'Synthetic bounded traversal '+(i===1234?'uniqueneedle':'common'),status:'draft',sourceUrl:null,version:1,updatedAt:'2026-11-07T00:00:00.000Z'};
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('knowledge-record-v1\0personal\0'+pathKey+'\0'+1)},aes,enc.encode(JSON.stringify(p)));
   const sealed=JSON.stringify({format:'knowledge-sealed-v1',keyId:'v1',nonce:Buffer.from(iv).toString('base64url'),data:Buffer.from(bytes).toString('base64url')});
   stmt.run(pathKey,1,sealed,p.updatedAt);
 }
}

function enableIndexedSearch(fx){
 fx.db.db.exec(readFileSync(new URL('../ops/private-forward/search-index-v1.sql',import.meta.url),'utf8'));
 fx.env.KNOWLEDGE_SEARCH_INDEX_ACK='PRIVATE_TOKEN_SEARCH_V1';
}

test('opt-in private search atomically indexes writes and updates without plaintext term storage',async()=>{
 const fx=setup();
 try{
   enableIndexedSearch(fx);
   assert.equal(structured(await rpc(fx.env,call('knowledge_capture_draft',draft('Photon separated transport')))).version,1);
   const found=structured(await rpc(fx.env,call('knowledge_search',{query:'TRANSPORT PHOTON'})));
   assert.equal(found.results.length,1);assert.equal(found.matchMode,'all-normalized-words');
   assert.ok(!JSON.stringify(found).includes('Photon separated transport'));
   const rows=fx.db.db.prepare('SELECT * FROM knowledge_search_terms').all();
   assert.ok(rows.length>0);assert.doesNotMatch(JSON.stringify(rows),/photon|transport|separated|projects/);
   assert.equal(structured(await rpc(fx.env,call('knowledge_capture_draft',draft('Neutrino oscillation',1)))).version,2);
   assert.equal(structured(await rpc(fx.env,call('knowledge_search',{query:'photon'}))).results.length,0);
   assert.equal(structured(await rpc(fx.env,call('knowledge_search',{query:'oscillation neutrino'}))).results.length,1);
   assert.equal(code(await rpc(fx.env,call('knowledge_search',{query:'one two three four five six seven eight nine'}))),'QUOTA_EXCEEDED');
   assert.equal((await rpc(fx.env,call('knowledge_search',{query:'neutrino'}),{ctx:access(undefined,'wrong@example.test')})).status,403);
   fx.db.db.exec('DELETE FROM knowledge_search_versions');
   assert.equal(code(await rpc(fx.env,call('knowledge_search',{query:'neutrino'}))),'SEARCH_INDEX_INCOMPLETE');
 }finally{fx.close();}
});

test('index failure rolls back page, immutable revision and terms as one transaction',async()=>{
 const fx=setup();
 try{
   enableIndexedSearch(fx);
   fx.db.db.exec("CREATE TRIGGER synthetic_index_failure BEFORE INSERT ON knowledge_search_versions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
   assert.equal(code(await rpc(fx.env,call('knowledge_capture_draft',draft()))),'STORAGE_UNAVAILABLE');
   for(const table of ['knowledge_pages','knowledge_revisions','knowledge_search_terms','knowledge_search_versions'])
     assert.equal(fx.db.db.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
 }finally{fx.close();}
});

test('private search caps results, refuses oversized indexing and keeps browser word matching consistent',async()=>{
 const fx=setup();
 try{
   enableIndexedSearch(fx);
   for(let i=0;i<60;i++)assert.equal(structured(await rpc(fx.env,call('knowledge_capture_draft',{
     path:'fictional/search-'+i,title:'Fictional indexed page',body:'Photon separated transport',expectedVersion:0,
   }))).version,1);
   const r=structured(await rpc(fx.env,call('knowledge_search',{query:'transport photon'})));
   assert.equal(r.results.length,50);assert.equal(r.truncated,true);
   const tooMany=Array.from({length:1025},(_,i)=>'word'+i).join(' ');
   assert.equal(code(await rpc(fx.env,call('knowledge_capture_draft',{path:'fictional/too-many',title:'Fictional',body:tooMany,expectedVersion:0}))),'QUOTA_EXCEEDED');
   assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,60);
   const env={...fx.env,KNOWLEDGE_BROWSER_ACK:'OWNER_ONLY_BROWSER_READ_V1'};
   const response=await handlePrivateKnowledgeWorker(new Request('https://knowledge.example.test/wiki-find?q=transport+photon'),env,access());
   const html=await response.text();
   assert.equal(response.status,200);assert.match(html,/50 matching pages/);
   assert.match(html,/Matches every search word/);assert.match(html,/More matches exist/);
   const plan=fx.db.db.prepare('EXPLAIN QUERY PLAN SELECT path_key FROM knowledge_search_terms WHERE token_key IN (SELECT value FROM json_each(?)) GROUP BY path_key HAVING COUNT(*)=?').all('["fictional-opaque-hash"]',1);
   assert.match(JSON.stringify(plan),/SEARCH.*PRIMARY KEY.*token_key/);
 }finally{fx.close();}
});

test('private search refuses an unauthenticated false-positive index entry',async()=>{
 const fx=setup();
 try{
   enableIndexedSearch(fx);
   await rpc(fx.env,call('knowledge_capture_draft',{path:'fictional/one',title:'One',body:'Photon',expectedVersion:0}));
   await rpc(fx.env,call('knowledge_capture_draft',{path:'fictional/two',title:'Two',body:'Neutrino',expectedVersion:0}));
   // A storage-only attacker can corrupt the derived index but cannot make
   // authenticated plaintext satisfy the query. Never disclose false matches.
   const keys=fx.db.db.prepare('SELECT path_key FROM knowledge_pages ORDER BY path_key').all().map(x=>x.path_key);
   const first=fx.db.db.prepare('SELECT token_key FROM knowledge_search_terms WHERE path_key=?').all(keys[0]);
   for(const t of first)fx.db.db.prepare('INSERT OR IGNORE INTO knowledge_search_terms(token_key,path_key) VALUES (?,?)').run(t.token_key,keys[1]);
   const photon=await rpc(fx.env,call('knowledge_search',{query:'photon'}));
   const neutrino=await rpc(fx.env,call('knowledge_search',{query:'neutrino'}));
   assert.ok(code(photon)==='INVALID_CIPHERTEXT'||code(neutrino)==='INVALID_CIPHERTEXT');
 }finally{fx.close();}
});

test('stale CAS after two concurrent revisions cannot replace the winning search index',async()=>{
 const fx=setup();
 try{
   enableIndexedSearch(fx);
   await rpc(fx.env,call('knowledge_capture_draft',draft('Initial term')));
   const batch=fx.db.batch.bind(fx.db);let intervene=true;
   fx.db.batch=async statements=>{
     if(intervene){
       intervene=false;
       assert.equal(structured(await rpc(fx.env,call('knowledge_capture_draft',draft('Second term',1)))).version,2);
       assert.equal(structured(await rpc(fx.env,call('knowledge_capture_draft',draft('Winning unique index',2)))).version,3);
     }
     return batch(statements);
   };
   assert.equal(code(await rpc(fx.env,call('knowledge_capture_draft',draft('Losing stale text',1)))),'VERSION_CONFLICT');
   assert.equal(structured(await rpc(fx.env,call('knowledge_search',{query:'winning'}))).results.length,1);
   assert.equal(structured(await rpc(fx.env,call('knowledge_search',{query:'losing'}))).results.length,0);
   assert.equal(fx.db.db.prepare('SELECT version FROM knowledge_search_versions').get().version,3);
   assert.equal(fx.db.db.prepare('SELECT count(*) AS n FROM knowledge_revisions').get().n,3);
 }finally{fx.close();}
});

test('private indexed search finds a record among 3312 without decrypting unrelated ciphertext',async()=>{
 const fx=setup();
 try{
   await seedPaginationFixture(fx,3312);enableIndexedSearch(fx);
   const enc=new TextEncoder();
   const hk=await crypto.subtle.importKey('raw',Buffer.from(key,'hex'),'HKDF',false,['deriveKey']);
   const search=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('Knowledge forward-only v1'),info:enc.encode('term-search-v1')},hk,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
   // Synthetic, memory-only derived-index rebuild, not a production importer.
   const rootMac=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('Knowledge forward-only v1'),info:enc.encode('path-indexing')},hk,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
   for(let i=0;i<3312;i++){
     const path='fictional/page-'+i.toString().padStart(5,'0');
     const pathKey=Buffer.from(await crypto.subtle.sign('HMAC',rootMac,enc.encode('path-v1\0personal\0'+path))).toString('base64url');
     const row=fx.db.db.prepare('SELECT sealed FROM knowledge_pages WHERE path_key=?').get(pathKey);
     const page={path,title:'Fictional page '+i,body:'Synthetic bounded traversal '+(i===1234?'uniqueneedle':'common'),version:1};
     await fx.db.batch(await searchIndexStatements({db:fx.db,key:search,space:'personal',page,pathKey,sealed:row.sealed}));
   }
   const target='fictional/page-01234';
   const other=fx.db.db.prepare('SELECT path_key FROM knowledge_pages ORDER BY path_key LIMIT 1').get().path_key;
   // Keep the target valid; corrupt a distinct, unselected encrypted record.
   const targetKey=Buffer.from(await crypto.subtle.sign('HMAC',rootMac,enc.encode('path-v1\0personal\0'+target))).toString('base64url');
   const damaged=other===targetKey?fx.db.db.prepare('SELECT path_key FROM knowledge_pages WHERE path_key<>? LIMIT 1').get(targetKey).path_key:other;
   fx.db.db.prepare('UPDATE knowledge_pages SET sealed=? WHERE path_key=?').run('tampered',damaged);
   const result=structured(await rpc(fx.env,call('knowledge_search',{query:'uniqueneedle traversal'})));
   assert.equal(result.results.length,1);assert.equal(result.results[0].path,target);assert.equal(result.truncated,false);
   fx.db.db.prepare('UPDATE knowledge_pages SET sealed=? WHERE path_key=?').run('tampered',targetKey);
   assert.equal(code(await rpc(fx.env,call('knowledge_search',{query:'uniqueneedle'}))),'INVALID_CIPHERTEXT');
 }finally{fx.close();}
});

test('keyset list traverses 3312 fictional pages with bounded indexed reads and no duplicates',async()=>{
 const fx=setup();
 try{
   await seedPaginationFixture(fx,3312);
   const prepare=fx.db.prepare.bind(fx.db),queries=[];
   fx.db.prepare=sql=>{if(sql.includes('FROM knowledge_pages')&&!sql.includes('COUNT'))queries.push(sql);return prepare(sql);};
   let cursor,requests=0;const seen=new Set();
   do{
     const result=structured(await rpc(fx.env,call('knowledge_list',{limit:100,...(cursor?{cursor}:{})})));
     assert.ok(result.pages.length<=100);
     for(const page of result.pages){assert.ok(!seen.has(page.path));seen.add(page.path);assert.ok(!Object.hasOwn(page,'body'));}
     cursor=result.nextCursor;requests++;
   }while(cursor);
   assert.equal(seen.size,3312);assert.equal(requests,34);
   assert.equal(queries.length,34);
   assert.ok(queries.every(q=>q.includes('WHERE path_key > ? ORDER BY path_key LIMIT ?')));
   const plan=fx.db.db.prepare('EXPLAIN QUERY PLAN SELECT path_key,version,sealed FROM knowledge_pages WHERE path_key > ? ORDER BY path_key LIMIT ?').all('',101);
   assert.match(JSON.stringify(plan),/SEARCH.*INDEX/);
   assert.doesNotMatch(JSON.stringify(plan),/TEMP B-TREE/);
   assert.equal(code(await rpc(fx.env,call('knowledge_capture_draft',{...draft(),path:'fictional/new'}))),'QUOTA_EXCEEDED');
 }finally{fx.close();}
});

test('list authenticates cursor before querying pages and does not decrypt off-batch rows',async()=>{
 const fx=setup();
 try{
   await seedPaginationFixture(fx,3);
   const first=structured(await rpc(fx.env,call('knowledge_list',{limit:1})));
   assert.ok(first.nextCursor);
   const last=fx.db.db.prepare('SELECT path_key FROM knowledge_pages ORDER BY path_key DESC LIMIT 1').get().path_key;
   fx.db.db.prepare('UPDATE knowledge_pages SET sealed=? WHERE path_key=?').run('tampered',last);
   const repeated=structured(await rpc(fx.env,call('knowledge_list',{limit:1})));
   assert.equal(repeated.pages[0].path,first.pages[0].path);
   const second=structured(await rpc(fx.env,call('knowledge_list',{limit:1,cursor:first.nextCursor})));
   assert.equal(code(await rpc(fx.env,call('knowledge_list',{limit:1,cursor:second.nextCursor}))),'INVALID_CIPHERTEXT');
   assert.equal(code(await rpc(fx.env,call('knowledge_list',{cursor:'invalid'}))),'INVALID_INPUT');
   assert.equal((await rpc(fx.env,call('knowledge_list',{cursor:first.nextCursor}),{ctx:access(undefined,'wrong@example.test')})).status,403);
   assert.equal((await rpc(fx.env,call('knowledge_list',{cursor:first.nextCursor,space:'anevum'}))).json.error.code,-32602);
 }finally{fx.close();}
});

test('owner browser follows bounded page links using the same private store and Access gate',async()=>{
 const fx=setup();
 try{
   await seedPaginationFixture(fx,51);
   const env={...fx.env,KNOWLEDGE_BROWSER_ACK:'OWNER_ONLY_BROWSER_READ_V1'};
   const get=async(at,ctx=access())=>handlePrivateKnowledgeWorker(new Request(at),env,ctx);
   const first=await get('https://knowledge.example.test/wiki');
   assert.equal(first.status,200);
   const html=await first.text();
   assert.match(html,/50 pages in this batch/);
   const next=html.match(/rel="next" href="([^"]+)"/)[1];
   assert.equal(new URL(next,'https://knowledge.example.test').searchParams.getAll('cursor').length,1);
   const second=await get('https://knowledge.example.test'+next);
   const body=await second.text();
   assert.equal(second.status,200);assert.match(body,/1 page in this batch/);
   assert.doesNotMatch(body,/rel="next"/);
   assert.equal((await get('https://knowledge.example.test'+next,access(undefined,'wrong@example.test'))).status,403);
   assert.equal((await get('https://knowledge.example.test'+next+'&cursor=duplicate')).status,404);
 }finally{fx.close();}
});

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
    assert.deepEqual(structured(r).keyAttestation,{
      keyId:'v1',
      fingerprint:createHash('sha256').update(Buffer.from(key,'hex')).digest('hex').slice(0,16),
    });
    assert.ok(!JSON.stringify(structured(r)).includes(key));
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
    r=await rpc(env,call('knowledge_list',{limit:1}));
    assert.deepEqual(structured(r).pages,[]);
    assert.deepEqual(structured(r).keyAttestation,{
      keyId:'v1',
      fingerprint:createHash('sha256').update(Buffer.from(key,'hex')).digest('hex').slice(0,16),
    });
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

test('forward D1 schema makes historical revisions immutable',()=>{
  const fx=setup();
  try{
    fx.db.db.prepare("INSERT INTO knowledge_pages(path_key,version,sealed,updated_at) VALUES (?,?,?,?)")
      .run('fictional-opaque-index',1,'fictional-sealed','2026-11-07T00:00:00.000Z');
    fx.db.db.prepare("INSERT INTO knowledge_revisions(path_key,version,sealed,created_at) VALUES (?,?,?,?)")
      .run('fictional-opaque-index',1,'fictional-sealed','2026-11-07T00:00:00.000Z');
    assert.throws(()=>fx.db.db.prepare('UPDATE knowledge_revisions SET sealed=?').run('tampered'),/immutable/);
    assert.throws(()=>fx.db.db.prepare('DELETE FROM knowledge_revisions').run(),/immutable/);
  }finally{fx.close()}
});

test('forward Knowledge attests the configured key without disclosing it or altering the database',async()=>{
  const fx=setup();
  try{
    const readonly={...fx.env,KNOWLEDGE_PRIVATE_WRITE_ACK:''};
    const expected=createHash('sha256').update(Buffer.from(key,'hex')).digest('hex').slice(0,16);
    let r=await rpc(readonly,call('knowledge_list'));
    assert.deepEqual(structured(r).keyAttestation,{keyId:'v1',fingerprint:expected});
    assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
    assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_instance').get().n,0);
    r=await rpc({...readonly,KNOWLEDGE_DATA_KEY:'f'.repeat(64),KNOWLEDGE_KEY_ID:'owner-v1'},call('knowledge_list'));
    const wrong=structured(r).keyAttestation;
    assert.equal(wrong.keyId,'owner-v1');
    assert.match(wrong.fingerprint,/^[0-9a-f]{16}$/);
    assert.notEqual(wrong.fingerprint,expected);
    assert.ok(!JSON.stringify(r).includes('f'.repeat(64)));
    r=await rpc(readonly,call('knowledge_list'),{ctx:access('wrong-aud')});
    assert.equal(r.status,403);
    assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,0);
  } finally {fx.close();}
});

test('forward Knowledge fictional acceptance mode refuses all non-fixture writes',async()=>{
  const fx=setup();
  const only={...fx.env,KNOWLEDGE_PRIVATE_WRITE_ACK:'',
    KNOWLEDGE_ACCEPTANCE_ONLY_ACK:'FICTIONAL_WRITE_ONLY_NO_PRIVATE_DATA'};
  const fictional={path:'acceptance/fictional-draft',
    title:'Fictional Knowledge Acceptance Test',
    body:'Fictional acceptance record: phase one. No real personal, client, or business information.',
    expectedVersion:0};
  try{
    let r=await rpc(only,message('tools/list'));
    assert.deepEqual(r.json.result.tools.map(x=>x.name),[
      'knowledge_list','knowledge_search','knowledge_read','knowledge_capture_draft']);
    assert.match(r.json.result.tools[3].description,/FICTIONAL TEST ONLY/);
    for(const wrong of [
      {...fictional,path:'personal/private'},
      {...fictional,title:'Real note'},
      {...fictional,body:'Personal information'},
      {...fictional,sourceUrl:'https://example.org'},
      {...fictional,expectedVersion:2},
    ]){
      r=await rpc(only,call('knowledge_capture_draft',wrong));
      assert.equal(code(r),'FORBIDDEN');
    }
    assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
    r=await rpc(only,call('knowledge_capture_draft',fictional));
    assert.equal(structured(r).action,'created');
    assert.equal(structured(r).version,1);
    r=await rpc(only,call('knowledge_read',{path:fictional.path}));
    assert.equal(structured(r).page.body,fictional.body);
    const updated={...fictional,expectedVersion:1,
      body:'Fictional acceptance record: phase two. No real personal, client, or business information.'};
    r=await rpc(only,call('knowledge_capture_draft',updated));
    assert.equal(structured(r).action,'updated');
    assert.equal(structured(r).version,2);
    r=await rpc(only,call('knowledge_capture_draft',fictional));
    assert.equal(code(r),'VERSION_CONFLICT');
    r=await rpc(only,call('knowledge_capture_draft',{...updated,expectedVersion:2}));
    assert.equal(code(r),'FORBIDDEN');
    r=await rpc(only,call('knowledge_list',{limit:3}));
    assert.equal(structured(r).pages.length,1);
    assert.equal(structured(r).pages[0].version,2);
    assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,2);
    assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_instance').get().n,1);
    r=await rpc(only,call('knowledge_capture_draft',fictional),{ctx:access('wrong-aud')});
    assert.equal(r.status,403);
    const conflicting={...only,KNOWLEDGE_PRIVATE_WRITE_ACK:'DRAFT_CAPTURE_ALLOWED'};
    r=await rpc(conflicting,message('tools/list'));
    assert.equal(r.status,503);
  }finally{fx.close();}
});


async function browser(env,at='https://knowledge.example.test/wiki',{ctx=access(),method='GET'}={}) {
  const response=await handlePrivateKnowledgeWorker(new Request(at,{method}),env,ctx);
  return {status:response.status,headers:response.headers,text:await response.text()};
}
const browserEnv=env=>({...env,KNOWLEDGE_PRIVATE_WRITE_ACK:'',
  KNOWLEDGE_ACCEPTANCE_ONLY_ACK:'',KNOWLEDGE_BROWSER_ACK:'OWNER_ONLY_BROWSER_READ_V1'});

test('owner-only browser is opt-in, shares the encrypted MCP store and remains read-only',async()=>{
  const fx=setup();
  try {
    await rpc(fx.env,call('knowledge_capture_draft',draft()));
    let r=await browser(fx.env);
    assert.equal(r.status,404);
    assert.ok(!r.text.includes(draft().body));
    const readOnly=browserEnv(fx.env);
    r=await browser(readOnly);
    assert.equal(r.status,200);
    assert.match(r.text,/Synthetic work/);
    assert.match(r.text,/projects\/test\/overview/);
    assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
    assert.match(r.headers.get('cache-control'),/no-store/);
    r=await browser(readOnly,'https://knowledge.example.test/wiki/page/projects/test/overview');
    assert.equal(r.status,200);
    assert.match(r.text,/Initial synthetic content/);
    assert.match(r.text,/https:\/\/example.org\/source/);
    r=await browser(readOnly,'https://knowledge.example.test/wiki-find?q=Initial');
    assert.equal(r.status,200);
    assert.match(r.text,/Synthetic work/);
    r=await browser(readOnly,'https://knowledge.example.test/wiki-find?q=NotHere');
    assert.equal(r.status,200);
    assert.match(r.text,/No matching pages/);
    const blocked=await rpc(readOnly,call('knowledge_capture_draft',draft('should not write',1)));
    assert.equal(code(blocked),'FORBIDDEN');
    assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
  }finally{fx.close();}
});

test('browser denies forged identity, wrong origin, malformed paths and non-GET methods',async()=>{
  const fx=setup();
  try {
    await rpc(fx.env,call('knowledge_capture_draft',draft()));
    const env=browserEnv(fx.env);
    for(const ctx of [null,{},access('wrong-aud'),access(undefined,'stranger@example.test')]){
      const r=await browser(env,undefined,{ctx});
      assert.equal(r.status,403);
      assert.ok(!r.text.includes(draft().body));
    }
    for(const at of [
      'https://other.example.test/wiki',
      'https://knowledge.example.test/wiki?page=1',
      'https://knowledge.example.test/wiki-find?other=x',
      'https://knowledge.example.test/wiki-find?q=x&q=y',
      'https://knowledge.example.test/wiki/page/projects/test/overview?x=1',
      'https://knowledge.example.test/wiki/page/%2e%2e/secrets',
    ]){
      const r=await browser(env,at);
      assert.equal(r.status,404,at);
      assert.ok(!r.text.includes(draft().body));
    }
    const wrongMethod=await browser(env,undefined,{method:'POST'});
    assert.equal(wrongMethod.status,404);
    const missing=await browser(env,'https://knowledge.example.test/wiki/page/no/such-page');
    assert.equal(missing.status,404);
    assert.match(missing.text,/Page not found/);
  }finally{fx.close();}
});

test('browser escapes hostile text and rejects corrupted ciphertext and wrong owner keys',async()=>{
  const fx=setup();
  try{
    const hostile={...draft('<script>alert(1)</script>'),title:'<img src=x onerror=alert(1)>'};
    await rpc(fx.env,call('knowledge_capture_draft',hostile));
    const env=browserEnv(fx.env);
    let r=await browser(env,'https://knowledge.example.test/wiki/page/projects/test/overview');
    assert.equal(r.status,200);
    assert.match(r.text,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(r.text,/&lt;img src=x/);
    assert.ok(!r.text.includes('<script>'));
    assert.ok(!r.text.includes('<img src='));
    r=await browser({...env,KNOWLEDGE_DATA_KEY:'f'.repeat(64)});
    assert.equal(r.status,503);
    assert.ok(!r.text.includes(hostile.body));
    fx.db.db.prepare('UPDATE knowledge_pages SET sealed = ?').run('bad ciphertext');
    r=await browser(env);
    assert.equal(r.status,503);
    assert.ok(!r.text.includes(hostile.body));
  }finally{fx.close();}
});

test('owner browser verifies complete immutable history and reads earlier revisions without writes',async()=>{
  const fx=setup();
  try{
    await rpc(fx.env,call('knowledge_capture_draft',draft('Synthetic first',0)));
    await rpc(fx.env,call('knowledge_capture_draft',draft('Synthetic second',1)));
    const env=browserEnv(fx.env);
    const start='https://knowledge.example.test';
    let r=await browser(env,start+'/wiki/history/projects/test/overview');
    assert.equal(r.status,200);
    assert.match(r.text,/Version history/);
    assert.match(r.text,/Revision 2 · Current/);
    assert.match(r.text,/Revision 1/);
    r=await browser(env,start+'/wiki/revision/projects/test/overview/1');
    assert.equal(r.status,200);
    assert.match(r.text,/Synthetic first/);
    assert.ok(!r.text.includes('Synthetic second'));
    r=await browser(env,start+'/wiki/revision/projects/test/overview/2');
    assert.equal(r.status,200);
    assert.match(r.text,/Synthetic second/);
    r=await browser(env,start+'/wiki/revision/projects/test/overview/3');
    assert.equal(r.status,404);
    r=await browser(env,start+'/wiki/history/projects/test/overview',{ctx:access('wrong-aud')});
    assert.equal(r.status,403);
    r=await browser(env,start+'/wiki/revision/projects/test/overview/0');
    assert.equal(r.status,404);
    r=await browser(env,start+'/wiki/revision/projects/test/overview/999');
    assert.equal(r.status,404);
    assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,2);
  }finally{fx.close();}
});

test('owner browser refuses missing immutable history instead of showing partial content',async()=>{
  const fx=setup();
  try{
    await rpc(fx.env,call('knowledge_capture_draft',draft('Initial history',0)));
    await rpc(fx.env,call('knowledge_capture_draft',draft('Second history',1)));
    const real=fx.db.prepare.bind(fx.db);
    fx.db.prepare=sql=>sql.startsWith('SELECT path_key,version,sealed,created_at FROM knowledge_revisions ')
      ?{bind:()=>({all:async()=>({results:[]})})}:real(sql);
    const r=await browser(browserEnv(fx.env),'https://knowledge.example.test/wiki/history/projects/test/overview');
    assert.equal(r.status,503);
    assert.ok(!r.text.includes('Initial history'));
    assert.ok(!r.text.includes('Second history'));
  }finally{fx.close();}
});


const editorEnv=env=>({...env,
  KNOWLEDGE_BROWSER_ACK:'OWNER_ONLY_BROWSER_READ_V1',
  KNOWLEDGE_OWNER_EDITOR_ACK:'OWNER_ONLY_DRAFT_EDITOR_V1'});
async function editorPost(env,path,params,{ctx=access(),origin='https://knowledge.example.test',site='same-origin',referer=null}={}){
 const req=new Request('https://knowledge.example.test/wiki/edit/'+path,{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',
   ...(origin===null?{}:{Origin:origin}),
   ...(site===null?{}:{'Sec-Fetch-Site':site}),
   ...(referer===null?{}:{Referer:referer})},body:new URLSearchParams(params),
 });
 const res=await handlePrivateKnowledgeWorker(req,env,ctx);
 return {status:res.status,body:await res.text(),headers:res.headers};
}
function editorCsrf(html){
 const found=html.match(/name="csrf" value="([A-Za-z0-9_-]+)"/);
 assert.ok(found,'Form must have a signed CSRF proof');return found[1];
}
async function newDraftPost(env,params,{ctx=access(),mime='application/x-www-form-urlencoded',
  headers={}}={}) {
 const request=new Request('https://knowledge.example.test/wiki/new',{
   method:'POST',headers:{'Content-Type':mime,...headers},
   body:new URLSearchParams(params),
 });
 const response=await handlePrivateKnowledgeWorker(request,env,ctx);
 return {status:response.status,body:await response.text(),headers:response.headers};
}

test('owner-only new-draft navigation and signed creation persist exactly one encrypted revision',async()=>{
 const fx=setup();try {
   const env=editorEnv(fx.env);
   const readonly=browserEnv(fx.env);
   const readOnlyIndex=await browser(readonly);
   assert.doesNotMatch(readOnlyIndex.text,/href="\/wiki\/new"/);
   const blocked=await browser(readonly,'https://knowledge.example.test/wiki/new');
   assert.equal(blocked.status,404);
   const index=await browser(env);
   assert.equal(index.status,200);
   assert.match(index.text,/href="\/wiki\/new"/);
   let page=await browser(env,'https://knowledge.example.test/wiki/new');
   assert.equal(page.status,200);
   assert.match(page.text,/Create private draft/);
   assert.match(page.text,/action="\/wiki\/new"/);
   assert.match(page.headers.get('content-security-policy'),/form-action 'self'/);
   assert.match(page.headers.get('cache-control'),/no-store/);
   const csrf=editorCsrf(page.text);
   const payload={path:'notes/fictional-entry',title:'Fictional <draft>',
     body:'Synthetic <svg onload=alert(1)> text',csrf};
   const out=await newDraftPost(env,payload,{
     headers:{Origin:'null','Sec-Fetch-Site':'cross-site',Referer:'https://chatgpt.com/'},
   });
   assert.equal(out.status,200);
   assert.match(out.body,/Saved and verified · revision 1/);
   assert.match(out.body,/Fictional &lt;draft&gt;/);
   assert.match(out.body,/&lt;svg onload=alert\(1\)&gt;/);
   assert.doesNotMatch(out.body,/<svg onload/);
   assert.equal(out.headers.get('content-type')?.includes('text/html'),true);
   const saved=structured(await rpc(env,call('knowledge_read',{path:payload.path}))).page;
   assert.deepEqual({path:saved.path,title:saved.title,body:saved.body,
     version:saved.version,status:saved.status,sourceUrl:saved.sourceUrl},
     {path:payload.path,title:payload.title,body:payload.body,
      version:1,status:'draft',sourceUrl:null});
   const encrypted=fx.db.db.prepare('SELECT sealed FROM knowledge_pages').get().sealed;
   assert.doesNotMatch(encrypted,/Fictional|svg|notes/);
   assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,1);
   assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
   page=await browser(env,'https://knowledge.example.test/wiki/page/notes/fictional-entry');
   assert.equal(page.status,200);
   assert.match(page.text,/Edit draft/);
   const library=await browser(env);
   assert.match(library.text,/notes\/fictional-entry/);
 }finally{fx.close()}
});

test('owner-only new-draft form denies forged CSRF, wrong identity, invalid fields and malformed destinations',async()=>{
 const fx=setup();try {
   const env=editorEnv(fx.env);
   const csrf=editorCsrf((await browser(env,'https://knowledge.example.test/wiki/new')).text);
   const base={path:'notes/synthetic',title:'Synthetic record',body:'Fictional body',csrf};
   for(const badToken of ['AAAA','',null]){
     const response=await newDraftPost(env,{...base,csrf:badToken});
     assert.equal(response.status,403);
     assert.match(response.body,/EDITOR_CSRF_REQUIRED/);
   }
   for(const ctx of [null,access('wrong-aud'),access(undefined,'someone@example.test')]){
     const response=await newDraftPost(env,base,{ctx});
     assert.equal(response.status,403);
     assert.match(response.body,/ACCESS_REQUIRED/);
   }
   let response=await newDraftPost({...env,KNOWLEDGE_OWNER_EDITOR_ACK:''},base);
   assert.equal(response.status,404);
   response=await newDraftPost({...env,KNOWLEDGE_PRIVATE_WRITE_ACK:''},base);
   assert.equal(response.status,404);
   response=await newDraftPost(env,base,{mime:'text/plain'});
   assert.equal(response.status,415);
   for(const bad of [{path:'Notes/upper'}, {path:'notes//broken'},
      {path:'notes/../../secret'}, {title:' '}]){
     response=await newDraftPost(env,{...base,...bad});
     assert.equal(response.status,400);
   }
   response=await newDraftPost(env,{...base,body:'x'.repeat(16385)});
   assert.equal(response.status,413);
   response=await newDraftPost(env,{...base,unknown:'extra'});
   assert.equal(response.status,400);
   response=await newDraftPost(env,[['path',base.path],['title',base.title],
     ['body',base.body],['csrf',csrf],['csrf',csrf]]);
   assert.equal(response.status,400);
   response=await browser(env,'https://knowledge.example.test/wiki/new?bad=1');
   assert.equal(response.status,404);
   response=await browser(env,'https://wrong.example.test/wiki/new');
   assert.equal(response.status,404);
   // Creating and editing use different HMAC domains.
   const initial=structured(await rpc(env,call('knowledge_capture_draft',draft()))).version;
   assert.equal(initial,1);
   const editPage=await browser(env,'https://knowledge.example.test/wiki/edit/projects/test/overview');
   const editToken=editorCsrf(editPage.text);
   response=await newDraftPost(env,{...base,csrf:editToken});
   assert.equal(response.status,403);
   assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,1);
   assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
 }finally{fx.close()}
});

test('new-draft collision fails closed, retains encrypted history and returns copy-only escaped text',async()=>{
 const fx=setup();try{
   const env=editorEnv(fx.env);
   const csrf=editorCsrf((await browser(env,'https://knowledge.example.test/wiki/new')).text);
   const original={path:'notes/one',title:'Original',body:'First revision',csrf};
   const first=await newDraftPost(env,original);
   assert.equal(first.status,200);
   const attempt={...original,title:'Different',body:'<script>unsaved text</script>'};
   const conflict=await newDraftPost(env,attempt);
   assert.equal(conflict.status,409);
   assert.match(conflict.body,/Nothing was overwritten/);
   assert.match(conflict.body,/&lt;script&gt;unsaved text&lt;\/script&gt;/);
   assert.doesNotMatch(conflict.body,/<script>unsaved text/);
   assert.doesNotMatch(conflict.body,/<form\b/);
   assert.doesNotMatch(conflict.body,/Create private draft<\/button>/);
   assert.match(conflict.body,/readonly/);
   const record=structured(await rpc(env,call('knowledge_read',{path:original.path}))).page;
   assert.equal(record.title,'Original');
   assert.equal(record.body,'First revision');
   assert.equal(record.version,1);
   assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
   assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,1);
 }finally{fx.close()}
});

test('editor flag is separate from the read-only browser and disabled by default',async()=>{
 const fx=setup();try{
  await rpc(fx.env,call('knowledge_capture_draft',draft()));
  const readonly={...fx.env,KNOWLEDGE_BROWSER_ACK:'OWNER_ONLY_BROWSER_READ_V1'};
  const url='https://knowledge.example.test/wiki/edit/projects/test/overview';
  let r=await browser(readonly,url);
  assert.equal(r.status,404);
  const page=await browser(readonly,'https://knowledge.example.test/wiki/page/projects/test/overview');
  assert.equal(page.status,200);
  assert.ok(!page.text.includes('Edit draft</a>'));
  r=await browser(editorEnv(fx.env),url);
  assert.equal(r.status,200);
  assert.match(r.text,/Save new revision/);
  assert.match(r.text,/expectedVersion" value="1"/);
  assert.match(r.text,/role="search"|role="navigation"|Knowledge navigation/);
  assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
  assert.match(r.text,/@media\(max-width:740px\)/);
  assert.ok(!r.text.includes('<script'));
  const editpage=await browser(editorEnv(fx.env),'https://knowledge.example.test/wiki/page/projects/test/overview');
  assert.match(editpage.text,/Edit draft/);
  const blocked=await browser({...editorEnv(fx.env),KNOWLEDGE_PRIVATE_WRITE_ACK:''},url);
  assert.equal(blocked.status,404);
 }finally{fx.close();}
});
test('owner edit requires same-origin signed CSRF and verifies exact encrypted readback',async()=>{
 const fx=setup();try{
  await rpc(fx.env,call('knowledge_capture_draft',draft()));
  const env=editorEnv(fx.env),path='projects/test/overview',url='https://knowledge.example.test/wiki/edit/'+path;
  const page=await browser(env,url);
  const csrf=editorCsrf(page.text);
  const newBody='Verified Markdown entry with <script>not executable</script>';
  const params={title:'Synthetic edited title',body:newBody,expectedVersion:'1',csrf};
  let r=await editorPost(env,path,params);
  assert.equal(r.status,200);
  assert.match(r.body,/Saved and verified · revision 2/);
  assert.match(r.body,/Synthetic edited title/);
  assert.match(r.body,/&lt;script&gt;not executable&lt;\/script&gt;/);
  assert.ok(!r.body.includes('<script>'));
  assert.match(r.headers.get('cache-control'),/no-store/);
  const stored=structured(await rpc(env,call('knowledge_read',{path}))).page;
  assert.equal(stored.title,params.title);
  assert.equal(stored.body,newBody);
  assert.equal(stored.version,2);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,2);
  r=await editorPost(env,path,{...params,body:'Stale attempt'});
  assert.equal(r.status,409);
  assert.match(r.body,/NOT been saved/);
  assert.match(r.body,/Stale attempt/);
  assert.match(r.body,/Open latest revision to reconcile/);
  assert.ok(!r.body.includes('method="post"'));
  assert.ok(!r.body.includes('Save new revision'));
  assert.equal(structured(await rpc(env,call('knowledge_read',{path}))).page.version,2);
 }finally{fx.close();}
});
test('iPhone-style missing-Origin form POST requires signed CSRF and preserves revision semantics',async()=>{
 const fx=setup();try{
  await rpc(fx.env,call('knowledge_capture_draft',draft()));
  const env=editorEnv(fx.env),path='projects/test/overview';
  const csrf=editorCsrf((await browser(env,'https://knowledge.example.test/wiki/edit/'+path)).text);
  const original=structured(await rpc(env,call('knowledge_read',{path}))).page;
  const originalSealed=fx.db.db.prepare('SELECT sealed FROM knowledge_pages').get().sealed;
  const params={title:original.title,body:original.body,expectedVersion:'1',csrf};
  // Referrer-Policy: no-referrer can leave Referer absent too.
  for(const opts of [
   {origin:null,site:'same-origin'},
   {origin:null,site:null},
   {origin:null,site:'none'},
   {origin:null,site:null,referer:'https://knowledge.example.test/wiki/edit/'+path},
  ]){
   const r=await editorPost(env,path,params,opts);
   assert.equal(r.status,200,'Accept valid signed owner form when Origin omitted');
   assert.match(r.body,/No changes to save · revision 1/);
  }
  assert.equal(fx.db.db.prepare('SELECT sealed FROM knowledge_pages').get().sealed,originalSealed);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
  const r=await editorPost(env,path,{...params,body:'Synthetic iPhone save'}, {origin:null,site:null});
  assert.equal(r.status,200);
  assert.match(r.body,/Saved and verified · revision 2/);
  const stored=structured(await rpc(env,call('knowledge_read',{path}))).page;
  assert.equal(stored.body,'Synthetic iPhone save');
  assert.equal(stored.version,2);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,2);
  const stale=await editorPost(env,path,{...params,body:'Unsafe stale attempt'},{origin:null,site:'none'});
  assert.equal(stale.status,409);
  assert.match(stale.body,/NOT been saved/);
  assert.equal(structured(await rpc(env,call('knowledge_read',{path}))).page.version,2);
 }finally{fx.close();}
});
test('owner-signed in-app browser form saves with rewritten origin metadata and exact readback',async()=>{
 const fx=setup();try{
  await rpc(fx.env,call('knowledge_capture_draft',draft()));
  const env=editorEnv(fx.env),path='projects/test/overview';
  const csrf=editorCsrf((await browser(env,'https://knowledge.example.test/wiki/edit/'+path)).text);
  const original=structured(await rpc(env,call('knowledge_read',{path}))).page;
  const originalSealed=fx.db.db.prepare('SELECT sealed FROM knowledge_pages').get().sealed;
  const params={title:original.title,body:original.body,expectedVersion:'1',csrf};
  // The form's HMAC token is the authenticated intent proof, even when an
  // app's embedded WebView supplies synthetic or contradictory fetch metadata.
  for(const opts of [
   {origin:'null',site:'cross-site',referer:'https://chatgpt.com/'},
   {origin:'https://chatgpt.com',site:'same-site',referer:'https://chatgpt.com/'},
   {origin:null,site:'cross-site'},
   {origin:'https://another-app.example.test',site:null,referer:null},
  ]){
   const noChange=await editorPost(env,path,params,opts);
   assert.equal(noChange.status,200,'Signed owner POST should not rely on '+JSON.stringify(opts));
   assert.match(noChange.body,/No changes to save · revision 1/);
  }
  assert.equal(fx.db.db.prepare('SELECT sealed FROM knowledge_pages').get().sealed,originalSealed);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
  const strange={origin:'null',site:'cross-site',referer:'https://chatgpt.com/'};
  const changed=await editorPost(env,path,{...params,body:'Synthetic embedded browser update'},strange);
  assert.equal(changed.status,200);
  assert.match(changed.body,/Saved and verified · revision 2/);
  const saved=structured(await rpc(env,call('knowledge_read',{path}))).page;
  assert.equal(saved.version,2);
  assert.equal(saved.body,'Synthetic embedded browser update');
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,2);
  const stale=await editorPost(env,path,{...params,body:'Stale request must fail'},strange);
  assert.equal(stale.status,409);
  assert.match(stale.body,/NOT been saved/);
  assert.equal(structured(await rpc(env,call('knowledge_read',{path}))).page.version,2);
 }finally{fx.close();}
});
test('unchanged owner edit retains its revision without displaying a new-save confirmation',async()=>{
 const fx=setup();try{
  await rpc(fx.env,call('knowledge_capture_draft',draft()));
  const env=editorEnv(fx.env),path='projects/test/overview';
  const url='https://knowledge.example.test/wiki/edit/'+path;
  const page=await browser(env,url),csrf=editorCsrf(page.text);
  const original=structured(await rpc(env,call('knowledge_read',{path}))).page;
  const originalSealed=fx.db.db.prepare('SELECT sealed FROM knowledge_pages').get().sealed;
  const params={title:original.title,body:original.body,expectedVersion:'1',csrf};
  const r=await editorPost(env,path,params);
  assert.equal(r.status,200);
  assert.match(r.body,/Draft · revision 1/);
  assert.doesNotMatch(r.body,/Saved and verified/);
  assert.match(r.body,/No changes to save · revision 1/);
  assert.match(r.headers.get('cache-control'),/no-store/);
  const after=structured(await rpc(env,call('knowledge_read',{path}))).page;
  assert.deepEqual(after,original);
  assert.equal(fx.db.db.prepare('SELECT sealed FROM knowledge_pages').get().sealed,originalSealed);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
  const edited=await editorPost(env,path,{...params,body:original.body+'\\nChanged'});
  assert.equal(edited.status,200);
  assert.match(edited.body,/Saved and verified · revision 2/);
  assert.equal(structured(await rpc(env,call('knowledge_read',{path}))).page.version,2);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,2);
 }finally{fx.close();}
});
test('owner editor requires signed CSRF, correct owner and supported form type across request headers',async()=>{
 const fx=setup();try{
  await rpc(fx.env,call('knowledge_capture_draft',draft()));
  const env=editorEnv(fx.env),path='projects/test/overview';
  const csrf=editorCsrf((await browser(env,'https://knowledge.example.test/wiki/edit/'+path)).text);
  const params={title:'Forged',body:'Must not persist',expectedVersion:'1',csrf};
  for(const opts of [
   {origin:'https://attacker.example.test'},
   {origin:'null'},
   {site:'cross-site'},
   {site:'same-site'},
   {origin:null,referer:'https://attacker.example.test/forged'},
   {origin:null,site:null,referer:'not a valid URL'},
   {origin:null},
   {origin:null,site:null},
   {origin:null,site:'none'},
  ]){
   const forged=await editorPost(env,path,{...params,csrf:'AAAA'},opts);
   assert.equal(forged.status,403,'Forged CSRF must fail regardless of '+JSON.stringify(opts));
   assert.match(forged.body,/EDITOR_CSRF_REQUIRED/);
  }
  const forged=await editorPost(env,path,{...params,csrf:'AAAA'});
  assert.equal(forged.status,403);
  const stranger=await editorPost(env,path,params,{ctx:access(undefined,'other@example.test')});
  assert.equal(stranger.status,403);
  const readOnly=await editorPost({...env,KNOWLEDGE_OWNER_EDITOR_ACK:''},path,params);
  assert.equal(readOnly.status,404);
  const wrongMethod=await browser(env,'https://knowledge.example.test/wiki',{method:'POST'});
  assert.equal(wrongMethod.status,404);
  const wrongType=await handlePrivateKnowledgeWorker(new Request('https://knowledge.example.test/wiki/edit/'+path,
   {method:'POST',headers:{Origin:'https://knowledge.example.test','Content-Type':'text/plain'},body:'title=x'}),env,access());
  assert.equal(wrongType.status,415);
  const stored=structured(await rpc(env,call('knowledge_read',{path}))).page;
  assert.equal(stored.version,1);
  assert.equal(stored.body,draft().body);
 }finally{fx.close();}
});


const machineSecret='bb'.repeat(32);
const machineTime=Date.parse('2026-11-08T18:00:00Z');
const machineRepo=98452;
const machinePolicy={
  repoId:machineRepo,fullName:'devonalanakins/knowledge',number:36,
  sha:'a'.repeat(40),mergedAt:'2026-11-08T17:58:00Z',
  pathPrefix:'engineering/knowledge',
};
const receipt=()=>canonicalGitHubMergeReceipt(machinePolicy);
const machineEnv=env=>({
  ...env,KNOWLEDGE_MACHINE_CAPTURE_ACK:'APPROVED_PERSONAL_GITHUB_MERGE_V1',
  KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX:machineSecret,
  KNOWLEDGE_MACHINE_CAPTURE_REPO_ID:String(machineRepo),
  KNOWLEDGE_MACHINE_CAPTURE_REPO_NAME:'devonalanakins/knowledge',
  KNOWLEDGE_MACHINE_CAPTURE_PREFIX:'engineering/knowledge',
});
async function machinePayload(c=receipt(),key=machineSecret,at=machineTime){
 return {candidate:c,...await signCaptureReceipt(c,key,at)};
}
test('internal signed-merge writer saves one canonical owner draft and verifies exact D1 readback',async()=>{
 const fx=setup();try{
  const env=machineEnv(fx.env),candidate=receipt();
  const payload=await machinePayload(candidate);
  const first=await handlePrivateMergeCapture(env,payload,machineTime);
  assert.equal(first.status,'SAVED');
  assert.equal(first.version,1);
  const page=structured(await rpc(env,call('knowledge_read',{path:candidate.path}))).page;
  assert.equal(page.path,candidate.path);
  assert.equal(page.title,candidate.title);
  assert.equal(page.body,candidate.body);
  assert.equal(page.status,'draft');
  assert.equal(page.sourceUrl,candidate.sourceUrl);
  const duplicate=await handlePrivateMergeCapture(env,payload,machineTime);
  assert.equal(duplicate.status,'SAVED');
  assert.equal(duplicate.action,'unchanged');
  assert.equal(duplicate.version,1);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
 }finally{fx.close();}
});
test('private capture RPC is disabled by default and never bypasses inactive writer',async()=>{
 const fx=setup();try{
  const payload=await machinePayload();
  assert.equal((await handlePrivateMergeCapture(fx.env,payload,machineTime)).status,'FORBIDDEN');
  assert.equal((await handlePrivateMergeCapture({...machineEnv(fx.env),KNOWLEDGE_PRIVATE_WRITE_ACK:''},payload,machineTime)).status,'FORBIDDEN');
  assert.equal((await handlePrivateMergeCapture({...machineEnv(fx.env),KNOWLEDGE_SPACE:'professional'},payload,machineTime)).status,'FORBIDDEN');
  assert.equal((await handlePrivateMergeCapture({...machineEnv(fx.env),KNOWLEDGE_MACHINE_CAPTURE_ACK:''},payload,machineTime)).status,'FORBIDDEN');
  assert.equal((await handlePrivateMergeCapture({...machineEnv(fx.env),
    KNOWLEDGE_ACCEPTANCE_ONLY_ACK:'FICTIONAL_WRITE_ONLY_NO_PRIVATE_DATA',
    KNOWLEDGE_PRIVATE_WRITE_ACK:''},payload,machineTime)).status,'FORBIDDEN');
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
 }finally{fx.close();}
});
test('machine proof must be signed by an independent key, within the clock window',async()=>{
 const fx=setup();try{
  const env=machineEnv(fx.env),valid=await machinePayload();
  assert.equal((await handlePrivateMergeCapture(env,await machinePayload(receipt(),'cc'.repeat(32)),machineTime)).status,'FORBIDDEN');
  assert.equal((await handlePrivateMergeCapture(env,{...valid,proof:'AAAAAAAAAAAA'},machineTime)).status,'FORBIDDEN');
  assert.equal((await handlePrivateMergeCapture(env,valid,machineTime+300001)).status,'FORBIDDEN');
  assert.equal((await handlePrivateMergeCapture(env,{...valid,issuedAt:machineTime+1},machineTime)).status,'FORBIDDEN');
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
 }finally{fx.close();}
});
test('cannot forge cross-project path, body, title, status or repository identity even with machine key',async()=>{
 const fx=setup();try{
  const env=machineEnv(fx.env);
  const base=receipt();
  const variants=[
    {...base,path:'private/family/records'},
    {...base,path:'engineering/knowledge/pr-37'},
    {...base,title:'Verified deployed production'},
    {...base,body:base.body+'\\nPHI'},
    {...base,sourceUrl:'https://github.com/devonalanakins/other/pull/36'},
    {...base,scope:'clinical'},
    {...base,classification:'clinical'},
    {...base,sourceAuthenticated:false},
    {...base,eventKey:'github:pr-merge:99999:36:'+'a'.repeat(40)},
    {...base,mergedAt:'2020-01-01T00:00:00.000Z'},
    {...base,status:'approved'},
  ];
  for(const variant of variants){
    const answer=await handlePrivateMergeCapture(env,await machinePayload(variant),machineTime);
    assert.equal(answer.status,'FORBIDDEN');
  }
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
 }finally{fx.close();}
});
test('existing conflicting owner draft is preserved, without new revision or private content leak',async()=>{
 const fx=setup();try{
  const c=receipt(),env=machineEnv(fx.env);
  assert.equal(structured(await rpc(fx.env,call('knowledge_capture_draft',{
    path:c.path,title:'Owner decision',body:'Protected existing work',expectedVersion:0
  }))).version,1);
  const outcome=await handlePrivateMergeCapture(env,await machinePayload(c),machineTime);
  assert.deepEqual(outcome,{status:'BLOCKED',reason:'EXISTING_RECORD_CONFLICT'});
  const page=structured(await rpc(fx.env,call('knowledge_read',{path:c.path}))).page;
  assert.equal(page.body,'Protected existing work');
  assert.equal(page.version,1);
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n,1);
 }finally{fx.close();}
});
test('private capture reports failed encrypted D1 write as UNSAVED',async()=>{
 const fx=setup();try{
  // Initialize the original encryption instance marker before injecting failure.
  await rpc(fx.env,call('knowledge_list'));
  const original=fx.db.prepare.bind(fx.db);
  fx.db.prepare=sql=>sql.startsWith('INSERT INTO knowledge_pages')
    ? {bind:()=>({run:async()=>{throw Error('fictional disk failure');}})}:original(sql);
  const result=await handlePrivateMergeCapture(machineEnv(fx.env),await machinePayload(),machineTime);
  assert.equal(result.status,'PENDING_KNOWLEDGE_UNSAVED');
  assert.equal(result.reason,'WRITE_UNAVAILABLE');
  assert.equal(fx.db.db.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n,0);
 }finally{fx.close();}
});
