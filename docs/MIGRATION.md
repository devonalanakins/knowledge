# Knowledge — complete Notion retirement without a Notion clone

**Design/engineering status: G5 preflight only; no real content migrated, no production-ready security, and no source-of-truth cutover.** Knowledge remains a small GPT-maintained wiki for navigation, citations, brief decisions and status. The complete *original* Notion archive is a separate encrypted cold artifact, not part of the live wiki database. A search summary is not a substitute for preservation of the original source.

## Observed source layout (historical Nov 2, 2026 audit)

Existing Notion records include an outer 647-entry Transcosmic wiki and a separately maintained 408-entry Canon Encyclopedia; 187 historical infrastructure records, 13 DevonStation portfolio records, and 30 Cristy business task records, among other pages and databases. **Do not sum these numbers into a claimed workspace total or automatically deduplicate them.** There are multiple permissions and distinct editorial authority models; the old audit is not a complete current page inventory. That audit identified missing metadata and some high-volume pages >100,000 characters.

## Zero-loss, low-footprint migration architecture

1. **Authoritative original snapshot.** Obtain a complete workspace export in **Markdown & CSV** (with subpages and assets), and a separate **HTML export** where comment/callout fidelity needs comparison. Do not use only an API search result or only Markdown to assert completeness. Notion warns inaccessible private pages/teamspace content are excluded. Encrypt each original ZIP using the streaming, authenticated `notion:archive` utility (scrypt + AES-256-GCM), then independently decrypt and hash-check its exact bytes before considering the archive a backup. The source ZIP remains untouched: secure or remove it only through a separately approved procedure after verifying encrypted recovery. Do not commit archives, manifests, filenames or secrets to public GitHub.
2. **Inspect without importing.** Extract in a protected, encrypted temporary volume using a safe extractor. Use the `notion:inspect` command to fingerprint the **extracted** original contents and optionally write an AES-GCM encrypted metadata manifest. The inspector uses streaming SHA-256 and counts CSV records, detects many malformed/missing internal links, duplicate/not-found IDs, symlinks and oversized exports. It **does not** infer database schemas, pages' private permissions, Notion history, current authoritative status, or whether all pages were exported. HTML links, advanced Markdown and database relations require later explicit reconciliation.
3. **Source-of-truth reconciliation.** Independently enumerate accessible Notion top-level pages, nested pages, every database and row with pagination. Compare IDs, count by source, content hashes where available, attachments and relation targets against the export. Mark EACH discrepancy `EXACT`, `CONVERTED`, `ARCHIVE_ONLY`, `MISSING`, `UNAUTHORIZED`, `UNSUPPORTED`, or `OUT_OF_SCOPE` with evidence. Without actual Notion IDs, only content-hash/path fallback is possible, and this is a manual-approval exception. Records omitted because the exporter lacked access cannot be presumed absent.
4. **Explicit identity comparison.** The standalone `reconcileNotionInventory(preflight, inventory)` function compares the encrypted export preflight with an independently obtained, source-ID inventory (`knowledge-notion-inventory-v1`) listing a UUID, type (`page`, `database`, `database_row`), explicit ownership scope (`personal`, `family`, `devonstation`, `anevum`, `cristy`, `mizvo`, `external` or `unknown`) and `accessible` flag for each object. It identifies missing page/database IDs, unmapped database-row IDs, unexpected export IDs, duplicates, unauthorized gaps and unclassified scopes. Counts remain aggregate-only; the returned ID lists are sensitive. Even a zero-difference comparison does **not** certify migration readiness without relation, content, access and restore checks. The code does not enumerate Notion itself; the external inventory must be independently acquired and complete.
5. **Ownership map before indexing.** Keep Devon personal/family, DevonStation development, Anevum creative, Cristy professional/business and outside clients in separately permissioned deployments/stores unless a verified authority model permits a limited shared index. No PHI import or public sharing by default. Each source maps to a single explicit destination; ambiguous scope stays quarantined. A title is not sufficient to infer permission.
6. **Active Knowledge projection.** GPT writes concise, source-grounded wiki summaries and navigation paths (16 KiB maximum per page). Preserve original Notion ID, last validated source hash, archive locator, relation IDs, status, and scope in the migration *mapping*, not in unchecked AI prose. Preserve original source bodies in encrypted cold storage, not in the live SQLite FTS index or duplicative page revisions. No manual Notion-style document editor is added. Long source documents receive topic summaries/links rather than truncated replacement text. Internal Notion links must be rewritten to owner-controlled stable Knowledge routes or archive references, not left as dangling Notion links.
7. **Independent recovery and verification.** Restore the original archive and Knowledge snapshots onto a separate fresh instance with a separate key and verify IDs, hashes, parentage, links, permissions, search answers, recovery of older versions, and revocation. Test fresh ChatGPT conversations with authorized remote identity using synthetic records first; real data only after approval. A live private wiki, encrypted backing store, secure sharing and successful independent restore are mandatory gates before replacing Notion.
8. **Bounded cutover, reversible rollback.** Freeze one selected source scope, ingest final Notion delta, reconcile counts and links, and get owner signoff. Redirect routine AI knowledge writes for *that scope* only; retain Notion read-only in a defined rollback window. Disable/close Notion only after separate, explicit confirmation that original complete records remain accessible and verified. Never auto-delete originals, shared business material or paid accounts.

