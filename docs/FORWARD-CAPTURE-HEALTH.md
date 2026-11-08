# Knowledge capture inbox — private aggregate health

**Status:** source-only until owner-controlled runtime acceptance. No production
permissions, scheduled task, public route, or connection is added by this change.

The private capture inbox is not itself a Knowledge wiki. A queued signed merge
event is **not** a saved Knowledge record. The ledger records whether the
narrow internal writer returned a verified-save result; individual records
still require independent authenticated Knowledge readback for full acceptance.

## Owner-only operation

Run the read-only health check from a trusted owner-controlled environment:

    npm run capture:health

The following private host environment configuration is required:

- `KNOWLEDGE_CAPTURE_HEALTH_ACK=OWNER_PRIVATE_AGGREGATES_ONLY_V1`
- `CLOUDFLARE_API_TOKEN` — trusted restricted D1 query token from secret custody
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account identifier
- `KNOWLEDGE_CAPTURE_INBOX_DATABASE_ID` — **separate capture inbox D1**, not the
  owner Knowledge D1.

Only a fixed aggregate SELECT query is sent. D1's HTTP query interface uses
POST even for reads; the operation does not write data. The result contains
**counts and status only**. It never queries `sealed`, `delivery_key`,
source text, receipt URLs, event IDs, owner keys, or private wiki content.
No generic arbitrary-SQL interface is offered.

The command returns exit status 0 for `NO_EVENTS`, `IN_PROGRESS`,
or `LEDGER_SAVED_ONLY`; exit status 2 for `ATTENTION_REQUIRED`; exit
status 1 for configuration, unavailable provider, or malformed response.
Notably, `NO_EVENTS` is not proof of an enabled real GitHub integration,
and `LEDGER_SAVED_ONLY` is not independent owner-record readback.

A queued item whose `next_at` is more than 30 minutes overdue, or a
leased item whose lease expiration was more than 2 minutes ago, requires
attention. Any blocked or failed item requires attention immediately.
No read status or failure detail is equated with a successful capture.

## Privacy and risk gates

- Use this **only** with a reviewed, owner-controlled D1 query credential.
  The Cloudflare D1 query API may grant more privilege than this client's
  fixed query uses. Do not widen a production credential just to run it.
  If an appropriately scoped credential cannot be provisioned, leave this
  tool unconnected and mark live health monitoring **BLOCKED**.
- The CLI is not an endpoint. Do not put the token into GitHub Actions
  or external logs, and never return raw provider responses on errors.
- The check is not scheduled. Owner notification and automatic retries
  require separate authorization and real negative acceptance evidence.
- `retryCapture` remains a distinct explicit operator action in the
  existing encrypted inbox code; this check never retries or discards.
- This does not enable external webhook capture, cross-workspace writes,
  private sharing, clinical information, historical Notion migration or
  Notion retirement.

## Acceptance

Synthetic tests cover normal and empty states, staleness boundaries,
blocked/failed states, duplicate and unknown groups, malformed timestamps,
unavailable provider, malformed responses, and absence of private
event identifiers and ciphertext in report data. A real read-only D1
aggregate query is the separate live acceptance gate.
