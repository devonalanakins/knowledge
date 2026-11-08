/**
 * Read-only compatibility preflight for a separately operated OAuth issuer.
 * It NEVER accepts bearer tokens, starts a server, saves secrets or grants access.
 * Network requests must be initiated by a trusted operator, not an MCP client.
 */
import { isIP } from 'node:net';
import { createMcpAccessTokenVerifier } from './mcp-token-auth.mjs';

const MAX_DOC_BYTES = 65_536;
const MAX_KEYS = 8;

export class OAuthIssuerPreflightError extends Error {
  constructor(code) {
    super('OAuth issuer preflight rejected configuration: ' + code);
    this.name = 'OAuthIssuerPreflightError';
    this.code = code;
  }
}
function deny(code) { throw new OAuthIssuerPreflightError(code); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function secureUrl(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 1024) deny('UNSAFE_URL');
  let url;
  try { url = new URL(value); } catch { deny('UNSAFE_URL'); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.origin === 'null' || url.href !== value && !(url.pathname === '/' && url.href === value + '/') ||
      !host.includes('.') || host === 'localhost' || host.endsWith('.local') ||
      host.endsWith('.internal') || isIP(host) !== 0) deny('UNSAFE_URL');
  return url;
}
function pinnedUrl(value, allowedOrigins) {
  const uri = secureUrl(value);
  if (!allowedOrigins.has(uri.origin)) deny('UNPINNED_ENDPOINT');
  return uri.href;
}
async function boundedJson(fetchImpl, url, signal) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal });
  } catch { deny('ISSUER_UNREACHABLE'); }
  if (!response || response.status !== 200 || response.redirected ||
      response.url && response.url !== url) deny('INVALID_HTTP_RESPONSE');
  if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(response.headers?.get('content-type') || ''))
    deny('INVALID_CONTENT_TYPE');
  const declaredLength = Number(response.headers.get('content-length'));
  if (response.headers.has('content-length') && (!Number.isSafeInteger(declaredLength) ||
      declaredLength > MAX_DOC_BYTES || declaredLength < 1)) deny('DOCUMENT_TOO_LARGE');
  if (!response.body?.getReader) deny('INVALID_HTTP_RESPONSE');
  const reader = response.body.getReader();
  let size = 0, chunks = [];
  try {
    while (true) {
      let part;
      try { part = await reader.read(); } catch { deny('ISSUER_UNREACHABLE'); }
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_DOC_BYTES) deny('DOCUMENT_TOO_LARGE');
      chunks.push(part.value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* stream already failed */ }
    throw error;
  } finally { reader.releaseLock(); }
  const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
  let json;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch { deny('INVALID_JSON'); }
  if (!object(json)) deny('INVALID_JSON');
  return json;
}

/**
 * Reports whether metadata/JWKS look compatible with ChatGPT's OAuth linking
 * contract. Does not certify a live OAuth exchange or validate a real token.
 * Additional origins must be pre-approved by the operator, never supplied by
 * source metadata or a connected client.
 */
