import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSyntheticMcpConfig, createSyntheticMcpPreview, SYNTHETIC_ACKNOWLEDGMENT } from '../src/mcp-hosted-preview.mjs';
import { isTrustedMcpProxyRequest } from '../src/mcp-proxy.mjs';

const issuer = 'https://issuer.example.test', audience = 'https://wiki.example.test/mcp';
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-g9d-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwks = join(dir, 'jwks.json'), subjects = join(dir, 'subjects.json');
  writeFileSync(jwks, JSON.stringify({ keys: [{ ...publicKey.export({format:'jwk'}), kid:'synthetic-test-key', alg:'EdDSA'}] }), { mode: 0o600 });
  writeFileSync(subjects, JSON.stringify({ allowedSubjects: ['synthetic-user'] }), { mode: 0o600 });
  const env = {
    KNOWLEDGE_SYNTHETIC_ACK: SYNTHETIC_ACKNOWLEDGMENT,
    KNOWLEDGE_MCP_RESOURCE: audience,
    KNOWLEDGE_MCP_ISSUER: issuer,
    KNOWLEDGE_MCP_JWKS_FILE: jwks,
    KNOWLEDGE_MCP_SUBJECTS_FILE: subjects,
    KNOWLEDGE_MCP_PORT: '3189',
  };
  return { dir, env, jwks, subjects, privateKey };
}
function cleanup(x) { rmSync(x.dir, { recursive:true, force:true }); }
function jwt(privateKey, scopes='knowledge.read knowledge.write') {
  const sec=Math.floor(Date.now()/1000);
  const segment = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const data=segment({ alg:'EdDSA',kid:'synthetic-test-key',typ:'at+jwt' })+'.'+segment({
    iss:issuer, aud:audience, sub:'synthetic-user', iat:sec-10, nbf:sec-10, exp:sec+120, scope:scopes,
  });
  return data+'.'+sign(null,Buffer.from(data),privateKey).toString('base64url');
}

test('G9d fail-closed config rejects missing synthetic consent or disk database',()=>{
  const x=setup(); try {
    assert.throws(()=>loadSyntheticMcpConfig({...x.env,KNOWLEDGE_SYNTHETIC_ACK:undefined}),/synthetic-only/);
    assert.throws(()=>loadSyntheticMcpConfig({...x.env,KNOWLEDGE_DB:'/tmp/real-records.sqlite'}),/forbidden/);
    assert.throws(()=>loadSyntheticMcpConfig({...x.env,KNOWLEDGE_MCP_RESOURCE:'http://wiki.example.test/mcp'}),/HTTPS/);
    assert.throws(()=>loadSyntheticMcpConfig({...x.env,KNOWLEDGE_MCP_RESOURCE:'https://localhost/mcp'}),/localhost/);
    assert.throws(()=>loadSyntheticMcpConfig({...x.env,KNOWLEDGE_MCP_PORT:'80'}),/port/);
  } finally { cleanup(x); }
});

test('G9d trusted configuration files must not be writable by other users or symlinked',()=>{
  const x=setup(); try {
    chmodSync(x.jwks,0o644);
    assert.throws(()=>loadSyntheticMcpConfig(x.env),/owner-only/);
    chmodSync(x.jwks,0o600);
    const link=join(x.dir,'symlink-jwks.json'); symlinkSync(x.jwks,link);
    assert.throws(()=>loadSyntheticMcpConfig({...x.env,KNOWLEDGE_MCP_JWKS_FILE:link}),/owner-only/);
    assert.throws(()=>loadSyntheticMcpConfig({...x.env,KNOWLEDGE_MCP_SUBJECTS_FILE:'relative.json'}),/absolute/);
  } finally { cleanup(x); }
});

test('G9d config validates signed synthetic identity and starts ephemeral text store',()=>{
  const x=setup(); try {
    const config=loadSyntheticMcpConfig(x.env);
    assert.equal(config.port,3189);
    assert.equal(config.mcpTrustedProxy,true);
    assert.equal(config.mcpTokenVerifier(jwt(x.privateKey)).role,'agent');
    assert.equal(config.mcpTokenVerifier(jwt(x.privateKey,'knowledge.read')).role,'owner');
    assert.throws(()=>config.mcpTokenVerifier('not-a-token'),{code:'UNAUTHORIZED'});
    const { server, store }=createSyntheticMcpPreview(config);
    try {
      assert.equal(store.listPages('personal').length,1);
      assert.equal(store.listPages('personal')[0].path,'demo/synthetic-connector');
    } finally { server.close(); store.close(); }
  } finally {cleanup(x);}
});

const expectedHost='wiki.example.test';
const request=(headers={},remoteAddress='127.0.0.1')=>({
  socket:{remoteAddress},
  headers:{host:expectedHost,'x-forwarded-proto':'https',...headers},
});
test('G9d forwarded TLS, pinned Host and loopback boundary are enforced',()=>{
  assert.equal(isTrustedMcpProxyRequest(request(),expectedHost),true);
  assert.equal(isTrustedMcpProxyRequest(request({'x-forwarded-host':expectedHost}),expectedHost),true);
  for(const value of [
    request({host:'attacker.test'}), request({'x-forwarded-proto':'http'}),
    request({'x-forwarded-proto':'https,http'}), request({'x-forwarded-host':'attacker.test'}),
    request({forwarded:'host=attacker.test;proto=https'}), request({'x-original-host':'attacker.test'}),
    request({},'203.0.113.20'), request({origin:'https://evil.example.test'}),
    request({origin:'null'}), request({origin:'http://wiki.example.test'}),
  ]) assert.equal(isTrustedMcpProxyRequest(value,expectedHost),false);
  assert.equal(isTrustedMcpProxyRequest(request({origin:'https://wiki.example.test'}),expectedHost),true);
});
