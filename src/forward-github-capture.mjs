/**
 * Signed GitHub merge receipts -> draft-only Knowledge captures.
 *
 * This is an opt-in integration building block, not a public webhook route.
 * A host must supply its own allowlisted, encrypted Knowledge read/capture
 * adapter and explicitly provision a signed event delivery mechanism.
 */
const encoder = new TextEncoder();
const sha40 = /^[0-9a-f]{40}$/;
const signature256 = /^sha256=([0-9a-f]{64})$/;
const repoSlug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const pathPart = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_EVENT_BYTES = 65536;
// Unforgeable process-local proof that a candidate came from HMAC verification.
const authenticatedCandidates = new WeakSet();

export class CaptureInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CaptureInputError';
    this.code = code;
  }
}
function reject(code, message) { throw new CaptureInputError(code, message); }
function header(headers, name) {
  if (headers && typeof headers.get === 'function') return headers.get(name);
  if (!headers || typeof headers !== 'object') return null;
  const key = Object.keys(headers).find(k => k.toLowerCase() === name);
  return key === undefined ? null : headers[key];
}
function verifyScope(spec) {
  if (!spec || spec.scope !== 'personal' ||
      typeof spec.pathPrefix !== 'string' ||
      spec.pathPrefix.split('/').length > 7 ||
      !spec.pathPrefix.split('/').every(part => pathPart.test(part)))
    reject('SCOPE_NOT_AUTHORIZED', 'GitHub source is not mapped to an approved personal Knowledge path');
}
function boundedBytes(body) {
  if (typeof body !== 'string' && !(body instanceof Uint8Array))
    reject('INVALID_DELIVERY', 'Signed webhook requires the original raw request body');
  const bytes = typeof body === 'string' ? encoder.encode(body) : body;
  if (!bytes.byteLength || bytes.byteLength > MAX_EVENT_BYTES)
    reject('INVALID_DELIVERY', 'Webhook body is empty or exceeds the allowed size');
  return bytes;
}
function sourceMetadata(event, fullName, spec) {
  const repo = event.repository;
  const pr = event.pull_request;
  const number = event.number;
  if (!Number.isSafeInteger(repo.id) || repo.id <= 0 ||
      !Number.isSafeInteger(number) || number <= 0 ||
      !sha40.test(pr.merge_commit_sha ?? '') ||
      pr.number !== number || pr.merged !== true ||
      typeof pr.merged_at !== 'string' ||
      !Number.isFinite(Date.parse(pr.merged_at)))
    reject('INVALID_DELIVERY', 'Merged pull request is missing reliable identity or commit metadata');
  const eventKey = 'github:pr-merge:' + repo.id + ':' + number + ':' + pr.merge_commit_sha;
  const path = spec.pathPrefix + '/pr-' + number;
  if (path.length > 240 || path.split('/').length > 8)
    reject('INVALID_MAPPING', 'Knowledge path exceeds workspace limits');
  const url = 'https://github.com/' + fullName + '/pull/' + number;
  const body = [
    '# GitHub merge receipt',
    '',
    'Status: SOURCE-EVENT VERIFIED (not an independent CI or production deployment check)',
    'Source: authenticated GitHub pull_request.closed event',
    'Event key: ' + eventKey,
    'Repository: ' + fullName,
    'Pull request: ' + url,
    'Merge commit: ' + pr.merge_commit_sha,
    'Reported merged at: ' + new Date(pr.merged_at).toISOString(),
    '',
    'This record is a draft evidence receipt. It does not certify tests, deployment,',
    'scope grants, a human-approved decision, or access to private PR content.',
  ].join('\n');
  const candidate = Object.freeze({
    kind: 'github.pr.merged',
    eventKey, path, title: 'Merged ' + fullName + ' PR #' + number,
    body, sourceUrl: url, scope: spec.scope, classification: 'nonclinical',
    sourceAuthenticated: true,
  });
  authenticatedCandidates.add(candidate);
  return candidate;
}

/**
 * Verify HMAC over exact bytes, then allowlist the repository before making
 * a candidate. Non-merge events are intentionally ignored.
 *
 * A repository mapping is an explicit owner-approved authorization, not
 * derived from the event payload. No PR body, title or comments are retained.
 */
