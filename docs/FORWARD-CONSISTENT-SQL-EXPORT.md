# Knowledge — point-in-time D1 SQL export (source-only pilot)

**Status:** source-only; not deployed, scheduled or authorized to run against production. This is a separate, privileged backup path intended to complement the existing daily ciphertext-row backup Worker. It is **not** a verified owner-key recovery path or a reason to raise live write quotas.

## Why this separate path exists

The current cron Worker reads the three forward Knowledge tables in one D1 transaction and produces an authenticated-shape JSON row snapshot. That path is capped at **500 pages, 64,000 revisions and 25 MiB**. Paginating many independent D1 requests would not provide an equivalent single point-in-time snapshot while writes continue. The D1 Worker-binding \`dump()\` method is documented as **alpha-database-only**, so it is not a portable solution.

Cloudflare's supported D1 REST export API initiates a single provider-side SQL dump at a bookmark. Cloudflare documents that **export can lock the database and requires D1 Write API permission**. This is consequently a high-consequence, separately reviewed operational capability, not a change to the existing safe, read-only scheduled Worker.

References:
- https://developers.cloudflare.com/workflows/examples/backup-d1/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/d1/observability/debug-d1/#error-10000-and-token-permissions
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

## Implemented review surface

- \`src/forward-consistent-export.mjs\` — small, dependency-free Workflows engine. Explicit disabled-by-default ACK; exact account/database/scope/key ID; refuses bundled Knowledge root key or ordinary write ACK.
- \`src/worker-cloudflare-consistent-export.mjs\` — separate \`WorkflowEntrypoint\` class, with no public HTTP route. **No Wrangler deployment config, API token, workflow instance or schedule is installed by this PR.**
- \`test/forward-consistent-export.test.mjs\` — synthetic API/R2 streaming and fail-closed cases; no real secrets or provider mutations.
- Export API request explicitly filters \`knowledge_instance\`, \`knowledge_pages\`, \`knowledge_revisions\` with D1-compatible schema in SQL output. Existing derived search tables are intentionally excluded and must be rebuilt after independently verified restore. The SQL format is **different from the existing v1 JSON row snapshot**, so the v1 restore CLI must not be used for this file.
- Each start issues a **single** export request with no automatic retry; further steps poll the returned bookmark up to 20 times, sleeping between attempts. A changed bookmark, invalid API response or unapproved signed-download hostname is rejected. Signed URLs and API tokens are never returned in Workflow step outputs.
- The HTTP download must be HTTPS on an exact operator-pinned hostname and must have a known byte length between 1 and **512 MiB**. R2 requires known-length streams for single-object \`put()\`.
- Upload is conditional-create, uses a generated immutable key under \`consistent/<scope>/<keyId>/\`, never overwrites/deletes, and checks R2 readback size and SHA-256 using bounded streaming. No automatic retry follows an ambiguous completed upload, avoiding silent duplicate or overwrite claims. A successful receipt contains only scope, key ID, bookmark, object key, byte length and hash.
- There is no source decryption, user/owner key, Notion data, scheduled action, public sharing or rotation.

## Future deployment gates (all still NO-GO)

1. Independent security review and explicit owner authorization to create a **separate** Cloudflare Workflow/binding and to grant a narrowly scoped **D1 Write** export token for exactly the intended database. This is a privileged provider operation that can block normal queries; do not bind this token to the existing daily backup Worker.
2. Verify the actual Cloudflare signed-download hostname in an owner-controlled provider session. Set \`EXPORT_SIGNED_HOST\` to its exact hostname **without** copying the signed URL or query signature to Git, chat or logs. No default host is assumed.
3. Provision \`CONSISTENT_EXPORT_ACK=OWNER_REVIEWED_D1_EXPORT_V1\`, \`EXPORT_ACCOUNT_ID\`, \`EXPORT_DATABASE_ID\`, \`EXPORT_SCOPE\`, \`EXPORT_KEY_ID\`, \`EXPORT_SIGNED_HOST\`, \`EXPORT_D1_API_TOKEN\` as a secret, and a **private** \`EXPORT_BUCKET\` R2 binding. Use \`nodejs_compat\` for streaming \`node:crypto\` support. No \`KNOWLEDGE_DATA_KEY\` or unrestricted write ACK may be bound.
4. **Do not add a cron schedule** until a manual, owner-approved rehearsal succeeds on an isolated *fictional* D1 test database. Confirm an active export really produces a full SQL dump without leaking plaintext, keeps all immutable triggers and revisions, and finishes within provider/Workflow limits while the database is available again afterward.
5. Build the **separate owner-local SQL restore verifier**: import to isolated protected SQLite, validate exact reviewed schema, instance marker, revision chain, authenticated AES-GCM content with existing root key, and prove ciphertext equality/counts against an independent source inventory. This PR does not implement that verifier.
6. Download the immutable R2 SQL export privately, compare its SHA-256 to the Workflow receipt, copy to independently encrypted storage **outside Cloudflare**, then redo hash and owner-key restore without the provider. Explicit recovery acceptance is still required.
7. Establish capacity limits, export downtime budget, observable alerting, failure handling, retained multiple generations and encrypted attachment backup. Keep the existing 500-page live write restriction and the old backup Worker until the new end-to-end recovery is tested.

## Honest scope

A provider-generated coherent SQL export **helps remove the small row-snapshot limit** but has not yet verified that an actual D1 SQL export is complete, recoverable, correctly scoped or safely schedulable. Its R2 SHA proves that the stored bytes were read back consistently, **not** that every record or revision was authenticated or that the exported SQL is safe to execute. Never execute an unknown SQL dump in a trusted or live database. No clinical, family, client or Notion data is authorized. Notion remains read-only migration evidence and retirement remains NO-GO.
