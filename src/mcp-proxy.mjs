/** G9d loopback-only HTTPS reverse proxy request boundary. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOST = /^[a-z0-9.-]+(?::[0-9]{1,5})?$/;

export function isTrustedMcpProxyRequest(req, expectedHost) {
  if (typeof expectedHost !== 'string' || !HOST.test(expectedHost) ||
      typeof req !== 'object' || !req || typeof req.headers !== 'object') return false;
  if (!LOOPBACK.has(req.socket?.remoteAddress)) return false;
  const headers = req.headers;
  if (headers.host !== expectedHost || headers['x-forwarded-proto'] !== 'https') return false;
  // The operator's proxy MUST strip any client-supplied forwarded headers first.
  if (headers['x-forwarded-host'] !== undefined && headers['x-forwarded-host'] !== expectedHost) return false;
  if (headers.forwarded !== undefined || headers['x-original-host'] !== undefined ||
      headers['x-forwarded-scheme'] !== undefined) return false;
  if (headers.origin !== undefined) {
    if (typeof headers.origin !== 'string') return false;
    try {
      const origin = new URL(headers.origin);
      if (origin.origin !== 'https://' + expectedHost || origin.href !== origin.origin + '/' ||
          origin.username || origin.password) return false;
    } catch { return false; }
  }
  return true;
}
