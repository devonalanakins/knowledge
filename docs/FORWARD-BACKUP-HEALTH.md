# Knowledge forward backups — read-only health and integrity audit

**Verified update — November 8, 2026:** A genuine scheduled R2 ciphertext object was independently observed under `automated/personal/owner-v1/`, stamped `08:00:54.161 UTC`, with SHA-256/size matching R2 metadata and exact encrypted-row parity against production D1 (1 instance marker, 3 pages, 8 revisions). The previously exact-`08:00:00.000` health-monitor filename check incorrectly rejected that legitimate object. The updated monitor accepts canonical real dispatch timestamps within the configured 08:00 UTC grace window, while rejecting invalid dates and late or off-schedule filenames. **This is still read-only source tooling, not deployed unattended monitoring or alert delivery.** Never run it in public CI with owner credentials.

The deployed backup Worker remains unchanged: `knowledge-forward-backup-private`, cron `0 8 * * *` UTC, binding only `BACKUP_DB` and private `BACKUP_BUCKET`. The first expected actual cron run after the 2026-11-07 setup is **2026-11-08 at 08:00 UTC**.

## What this check proves

Run `node ops/private-forward/monitor-backups.mjs` from a trusted owner-controlled environment. The checker uses **GET only** with a **restricted read-only Cloudflare API token**; do not give this token D1 writes or R2 writes/deletes. It lists objects under `automated/personal/owner-v1/`, checks that each due calendar day has a backup, and for the latest due day downloads all matching objects. It validates immutable name pattern, exact byte length, R2 ETag (MD5), **independent SHA-256 receipt in R2 custom metadata**, strict backup format, scope, key ID, page count, immutable revision chain and instance marker.

A snapshot is due for this monitor only **90 minutes after** each 08:00 UTC cron trigger; until the first due day, it reports `PENDING_FIRST_RUN`. After a missing due day, malformed object, tamper or API failure, it returns nonzero exit status with an error code. Only counts, dates and checksums reach stdout; no encrypted records or tokens are printed.

The SHA-256 custom metadata is stored in the same Cloudflare account. It guards against accidental corruption, but is **not** an independent tamper-evident transparency log, off-provider backup or root-key proof. Any principal authorized to replace both an object and its metadata can undermine this comparison. Keep the R2 token read-only and use separate authenticated owner-local restoration.

## Owner-held off-provider ciphertext copies

The separate [read-only R2 backup mirror](FORWARD-OFFSITE-R2-MIRROR.md)
reuses this health policy and existing GET-only R2 adapter to copy verified
scheduled snapshot generations into an owner-controlled encrypted directory.
Its code and synthetic tests do **not** establish that a real off-Cloudflare
backup or original-owner-key restore has been performed.

## Private owner-run environment (never paste tokens or secrets into chat)

Set these environment variables through the owner's existing private secret manager or protected shell. Do not place them in GitHub, shell history, screenshots or chat. The values below are nonsecret configuration except the token:

- `CLOUDFLARE_API_TOKEN`: separately provisioned restricted token for **R2 Objects Read**
- `CLOUDFLARE_ACCOUNT_ID`: the existing Cloudflare account identifier
- `KNOWLEDGE_BACKUP_BUCKET=knowledge-forward-backups-private`
- `KNOWLEDGE_BACKUP_SCOPE=personal`
- `KNOWLEDGE_BACKUP_KEY_ID=owner-v1`
- `KNOWLEDGE_BACKUP_FIRST_DUE=2026-11-08`

Then run:

```sh
node ops/private-forward/monitor-backups.mjs
```

The token is **not** used for signing Knowledge records, deriving the root encryption key, or Notion migration. Never put the owner key, owner recovery passphrase or quarantine passphrase into this monitor.

## Operational policy and remaining acceptance

- Keep finished R2 objects indefinitely **until** two independent, verified owner-held encrypted data backup generations and a tested off-provider restore exist. The configured R2 lifecycle currently only aborts incomplete multipart uploads after seven days; no completed-object expiry is authorized.
- Run an owner-controlled read-only daily monitoring task after **09:30 UTC**, and route non-sensitive failure/success receipts to owner-only operations monitoring. **No watcher or alert delivery has yet been deployed by this PR.** Provisioning such a service is a separate reviewed step; don't put Cloudflare tokens in public GitHub Actions.
- Independently verify one real scheduled R2 object and SHA receipt after the first due run. Then download it onto a trusted encrypted computer, verify/decrypt **every** revision with the independently held owner recovery kit, restore to a fresh isolated SQLite destination, check both correct and wrong keys, and retain an off-provider encrypted copy. Follow `docs/FORWARD-OFFLINE-RESTORE.md`.
- Encrypted page-row backups are **not** a backup of the eleven raw Notion ZIPs, protected quarantine database, attachments or other historical media. Preserve their separate archival chain.
- This check does not make a Notion retirement, normal-writing, workspace access-control, public sharing, human UI or production deployment decision. Those remain separately gated.

Tests: `node --test test/forward-backup-health.test.mjs test/forward-backup-cloudflare-client.test.mjs`. Exact-head CI must still pass before merge.
