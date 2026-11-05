import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { KnowledgeStore } from '../src/knowledge.mjs';
import { createKnowledgeServer } from '../src/server.mjs';
import { createMcpAccessTokenVerifier } from '../src/mcp-token-auth.mjs';
import { MCP_PROTOCOL_VERSION } from '../src/mcp.mjs';
import { MCP_RESOURCE_METADATA_PATH } from '../src/mcp-resource.mjs';
const issuer='https://auth.example.test',resource='https://wiki.example.test/mcp';
const ownerToken='local-owner-token-OOOOOOOOOOOOOOOOOOOOOOOOOOOO',agentToken='local-agent-token-AAAAAAAAAAAAAAAAAAAAAAAA';
const keys=generateKeyPairSync('ed25519'),kid='g9b-ephemeral-test-key';
const publicKeys=[{...keys.publicKey.export({format:'jwk'}),kid,alg:'EdDSA'}];
const verifier=createMcpAccessTokenVerifier({issuer,audience:resource,publicKeys,allowedSubjects:['fictional-test-user']});
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function token(scope='knowledge.read') {
  const sec=Math.floor(Date.now()/1000);
  const signed=enc({alg:'EdDSA',typ:'at+jwt',kid})+'.'+enc({iss:issuer,aud:resource,sub:'fictional-test-user',
    iat:sec-10,nbf:sec-10,exp:sec+180,scope});
  return signed+'.'+sign(null,Buffer.from(signed),keys.privateKey).toString('base64url');
}
async function fixture(fn,override={}) {
  const store=new KnowledgeStore(':memory:');
  store.createSpace('personal','Synthetic personal');store.createSpace('family','Synthetic family');
  store.capturePage('family',{path:'family/secret',title:'Fake secret',body:'NO_CROSS_SCOPE_LEAK'});
  const server=createKnowledgeServer(store,{ownerToken,agentToken,space:'personal',mcpTokenVerifier:verifier,
    mcpResource:{resource,authorizationServers:[issuer]},...override});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  const call=async(method,params={},jwt,extra={})=>{
    const r=await fetch(url+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',
      Accept:'application/json, text/event-stream','MCP-Protocol-Version':MCP_PROTOCOL_VERSION,
      ...(jwt?{Authorization:'Bearer '+jwt}:{}),...extra},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    return {status:r.status,challenge:r.headers.get('www-authenticate'),body:await r.json()};
  };
  try{await fn({url,store,call});}finally{await new Promise(r=>server.close(r));store.close()}
}
test('G9b both well-known metadata URLs are discoverable without a credential',()=>fixture(async({url})=>{
  for(const path of [MCP_RESOURCE_METADATA_PATH,'/.well-known/oauth-protected-resource']){
    const res=await fetch(url+path);
    assert.equal(res.status,200);
    assert.match(res.headers.get('content-type'),/^application\/json/);
    assert.equal(res.headers.get('cache-control'),'no-store');
    assert.deepEqual(await res.json(),{resource,authorization_servers:[issuer],
      scopes_supported:['knowledge.read','knowledge.write'],bearer_methods_supported:['header']});
  }
}));
test('G9b untrusted and absent tokens receive metadata challenge',()=>fixture(async({call})=>{
  for(const jwt of [undefined,'bad.jwt']){
    const res=await call('tools/list',{},jwt);
    assert.equal(res.status,401);
    assert.equal(res.body.error,'UNAUTHORIZED');
    assert.equal(res.challenge,'Bearer resource_metadata="https://wiki.example.test/.well-known/oauth-protected-resource/mcp", scope="knowledge.read"');
  }
}));
test('G9b read-only token cannot capture and gets explicit write escalation challenge',()=>fixture(async({call,store})=>{
  const jwt=token('knowledge.read');
  const tools=await call('tools/list',{},jwt);
  assert.equal(tools.status,200);
  assert.equal(tools.body.result.tools.some(t=>t.name==='knowledge_capture_draft'),false);
  const write=await call('tools/call',{name:'knowledge_capture_draft',arguments:{path:'projects/demo',title:'Demo',body:'Should not persist'}},jwt);
  assert.equal(write.status,403);
  assert.equal(write.body.error,'INSUFFICIENT_SCOPE');
  assert.equal(write.challenge,'Bearer error="insufficient_scope", resource_metadata="https://wiki.example.test/.well-known/oauth-protected-resource/mcp", scope="knowledge.read knowledge.write"');
  assert.deepEqual(store.listPages('personal'),[]);
}));
test('G9b upgraded independently signed token allows synthetic capture→search→read without cross-scope leakage',()=>fixture(async({call,store})=>{
  const jwt=token('knowledge.read knowledge.write');
  let r=await call('initialize',{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'synthetic',version:'1'}},jwt);
  assert.equal(r.status,200);
  r=await call('tools/call',{name:'knowledge_capture_draft',arguments:{path:'projects/g9b',title:'G9b fictional test',body:'Only fictional source evidence.',sourceUrl:'https://example.org/evidence'}},jwt);
  assert.equal(r.status,200);assert.equal(r.body.result.structuredContent.action,'created');
  r=await call('tools/call',{name:'knowledge_search',arguments:{query:'fictional'}},jwt);
  assert.deepEqual(r.body.result.structuredContent.results.map(p=>p.path),['projects/g9b']);
  r=await call('tools/call',{name:'knowledge_read',arguments:{path:'projects/g9b'}},jwt);
  assert.equal(r.body.result.structuredContent.page.body,'Only fictional source evidence.');
  r=await call('tools/call',{name:'knowledge_search',arguments:{query:'NO_CROSS_SCOPE_LEAK'}},jwt);
  assert.deepEqual(r.body.result.structuredContent.results,[]);
  assert.equal(store.getPage('personal','projects/g9b').version,1);
}));
test('G9b startup rejects advertised metadata without verified token mode',()=>{
  const store=new KnowledgeStore(':memory:');store.createSpace('personal','Test');
  try{assert.throws(()=>createKnowledgeServer(store,{ownerToken,agentToken,space:'personal',
    mcpResource:{resource,authorizationServers:[issuer]}}),/token verifier/)}
  finally{store.close()}
});
