# Knowledge lightweight storage and privacy policy

**Scope:** text-first, GPT-maintained private wiki. Do not copy raw chats, complete transcripts, images, PDFs, attachments or media. Link to separately authorized source material. Byte limits alone cannot detect sensitive information.

## Source-only storage limits

- **16 KiB UTF-8** per GPT-authored wiki page; oversized writes fail, never truncate.
- **5,000** GPT-created pages per workspace.
- **128** versions per auto-maintained wiki page; prior versions are not silently deleted.
- **8 MiB** combined UTF-8 text of active records and historical revisions, per workspace, by default. A trusted self-hosted operator may explicitly configure up to 1 GiB. Larger stores can exceed the present 25 MB snapshot limit and need a separately verified backup path.
- Identical captures remain idempotent. No automatic vector embeddings, media storage, analytics, trackers or bulk conversation copies.
- At a limit, writes fail atomically and existing wiki content remains unchanged. No background pruning or unapproved loss of history.

The trusted local CLI command \`npm run knowledge -- --db ./data/knowledge.sqlite stats personal\` reports pages, revisions and used/remaining logical text bytes. **This is not a disk-size limit**; SQLite/FTS indexes, records, metadata and WAL files take additional space. WAL auto-checkpoint target: 64 pages; journal size limit target: advisory 1 MiB, not a hard limit.

**Synthetic measurement, Node 22, November 5, 2026:** 100 fictional pages approximately 2.2 KiB each, with 10 revisions each (1,000 revisions): 2,446,400 logical UTF-8 body bytes and about 4.74 MB in the SQLite database after shutdown. Real usage varies.

## Protection boundary / deployment prohibited

Active SQLite records, FTS indexes, WAL and programmatic in-memory snapshots contain **plaintext**. Local CLI backup files are instead encrypted with scrypt-derived AES-256-GCM keys and authenticated tags. A 0600 file mode is not encryption or adequate protection from compromised machines, privileged operators or unlocked disks. A bare SHA-256 in-process checksum is not a security signature. Bearer share URLs can be accessed by anyone who knows the link.

Before using private data, require vetted encryption at rest for the live store, independently managed keys, tested encrypted restore, remote identity and access controls, rate-limiting/audit, safe TLS hosting and independent security verification. No live deployment or private Notion migration is authorized.
