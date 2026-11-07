# Knowledge encrypted-backup acceptance evidence — 2026-11-07

Status: **LIVE PROVIDER BACKUP/RESTORE SMOKE VERIFIED WITH FICTIONAL DATA.**
Not a verification of real owner-record recovery or off-provider disaster recovery.

## Resources (Cloudflare, private)

- Forward, real owner-empty D1: `knowledge-forward-private` — unchanged, read-only, owner key `owner-v1`.
- Backup bucket: `knowledge-forward-backups-private` — private R2, no custom domain, R2 managed public domain explicitly disabled.
- Fictional acceptance database: `knowledge-restore-smoke` — **separate D1**, never exposed through the owner Knowledge MCP plugin.

## Exact observed behavior

1. Existing owner-only Cloudflare Access and OAuth connection verified with ChatGPT `knowledge_list` / `knowledge_search`. A Worker-only read response returned `keyAttestation.keyId=owner-v1` and a SHA-256 fingerprint prefix matching the owner's independently created recovery key.
2. Prepared an encrypted synthetic draft payload using a **nonproduction synthetic key** and the same HKDF, HMAC path indexing, AES-256-GCM and AAD layout as the forward Worker.
3. Inserted only fictional encrypted rows into isolated `knowledge-restore-smoke`: one instance marker, one page and one immutable revision. The initial fixture had a separator-encoding mismatch, was discarded **only within the smoke database**, then recreated and authenticated successfully.
4. Serialized ciphertext-only rows to `synthetic-restore-20261107-v1.json` inside private R2 (1312 bytes), SHA-256 `1dc94c76fb98ceeb62b2f3ebc37b5d6e83a91e357b6a60328b021da38d58329f`. Downloaded it back through the Cloudflare R2 Object API; byte hash, schema shape and lack of source plaintext verified.
5. Dropped and recreated **only the test database tables**, restored the three row sets from that R2 object, and independently checked restored values/ciphertext unchanged, HMAC instance/path-key binding correct, and AES-GCM decryption of the fictional page successful. Restoration status: PASS.
6. Rechecked real forward D1: **zero pages, zero revisions, zero instance markers**. It was not written to at any stage.
7. Stored/read back `forward-live-empty-baseline-20261107.json` in private R2 (219 bytes), SHA-256 `24d1b223833bed4389aa90f2659b38ea5d0f2c69112cd782ac6e159bd708058f`. This is a byte-verified **empty baseline**, not a backup of any real Knowledge records.
8. Attempting Cloudflare D1's native SQL export previously completed its export job, but the provided signed SQL download returned HTTP 403 **because the current Cloudflare tool environment forbids requests to the temporary R2 host**. This environment restriction is not a D1 export failure. The tested alternative used the D1 API to select encrypted rows and the private R2 Object API to store/retrieve them.

## Explicitly unverified / not yet operational

- No encrypted snapshot of a **real owner-created Knowledge page** has been exported/restored/decrypted.
- The R2 bucket and D1 reside under the same Cloudflare account. This is **separate storage**, not independent off-provider/owner-held data disaster recovery. An owner-controlled export outside Cloudflare is still required.
- There is no scheduled snapshot, automatic backup trigger, retention policy, R2 immutable/versioned-copy governance or off-site rotation yet. A one-time manually tested API path must not be represented as continuous backup protection.
- `KNOWLEDGE_PRIVATE_WRITE_ACK` is absent. No real Knowledge draft write/edit or ChatGPT `knowledge_capture_draft` acceptance has been verified. Publishing, sharing, clinical/client data and Notion cleanup remain gated.
- Production failure/revocation and realistic restored-multiple-revisions scenarios still need acceptance testing.

## Next safe release slice

Implement and review a source-controlled, repeatable ciphertext-only D1 snapshot/restore workflow with scoped Cloudflare service credentials, retention policy, independent owner-held encrypted export, and fail-closed validation. Separately enable a **fictional-only owner-authorized draft capture test**, verify actual ChatGPT write/readback and conflict refusal, capture the ciphertext snapshot, and restore it using the matched owner key in an isolated environment. Only then consider limited nonclinical Knowledge recordkeeping.

Original Notion ZIPs remain protected. Notion stays read-only until separately approved retirement.
