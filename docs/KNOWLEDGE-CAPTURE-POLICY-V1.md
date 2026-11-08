# Knowledge Capture Policy v1 — GitHub merge receipts

**Status (2026-11-08): SOURCE IMPLEMENTED, NOT WIRED TO PRODUCTION.**
This document governs an opt-in integration in the existing Knowledge project.
It does **not** mean that GitHub automatically writes Knowledge records,
that ChatGPT can observe background conversations, or that Notion is retired.

## Authority and sources

1. **Eligible:** a pull-request merge authenticated by GitHub's
   X-Hub-Signature-256, from an explicitly allowlisted repository with a
   separately reviewed mapping to an **owner's nonclinical personal scope**.
2. **Ineligible:** casual conversation, proposals, unmerged PRs, PR titles or
   bodies that may include untrusted content, unapproved repositories,
   workspace-crossing payloads, patient/client data, or other sensitive scopes.
3. **Classification:** signed GitHub webhook evidence proves only that GitHub
   reported a PR as merged, with a merge SHA and timestamp. It does **not**
   independently verify CI, deployment, acceptance, privacy, or an owner's
   approval. The record must remain a draft.
4. **Retention:** one deterministic private path per allowlisted PR, with a
   minimal source URL, immutable merge event key, and no copied PR body,
   comments, author profile, or unnecessary third-party details.
5. **Existing records:** if a destination record differs, **do not overwrite**.
   Return PENDING_KNOWLEDGE_UNSAVED / EXISTING_RECORD_CONFLICT for review.
6. **Persistence:** read current state, write with expectedVersion=0 only when
   absent, and independently read back exact body, title, scope and version.
   Do not report SAVED when writeback or readback is unverified.
7. **Idempotency:** eventKey = github:pr-merge:<repository-id>:<pr-number>:<merge-sha>.
   Stable destination is <approved-prefix>/pr-<number>. Redelivery and
   retries must never add duplicate revisions. Conflicting SHA/content is
   reviewable evidence, not a reason to replace the original receipt.
8. **Privacy:** one owner-approved repository mapping to one isolated
   nonclinical scope. Mapping is configured outside event content. Do not
   enable clinical, clients or another entity's workspace on this lane.
9. **Rollback:** disabling the event source must not delete records or revision
   history. Any previously saved receipt remains subject to normal manual
   correction and source provenance.

## In-process library

- src/forward-github-capture.mjs:
  verifySignedGitHubMerge({body, headers, secret, repositories}) validates
  the signed raw payload, event type and source mapping.
- saveVerifiedGitHubMerge(candidate, adapter) performs a collision-safe
  create or return-existing operation using the authenticated Knowledge
  adapter's read and capture capabilities. It returns SAVED only after
  verified readback; otherwise PENDING_KNOWLEDGE_UNSAVED with a reason.
- test/forward-github-capture.test.mjs exercises signed events, invalid
  signatures, scope denial, duplicate events, version races, content
  collisions and unavailable storage with **fictional-only** fixtures.

The save helper is **not** an authorization boundary on its own: only a
trusted host that passes the just-verified candidate and protects access
to the adapter may call it. No public route or secrets are defined here.

## Production wiring / reliability gate (NOT IMPLEMENTED)

Before enabling a real GitHub source, implement and independently verify:

1. A separate authenticated webhook ingress that verifies GitHub's raw-body
   signature **before** deserializing or trusting event metadata.
2. Secret custody outside source and logs; explicit repo IDs, permissions,
   destination scope, event source disable controls and revocation.
3. A **durable encrypted delivery inbox**. Persist delivery ID, event key,
   processing state (received / pending / saved / blocked), attempt count,
   next retry time, and bounded error class. Redelivery and retries are
   deduplicated across Worker restarts. No plaintext source payload in D1.
4. A secure, least-privilege path from the ingress to the owner-authenticated
   Knowledge deployment. **Do not bypass ctx.access** or expose the existing
   private /mcp endpoint for unauthenticated webhooks. Use a separately
   reviewed service identity and server-enforced scope.
5. Bounded retries with backoff, recovery after transient faults, observable
   dead-letter/manual review, safe replay, and proof no successful writes are
   retried into duplicate revisions.
6. End-to-end tests against an **isolated D1** using a synthetic webhook and
   a test-only signing key, followed by negative tests for alternate owners,
   forged forwarded identities, private search, quota and key mismatch.
7. Deployment and live acceptance only after exact-head CI, permission review,
   backup/recovery verification, owner approval for event-source activation,
   and a real owner-visible receipt. Do not emit webhook bodies or secrets in
   tests, metrics or public GitHub logs.

## ChatGPT and other event sources

Ordinary ChatGPT sessions do not supply a documented universal background
conversation event stream. During a supported authorized session, call
Knowledge directly: search/read owning page; compare established vs proposed
facts; use expectedVersion for permitted draft changes; read back and verify.
A session ending or Memory update is not a Knowledge save.

Until a trusted connector exposes general nonclinical draft capture in its
registered tool schema, only the controlled fictional acceptance operation
is available through that **registered** capture action. Do not misuse it
for production decisions even if the backend could accept them.

**Sensitive changes:** explicit review for protected third-party, cross-scope,
client or clinical information. No default retention. No Notion writes.
