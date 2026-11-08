/**
 * G9a: offline resource-server verifier for OAuth-style JWT access tokens.
 *
 * This code DOES NOT issue tokens, run OAuth authorization, discover JWKS,
 * authorize ChatGPT, or provide a remotely reachable server. The owner supplies
 * an exact trusted issuer, resource audience, public signing keys and principals.
 */
import { createPublicKey, verify } from 'node:crypto';

const SCOPES = new Set(['knowledge.read', 'knowledge.write']);
const KID = /^[A-Za-z0-9_.-]{1,128}$/;
const SUBJECT = /^[A-Za-z0-9_.:@/-]{1,256}$/;
const MAX_TOKEN_BYTES = 8192;
const MAX_TOKEN_LIFETIME_SECONDS = 3600;
const CLOCK_TOLERANCE_SECONDS = 30;

export class McpTokenAuthError extends Error {
  constructor() {
    super('Access token is invalid or unauthorized');
    this.name = 'McpTokenAuthError';
    this.code = 'UNAUTHORIZED';
  }
}
const fail = () => { throw new McpTokenAuthError(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strictUri = value => {
  if (typeof value !== 'string' || value.length < 12 || value.length > 512) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.origin === 'null') fail();
  return value;
};
function canonicalBase64Url(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > MAX_TOKEN_BYTES || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const result = Buffer.from(value, 'base64url');
  if (result.toString('base64url') !== value) fail();
  return result;
}
function parseSegment(value) {
  let json;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(canonicalBase64Url(value))); }
  catch { fail(); }
  if (!object(json)) fail();
  return json;
}
function trustedKey(jwk) {
  if (!object(jwk) || typeof jwk.kid !== 'string' || !KID.test(jwk.kid)) fail();
  // No remote JWK URLs, HS algorithms, private keys, or arbitrary JOSE headers.
  let algorithm;
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && typeof jwk.x === 'string') algorithm = 'EdDSA';
  else if (jwk.kty === 'RSA' && typeof jwk.n === 'string' && typeof jwk.e === 'string') algorithm = 'RS256';
  else fail();
  if (jwk.d !== undefined || jwk.alg !== undefined && jwk.alg !== algorithm ||
      jwk.use !== undefined && jwk.use !== 'sig' ||
      jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify'))) fail();
  let publicKey;
  try { publicKey = createPublicKey({ key: jwk, format: 'jwk' }); } catch { fail(); }
  if ((algorithm === 'EdDSA' && publicKey.asymmetricKeyType !== 'ed25519') ||
      (algorithm === 'RS256' && publicKey.asymmetricKeyType !== 'rsa')) fail();
  if (algorithm === 'RS256' && publicKey.asymmetricKeyDetails?.modulusLength < 2048) fail();
  return { key: publicKey, alg: algorithm };
}

/**
 * Create a synchronous, offline validator for an MCP resource server.
 * Returns a *role*, never trusts workspace IDs supplied by the model/token.
 * Authorization to a particular Knowledge workspace stays server-side.
 */
export function createMcpAccessTokenVerifier({ issuer, audience, publicKeys, allowedSubjects, now = () => Date.now() }) {
  const expectedIssuer = strictUri(issuer), expectedAudience = strictUri(audience);
  if (!Array.isArray(publicKeys) || publicKeys.length === 0 || publicKeys.length > 8 ||
      !Array.isArray(allowedSubjects) || allowedSubjects.length === 0 || allowedSubjects.length > 100 ||
      !allowedSubjects.every(subject => typeof subject === 'string' && SUBJECT.test(subject)) ||
      new Set(allowedSubjects).size !== allowedSubjects.length || typeof now !== 'function') fail();
  const subjects = new Set(allowedSubjects);
  const keys = new Map();
  for (const jwk of publicKeys) {
    if (keys.has(jwk?.kid)) fail();
    keys.set(jwk.kid, trustedKey(jwk));
  }
  return function verifyMcpAccessToken(token) {
    if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) fail();
    const segments = token.split('.');
    if (segments.length !== 3) fail();
    const [headerEncoded, claimsEncoded, signatureEncoded] = segments;
    const header = parseSegment(headerEncoded), claims = parseSegment(claimsEncoded);
    // Algorithm confusion and key-URL injection are disallowed.
    if (!KID.test(header.kid || '') || !['at+jwt', 'application/at+jwt'].includes(header.typ) ||
        !['EdDSA', 'RS256'].includes(header.alg) || Object.keys(header).some(key => !['alg', 'typ', 'kid'].includes(key))) fail();
    const key = keys.get(header.kid);
    if (!key || key.alg !== header.alg) fail();
    const signature = canonicalBase64Url(signatureEncoded);
    let validSignature = false;
    try {
      validSignature = verify(header.alg === 'EdDSA' ? null : 'RSA-SHA256',
        Buffer.from(`${headerEncoded}.${claimsEncoded}`, 'ascii'), key.key, signature);
    } catch { fail(); }
    if (!validSignature) fail();
    let seconds;
    try { seconds = Math.floor(now() / 1000); } catch { fail(); }
    if (!Number.isSafeInteger(seconds) || seconds <= 0 ||
        claims.iss !== expectedIssuer || !subjects.has(claims.sub) ||
        !(claims.aud === expectedAudience || Array.isArray(claims.aud) && claims.aud.includes(expectedAudience)) ||
        !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.nbf) || !Number.isSafeInteger(claims.exp) ||
        claims.exp <= claims.iat || claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS ||
        claims.iat > seconds + CLOCK_TOLERANCE_SECONDS ||
        claims.nbf > seconds + CLOCK_TOLERANCE_SECONDS ||
        claims.exp <= seconds - CLOCK_TOLERANCE_SECONDS ||
        claims.iat < 0 || claims.nbf < 0 ||
        typeof claims.scope !== 'string' || claims.scope.length === 0 || claims.scope.length > 512) fail();
    const scopeList = claims.scope.split(' ');
    const scopes = new Set(scopeList);
    if (scopes.has('') || scopes.size !== scopeList.length || [...scopes].some(s => !SCOPES.has(s)) ||
        !scopes.has('knowledge.read')) fail();
    // Unknown claims can be defined by the trusted auth server, but never override role.
    return Object.freeze({ principal: claims.sub, role: scopes.has('knowledge.write') ? 'agent' : 'owner' });
  };
}
