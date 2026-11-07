import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { preflightMcpOAuthIssuer } from '../src/mcp-issuer-preflight.mjs';

const issuer='https://identity.example.test', resource='https://knowledge.example.test/mcp';
const metadataUrl=issuer+'/.well-known/oauth-authorization-server',jwksUrl=issuer+'/keys';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pubKey={...publicKey.export({format:'jwk'}),kid:'test-ed-key',alg:'EdDSA'};
const metadata=()=>({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:jwksUrl,
  scopes_supported:['openid','knowledge.read','knowledge.write'],code_challenge_methods_supported:['S256'],
  response_types_supported:['code'],grant_types_supported:['authorization_code'],
  token_endpoint_auth_methods_supported:['none','private_key_jwt'],
  client_id_metadata_document_supported:true,authorization_response_iss_parameter_supported:true});
const json=(obj,headers={})=>new Response(JSON.stringify(obj),{status:200,headers:{'content-type':'application/json',...headers}});
const mockFetch=(m=metadata(),keys=[pubKey])=>async url=>{
  if(url===metadataUrl)return json(m);
  if(url===jwksUrl)return json({keys});
  throw new Error('Unexpected URL');
};
const invoke=(opts={})=>preflightMcpOAuthIssuer({issuer,resource,metadataUrl,fetchImpl:mockFetch(),...opts});
const fail=(opts,code)=>assert.rejects(invoke(opts),{code});

test('G9e pinned issuer and public signing keys pass metadata-only preflight',async()=>{
  const result=await invoke();
  assert.equal(result.report.readiness,'METADATA_COMPATIBLE_ONLY');
  assert.equal(result.report.registration,'CIMD');
  assert.equal(result.report.signingKeys,1);
  assert.equal(result.report.tokenResourceAudienceVerified,false);
  assert.equal(result.report.authorizedUserFlowVerified,false);
  assert.equal(result.report.responseIssuerIdentification,true);
  assert.equal(result.endpoints.jwks,jwksUrl);
  assert.equal(result.publicKeys[0].kid,'test-ed-key');
});
test('G9e DCR and pre-registered client fallback require explicit evidence',async()=>{
  const m=metadata();delete m.client_id_metadata_document_supported;
  m.registration_endpoint=issuer+'/register';m.token_endpoint_auth_methods_supported=['client_secret_basic'];
  let r=await invoke({fetchImpl:mockFetch(m)});
  assert.equal(r.report.registration,'DCR');
  delete m.registration_endpoint;
  await fail({fetchImpl:mockFetch(m)},'CLIENT_REGISTRATION_UNSUPPORTED');
  r=await invoke({fetchImpl:mockFetch(m),preRegisteredClient:true});
  assert.equal(r.report.registration,'PRE_REGISTERED');
});
test('G9e rejects mismatched issuers, missing PKCE, scopes and client auth metadata',async()=>{
  for(const [field,value,code] of [
    ['issuer','https://attacker.example.test','ISSUER_MISMATCH'],
    ['code_challenge_methods_supported',['plain'],'PKCE_OR_AUTHORIZATION_CODE_UNSUPPORTED'],
    ['response_types_supported',[],'PKCE_OR_AUTHORIZATION_CODE_UNSUPPORTED'],
    ['scopes_supported',['knowledge.read'],'KNOWLEDGE_SCOPES_MISSING'],
    ['token_endpoint_auth_methods_supported',[],'TOKEN_AUTH_METHODS_MISSING']
  ])await fail({fetchImpl:mockFetch({...metadata(),[field]:value})},code);
});
test('G9e rejects unapproved and local metadata/endpoints',async()=>{
  await fail({fetchImpl:mockFetch({...metadata(),jwks_uri:'https://attacker.example.test/jwks'})},'UNPINNED_ENDPOINT');
  await fail({metadataUrl:'https://127.0.0.1/.well-known/oauth-authorization-server'},'UNSAFE_URL');
  await fail({metadataUrl:'http://identity.example.test/.well-known/oauth-authorization-server'},'UNSAFE_URL');
  await fail({metadataUrl:issuer+'/authorize'},'INVALID_RESOURCE_OR_METADATA_URL');
  await fail({fetchImpl:mockFetch({...metadata(),authorization_endpoint:'https://evil.example.test/authorize'})},'UNPINNED_ENDPOINT');
});
test('G9e explicitly pinned alternative JWK origin is accepted only by operator',async()=>{
  const other='https://keys.example.test/jwks',m={...metadata(),jwks_uri:other};
  const fetchImpl=async url=>url===metadataUrl?json(m):url===other?json({keys:[pubKey]}):null;
  await fail({fetchImpl},'UNPINNED_ENDPOINT');
  const r=await invoke({fetchImpl,extraEndpointOrigins:['https://keys.example.test']});
  assert.equal(r.report.signingKeys,1);
});
test('G9e rejects private JWK fields and duplicate key IDs',async()=>{
  const key={...privateKey.export({format:'jwk'}),kid:'private',alg:'EdDSA'};
  await fail({fetchImpl:mockFetch(metadata(),[key])},'INVALID_SIGNING_KEYS');
  await fail({fetchImpl:mockFetch(metadata(),[pubKey,pubKey])},'INVALID_SIGNING_KEYS');
});
test('G9e fails closed on redirects, excessive bodies, wrong media type and network errors',async()=>{
  await fail({fetchImpl:async()=>new Response(JSON.stringify(metadata()),{headers:{'content-type':'text/plain'}})},'INVALID_CONTENT_TYPE');
  await fail({fetchImpl:async()=>new Response(JSON.stringify(metadata()),{headers:{'content-type':'application/json','content-length':'100000'}})},'DOCUMENT_TOO_LARGE');
  await fail({fetchImpl:async()=>Response.redirect('https://attacker.example.test',302)},'INVALID_HTTP_RESPONSE');
  await fail({fetchImpl:async()=>{throw new Error('offline')}},'ISSUER_UNREACHABLE');
  await fail({fetchImpl:async()=>new Response('x'.repeat(80000),{headers:{'content-type':'application/json'}})},'DOCUMENT_TOO_LARGE');
});
test('G9e rejects unsafe IPs, URLs and operator allowlists before network requests',async()=>{
  for(const bad of ['https://localhost','https://192.168.1.1','https://user:pw@identity.example.test','https://identity.example.test?x=1'])
    await fail({issuer:bad},'UNSAFE_URL');
  await fail({extraEndpointOrigins:['http://keys.example.test']},'UNSAFE_URL');
  await fail({extraEndpointOrigins:['https://keys.example.test/unsafe']},'INVALID_ENDPOINT_ALLOWLIST');
});
