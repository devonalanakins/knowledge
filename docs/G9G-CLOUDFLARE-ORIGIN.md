# G9g — Cloudflare Access Managed OAuth read-only origin, synthetic-only

**Release NO-GO.** The Cloudflare account's read-only application inventory contained **no identifiable Knowledge/MCP Access app** at verification on November 5, 2026. No DNS, Access application, OAuth configuration, Cloudflare Tunnel, ChatGPT plugin, service secret, or production deployment has been created.

Cloudflare Access Managed OAuth can perform the browser authorization flow and supply a signed `Cf-Access-Jwt-Assertion` to the protected origin. Its client-facing bearer token is opaque. Knowledge verifies the signed assertion and **permits reading only**; the identity assertion is not a Knowledge-specific authorization to write. The Cloudflare edge owns OAuth discovery and challenges, not this origin. G9a–G9e JWT issuer modes remain unchanged.

## Synthetic test-only entrypoint

`npm run serve:mcp:cloudflare:synthetic` starts an **in-memory** Knowledge store containing one synthetic page. It binds only to `127.0.0.1`. It cannot import a Notion file or open a disk database. Operator-supplied config:

- `KNOWLEDGE_SYNTHETIC_ACK=SYNTHETIC_ONLY_NO_PRIVATE_DATA`
- `KNOWLEDGE_MCP_AUTH_MODE=CLOUDFLARE_MANAGED_OAUTH_READ_ONLY`
- `KNOWLEDGE_MCP_RESOURCE=https://knowledge.example.test/mcp` (approved domain; replace example)
- `KNOWLEDGE_CF_TEAM_ISSUER=https://your-team.cloudflareaccess.com`
- `KNOWLEDGE_CF_APP_AUDIENCE=<actual Access application AUD>`
- `KNOWLEDGE_CF_PUBLIC_JWKS_FILE=/absolute/private/jwks.json` with `{"keys":[{"kty":"RSA","n":"...","e":"...","kid":"..."}]}`
- `KNOWLEDGE_CF_SUBJECTS_FILE=/absolute/private/subjects.json` with `{"allowedSubjects":["<signed-access-subject>"]}`
- `KNOWLEDGE_MCP_PORT=3189` optional; `KNOWLEDGE_DB=:memory:` or unset

Trust files are bounded, regular, non-symlinked and owner-only (0600). Never put keys, identities or tokens in the Git repository. The origin verifies Access RSA JWT signature, exact issuer, app audience, approved subject and validity; it **forces the read-only role** even if the identity adapter is changed to return a writer role. It shows only `knowledge_list`, `knowledge_search` and `knowledge_read`. `knowledge_capture_draft` is unavailable. The origin intentionally does not publish its own OAuth discovery metadata: Cloudflare Access Managed OAuth owns the OAuth 401/discovery flow.

## Network trust and remaining risks

This is **not a deployment configuration**. Before any live test, the owner must approve a separate Access application/policy and HTTPS routing, ensure Cloudflare Access validates every request, and block all direct origin access. The upstream reverse proxy MUST remove all client-supplied `Cf-Access-Jwt-Assertion` and `X-Forwarded-*` fields, then replace them with verified Access context. The loopback process checks pinned Host, HTTPS-forwarded context and remote loopback peer, but forwarded headers alone do not prove TLS or the caller's entitlement. Neither this preview nor the current connector has proven Cloudflare key rotation, app AUD, actual Access assertions, user policy, OAuth permissions, ChatGPT consent or mobile client support.

**The read-only limitation is intentional.** A future write mode requires distinct authenticated permission, durable grant and revocation, audited write tools, encrypted live SQLite/FTS/WAL and owner-approved private-data access. A Cloudflare Access login is never sufficient proof to auto-write. Source-only synthetic local tests and CI are not a security certification.

Cloudflare docs: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/

## G9h — Managed OAuth tool discoverability and fail-closed write boundary

The synthetic Cloudflare origin's `tools/list` now advertises only the three read operations, each with `_meta.securitySchemes: [{ "type": "oauth2", "scopes": [] }]` and explicit read-only tool annotations. The empty scope list is intentional: this **edge-managed OAuth path does not implement Knowledge write scopes**. The separate G9a–G9e signed-token preview still advertises its existing `knowledge.read` and `knowledge.write` permissions; its behavior is unchanged.

MCP initialization explicitly states that this Cloudflare path cannot draft, write, approve, publish or share. The dispatcher rejects draft capture whenever edge-managed read-only mode is selected, **even if a future upstream identity mapper accidentally assigns an agent role**. Synthetic HTTP tests verify tool discovery metadata, signed reads and write denial; a direct dispatcher test checks the role-misconfiguration case.

This improves protocol metadata and defense in depth **only**. It does not verify a live ChatGPT authorization request or guarantee compatibility with Cloudflare Managed OAuth. We still need a real Cloudflare-protected HTTPS route, verified Access assertions and header sanitization, an eligible ChatGPT web read-only connection, and separate owner-approved authenticated write design. Keep the origin synthetic-only, loopback-only, not deployed, and disconnected from private Notion information until all release gates pass.
