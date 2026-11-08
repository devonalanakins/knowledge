# Forward Knowledge — owner-local D1 SQL export verification

**Source-only implementation.** Do not treat this as production restore acceptance or permission to enable the D1 Write export Workflow. PR #26's Workflow remains undeployed.

Cloudflare's coherent D1 REST SQL dump is **not** the v1 JSON ciphertext snapshot format. This separate tool reads an owner-downloaded .sql file as **untrusted data** and **never executes exported SQL**. It accepts only simple literal INSERT statements for knowledge_instance, knowledge_pages and knowledge_revisions.

Schema CREATE declarations are parsed for reviewed object names but never executed. The tool instead creates the fixed checked-in schema at ops/private-forward/schema.sql. It refuses all other SQL statements, verifies original file SHA-256 against an independent backup receipt, and authenticates every retained revision. A successful restore does not prove independent source inventory parity.

## Local-only commands

Run on a trusted Linux/macOS owner-controlled computer **with encrypted storage**. Native Windows is refused until ACL protections are implemented. The export and **existing** encrypted key recovery JSON must live as distinct regular files (mode 0600), in user-owned private directories (mode 0700), without symlinks. Never copy them to chat, GitHub, CI, or a browser.

Use the **exact SHA-256 from the verified backup receipt**, not a checksum computed from the file being validated.

Verify only, using isolated in-memory SQLite:

    npm run knowledge:sql:restore -- verify /private/export.sql /private/recovery.json --sha256 EXPECTED_64_CHARACTER_SHA256

Restore into a new, never-before-existing directory whose parent is owner-owned and mode 0700:

    npm run knowledge:sql:restore -- restore /private/export.sql /private/recovery.json /private/restored-2026-11-08 --sha256 EXPECTED_64_CHARACTER_SHA256

The tool requires an interactive terminal and prompts for the existing passphrase without echo. It never prints plaintext pages, secrets, ciphertext, or passphrases. It does not call the network or generate new root keys.

## Independent source-row inventory (optional, still private)

A valid encryption key authenticates the records **present** in an export. It cannot detect an entire valid page **and all its revisions** being deleted together. PR #28 adds a separate, deterministic inventory witness for that gap. It hashes the complete ciphertext rows of all three tables in a fixed SQLite BINARY order, with field type and length framing. No plaintext values are written to the witness. **The witness is not signed**, and its evidentiary value depends on its trusted, independent provenance.

For a **frozen, fictional owner-local SQLite source** that is distinct from the SQL export being tested:

    npm run knowledge:sql:inventory -- /private/original.sqlite /private/source-inventory.json

This refuses relaxed source permissions, requires a new owner-private output and never overwrites an existing file. Then verify or restore a SQL export with an optional additional argument:

    npm run knowledge:sql:restore -- verify /private/export.sql /private/recovery.json --sha256 EXPECTED_SHA256 --inventory /private/source-inventory.json

    npm run knowledge:sql:restore -- restore /private/export.sql /private/recovery.json /private/new-restored-folder --sha256 EXPECTED_SHA256 --inventory /private/source-inventory.json

The restore tool now prints `Source completeness: NOT CHECKED` when no source inventory was supplied, or `MATCHED` when a witness is supplied and exactly matches. A mismatch refuses the restore and removes a newly-created output folder. Do not generate the witness from the same export to claim independence. Do not commit, publish or share real inventories; they can reveal record counts and support correlation of private ciphertext.

**Not yet implemented:** obtaining a trustworthy, exact-bookmark inventory directly from Cloudflare D1 while writers continue. Source rows must be frozen or tied to the exact export bookmark. This CLI is only for local isolated sources; a matching fictional local witness does **not** certify a real provider snapshot or off-provider recovery. The source/origin, export and saved witness must be independently accounted for.

## Independent checks

1. File SHA-256 matches independent receipt. Owner-only input, no symlink, bounded at 512 MiB. Strict UTF-8. Individual SQL statements bounded at 128 KiB.
2. Only exact table names and validated bound literal values. The dump's SQL is **never passed into SQLite.exec() or SQLite.prepare()**. The target and immutable history guards are created from the canonical checked-in schema.
3. Instance marker authenticates against existing owner key, scope and key ID. Each current page and **every historical revision** is AES-GCM authenticated and checked against its path HMAC, version and timestamp; no revision gaps or mismatched heads.
4. The restored encrypted SQLite passes integrity and foreign-key checks, and its row counts match parsed input. A restore writes into a new private folder only; on failure, its partial folder is removed. Source files and provider resources remain unchanged.

## Current limitations / release gates

- Synthetic tests include **more than 500 records** and an independently produced **standard Python sqlite3 .dump**, but the parser has **not** been checked against a genuine Cloudflare REST D1 export. Unknown SQL syntax or schema statements deliberately fail closed. Review a **fictional provider export** before expanding support.
- Conservative limits of 512 MiB input, 128 KiB per statement, 100,000 pages and 1,000,000 revisions are not production scale certification. Verify-only uses memory SQLite and can exceed available RAM for very large sources; resume is not supported.
- Actual D1 export can lock provider queries and requires D1 Write permission. Its Workflow remains **undeployed**, with no cron. The deployed 500-page writer cap stays in place.
- These three ciphertext tables exclude derived search indexes, attachments, multi-workspace roles/sharing records and historic Notion source archives. Each needs a separately accepted backup.
- Off-Cloudflare owner-controlled backup, real recovered-key execution, fictional provider-export compatibility, hosted desktop/iPhone acceptance, migration parity and formal Notion retirement remain **NO-GO**.

Related: docs/FORWARD-CONSISTENT-SQL-EXPORT.md, docs/FORWARD-OFFLINE-RESTORE.md, docs/CUTOVER-READINESS-2026-11-07.md.
