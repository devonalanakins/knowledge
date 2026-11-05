import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpAccessTokenVerifier, McpTokenAuthError } from '../src/mcp-token-auth.mjs';
import { generateKeyPairSync, sign } from 'node:crypto';

const issuer = 'https://issuer.example.test', audience = 'https://knowledge.example.test/mcp';
const now = 1793900000000, seconds = Math.floor(now / 1000);
const ed = generateKeyPairSync('ed25519');
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const edJwk = { ...ed.publicKey.export({ format: 'jwk' }), kid: 'key-ed-1', alg: 'EdDSA', use: 'sig' };
const rsaJwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'key-rsa-1', alg: 'RS256', use: 'sig' };
const payload = { iss: issuer, aud: audience, sub: 'devon-owner', iat: seconds - 10, nbf: seconds - 10, exp: seconds + 120, scope: 'knowledge.read knowledge.write' };
const verifier = createMcpAccessTokenVerifier({ issuer, audience, publicKeys: [edJwk, rsaJwk], allowedSubjects: ['devon-owner'], now: () => now });
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
function token({ claims = {}, header = {}, useRsa = false } = {}) {
  const h = { alg: useRsa ? 'RS256' : 'EdDSA', kid: useRsa ? 'key-rsa-1' : 'key-ed-1', typ: 'at+jwt', ...header };
  const c = { ...payload, ...claims }, msg = `${b64(h)}.${b64(c)}`;
  return msg + '.' + sign(useRsa ? 'RSA-SHA256' : null, Buffer.from(msg), useRsa ? rsa.privateKey : ed.privateKey).toString('base64url');
}
const denied = jwt => assert.throws(() => verifier(jwt), { code: 'UNAUTHORIZED' });

test('G9 validator accepts exact issuer/audience/signed read and draft-write scopes', () => {
  assert.deepEqual(verifier(token()), { principal: 'devon-owner', role: 'agent' });
  assert.deepEqual(verifier(token({ claims: { scope: 'knowledge.read' } })), { principal: 'devon-owner', role: 'owner' });
  assert.equal(verifier(token({ useRsa: true })).role, 'agent');
});
test('G9 denies forged, expired, future and wrong-audience tokens', () => {
  for (const claims of [
    { iss: 'https://evil.example.test' }, { aud: 'https://api.example.test' }, { sub: 'other-user' },
    { exp: seconds - 100 }, { nbf: seconds + 100 }, { iat: seconds + 100 },
    { exp: seconds + 4000 }, { scope: 'knowledge.write' }, { scope: 'knowledge.read admin' },
    { scope: 'knowledge.read knowledge.read' }, { scope: '' },
  ]) denied(token({ claims }));
});
test('G9 denies altered signatures, unsafe JOSE headers and wrong signing algorithms', () => {
  const valid = token();
  denied(valid.slice(0, valid.length - 4) + 'abcd');
  denied(token({ header: { kid: 'unknown-key' } }));
  denied(token({ header: { typ: 'JWT' } }));
  denied(token({ header: { alg: 'none' } }));
  denied(token({ header: { jku: 'https://evil.example.test/jwks.json' } }));
  denied('test.test.test'); denied('a.b'); denied(''); denied('x'.repeat(9000));
});
test('G9 disallows invalid trust configuration, weak JWKs and implicit wildcard principals', () => {
  for (const opts of [
    { allowedSubjects: [] }, { issuer: 'http://issuer.example.test' },
    { publicKeys: [{ ...edJwk, d: 'PRIVATE' }] },
    { publicKeys: [edJwk, edJwk] },
    { publicKeys: [{ ...edJwk, alg: 'HS256' }] },
    { audience: 'http://localhost:3189/mcp' },
  ]) assert.throws(() => createMcpAccessTokenVerifier({issuer,audience, publicKeys:[edJwk],allowedSubjects:['devon-owner'],now:()=>now,...opts}), {code:'UNAUTHORIZED'});
  assert.equal(new McpTokenAuthError().code, 'UNAUTHORIZED');
});
test('G9 validates expiry and key revocation against clock/trust replacement', () => {
  const stale = createMcpAccessTokenVerifier({issuer,audience,publicKeys:[edJwk],allowedSubjects:['devon-owner'],now:()=>now+400000});
  denied(token({ claims:{ aud: 'untrusted' } }));
  assert.throws(() => stale(token()), {code:'UNAUTHORIZED'});
  const removed = createMcpAccessTokenVerifier({issuer,audience,publicKeys:[rsaJwk],allowedSubjects:['devon-owner'],now:()=>now});
  assert.throws(() => removed(token()), {code:'UNAUTHORIZED'});
});
