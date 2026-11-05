# Knowledge: assistant-maintained wiki architecture

**Founder scope correction, 2026-11-05:** Knowledge is not a Notion clone or a manual documentation editor. It is a private knowledge capture and read/share surface for an authorized assistant. GPT will synthesize source-grounded pages, assign wiki paths, revise changed entries and support retrieval. Devon primarily browses, searches and explicitly approves sharing.

```text
GPT (future authorized connector)  [NOT CONNECTED]
         | Scoped HTTPS/machine auth [NOT DEPLOYED]
Agent capture/read API             [LOCAL PREVIEW]
         | draft-only writes
Knowledge SQLite store            [LOCAL TESTED]
   | versioned wiki path mapping
   | FTS5 search, historical revisions
   | explicitly shared pinned snapshots
Private browser wiki / share view [LOCAL TESTED]
```

A workspace partitions data but does not grant roles or authorize real client tenancy. This local build hosts precisely one configured workspace and binds to loopback by default. An eventual trusted identity provider and strict scope checks are required for hosting. No patient, clinical or confidential customer data is permitted in the preview.

## Capture contract

`POST /api/v1/capture` accepts only `path`, `title`, `body` and optional `sourceUrl`. Path is a stable, 1-8 segment lowercase wiki route. Each capture generates an article in `draft` state. Repeating identical content does not change its version; content changes append an immutable revision. Omitting `sourceUrl` during an update preserves the existing provenance; an explicit `null` clears it for draft content. The agent cannot claim an authorized business decision by changing a status flag, and cannot replace a human-reviewed, non-draft page (`409 REVIEW_REQUIRED`). When evidence cannot be supplied, label uncertainty in the body.

## Reading and sharing

Owner browsing requires a secret-authenticated cookie; machine read requires bearer authorization. Markdown-like body text renders as escaped plain text/headers/bullets, not arbitrary HTML or script. Readers have no editing controls. Selective share creation requires a local owner CLI operation; the random capability URL is revocable and pins an exact historical revision, preventing later AI edits from disclosing newly added private content. Share tokens are excluded from exports and restored instances.

## Data and recovery

Relational tables: `spaces`, `records`, `revisions`, `links`, `wiki_pages`, `shared_pages` and `records_fts`. Foreign keys keep relations within a workspace, and revision triggers prohibit ordinary updates/deletes. SHA-256 export checks validate accidental corruption; they are not signed/encrypted backups. Restore is transactional and refuses an existing target workspace. The application is single-process, local SQLite; Cloudflare/D1, PostgreSQL and multi-node scale are out of scope for the first build.

## Next vertical slice

1. Independent ChatGPT MCP/OAuth adapter and confirmed cloud authentication, first tested against fictional content.
2. Wiki navigation improvements and source/backlink experience based on real use.
3. Explicit bounded Notion import and permission/fidelity/restore checks before any migration approval.

Never treat this design document as evidence of a deployed feature or an authorized private-data transfer.