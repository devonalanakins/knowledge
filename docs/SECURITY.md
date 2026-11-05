# Knowledge preview security boundary

This is a **local, synthetic-only** proof of a GPT-maintained wiki. Do not expose directly to a public interface. It is not a finished security architecture or a production identity system.

## Protections present

- Separate owner and agent tokens, both at least 32 bytes; bearer tokens required on machine APIs.
- Only one configured workspace is visible through the server; unknown fields, paths, and role/status escalation attempts fail closed.
- Agent writes are always drafts. The API never creates public shares. Captures cannot change a human-reviewed non-draft page; omitted source URLs preserve existing provenance.
- Browser reading requires an HttpOnly, SameSite=Strict session cookie; no browser edit operations.
- Share tokens use 32 random bytes; stored only as SHA-256, pinned to an explicit immutable revision and revocable.
- HTML-escaped pages, restrictive CSP, Referrer-Policy: no-referrer, noindex and no-store.
- SQLite workspace foreign keys, immutable revision guards and exact-version update checks.
- Private file permissions, protected local exports, no inclusion of share tokens in snapshots.

## Known limits / release gates

- Local owner-token form is not hardened for public login: rate limiting, CSRF defense for privileged browser mutations, OIDC/session revocation, TLS, proxy trust and external identity verification still require engineering.
- No user-by-user grants, tenant security review, evidence-signing, encrypted database backup, Cloudflare deployment, D1 adapter or multi-node concurrency tests.
- Local MCP validates Bearer role and server-side workspace scope on every request. It checks localhost Host/Origin and never exposes approval or sharing tools. Remote OAuth, TLS, abuse controls and session identity are not implemented.
- Automatic GPT capture is a local tool/API contract, not an installed ChatGPT connector. It must not scrape private conversations or imply broader permission.
- A source URL is a user-controlled HTTPS reference, not verification that its content is true or accessible.
- Any publicly shared page is visible to anybody with its share token; never assume private information can be safely published simply because a link is obscure.
- Publishing AGPL source does not authorize public publication of private customer/family/clinical content, credentials or external IP.
- Before any actual private-data migration, test restored independent backups, permission scope, provenance, revocation and rollback. Preserve authoritative Notion records.