# Knowledge — private off-provider SQL archive (source-only)

**Status: source-only, synthetic-tested; not a backup of real records.** This tool protects an owner-downloaded SQL export at rest when it is copied to an independently controlled encrypted drive outside Cloudflare. It neither fetches Cloudflare data nor moves any file off-device. It does not establish owner-key restoration, source completeness, retention policy or Notion retirement acceptance by itself.

The archive contains the **exact source SQL bytes** encrypted again under an independently held archive passphrase. **This tool treats the bytes as opaque**; the operator must separately establish that the input really is the expected ciphertext-only forward Knowledge export before sealing. It never includes the Knowledge root key or recovery kit. Keep the archive passphrase distinct from the root-key kit passphrase; software cannot prove independent custody.

## Owner-only commands

Use a trusted Linux/macOS computer with encrypted storage. Source/export/archive paths must be in owner-owned private folders (0700); existing files must be regular files (0600), not symlinks. Native Windows is refused until its ACL rules are verified. Requires an interactive terminal and hidden password input; secrets are never supplied in command arguments or environment variables.

Seal an independently downloaded SQL export into a **new**, encrypted file using a receipt SHA-256 obtained from the original trusted backup receipt:

    npm run knowledge:sql:offsite -- seal /private/original.sql /private/backup.vault --sha256 EXPECTED_SHA256

Verify the archive without writing an SQL file:

    npm run knowledge:sql:offsite -- verify /private/backup.vault --sha256 EXPECTED_SHA256

Recover SQL bytes into a new private file (never overwrites):

    npm run knowledge:sql:offsite -- recover /private/backup.vault /private/recovered.sql --sha256 EXPECTED_SHA256

**Then** authenticate the actual encrypted Knowledge records using the independent existing owner key and, if held, the independently preserved source witness:

    npm run knowledge:sql:restore -- verify /private/recovered.sql /private/owner-recovery.json --sha256 EXPECTED_SHA256 --inventory /private/source-inventory.json

The vault passphrase decrypts the **outer** container only. A successful vault verification does not decrypt or validate any Knowledge record and does not prove source completeness. An inventory generated from the export itself is not independent evidence. Archive passphrase, root-key recovery kit and the inventory should be controlled and stored separately.

## Cryptographic and file constraints

- Binary version: knowledge-forward-offsite-sql-v1. Header includes fixed magic, 16-byte random scrypt salt, 12-byte random AES-GCM nonce, 64-bit original size, 32-byte SQL SHA-256, then ciphertext and a 16-byte authentication tag.
- KDF: scrypt N=32768, r=8, p=1, 32-byte derived key. AES-256-GCM authenticates the entire header as additional authenticated data. This is independent defense-in-depth encryption, not a replacement for the existing authenticated record encryption.
- A trusted receipt checksum is mandatory. Seal fails on a changed input. Verify/recover fail on a wrong receipt, damaged or truncated archive, invalid tag, wrong passphrase or malformed length. Do not derive a purported receipt from the untrusted archive itself.
- Files are streamed in 64 KiB chunks, with a 512 MiB source limit. Recovery fully authenticates before creating a destination, then authenticates again while writing. Failed new outputs are deleted and prior outputs are never overwritten.
- New outputs use owner-only permissions (0600). Original exports are untouched. No remote calls, cloud writes, output of decrypted page bodies, automatic retries or key recovery changes occur.
- Header includes original SQL size and SHA-256 and must be kept private to prevent metadata correlation. No formal independent cryptography/security audit has been completed.

## Production and retirement remain NO-GO

1. An explicitly approved genuine D1 export rehearsal on one isolated fictional acceptance database. Cloudflare D1 export requires Write permission and can block queries.
2. An independently preserved exact-bookmark source inventory, and authentication using the actual owner-held root-key recovery kit **outside Cloudflare**.
3. Transfer one authenticated encrypted archive to independent off-Cloudflare storage and successfully recover it completely offline with recorded custody evidence. Synthetic local roundtrips alone are insufficient.
4. Backup coverage for attachments, future workspace ACLs, multiple retention generations, monitoring, and rotation.
5. Historical Notion source parity, secure normal writes, desktop/iPhone acceptance, and final explicit retirement authorization.

This source change does not modify production Workers, D1, R2, Workflows, identity or Notion.
