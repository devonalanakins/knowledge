# Knowledge capture — isolated scheduled receipt processor

**Status 2026-11-08: SOURCE IMPLEMENTED / SYNTHETIC VERIFICATION ONLY.**
No producer, processor, service binding or additional D1 has been
activated in production. The existing owner Knowledge Worker remains
unchanged, as do its Access identity, root key and personal records.

## Exact runtime components

1. src/worker-cloudflare-capture-ingress.mjs accepts a signed GitHub
   closed/merged event with a pinned repository ID and enqueues it as a
   minimal encrypted receipt in a separate capture D1 instance.
2. src/worker-cloudflare-capture-processor.mjs runs only on explicit
   five-minute Cloudflare Cron Trigger (*/5 * * * *). Its HTTP fetch
   handler returns 404 unconditionally. It claims at most 10 due
   encrypted receipts per invocation from D1, decrypting them only
   in the private processor.
3. The processor signs the canonical receipt with an independent
   HMAC machine key and calls the named, nonpublic
   KnowledgeCaptureEntrypoint.saveMergeReceipt through an explicitly
   configured same-account Cloudflare service binding.
4. The owner Worker verifies the separate machine proof and exact
   canonical scope, reads current encrypted record, uses expected-
   version transaction to create a draft only when absent, and
   performs an independent decrypted D1 readback before returning
   SAVED/verified. A duplicate is SAVED/unchanged. Different owner
   content is BLOCKED and never overwritten.
5. The processor updates its encrypted ledger with a lease-specific
   compare-and-set. Transport failure, stale credentials, invalid
   replies and failed readback remain PENDING_KNOWLEDGE_UNSAVED.
   The existing bounded exponential retry and dead-letter behavior
   are retained. No producer event is declared saved merely because
   it was accepted by the webhook endpoint.

## Zero production-access shortcut

The processor has NO owner Access email, Cloudflare Access impersonation,
owner Knowledge data-encryption key, webhook signing secret, or public
record-read endpoint. The ingress Worker has NO processor machine key,
service binding, or owner private data access. The machine key is held
only by the processor and the existing owner Worker when their separate
release gates are explicitly enabled.

Cloudflare does not forward ctx.access over service bindings:
https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
This integration uses named WorkerEntrypoint RPC, a separate machine
key and narrow canonical receipt policy rather than trusting headers.

## Source configuration for a future isolated release

Processor Worker binding names:

- CAPTURE_PROCESSOR_ACK = OWNER_ONLY_SIGNED_MERGE_PROCESSOR_V1
- CAPTURE_INBOX_DB = dedicated capture D1 (never production Knowledge D1)
- CAPTURE_INBOX_ROOT_HEX = independent inbox ciphertext key (same
  as intake Worker; never owner root key)
- CAPTURE_INBOX_KEY_ID = stable encrypted-inbox key identifier
- CAPTURE_MACHINE_AUTH_KEY_HEX = dedicated 256-bit HMAC key
- KNOWLEDGE_CAPTURE_WRITER = same-account service binding to the
  existing knowledge-forward-private Worker, named entrypoint
  KnowledgeCaptureEntrypoint (not default)
- Cron schedule: */5 * * * * (UTC).

Do not bind webhook secrets or owner-key recovery material to the
processor. Do not route the processor as a publicly reachable API.
No Cloudflare service bindings or secrets are actually configured by
this repository change.

## Release / privacy gates

1. Observe Node 22 and Node 24 exact-head CI, fake D1 synthetic end-to-end,
   wrong-owner, version, broken service, retry and tamper tests.
2. Independently review the deployed owner Worker main-module switch,
   named-entrypoint RPC behavior, least-privilege service binding,
   origin Access preservation and full encrypted-record backup/rollback.
3. Provision a separately named capture D1, restricted Worker secrets,
   and explicit service binding only after confirming account, identity,
   cost and resource inventories. Never migrate existing Knowledge data
   into the event D1.
4. Run an isolated real Cloudflare test with fictional PR events,
   failure injection and verified readback. Confirm event-source
   disablement and service-binding revocation work.
5. Register the GitHub webhook only for explicitly approved repositories
   with verified immutable IDs. Reconcile any missing connector support
   before activating public webhook delivery.
6. Test actual owner-authenticated mobile and desktop paths separately
   from machine capture.
7. Re-run a verified backup and independent owner-key restore before
   any significant production permissions or data changes.
8. Never claim Knowledge automatic capture LIVE until an actual signed
   provider event causes a verified private D1 record with readback
   and duplicate/retry protection.

This is a nonclinical forward-only capability. It does not import
historical Notion records, create workspace roles, authorize client
data, open public sharing or approve Notion disconnection.
