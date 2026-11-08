# Knowledge → Notion retirement acceptance checkpoint

# November 8, 2026 — superseding operational checkpoint (owner-only forward records)

**LIVE / VERIFIED for authorized nonclinical personal drafts:** Cloudflare worker `knowledge-forward-private` now has `KNOWLEDGE_PRIVATE_WRITE_ACK=DRAFT_CAPTURE_ALLOWED`, and no `KNOWLEDGE_ACCEPTANCE_ONLY_ACK`. The same owner-only Cloudflare Access policy, owner-held encryption key, database, resource and personal scope remain. The authenticated ChatGPT Knowledge connector created, searched, read and updated a new non-sensitive draft through the live owner path; revision 2 read back exactly and a stale expectedVersion was rejected with `VERSION_CONFLICT`. The full historical Notion replacement and other workspace scopes remain **NO-GO**.

**Independent post-write snapshot:** a new private manual R2 ciphertext-only backup was written and read back with matching SHA-256 `e00addbe00915241ebcdf598e56b245a7be7fbc848c9e3732bd009ca3d48bec4` (4,419 bytes; 1 instance marker, 2 encrypted pages, 4 revisions). This is a same-provider copy, not new evidence of off-provider disaster recovery. The separate daily cron `0 8 * * *` stays configured, but its first completed automatic R2 object was not yet observed at this checkpoint.

**Owner browser enabled:** read-only `/wiki`, `/wiki-find`, `/wiki/page`, history and revision routes are opted in through `KNOWLEDGE_BROWSER_ACK=OWNER_ONLY_BROWSER_READ_V1`, with deployed Worker version `a17146f8-edcf-42ce-a3a8-fea901d445f5` at 100%. The actual owner-authenticated desktop and iPhone viewing journey still needs acceptance. This viewer does not provide editing, clinical permissions or historical migration.

**Notion source coverage:** eleven preserved ZIP exports contain 3,312 distinct source identifiers, with 874 supplemental Markdown IDs missing from the original staged source and 425 differing-hash Markdown identities. The connected Notion account lists 11 private and 1 shared top-level roots; **all 12 root IDs occur in those archives**. The prior isolated stage contains 2,646 records across seven scopes and 49 original attachments. Root presence does not establish descendant, version, permission or attachment completeness; preserve all sources and versions, quarantine unclear scopes and do not import them into the single personal-scope forward database.