export async function verifySignedGitHubMerge({body, headers, secret, repositories}) {
  const raw = boundedBytes(body);
  if (typeof secret !== 'string' || encoder.encode(secret).byteLength < 32)
    reject('SIGNING_KEY_UNAVAILABLE', 'GitHub webhook signing key is missing or too short');
  const sig = header(headers, 'x-hub-signature-256');
  if (typeof sig !== 'string' || !signature256.test(sig))
    reject('INVALID_SIGNATURE', 'GitHub delivery requires a valid SHA-256 signature');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
  const received = Uint8Array.from(sig.slice(7).match(/.{2}/g), pair => parseInt(pair, 16));
  const authenticated = await crypto.subtle.verify('HMAC', key, received, raw);
  if (!authenticated) reject('INVALID_SIGNATURE', 'GitHub delivery signature mismatch');
  if (header(headers, 'x-github-event') !== 'pull_request') return null;
  const delivery = header(headers, 'x-github-delivery');
  if (typeof delivery !== 'string' || !/^[0-9a-f-]{32,40}$/i.test(delivery))
    reject('INVALID_DELIVERY', 'Missing GitHub delivery identifier');
  let event;
  try { event = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)); }
  catch { reject('INVALID_DELIVERY', 'Invalid signed GitHub JSON'); }
  if (event?.action !== 'closed' || event?.pull_request?.merged !== true) return null;
  const fullName = event?.repository?.full_name;
  if (typeof fullName !== 'string' || !repoSlug.test(fullName))
    reject('INVALID_DELIVERY', 'Invalid repository identity');
  if (!repositories || !Object.hasOwn(repositories, fullName))
    reject('SCOPE_NOT_AUTHORIZED', 'Repository is not allowlisted for Knowledge capture');
  const spec = repositories[fullName];
  verifyScope(spec);
  return sourceMetadata(event, fullName, spec);
}

const pending = (candidate, reason) => ({
  status: 'PENDING_KNOWLEDGE_UNSAVED', eventKey: candidate.eventKey,
  path: candidate.path, reason,
});
function matches(page, candidate) {
  return page?.path === candidate.path && page?.title === candidate.title &&
    page?.body === candidate.body && page?.sourceUrl === candidate.sourceUrl &&
    page?.status === 'draft' && Number.isInteger(page.version) && page.version >= 1;
}
/**
 * The adapter exposes read(path) -> {page} or null, and capture(args).
 * A missing page must be returned as null; storage or permission errors must
 * throw (never silently masquerade as an absent page).
 *
 * A deterministic per-PR path prevents delivery ID redelivery and repeated
 * webhook requests from introducing duplicate revisions. Existing content
 * that differs is NEVER overwritten. A successful write must pass readback.
 */
export async function saveVerifiedGitHubMerge(candidate, adapter) {
  if (!candidate || typeof candidate !== 'object' || !authenticatedCandidates.has(candidate) ||
      candidate.kind !== 'github.pr.merged' || candidate.sourceAuthenticated !== true ||
      candidate.scope !== 'personal' || candidate.classification !== 'nonclinical')
    reject('NOT_CAPTURE_ELIGIBLE', 'Capture requires an authenticated allowlisted nonclinical merge');
  if (!adapter || typeof adapter.read !== 'function' || typeof adapter.capture !== 'function')
    reject('INVALID_ADAPTER', 'Authenticated Knowledge read/capture adapter required');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await adapter.read(candidate.path); }
    catch { return pending(candidate, 'READ_UNAVAILABLE'); }
    if (response?.error || (response !== null && !response?.page))
      return pending(candidate, 'READ_UNVERIFIED');
    if (response?.page) {
      return matches(response.page, candidate) ?
        {status: 'SAVED', action: 'unchanged', path: candidate.path,
          version: response.page.version, eventKey: candidate.eventKey} :
        pending(candidate, 'EXISTING_RECORD_CONFLICT');
    }
    let conflict = false;
    try {
      await adapter.capture({path: candidate.path, title: candidate.title,
        body: candidate.body, sourceUrl: candidate.sourceUrl, expectedVersion: 0});
    } catch (e) {
      if (e?.code === 'VERSION_CONFLICT') conflict = true;
      else return pending(candidate, 'WRITE_FAILED');
    }
    if (conflict) continue;
    let saved;
    try { saved = await adapter.read(candidate.path); }
    catch { return pending(candidate, 'READBACK_UNAVAILABLE'); }
    if (matches(saved?.page, candidate))
      return {status: 'SAVED', action: 'created', path: candidate.path,
        version: saved.page.version, eventKey: candidate.eventKey};
    return pending(candidate, 'READBACK_MISMATCH');
  }
  return pending(candidate, 'CONCURRENT_VERSION_CONFLICT');
}
