import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpResourceMetadata, MCP_RESOURCE_METADATA_PATH } from '../src/mcp-resource.mjs';
const good=()=>createMcpResourceMetadata({resource:'https://wiki.example.test/mcp',authorizationServers:['https://auth.example.test/tenant']});
test('G9b metadata contains canonical resource, trusted issuer, both supported permissions',()=>{
  const m=good();
  assert.equal(MCP_RESOURCE_METADATA_PATH,'/.well-known/oauth-protected-resource/mcp');
  assert.deepEqual(m.metadata,{
    resource:'https://wiki.example.test/mcp',authorization_servers:['https://auth.example.test/tenant'],
    scopes_supported:['knowledge.read','knowledge.write'],bearer_methods_supported:['header']});
  assert.equal(m.metadataUrl,'https://wiki.example.test/.well-known/oauth-protected-resource/mcp');
  assert.equal(Object.isFrozen(m.metadata),true);
});
test('G9b challenges are stable and do not reflect untrusted hosts',()=>{
  const m=good();
  assert.equal(m.readChallenge,'Bearer resource_metadata="https://wiki.example.test/.well-known/oauth-protected-resource/mcp", scope="knowledge.read"');
  assert.equal(m.writeChallenge,'Bearer error="insufficient_scope", resource_metadata="https://wiki.example.test/.well-known/oauth-protected-resource/mcp", scope="knowledge.read knowledge.write"');
});
test('G9b rejects insecure resource URLs, wrong path and credential injection',()=>{
  for(const resource of ['http://wiki.example.test/mcp','https://user:secret@wiki.example.test/mcp','https://wiki.example.test/mcp?x=1','https://wiki.example.test/other','https://wiki.example.test/mcp/','https://wiki.example.test:443/mcp','http://127.0.0.1:3189/mcp'])
    assert.throws(()=>createMcpResourceMetadata({resource,authorizationServers:['https://auth.example.test']}),TypeError);
});
test('G9b rejects bad authorization server config and duplicate issuers',()=>{
  for(const authorizationServers of [[],['http://auth.example.test'],['https://x:secret@auth.example.test'],
     ['https://auth.example.test?redirect=evil'],['https://auth.example.test','https://auth.example.test'],
     ['https://auth.example.test/tenant/'],['https://a.test','https://b.test','https://c.test','https://d.test','https://e.test']])
    assert.throws(()=>createMcpResourceMetadata({resource:'https://wiki.example.test/mcp',authorizationServers}),TypeError);
});
