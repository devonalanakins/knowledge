# Knowledge — private release preflight (read-only)

**Status:** Source implementation, not a production deployment or an authorization to use private data.

This Node 22+ preflight verifies security and identity properties of an existing owner-protected Knowledge Worker. It performs **GET only**, has no Cloudflare provider write capabilities, does not register service workers, and does not create or mutate records. It cannot independently approve a release.

## Scope

Anonymous GET checks: `/wiki`, `/wiki/explore`, `/wiki/manifest.webmanifest`, `/wiki/icon.svg`, and the fictional `/wiki/download/acceptance/fictional-draft` route. Each must return HTTP 401/403 or a trusted Cloudflare Access login redirect. A public HTTP 200, unexpected redirect, or 404 is **not** taken as proof of private authorization.

When an authorized owner supplies a Cloudflare Access cookie through a properly protected local secret mechanism, additional checks validate the private library and explorer, locked neural-K brand, default-deny CSP and no-store headers, application manifest, exact vector silhouette, and optionally the exact bytes of a synthetic Markdown download. The test contains no personal, patient, family, or actual business records.

## Safe use

Run the synthetic tests in CI with no secrets:

```bash
node --test test/knowledge-release-preflight.test.mjs
```

Read-only guest preflight:

```bash
KNOWLEDGE_BASE_URL=https://YOUR-PRIVATE-KNOWLEDGE-HOST \
  node ops/private-forward/knowledge-release-preflight.mjs
```

Guest-only checks are **incomplete by definition** (exit 2 even if they all pass).

Credentialed acceptance additionally requires **both** `KNOWLEDGE_PREFLIGHT_EXPECTED_HOST` (the exact owner-approved hostname) and `KNOWLEDGE_ACCESS_COOKIE` (a single `CF_Authorization=...` token). A mismatch prevents all requests, including anonymous ones. Never paste cookies or tokens in chat, issues, CI, shell history, transcripts, or screenshots. Use only a private authorized injection mechanism; this PR **does not** establish one.

The synthetic Markdown round-trip is optional and requires both `KNOWLEDGE_PREFLIGHT_DOWNLOAD_PATH=acceptance/<fictional-safe-id>` and `KNOWLEDGE_PREFLIGHT_DOWNLOAD_SHA256=<expected-lowercase-sha256>`. Do not create acceptance files in a clinical/client scope. The preflight does not upload or create any record, and it does not save downloaded content to disk.

Reports contain host name, named checks, PASS/FAIL/error codes, timestamps and stated limitations, **not** cookies, downloaded Markdown, record titles, response bodies or secret-bearing URLs. `KNOWLEDGE_PREFLIGHT_REPORT` can be set to an unused local filename for an explicitly requested mode-0600 JSON report. Existing files are never overwritten.

## Exit codes

- **0:** All configured checks passed, including owner auth and synthetic download, but this is **not** release approval.
- **1:** One or more checks failed.
- **2:** Missing/invalid configuration or an intentionally incomplete guest-only / owner-only check set.

## Known limitations and release gate

1. The preflight cannot prove the Worker source SHA is the Cloudflare deployed version, check actual binding inventory, inspect the Cloudflare Access policy, or independently prove a backup restore.
2. It cannot verify an actual iPhone's Add to Home Screen appearance, accessibility and keyboard use, a trusted-device plaintext download, or rollback under outage.
3. Cloudflare Access redirects are not followed. Host validation and manual redirects reduce cookie exfiltration risk but do **not** establish DNS or TLS pinning; the operator must verify the host is the intended protected service.
4. The presence of a generic README or a green CI result does not mean Knowledge is live. Stage with synthetic data, verify real owner access and rollback, and get owner authorization before a consequential production update.
5. Notion stays **read-only** pending full verified source, attachment, scope and restored-content parity. Sharing PRs #72/#73 remain separate; do not expose private records to anonymous readers.

Owner-approved brand reference: `docs/KNOWLEDGE-APPROVED-VISUAL-BASELINE-2026-11-11.md`. Locked mark geometry fingerprint: `2bfff0621e102904b330d4eb69435617bcf19629659b3da1d943e04b6d9665a7`.
