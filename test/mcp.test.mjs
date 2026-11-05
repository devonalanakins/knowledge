import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { KnowledgeStore } from '../src/knowledge.mjs';
import { createKnowledgeServer } from '../src/server.mjs';
import { MCP_PROTOCOL_VERSION } from '../src/mcp.mjs';

const owner='O'.repeat(48),agent='A'.repeat(48);
const headers=(token=agent)=>({'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer '+token,'MCP-Protocol-Version':MCP_PROTOCOL_VERSION});
async function withServer(fn){
 const store=new KnowledgeStore();store.createSpace('personal','Personal test');store.createSpace('other','Other test');
 const server=createKnowledgeServer(store,{ownerToken:owner,agentToken:agent,space:'personal'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;let id=0;
 const rpc=async(method,params={},token=agent,extra={})=>{
  const res=await fetch(url+'/mcp',{method:'POST',headers:{...headers(token),...extra},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  return {status:res.status,body:await res.json()};
 };
 try{return await fn({store,url,rpc})}finally{await new Promise(r=>server.close(r));store.close()}
}
const draft=(body='Grounded synthetic evidence')=>({path:'projects/example/overview',title:'Synthetic project',body,sourceUrl:'https://example.org/evidence'});

test('MCP initialize and role-specific tools/list',()=>withServer(async({rpc})=>{
 const init=await rpc('initialize',{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'test',version:'1'}});
 assert.equal(init.status,200);assert.equal(init.body.result.protocolVersion,MCP_PROTOCOL_VERSION);
 const agentList=await rpc('tools/list');
 assert.deepEqual(agentList.body.result.tools.map(x=>x.name),['knowledge_list','knowledge_search','knowledge_read','knowledge_capture_draft']);
 const ownerList=await rpc('tools/list',{},owner);
 assert.deepEqual(ownerList.body.result.tools.map(x=>x.name),['knowledge_list','knowledge_search','knowledge_read']);
 assert.equal(agentList.body.result.tools.every(t=>t.inputSchema.additionalProperties===false),true);
}));

test('MCP auth, origin, host, accept and protocol guards fail closed',()=>withServer(async({url,rpc})=>{
 const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'});
 const send=h=>fetch(url+'/mcp',{method:'POST',headers:h,body});
 assert.equal((await send({...headers(),Authorization:'Bearer wrong'})).status,401);
 assert.equal((await send({...headers(),Origin:'https://evil.example'})).status,403);
 assert.equal((await send({...headers(),Origin:'null'})).status,403);
 const host=await new Promise((resolve,reject)=>{
   const dest=new URL(url),request=httpRequest({hostname:'127.0.0.1',port:Number(dest.port),path:'/mcp',method:'POST',headers:{...headers(),Host:'evil.example','Content-Length':Buffer.byteLength(body)}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode))});
   request.on('error',reject);request.end(body);
 });
 assert.equal(host,403);
 assert.equal((await send({...headers(),Accept:'application/json'})).status,406);
 assert.equal((await send({...headers(),'Content-Type':'text/plain'})).status,415);
 assert.equal((await fetch(url+'/mcp',{method:'GET'})).status,405);
 const wrong=await rpc('tools/list',{},agent,{'MCP-Protocol-Version':'2020-01-01'});
 assert.equal(wrong.status,400);assert.equal(wrong.body.error.code,-32001);
}));

test('MCP agent draft, read, search, idempotency and server-assigned scope',()=>withServer(async({store,rpc})=>{
 store.capturePage('other',{path:'other/secret',title:'Other sensitive fake',body:'Cross-boundary top secret'});
 let r=await rpc('tools/call',{name:'knowledge_capture_draft',arguments:draft()});
 assert.equal(r.body.result.structuredContent.action,'created');
 assert.equal(r.body.result.structuredContent.status,'draft');
 r=await rpc('tools/call',{name:'knowledge_search',arguments:{query:'synthetic'}});
 assert.deepEqual(r.body.result.structuredContent.results.map(x=>x.path),['projects/example/overview']);
 r=await rpc('tools/call',{name:'knowledge_search',arguments:{query:'Cross-boundary'}});
 assert.deepEqual(r.body.result.structuredContent.results,[]);
 r=await rpc('tools/call',{name:'knowledge_read',arguments:{path:'projects/example/overview'}});
 assert.equal(r.body.result.structuredContent.page.sourceUrl,'https://example.org/evidence');
 r=await rpc('tools/call',{name:'knowledge_list',arguments:{limit:10}},owner);
 assert.equal(r.body.result.structuredContent.pages.length,1);
 r=await rpc('tools/call',{name:'knowledge_capture_draft',arguments:{path:'projects/example/overview',title:'Synthetic project',body:'Updated evidence'}});
 assert.equal(r.body.result.structuredContent.version,2);
 assert.equal(store.getPage('personal','projects/example/overview').sourceUrl,'https://example.org/evidence');
 r=await rpc('tools/call',{name:'knowledge_capture_draft',arguments:{path:'projects/example/overview',title:'Synthetic project',body:'Updated evidence'}});
 assert.equal(r.body.result.structuredContent.action,'unchanged');
}));

test('MCP cannot forge approval, cross-workspace access, share, or overwrite human review',()=>withServer(async({store,rpc})=>{
 let r=await rpc('tools/call',{name:'knowledge_capture_draft',arguments:draft()},owner);
 assert.equal(r.body.result.isError,true);
 r=await rpc('tools/call',{name:'knowledge_capture_draft',arguments:{...draft(),space:'other'}});
 assert.equal(r.body.error.code,-32602);
 r=await rpc('tools/call',{name:'knowledge_capture_draft',arguments:{...draft(),status:'recorded'}});
 assert.equal(r.body.error.code,-32602);
 r=await rpc('tools/call',{name:'share_page',arguments:{}});
 assert.equal(r.body.error.code,-32602);
 const initial=store.capturePage('personal',draft());
 store.updateRecord('personal',initial.id,1,{status:'recorded'});
 r=await rpc('tools/call',{name:'knowledge_capture_draft',arguments:draft('Unapproved overwrite')});
 assert.equal(r.body.result.isError,true);
 assert.match(r.body.result.content[0].text,/REVIEW_REQUIRED/);
 assert.equal(store.getPage('personal',initial.path).body,initial.body);
}));

test('MCP validates RPC envelopes, tool arguments and initialized notification',()=>withServer(async({url,rpc})=>{
 let r=await rpc('tools/execute',{});assert.equal(r.body.error.code,-32601);
 r=await rpc('tools/call',{name:'knowledge_read',arguments:{path:34}});assert.equal(r.body.error.code,-32602);
 r=await rpc('tools/call',{name:'knowledge_read',arguments:{path:'missing/page'}});assert.equal(r.body.result.isError,true);
 r=await rpc('tools/call',{name:'knowledge_list',arguments:{limit:5000}});assert.equal(r.body.error.code,-32602);
 const notified=await fetch(url+'/mcp',{method:'POST',headers:headers(),body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
 assert.equal(notified.status,202);
 const invalid=await fetch(url+'/mcp',{method:'POST',headers:headers(),body:'[]'});
 assert.equal((await invalid.json()).error.code,-32600);
}));
