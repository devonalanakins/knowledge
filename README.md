# Knowledge

A **GPT-maintained, self-hostable wiki** developed for DevonStation. An authorized assistant captures, organizes, revises and finds information; humans primarily browse, search, and selectively share pages. **No manual document editor, project board, CRM, database designer, or Notion feature-parity program is planned.**

**Status (November 5, 2026): source-only local preview. Not deployed; not connected to ChatGPT; not a replacement for the user's authoritative Notion workspace.** No real personal, business, family or clinical data has been imported.

## What is in this initial build

- A local agent-ingestion API for automatically creating/updating stable wiki paths, e.g. `projects/devonstation/architecture`.
- Idempotent capture (unchanged submissions do not create a duplicate history entry); revisions are retained. Automated updates preserve existing source URLs when omitted and cannot overwrite human-reviewed entries.
- Structured wiki navigation, local full-text search and an accessible private reader.
- Separate owner and agent tokens; automatic captures always remain `draft`, never approved human decisions.
- Optional, explicit single-page share links, pinned to the exact revision shared; links are revocable. The assistant cannot generate a public link by itself.
- Self-hosted SQLite store, scoped workspaces, relations, and portable checksummed snapshot/empty-target restore.
- Automated captures are limited to 16 KiB of UTF-8 text, with 128 revisions per page, 5,000 captured pages and a conservative 8 MiB default logical text budget per workspace. No silent truncation or deletion. Use local `stats` to inspect usage; see [Storage and privacy](docs/STORAGE.md).
- Synthetic tests only, no third-party runtime packages.

## Requirements

Node.js 22.13+ (prefer Node 24) with built-in SQLite/FTS5. Earlier runtimes emit an experimental SQLite warning. This is **single-node trusted local preview software**, not a hardened internet-facing server.

## Local quick start

```bash
npm run check
npm test
mkdir -p data exports
npm run knowledge -- --db ./data/knowledge.sqlite init personal Personal
```

Generate distinct 32+ character secrets locally and supply them via your process environment. Never put secrets in `.env` committed to GitHub, shell history, chat logs, or screenshots.

```bash
export KNOWLEDGE_DB="$PWD/data/knowledge.sqlite"
export KNOWLEDGE_OWNER_TOKEN="<locally generated owner secret>"
export KNOWLEDGE_AGENT_TOKEN="<different locally generated agent secret>"
npm run serve
```

The preview listens on `127.0.0.1:3189` only. Open `http://127.0.0.1:3189`, enter the owner token once to access the private wiki. The preview uses an HttpOnly, SameSite=Strict owner cookie. Do not expose the server directly to the internet; an eventual hosted instance requires TLS, trustworthy reverse-proxy configuration, strong authentication, abuse limits, and independent security assessment.

### Assistant-facing API (not connected yet)

The source-only [local MCP adapter](docs/MCP-LOCAL.md) exposes authenticated scoped wiki reads and draft-only capture at POST /mcp. It is **not** an installed ChatGPT app or externally reachable service.


An **explicitly authorized external integration** could call:

- `POST /api/v1/capture` — machine write (`Authorization: Bearer <agent token>`).
- `GET /api/v1/pages`, `GET /api/v1/search?q=...`, `GET /api/v1/page/{path}` — machine read (owner or agent token).

Example JSON payload:

```json
{
  "path": "projects/devonstation/architecture",
  "title": "DevonStation architecture",
  "body": "## Status\nA source-grounded summary goes here.\n## Evidence\nSource and update history are recorded separately.",
  "sourceUrl": "https://example.org/synthetic-source"
}
```

GPT must select a stable hierarchical path, include evidence where available, use source-grounded content, and avoid treating its own summary as verified approval. The API will **not** automatically intercept ChatGPT conversations. Actually connecting a GPT requires a separately authorized adapter/connector and reachable authenticated endpoint; no remote connection is claimed.

### Selective sharing

For a page you specifically want to share, run:

```bash
npm run knowledge -- --db ./data/knowledge.sqlite share personal projects/devonstation/architecture
```

The CLI returns a random share token. The share URL will be `https://your-approved-host.example/s/<token>` once the service is properly hosted. A share always displays the **approved snapshot revision**, not silently updated AI text. To revoke, run `npm run knowledge -- --db ./data/knowledge.sqlite revoke <token>`. Tokens are access capabilities: anyone who knows the URL can view that revision. Public sharing is not ready until the service is safely deployed.

### Backups

The local CLI produces **authenticated, password-encrypted** snapshots. Provide `KNOWLEDGE_BACKUP_PASSPHRASE` from a secure secret store or private process environment for export and restore; keep a recovery copy of the key **separate from the backup**. Use a high-entropy passphrase; length alone is insufficient. Do not paste the passphrase into CLI arguments, Git, chat, URLs or screenshots.

```bash
npm run knowledge -- --db ./data/knowledge.sqlite export personal ./exports/personal.json.enc
npm run knowledge -- --db ./data/restore.sqlite restore ./exports/personal.json.enc
```

CLI backups use scrypt and AES-256-GCM to authenticate and encrypt snapshots. Direct programmatic snapshots, the live database, FTS index and WAL remain **plaintext**. If you lose the key, recovery fails. Share tokens are excluded, so restores invalidate old share links. Restore refuses existing workspaces.

## Notion migration — read-only preflight

Knowledge is intended to replace Notion as an **AI-maintained wiki**, not recreate Notion's manual editor, task boards or cloud-file hosting. The original workspace must first be archived in independently encrypted cold storage; the live wiki contains only brief source-grounded entries and links.

Use `npm run notion:inspect -- /path/to/extracted-export` to produce a **read-only, aggregate** file/ID/link inventory from a Notion Markdown/CSV/HTML export. The optional second argument writes an encrypted, sensitive metadata manifest using `KNOWLEDGE_BACKUP_PASSPHRASE`, outside the export directory. This step does not import anything, verify all Notion permissions, or change Notion. See [Migration and recovery gates](docs/MIGRATION.md).

## Scope boundaries

The original Notion workspace remains authoritative. Human creation/editing, sophisticated database properties and cross-user collaboration are deliberately out of scope. The app is neither a Mizvo file-storage product nor a clinical service. No deployment, Cloudflare resources, production identity, Notion import, direct ChatGPT connection, synchronization or data cutover have been performed.

[Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Design record](https://app.notion.com/p/40f88cc2ef1481eb9bd0ea3dcbf31952).

## License

AGPL-3.0-only. See `LICENSE` in the repository release. Do not publish personal workspace data, secrets or client-specific IP in the source tree.