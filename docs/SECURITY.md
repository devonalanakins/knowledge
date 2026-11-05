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
- SQLite file permissions 0600 and no share tokens in snapshots. **CLI exports** use scrypt-derived AES-256-GCM authenticated encryption. Direct programmatic snapshots, active records, FTS and WAL remain plaintext; keys must be stored independently.
- Bounded GPT captures and per-workspace text budgets prevent unbounded agent-driven accumulation but are not physical disk limits. No database-level encryption or automatic redaction is claimed.

## Known limits / release gates

- Local owner-token form is not hardened for public login: rate limiting, CSRF defense for privileged browser mutations, OIDC/session revocation, TLS, proxy trust and external identity verification still require engineering.
- No user-by-user grants, tenant security review, live database encryption, production-grade encrypted backup recovery, Cloudflare deployment, D1 adapter or multi-node concurrency tests. Local encrypted CLI tests do not establish production key custody or recovery readiness.
- Local MCP validates Bearer role and server-side workspace scope on every request. It checks localhost Host/Origin and never exposes approval or sharing tools. Remote OAuth, TLS, abuse controls and session identity are not implemented.
- Automatic GPT capture is a local tool/API contract, not an installed ChatGPT connector. It must not scrape private conversations or imply broader permission.
- A source URL is a user-controlled HTTPS reference, not verification that its content is true or accessible.
- Any publicly shared page is visible to anybody with its share token; never assume private information can be safely published simply because a link is obscure.
- Publishing AGPL source does not authorize public publication of private customer/family/clinical content, credentials or external IP.
- Before any actual private-data migration, test restored independent backups, permission scope, provenance, revocation and rollback. Preserve authoritative Notion records.
## Requirements before actual private-data use

Use a protected volume or vetted database/application encryption with keys held separately from data, encrypted authenticated backups with tested restores, audited identity and revocation, TLS and origin security, rate limiting and independent access/security tests. Do not import private family, business or healthcare information before these gates pass. Bearer shares remain readable by anyone holding the URL, despite revision pinning and revocation. Security is never absolute.


## G7 offline encrypted source capsule prototype

Synthetic-only source capsules use scrypt/AES-256-GCM to protect independently recoverable **individual original Markdown documents**, outside the live SQLite index and public repository. Reads require an expected workspace scope, original ID and SHA-256, but the *caller* supplies these values; this local module is **not** a production identity or authorization service. Exports and decrypted text must not appear in logs, public pages, Git history or model tools. No public URL, connection to ChatGPT, PHI import or live database encryption has been added. Production remains NO-GO.
