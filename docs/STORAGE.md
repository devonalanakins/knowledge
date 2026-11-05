# Knowledge lightweight storage and privacy policy

**Scope:** text-first, GPT-maintained private wiki. Do not copy raw chats, complete transcripts, images, PDFs, attachments or media. Link to separately authorized source material. Byte limits alone cannot detect sensitive information.

## Source-only storage limits

- **16 KiB UTF-8** per GPT-authored wiki page; oversized writes fail, never truncate.
- **5,000** GPT-created pages per workspace.
- **128** versions per auto-maintained wiki page; prior versions are not silently deleted.
- **64 MiB** combined UTF-8 text of active records and historical revisions, per workspace, by default. A trusted self-hosted operator may explicitly configure up to 1 GiB. Ordinary manual records and restores also respect the text budget.
- Identical captures remain idempotent. No automatic vector embeddings, media storage, analytics, trackers or bulk conversation copies.
- At a limit, writes fail atomically and the existing wiki remains unchanged. No background pruning or unapproved loss of history.

The local trusted CLI command `npm run knowledge -- --db ./data/knowledge.sqlite stats personal` reports pages, revisions, used and remaining logical text bytes. **This does not cap or accurately measure physical disk usage**; SQLite/FTS indexes, records, metadata and WAL files occupy additional space. WAL auto-checkpoint target: 64 pages; journal size limit advisory target: 1 MiB, not a hard cap.

**Synthetic measurement (Node 22, November 5, 2026):** 100 fictional pages around 2.2 KiB each, each with 10 revisions (1,000 revisions): 2,446,400 logical UTF-8 text bytes and about 4.74 MB in the SQLite database after shutdown. Actual usage varies by content and indexing.

## Privacy limitations: private production remains blocked

Records, FTS indexes, WAL data and JSON snapshots are **plaintext** in the current source. File mode 0600 is not encryption or protection against compromised machines, privileged host operators or unlocked disks. SHA-256 archive checksums provide neither encryption nor authentication. Public share URLs are bearer credentials visible to anyone with the link.

Before real private data, require vetted at-rest encryption and independent key management, encrypted/verified backups and tested recovery, remote OAuth/identity, audited least-privilege sharing and revocation, TLS/network protections, abuse/rate limits and independent security tests. No production deployment or private Notion data migration is authorized.
