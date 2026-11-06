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
