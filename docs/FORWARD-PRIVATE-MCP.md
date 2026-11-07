# Knowledge Forward Private MCP — first operational lane

**Owner directive (November 7, 2026):** Start capturing future work in Knowledge without waiting for flawless Notion history. Notion stays read-only; existing exports are preserved.

**State:** IMPLEMENTED SOURCE / SYNTHETIC TESTS ONLY / NOT HOSTED / NOT LINKED TO CHATGPT / NOT APPROVED FOR REAL PRIVATE OR CLINICAL RECORDS.

## Architecture

The original Node/SQLite wiki and Notion archive remain separate. The new source module, src/worker-cloudflare-private.mjs, is a fresh-record-only Cloudflare Worker backed by a dedicated D1 database with the schema in ops/private-forward/schema.sql. This is an additional small, self-hostable and open-source lane, not a replacement of the original sources or a public wiki.

One legal/data owner per deployment and per database. Do not share databases across personal/family, Cristy's professional operations, clients, DevonStation or ANEVUM.

## Security and data behavior

- Direct Cloudflare Access Worker invocation is mandatory. The Worker verifies ctx.access, pinned application audience and a single allowlisted owner email. It never trusts forwarded identity headers.
- Source content, wiki paths, titles, citations and revisions are AES-256-GCM encrypted before D1 storage; HMAC-indexed paths avoid plaintext path names in database indices. Independent HKDF subkeys are derived from one unique secret root key.
- A database instance marker binds the scope/key ID to the encryption key. A wrong key causes a hard failure rather than a silently empty wiki.
- Draft creation requires expectedVersion=0. Updates require an exact read revision, reject stale concurrent agents, preserve source URL if omitted, and write the new revision with the page update inside one D1 batch transaction.
- Four MCP tools are supported: knowledge_list, knowledge_search, knowledge_read and optional knowledge_capture_draft. No approval, publication, deletion, archive import or sharing operation exists. Draft write is disabled unless explicitly enabled.
- Hard initial limits: 500 pages per deployment, 128 versions per page, 16 KiB UTF-8 body, 32 KiB request, and bounded list/search scan. Search decrypts on the trusted Worker and does not scale like FTS; improve that before expanding capacity.
- No real Notion export, user data or secrets are present in repository source or synthetic tests.

## Operator-only configuration

All variables below belong to the isolated protected Worker environment. No actual credentials, private addresses, tokens, database IDs or secrets belong in GitHub, chat or CI.

| Name | Purpose |
| --- | --- |
| KNOWLEDGE_DB | New, private and isolated D1 binding |
| KNOWLEDGE_PRIVATE_WORKER_ACK | Exact value OWNER_ONLY_DRAFTS_NO_IMPORT |
| KNOWLEDGE_PRIVATE_WRITE_ACK | Exact value DRAFT_CAPTURE_ALLOWED to enable writing; omit for read-only |
| KNOWLEDGE_WORKER_RESOURCE | Exact canonical HTTPS URL ending /mcp behind direct Access protection |
| KNOWLEDGE_SPACE | One reviewed scope, e.g. personal |
| KNOWLEDGE_ACCESS_AUD | Actual Cloudflare Access application audience |
| KNOWLEDGE_ACCESS_EMAIL | Pinned lowercase owner Access identity |
| KNOWLEDGE_DATA_KEY | Secret: unique random 32-byte root key expressed as 64 lowercase hex digits |
| KNOWLEDGE_KEY_ID | Stable identifier e.g. v1; changes require a reviewed key migration |

The key in the tests is synthetic and must never be reused. Securely back up actual encryption keys independently from the encrypted D1 backups. Losing a key loses access to records; do not assume provider-managed D1 encryption is sufficient to recover application ciphertext.

## Release and cutover gates

1. Review Worker crypto, D1 schema, versioning, scope checks, failure handling and current Cloudflare runtime compatibility. Run the repository checks and synthetic negative/positive tests.
2. Provision new isolated D1 and a dedicated Access-protected Worker with no source data. Verify all Workers routes, previews and generated hostnames either require genuine Access or fail closed.
3. Exercise actual owner authentication and wrong-user refusal on Cloudflare, including blocked identity-header forgery.
4. Confirm persistent write, readback, revision CAS conflicts, search, revocation, failure recovery and no plaintext persistence, using **fictional data only**.
5. Confirm a genuine ChatGPT remote MCP OAuth connection and permissioned draft capture, then read the exact new revision in a fresh conversation.
6. Verify an independent encrypted D1 backup and restore using a securely retained key, per-scope isolation, safe mobile/desktop access, and recovery/rollback. Only then allow routine nonclinical owner recordkeeping.
7. Keep clinical/client material out of this deployment absent separate entity-specific data governance and compliance review.

Do not disconnect Notion, automatically merge historical archives, delete originals, or publish private records just because synthetic CI passes. The historical import remains a separate, reversible source-reconciliation operation; no older page may silently overwrite newer Knowledge drafts.

**Source references:** https://developers.cloudflare.com/workers/configuration/cloudflare-access/ and https://developers.cloudflare.com/d1/worker-api/d1-database/ .
