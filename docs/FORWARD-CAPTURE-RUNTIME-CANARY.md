# Cloudflare capture runtime canary (fictional data ONLY)

**Status 2026-11-08:** source-only canary, gated and off by default.
The canary is an executable synthetic integration test, NOT a replacement
for the current owner Knowledge deployment and NOT proof of any real
GitHub event delivery.

## Required isolated account resources

1. An **empty, dedicated** canary owner D1 with the *existing* Knowledge
   owner schema from \`ops/private-forward/schema.sql\`. Do not repurpose
   production D1 (\`knowledge-forward-private\`) or the separate capture
   inbox database (\`knowledge-capture-inbox-private\`).
2. An empty isolated canary inbox D1 using
   \`ops/private-forward/capture-inbox-v1.sql\`.
3. A **private, nonpublic** canary Knowledge Worker with the optional
   \`KnowledgeCaptureEntrypoint\` named RPC, bound only to the canary
   owner D1, a synthetic owner identity and a throwaway owner key.
4. A separate **private, nonpublic** canary runner Worker using
   \`src/worker-cloudflare-capture-canary.mjs\`, bound only to the canary
   inbox D1 and the named canary Knowledge service binding.
5. Random **test-only** keys: one webhook HMAC, one inbox encryption key,
   one independent machine authentication key and one synthetic owner
   D1 encryption key. None may be an actual owner/production secret or
   a copy of a root recovery key.

The canary deliberately creates an internally signed **fictional** closed
PR-merge event, with an immutable non-sensitive repository ID and a
reserved 900000 PR number under \`acceptance/github-canary/pr-900000\`.
Its test source URL is illustrative evidence only. Do not present it as
proof of a real GitHub merge.

## Activation and execution gates

- The canary Worker must carry the explicit
  \`CAPTURE_CANARY_ACK=FICTIONAL_RUNTIME_CANARY_V1\` opt-in and only
  support one exact allowlist entry:
  \`devonalanakins/knowledge\` with repository ID \`1446728034\`,
  personal scope and \`acceptance/github-canary\` prefix.
- It must also carry \`CAPTURE_INGRESS_ACK\`, \`CAPTURE_PROCESSOR_ACK\`
  and independent private test-only keys in its environment.
- The fictional destination must have the narrow machine capture
  ACK/prefix/repo identity and the same test-only machine key.
- No \`routes\`, public \`workers.dev\`, previews, or exposed URL
  for either Worker. No owner Access bypass for normal HTTP routes.
- A dedicated **temporary** 1-minute canary Cron may run once for
  acceptance. Remove the schedule after confirming the result;
  no permanent recurring canary is required.
- Confirm the encrypted canary inbox contains one \`saved\` event,
  the canary owner D1 contains one page and one immutable revision,
  and a repeated run produces no additional revision.
- Test failure and denied paths with intentionally invalid machine
  key and incomplete configuration, then reset only test credentials.
- Review Cloudflare service binding names and inherited bindings;
  never upload a version that has unexpectedly dropped a required
  binding. Verify the live owner Worker remains at its known-good
  version before and after the test.

## Limits

A passing test proves only that a Cloudflare Worker runtime can use
the tested signing code, D1 encryption, named RPC and encrypted owner
write/readback path with fictional data. It does **not** prove:
production GitHub webhook installation, private ChatGPT capture tool
registration, owner-key independent disaster recovery, complete
Notion historical migration, multi-workspace authorization, sharing,
desktop/mobile acceptance, or formal retirement.

A failed attempt is not a successful capture; preserve the failure
reason and mark \`PENDING KNOWLEDGE / UNSAVED\`. Do not log secrets,
fictional payloads, ciphertext or private owner data.

Remove only the temporary canary Cron after it has run; preserve the
test evidence and do not delete D1s or source records without a
separately reviewed cleanup authorization.


## Independently observed Cloudflare canary acceptance — 2026-11-08

**PASS, scoped strictly to one fictional source event.**
Exact GitHub source at the time: `f8cb392674e6e924c7305c617d04cee89ed58814`
(PR #37), Node 22 / Node 24 and isolated-vault CI successful.
The later README-only merge did not change runtime code.

**Provider evidence:**
- Runner canary Worker `knowledge-capture-canary-runner`: source version
  `7c1795e0-1c33-4aea-b7a4-e115a88cc9b2`, deployed at 100% with
  public subdomain and previews disabled. Owner canary Worker
  `knowledge-capture-canary-owner`: source version
  `766a2c10-28e6-4ce7-8ed8-d3053019dcb9`, likewise nonpublic.
- The runner held a named service binding to
  `KnowledgeCaptureEntrypoint` on the canary owner Worker. Binding
  resource names, synthetic repository ID/prefix, scoped activation values
  and secret *types* were inspected without revealing secret contents.
- A temporary Cron `* * * * *` generated one synthetic signed GitHub
  event with no actual source PR. The isolated encrypted D1 inbox
  `knowledge-capture-canary-inbox` received one row at
  `2026-11-08T15:22:02.857Z` and advanced to `saved` by
  `2026-11-08T15:22:03.158Z`, with **attempts=1, last_error=null**.
- Independently queried isolated owner D1
  `knowledge-capture-canary-owner` and observed exactly one instance
  marker, **one encrypted page and one revision**, version 1. A SQL join
  on the current page and immutable revision verified matching path key,
  version and sealed ciphertext for the single record. No private
  plaintext, root key, ciphertext, event body or sensitive credentials
  were output in provider logs or the engineering checkpoint.
- After this observation, the temporary Cron was removed with an empty
  schedule verified via Cloudflare's provider API.
- The *actual* production `knowledge-forward-private` Worker remained
  on `bf1ea505-df98-4e77-ab30-92ba4610f7f7` (100%); its independent
  D1 inventory remained one instance, three encrypted pages and eight
  revisions. The real capture ingress and processor remain nonpublic
  placeholders and do **not** ingest GitHub events in production.

**What this establishes:** the synthetic payload was HMAC-signed and
processed through real Cloudflare Workers/D1 and a narrow named internal
service binding. The internal receiver reported a verified save and
the independent ciphertext/revision inventory confirmed persistence.

**What it does not establish:** a real GitHub webhook, production
permissions or source capture, independent backup decryption, repeat
provider-level dedupe/recovery, final historical migration or Notion
retirement. Those acceptance gates remain explicitly **NO-GO**.

No source archive, production owner encryption/recovery key, clinical
record, customer account, sharing rule or Notion record was changed.
