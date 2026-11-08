# Private forward library pagination

Source-only increment after the foundation consolidation. No deployment, schema
mutation, permission expansion, import or increased write quota is included.

`knowledge_list` accepts the existing optional `limit` (1–100, default 50) and
an optional `cursor` from its preceding response. It returns page summaries,
the existing key attestation, and `nextCursor` (null when exhausted). Calls
without a cursor remain compatible. The browser's existing opt-in `/wiki`
route uses the same reader and follows an escaped next-page link.

The reader uses the existing primary index:

```sql
SELECT path_key,version,sealed FROM knowledge_pages
WHERE path_key > ? ORDER BY path_key LIMIT ?
```

At most `limit + 1` rows are returned; only `limit` records are decrypted and
HMAC-checked. No OFFSET scan, whole-library decryption or extra plaintext
index is used. Traversal order is the opaque path index; titles are sorted
within each browser batch, not globally. This is live traversal, not an
export or consistent database snapshot. Edits to existing records do not move
their positions; new inserts behind a cursor require restarting the list.

Cursors expire after 24 hours. AES-256-GCM authenticates the position and
expiration under a separately HKDF-derived cursor key. Associated data binds
workspace and key identifier. A cursor cannot authorize a request: the same
Cloudflare Access audience and owner identity checks run first on every call.
No root key, page title, body or plaintext wiki path is present in the token.
Neither page encryption, path HMAC nor the instance marker format changes.

Synthetic integration tests traverse 3,312 fictional encrypted rows in 34
100-item requests, verify unique coverage, inspect SQLite's indexed query plan,
and check invalid cursors, wrong identities, ciphertext corruption and bounded
browser traversal. The large fixture is built directly in memory for reader
testing; it does not authorize production import or increased capacity.

## Remaining scale gates

The 500-page write limit stays enforced. Search still uses the old bounded
decrypt-all path; scheduled snapshots and offline recovery still have their
existing page/byte limits. Indexed private search, scalable coherent backups,
workspace grants, encrypted attachments and real provider-scale tests must pass
before raising capacity or importing historical material. Updating the deployed
MCP tool schema and enabling the browser require the separate release review.
