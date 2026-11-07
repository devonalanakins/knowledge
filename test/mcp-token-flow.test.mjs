import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { KnowledgeStore } from '../src/knowledge.mjs';
import { createKnowledgeServer } from '../src/server.mjs';
import { MCP_PROTOCOL_VERSION } from '../src/mcp.mjs';
import { createMcpAccessTokenVerifier } from '../src/mcp-token-auth.mjs';

const ownerToken = 'O'.repeat(48);
const legacyAgentToken = 'A'.repeat(48);
const {publicKey, privateKey} = generateKeyPairSync('ed25519');
const issuer='https://issuer.example.test',audience='https://knowledge.example.test/mcp';
const publicKeys=[{...publicKey.export({format:'jwk'}),kid:'synthetic-key',alg:'EdDSA'}];
const now=()=>Date.now();
const verifier=createMcpAccessTokenVerifier({issuer,audience,publicKeys,allowedSubjects:['devon-owner'],now});
const enc=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
function token(scopes='knowledge.read knowledge.write', overrides={}){
  const seconds=Math.floor(now()/1000);
  const header=enc({alg:'EdDSA',typ:'at+jwt',kid:'synthetic-key'});
  const claims=enc({iss:issuer,aud:audience,sub:'devon-owner',iat:seconds-5,nbf:seconds-5,exp:seconds+120,scope:scopes,...overrides});
  const message=header+'.'+claims;
  return message+'.'+sign(null,Buffer.from(message),privateKey).toString('base64url');
}
async function fixture(run){
  const store=new KnowledgeStore(':memory:');
  store.createSpace('personal','Synthetic personal');
  store.createSpace('family','Synthetic family');
  store.capturePage('family',{path:'family/private',title:'Isolated private page',body:'NEVER LEAK THIS SYNTHETIC PAGE'});
  const server=createKnowledgeServer(store,{ownerToken,agentToken:legacyAgentToken,space:'personal',mcpTokenVerifier:verifier});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  let id=0;
  const call=async(method,params={},jwt=token(),extra={})=>{
    const response=await fetch(url+'/mcp',{method:'POST',headers:{
      'Content-Type':'application/json',Accept:'application/json, text/event-stream',
      'MCP-Protocol-Version':MCP_PROTOCOL_VERSION,Authorization:'Bearer '+jwt,...extra},
      body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
    return {status:response.status,body:await response.json()};
  };
  try {return await run({store,url,call});}
  finally {await new Promise(resolve=>server.close(resolve));store.close();}
}

test('G9 signed synthetic OAuth-style token drives MCP initialize → capture → search → read',()=>fixture(async({call,store})=>{
  let result=await call('initialize',{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'g9-local-client',version:'1'}});
  assert.equal(result.status,200);
  assert.equal(result.body.result.protocolVersion,MCP_PROTOCOL_VERSION);
  result=await call('tools/list');
  assert.equal(result.body.result.tools.some(t=>t.name==='knowledge_capture_draft'),true);
  result=await call('tools/call',{name:'knowledge_capture_draft',arguments:{
    path:'projects/g9/synthetic',title:'G9 synthetic end-to-end',body:'Only fictional verified evidence.',sourceUrl:'https://example.org/synthetic'}});
  assert.equal(result.status,200);
  assert.equal(result.body.result.structuredContent.action,'created');
  assert.equal(result.body.result.structuredContent.version,1);
  result=await call('tools/call',{name:'knowledge_search',arguments:{query:'fictional'}});
  assert.deepEqual(result.body.result.structuredContent.results.map(x=>x.path),['projects/g9/synthetic']);
  result=await call('tools/call',{name:'knowledge_read',arguments:{path:'projects/g9/synthetic'}});
  assert.equal(result.body.result.structuredContent.page.body,'Only fictional verified evidence.');
  assert.equal(result.body.result.structuredContent.page.sourceUrl,'https://example.org/synthetic');
  const repeat=await call('tools/call',{name:'knowledge_capture_draft',arguments:{
    path:'projects/g9/synthetic',title:'G9 synthetic end-to-end',body:'Only fictional verified evidence.',sourceUrl:'https://example.org/synthetic'}});
  assert.equal(repeat.body.result.structuredContent.action,'unchanged');
  assert.equal(store.getPage('personal','projects/g9/synthetic').version,1);
}));

test('G9 read-only OAuth role cannot capture, and sibling workspace cannot leak',()=>fixture(async({call})=>{
  let response=await call('tools/list',{},token('knowledge.read'));
  assert.equal(response.status,200);
  assert.equal(response.body.result.tools.some(t=>t.name==='knowledge_capture_draft'),false);
  response=await call('tools/call',{name:'knowledge_capture_draft',arguments:{path:'x',title:'x',body:'x'}},token('knowledge.read'));
  assert.equal(response.body.result.isError,true);
  response=await call('tools/call',{name:'knowledge_search',arguments:{query:'NEVER LEAK THIS'}});
  assert.deepEqual(response.body.result.structuredContent.results,[]);
  response=await call('tools/call',{name:'knowledge_capture_draft',arguments:{space:'family',path:'x',title:'x',body:'x'}});
  assert.equal(response.body.error.code,-32602);
}));

test('G9 denies static-token fallback, invalid JWT, expired JWT and bypass routes in oauth mode',()=>fixture(async({call,url})=>{
  for(const credential of [legacyAgentToken, ownerToken, 'invalid-signature',token('knowledge.read knowledge.write',{aud:'https://other.example.test/mcp'}),token('knowledge.read',{exp:Math.floor(now()/1000)-100})]){
    const response=await call('tools/list',{},credential);
    assert.equal(response.status,401);
    assert.equal(response.body.error,'UNAUTHORIZED');
  }
  const direct=await fetch(url+'/api/v1/capture',{method:'POST',headers:{Authorization:'Bearer '+legacyAgentToken,'Content-Type':'application/json'},body:'{}'});
  assert.equal(direct.status,404);
  // Browser login and legacy links must not bypass the new JWT-only MCP boundary.
  for(const route of ['/login','/','/s/'+('x'.repeat(43)),'/w/personal/secret']) {
    const result=await fetch(url+route,{redirect:'manual'});
    assert.equal(result.status,404,route);
  }
  const oldLogin=await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'token='+ownerToken,redirect:'manual'});
  assert.equal(oldLogin.status,404);
}));
