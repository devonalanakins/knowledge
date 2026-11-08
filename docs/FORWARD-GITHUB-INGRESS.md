# Signed GitHub event ingress — isolated Knowledge capture

**Status: source-only, tested with fictional events. Not deployed, routed, or activated.**
**Date:** 2026-11-08
**Owner:** DevonStation Knowledge (AGPL-3.0-only, single existing repository).

## Intent and trust boundaries

This bounded increment makes the existing GitHub merge capture code reachable
through a separately deployable Cloudflare Worker, but does **not** grant the
webhook service access to the owner-only Knowledge Worker or its D1 database.

GitHub signed webhook (untrusted until verified)
  -> isolated ingress Worker (/github only, explicit opt-in)
  -> verify raw HMAC SHA-256 + event type + pinned repo name AND numeric repo ID
  -> minimal owner-approved, nonclinical, personal-scope receipt
  -> isolated dedicated D1 encrypted event inbox (not production Knowledge D1)
  -> eventual separately reviewed processor / scoped machine adapter
  -> private Knowledge owner page (future, requires exact readback)

The first four steps are implemented and synthetic tested. The processor and
scoped machine adapter have NOT been deployed or approved. No claim is made
that PR merges currently create Knowledge pages.

## Source and configuration

- src/worker-cloudflare-capture-ingress.mjs — Worker fetch handler.
- src/forward-github-capture.mjs — HMAC signature verification and approved
  repository identity and scope mapping.
- src/forward-capture-inbox.mjs — AES-256-GCM encrypted, HMAC-keyed, durable
  receipt ledger with deduplication, leases, retry, and safe conflict state.
- ops/private-forward/capture-inbox-v1.sql — apply to a newly isolated D1
  only; never apply to the existing owner Knowledge database.
- test/worker-cloudflare-capture-ingress.test.mjs — synthetic request and
  negative security tests (Node 22 and 24 CI).

**Expected environment bindings** (no real secret values in source):

| Binding | Purpose |
| --- | --- |
| CAPTURE_INGRESS_ACK | Must equal SIGNED_GITHUB_CAPTURE_INBOX_V1; omit until explicitly activated |
| CAPTURE_INGRESS_URL | Exact approved https:// host ending /github, with no query |
| CAPTURE_WEBHOOK_SECRET | At least 32 random bytes, shared ONLY with the approved GitHub webhook, stored as secret |
| CAPTURE_INBOX_ROOT_HEX | Separate 256-bit random encryption key in lowercase hex, secret; never the Knowledge owner key |
| CAPTURE_INBOX_KEY_ID | Stable identifier for the capture inbox key |
| CAPTURE_INBOX_DB | Dedicated D1 binding, never the existing knowledge-forward-private D1 |
| CAPTURE_REPOSITORIES_JSON | Explicit owner-reviewed map of repo name to immutable GitHub repository ID, scope and path prefix |

Example format for the allowlist (repo ID is public metadata; verify it again
at activation; never accept this field from the webhook as its own authority):

    {"devonalanakins/knowledge":{"repoId":1446728034,"scope":"personal","pathPrefix":"engineering/knowledge"}}

To authorize other repositories, explicitly review each owner's identity,
data classification, and Knowledge scope. This initial lane only supports
the owner-only nonclinical personal scope. No clinical, client, or cross-entity
source is permitted here.

## HTTP contract / safety

- POST to the exact canonical HTTPS /github URL only.
- Require application/json and raw uncompressed body bounded to 65,536 bytes.
- Verify X-Hub-Signature-256 against exact bytes before treating any JSON as
  trusted. Require the GitHub delivery header.
- A valid closed/merged PR from an allowlisted repo is encrypted and enqueued;
  return 202 with no body, even on duplicate. **202 means durable acceptance
  into the inbox, never that a Knowledge page was saved.**
- Other correctly signed GitHub events are ignored with 204.
- Missing/invalid HMAC: 401. Unauthorized repo ID/scope: 403.
  Missing activation, secret, bindings or failed storage: 503.
- All routes other than /github, and GET/HEAD on /github, return 404.
  No plaintext events, identity or Knowledge pages appear in HTTP responses.
- The Worker cannot invoke /mcp, cannot bypass Cloudflare Access, and cannot
  read or decrypt existing Knowledge pages or historical Notion sources.
- The intake Worker is NOT safe to deploy at the owner's protected Knowledge
  hostname: keep a wholly separate public-signature-verified endpoint.

## Deployment and release gates — not yet passed

1. Check exact-head Node 22/24 tests and inspect security-critical diff.
2. Provision a **separate** empty D1 instance and apply the inbox schema;
   confirm target database ID does not equal existing Knowledge D1.
3. Generate/store independent webhook HMAC and inbox encryption secrets
   outside GitHub and chat; separately secure recoverable inbox key custody.
4. Deploy a disabled isolated ingress Worker with NO default public hostname,
   routes, preview URL or GitHub hook. Verify configured environment and
   negative-access behavior before turning on anything public.
5. Explicitly authorize one narrow public webhook endpoint and its GitHub
   repo-specific delivery. Prefer API-owned setup using least privileges;
   the available GitHub connector might not support webhook registration.
6. Review the **machine identity + separate server-side auth scope** for
   writing to Knowledge. Never forge Cloudflare ctx.access or rely solely on
   an internal header to impersonate the owner.
7. Build a bounded processor, failure monitoring, retry/dead-letter interface
   and end-to-end isolated D1 tests through the authorized Knowledge path.
8. Test genuine live webhook delivery, event deduplication and exact
   Knowledge write/readback, then independently verify rollback.
9. Maintain current private records, owner root key, Access session, backups,
   the original Notion exports and read-only legacy source throughout.

**No deployment, GitHub webhook registration, D1 provisioning, key rotation,
public sharing, historic import or Notion disconnection is performed by this
source change.**
