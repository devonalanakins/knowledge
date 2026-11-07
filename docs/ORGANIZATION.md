# Knowledge — Organizational contract and migration review (G10)

**Status: implemented migration-planning library and synthetic tests; not a Notion import or production release.** The Knowledge wiki stays separate from protected originals, business operations and Transcosmic canon authority.

## Source-of-truth rules

This taxonomy follows the existing owner-approved [Workspace Encyclopedia — Editorial Handbook](https://app.notion.com/p/40d88cc2ef14810c84eeddb15b273e44), [Workspace Encyclopedia — Home and Subject Index](https://app.notion.com/p/40d88cc2ef14818fae4df4b642b41947), and [Transcosmic Wiki Linking and Maintenance Standard](https://app.notion.com/p/3b288cc2ef14817db4f7db57d7397976). The original sources remain authoritative within their domains. Do not silently reclassify historical records or fictional canon.

| Portal | Color | Separate primary scope |
| --- | --- | --- |
| Personal and family | Green | Personal/family, private |
| Professional operations | Blue | Cristy's professional work; no client PHI |
| Independent software | Purple | DevonStation, Mizvo and engineering |
| Writing and publishing | Orange | Manuscripts and publication history |
| Anevum original works | Pink | Works as distinct from fictional canon |
| Transcosmic canon | Brown | Canon sources and editorial hierarchy |
| Portfolio and infrastructure | Gray | Infrastructure/project registers |

Colors are navigation only; **they are not access-control policy**. A person must have a real per-workspace grant before seeing records. A cross-portal relation may be valid conceptually but does not imply permission to read the linked content.

## Article anatomy

Stable subject pages answer (1) what the subject is, (2) owning entity/scope, (3) source reference, (4) approved decisions and dates, (5) evidence of implemented/verified/live state without conflation, (6) open questions and next action, (7) related subjects and backlinks, (8) history and supersession. Original source files, chronological logs, proposed work and technical implementation evidence remain separately preserved.

Use a short canonical subject name and retain old names as aliases. Separate encyclopedia entries from event chronology, manuscripts, historical archives, primary documents, decisions, proposals, source evidence and projects. Duplicate titles in **different registers** can be legitimate (a timeline event and its encyclopedia article), but must be cross-linked; duplicate canonical subjects within the same register are sent to review.

The engineering lifecycle vocabulary is distinct from fictional **Canon Status**. A LOCKED design is not an IMPLEMENTED feature, and successful CI does not establish LIVE deployment. Canon remains source-locked / canonical / working canon / unresolved / superseded under the existing canon hierarchy, without automatic promotion based on blank metadata.

## Migration pipeline (no content writes)

1. Create a read-only Notion Markdown/CSV/HTML export and separately enumerate the Notion pages, database rows, access state, and owning scope.
2. Inspect export hashes, original IDs, file hierarchy and unresolvable links using `inspectNotionExport`; reconcile complete source inventory using `reconcileNotionInventory`.
3. Build a separately reviewed **private classification catalog** containing original ID, portal, register type, proposed canonical title, lifecycle state, source URL, aliases, source parent, explicit links and separate canon status where applicable. **Do not copy private page bodies into this catalog.**
4. Call `planOrganizedMigration({preflight,inventory,classifications})` from `src/organization.mjs`. This constructs proposed canonical paths, parent/child edges and reciprocal backlinks but never opens source files or writes to Knowledge.
5. Review every blocking finding: duplicate/ambiguous IDs, unsupported CSV/HTML fidelity, uncategorized records, incorrect access scope, missing or changed source hashes, invalid provenance, unresolved source links, path and alias collisions, parent cycles, cross-workspace links and uncertified export completeness. Review orphan candidates and same-subject/different-register candidates separately.
6. Preserve original encrypted exports, reconcile counts and untouched documents, then independently test content fidelity, permissions, backups/restores, real secured GPT access and reversible cutover. **No live import/cutover may be inferred from a clean planning report.**

**Privacy:** the detailed planning result contains identifiers, article titles, original hashes, paths and source URLs. Store it only in a properly protected owner-only environment; never print or commit it to GitHub, ordinary CI logs, browser consoles or public documentation. The library returns no source bodies, file bytes, clinical material, passwords or access grants.

## Existing technical boundaries

- GPT capture remains draft-only. It cannot override owner-reviewed pages or publish shares.
- A Notion page may refer to a work item whose only current truth is a GitHub commit or Cloudflare provider result; the wiki must link to that evidence, not manufacture a LIVE state.
- A folder's position in a Notion export does not automatically authorize moving its children. Historic ancestry and approved canonical ancestry are separate fields.
- The current planner does not import CSV rows, assets, relationships, revision history, private content or original Markdown. A protected full-fidelity importer and encrypted persistent storage are separate release blockers.
- The Cloudflare Worker prototype is synthetic-only. Passing these tests is not proof of a live ChatGPT account link.

## Next build requirement

Use owner-reviewed classification metadata to build a durable, versioned catalog and index/backlink views while preserving original immutable IDs. Test on synthetic exports first, then on encrypted owner-approved source data without publishing it; only after complete source reconciliation and restore tests should migration be considered.

## G11 — Locally encrypted, non-destructive classification review

The offline command below prepares an **encrypted review report**, not an importer:

```sh
npm run notion:review:encrypted -- /owner-only/preflight.json /owner-only/inventory.json /owner-only/classifications.json /owner-only/review.enc
```

The preflight must use `knowledge-notion-preflight-v1`; the separately collected source inventory must use `knowledge-notion-inventory-v1`; classifications are **explicit owner-reviewed proposals**. Each classification supplies `id` (original Notion ID), `portal`, `recordType`, `title`, `status`, `sourceUrl`, optional `parentId`, `aliases`, `links`, and, for Transcosmic records, `canonStatus`. Source scope and access permissions come from the independent inventory, **never from the classification file**.

All three inputs must be regular owner-only (0600) JSON files at real, non-symlinked paths, each at most 16 MiB. The encrypted output parent must be an owner-only directory (0700), and the output filename must end in `.enc`. Supply a high-entropy `KNOWLEDGE_BACKUP_PASSPHRASE` privately through the environment or a trusted secret manager; do not provide it as a command argument. The tool creates the output by atomic no-overwrite hard link from a temporary 0600 file and never touches the source inputs.

The command prints **aggregate counts only**. Names, original IDs, proposed paths, source URLs, hashes, and detailed diagnostics stay inside the authenticated AES-256-GCM encrypted review envelope. Decrypt with the existing `decryptSnapshot` library in a separately protected review process; do not print decrypted results to a public terminal, CI job, issue or GitHub repository.

**Mandatory gates:** The planner deliberately keeps `cutoverApproved:false`, `imported:false` and `fullSourceCoverageVerified:false`. A clean-looking plan cannot prove full Notion export coverage, actual document fidelity, independent encrypted original archive recovery, live identity grants, real GPT linking, or protected persistent storage. No real Notion data is imported or moved by G11. Keep Notion authoritative until each independent release gate is verified.


### Original hierarchy preservation (G12)

For each original Notion ID, the migration review compares the source export's `parentNotionId` with the proposed classification `parentId`. Missing, newly introduced, or changed parents are **blocking** unless the classification explicitly supplies `parentChangeApproved: true` and a substantive `parentChangeReason` (12–500 characters). An invalid source parent ID is also blocking. This applies even when the old page was a root page and the proposed canonical hierarchy would be more aesthetically organized. A classification's approval field is a review assertion, **not** an authenticated approval event; future private importer must independently verify reviewer identity, scope, audit evidence and retained original lineage. Cross-workspace parent links remain forbidden regardless of claimed approval. No source hierarchy is modified by this planner.

## G13 — Cryptographically verified hierarchy-review receipts (offline)

The old `parentChangeApproved: true` flag was **not authentication** and no longer authorizes a parent change. The metadata-only planner now requires an Ed25519 signature covering one exact proposed change. Invalid, absent, expired, forged, revoked, consumed or out-of-scope receipts remain **blocking findings**. The review still never imports content or modifies Notion.

Each `hierarchyApproval` in a proposed classification must carry a `knowledge-hierarchy-approval-v1` receipt created by a trusted owner-controlled offline signing process. The signed payload includes a unique 32-hex `approvalId`, `signerId`, UTC issue/expiry (maximum 30 days apart), original source ID, independently enumerated workspace scope, original Markdown SHA-256, existing parent ID, proposed parent ID, canonical destination wiki path, and the substantive `parentChangeReason`. Changing any of these invalidates the signature. The signer must use Ed25519; private signing keys are not part of this repository, CLI or PR. Signatures apply only to the reviewed move, never to the source material's truth or an eventual database cutover.

To independently verify a signed parent change in the encrypted organization review, provide a **fifth optional** positional argument: an owner-only trusted-reviewer/ledger file. It is read under the same private-file validation as other inputs:

```sh
npm run notion:review:encrypted -- /owner-only/preflight.json /owner-only/inventory.json /owner-only/classifications.json /owner-only/review.enc /owner-only/trusted-reviewers.json
```

The reviewer file must have format `knowledge-hierarchy-trust-v1`, a `reviewers` object keyed by trusted signer IDs with `enabled:true`, allowed `scopes` and `publicKeyPem` fields, plus `consumedIds` and `revokedIds` arrays of 32-hex receipt IDs (empty arrays if none). Example **shape only**, not a usable credential: `{"format":"knowledge-hierarchy-trust-v1","reviewers":{},"consumedIds":[],"revokedIds":[]}`. Without that separate trust file, a proposed parent change cannot pass signature review. That file is trust configuration, so it must come from independently authenticated owner control; never treat public keys embedded in Notion pages, classification input, GPT output or source exports as authorities.

Verification checks the source's independently enumerated scope and hash, exact original and proposed parent IDs, destination path, reason, signing key type, allowed scope, current time, and trusted revocation/consumption lists. The planner never serializes approval signatures or private signing keys into the preview. The CLI still writes only an authenticated encrypted report and prints aggregate counts.

**Important security limit:** The current `consumedIds`/`revokedIds` arrays are read from a protected local file. They do **not** constitute a durable, transactional, multi-operator approval ledger. A future importer must authenticate the reviewer at signing time, atomically consume each approval at commit time, check scope/revocation again, and preserve signed receipts in a private append-only audit archive. No user enrollment, private signing-key management, write authorization, full-fidelity importer or production cutover is implemented. Notion remains authoritative.

## G14 — Durable approval-event ledger (synthetic-only)

`src/approval-ledger.mjs` adds an **offline, local, synthetic-only** SQLite audit ledger. It writes one event per 128-bit approval ID, recording SHA-256 digests of the ID and receipt, action (`consumed` or `revoked`), timestamp and a chained event hash. The original approval IDs, source bodies, signer private keys and full signed receipts are **not stored** in the ledger. This is not a licensed production approval service or a data importer.

The ledger uses `BEGIN IMMEDIATE` transactions, SQLite uniqueness constraints, a fully synchronous journal, and triggers preventing ordinary event UPDATE/DELETE. Consumption re-verifies the G13 Ed25519 receipt and its independently configured reviewer authority, then atomically rejects duplicate/revoked IDs. Revocation and consumption are mutually exclusive. Reopening preserves all events. It requires an owner-only directory (0700) and private SQLite file (0600), rejects symlinks, and refuses all write-mode construction without `syntheticOnly: true`. This library is not exposed through HTTP or MCP.

**Tamper-evidence limitation:** A hash chain only detects a valid-looking truncated/rebuilt ledger when its latest head digest is stored and protected independently. The ledger's `audit({expectedHead})` supports that comparison; an omitted anchor is **not** proof of completeness. A privileged disk attacker can replace a database, including its triggers; this prototype does not provide an external trusted timestamp or remote replication.

The existing G11/G13 encrypted review CLI accepts an **optional sixth argument**, after the trusted public-key file, with a preexisting protected ledger path:

```sh
npm run notion:review:encrypted -- /owner-only/preflight.json /owner-only/inventory.json /owner-only/classifications.json /owner-only/review.enc /owner-only/trusted-reviewers.json /owner-only/approvals.sqlite
```

With a ledger file, the trusted reviewer JSON must also include a separately held `ledgerHeadHash` matching the independently recorded 64-hex head hash. The reader opens SQLite **read-only**, verifies the complete event chain against the anchored head and denies any signed review receipt whose ID is already consumed or revoked. Missing/mismatched anchors block review; the CLI does not update the ledger. Normal metadata-only review without the optional ledger still works without opening SQLite.

The existing G13 static `consumedIds` and `revokedIds` lists remain additional fail-closed checks, but their presence does not substitute for a real atomic ledger. **Review-time rejection is not import-time atomic consent**: before production migration, implement an independently authenticated operator, protected signing key custody and rotation, persistent off-host head anchors and audit backups, atomic approval consumption in the same transaction as the intended import, and a verified undo process. The current `consume` method is an offline synthetic proof only. No real Notion data was imported, published or deleted.

## G15 — Reversible fictional-only organized import rehearsal

`src/organized-stage.mjs` provides a **programmatic staging importer for small, synthetic Notion Markdown fixtures only**. It demonstrates how to carry the previously approved seven-portal taxonomy, canonical paths, historical parent references, proposed parent references, source references, status distinctions, aliases and reciprocal semantic wiki links into a disposable new Knowledge database. It never authorizes access to private Notion data, and it never writes back to the Notion export.

**Input boundaries:** The caller supplies an independently collected `knowledge-notion-preflight-v1` export inspection, a `knowledge-notion-inventory-v1` list, and an explicitly reviewed classification catalog. The organizational review must have **zero blocking findings** and asserted complete coverage/enumeration. The importer verifies every selected source file's exact SHA-256, byte size, UTF-8 validity, original ID, ownership, and path through the pre-existing protected file reader. It stages only one workspace of 1–20 Markdown pages, each no larger than the standard 16 KiB capture limit and beginning with the exact test marker `# SYNTHETIC FIXTURE\n`. **The marker alone is not a privacy guarantee**; an operator must never prepend it to real records and feed them to the rehearsal.

**Destination boundaries:** The output database must be absent in advance and located outside the source directory under an owner-only, non-symlinked directory. Staging creates a temporary 0700 workspace, writes SQLite using existing Knowledge limits, and verifies a snapshot/restore round trip before closing the database. It re-reads source originals immediately before publishing the fresh database with an atomic no-clobber hard link. Any failure before publication removes the temporary database and leaves the originals untouched; a published synthetic stage can be discarded independently. This is **not** a production database transaction or a substitute for private data encryption.

**Data and relationships:** Each staged Markdown body is copied **byte-for-byte into a draft Knowledge article**, rather than rewritten into AI prose. A dedicated `synthetic_sources` table stores the original Notion ID, scope, hash, size, archive member path, old and proposed parents, portal/color, editorial record type, independently classified lifecycle/canon state and aliases. A `synthetic_edges` table stores reviewed parent containment and other source relationships. Existing Knowledge links are created for supported semantic kinds (related, supports, supersedes, depends), enabling the private wiki's reciprocal backlinks. Containment and citation relations remain in the explicit source-edge register instead of being misrepresented as semantic links in the current Knowledge core. The only source text allowed is fictional fixture data; nothing is shared publicly or promoted to an approved decision.

**Recovery:** `exportSyntheticOrganizedArchive` combines a Knowledge workspace snapshot with the source metadata and relationship register, checks completeness and internal hashes, and returns a checksummed recovery envelope. `restoreSyntheticOrganizedArchive` requires an empty synthetic-only store and prevalidates the entire archive in an isolated in-memory database before touching its destination. A changed checksum, forged-but-rehashed source record, missing source page, or inconsistent backlink graph is rejected. The envelope contains *plaintext fictional content*; it is not the encrypted original archive system. Unexpected disk write failures in a chosen destination can still leave partial local output: always use a disposable new target, not an existing workspace or production database.

**Still NOT implemented:** A real owner-approved Notion export, full record inventory, protected storage-at-rest for actual records, human/clinical permission checks, full-fidelity Notion database/CSV/property/comment/attachment/revision import, public/private share permission migration, authenticated import-time approval consumption and independent encrypted recovery/cutover validation. Never mark this test as `LIVE` or retire Notion on the strength of G15. It is an isolated proof of the **organization and data-preservation workflow**, not a real-data migration.

## G16 — Encrypted fictional-stage handoff

**Implementation status:** source-only, synthetic-data rehearsal. \`buildSyntheticOrganizedArchiveInMemory\` uses an in-memory Knowledge SQLite store, builds the G15 organizational source and relationship registers, validates exact fictional Markdown checksums and original/proposed ancestry, and verifies a second in-memory restore. The returned JS archive is *plaintext in process memory only* and must never be serialized to a log or an unencrypted file. This is not a security-approved method for real clinical, family or business information.

\`writeEncryptedSyntheticStage\` passes this archive to the existing scrypt/AES-256-GCM \`encryptSnapshot\` utility, verifies decryption plus full in-memory reconstruction, then creates **only a ciphertext envelope** in an owner-only temporary directory (0700). It validates that file once more, then publishes by no-clobber hard link to a fresh \`.enc\` pathname under an owner-only real directory. The original exported fixtures are never modified; no on-disk unencrypted SQLite file is created during this path. Errors before publication delete the temporary encrypted file; existing destinations, symlinks, permissive owner directories, source-root output and mismatching checksums are rejected.

\`inspectEncryptedSyntheticStage\` opens an existing private ciphertext file read-only with \`O_NOFOLLOW\`, checks its owner permissions, size, unchanged file identity and UTF-8 JSON encoding, and performs authentication, full structural verification, source/hash checks already sealed at staging time, and a complete recovery in memory. It exposes aggregate counts and checksums, not page contents. Wrong passwords, modified ciphertext and non-synthetic documents fail closed. The password is never embedded in a repo file or printed by this tool.

**Operational limits:** No Notion export, private data, or production knowledge database was encrypted or migrated. Only operator-verified fictional material may use this rehearsal; the \`# SYNTHETIC FIXTURE\` prefix does not prove that content is safe. The contents remain temporarily present in process memory; JavaScript cannot guarantee physical zeroization or freedom from OS swap/core dumps. A separate protected original export still needs independent encryption and recovery. The existing **G15 plaintext local staging function** remains for synthetic tests only and must not be used for real records. This does not supply runtime encryption for live Knowledge databases, authentic identity and write authorization, full-fidelity Notion import, atomic approval-consumption during real migration, or a production cutover.

**Acceptance criteria:** round-trip original source bytes, canonical paths, aliases and parent references, recorded links and wiki backlinks; two Node LTS test versions; zero leaked fixture content in ciphertext; rejection of wrong passphrase/tampering/unsafe permissions/overwrites; pre-publication rollback; no plaintext disk artifacts. Independent follow-up work is necessary before even a limited real-data pilot.

## G17 — Protected source eligibility and independent metadata review

**Status:** metadata-only assessment, not real-data permission or import authorization.

The \`assessNotionSourceEligibility\` module checks a separately inspected Notion export (\`knowledge-notion-preflight-v1\`) against a separately enumerated Notion identity/access inventory (\`knowledge-notion-inventory-v1\`), owner-reviewed encyclopedia classifications, a private handling register, and an explicit **assessment-only** scope policy. It reuses the existing ID coverage reconciler and G10 hierarchy/backlink review. It never reads Markdown bodies, attachments, comments, patient information or secrets, and has no API to write, migrate, publish, share or delete content.

The private handling register is a JSON object with \`format: "knowledge-notion-handling-v1"\` and \`records\` entries containing original \`id\`, \`scope\`, \`sensitivity\` (\`ordinary\`, \`personal\`, \`professional\`, \`clinical\`, \`secrets\`, \`unknown\`), \`ownership\` (\`owner-controlled\`, \`third-party\`, \`unknown\`) and \`disposition\` (\`consider\`, \`archive-only\`, \`exclude\`). It does **not** contain source bodies, private passwords or client notes. Policy has \`format: "knowledge-notion-eligibility-policy-v1"\`, \`mode: "ASSESS_ONLY"\`, and an explicit nonempty \`scopes\` array from the existing workspace scope vocabulary.

Records with clinical material, credentials, third-party ownership, or an explicit archival/exclusion disposition are marked \`EXCLUDE_OR_ARCHIVE\`. Unknown sensitivity, unknown ownership, inaccessible or missing sources, unclear scope, mismatched handling scope, non-Markdown rows, private/personal/professional content, unresolved links, and other ownership or organizational conflicts require review. The private report flags duplicate original IDs, unregistered handling rows, incomplete source enumeration, missing CSV row identity coverage and unsupported asset/HTML/CSV fidelity. **The tool never treats an asserted "reviewed" or "approved" field as authenticated consent.** A record with no known blockers may be labeled \`ASSESSMENT_CANDIDATE\`, which means only that its *metadata warrants further review*. It does not establish independent content classification, full source coverage, authorization to import, or release readiness.

To generate an encrypted report using only protected local JSON manifests:

\`\`\`sh
KNOWLEDGE_BACKUP_PASSPHRASE='owner-provided-outside-source-control' \
npm run notion:eligibility -- /owner-only/preflight.json /owner-only/inventory.json /owner-only/classifications.json /owner-only/handling.json /owner-only/policy.json /owner-only/eligibility.enc
\`\`\`

For actual use, provide the passphrase through an approved secret mechanism rather than pasting it into terminal history. All five input files must be regular owner-only files (0600); the output directory must be owner-only (0700) and real, not symlinked. The report is encrypted with the existing scrypt/AES-256-GCM snapshot helper and published as a new no-clobber \`.enc\` file. The command prints aggregate counts only. Full details—including original Notion IDs, proposed paths, selected scopes, and sensitivity findings—remain inside the encrypted report and must never be posted to GitHub, public CI logs or a general-purpose chat. If the CLI fails, it must not publish a partial output.

**Limits:** Report fields \`sourceCoverageIndependentlyCertified\`, \`sensitivityClassificationIndependentlyCertified\`, \`accessAndConsentVerified\`, \`realDataImportAuthorized\`, \`importExecuted\`, and \`cutoverApproved\` are always \`false\`. These fields are deliberately not controlled by the caller. A manually assembled or stale manifest, or a self-described "ordinary" classification, cannot prove that clinical or third-party information is absent. The current CLI is private local tooling, not hosted or connected to the user's Notion account. No real page was imported or authorized. Any later *bounded* real-data pilot requires separate verified account enumeration, per-scope access grants and clinical exclusions, encrypted protected storage, historical asset/row fidelity checks, backup/restore tests, authenticated owner consent and reversible cutover procedures.

## G18 — Read-only Notion API source inventory and encrypted handoff

The \`src/notion-api-source.mjs\` module performs real Notion API **source metadata enumeration**, not content export. It uses a dedicated Notion integration token supplied only at runtime, the pinned API version \`2025-09-03\`, and \`POST /v1/data_sources/{data_source_id}/query\` with complete cursor pagination. This endpoint uses data-source IDs, not database IDs. A strict request whitelist prohibits Notion creation, update, deletion and page-append endpoints, even though the read-only query uses POST. The token must never appear in any source, config JSON, test fixture made from real credentials, GitHub commit or diagnostic output.

The owner supplies a **private 0600** config with this shape, where IDs below are intentionally fictional:

\`\`\`json
{
  "format": "knowledge-notion-api-source-config-v1",
  "registers": [
    {
      "dataSourceId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "scope": "anevum",
      "register": "canon-encyclopedia",
      "expectedCount": 408
    }
  ]
}
\`\`\`

The config accepts a bounded, explicitly enumerated 1–24 source registers, one per data source. At this stage permitted scopes are \`anevum\`, \`devonstation\`, and \`mizvo\` only. **Do not enroll clinical/healthcare, Cristy business, family, third-party or credential-bearing sources.** A caller must review the actual source data and integration-access scope outside this code before using a source ID.

The owner-only command \`npm run notion:api:inventory -- /owner-only/sources.json /owner-only/notion-metadata.enc\` requires \`NOTION_API_TOKEN\` and \`KNOWLEDGE_BACKUP_PASSPHRASE\` from a protected external secret mechanism. It captures the original page ID, source register, parent, last edit time, URL, complete Notion property JSON, relation-pagination warning and file-reference count, without requesting page bodies, comments or asset bytes. It authenticates and encrypts the structured report with the existing AES-256-GCM/scrypt helper, verifies decryption and checksum, and publishes only a fresh 0600 ciphertext envelope by atomic no-clobber link in a private 0700 directory. It prints aggregate register counts, no titles, raw source IDs, Notion properties, contents or access tokens. Even Notion properties can contain sensitive plain text: never publish the decrypted inventory to a public GitHub repo, chat transcript or normal CI artifact.

The source request client rejects non-allowlisted read paths and all write methods, limits response size and inventories to hard bounds, handles 429 rate limits with capped retries, refuses duplicate page IDs across source registers, and detects nonadvancing cursors/count drift/incomplete API page metadata. Entries with paginated relation properties or embedded file references are flagged for later retrieval and archival.

**What this does NOT establish:** It neither enumerates every page in every workspace root, nor archived/deleted records, comments, image files, full block trees, page-level ACLs, database views, or all revision history. A complete cursor traversal is not proof that the token can see every source record. The output explicitly keeps \`sourceCoverageCertified\`, \`sourcePermissionsCertified\`, \`sensitiveDataScreened\`, \`realDataImported\`, and \`cutoverApproved\` false. Actual Notion connector credentials are not available to the repository runtime by implication; a separate scoped token and operator-owned storage remain prerequisites. Migration, merge to production, and retirement of Notion are still **NO-GO** until full protected body/attachment fidelity, source count reconciliation, identity, clinical exclusion, recovery and cutover verification have passed.

## G19 — Bounded read-only Notion page-body and nested-block archival (encrypted)

**Scope / authority:** G19 is an *owner-selected, read-only source capture*, never an import, permission grant, canonical promotion, GPT publication, clinical-data migration, or workspace-wide export. Only known \`anevum\` records already present in a protected G18 source inventory are eligible. The current limits are **one explicit selection of 1–8 pages**, up to 4,000 blocks/page, 200 child-list requests/page, 12 nested block levels, and 20 MiB of source structure per batch. **Never capture real clinical, client/patient, third-party, secrets, Cristy business, or family content using this path.** A source being classified as \`anevum\` alone is not proof of safe rights or sensitivity: the operator is responsible for choosing a reviewed, authorized, nonclinical sample.

### Inputs and permission boundary

The private source inventory is the AES-256-GCM \`notion:api:inventory\` output from G18. A distinct protected 0600 JSON selection (example IDs are fictional) selects exact source IDs, not vague title searches:

\`\`\`json
{
  "format": "knowledge-notion-content-selection-v1",
  "mode": "OWNER_SELECTED_READ_ONLY",
  "scope": "anevum",
  "sourceIds": ["11111111-1111-1111-1111-111111111111"]
}
\`\`\`

With a separately issued **read-only scoped Notion API token** and independently stored passphrase, use:

\`\`\`sh
npm run notion:api:content -- /owner-only/notion-metadata.enc /owner-only/selection.json /owner-only/content-batch.enc
\`\`\`

Supply \`NOTION_API_TOKEN\` and \`KNOWLEDGE_BACKUP_PASSPHRASE\` through an owner-controlled secret manager or protected environment. Never place credentials in the JSON, terminal command line, repository or CI. The G18 API client has a hard allowlist that permits \`GET\` for a page and its block children, while forbidding Notion create, update and delete methods. The connector visible in the ChatGPT conversation does not automatically provide a token to the Node process.

### What the source archive contains

\`src/notion-content-export.mjs\` reads the explicit Notion page and compares its original ID, source URL, last-edit marker, parent and all page properties (after removing ephemeral signed file URLs) with the selected G18 metadata. It traverses the entire accessible nested block hierarchy using paginated child-list GETs, with bounds, duplicate-ID/cycle checks and cursor-loop detection. Native block payloads and rich text, stable Notion page/block IDs, block type, nesting, ordinal position, native source properties, and referenced page IDs are preserved as structured JSON. The page is re-read after collection, then again before encrypted publication to detect intervening edits. A SHA-256 digest covers each page and a separate digest covers the archive; neither is a cryptographic author signature.

Media **file bytes are NOT included**. Notion temporary signed download URLs are explicitly omitted from the stored metadata; image/video/audio/PDF/file references are flagged as incomplete. \`child_page\`, \`child_database\` and remote synced blocks are recorded but **not** followed to unrelated sources. Linked pages referenced outside the selection are not silently added. Historical revisions, deleted/archived blocks, comments, data source definitions, file permissions, media rights and external service assets remain uncollected.

\`src/notion-content-cli.mjs\` encrypts the in-memory archive using existing scrypt/AES-256-GCM, verifies decryption and source digests, and publishes only a new 0600 \`.enc\` ciphertext under a 0700 real owner-only directory, using atomic no-clobber publication. On failure, temporary encrypted output is removed, original Notion pages are untouched and no plaintext SQLite database is created. The command returns only aggregate page/block counts and checksum evidence. The decrypted archive contains **real original page content**, so keep it on an approved private machine, never in this public GitHub repository, a generic chat transcript, ordinary Notion checkpoint, or unrestricted CI artifact. Once a passphrase holder can modify the data, hashes alone are not independent authenticity proof; independent signing and source verification remain a separate gate.

### Verification and release exclusions

Tests exercise multipage block pagination, nested tree order, native rich text, link references, source drift, incomplete media/remote child references, duplicate blocks and cursors, private input permissions, wrong passwords, authenticated encryption, no-clobber recovery, and failures leaving no output. Passing these tests does **not** mean that every Notion block type, access-control list, file or revision is migrated. **No production Knowledge import has been implemented by G19.** \`realDataImported\`, \`sourceCoverageCertified\`, \`externalPermissionsCertified\`, and \`cutoverApproved\` remain false. Notion is authoritative until independently reconciled full-workspace export, exact content-and-asset restore, access segregation, GPT writeback verification and owner-approved migration gates are passed.

## G20A — Read-only, fail-closed recovery of paginated Notion relation properties

**Status:** Implemented in the existing draft PR; synthetic source and CI verification must be checked at the exact commit. Not a complete export, production import, permission grant, or cutover.

**Problem:** G18 warns when Notion truncates a page relation property (`has_more=true`). G19 deliberately refused to capture such pages rather than archive an incomplete relationship graph. G20A resolves these relations only for the same explicitly owner-selected nonclinical Anevum page batch, while keeping the original G19 page-property snapshot and its native partial relation data unchanged.

**Owner control:** Add `"resolvePaginatedRelations": true` to the existing protected G19 `knowledge-notion-content-selection-v1` JSON. Without this opt-in, the previous `UNRESOLVED_RELATIONS` denial is retained. The separately scoped Notion API token and private encrypted G18 inventory remain mandatory. An opt-in does not authorize dereferencing linked pages, importing related documents or using clinical, third-party, family, Cristy business or secret-bearing material.

**Implementation:** `src/notion-relation-recovery.mjs` verifies that the live number of truncated relation properties matches G18's source inventory count. Each property must supply a unique valid Notion property ID and a valid initial relation-ID prefix. A strictly allowlisted read-only `GET /v1/pages/{id}/properties/{encodedPropertyId}?page_size=100` retrieves successive `property_item.relation.id` entries. The collector rejects malformed IDs, malformed responses, invalid or cycling cursors, duplicated related page IDs, changed prefixes and source-inventory drift. Caps are **12 paginated properties, 30 additional API list requests, 1,500 total relation items and 2 MB serialized native relation-item responses per source page**, within G19's existing archive limits. No Notion PATCH/DELETE/create endpoints are enabled.

For each recovered property, the in-memory archive stores the original property name and ID, original prefix length, the complete ordered list of related page IDs, a completion marker and SHA-256 fingerprint. These IDs join the page's ordinary source references; they do **not** permit cross-workspace reads or an automatic destination-link promotion. G19's existing AES-256-GCM encrypted-only publication, checksum verification, private 0600 destination and no-clobber semantics apply. A **second full property pagination read immediately before ciphertext publication** must match the first exact ordered relation snapshot, even if the Notion page's last-edit marker did not change. Any difference aborts without publishing a destination archive.

**Verification:** Dedicated synthetic tests cover full two-page pagination, source-prefix preservation, reference completeness, unchanged legacy G19 behavior, explicit opt-in, changed G18 inventory, repeated cursors and IDs, malformed properties, pagination quotas, read-only route rejection, encrypted recovery and post-seal source drift. These are NOT real Notion API or production authorization tests.

**Remaining NO-GO:** External media bytes, complete paginated other property types, remote synced-block bodies, child page/database traversal, full Notion revision/permissions history, entire-workspace coverage, independently signed source manifest, production encrypted store, real ChatGPT OAuth writeback, verified private restore and final cutover remain unimplemented. The G19 selected-page batch is a **partial-fidelity source capture**, not a fully backed-up or migrated wiki. Notion remains authoritative.

**Next bounded job:** owner-controlled, private attachment-byte archiving and independent verified recovery of a nonclinical test selection, using explicit download-URL origin/redirect constraints, size and count budgets, and a manifest matching original file references without persisting expiring URLs.

## G20B — Owner-selected, small Notion-hosted attachment-byte capture (encrypted)

**Scope:** This is a strict *optional private capture of file bytes* for the same explicitly selected, inventoried nonclinical Anevum page batch as G19/G20A. It is **not** a complete Notion export, a private production import, an access-control bypass or authorization to process Cristy business, family, patient, client, credential, third-party or otherwise restricted content. G19's existing default remains **no downloads**. No current production database can be deemed safely encrypted on this basis.

### Explicit owner-only opt-in and host approval

The 0600 private `knowledge-notion-content-selection-v1` file may include:

```json
{
  "format": "knowledge-notion-content-selection-v1",
  "mode": "OWNER_SELECTED_READ_ONLY",
  "scope": "anevum",
  "sourceIds": ["11111111-1111-1111-1111-111111111111"],
  "resolvePaginatedRelations": true,
  "captureNotionFiles": true,
  "approvedNotionFileHosts": ["file.notion.so"]
}
```

The approved host **must match the actual host of the selected short-lived signed Notion file URL**. The current hardcoded, explicitly operator-selectable host set is `file.notion.so`, `prod-files-secure.s3.us-west-2.amazonaws.com`, `s3.us-west-2.amazonaws.com`, and `s3.us-east-1.amazonaws.com`. No arbitrary hostname, IP address, localhost, HTTP URL, userinfo, explicit port, fragment, redirects, cookies or Notion API bearer token is accepted in the asset fetch path. This allowlist is intentionally restrictive and may refuse newer/other legitimate Notion file hosts; do **not** weaken it without independent provider/source verification. In a real operator environment, an additional **restricted outbound egress and trusted DNS policy** is required to defend against resolution and network-path attacks. Merely validating an HTTPS URL hostname in Node is **not** a complete SSRF or data-exfiltration defense.

### Collection, integrity and release limits

`src/notion-attachment-capture.mjs` inspects only the already selected live page properties, icon/cover and previously traversed blocks, without following related pages or synced blocks. The resolver marks external links and unresolved upload references as not captured. For supported Notion-hosted files it requires a non-expired signed URL, validates the exact approved origin and fetches via stream with redirect mode `error`, 15-second request abort, and no credentials. **Hard budgets: 8 files, 1,000,000 bytes per file, 3,000,000 bytes total across the batch**. Missing/invalid download evidence, unexpected response status/length, any oversized asset or an expired source aborts without encrypted output. The source payloads and binary file bytes are held in process memory only until the existing G19 AES-256-GCM/scrypt private archive is verified and atomically published (0600 inside a 0700 owner-only directory, no replacement). Do not persist decrypted content, print signed URLs, log raw file names or upload these archives to GitHub or normal CI artifacts.

A protected archive now carries the exact file **source page ID, source block ID (if applicable), source JSON path, byte length, MIME type, SHA-256 and Base64-encoded bytes**; ephemeral URL and authorization parameters are never stored. It retains original redacted page/block representations, wiki references and original change markers. `verifyEncryptedNotionContent` validates the authenticated encrypted snapshot, original page hashes, each attachment's binary hash and length, total attachment counts/size and source-page/block membership. Synthetic tests cover a complete encrypt/recover/checksum round trip, absent permission, hostile URL, expired URL, redirects, malformed/overlarge streams, unsupported external references, missing content-length, tampered asset digest, duplicate provenance and failure cleanup.

**Limits and NO-GO:** There is no independent published source-byte digest from Notion at capture time, and local hashes alone do not prove file authenticity against a passphrase-holder or source compromise. The file-size quotas necessarily exclude many real attachments. Notion-hosted URLs vary; the hardcoded allowlist needs live verification. There is no full archive of external files, attached links, historical revisions, synced blocks, child page databases, source ACLs, per-file permissions or all workspace roots; aggregate `attachmentCoverageCertified` is permanently false. This does **not** implement encrypted active SQLite/FTS/WAL, real GPT OAuth, production authorization, source completeness certification or Notion cutover. No actual private Notion files were retrieved through GitHub CI. A scoped Notion token, protected runtime/storage, owner-selected authorized content, externally enforced egress policy, source reconciliation and independent restoration remain required before any real-data rehearsal.

**Next safe increment:** verify source/attachment manifest fidelity in an independently protected private environment and reconcile source permissions/coverage; do not auto-promote incomplete archives or merge/retire Notion on synthetic tests.

## G20C — Offline encrypted source-reference reconciliation (synthetic tested)

**Scope:** G20C adds an *offline in-memory integrity audit* of the selected encrypted G19–G20B source snapshot. It does not fetch Notion again, publish page data, grant access, imply that the Notion source is authoritative or change the live Knowledge store. The encrypted archive verifier must successfully decrypt and validate the authenticated archive before G20C runs. This is a **closed-world internal cross-check**, not full Notion import fidelity or original-data provenance certification.

**Exact-path reconciliation:** The reader walks only the retained, redacted Notion page properties/icon/cover and traversed block payloads. It classifies Notion-hosted type:file references (which **must** contain only the notionSignedDownloadUrlOmitted:true marker), external links, and unresolved file-upload references. It constructs a bounded set of exact source identities using the original page ID, optional block ID and canonical JSON-pointer-like source path. Every archived attachment must match exactly one original redacted Notion-hosted file reference. It rejects duplicate pages/blocks, unredacted signed URLs, forged paths, orphaned bytes, extra/duplicate attachments and excessively large source reference graphs. It is still possible for a passphrase holder to alter **both** the stored source and file payload, rehash and re-encrypt: this utility detects **internal contradictions**, not source authenticity against that attacker. Independent original-source receipts or signatures remain required for a real migration.

**Private aggregate-only report:** The encrypted archive verifier now reports notionFileReferences, capturedAttachmentFiles, missingNotionFileBytes, unsupportedExternalFiles, pendingUploadFiles and selectedSourceFileReferencesAccounted. None contain original source IDs, page titles, file URLs or content. The last boolean means only that the **selected saved source references** match attached file bytes; it is not sourceCoverageCertified, attachmentCoverageCertified, sourcePermissionsCertified, originalFileAuthenticityCertified, realDataImported or cutoverApproved. Archives with missing bytes remain inspectable, with those gaps explicitly reported; they are **never** silently promoted as complete. Unsupported references must be reviewed and cannot count as a fully preserved source.

**Validation:** Synthetic tests include exact page/block/path matching, file-in-property paths with escaped keys, missing bytes, external/unsupported references, forged page or block IDs, duplicate blocks, unredacted temporary URLs, oversized graphs and an attacker who recomputes the outer SHA-256 digest on a forged attachment manifest. The G19–G20B private ciphertext writer and recovery path continue to reject invalid archives before publication. No Notion API token is needed to inspect an existing encrypted archive, but the operator-held password and protected source file remain necessary; do not print unredacted archive contents.

**Release limits:** This check only proves consistent selected source evidence inside the encrypted archive. It cannot detect Notion pages hidden by permissions, archived/deleted content, missing child pages/databases, untraversed synced blocks, unavailable large or external files, lost version history or source changes after capture. Actual source-API identity and permission inventory, trusted storage with restricted egress and independent restoration are still separate gates. **Notion remains authoritative.** No public GitHub artifacts, clinical/client content, private family records, production merge, Cloudflare release or Notion cutover may be inferred from green synthetic CI.

## G21 — Private offline capture preflight and evidence boundaries

**Status:** G21 code is staged in the existing draft Knowledge PR. Its test status is defined by exact-head GitHub Actions, not by this document. This milestone is a LOCAL prerequisite check, not live source authorization.

Before any bounded Notion real-data capture, the operator can invoke:

    npm run notion:api:preflight-content -- /private/source-inventory.enc /private/owner-selection.json /private/new-content.enc

The command reads the previously AES-256-GCM-encrypted G18 metadata inventory and strict 0600 owner selection; it verifies the selected source identities, allowed Anevum-only scope, archival status, existing paginated-relation opt-in, selected media host allowlist, private existing inputs and a new owner-only, no-clobber output destination. Only the existence/shape of a separately configured runtime Notion token is checked; credentials and passphrases are not printed. All logic is offline. The response is an aggregate-only JSON report with selected page/register counts and prerequisite booleans; no original page IDs, titles, URLs or record text are emitted, and no output file is created.

**Critical distinction:** A successful localPreflightPassed flag does NOT establish that an API token is genuine, has sufficient least-privilege access, or only sees legally authorized sources. It does not independently test DNS, outbound egress, Notion file-host compatibility, network routing, source permission graphs, real source completeness, clinically sensitive data screening, or an independently restored encrypted snapshot. restrictedEgressVerified, independentNotionSourceVerified, sourcePermissionCertified, independentRestoreVerified, privateRehearsalAuthorized, liveCapturePerformed, dataImported, productionReady and cutoverApproved remain explicitly false. Further steps need separate private data-owner review and controlled execution.

**No additional secrets:** The owner creates and stores scoped credentials outside GitHub, ChatGPT/Notion pages, CI and plaintext logs. Do not copy sensitive inventory or decrypted pages to code review. Keep Notion authoritative and avoid irreversible changes. Missing encrypted inputs or private runtime controls are environmental blockers, not authorization to weaken checks.
