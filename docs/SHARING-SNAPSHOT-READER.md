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

## Private owner-only review before release (source implementation)

- New optional `GET /wiki/preview/<path>` route in the **private owner Worker**. It is available only when both the existing browser opt-in `KNOWLEDGE_BROWSER_ACK=OWNER_ONLY_BROWSER_READ_V1` and independent `KNOWLEDGE_OWNER_SHARE_PREVIEW_ACK=OWNER_ONLY_SHARE_PREVIEW_V1` are set.
- It applies the same **direct Cloudflare Access owner identity** and encrypted D1 read contract as the standard `/wiki/page/<path>` route; neither permission nor public access is broadened. POST, non-owner, invalid paths and query strings are rejected. There are no write or share-token endpoints.
- Private reader surfaces a **Preview for sharing** link only while that opt-in is enabled. The preview displays draft revision/body with a prominent "Private preview only — not shared" warning, deliberately without clickable internal or external links. HTML remains inert/escaped.
- This is a **privacy-review aid**, not the final exact public snapshot preview. The owner must independently remove/redact content and review the actual final approved snapshot before any real link is created; ordinary draft content may contain free-text private paths or unapproved details not covered by link stripping. Do not represent preview as approval.
- Latest tests confirm no revisions/D1 content change on preview, no anonymous/wrong-owner access and no external-link creation. No production preview feature flags were changed by source commits.

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

## Manual owner-only publication and revocation — separate, opt-in source module

A new source-only module, `src/worker-cloudflare-share-publisher.mjs`, introduces the missing manual publication half of this design. **No Worker has been configured or deployed by this code.** It is intentionally not imported into the existing private Knowledge MCP Worker and does not read the private Knowledge D1.

The **owner-only publisher** requires direct `ctx.access.getIdentity()` with the configured owner email and Access audience. No forwarded identity headers, bearer-key bypass, guest identity, agent grant, or anonymous publication are supported. It must run at a distinct authenticated HTTPS origin from the public viewer. The two Workers may use the same dedicated *public-snapshot D1* (not the owner-private Knowledge D1), and the publisher alone receives a separate HMAC approval secret.

All activation parameters are intentionally absent from production configuration:

- `KNOWLEDGE_SHARE_PUBLISH_ACK=OWNER_REVIEWED_NONCLINICAL_SNAPSHOT_V1`
- `KNOWLEDGE_SHARE_DB_SCOPE_ACK=ISOLATED_PUBLIC_SNAPSHOTS_ONLY_V1`
- `KNOWLEDGE_SHARE_PUBLISH_ORIGIN`, `KNOWLEDGE_SHARE_PUBLIC_ORIGIN`: exact, distinct HTTPS origins
- `KNOWLEDGE_SHARE_ACCESS_AUD`, `KNOWLEDGE_SHARE_ACCESS_EMAIL`: owner-restricted direct Cloudflare Access identity
- `KNOWLEDGE_SHARE_APPROVAL_KEY`: publisher-only, independently generated 32-byte random HMAC key (64 lowercase hex digits)
- `KNOWLEDGE_SHARE_DB`: **dedicated public-snapshot D1 binding** with `ops/private-forward/public-snapshot-schema.sql`; never owner-private D1

Routes (owner-only): `GET /share/new` → `POST /share/preview` → `POST /share/create`; `GET /share/manage` → `POST /share/revoke`. These forms have 15-minute, domain-separated HMAC proofs bound to exact issuer/owner, title and Markdown body. Owner must explicitly type the `PUBLIC_NONCLINICAL_REVIEWED` declaration during preparation, inspect the link-free recipient preview, and then type `PUBLISH THIS SNAPSHOT` to issue a copy. An immutable `review_proof_hash` unique constraint prevents a submitted confirmation from issuing multiple links (including replay or concurrency).

A successful issue generates a fresh 256-bit random token, stores **only the SHA-256 token hash**, stores only the *manually supplied reviewed title/body* in the public D1, and returns the one-time 7-day URL. If the owner loses the URL, the original token is not recoverable from the database; create a new reviewed snapshot and revoke the old one. No private wiki path, source URL, attachments, workspace identifier, automatic source read or linked documents are copied. Public viewer suppresses clickable external and private wiki links and enforces expiration and revocation at every request. The owner-only management page lists up to 100 snapshot titles and their status and supports HMAC-protected revocation. An expired link is not automatically deleted; retention must be specified before real deployment.

### Security release boundary — still NO-GO

The manual form enforces an **attestation, not a clinical data loss prevention system**. A user could still paste confidential or personally identifiable information into the public copy; the implementation cannot prove classification or legal scope from a typed phrase. The current general-purpose publisher must not be deployed into a PHI/client-eligible workflow, and no Nona private meeting note or patient/client content is authorized for release. A separate, independently reviewed control must determine which legal entities and contents may be released before production.

Additional release gates: prove correct Cloudflare Access MFA owner identity on the publisher host; prove the viewer has **no Access bypass to owner D1 and no publisher key**, and the publisher has **no private owner D1**; review binding ownership, secrets and audit/log retention; verify real iOS/desktop recipient preview and revoke/expiry on staging synthetic data, rate limiting and concurrency behavior; test secrets and D1 backup/restore preserving revocations; define deletion/retention policy; get explicit owner approval for actual public routes and any particular reviewed document. Never expose the HMAC key, raw tokens or document data to GitHub CI logs. No production D1 schema migration or public route is authorized just because a source PR is green.

Synthetic automated cases in `test/worker-cloudflare-share-publisher.test.mjs` exercise owner auth, exact copy HMAC, seven-day issuance, viewer handoff, immutable storage, replay denial, revocation readback, invalid configurations, malicious links, unsupported routes and storage failures. These tests are **not** a security certification or proof of live deployment.

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
