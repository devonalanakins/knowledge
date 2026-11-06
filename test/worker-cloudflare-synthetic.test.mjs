import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker, {handleSyntheticWorkerMcp} from '../src/worker-cloudflare-synthetic.mjs';
import {MCP_PROTOCOL_VERSION} from '../src/mcp.mjs';

const resource = 'https://knowledge.example.test/mcp';
const env = Object.freeze({
  KNOWLEDGE_WORKER_SYNTHETIC_ACK: 'SYNTHETIC_ONLY_NO_PRIVATE_DATA',
  KNOWLEDGE_WORKER_RESOURCE: resource,
  KNOWLEDGE_ACCESS_AUD: 'fictional-access-audience',
  KNOWLEDGE_ACCESS_EMAIL: 'owner@example.test',
});
const access = (aud = env.KNOWLEDGE_ACCESS_AUD, email = env.KNOWLEDGE_ACCESS_EMAIL) => ({
  access: {aud, getIdentity: async () => ({email})},
});
const makeMessage = (method, params = {}, id = 1) => ({jsonrpc:'2.0',id,method,params});
async function rpc(message, {
  at = resource, config = env, ctx = access(),
  method = 'POST', headers = {}, body = JSON.stringify(message),
}={}) {
  const req = new Request(at, {
    method, headers:{
      'Content-Type':'application/json',
      'Accept':'application/json, text/event-stream',
      'MCP-Protocol-Version':MCP_PROTOCOL_VERSION,
      ...headers,
    }, ...(method === 'POST' ? {body} : {}),
  });
  const response = await handleSyntheticWorkerMcp(req, config, ctx);
  return {status:response.status,headers:response.headers,
    json: response.status === 202 ? null : await response.json()};
}

test('G9i Cloudflare Worker is disabled unless explicitly configured and matched',async () => {
  for (const config of [undefined, {}, {...env,KNOWLEDGE_WORKER_SYNTHETIC_ACK:''},
    {...env,KNOWLEDGE_WORKER_RESOURCE:'http://knowledge.example.test/mcp'},
    {...env,KNOWLEDGE_WORKER_RESOURCE:'https://knowledge.example.test/mcp?secret=1'},
    {...env,KNOWLEDGE_ACCESS_AUD:'x'},
    {...env,KNOWLEDGE_ACCESS_EMAIL:'Owner@example.test'}
  ]) {
    const r = await rpc(makeMessage('tools/list'),{config});
    assert.equal(r.status,503);
  }
  for (const at of ['https://evil.example.test/mcp',
    'https://knowledge.example.test/health',
    'https://knowledge.example.test/mcp?x=1']) {
    const r = await rpc(makeMessage('tools/list'),{at});
    assert.equal(r.status,404);
  }
});

test('G9i Worker requires authenticated Access runtime context, audience and explicitly allowed identity',async () => {
  const msg = makeMessage('tools/list');
  for (const ctx of [undefined,{},access('wrong-aud'),
    access(env.KNOWLEDGE_ACCESS_AUD, 'intruder@example.test'),
    {access:{aud:env.KNOWLEDGE_ACCESS_AUD,getIdentity:async()=>{throw Error('provider unavailable')}}},
    {access:{aud:env.KNOWLEDGE_ACCESS_AUD,getIdentity:async()=>({})}},
  ]) {
    const r=await rpc(msg,{ctx,headers:{'Cf-Access-Jwt-Assertion':'forged-header'}});
    assert.equal(r.status,403);
    assert.equal(r.json.error,'ACCESS_REQUIRED');
  }
  const ok = await rpc(msg,{ctx:access(env.KNOWLEDGE_ACCESS_AUD,'OWNER@EXAMPLE.TEST')});
  assert.equal(ok.status,200);
  assert.equal(ok.json.result.tools.length,3);
});

test('G9i Worker MCP initialization, metadata, read, search and read-only write denial',async () => {
  const init = await rpc(makeMessage('initialize',{
    protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'synthetic',version:'1'},
  }));
  assert.equal(init.status,200);
  assert.match(init.json.result.instructions,/read-only/);
  assert.equal(init.json.result.protocolVersion,MCP_PROTOCOL_VERSION);
  let r = await rpc(makeMessage('tools/list'));
  assert.equal(r.status,200);
  assert.deepEqual(r.json.result.tools.map(x=>x.name),[
    'knowledge_list','knowledge_search','knowledge_read']);
  for(const tool of r.json.result.tools) {
    assert.deepEqual(tool._meta.securitySchemes,[{type:'oauth2',scopes:[]}]);
    assert.equal(tool.annotations.readOnlyHint,true);
  }

  r = await rpc(makeMessage('tools/call',{name:'knowledge_read',
    arguments:{path:'demo/worker-readonly'}}));
  assert.equal(r.status,200);
  assert.match(r.json.result.structuredContent.page.body,/no Notion/);
  r = await rpc(makeMessage('tools/call',{name:'knowledge_search',
    arguments:{query:'fictional'}}));
  assert.deepEqual(r.json.result.structuredContent.results.map(x=>x.path),['demo/worker-readonly']);
  r = await rpc(makeMessage('tools/call',{name:'knowledge_list',arguments:{}}));
  assert.equal(r.json.result.structuredContent.pages.length,1);
  r = await rpc(makeMessage('tools/call',{name:'knowledge_capture_draft',
    arguments:{path:'demo/unauthorized',title:'Unauthorized',body:'No writes'}}));
  assert.equal(r.status,200);
  assert.equal(r.json.result.isError,true);
  r = await rpc(makeMessage('tools/call',{name:'knowledge_read',
    arguments:{path:'demo/unauthorized'}}));
  assert.equal(r.json.result.isError,true);
  r = await rpc(makeMessage('tools/call',{name:'knowledge_read',
    arguments:{path:'family/private'}}));
  assert.equal(r.json.result.isError,true);
  r = await rpc(makeMessage('tools/call',{name:'knowledge_search',
    arguments:{query:'NO_PRIVATE_RECORD'}}));
  assert.deepEqual(r.json.result.structuredContent.results,[]);
  assert.equal(worker.fetch,handleSyntheticWorkerMcp);
});

test('G9i rejects unsupported methods, content types, invalid protocol and oversized payloads',async () => {
  let r=await rpc(makeMessage('tools/list'),{method:'GET'});
  assert.equal(r.status,405);
  r=await rpc(makeMessage('tools/list'),{headers:{'Content-Type':'text/plain'}});
  assert.equal(r.status,415);
  r=await rpc(makeMessage('tools/list'),{headers:{Accept:'text/html'}});
  assert.equal(r.status,406);
  r=await rpc(makeMessage('tools/list'),{headers:{'MCP-Protocol-Version':'2020-01-01'}});
  assert.equal(r.status,400);
  r=await rpc(makeMessage('tools/list'),{body:'invalid-json'});
  assert.equal(r.status,400);
  r=await rpc(makeMessage('tools/list'),{body:JSON.stringify(makeMessage('tools/list'))+' '.repeat(40_000)});
  assert.equal(r.status,413);
  r=await rpc(makeMessage('notifications/initialized'),{
    body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  assert.equal(r.status,202);
  assert.equal(r.json,null);
});
