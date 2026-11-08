# Knowledge capture — isolated scheduled receipt processor

**Status 2026-11-08: SOURCE IMPLEMENTED / SYNTHETIC VERIFICATION ONLY.**
No producer, processor, service binding or additional D1 has been
activated in production. The existing owner Knowledge Worker remains
unchanged, as do its Access identity, root key and personal records.

## Exact runtime components

1. src/worker-cloudflare-capture-ingress.mjs validates the Actions
   HMAC and pinned repository identity, then independently confirms the
   exact closed+merged main-branch PR, SHA and time through GitHub's
   public REST API. Only a confirmed source event is enqueued as a
   minimal encrypted receipt in the separate capture D1 instance.
   GitHub mismatches and outages write NOTHING and cannot claim queued.
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

## Optional GitHub Actions delivery (not activated)

[Opt-in GitHub Actions merge delivery](FORWARD-GITHUB-ACTIONS-DELIVERY.md)
uses a trusted `main`-branch push workflow to verify the merge
commit's PR association through the GitHub API, then signs a minimal
allowlisted merge receipt with an independent Actions secret.
The internal HMAC is **Actions-generated**, not a native GitHub webhook.
The job is disabled until an explicit owner approval variable is set,
has only read-only GitHub token permissions for commit/PR lookup, and
never checks out or executes PR code. The older privileged
`pull_request_target` approach is superseded.

The workflow currently changes **source only**. Cloudflare ingress and
processor are still nonpublic placeholders in production. No Actions
secret, endpoint variable, activation flag, or real GitHub event
acceptance was provisioned by the source release. Do not claim live
capture from a green test or a merged workflow.

## Fictional canary and real-source verification boundary

The dedicated `worker-cloudflare-capture-canary.mjs` exists only for
synthetic scheduled runtime checks against fictional isolated data.
Because PR #900000 is not a real merged GitHub PR, the canary now
validates its own signed synthetic receipt and inserts it directly
through the encrypted inbox helper. The public ingress **does not**
provide a fictional bypass: real `POST /github` processing always
requires the independent GitHub source check. The canary remains proof
of encrypted queue/processor/RPC/readback mechanics only, and must not
be described as a real webhook or GitHub source verification.

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