export async function preflightMcpOAuthIssuer({
  issuer, resource, metadataUrl, extraEndpointOrigins = [],
  preRegisteredClient = false, fetchImpl = fetch, timeoutMs = 6000,
} = {}) {
  const issuerUrl = secureUrl(issuer), resourceUrl = secureUrl(resource), metaUrl = secureUrl(metadataUrl);
  if (resourceUrl.pathname !== '/mcp' || metaUrl.origin !== issuerUrl.origin ||
      !metaUrl.pathname.includes('/.well-known/') ||
      !['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'].some(suffix => metaUrl.pathname.endsWith(suffix)))
    deny('INVALID_RESOURCE_OR_METADATA_URL');
  if (!Array.isArray(extraEndpointOrigins) || extraEndpointOrigins.length > 4 ||
      !extraEndpointOrigins.every(u => typeof u === 'string')) deny('INVALID_ENDPOINT_ALLOWLIST');
  const allowedOrigins = new Set([issuerUrl.origin]);
  for (const origin of extraEndpointOrigins) {
    const uri = secureUrl(origin);
    if (uri.href !== uri.origin + '/' && uri.href !== uri.origin) deny('INVALID_ENDPOINT_ALLOWLIST');
    allowedOrigins.add(uri.origin);
  }
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 200 || timeoutMs > 15000 ||
      typeof preRegisteredClient !== 'boolean') deny('INVALID_OPERATOR_CONFIGURATION');
  const signal = AbortSignal.timeout(timeoutMs);
  const metadata = await boundedJson(fetchImpl, metaUrl.href, signal);
  if (metadata.issuer !== issuer) deny('ISSUER_MISMATCH');
  const authEndpoint = pinnedUrl(metadata.authorization_endpoint, allowedOrigins);
  const tokenEndpoint = pinnedUrl(metadata.token_endpoint, allowedOrigins);
  if (!Array.isArray(metadata.code_challenge_methods_supported) ||
      !metadata.code_challenge_methods_supported.includes('S256') ||
      !Array.isArray(metadata.response_types_supported) || !metadata.response_types_supported.includes('code') ||
      metadata.grant_types_supported !== undefined &&
      (!Array.isArray(metadata.grant_types_supported) || !metadata.grant_types_supported.includes('authorization_code')))
    deny('PKCE_OR_AUTHORIZATION_CODE_UNSUPPORTED');
  if (!Array.isArray(metadata.scopes_supported) ||
      !['knowledge.read', 'knowledge.write'].every(s => metadata.scopes_supported.includes(s)))
    deny('KNOWLEDGE_SCOPES_MISSING');
  const methods = metadata.token_endpoint_auth_methods_supported;
  if (!Array.isArray(methods) || methods.length === 0) deny('TOKEN_AUTH_METHODS_MISSING');
  const supportsCimd = metadata.client_id_metadata_document_supported === true &&
    methods.some(method => ['none', 'private_key_jwt'].includes(method));
  const supportsDcr = typeof metadata.registration_endpoint === 'string' &&
    methods.some(method => ['none', 'private_key_jwt', 'client_secret_basic', 'client_secret_post'].includes(method));
  if (typeof metadata.registration_endpoint === 'string')
    pinnedUrl(metadata.registration_endpoint, allowedOrigins);
  if (!supportsCimd && !supportsDcr && !preRegisteredClient) deny('CLIENT_REGISTRATION_UNSUPPORTED');
  const mode = supportsCimd ? 'CIMD' : supportsDcr ? 'DCR' : 'PRE_REGISTERED';
  const jwksUrl = pinnedUrl(metadata.jwks_uri, allowedOrigins);
  const jwks = await boundedJson(fetchImpl, jwksUrl, signal);
  if (!Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > MAX_KEYS)
    deny('INVALID_SIGNING_KEYS');
  let validKeyVerifier;
  try {
    validKeyVerifier = createMcpAccessTokenVerifier({
      issuer, audience: resource, publicKeys: jwks.keys, allowedSubjects: ['synthetic-preflight-subject'],
    });
  } catch { deny('INVALID_SIGNING_KEYS'); }
  if (typeof validKeyVerifier !== 'function') deny('INVALID_SIGNING_KEYS');
  return Object.freeze({
    report: Object.freeze({
      readiness: 'METADATA_COMPATIBLE_ONLY', issuer, resource,
      registration: mode, signingKeys: jwks.keys.length,
      pkce: 'S256', supportedScopes: ['knowledge.read', 'knowledge.write'],
      responseIssuerIdentification: metadata.authorization_response_iss_parameter_supported === true,
      tokenResourceAudienceVerified: false,
      authorizedUserFlowVerified: false,
    }),
    // Public keys are returned to trusted local code only; the CLI never prints them.
    publicKeys: Object.freeze([...jwks.keys]),
    endpoints: Object.freeze({ authorization: authEndpoint, token: tokenEndpoint, jwks: jwksUrl }),
  });
}
