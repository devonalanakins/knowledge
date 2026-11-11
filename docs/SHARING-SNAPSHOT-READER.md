# Knowledge — isolated public snapshot reader (SOURCE ONLY, no public release)

**Status: drafted as a stacked, security-isolated follow-up to private compact explorer PR #71.**
This code is not deployed, has no approval workflow or share-generation API, and **cannot
turn any currently private Knowledge page into a public page**. Do not enable it using
the private owner D1 database or private owner encryption key.

## Intended user experience (separate future release)

1. Owner signs in to the private Knowledge explorer, selects a single reviewed page,
   explicitly chooses **Create shareable snapshot**, and sees an exact recipient preview.
2. A separate authorized publisher checks owner identity, workspace legal scope,
   sensitivity classification, review/approval state and revision number, then copies
   *only the approved body and display title* into a separately scoped snapshot D1.
   The publisher generates an independent cryptographically random 32-byte token on an
   authorized, trusted provider, stores **only SHA-256(token)**, and returns one new
   capability URL to the owner **only after audited confirmation**. Expiration defaults
   to seven days unless the owner explicitly chooses a permitted shorter/longer policy.
3. Anyone possessing the URL can open the read-only immutable snapshot until expiry
   or revocation. The viewer never reads private D1 or owner records and cannot edit,
   list, create, approve, or grant anything. The share never reveals private backlinks,
   workspace navigation, draft revisions, original source storage, or attachments.
4. Owner may revoke through a separately authorized action. The viewer verifies the
   revoked timestamp and expiry on every request. Old downloaded copies cannot be
   recalled from a recipient's device.
5. Named invited readers and multi-page shares require **separate** verified identity,
   least-privilege ACLs and review; they do not use anonymous snapshot links by default.

## Isolated viewer source in this branch

- `src/worker-cloudflare-share-viewer.mjs`: single GET/HEAD handler, strict exact-origin
  `/s/<43-character-base64url-token>`, SHA-256 lookup of token in separate D1,
  version/approval/expiration/revocation checks, static accessible single-page output.
  GET returns generic identical 404 for missing/expired/revoked tokens and no private
  record title, path, body, or metadata in error output.
- `src/forward-safe-markdown.mjs`: separate `internalLinks: false` render mode omits
  private `[[path|label]]` wiki links in shared output. Raw HTML is escaped.
- `ops/private-forward/public-snapshot-schema.sql`: isolated **plaintext release
  material** D1 schema, no owner record IDs, workspace, path or raw token. A trigger
  prevents mutation of approved content and another rejects deletion; revocation is
  an allowed timestamp update. Released material is no longer private, so privacy
  depends on the publisher's human review and isolation—not AES encryption in this D1.
- `test/worker-cloudflare-share-viewer.test.mjs`: synthetic fixture tests for
  version pinning, XSS escaping, missing/invalid/expired/revoked token, route/method
  denial, malformed config, lack of publication endpoint and SQL immutability.

## Deployment and activation restrictions

- **NO deployment manifest, D1 provisioning, scheduled task, Cloudflare route,
  domain, public URL, DNS, Access policy, binding, secret, data import, API capture,
  or live sharing grant is part of this PR.**
- Publisher is deliberately **NOT implemented**. An untrusted client must never be
  allowed to insert an `approved` row, even if it knows a document path or version.
- Future review must prove: explicit owner action and manual redaction; qualified
  handling for entity/health/client sensitive content (deny by default); no private
  attachment or source URL escape; cryptographic token generation; independent token
  delivery; integrity/publisher signature or comparable authorization boundary;
  usage/failure rate limiting where relevant; evidence of approved data classification;
  revocation readback; seven-day default TTL; no sensitive request logging; no search
  indexing, external scripts, or marketing analytics; backup and restore of revocation
  state; incident response and rollback.
- Sharing is public **only for deliberately released nonclinical, nonconfidential,
  scope-approved content**. The Nona Neuropsychology internal management meeting
  and current Knowledge internal drafts must stay private unless Cristy and Devon
  approve a distinct sanitized meeting brief and its exact public release scope.
- Continue to keep Notion read-only, owner Knowledge worker Access-protected, and
  existing production data and backups untouched. Source-only CI does not prove
  production auth, human review, or the recipient experience.

## Release acceptance before any future public URL

1. Human security review of publisher → segregated D1 → viewer path, including
   negative/abuse tests and no cross-scope or draft content.
2. Verify non-production staging with synthetic data, expired/revoked/guessed-token
   attempts, exact headers, desktop/mobile accessibility and no other routes.
3. Explicit owner approval for named public route and reviewed sharing UI.
4. Verifiable provider deployment, rollback, real recipient and revocation readback.
   Do not announce anyone-with-link sharing as LIVE before all gates pass.

References: GitHub issue #6 (locked compact-explorer sharing design), PR #71
(private owner UX source-only).