## Local preflight usage (fictional data first)

On a local trusted machine using a protected temporary volume, export and extract the Notion ZIP **outside the source repository**. The inspector refuses symlink traversal and excessive file counts/bytes. A user-supplied path is inspected read-only; it is **not** copied to Knowledge.

```bash
# Aggregate counts only (no document bodies/titles printed):
npm run notion:inspect -- /path/to/extracted/notion-export

# Optional encrypted metadata manifest (not under the extracted directory):
# Set KNOWLEDGE_BACKUP_PASSPHRASE privately, using a high-entropy key.
npm run notion:inspect -- /path/to/extracted/notion-export /protected/private/notion-preflight.enc
```

## Encrypt the full original ZIP outside the live database

The 8 MiB active wiki text budget does **not** apply to the original export ZIP. The 25 MB single-object backup helper cannot safely protect large ZIPs. Use the streaming AES-256-GCM cold archive tool instead. Supply a unique, high-entropy `KNOWLEDGE_BACKUP_PASSPHRASE` through a secret manager or protected local process environment (never Git, chat, a URL or command arguments). Keep encrypted archives and protected decryption directories on trustworthy storage.

```bash
npm run notion:archive -- encrypt /protected/notion-export.zip /independent-archive/notion-export.zip.enc
# For independent recovery testing, decrypt into a fresh protected directory:
npm run notion:archive -- decrypt /independent-archive/notion-export.zip.enc /protected/recovery/notion-export.zip
```

The archive tool streams rather than loading the ZIP into RAM, refuses overwrites and checks authentication before publishing a restored destination. During decryption, it writes a **0600 temporary plaintext file** in the destination directory; that directory MUST be on an encrypted, access-controlled volume. Wrong keys and tampering fail without a visible final destination. This utility does not extract ZIP content or verify exported Notion coverage. No archive is created by this design session; tests use fictional bytes only. Verify exact source/recovered ZIP SHA-256 hashes independently.

The encrypted manifest contains **sensitive filenames, Notion identifiers and original source hashes**. Store and share it only within its authorized security boundary. The CLI reports aggregate counts, never body content. An exit code of `3` means the inspection finished with unresolved discrepancies; `1` means the inspection failed or could not safely write; `0` means no detected warnings, **not** full workspace coverage or production readiness.

## Non-negotiable release blockers

- Complete export unavailable via current Notion connector. Owner or an explicitly authorized browser session must obtain the export. Notion's export excludes inaccessible private pages/teamspaces; manual gap analysis is mandatory.
- The export inspector and ID comparator are metadata-only; there is no complete Notion enumerator, actual whole-workspace importer, permission/relations mapper, or irreversible Notion change.
- Live Knowledge SQLite, FTS and WAL currently remain plaintext; scrypt/AES-GCM protects only CLI backup files and optional encrypted manifests. Do not load actual private material until live data and identity security are separately verified.
- Existing 8 MiB active text budget is **not** a limit on the encrypted cold archive or complete historical records. No historical source material may be silently discarded to satisfy the live wiki budget.

References: Notion Help, *Export your Notion content* and *Back up your Notion data*; existing DS011-KN01 and Notion Workspace Audit (November 2, 2026).

