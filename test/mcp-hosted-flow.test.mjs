import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSyntheticMcpConfig, createSyntheticMcpPreview, SYNTHETIC_ACKNOWLEDGMENT } from '../src/mcp-hosted-preview.mjs';
import { MCP_PROTOCOL_VERSION } from '../src/mcp.mjs';

const issuer='https://issuer.example.test', resource='https://wiki.example.test/mcp';
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'knowledge-g9d-http-'));
  const keys=generateKeyPairSync('ed25519');
  const jwks=join(dir,'keys.json'),principals=join(dir,'principals.json');
  writeFileSync(jwks,JSON.stringify({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'test-key',alg:'EdDSA'}]}),{mode:0o600});
  writeFileSync(principals,JSON.stringify({allowedSubjects:['synthetic-user']}),{mode:0o600});
  const config=loadSyntheticMcpConfig({KNOWLEDGE_SYNTHETIC_ACK:SYNTHETIC_ACKNOWLEDGMENT,
    KNOWLEDGE_MCP_RESOURCE:resource,KNOWLEDGE_MCP_ISSUER:issuer,
    KNOWLEDGE_MCP_JWKS_FILE:jwks,KNOWLEDGE_MCP_SUBJECTS_FILE:principals});
  return {dir,keys,config};
}
const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function bearer(privateKey,scopes='knowledge.read knowledge.write') {
  const now=Math.floor(Date.now()/1000);
  const body=enc({alg:'EdDSA',typ:'at+jwt',kid:'test-key'})+'.'+enc({iss:issuer,aud:resource,
    sub:'synthetic-user',iat:now-5,nbf:now-5,exp:now+120,scope:scopes});
  return body+'.'+sign(null,Buffer.from(body),privateKey).toString('base64url');
}
async function send(port,method,params,{token,host='wiki.example.test',proto='https',extra={}}={}) {
  const payload=JSON.stringify({jsonrpc:'2.0',id:1,method,params});
  return await new Promise((resolve,reject)=>{
    const headers={Host:host,'X-Forwarded-Proto':proto,'Content-Type':'application/json',
      Accept:'application/json, text/event-stream','MCP-Protocol-Version':MCP_PROTOCOL_VERSION,
      'Content-Length':Buffer.byteLength(payload),...extra};
    if(token)headers.Authorization='Bearer '+token;
    const req=httpRequest({hostname:'127.0.0.1',port,path:'/mcp',method:'POST',headers},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)});
      });
    });
    req.on('error',reject);req.end(payload);
  });
}
test('G9d synthetic MCP authenticates, reads, denies read-only write, captures with signed write token and reads back',async()=>{
  const fx=fixture();const {server,store}=createSyntheticMcpPreview(fx.config);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try {
    const readToken=bearer(fx.keys.privateKey,'knowledge.read');
    const writeToken=bearer(fx.keys.privateKey);
    let response=await send(port,'tools/list',{}, {token:readToken});
    assert.equal(response.status,200);
    assert.equal(response.body.result.tools.some(t=>t.name==='knowledge_capture_draft'),true);
    response=await send(port,'tools/call',{name:'knowledge_read',arguments:{path:'demo/synthetic-connector'}},{token:readToken});
    assert.equal(response.status,200);
    assert.match(response.body.result.structuredContent.page.body,/fictional data/);
    response=await send(port,'tools/call',{name:'knowledge_capture_draft',arguments:{path:'demo/g9d',title:'Synthetic G9d',body:'Should not persist'}},{token:readToken});
    assert.equal(response.body.result.isError,true);
    assert.equal(store.listPages('personal').length,1);
    response=await send(port,'tools/call',{name:'knowledge_capture_draft',arguments:{path:'demo/g9d',title:'Synthetic G9d',body:'Only fictional text from G9d.'}},{token:writeToken});
    assert.equal(response.status,200);
    assert.equal(response.body.result.structuredContent.action,'created');
    response=await send(port,'tools/call',{name:'knowledge_read',arguments:{path:'demo/g9d'}},{token:writeToken});
    assert.equal(response.body.result.structuredContent.page.body,'Only fictional text from G9d.');
  } finally {
    await new Promise(resolve=>server.close(resolve));store.close();rmSync(fx.dir,{recursive:true,force:true});
  }
});
test('G9d origin rejects direct access, forged forwarded headers and invalid JWTs',async()=>{
  const fx=fixture();const {server,store}=createSyntheticMcpPreview(fx.config);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try {
    const token=bearer(fx.keys.privateKey);
    for(const opts of [
      {host:'127.0.0.1:'+port,proto:'https'}, {host:'evil.example.test'},
      {proto:'http'}, {proto:'https,http'},
      {extra:{'X-Forwarded-Host':'wrong.example.test'}},
      {extra:{Origin:'https://evil.example.test'}},
      {extra:{Forwarded:'host=evil.example.test;proto=https'}},
    ]){
      const response=await send(port,'tools/list',{}, {token,...opts});
      assert.equal(response.status,403,JSON.stringify(opts));
      assert.equal(response.body.error,'INVALID_PROXY_CONTEXT');
    }
    const missing=await send(port,'tools/list',{});
    assert.equal(missing.status,401);
    assert.match(missing.headers['www-authenticate'],/resource_metadata=/);
    const forged=await send(port,'tools/list',{}, {token:'bogus'});
    assert.equal(forged.status,401);
    assert.equal(store.listPages('personal').length,1);
  }finally{
    await new Promise(resolve=>server.close(resolve));store.close();rmSync(fx.dir,{recursive:true,force:true});
  }
});
test('G9d synthetic data disappears after preview shutdown',()=>{
  const fx=fixture();
  try{
    const first=createSyntheticMcpPreview(fx.config);
    first.store.capturePage('personal',{path:'demo/transient',title:'Transient',body:'Synthetic data'});
    assert.equal(first.store.listPages('personal').length,2);
    first.server.close();first.store.close();
    const second=createSyntheticMcpPreview(fx.config);
    try{
      assert.equal(second.store.listPages('personal').length,1);
      assert.equal(second.store.getPage('personal','demo/transient'),null);
    }finally{second.server.close();second.store.close()}
  }finally{rmSync(fx.dir,{recursive:true,force:true})}
});
