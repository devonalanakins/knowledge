# Knowledge fictional-only write acceptance

**State:** source implementation, not normal Knowledge write approval. The existing owner-only Cloudflare Access and D1 separation must remain intact.

## Purpose

Test actual ChatGPT authenticated capture/update without risking personal, family, client or clinical data. The Worker advertises the normal `knowledge_capture_draft` MCP tool only when explicitly enabled for testing, and rejects all content except one fixed fictional page with exactly two permitted versions.

## Cloudflare configuration for acceptance

After code CI and binding-preserving reviewed deployment:

- **Do NOT set** `KNOWLEDGE_PRIVATE_WRITE_ACK` during acceptance.
- Set secret `KNOWLEDGE_ACCEPTANCE_ONLY_ACK` to the exact value `FICTIONAL_WRITE_ONLY_NO_PRIVATE_DATA`.
- With this secret absent, the Worker remains read-only. With both acceptance and unrestricted write ACK present, the Worker refuses to serve requests.
- No production record migration, imported Notion content, user pages or real-world identifiers are authorized by the fictional-only setting.

## One fictional record, two controlled versions

Exact wiki path: `acceptance/fictional-draft`

Exact title: `Fictional Knowledge Acceptance Test`

Body for create, `expectedVersion: 0`:

```text
Fictional acceptance record: phase one. No real personal, client, or business information.
```

Body for update, `expectedVersion: 1`:

```text
Fictional acceptance record: phase two. No real personal, client, or business information.
```

No `sourceUrl` field or null only. All other inputs, paths, source URLs, and revisions beyond the two phases are rejected. An attempted stale create after version 2 should report `VERSION_CONFLICT`.

## End-to-end acceptance

1. Connect to the private **DevonStation Knowledge** MCP server using the already-authorized owner account. Refresh the plugin's tool inventory or start a new chat if `knowledge_capture_draft` is not yet exposed.
2. Capture the exact phase-one fictional record, verify `created` and `version: 1`, and independently read its exact body/path.
3. Update to phase two using `expectedVersion: 1`, verify `updated` and `version: 2`, search and read the exact current revision, then verify a stale update is rejected without changing it.
4. Query D1 provider metadata: instance = 1, pages = 1, revisions = 2. Confirm ciphertext in D1 does not contain the fictional title/body or path plaintext. Owner-only Access must remain enforced.
5. Capture **ciphertext-only D1 rows** and immutable revision history into the private backup bucket, verify the backup hash, and restore to a separate test database. Use the **owner-recovered key** to prove restored content can be decrypted; do not expose the root secret in chat, GitHub, or provider logs.
6. Remove the acceptance-only secret to return to read-only, or separate appropriately reviewed production gates must be met before normal nonclinical records. Notion remains read-only until independently approved retirement.

## Scope

This acceptance mode never allows arbitrary data capture. It does NOT provide automated backups, off-provider disaster recovery, clinical-grade compliance, sharing, full migration import, or general production writer permission. The earlier fictional R2 restore used a synthetic key and is not a substitute for this real-key recovery test.

The implementation in `src/worker-cloudflare-private.mjs` must be verified by CI and deployment-specific tests. Do not enable arbitrary draft writing just because this gate passes.