## G6: verified protected-source reader and synthetic-only staging index

**Implemented in source / not a real-data importer.** `src/notion-stage.mjs` exports `planNotionSyntheticStage`, `readVerifiedNotionMarkdown`, and `stageSyntheticNotionIndex`. It can construct a _new_ SQLite index of up to 20 explicitly selected **synthetic** Notion markdown pages after independently matching their IDs, one export file per ID, approved scope, accessible status, absence of unresolved links, SHA-256 bytes, UTF-8, and file size. The original body is read and fingerprint-verified by a trusted offline process but is never copied into the staged wiki record. No real Notion material is imported, and this step neither reconstructs databases nor resolves the entire archive's structure.

Each staging index entry is marked as an **archive-only metadata placeholder** with source ID, original path, source hash, and a conspicuous `CONTENT NOT IMPORTED` notice. It must not be presented as an AI-written summary, original-text access, proof of completeness, or a migrated source record. The separate original archive is still necessary. The module has no browser, ChatGPT, public API or share operation.

The original reader accepts only small Markdown files (at most 1 MiB) and verifies their contents against the already inspected, independently scoped preflight. It rejects path traversal, symbolic-link ancestors and files, changed hashes or sizes, ambiguous IDs, inaccessible/wrong-owner records, unverified links and malformed UTF-8. This reader operates on a **previously extracted export in a trusted, encrypted temporary volume**, not directly on the encrypted ZIP. Parent-directory swap races and host compromise are outside its current threat model; use a protected local machine only.

The staging writer is **synthetic-only**: caller must explicitly set `syntheticOnly: true`, and each input must have the `# SYNTHETIC FIXTURE` marker. It creates a new, owner-only SQLite file using an atomic no-clobber step, and never writes within the source export directory. It refuses existing output and cleans temporary files on failure. The fixture marker is a testing guard, **not a substitute for data-classification controls or encryption**; do not invoke against real private data. Human data rights and production encryption remain release blockers.

The next increment must build a security-reviewed authenticated archive member reader against independently recovered originals, link-rewriting and owner permission mapping, then a narrowly authorized real-data migration after live-database encryption, remote identity and recovery tests. Nothing here certifies workspace completeness, changes Notion, or authorizes its retirement.

## G7 — encrypted original-page capsules (synthetic-only, offline)

Source module `src/original-capsules.mjs` supports a **bounded, offline-only** proof of independent retrieval for an individual original Notion Markdown page. It calls the G6 read-only verifier, requires the separately classified inventory to match a single explicitly selected ID and ownership scope, validates source size and SHA-256, requires the exact `# SYNTHETIC FIXTURE` marker, and stores the original body in a fresh owner-only directory as an individually scrypt/AES-256-GCM-encrypted capsule. It does **not** copy original text into the active wiki database or its full-text index. The original ZIP and extracted files are untouched.

The owner-only library function `readSyntheticOriginalCapsule` accepts a specified encrypted capsule, passphrase, explicit expected scope, original Notion ID and expected SHA-256. After authenticated decryption, it verifies all supplied identities, original text length, SHA-256 and synthetic content marker. Local tests demonstrate recovery even after the extracted plaintext fixture is no longer present. The function has **no HTTP/MCP route**. It does not establish that a caller is truly authorized to see data: production needs an independently authenticated, audited access boundary, secure key custody and a verified encrypted storage backend.

The current proof supports at most 20 selected synthetic files per run and 1 MiB original source files (bounded encrypted envelope at 2 MiB). It creates a **new** directory and refuses to overwrite any existing target; source files never change. These caps are engineering safeguards, not evidence of complete workspace coverage or a final archive design. Full ZIP archive encryption from G5 remains necessary; there is no full Notion-file importer or remote lookup. Password-derived encryption is not a replacement for secure identity, host hardening or encrypted volumes.

**Release gate:** original private Notion documents, family/client/clinical content, live SQLite/FTS/WAL and remotely accessible ChatGPT integration remain unauthorized/unsupported. Only synthetic test fixtures may be used in G7. A production reader must enforce actor-specific authorization on every request before exposing decrypted content. The broad full-Notion migration is not complete, and no cutover is allowed.
