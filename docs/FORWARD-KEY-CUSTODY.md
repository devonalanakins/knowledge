# Owner-held Knowledge encryption key — production recovery gate

Status: SOURCE IMPLEMENTED; KEY CUSTODY NOT YET COMPLETED OR VERIFIED ON THE OWNER'S DEVICE. Not a clinical-data or historical Notion import procedure.

## Why it matters

The existing Cloudflare Knowledge acceptance Worker uses an agent-generated random encryption secret without any independently verified owner-held recovery copy. The live forward D1 was last verified empty. **Check that D1 remains empty before provisioning a replacement key.** Overwriting a key on a populated database makes existing encrypted records irretrievable. Cloudflare D1 Time Travel retains database history for up to 30 days, but does NOT preserve independent application-layer encryption keys.

## One-time owner-local setup

Run these commands on an owner-controlled private computer with Node.js 22.13+ and this repository checked out. Create the encrypted recovery file OUTSIDE the repo, public sync folders, CI, or chat.

1. Create a recovery file by running:
   npm run knowledge:key:owner -- create "/path/outside/repo/knowledge-owner-recovery.json" personal owner-v1
   Enter and confirm a unique long passphrase (24+ UTF-8 bytes) at the hidden prompts.
2. Verify the encrypted recovery file:
   npm run knowledge:key:owner -- verify "/path/outside/repo/knowledge-owner-recovery.json"
   The command prints a short key fingerprint, scope and key ID — never the key.
3. Store the **encrypted file** somewhere independently recoverable, separate from Cloudflare. Store its **passphrase** separately in a trusted password manager or another protected recovery mechanism. Independently read and verify the backup copy.
4. Before changing Cloudflare: verify the exact intended database has zero knowledge_pages, zero knowledge_revisions and zero knowledge_instance records. If nonzero, STOP and use a reviewed data-preserving key rotation process instead.
5. In a trusted local terminal only, reveal the key explicitly:
   npm run knowledge:key:owner -- reveal "/path/outside/repo/knowledge-owner-recovery.json" --show-key
   Paste the displayed value DIRECTLY into the appropriate Cloudflare Worker secret named KNOWLEDGE_DATA_KEY. On the SAME Worker set KNOWLEDGE_KEY_ID to owner-v1. Do not paste it into ChatGPT, screenshots, code, logs, tickets or issues. Clear clipboard and terminal scrollback.
6. Verify the backed-up recovery file again. Keep KNOWLEDGE_PRIVATE_WRITE_ACK UNSET until actual encrypted backup/restore, owner authentication, and fictional-data write/readback have been independently verified.

The helper does not make provider changes, store tokens, or enable write access. Production key creation and secure independent storage remain owner actions. The local command cannot provide proof of an independently held backup unless that backup is actually stored and tested.

## CLI behavior

- create FILE [SCOPE] [KEY_ID]: generates a fresh random 256-bit key; encrypts it with scrypt/AES-256-GCM using the existing Knowledge backup module; creates a file exclusively with owner-only permissions on POSIX; self-verifies its encrypted contents.
- verify FILE: checks file integrity and passphrase, prints scope, key ID and a short non-secret fingerprint only.
- reveal FILE --show-key: intentionally outputs plaintext key only to the owner's interactive terminal after passphrase authentication.

The outer recovery envelope records only scope and key ID; the full root key remains in authenticated ciphertext. Both the authenticated inner values and the outer metadata are checked during recovery. The tool rejects tampering, invalid inputs, weak passphrases, files above 8 KiB, symlinks, overwrite attempts and noninteractive raw-key revelation.

Windows filesystem permissions are not equivalent to POSIX 0600: keep the encrypted file in an owner-protected encrypted location and the passphrase separate.

## Owner-only key attestation (read-only)

After installing the recovered key, call the authenticated `knowledge_list` tool.
Its `keyAttestation` object contains `keyId` and a non-secret 16-hex-character
SHA-256 fingerprint prefix of the configured 256-bit Worker key. Compare both
values **locally** with `npm run knowledge:key:owner -- verify ...`. A match
establishes that the correct random key is installed without revealing it.
A mismatch is a release blocker: do not enable draft writes.

Do not confuse an empty list (no pages) with key correctness: without a stored
instance marker the old read path could succeed using an unintended key. The
fingerprint is returned only to authenticated owner MCP calls. Never add raw
secrets to tool output, logs, files, screenshots, or GitHub records.

## Remaining protected deployment acceptance

- Export encrypted D1 pages, revisions and instance marker to independent backup storage; restore to a separately isolated D1 database.
- Recover the owner key and use the recovered key to decrypt records after restore. A schema check alone is NOT recovery proof.
- Verify Cloudflare Access, wrong-user denial, owner identity and read-only tools still work after key replacement.
- Enable write capability only for a fictional test. Verify actual ChatGPT write, read, search, revision conflict handling, encrypted D1 persistence and backup restoration. Then separately authorize nonclinical ongoing recordkeeping.
- Preserve historical Notion ZIPs and keep Notion read-only until separately approved retirement; never dual-write.

Do not declare the system WRITE-READY based only on passing synthetic CI or a backup file that has not been independently retained and restored.

References: https://developers.cloudflare.com/d1/reference/time-travel/ ; https://developers.cloudflare.com/workers/configuration/secrets/ .
