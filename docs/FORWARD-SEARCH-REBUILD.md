# Owner-local private search rebuild and verification

**Source implementation with fictional tests; not run on real owner data.**
This completes the offline rebuild path for the optional forward word index.
It is not a production D1 migration, online job endpoint or new MCP tool.

## What happens

The existing encrypted recovery kit unlocks the existing key in local memory.
An instance-marker HMAC must match the selected database before optional schema
or progress writes begin. The command never creates or replaces a root key.
It opens an existing owner-private ciphertext SQLite database, such as the
isolated result of `knowledge:forward:restore`. No archive is extracted and no
page plaintext or key is written to disk or stdout.

Rebuilding reads 20 pages per batch (library API maximum 25), with one lookahead
row. Every current page is authenticated with AES-GCM, the correct workspace,
key ID, path HMAC, revision and timestamp. Its current immutable revision must
match. Word hashes use exactly the existing Worker's separate search-key
derivation and normalization. Index writes require the exact ciphertext/version
to remain current. Terms and the opaque progress cursor commit together.

After traversal, verification starts independently from the beginning. It
decrypts each current page in bounded batches and compares the entire expected
word-hash set with stored membership and the current version. Missing, extra,
forged or stale terms and orphan index rows fail. Progress is never evidence of
coverage: a forged `built` checkpoint cannot bypass this full pass.

Verification holds a SQLite `BEGIN IMMEDIATE` lock across the whole pass; another
writer cannot invalidate an earlier batch. Only after verification succeeds
does the same transaction mark rebuild progress `verified`. The receipt contains
aggregate counts, not page IDs, titles, bodies, tokens or secrets. This proves
the **current-page derived index**, not full historical archive recovery or
every earlier immutable revision's decryption.

## Owner-local commands

Use the reviewed canonical `main`, Node 22.13+ or 24, and an independently
protected owner-controlled machine. The CLI currently requires POSIX ownership
and modes: the existing database and encrypted recovery file must be regular
0600 files in owner-only 0700 directories. It refuses symlinks, mismatched file
ownership, missing files and noninteractive terminal input. Recording detection
is not implemented; the owner must avoid recorded sessions. Windows ACL
verification is not implemented; the CLI refuses native Windows instead of
claiming Unix mode bits prove Windows permissions. Use an appropriately reviewed
Linux/macOS owner environment. File modes do not certify disk encryption.

Paths below are illustrative owner-local paths. Do not copy real paths, kits,
passphrases, database contents or page text to chat or public CI.

```sh
npm run knowledge:search:local -- rebuild /owner-encrypted/restore/knowledge-restore.sqlite /owner-encrypted/keys/knowledge-owner-recovery.json
```

Enter the existing recovery passphrase only at the hidden local prompt. If the
process stops, run the same command again: completed batches and their cursor
were committed together. No earlier source page or revision is overwritten.

To recheck the entire index without changing its terms or progress:

```sh
npm run knowledge:search:local -- verify /owner-encrypted/restore/knowledge-restore.sqlite /owner-encrypted/keys/knowledge-owner-recovery.json
```

For repair after failed verification, changed source records, deleted terms or
untrusted progress, restart traversal from the beginning:

```sh
npm run knowledge:search:local -- rebuild /owner-encrypted/restore/knowledge-restore.sqlite /owner-encrypted/keys/knowledge-owner-recovery.json --restart
```

`--restart` resets only the derived rebuild checkpoint; subsequent batches
replace derived term membership. Original ciphertext records, immutable revisions,
instance identity and recovery kit remain unchanged. A failed transaction rolls
back its index and progress changes. The local SQLite copy can always be replaced
by a fresh independent ciphertext restore if its integrity is in doubt.

## Boundaries and remaining gates

- No network requests, Cloudflare credentials, production writes, normal-write
  acknowledgments, permission changes, sharing or Notion calls are present.
- The optional schemas are installed only by the explicit local `rebuild`
  command, after key/instance authentication. `verify` does not install schema.
- Rebuild memory use is bounded by each batch and 1,024 terms per page; database
  locks, elapsed time and total work still scale with the library. The independent
  final pass intentionally revisits every page. The SQLite lock may block other
  writers; use an isolated restored copy, not an active application file.
- An interrupted verification restarts its full pass. A persisted progress row
  is not a signed independent audit receipt. SQL/database corruption still fails
  the operation and may require restoring the copy.
- The online Worker's blind-index equality/frequency leakage and potential false
  negatives under index deletion remain. This local verifier detects such
  omissions when actually run; it does not provide continuous online integrity.
- Real owner-key execution, Windows support, an approved D1 rebuild/rollout,
  coherent scalable backups, workspace permissions, attachments and production
  acceptance remain separate gates. The production feature stays disabled.

Synthetic tests cover 3,312 encrypted records with page reads capped at 26 rows,
disk close/reopen/resume, rollback, wrong keys/scopes, missing current revisions,
corruption, forged progress, term deletion/insertion, concurrent-write locking,
new source records, empty databases and noninteractive CLI refusal.
