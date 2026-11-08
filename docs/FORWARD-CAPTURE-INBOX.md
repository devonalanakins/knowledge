# Forward Knowledge capture inbox — encrypted delivery reliability

**2026-11-08 source implementation. NOT deployed or activated in production.**

The existing signed GitHub merge parser hands a verified nonclinical owner-scope
candidate to src/forward-capture-inbox.mjs. The inbox seals that minimal
candidate with AES-256-GCM and a SEPARATE 256-bit inbox secret, stores an opaque
HMAC-indexed delivery key in a dedicated D1 ledger, and tracks
queued / leased / saved / blocked / failed states.

This is NOT a live webhook, scheduled processor, Cloudflare service binding,
ChatGPT background listener or new workspace authorization.

## Source-level controls

- Only a live in-memory result from the signed GitHub merge verifier may be
  enqueued. Forged or serialized copies are rejected.
- Only minimal encrypted receipt content is stored, NOT PR titles, bodies,
  comments, profiles or raw incoming webhook bodies.
- Deduplication uses the signed event's stable semantic ID, indexed by keyed
  HMAC, with INSERT-on-conflict no-op. Retries never reset past failures.
- Optimistic, time-limited leases support safe recovery after worker restarts.
  Stale lease holders cannot acknowledge a newer worker's delivery.
- Knowledge capture uses a supplied authenticated, correctly scoped
  read/capture adapter. It reads existing records first, writes with
  expectedVersion=0, and requires exact authenticated readback before SAVED.
- Distinct existing content becomes BLOCKED rather than overwritten.
- Transient read/write/readback errors stay PENDING_KNOWLEDGE_UNSAVED with
  exponential retry from 10 seconds up to 1 hour; after eight failures the
  delivery is FAILED until an explicit operator retry.
- Status listing excludes ciphertext and source content. Operator retry API
  requires host-side owner-only authentication; this module provides none.
- Bad keys, corrupted ciphertext, and mismatched scopes fail closed.

## Storage and secrets

SQL: ops/private-forward/capture-inbox-v1.sql.
Use a NEW isolated D1 instance for capture events. Do not modify or migrate
the existing production Knowledge D1. Keep the inbox key private, separate
from the Knowledge owner key and safely backed up. Do not expose it through
GitHub, chats or public logs.

## Still required before production activation

1. Authenticated GitHub webhook ingress and explicit repo ID allowlist.
2. Reviewed machine-to-Knowledge scoped identity and service binding without
   bypassing owner Access via untrusted headers.
3. Isolated inbox D1, private secrets, scheduled/event processor, secure
   operator telemetry and retry UI, alerts and safe rollback.
4. End-to-end provider tests of signature denial, delivery, dedupe, failed
   save, replay, scope denial, recovery and verified Knowledge readback.
5. Source deployment and event source enablement after exact-head CI and
   security review; activation is not implied by this code's merge.

Notion remains read-only, and no public sharing, private migration or
clinical/cross-workspace capture is authorized by this change.
