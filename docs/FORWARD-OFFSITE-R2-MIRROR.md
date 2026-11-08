# Forward Knowledge — owner-controlled off-provider R2 ciphertext mirror

**Status (2026-11-08): SOURCE IMPLEMENTED; REAL OFF-PROVIDER ACCEPTANCE PENDING.**
No owner-held external storage device or original owner recovery key has been
used by this PR. Nothing is deployed or scheduled by this source change.

## Purpose

From a trusted independently controlled Linux/macOS host, use the existing
GET-only Cloudflare R2 API adapter to copy already encrypted Knowledge
snapshots to an independently encrypted disk. No owner root key, recovery
passphrase, Notion data, clinical information or write-capable Cloudflare
credential is needed.

The mirror:

- Validates the due-day health of provider backups using the existing
  timestamp-aware backup monitor, and mirrors all authorized listed R2
  generations in the selected scope and key ID.
- Checks actual object size, MD5 R2 ETag, SHA-256 custom metadata,
  structural snapshot format, scope, key ID and complete revision history.
  One 32 MiB-capped object is processed at a time.
- Writes mode 0600 files into a pre-existing, owner-owned mode 0700
  directory with exclusive, no-symlink open and file/directory fsync.
  Existing files must match the expected size and SHA-256 and will never
  be overwritten. Reruns are safe and resumable.
- Refuses malformed source names, duplicates, invalid timestamps,
  insecure destinations, symlinks, local tampering or transport failures.
  Prints only aggregate counts and the latest expected backup day.

## Owner-only POSIX runbook

1. Mount independent encrypted owner-controlled storage outside Cloudflare,
   then create a private 0700 destination directory in a trusted parent.
   Filesystem mode/ownership checks do NOT prove disk encryption.
2. Store a dedicated, restricted R2 Objects Read token in the local host's
   secret store, not shell history or chat. Do not grant D1 or R2 writes.
3. Securely supply environment variables from the host secret manager:

   - CLOUDFLARE_API_TOKEN: private read-only R2 token
   - CLOUDFLARE_ACCOUNT_ID: existing account identifier
   - KNOWLEDGE_BACKUP_BUCKET=knowledge-forward-backups-private
   - KNOWLEDGE_BACKUP_SCOPE=personal
   - KNOWLEDGE_BACKUP_KEY_ID=owner-v1
   - KNOWLEDGE_BACKUP_FIRST_DUE=2026-11-08
   - KNOWLEDGE_OFFSITE_MIRROR_ACK=OWNER_ENCRYPTED_DESTINATION_REVIEWED_V1

4. Run on that reviewed private owner host:

       npm run backup:offsite-mirror -- /owner-encrypted/knowledge-personal

5. Disconnect the off-provider device from Cloudflare. Select a mirrored
   ciphertext snapshot, verify its hash against independently retained
   provider evidence, and run the existing owner-key offline decrypt
   and restore process in FORWARD-OFFLINE-RESTORE.md. Use the ORIGINAL
   separately held encrypted recovery kit, not a generated replacement.
   Never send the kit, passphrase, snapshot or plaintext into chat or CI.

## Explicit limitations

- No unattended mirror, independent alert delivery, monthly rotation or
  tested production off-provider copy exists merely because this code
  merged. Actual owner-controlled execution and two independently
  accessible generations remain required.
- The health checker verifies recent due-day continuity (default 7 days).
  Mirroring all listed generations cannot prove that no older backups
  disappeared from R2. Independent receipt retention remains necessary.
- Snapshot format covers forward encrypted records and immutable histories
  only, not Notion ZIPs, attachments or future workspace ACLs.
- Windows is intentionally refused until native ACL behavior is reviewed.
  WSL on an actual encrypted drive is not itself recovery acceptance.
- This program assumes a trusted owner-only host and parent directory:
  it is not designed to withstand a malicious privileged local process
  racing filesystem paths.
- A successful mirror does not prove original owner-key decryption, a
  functioning standalone reader, automatic GitHub capture or Notion
  retirement. Those release gates remain independent and blocked.

Related: FORWARD-BACKUP-HEALTH.md and FORWARD-OFFLINE-RESTORE.md.
