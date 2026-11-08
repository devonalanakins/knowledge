# Knowledge forward D1 — private scheduled backup watchdog

Status (2026-11-08): **source merged, CI PASS; nonpublic Worker deployed and
Cron configured, but first actual scheduled check NOT YET OBSERVED**. Cloudflare
confirmed the version, R2-only binding and daily trigger. Do not call
runtime health acceptance complete until the scheduled execution is observed.
Worker error logging is not a verified notification to the owner.

## Why this is separate

The current daily `knowledge-forward-backup-private` Worker generates an
encrypted R2 snapshot at **08:00 UTC** and reads it back. A successful backup
does not prove a separate future check can detect missing, corrupt or skipped
snapshots. The separate nonpublic watchdog checks at **10:00 UTC** (30 minutes
after the existing 09:30 health-grace cutoff).

It must NEVER replace the actual backup Worker. It has no D1 binding, owner
encryption key, access identity, GitHub secret, Notion token, public HTTP route,
or general draft-write credential.

## Algorithm

- Expect daily `personal/owner-v1` snapshots beginning 2026-11-08.
  Check continuity across the last seven due days (or since the first due
  day, whichever is later). Refuse a missing date even if today passed.
- Use only Cloudflare R2 `list` and `get`; no `put`, `delete` or bucket
  configuration mutations in the Worker source.
- Validate exact object namespace, canonical 08:00 UTC event timestamp
  (including the real observed `08:00:54.161Z` dispatch delay), bounded
  90-minute dispatch grace, UUID, file size, SHA-256 custom metadata and
  recognized backup format. Refuse duplicates and overly large listings.
- Download **every current due-day generation**. Verify bytes/metadata
  SHA-256 and count, parse strict v1 JSON, and independently validate
  ciphertext envelope format, scope, key ID, instance marker, and every
  contiguous immutable revision. Earlier due days receive listing and
  metadata continuity checks only, to bound Worker memory and transfer
  cost; older snapshot bytes are revalidated by the owner's existing
  read-only monitor or offline mirror.
- Errors throw a stable, redacted operational exception; successful logs
  report only due date, number of verified snapshots and aggregate
  encrypted page/revision/instance counts. No secret, object key, body,
  record title, plaintext or ciphertext is included.
- All HTTP requests return empty 404. Unknown Cron expressions,
  wrong acknowledgment and missing R2 binding fail before reads.

The default history window is seven due days. A missing day older than that
cannot be independently proven absent by this Worker. Keep independently
retained receipts and use the existing offsite mirror for long-term custody.

## Provider deployment checkpoint — 2026-11-08

- GitHub [PR #42](https://github.com/devonalanakins/knowledge/pull/42)
  merged at `8c7f6dd2b06b43b517320f9105f86a34114da4a6`.
  Exact-head and post-merge Node 22, Node 24 and isolated-vault CI passed.
- Cloudflare Worker `knowledge-forward-backup-watchdog-private`, active
  version `8b485fa7-88d6-436c-a90e-0a6b0d89053a`, verified 100%.
  Before deployment it ran an inert 404 placeholder; source remains
  a separate dedicated Worker.
- Cloudflare provider readback confirmed exactly five bindings: one
  existing private R2 bucket (`BACKUP_WATCHDOG_BUCKET`) and four nonsecret
  config values for ACK, scope, key ID and first due date. **No D1,
  owner key, Access credential, bearer token, clinical scope or private
  service binding is present.**
- Worker subdomain and previews were both confirmed disabled. Actual
  scheduled Cron is `0 10 * * *` UTC. The existing backup generator retains
  its separate `0 8 * * *` UTC Cron.
- Existing owner Worker remains `bf1ea505-df98-4e77-ab30-92ba4610f7f7`;
  owner D1 still contains 1 encrypted instance marker, 3 pages and 8
  immutable revisions. Nothing was migrated, overwritten or rekeyed.
- **Pending live acceptance:** no real scheduled `10:00 UTC` invocation
  has completed since this watchdog was activated. This checkpoint proves
  deployed configuration, not successful runtime backup inspection.
  A verified owner-specific alert destination and end-to-end failure
  notification remain unconfigured. The currently advertised Cloudflare
  account alert types do not provide a reliable per-service filter through
  the inspected API; do not create a broad account-wide policy by default.

## Deployment target (not automatically enabled by source merge)

Source: `src/worker-cloudflare-backup-watchdog.mjs`.

Canonical config: `ops/private-forward/wrangler.backup-watchdog.json`.

- Dedicated script: `knowledge-forward-backup-watchdog-private`
- Cron: `0 10 * * *` UTC
- Data binding: `BACKUP_WATCHDOG_BUCKET` to the EXISTING private
  `knowledge-forward-backups-private` R2 bucket (R2 binding technically
  supports writes but this Worker uses only read/list methods).
- Scalar gates: `BACKUP_WATCHDOG_ACK=OWNER_ONLY_CIPHERTEXT_HEALTH_V1`,
  `BACKUP_WATCHDOG_SPACE=personal`,
  `BACKUP_WATCHDOG_KEY_ID=owner-v1` and
  `BACKUP_WATCHDOG_FIRST_DUE=2026-11-08`
- Workers.dev and preview URLs disabled; no routes or public domain.
- No D1 or `KNOWLEDGE_DATA_KEY` bindings; never copy backup writer
  encryption or Access credentials.

Before release, verify exact merged source head and CI, inspect Worker
bindings/version and endpoint exposure, observe one real scheduled read
against the existing R2 backup, and separately review alert-delivery
integration. Do not claim the monitor is live from a configured Cron alone.

## Alerts and failures

The scheduled handler emits sanitized error logs and throws
`KNOWLEDGE_BACKUP_WATCHDOG_FAILED`. An effective owner notification
requires a separately provisioned, verified **private** Workers
Observability alert policy or owner-controlled notification destination.
The current source does NOT provision that policy, send email, or deliver
any notification. Owner notification = **NOT VERIFIED** until a negative
canary triggers a real private notification with acknowledged receipt.
Do not expose sensitive object names or grant general API tokens to a
notification endpoint.

Negative acceptance: unavailable R2, missing date, bad metadata,
mismatched SHA-256, invalid version chain, malformed timestamp,
unrecognized Cron, duplicate objects and pagination failure must all
fail closed. Ensure the daily backup Worker continues succeeding even
if the watchdog fails.

## Boundaries

This independent same-account health check is NOT off-provider backup,
owner-key independent decrypt/restore, attachment recovery, Notion
historical migration, scoped sharing, or authorization to disconnect
Notion. Keep scheduled backup objects immutable and retained until
independent owner-held two-generation recovery acceptance.
