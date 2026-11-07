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

Knowledge is intended to replace Notion as an **AI-maintained wiki**, not recreate Notion's manual editor, task boards or cloud-file hosting. The original workspace must first be archived in independently encrypted cold storage (use `npm run notion:archive -- encrypt /protected/export.zip /archive/export.zip.enc`, with a separately held passphrase); the live wiki contains only brief source-grounded entries and links.

Use `npm run notion:inspect -- /path/to/extracted-export` to produce a **read-only, aggregate** file/ID/link inventory from a Notion Markdown/CSV/HTML export. Compare that preflight against a separately acquired read-only Notion ID inventory using the `reconcileNotionInventory` library function; any database rows lacking stable IDs, inaccessible records, and unclassified owners remain blocked. Neither step imports content or certifies a complete workspace replacement. The optional second argument writes an encrypted, sensitive metadata manifest using `KNOWLEDGE_BACKUP_PASSPHRASE`, outside the export directory. This step does not import anything, verify all Notion permissions, or change Notion. See [Migration and recovery gates](docs/MIGRATION.md).

## Synthetic-only staged Notion index (G6)

`src/notion-stage.mjs` adds an offline verified Markdown source reader and an explicit synthetic-only staging pilot. It verifies original hashes, access scope, file paths and encoding, then creates up to 20 **metadata-only** index entries in a new local SQLite database. Original bodies are **never copied** into the wiki. This is not an approved private-data importer, a working archived-originals viewer or evidence of complete Notion replacement. See [G6 migration gate](docs/MIGRATION.md).


## Encrypted source retrieval prototype (G7)

Original Notion Markdown can now be recovered from **individually encrypted synthetic capsules**, even after the extracted fictional fixture has been deleted. The library verifies source IDs, hashes, workspace scope and authenticated decryption. It is intentionally offline and gated to synthetic test content; there is no public reader, automatic migration or real-data authorization. This keeps the active wiki small while demonstrating a separate recoverable original-source layer.

See [G7 source capsule limitations](docs/MIGRATION.md).

## G8 offline archive access gate (synthetic-only)

An operator-provisioned, **offline-only** gate now checks high-entropy credential hashes, per-scope grants, expiration/revocation, registered source identity and auditable delivery before returning an encrypted original. The current audit sink writes bounded pseudonymous metadata only. No source text is added to the live wiki, and no HTTP/MCP route, production identity provider, durable revocation or live database encryption is added. [G8 security restrictions](docs/ORIGINAL-ACCESS.md).

## G9a — Signed MCP token verification and end-to-end synthetic proof

A provider-independent, strictly scoped JWT access-token verifier is available to the existing localhost MCP adapter through `mcpTokenVerifier`. It validates signatures against operator-approved public JWKs (EdDSA or RS256), exact HTTPS issuer and audience, allowed principal, lifetime and `knowledge.read`/`knowledge.write` scopes. Legacy owner/agent API routes cannot bypass it in this configuration. The synthetic integration test demonstrates a real localhost MCP read → create draft → search → read-back cycle using independently signed tokens and the SQLite store. **This is not OAuth linking or a ChatGPT connection.** No real data, hosting or secrets have been added. See [G9a limitations](docs/G9-AUTH.md).

## G9b protected-resource discovery (synthetic source only)

The localhost signed-token MCP preview can now advertise **OAuth protected-resource metadata** and issue standard read/step-up permission challenges. A valid read-only token cannot write; an independently issued, correctly scoped token can capture drafts after explicit authorization. [Implementation and limitations](docs/G9-AUTH.md). OAuth account linking, a hosted HTTPS endpoint, private ChatGPT plugin registration and live-data encryption remain unfinished.

## Scope boundaries

The original Notion workspace remains authoritative. Human creation/editing, sophisticated database properties and cross-user collaboration are deliberately out of scope. The app is neither a Mizvo file-storage product nor a clinical service. No deployment, Cloudflare resources, production identity, Notion import, direct ChatGPT connection, synchronization or data cutover have been performed.

[Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Design record](https://app.notion.com/p/40f88cc2ef1481eb9bd0ea3dcbf31952).

## License

AGPL-3.0-only. See `LICENSE` in the repository release. Do not publish personal workspace data, secrets or client-specific IP in the source tree.
### G9c tool-level OAuth permissions (local synthetic proof)

In the signed-token MCP preview, Knowledge declares read and write OAuth scopes **per tool**, and missing write permission returns the ChatGPT-compatible `mcp/www_authenticate` tool-level challenge. This advertises a consent path but cannot issue tokens or connect itself to ChatGPT. [Authentication constraints](docs/G9-AUTH.md).

### G9d synthetic HTTPS proxy origin (test-only)

The separately configurable `npm run serve:mcp:synthetic` entrypoint is **not production**: it uses an in-memory database containing exactly one fictional starter page, operator-provided public JWT signing keys, and a fixed allowed principal. It binds only to `127.0.0.1`, and rejects requests that do not appear to arrive through a trusted, pinned HTTPS reverse proxy. A supported OAuth issuer and HTTPS tunnel must be configured and tested separately. **Do not publish this server or import personal data.** See [G9d configuration and security gates](docs/G9D-HOSTING.md).

### G9e OAuth issuer compatibility preflight (read-only)

`preflightMcpOAuthIssuer` verifies explicitly pinned OAuth issuer metadata and public signing keys without acquiring tokens, authorizing accounts, connecting ChatGPT, changing data or activating live hosting. It checks canonical HTTPS endpoints, issuer matching, PKCE S256, authorization-code support, required Knowledge scopes and candidate client registration. It returns a **METADATA_COMPATIBLE_ONLY** result, not a usable OAuth connection or production security approval. The operator must enforce DNS/egress safeguards before running against external providers. [G9e security limitations](docs/G9E-ISSUER.md).

### G9f Cloudflare Managed OAuth access-assertion verifier (synthetic-only)

A separate, optional **read-only** verification adapter validates the origin-side `Cf-Access-Jwt-Assertion` signed by a configured Cloudflare Access team, including pinned issuer, Access application audience, approved subject, expiry and trusted public signing keys. This verifies an asserted Access identity but does **not** prove a Knowledge-specific write grant, so the adapter always maps to read-only. The MCP server now passes the raw local request to an explicitly configured verifier; previous JWT verifiers remain compatible. The adapter is NOT wired into a public endpoint or started by any CLI script, and Cloudflare Managed OAuth has not been configured or connected. [Security limitations](docs/G9F-CLOUDFLARE.md).

### G9g Cloudflare-managed OAuth read-only origin (synthetic only)

A distinct, **in-memory-only** Cloudflare Access origin preview is available behind a locally pinned HTTPS reverse proxy. It validates signed Access assertions using owner-only operator key and principal files, requires an explicit Cloudflare-managed-OAuth mode acknowledgment, and exposes **only search/list/read MCP tools**. The origin does not publish its own OAuth discovery metadata or write tool—Cloudflare Access handles the browser authorization exchange at the edge. No Cloudflare Access app or route has been created. This is not a safe production service or a Notion replacement. See [G9g operating boundary](docs/G9G-CLOUDFLARE-ORIGIN.md).

### G9i — Cloudflare Worker read-only synthetic MCP adapter (source only)

A separate, stateless `src/worker-cloudflare-synthetic.mjs` entrypoint reuses the portable MCP dispatcher without bundling the Node SQLite store. It requires an actual Access-authenticated direct Worker request (`ctx.access`), an exact application audience, a single owner email allowlist, an exact HTTPS resource URL, and an explicit synthetic-only acknowledgment. It exposes only read/list/search over one hard-coded fictional page; no data storage or write path exists. The included Node Request/Response tests simulate Access and do **not** prove a deployed Cloudflare Access or ChatGPT OAuth flow. No Cloudflare resources have been provisioned or deployed. See [G9i guide](docs/G9I-WORKER-READONLY.md).

## G10 — Organized wiki classification and navigable backlinks (synthetic, source-only)

Knowledge now includes the seven previously adopted, color-coded encyclopedia portals; a private, metadata-only `planOrganizedMigration` library; and a local owner reader with portal filters and incoming/outgoing wiki links. The planner requires explicit Notion IDs, approved scope classification, canonical article types and titles, source references, statuses, and separate fiction canon authority. It flags duplicate concepts and aliases, malformed sources, incomplete exports, unauthorized cross-scope relations, broken parents, cycles and orphan candidates. It does not alter a source document, import a Notion body, approve content, or authorize cutover.

The owner-only local reader displays existing links from the scoped database; selective shared pages never include the backlink graph. Older wiki paths remain supported without silently recategorizing them. See [G10 organizational contract](docs/ORGANIZATION.md). Actual private-data migration and remote deployment are still release-blocked.

## G14 — Synthetic approval audit with persistent replay protection

An optional, owner-local SQLite `ApprovalLedger` now records signed hierarchy approval IDs as **consumed or revoked** with atomic, immutable-event constraints and a hash-chained audit history. An independently protected head digest is necessary to detect a valid-looking truncated chain. The encrypted Notion review command accepts an optional sixth argument pointing to a private, preexisting ledger and requires a matching `ledgerHeadHash` inside the separately controlled reviewer trust file. The reviewer can no longer silently treat a previously finalized signed approval as valid. The CLI does not modify approvals or original data. This is **synthetic-only source**, not an authenticated production system or a live importer. See [G14 operational limits](docs/ORGANIZATION.md).

## G15 — Reversible, organized synthetic Notion import rehearsal

Knowledge now includes a **synthetic-fixture-only** staging importer that uses the existing Notion preflight, independent source inventory, and G10–G14 organizational approvals. It verifies source hashes and classifications; stages exact fictional Markdown in an entirely new local Knowledge database; preserves original and proposed parentage, canonical paths, aliases, color portals, statuses and explicit relationship records; and verifies a recovery snapshot and reciprocal backlinks. It never overwrites originals or an existing target. The recovery archive and staging database contain **plaintext fictional fixture content** and must not be reused for real private records. This is source-only, not the actual Notion migration. See [G15 review and recovery gates](docs/ORGANIZATION.md).

## G16 — Encrypted, in-memory staging for fictional Notion fixtures

The synthetic organizer can now construct and restore a complete wiki source/relationship archive entirely in memory before encrypting it with scrypt and AES-256-GCM. The owner-local \`writeEncryptedSyntheticStage\` path writes **only a ciphertext \`.enc\` file** (0600 permissions, never overwrites) to a private directory; \`inspectEncryptedSyntheticStage\` validates and restores that encrypted handoff in memory without creating a plaintext SQLite file. Original Markdown, source identifiers, canonical paths, aliases, hierarchy, and private links are checked before sealing. This is a **fictional-data test workflow, not a real Notion importer or live encrypted store**. See [G16 controls and limitations](docs/ORGANIZATION.md).

## G17 — Encrypted Notion source eligibility review

A metadata-only source triage now compares the independently inventoried original IDs, export checksums and content types, scoped wiki classifications, declared ownership, sensitivity and intended disposition. It excludes clinical material, credentials and unsupported third-party reuse from migration candidates, flags unknown permissions/scope and coverage gaps, and keeps the detailed review in a new encrypted owner-local \`.enc\` file via \`npm run notion:eligibility\`. A candidate is **not** permission to import; self-reported classifications cannot certify the absence of private or clinical material. No real records are imported, published or deleted, and Notion remains authoritative. See [G17 organization and privacy gates](docs/ORGANIZATION.md).

## G18 — Read-only Notion API inventory (private, source-only)

A strictly read-only Notion API metadata enumerator now pages through explicitly configured data sources and creates a private AES-256-GCM inventory archive. It retains original IDs, edited timestamps, parent references, properties and cross-register identity checks without copying page bodies or attachments. It refuses Notion mutation endpoints and rejects duplicate IDs, missing pagination cursors or count drift. The command is \`npm run notion:api:inventory -- PRIVATE_CONFIG.json OUTPUT.enc\` with operator-supplied \`NOTION_API_TOKEN\` and \`KNOWLEDGE_BACKUP_PASSPHRASE\` in a protected environment. **The connected Notion plugin does not automatically supply this token to the local Node process.** The output contains private metadata and must never enter this public repository. See [G18 source inventory and release limits](docs/ORGANIZATION.md). No actual Notion contents have been migrated or deployed.

## G19 — Encrypted Notion page-body and nested-block capture

G19 adds a **read-only, explicitly selected** Notion content export using the G18 encrypted source inventory. \`npm run notion:api:content -- ENCRYPTED_INVENTORY.enc SELECTION.json OUTPUT.enc\` retrieves and preserves original page properties, nested paginated blocks, rich text, source identities, structure, relation references and checksums in memory, then writes **only a protected AES-256-GCM encrypted archive**. The owner-selected batch is capped at eight known Anevum pages; external child pages and media bytes are not silently fetched. Missing assets, remote synced blocks, historical revisions and unresolved relationships remain explicit limitations. A scoped Notion token and owner-stored passphrase are required; no real Notion content has been captured through the public CI process and no Knowledge production import or Notion retirement is authorized. See [G19 privacy, commands and fidelity limits](docs/ORGANIZATION.md).

## G20A — Paginated Notion relation recovery (source-only)

Knowledge can now capture the complete ordered related-page IDs for Notion page properties whose relation arrays were truncated in the read-only G18 inventory. This is an **opt-in enhancement to G19**: add `"resolvePaginatedRelations": true` to the protected `knowledge-notion-content-selection-v1` JSON, then run the existing `notion:api:content` command using the separately provisioned read-only Notion token and private passphrase. No new credentials are read from the repository. A bounded read-only property pagination path preserves full relationship identities and original partial properties, checks for cursor/ID duplication and inventory drift, and independently re-reads those relations after encryption before no-clobber ciphertext publication.

This does not fetch related page bodies, external attachments, synced blocks or every other incomplete Notion property type. It is **not** a full export, Knowledge import, authenticated live ChatGPT writeback, production deployment or approved Notion cutover. All real data stays within the owner-selected protected local runtime; only synthetic fixtures belong in the public repository or CI. [G20A security and remaining migration gates](docs/ORGANIZATION.md).

## G20B — Opt-in encrypted Notion-hosted file evidence (bounded, source-only)

The existing `notion:api:content` flow can optionally capture **small, explicitly selected Notion-hosted attachment bytes** along with the selected read-only page and nested block archive. The protected selection JSON must set `"captureNotionFiles": true` and `"approvedNotionFileHosts": ["file.notion.so"]` (or another verified, supported exact Notion file host). Default G19 behavior remains metadata-only for file references. The download path allows only approved HTTPS hosts, disallows redirects and ambient credentials, requires a non-expired Notion signed URL, and streams under strict quotas (**8 files, 1 MB each, 3 MB per archive batch**). The existing AES-256-GCM private archive contains source provenance, byte hashes and file bytes; it never records expiring signed URLs. Encrypted recovery separately verifies byte digests, counts and linked source identifiers.

This remains a **small synthetic-tested archive capture**, not a full Notion backup, production migration or permission grant. Real use requires a private, least-privilege Notion token, reviewed nonclinical Anevum source selection and an independently enforced trusted DNS/egress policy; encrypted active database storage, real GPT read/write consent, full Notion content/attachments/revision/ACL fidelity, deployment and owner-approved cutover remain blocked. See [G20B requirements and current limitations](docs/ORGANIZATION.md).

## G20C — Offline encrypted source/file completeness inspection

An owner-local read-only tool can now check a selected G19–G20B ciphertext archive without logging source content or requiring a Notion API connection:

    npm run notion:api:verify-content -- /owner-only/content-batch.enc

Provide the independent KNOWLEDGE_BACKUP_PASSPHRASE in a protected environment, not in the command line or source control. The encrypted file and its directory must be owner-only; inspection never creates a plaintext SQLite database or writes a restored page. Its output is aggregate only: saved Notion file references, captured file count/bytes, missing file bytes, unsupported external/upload references and whether the **selected saved source evidence** reconciles internally. Every attachment must match an exact redacted original page/block/source path; forged or orphaned attachment evidence and unredacted temporary signed URLs fail closed. No source page text, original IDs or filenames are emitted.

A successful inspection is *not* full Notion source-fidelity certification, a secure-production deployment, an approved private-data import or authorization to delete/retire Notion. Complete export permissions, detached source provenance, restricted network egress, historical revisions, child pages, larger files, live encrypted database and GPT writeback still need independent verification. See [G20C technical gates](docs/ORGANIZATION.md).

## G21 — Offline private Notion capture preflight

Before any owner-authorized real-source capture, inspect the existing encrypted G18 source inventory and the explicitly selected nonclinical G19 page configuration without connecting to Notion or writing any files:

    npm run notion:api:preflight-content -- /private/inventory.enc /private/selection.json /private/new-content.enc

The operator supplies KNOWLEDGE_BACKUP_PASSPHRASE and a separately scoped NOTION_API_TOKEN via the protected runtime environment. The command refuses nonprivate input files, unsafe or existing destinations, unrecognized owner/scope/source IDs, malformed relation selections and unapproved media hosts. It returns **only counts and security gate booleans**, not source IDs, page titles or secret values. It does **not** exercise the Notion API token, test DNS/egress restrictions, prove legal/data-owner consent or inspect media authenticity; privateRehearsalAuthorized, independentNotionSourceVerified, restrictedEgressVerified, independentRestoreVerified, productionReady and cutoverApproved remain false even if local checks pass. This is a prerequisite check, not an approval to process real content. It performs **zero HTTP calls**, imports nothing and does not modify Notion or Knowledge.

See [G21 privacy and no-go criteria](docs/ORGANIZATION.md).

## G22 — Offline reconciliation of encrypted inventory and content snapshots

After creating a protected G18 metadata inventory and a bounded G19–G21 content archive in an authorized owner-local environment, the following command verifies their internal agreement without connecting to Notion or restoring plaintext files:

```sh
npm run notion:api:reconcile-archives -- /owner-only/inventory.enc /owner-only/content.enc
```

The owner supplies `KNOWLEDGE_BACKUP_PASSPHRASE` using protected runtime configuration. The command authenticates the encrypted content archive, reconstructs and checks the G18 inventory fingerprint, and compares every selected captured page with the original inventoried page identity, scope, register, parent, source URL, edit timestamp, native properties and truncated relation-property prefixes. G20C attachment evidence gaps remain explicitly reported. Inputs must be owner-only private `.enc` files; outputs are aggregate counts and hardcoded release NO-GO flags only. It does **not** contact Notion, print source page IDs or content, establish independent original-source authenticity, certify permissions, create Knowledge records, authorize private content access or retire Notion.

See [G22 reconciliation details and remaining source-coverage limitations](docs/ORGANIZATION.md).
