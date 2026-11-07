import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign } from 'node:crypto';
import { KnowledgeStore } from '../src/knowledge.mjs';
import { createKnowledgeServer } from '../src/server.mjs';
import { createCloudflareAccessReadVerifier } from '../src/cloudflare-access-auth.mjs';
import { MCP_PROTOCOL_VERSION } from '../src/mcp.mjs';

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://fictional.cloudflareaccess.com',appAudience='fictional-app-audience';
const identity='synthetic-principal';
const verifier=createCloudflareAccessReadVerifier({
  teamIssuer:issuer,appAudience,allowedSubjects:[identity],
  publicKeys:[{...keys.publicKey.export({format:'jwk'}),kid:'cloudflare-fake-key',alg:'RS256'}],
});
const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function assertion(fields={}) {
 const sec=Math.floor(Date.now()/1000);
 const body=enc({iss:issuer,aud:[appAudience],sub:identity,iat:sec-5,exp:sec+180,...fields});
 const header=enc({alg:'RS256',kid:'cloudflare-fake-key'});
 const content=header+'.'+body;
 return content+'.'+sign('RSA-SHA256',Buffer.from(content),keys.privateKey).toString('base64url');
}
async function setup(callback) {
 const store=new KnowledgeStore(':memory:');store.createSpace('personal','Synthetic');
 store.capturePage('personal',{path:'synthetic/start',title:'Start',body:'Synthetic-only note'});
 const server=createKnowledgeServer(store,{ownerToken:'O'.repeat(48),agentToken:'A'.repeat(48),
   space:'personal',mcpTokenVerifier:verifier});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const rpc=async(name,params={},token=assertion())=>{
  const res=await fetch(url+'/mcp',{method:'POST',
    headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',
      Authorization:'Bearer opaque-synthetic-token','MCP-Protocol-Version':MCP_PROTOCOL_VERSION,
      'Cf-Access-Jwt-Assertion':token},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:params}})});
  return {status:res.status,body:await res.json()};
 };
 try{await callback({store,url,rpc});}
 finally{await new Promise(resolve=>server.close(resolve));store.close();}
}
test('G9f HTTP MCP accepts signed origin assertion for reading and denies all writes',()=>setup(async({store,rpc})=>{
 const read=await rpc('knowledge_read',{path:'synthetic/start'});
 assert.equal(read.status,200);
 assert.equal(read.body.result.structuredContent.page.body,'Synthetic-only note');
 const write=await rpc('knowledge_capture_draft',{path:'synthetic/must-not-exist',title:'Blocked',body:'No'});
 assert.equal(write.status,200);
 assert.equal(write.body.result.isError,true);
 assert.equal(store.getPage('personal','synthetic/must-not-exist'),null);
 const forged=await rpc('knowledge_read',{path:'synthetic/start'},assertion({sub:'unapproved-principal'}));
 assert.equal(forged.status,401);
}));