The November 7 observations below are preserved as **historical evidence**, not the live write configuration. The verified private Knowledge checkpoint is `projects/devonstation-knowledge` version 2; engineering observations are also recorded on [PR #1](https://github.com/devonalanakins/knowledge/pull/1). The repository `main` at this checkpoint is `5c5f63eb5bdd7f7e994ee90fa8add3394f2b22ad`.

**Retirement remains blocked:** full scope ACLs and distinct keys, reviewed source conflicts and lineage, encrypted historical and attachment import, independent latest-generation recovery, current Notion descendants and permissions, actual owner desktop/iPhone acceptance, and specific final disconnect authorization. Notion stays READ-ONLY; never delete source records.

---

**As observed:** November 7, 2026. **Decision:** NOTION RETIREMENT NO-GO; forward MCP fictional-write tests LIVE and verified. This document is an engineering handoff, not permission to migrate sensitive records or disconnect Notion.

## What was independently verified
- Active service: Cloudflare Worker `knowledge-forward-private` with owner-only Cloudflare Access and ChatGPT's authenticated `@DevonStation Knowledge` connection. `knowledge_list`, `knowledge_search`, `knowledge_read`, and `knowledge_capture_draft` are available in the refreshed plugin.
- Owner created an encrypted local root-key recovery file and reported independently verifying a separate backup. Cloudflare `KNOWLEDGE_DATA_KEY` was replaced with the owner key, `KNOWLEDGE_KEY_ID=owner-v1`. Owner-local SHA-256 prefix exactly matched the live authenticated Worker attestation. Never check key, passphrase or encrypted key custody file into source.
- **Live encrypted acceptance:** `acceptance/fictional-draft` was created with expectedVersion 0 and exact fixed phase-one body; `knowledge_read` showed version 1, then a fixed phase-two update with expectedVersion 1 yielded version 2. Search/list/read returned the exact second body. D1 contains 1 page, 2 immutable revisions, 1 instance marker, with opaque indexed path, AES-GCM ciphertext format `knowledge-sealed-v1` and owner-v1 key ID. No title/body/path plaintext detected in stored rows.
- Negative access tests: a stale attempt at expectedVersion 1 returned `VERSION_CONFLICT`, and an unauthorized alternate path returned `FORBIDDEN`. The stored page remained unchanged at version 2.
- Cloudflare R2 bucket `knowledge-forward-backups-private` is private, with managed public R2 domain disabled and no custom public domain. Ciphertext-only snapshot `forward-owner-acceptance-v2-20261107.json` was saved and SHA-256 readback-verified (`8943db8d15f05147025d5a5d58c5f7be59c96fd50da5a565944502c7c0956e95`; 2113 bytes). It contains 1 encrypted page, 2 encrypted revisions, and 1 instance marker.
- Isolated D1 database `knowledge-owner-recovery-acceptance` was created, initialized using the checked-in `ops/private-forward/schema.sql`, and restored **only** from that R2 snapshot. All three tables and every stored ciphertext row matched byte-for-byte; production D1 remains 1 page/2 revisions/1 marker.
- Separate synthetic-key smoke backup/decryption/restore was previously verified using `knowledge-restore-smoke`; documented in `docs/CLOUDFLARE-KNOWLEDGE-BACKUP-SMOKE-2026-11-07.md`. This is not an owner-key decrypt proof.
- GitHub source support: PR #8 (owner-key attestation) and #9 (fictional-only write restriction) merged into the **development branch**, NOT `main`. Exact source release gates passed, including 302/302 tests on Node 22 and 24 for PR #9; the root migration PR #1 is still a draft.

## Current restrictions and unverified facts
- `KNOWLEDGE_ACCEPTANCE_ONLY_ACK=FICTIONAL_WRITE_ONLY_NO_PRIVATE_DATA` remains present. **Ordinary records cannot be created.** `KNOWLEDGE_PRIVATE_WRITE_ACK` remains ABSENT. A separate review/authorization is required for normal, nonclinical recordkeeping.
- Ciphertext restored to isolated D1 has **not yet been independently decrypted using the recovered owner key on that destination**. It is a correct ciphertext/metadata restore, not a fully closed production restore test.
- The R2 backup is **in the same Cloudflare account**, and no independent owner-held **data** backup or scheduled export/retention/restore process has been verified. The owner-key recovery backup is separate and must remain so.
- The original Notion export and ten additional owner-supplied root exports are reportedly private/staged, but record-level coverage, current-state reconciliation, attachments, database rows/views/relations, backlinks and scope/permissions have **not** passed final parity. **The live forward D1 contains no migrated historical Notion records.**
- Hosted production human reader is not yet independently accepted on both desktop and mobile; the fuller native navigation/sharing design is scheduled as the **next product overhaul after core cutover**, not evidence of current function.
- Clinical, patient, client and cross-entity records have not been granted scope, client permissions, or hosted import approval. Don't import them into `personal` by default. Unknown scopes go to private quarantine pending a separate review.

## Ordered, bounded retirement gates
1. **Hardening / ongoing backups:** add code-reviewed repeatable encrypted-row snapshot and verified recovery workflow (not one-off API scripts), bounded retention, private bucket permissions, full source/instance metadata, immutable history verification, and an owner-held/off-provider encrypted data copy. Prove restored records are readable with the recovered key in an isolated environment. Negative/rollback testing. Restrict secrets and backups; no public object URLs.
2. **Normal forward records:** after gate 1 and explicit authorization, retire the fictional ACK, enable only permitted nonclinical private draft capture/update through owner-authenticated ChatGPT, perform a real non-sensitive end-to-end smoke and backup. Maintain exact expectedVersion, draft status and provenance.
3. **Historical Notion inventory and import:** validate all original ZIPs and their extracted manifests, root/descendant/page/row counts and SHA-256 without mutating Notion. Scope-tag every source; quarantine uncertain ownership and sensitive data. Import into a separately authorized encrypted Knowledge destination preserving original bytes, titles, media, backlinks, source IDs and source fidelity. Reconcile original Notion permission boundaries. Resolve gaps explicitly; don't use silent drop or generic mass import.
4. **Minimal independent human access:** verify an actual owner-only hosted browser reader on desktop and iPhone, navigation/search, attachment access, version history, session/security handling and backup rollback. Keep an ordinary reader baseline even if the richer post-cutover UI comes later.
5. **Controlled production release:** review draft PR #1 and split/merge release-ready commits to `main` after CI, security review, Cloudflare deployment and real-user smoke checks. Publish deployment version and recovery runbook without private data or secrets. Maintain one authoritative Knowledge owner source; stop writing Notion.
6. **Retirement approval:** show export coverage/parity report, post-cutover working editor and reader, owner-held off-provider backup + live restore exercise, scope ACL review, current-source verification and explicit owner sign-off. Then disconnect the Notion ChatGPT plugin and stop any legacy calls. Do **not** delete the Notion workspace or original archives until separately approved. Archive metadata/provenance remains discoverable privately in Knowledge.

## The next locked overhaul, separate from retirement gate
**Knowledge Human Interface & Sharing.** Following the core retirement release: premium responsive browsable wiki, tree/hierarchy, folders/collections, semantic navigation, search, related pages/backlinks, full history/provenance, safe mobile interaction, page and collection sharing, permission-controlled collaborator workspaces, revocation and audit logs. Preserve AGPL/self-hostability and scoped privacy, with warm clinical boundaries for Cristy and no default public sharing. Build on the existing architecture without replacing the core or reopening the old Notion pipeline.

This is approved **product direction**, not implemented functionality. Its separate design/release gate must not be confused with the minimal private reader needed for retirement.

## Remaining owner actions
- Keep owner-key recovery file and passphrase separated; maintain an independently testable secure copy.
- Approve actual, irreversible Notion disconnection **only** after full migration and recovery evidence.
- No action on secret values in ChatGPT; no unnecessary re-running the initial fictional create command.

## Authoritative records
- Repository: https://github.com/devonalanakins/knowledge
- Active source/retirement PR: https://github.com/devonalanakins/knowledge/pull/1
- Key attestation PR: https://github.com/devonalanakins/knowledge/pull/8
- Fictional write restrictions PR: https://github.com/devonalanakins/knowledge/pull/9
- Current backup/restore smoke document: `docs/CLOUDFLARE-KNOWLEDGE-BACKUP-SMOKE-2026-11-07.md`.
