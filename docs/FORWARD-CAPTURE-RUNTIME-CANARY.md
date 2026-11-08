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
