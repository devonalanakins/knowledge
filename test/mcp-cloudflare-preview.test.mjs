import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync,writeFileSync,chmodSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { MCP_PROTOCOL_VERSION, dispatchMcp } from '../src/mcp.mjs';
import { loadCloudflareSyntheticMcpConfig, createCloudflareSyntheticMcpPreview } from '../src/mcp-cloudflare-preview.mjs';

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://fictional.cloudflareaccess.com',aud='fictional-app',sub='fictional-person';
const host='knowledge.example.test';
function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'knowledge-g9g-'));
 const jwks=join(dir,'jwks.json'),users=join(dir,'subjects.json');
 writeFileSync(jwks,JSON.stringify({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256'}]}),{mode:0o600});
 writeFileSync(users,JSON.stringify({allowedSubjects:[sub]}),{mode:0o600});
 return {dir,jwks,users,env:{
   KNOWLEDGE_SYNTHETIC_ACK:'SYNTHETIC_ONLY_NO_PRIVATE_DATA',
   KNOWLEDGE_MCP_AUTH_MODE:'CLOUDFLARE_MANAGED_OAUTH_READ_ONLY',
   KNOWLEDGE_DB:':memory:',KNOWLEDGE_MCP_RESOURCE:'https://'+host+'/mcp',
   KNOWLEDGE_CF_PUBLIC_JWKS_FILE:jwks,KNOWLEDGE_CF_SUBJECTS_FILE:users,
   KNOWLEDGE_CF_TEAM_ISSUER:issuer,KNOWLEDGE_CF_APP_AUDIENCE:aud
 }};
}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function assertion(claims={}) {
 const now=Math.floor(Date.now()/1000);
 const message=b64({alg:'RS256',kid:'test-key'})+'.'+b64({
   iss:issuer,aud:[aud],sub,iat:now-5,exp:now+120,...claims});
 return message+'.'+sign('RSA-SHA256',Buffer.from(message),keys.privateKey).toString('base64url');
}
function rpc(port,name,args={},headers={},path='/mcp'){
 const data=JSON.stringify({jsonrpc:'2.0',id:1,method:name==='__list'?'tools/list':'tools/call',
  params:name==='__list'?{}:{name,arguments:args}});
 const requestHeaders={Host:host,'X-Forwarded-Proto':'https',
  'Cf-Access-Jwt-Assertion':assertion(),
  'Content-Type':'application/json',Accept:'application/json, text/event-stream',
  'MCP-Protocol-Version':MCP_PROTOCOL_VERSION,'Content-Length':Buffer.byteLength(data),...headers};
 return new Promise((resolve,reject)=>{
   const req=httpRequest({hostname:'127.0.0.1',port,path,method:'POST',headers:requestHeaders},res=>{
     const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
       let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{parsed=null}
       resolve({status:res.statusCode,body:parsed});
     });
   });req.on('error',reject);req.end(data);
 });
}
test('G9g configuration rejects disk storage, missing authorization and unsafe configs',()=>{
 const fx=fixture();try {
   const good=loadCloudflareSyntheticMcpConfig(fx.env);
   assert.equal(good.mcpReadOnly,true);assert.equal(good.mcpProxyHost,host);
   for(const env of [
     {...fx.env,KNOWLEDGE_SYNTHETIC_ACK:''},
     {...fx.env,KNOWLEDGE_MCP_AUTH_MODE:'OAUTH_WRITE'},
     {...fx.env,KNOWLEDGE_DB:'/private/knowledge.sqlite'},
     {...fx.env,KNOWLEDGE_MCP_RESOURCE:'http://'+host+'/mcp'},
     {...fx.env,KNOWLEDGE_CF_APP_AUDIENCE:'wrong space'},
   ]) assert.throws(()=>loadCloudflareSyntheticMcpConfig(env));
   chmodSync(fx.jwks,0o644);
   assert.throws(()=>loadCloudflareSyntheticMcpConfig(fx.env),/owner-only/);
 }finally{rmSync(fx.dir,{recursive:true,force:true})}
});
test('G9g signed Access assertion reads synthetic wiki but cannot discover or perform any write',async()=>{
 const fx=fixture(),cfg=loadCloudflareSyntheticMcpConfig(fx.env),{server,store}=createCloudflareSyntheticMcpPreview(cfg);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 try {
   let result=await rpc(port,'__list');
   assert.equal(result.status,200);
   assert.deepEqual(result.body.result.tools.map(x=>x.name),['knowledge_list','knowledge_search','knowledge_read']);
   for(const tool of result.body.result.tools) {
     assert.deepEqual(tool._meta.securitySchemes,[{type:'oauth2',scopes:[]}]);
     assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,
       idempotentHint:true,openWorldHint:false});
   }
   result=await rpc(port,'knowledge_read',{path:'demo/cloudflare-readonly'});
   assert.equal(result.status,200);
   assert.match(result.body.result.structuredContent.page.body,/synthetic Knowledge/);
   const before=store.listPages('personal').length;
   result=await rpc(port,'knowledge_capture_draft',{path:'demo/denied',title:'Forbidden',body:'No'});
   assert.equal(result.status,200);
   assert.equal(result.body.result.isError,true);
   assert.equal(store.listPages('personal').length,before);
   assert.equal(store.getPage('personal','demo/denied'),null);
   const wrong=await rpc(port,'knowledge_read',{path:'demo/cloudflare-readonly'},
     {'Cf-Access-Jwt-Assertion':assertion({sub:'not-on-allowlist'})});
   assert.equal(wrong.status,401);
   const spoof=await rpc(port,'knowledge_read',{path:'demo/cloudflare-readonly'},
     {Host:'evil.example.test'});
   assert.equal(spoof.status,403);
   const noTls=await rpc(port,'knowledge_read',{path:'demo/cloudflare-readonly'},
     {'X-Forwarded-Proto':'http'});
   assert.equal(noTls.status,403);
   const missing=await rpc(port,'knowledge_read',{path:'demo/cloudflare-readonly'},
     {'Cf-Access-Jwt-Assertion':''});
   assert.equal(missing.status,401);
   // Edge must provide OAuth discovery; local read-only origin must not invent it.
   const metadata=await new Promise((resolve,reject)=>{
     httpRequest({hostname:'127.0.0.1',port,path:'/.well-known/oauth-protected-resource/mcp',method:'GET',
       headers:{Host:host,'X-Forwarded-Proto':'https'}},res=>{
       res.resume();res.on('end',()=>resolve(res.statusCode));
     }).on('error',reject).end();
   });
   assert.equal(metadata,404);
 }finally{
   await new Promise(resolve=>server.close(resolve));store.close();
   rmSync(fx.dir,{recursive:true,force:true});
 }
});
test('G9h read-only edge mode cannot write even if an upstream role becomes agent',()=>{
 const fx=fixture();try{
   const cfg=loadCloudflareSyntheticMcpConfig(fx.env);
   const {server,store}=createCloudflareSyntheticMcpPreview(cfg);
   try {
     const input={jsonrpc:'2.0',id:1,method:'tools/call',params:{
       name:'knowledge_capture_draft',arguments:{
         path:'demo/blocked',title:'Blocked',body:'Must never persist'
       }
     }};
     const result=dispatchMcp(store,{space:'personal',role:'agent',edgeOAuth:true},input);
     assert.equal(result.result.isError,true);
     assert.equal(store.getPage('personal','demo/blocked'),null);
     const init=dispatchMcp(store,{space:'personal',role:'owner',edgeOAuth:true},{
       jsonrpc:'2.0',id:2,method:'initialize',
       params:{protocolVersion:MCP_PROTOCOL_VERSION}
     });
     assert.match(init.result.instructions,/read-only/);
     assert.match(init.result.instructions,/cannot create drafts/);
   }finally{server.close();store.close()}
 }finally{rmSync(fx.dir,{recursive:true,force:true})}
});
test('G9g synthetic database is ephemeral between instantiations',()=>{
 const fx=fixture();try{
  const cfg=loadCloudflareSyntheticMcpConfig(fx.env);
  const a=createCloudflareSyntheticMcpPreview(cfg);
  a.store.capturePage('personal',{path:'demo/transient',title:'Transient',body:'Not persistent'});
  a.server.close();a.store.close();
  const b=createCloudflareSyntheticMcpPreview(cfg);
  try{assert.equal(b.store.getPage('personal','demo/transient'),null)}
  finally{b.server.close();b.store.close()}
 }finally{rmSync(fx.dir,{recursive:true,force:true})}
});
