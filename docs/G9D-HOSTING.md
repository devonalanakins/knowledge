# G9d — Synthetic-only private MCP origin

**Release status: NO-GO for private information, public hosting and Notion replacement.**

This entrypoint makes the existing `knowledge` Node HTTP resource configurable so an independently operated OAuth provider and a correctly configured HTTPS reverse proxy can eventually be tested. It **does not** contain an OAuth issuer or consent service, run a Cloudflare tunnel, connect to ChatGPT, or persist any wiki data. The only database allowed is `:memory:`, seeded with a fictional example.

## Operator inputs

Keep `JWKS` and allowed-subject JSON files outside the Git repository. Use absolute paths, owner-only file permissions (0600), publicly verifiable JWKs, and a fixed issuer/audience. Do not store private keys in these files.

- `KNOWLEDGE_SYNTHETIC_ACK=SYNTHETIC_ONLY_NO_PRIVATE_DATA` (required)
- `KNOWLEDGE_MCP_RESOURCE=https://wiki.example.test/mcp` (replace with a real approved HTTPS hostname)
- `KNOWLEDGE_MCP_ISSUER=https://issuer.example.test` (replace with a real OIDC/OAuth authorization-server issuer)
- `KNOWLEDGE_MCP_JWKS_FILE=/absolute/secure/path/jwks.json` (shape: `{"keys":[{"kty":"OKP","crv":"Ed25519","x":"...","kid":"..."}]}`)
- `KNOWLEDGE_MCP_SUBJECTS_FILE=/absolute/secure/path/principals.json` (shape: `{"allowedSubjects":["some-real-provider-subject"]}`)
- `KNOWLEDGE_MCP_PORT=3189` (optional; 1024–65535)
- `KNOWLEDGE_DB=:memory:` or unset. Disk paths are refused.

Run `npm run check && npm test` then `npm run serve:mcp:synthetic` under a dedicated low-privilege account. No actual provider authorization or ChatGPT linkage is asserted.

## HTTPS proxy invariant

The origin listens on **127.0.0.1**. All requests, including `/.well-known/oauth-protected-resource/mcp`, are refused unless the origin's socket peer is loopback, Host equals the configured resource hostname, and `X-Forwarded-Proto` is exactly `https`. Origin is checked when present. Unexpected `Forwarded`, `X-Original-Host`, `X-Forwarded-Scheme` or conflicting `X-Forwarded-Host` values are refused.

**Critical:** The reverse proxy must remove arbitrary client-provided `Forwarded` and `X-Forwarded-*` headers and set exactly the trusted values itself. Merely setting `X-Forwarded-Proto: https` does NOT establish that TLS was used. Never expose the loopback origin directly or set a public interface bind. Verify the exact Cloudflare Tunnel/Access/HTTPS forwarding behavior in a separately approved environment; don't assume Cloudflare Access JWTs are compatible OAuth resource access tokens.

## Deliberate limitations

- No OAuth authorization-code/PKCE, token issuance/refresh, client registration, durable grants, real identity provider, or verified ChatGPT web account linking.
- No private/clinical/family/Notion data, persistent database, share UI, encrypted live FTS/WAL, or original archive reader exposed.
- No background capture across ChatGPT conversations and no guaranteed unattended GPT writes.
- No provisioned tunnel, DNS, domain, service or associated spend in this increment.
- Static secrets from the legacy preview are not accepted in signed-token mode; old owner, share and API routes remain disabled.

**Test acceptance:** synthetic signed read token → tool discovery and read, denied read-only write, independently scoped write token → draft capture and read-back; untrusted proxy headers fail; restart removes captured data. A real ChatGPT plugin integration remains separately gated.
