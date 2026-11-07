/**
 * G9i: No-storage, fictional-only Cloudflare Worker MCP read origin.
 *
 * Cloudflare Access must protect the Worker invocation, NOT merely a hostname
 * that can be bypassed via workers.dev/preview/alternate routes. The Access
 * runtime supplies ctx.access after successful authentication; the Worker also
 * checks a pinned application audience and owner email. There is deliberately
 * no D1/R2/KV binding, persistent data, JWT header parser, or write tool.
 *
 * This is source-only and NOT proof that Managed OAuth works with ChatGPT.
 */
import { dispatchMcp, MCP_PROTOCOL_VERSION } from './mcp.mjs';

const ACK = 'SYNTHETIC_ONLY_NO_PRIVATE_DATA';
const MAX_BYTES = 32_768;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUD = /^[A-Za-z0-9_-]{12,128}$/;

const syntheticPage = Object.freeze({
  path: 'demo/worker-readonly',
  title: 'Fictional Worker Knowledge reference',
  body: 'A synthetic Knowledge wiki example. This endpoint contains no Notion, family, company, client or clinical records.',
  status: 'draft',
  sourceUrl: 'https://example.org/fictional-knowledge',
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const exampleStore = Object.freeze({
  listPages(space, limit = 50) {
    return space === 'synthetic' ? [syntheticPage].slice(0, limit) : [];
  },
  searchPages(space, query) {
    if (space !== 'synthetic' || typeof query !== 'string') return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return [syntheticPage].filter(p => [p.title, p.body, p.path].some(x => x.toLowerCase().includes(needle)));
  },
  getPage(space, path) {
    return space === 'synthetic' && path === syntheticPage.path ? syntheticPage : null;
  },
});

function reply(status, body = null, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(body === null ? {} : {'Content-Type': 'application/json; charset=utf-8'}),
      ...headers,
    },
  });
}
function config(env) {
  if (!env || env.KNOWLEDGE_WORKER_SYNTHETIC_ACK !== ACK) return null;
  const resource = env.KNOWLEDGE_WORKER_RESOURCE;
  if (typeof resource !== 'string') return null;
  let parsed;
  try { parsed = new URL(resource); } catch { return null; }
  if (parsed.href !== resource || parsed.protocol !== 'https:' ||
      parsed.pathname !== '/mcp' || parsed.search || parsed.hash ||
      parsed.username || parsed.password || !parsed.hostname.includes('.') ||
      parsed.hostname.endsWith('.local')) return null;
  if (typeof env.KNOWLEDGE_ACCESS_AUD !== 'string' || !AUD.test(env.KNOWLEDGE_ACCESS_AUD)) return null;
  const allowedEmail = env.KNOWLEDGE_ACCESS_EMAIL;
  if (typeof allowedEmail !== 'string' || allowedEmail !== allowedEmail.toLowerCase() ||
      allowedEmail.length > 254 || !EMAIL.test(allowedEmail)) return null;
  return {resource: parsed.href, aud: env.KNOWLEDGE_ACCESS_AUD, email: allowedEmail};
}
async function readBoundedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  let byteCount = 0;
  const chunks = [];
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  } catch { return undefined; }
}

/** Injected ctx in tests is a fixture, never a production Access security proof. */
export async function handleSyntheticWorkerMcp(request, env, ctx) {
  const trusted = config(env);
  if (!trusted) return reply(503, {error:'PREVIEW_NOT_CONFIGURED'});
  const url = new URL(request.url);
  if (url.href !== trusted.resource) return reply(404, {error:'NOT_FOUND'});

  // This requires direct Access-protected Worker invocation. It must not be
  // published behind an unprotected Worker route or Service Binding.
  if (!ctx?.access || ctx.access.aud !== trusted.aud ||
      typeof ctx.access.getIdentity !== 'function') return reply(403, {error:'ACCESS_REQUIRED'});
  let identity;
  try { identity = await ctx.access.getIdentity(); } catch { return reply(403, {error:'ACCESS_REQUIRED'}); }
  if (typeof identity?.email !== 'string' ||
      identity.email.toLowerCase() !== trusted.email) return reply(403, {error:'ACCESS_REQUIRED'});

  if (request.method !== 'POST') return reply(405, {error:'METHOD_NOT_ALLOWED'}, {Allow:'POST'});
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    return reply(415, {error:'JSON_REQUIRED'});
  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream'))
    return reply(406, {error:'MCP_ACCEPT_REQUIRED'});
  const reportedLength = request.headers.get('content-length');
  if (reportedLength && /^\d+$/.test(reportedLength) && Number(reportedLength) > MAX_BYTES)
    return reply(413, {error:'REQUEST_TOO_LARGE'});
  const raw = await readBoundedBody(request);
  if (raw === null) return reply(413, {error:'REQUEST_TOO_LARGE'});
  if (raw === undefined) return reply(400, {error:'INVALID_BODY'});
  let message;
  try { message = JSON.parse(raw); } catch { return reply(400, {error:'INVALID_JSON'}); }
  if (message?.method !== 'initialize' &&
      request.headers.get('mcp-protocol-version') !== MCP_PROTOCOL_VERSION) {
    return reply(400, {jsonrpc:'2.0', id:message?.id??null,
      error:{code:-32001,message:'Unsupported MCP protocol version',data:{supported:[MCP_PROTOCOL_VERSION]}}});
  }

  const result = dispatchMcp(exampleStore, {
    space: 'synthetic', role:'owner', oauth:false, edgeOAuth:true,
  }, message);
  return result === null ? reply(202) : reply(200, result);
}

export default { fetch: handleSyntheticWorkerMcp };
