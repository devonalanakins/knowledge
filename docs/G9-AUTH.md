# G9a: synthetic MCP access-token verification — NOT A CONNECTED PLUGIN

This increment prepares the Knowledge resource server for a separately operated OAuth authorization server, without authenticating a real user or exposing Knowledge to the internet. Do not install as a public ChatGPT connection.

`createMcpAccessTokenVerifier` accepts **only trusted public JWKs**, an exact HTTPS issuer, an exact HTTPS resource audience, and an explicit set of allowed subjects. Each request verifies a compact signed JWT (`EdDSA` or `RS256`, minimum 2048-bit RSA), `at+jwt` type, `kid` allowlist, issuer, audience, principal, expiration, not-before, issue time, a maximum one-hour token lifespan and exact `knowledge.read`/`knowledge.write` scopes. Keys are configured by an operator, **not fetched from untrusted token headers**. It returns `owner` for read-only tokens and `agent` for read+draft-write tokens. Workspace scope remains bound to the server's own configuration, not the token payload.

`createKnowledgeServer(..., {mcpTokenVerifier})` optionally uses that verifier on **localhost POST /mcp** and rejects fallback to the old local owner/agent secrets for that endpoint. It disables the legacy `/api/v1/` routes while this mode is active, to avoid an alternate authentication route for wiki content. This compatibility mode is **not a production hosting contract**. Other local browser/share routes remain and need independent hardening.

The exact-branch integration test signs synthetic tokens using ephemeral local keys and exercises MCP initialization, tool discovery, draft capture, search, readback, idempotency, wrong-audience tokens, expiration, read-only denial, and cross-workspace boundaries. The test uses the real SQLite store and localhost HTTP transport, but **not** ChatGPT, a live OAuth provider, private data, HTTPS or production identity.

## What remains for a real ChatGPT connection

1. A supported OAuth 2.1 authorization-code + PKCE provider with consent, discovery, refresh tokens, token lifetime and revocation.
2. MCP protected-resource metadata and resource auth challenges, published behind trusted HTTPS, and per-tool authorization metadata.
3. Verified identity-specific scope mapping, durable grants and revocation, secure audit/key custody and rate controls; no public legacy owner login endpoints.
4. Encryption for the active Knowledge DB and FTS/WAL, encrypted independently restored backups, and private-host security review.
5. A real authenticated ChatGPT web plugin integration with fictional data, including a user-authorized write and subsequent search/readback.
6. Actual Notion import only after complete export and independent reconciliation and explicit owner approval.

**Do not expose the current localhost service as an internet-facing deployment.** This code is a resource-token validation primitive, not a standalone OAuth provider or OpenAI-approved application. It does not automatically capture ChatGPT conversations. Any ChatGPT tool write may require confirmation.
