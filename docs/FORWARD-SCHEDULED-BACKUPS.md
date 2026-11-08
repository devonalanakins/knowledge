# Knowledge forward D1 — scheduled ciphertext backups

**Status: implementation and test code only until provider release receipt verifies an actual scheduled invocation.**
This is a dedicated Cloudflare Worker, separate from the owner-only Knowledge MCP Worker.

## Security / data model

- Reads **only** encrypted D1 rows from `knowledge_instance`, `knowledge_pages` and `knowledge_revisions`. It never receives `KNOWLEDGE_DATA_KEY`, access identity tokens, plaintext wiki content or any Notion archives.
- Uses `D1Database.batch()` to issue the three SELECT statements in a single SQL transaction. The resulting snapshot includes the current page ciphertext, **all** its original immutable revisions, and the HMAC instance marker. Validates all required tables, metadata and a contiguous 1..N revision chain before uploading.
- R2 objects are written under `automated/personal/owner-v1/` with unique immutable object names. Uses **conditional create** (`If-None-Match: *`) and then downloads the stored object to verify SHA-256 and size. No automatic deletion, overwrite, sharing or plaintext logging is implemented.
- The scheduled Worker has no live HTTP interface: `fetch()` always returns 404 with no content. Any unexpected cron or missing explicit environment acknowledgment fails closed. The Worker emits operational backup receipt metadata only, never ciphertext or secrets.
- Snapshot output is still `knowledge-forward-ciphertext-backup-v1`; it can be authenticated/decrypted on the owner's trusted computer using `npm run knowledge:forward:restore` and their separately backed-up recovery kit.
- Safely capped at 500 pages, 64,000 revisions, 25 MB per snapshot. If size exceeds bounds, the backup fails visibly instead of silently dropping data. Historical Notion attachments and the separate legacy vault are outside this forward D1 backup.

## Scheduled deployment target (not automatically authorized)

- Worker script name: `knowledge-forward-backup-private`
- Cron: `0 8 * * *` (daily **08:00 UTC**; the local clock time varies with daylight saving)
- D1 binding: `BACKUP_DB` -> `knowledge-forward-private` (D1 UUID `d942f8de-1f89-4942-adf7-e8ba00a72efa`)
- R2 binding: `BACKUP_BUCKET` -> `knowledge-forward-backups-private` (existing **private** bucket)
- Nonsecret scalar bindings: `BACKUP_ACK=OWNER_ONLY_CIPHERTEXT_SCHEDULED_V1`, `BACKUP_SPACE=personal`, `BACKUP_KEY_ID=owner-v1`.
- No `KNOWLEDGE_DATA_KEY`, `KNOWLEDGE_ACCESS_*`, `KNOWLEDGE_PRIVATE_WRITE_ACK` or `KNOWLEDGE_ACCEPTANCE_ONLY_ACK` binding to this separate Worker.
- Deploy through a reviewed Cloudflare Worker version with **only** these five bindings; inspect the deployed version and the actual scheduled trigger before calling the automation live. The dedicated Worker should not have public workers.dev exposure and must not have routes. Its `fetch` also returns 404.

## Acceptance checks

1. GitHub CI on Node 22/24: syntax, six focused scheduled Worker tests including atomic batch reads, ciphertext-only snapshot compatibility with offline restore format, no overwrites/deletes, fail-closed cases and hash mismatch, plus entire repository test suite.
2. Verify the existing Knowledge Worker is unchanged, retains owner-only Access, fictional-only capture, and still has **no unrestricted writer ACK**. The existing Cloudflare D1 and manual R2 backups must not change from testing this source.
3. Deploy the separate backup Worker, bind the existing D1 and private R2, attach a cron trigger only after the Worker version is reviewed. Confirm no public route, credentials or root encryption key is bound.
4. Observe a genuine successful scheduled event and R2 object with expected `automatic...` prefix, exact readback hash and counts; ensure it includes the real 1-page/2-revision owner-encrypted acceptance record.
5. Download that automatic snapshot to the owner's encrypted computer and verify/decrypt with the independently held recovery key using `docs/FORWARD-OFFLINE-RESTORE.md`. Store a separate off-Cloudflare copy, rehash it after transfer, and confirm the original backup cannot be overwritten.
6. Test missing D1 binding, revoked R2 access and storage quota handling via staging. Ensure scheduler failures are observable and can be rerun without deleting earlier backup objects.
7. **Future backup governance (separate release):** explicit retention and recovery policy, off-provider rotation, periodic restore tests, and monitored missed-snapshot alerting. **Never configure a provider lifecycle auto-expiry before independent off-provider data backups and two verified recovery generations.**

## What this does not prove

- A successful `scheduled()` unit test is not an observed Cloudflare cron execution. No schedule exists until provider configuration confirms it.
- R2 is in the **same Cloudflare account** as the D1 database. It is a useful operational backup, not a true independent off-provider disaster recovery copy.
- R2 bucket lifetime is not controlled or audited by this Worker. It never deletes data, but account-level lifecycle rules must be checked separately.
- This does not enable normal clinical/private recordkeeping, migrate Notion history or authorize disconnecting Notion. The owner-facing Human Interface & Sharing overhaul follows core cutover.
- Cloudflare binding access itself can technically write to D1; it is essential to keep this job isolated and its source auditable. The Worker only issues SELECT statements and never uses a write SQL statement.

Docs: https://developers.cloudflare.com/d1/worker-api/d1-database/ , https://developers.cloudflare.com/workers/configuration/cron-triggers/ , https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ .
