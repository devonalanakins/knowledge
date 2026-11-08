# Owner-local Knowledge ciphertext verification and restore

Status: SOURCE IMPLEMENTED; OFFLINE SYNTHETIC TESTS REQUIRED; **owner-key real-backup verification pending**. This command never connects to Cloudflare, imports Notion, enables writes, exposes decrypted pages, or overwrites an existing restore.

## What this tool verifies

`npm run knowledge:forward:restore -- verify ...` reads a previously downloaded, ciphertext-only `knowledge-forward-ciphertext-backup-v1` JSON snapshot and the owner's separately encrypted recovery-kit JSON. It prompts for the existing recovery passphrase on a trusted interactive terminal. It verifies:

- The entire input SHA-256 equals the independently recorded receipt.
- No malformed/unknown fields, duplicate paths, missing historical revisions, gaps, malformed ciphertext, or inconsistent current-page pointers.
- The recovery kit's scope/key ID match the stored snapshot and its HMAC instance marker.
- Every historical revision decrypts with AES-256-GCM, correct AAD and `owner-v1` and maps to its HMAC-indexed wiki path. No plaintext source content is printed.
- Invalid or mismatched keys, ciphertext tampering, missing/changed revisions, and stale indexes fail closed.

`restore` performs the same verification **before creating any output**, then writes an isolated encrypted-content SQLite database using the checked-in D1 schema, verifying exact ciphertext rows, integrity and foreign keys. It refuses pre-existing destination folders and preserves immutable revision triggers. The SQLite file contains encrypted page/revision bodies, not a plaintext wiki. It does not reconnect the restored database to ChatGPT or replace any Cloudflare database.

Input size is currently capped at 32 MiB; this is an **acceptance recovery tool**, not a fully streaming long-term production backup solution. Historical attachments are outside this forward D1 format and require separate protected backups.

## Owner runbook — Windows PowerShell

Use an owner-controlled **encrypted** computer or drive. Your original local encryption recovery kit must still exist. **Never send the recovery JSON, its passphrase, the full ciphertext snapshot, or terminal output containing secrets into ChatGPT, GitHub, email or public cloud folders.** This tool prints no secrets or record contents, but a screen recording of passphrase entry is still undesirable.

1. Sign in to Cloudflare and open R2 → the private `knowledge-forward-backups-private` bucket → **Objects**. Download the exact object `forward-owner-acceptance-v2-20261107.json` into a private local folder. It was previously confirmed as 2113 bytes with SHA-256:

   ```text
   8943db8d15f05147025d5a5d58c5f7be59c96fd50da5a565944502c7c0956e95
   ```

   Do not enable public R2 domains or share the object using a public URL. No Cloudflare API token is required for a dashboard download.

2. Get the reviewed canonical Knowledge source (after the recovery fix is merged):

   ```powershell
   cd "$HOME\knowledge"
   git fetch origin
   git switch main
   git pull --ff-only
   ```

3. Verify the downloaded snapshot **with your existing encrypted recovery key**, entering its long passphrase at the hidden prompt. Adjust the download path if the file is elsewhere:

   ```powershell
   npm.cmd run knowledge:forward:restore -- verify "$HOME\Downloads\forward-owner-acceptance-v2-20261107.json" "$HOME\KnowledgeRecovery\knowledge-owner-recovery.json" --sha256 8943db8d15f05147025d5a5d58c5f7be59c96fd50da5a565944502c7c0956e95
   ```

4. Restore into a **new, previously nonexistent** folder on an owner-controlled encrypted disk, then confirm it reports `RESTORE VERIFIED` and `pages: 1; revisions: 2`:

   ```powershell
   npm.cmd run knowledge:forward:restore -- restore "$HOME\Downloads\forward-owner-acceptance-v2-20261107.json" "$HOME\KnowledgeRecovery\knowledge-owner-recovery.json" "$HOME\KnowledgeRecovery\restore-check-20261107" --sha256 8943db8d15f05147025d5a5d58c5f7be59c96fd50da5a565944502c7c0956e95
   ```

5. Copy **the verified ciphertext snapshot** to an independent encrypted owner-controlled off-provider device/location, separately from the recovery passphrase. Check file hash again after copying. Do **not** upload decrypted keys or open the restored database to the public internet. The owner-held data backup is only proved after this off-provider copy is independently accessible.

## Automated owner-local download option (not yet accepted on real owner hardware)

The [off-provider R2 mirror](FORWARD-OFFSITE-R2-MIRROR.md) can copy
already encrypted scheduled snapshots to an owner-controlled encrypted
POSIX directory using read-only R2 access. It does not request or expose
the owner key. After a real independent copy, run this document's existing
key-based verification and restore acceptance from that destination.
Neither the code nor its fictional tests alone prove off-provider recovery.

## Security boundaries and future work

- This accepts only private `knowledge-forward-ciphertext-backup-v1` row snapshots, not native Cloudflare D1 SQL exports, ZIP files, Notion archives or historical attachment/media bundles.
- This specific source snapshot was produced through a one-off provider API acceptance flow. A separate ciphertext-only backup Worker is installed with cron `0 8 * * *`; the first due event is November 8, 2026 at 08:00 UTC. No actual scheduled snapshot had yet been observed at the pre-event inspection. The installed schedule does not prove successful execution. See `FORWARD-SCHEDULED-BACKUPS.md` and `FORWARD-BACKUP-HEALTH.md`. Retention remains keep-all; no completed-object deletion is authorized. Streaming export, actual concurrent-write provider acceptance and independent owner-key recovery remain unverified.
- The isolated Cloudflare D1 ciphertext-restore test passed earlier; this new tool provides the missing independent **owner-held-key decryption proof** only when the owner actually runs it with the downloaded real snapshot.
- Keep `KNOWLEDGE_PRIVATE_WRITE_ACK` absent and only fictional acceptance writing enabled until all ordinary recordkeeping gates pass.
- Keep Notion read-only and attached as migration evidence until source parity, encrypted attachment backup, scope/access review, desktop/mobile reader and explicit final retirement approval are complete.

Related: `docs/CUTOVER-READINESS-2026-11-07.md`, `docs/FORWARD-KEY-CUSTODY.md`.
