# Knowledge capture — nonpublic machine writer boundary

**Status (November 8, 2026): SOURCE-ONLY; OFF BY DEFAULT.**
The existing production owner-access Worker is UNCHANGED. This file is the
release contract for a separately reviewed future service-binding deployment.

## Trust separation

GitHub webhook HMAC proves the raw event at the separately provisioned
public intake Worker. A distinct capture processor may decrypt only
already-verified, encrypted inbox events and call the owner Knowledge
Worker's **named, nonpublic service-binding RPC**.

The processor must not send a forged Cloudflare Access identity, an owner
bearer token, or the Knowledge encryption root key. Cloudflare explicitly
does not propagate ctx.access across service binding calls:
https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/

The design has two completely separate authentication channels:

1. Owner browser/MCP HTTP: same existing direct ctx.access identity, pinned
   Access audience, owner email, encrypted instance and private D1.
2. Machine capture RPC: explicit named service-binding permission PLUS a
   separately held HMAC secret, five-minute proof expiry, strict event
   reconstruction and personal nonclinical scope. No general reads or writes.

The opt-in RPC **only saves canonical draft GitHub merge receipts**. It
cannot approve, publish, share, delete, import history, write an arbitrary
page, or query content outside one exact prefix.

## Source modules

- src/forward-receipt-policy.mjs: one deterministic receipt renderer shared
  with signed webhook ingress; records exact source-event evidence, never
  unverified CI/deployment claims. Validates repo numeric ID, SHA, timestamp,
  PR number, path, title, body, source URL, classification and every field.
- src/forward-capture-machine-auth.mjs: dedicated 256-bit HMAC key with
  domain-separated message type and timestamp window. The key is NOT the
  owner root encryption key or the webhook signing key.
- src/worker-cloudflare-private.mjs:
  handlePrivateMergeCapture is a *non-HTTP* internal function, disabled by
  default. It verifies all machine scope and proof checks BEFORE D1 access,
  uses the existing transactional encrypted CAS writer, reconciles concurrent
  identical writes, blocks conflicting owner content, and independently
  reads back the exact encrypted record before returning SAVED.
- src/worker-cloudflare-private-rpc.mjs: an **alternate** Cloudflare module
  entrypoint. It preserves the existing default HTTP Worker and exports
  KnowledgeCaptureEntrypoint.saveMergeReceipt for a separately configured
  same-account service binding. This module must NOT be adopted as the
  deployed main module until release readiness is established.
- test/worker-cloudflare-private.test.mjs: synthetic positive and negative
  checks against the same isolated SQLite-backed D1 mock as the existing
  owner MCP and browser tests.

## Compile-only owner RPC gate (source only, 2026-11-09)

Before any production main-module switch, CI compiles the alternate
`src/worker-cloudflare-private-rpc.mjs` through Wrangler using
`ops/private-forward/wrangler.owner-rpc.dryrun.json`.
The manifest deliberately uses the different Worker name
`knowledge-owner-rpc-bundle-only`, disables workers.dev/preview URLs,
and declares no D1, Access, secrets, routes, Cron, or service binding.
The CI command is `wrangler deploy --dry-run --config ... --outdir ...`
with no Cloudflare credentials or upload. Automated checks confirm a
nonempty emitted JS bundle retaining `KnowledgeCaptureEntrypoint` and
`saveMergeReceipt` in addition to source-level shape checks.

A passing compilation confirms syntax/bundling only. It **does not** establish
owner HTTP/Access behavior in a deployed Worker, compatible runtime
identity, production secret/binding preservation, an authorized machine
writer, a service binding, live readback, or rollback rehearsal. Never
deploy this compile-only manifest or use it to replace the protected
`knowledge-forward-private` Worker.

## Future owner Worker bindings (not installed)

| Name | Required value |
| --- | --- |
| KNOWLEDGE_MACHINE_CAPTURE_ACK | APPROVED_PERSONAL_GITHUB_MERGE_V1 |
| KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX | Independent 256-bit secret, shared only with authorized processor |
| KNOWLEDGE_MACHINE_CAPTURE_REPO_ID | Exact independently checked positive GitHub repository ID |
| KNOWLEDGE_MACHINE_CAPTURE_REPO_NAME | Exact allowlisted owner/repository |
| KNOWLEDGE_MACHINE_CAPTURE_PREFIX | Owner-approved personal-scope page prefix, e.g. engineering/knowledge |

The authorized processor Worker must explicitly bind its service
to existing Worker knowledge-forward-private with
entrypoint KnowledgeCaptureEntrypoint. No public HTTP route is added.
No other Worker should be granted this binding or shared HMAC material.

## Intentional failure behavior

- Missing ACK, non-personal scope, fictional-only gate, disabled private
  writer, mismatched repository ID, altered title/body/source/path/status,
  wrong HMAC, stale proof or malformed source => FORBIDDEN, no D1 access.
- Existing different page at the exact path => BLOCKED; preserve it.
- Lost D1 access or failed write/readback => PENDING_KNOWLEDGE_UNSAVED.
- Identical existing receipt => SAVED / unchanged, no extra revision.
- New receipt => one encrypted draft, exact readback, SAVED only then.

Nothing here changes the existing owner Access policy. No clinical/client
source is supported. No direct public URL can invoke the named RPC method.

## Release gates (unfinished)

1. Exact-head Node 22/24 CI and independent code-integrity review.
2. Review actual deployment bundling of the alternate Cloudflare entrypoint
   and named service-binding permissions; ensure the original HTTP Worker
   still receives a genuine ctx.access for its owner routes.
3. Provision independent, recoverable machine-secret custody without
   exposing the key in GitHub, chat, logs or snapshots.
4. Build and test a bounded capture processor invoking saveMergeReceipt
   through the named service binding; verify genuine identity and scope
   denial, duplicates, redelivery, stale leases, errors and readback.
5. Rehearse in isolated synthetic D1 first and independently back up the
   original Knowledge production D1. Review rollback for any Worker
   main-module change before deploying.
6. Perform real authenticated owner desktop/mobile and automatic GitHub
   event acceptance; do not label this integration LIVE until both are
   observed.
7. Keep Notion read-only and do not touch historical source originals,
   clinical data, workspace permissions, sharing or retirement actions.
