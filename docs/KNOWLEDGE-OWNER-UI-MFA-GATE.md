# Knowledge owner UI — independent MFA readiness gate

Status: **SOURCE-ONLY PRE-ROUTE GUARD**. This is not an MFA setup command, security approval, or hosted staging acceptance.

## Purpose and scope

Knowledge's dedicated `knowledge-owner-ui-stage` Worker and synthetic-only D1 have already been provisioned. Its public `workers.dev` subdomain remains disabled. The previous staging review found Cloudflare Access error 12130 when trying to configure an independent second factor: the organization had no allowed authenticator. Production `knowledge-forward-private` and the seven-portal source remain unchanged. Do not lower this barrier to speed up browser QA.

The standalone, read-only `knowledge:mfa:inspect` command supplements (but does **not** replace) `knowledge:stage:inspect`. Its scope is only the exact Knowledge staging hostname and Cloudflare Access independent-MFA metadata. No patient, client, historical Notion, or private Knowledge records are read. The guard performs **five fixed Cloudflare GETs**: organization, Access apps, staging Worker subdomain, exact staging app, and the exact app's policies. It follows no redirects, outputs no owner email, app ID or token, and never mutates Access, routing, D1 or Worker deployments.

## Historical blocker — November 11, 2026 (superseded by Nov 12 configuration)

Read-only Cloudflare inspection found Cloudflare and one-time-PIN identity provider types; no explicit independent-MFA configuration fields in the organization, staging app or staging Access allow policy. The staging allow policy targets one owner email, but that **does not demonstrate MFA**. The stage subdomain was confirmed disabled.

Cloudflare's independent MFA feature requires organization-level authenticator setup before per-application settings can require MFA. Do not infer successful login, MFA challenge or edge enforcement solely from a read-only API response or synthetic test. See:

- [Cloudflare Access: Enforce MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/)
- [Cloudflare Access: Independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/)

## November 12 verification update

Cloudflare's owner-only Knowledge staging **policy**, not the Access application, now explicitly requires independent MFA (`mfa_disabled: false`); permitted organization methods are TOTP, security key and biometrics, duration 1h. Other applications were left without new custom MFA requirements; the org-wide global-enforcement field is omitted in GET readback and must not be represented as independently proven OFF. The staging Worker remains unrouted with previews disabled. The previous metadata guard incorrectly demanded an application-level override and ignored preview-route status. This source fix recognizes Cloudflare's documented policy-over-application precedence, preserves fail-closed negative checks, and verifies both public and preview subdomains stay disabled.

**User-held requirement:** Enrollment and lockout recovery are physical owner actions. Cloudflare's API connection did not expose enrolled authenticators, so this document does not claim enrollment, MFA challenge, owner acceptance, or authorization to enable staging traffic.

## Read-only execution (owner's trusted environment)

With an existing least-privilege Cloudflare read token available **only as an environment variable**, not in shell history, process arguments, stdout, issue comments or CI logs:

```sh
export KNOWLEDGE_UI_MFA_GUARD_ACK=READ_ONLY_OWNER_UI_MFA_REVIEW_V1
npm run knowledge:mfa:inspect
```

The environment must already include `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Do not create or upload a new token in order to run this check without the owner's security review. No credentials should be pasted into ChatGPT.

The command returns a redacted JSON finding and exits 2 for **BLOCKED**, 1 for unavailable/error, or 0 for **MFA_METADATA_CONFIGURED**. This deliberately conservative status requires:

1. The organization declares a nonempty permitted independent-MFA authenticator set and a bounded MFA session duration.
2. **Either** the isolated staging application **or** its single exact owner-only Access policy explicitly requires MFA (`mfa_config.mfa_disabled === false`), with a permitted authenticator subset and bounded duration. Cloudflare Access evaluates policy settings before application and organization settings. A policy can enforce MFA even when the application inherits a non-enforcing organization default. Present but invalid/exempt settings fail closed.
3. Exactly one narrow `allow` policy with a single explicit owner email, no Everyone, bypass, groups or tokens. A custom policy must affirmatively require MFA; absent policy MFA is acceptable only when the application itself requires it.
4. Both the exact isolated staging public subdomain and preview URLs remain disabled/unrouted.

A positive metadata report is **not permission to enable the stage hostname**, and does not prove MFA enrollment, Cloudflare Access enforcement, an owner's real browser login, or readiness for production.

## Fixed fictional browser acceptance (deployed to isolated, unrouted stage)

The existing stage has `KNOWLEDGE_ACCEPTANCE_ONLY_ACK` and does **not** have unrestricted write or editor ACK bindings. To cover browser create/edit plumbing without widening authorization, the proposed UI exposes a **pre-filled read-only form** only for `acceptance/fictional-draft` and the fixed first/second bodies already enforced by `draftWrite()`. The form still submits through Cloudflare's owner identity, owner-bound HMAC CSRF, encrypted D1 CAS and immutable revision readback. Forged paths, changed titles/bodies, wrong identity, and replay beyond revision 2 are denied. After creation the New action disappears; after revision 2 the Edit action disappears. The unchanged ten bindings support this code in reviewed staging Worker version `73ab1e63-9daa-41e4-b416-7a2a01e70502` (source commit `8e9cf7daeeeea40a524a319babf3ac84808bc50d`). The Worker is deployed but unrouted, so no real browser acceptance has been performed.

This is a **fixed-payload functional wiring test**, not acceptance of freeform user editing. No real records are allowed. It cannot prove MFA, physically authenticated iPhone or desktop behavior, deployment source parity, independent restore or production release authorization. Previous approvals for MFA and route exposure are still mandatory.

## Human-reviewed sequence after configuration, before opening staging

1. Owner reviews Cloudflare's organization-wide independent-MFA feature, authenticator enrollment/recovery, existing Cloudflare Access apps, possible account lockouts and impact on collaborators. Prefer phishing-resistant security keys where practicable; TOTP may be an enrollment/recovery choice. Do **not** silently enable global MFA enforcement or modify production apps.
2. Organization methods (TOTP, security key, biometrics) and the **owner-only stage policy's** explicit independent-MFA requirement were configured November 12 with 1h duration. Global enforcement was explicitly requested OFF; the API readback omitted that flag, so the separate impact audit must continue to report the global default as unverified. No other application overrides were added. The owner must enroll at least two authenticators, verify recovery, and demonstrate a fresh MFA challenge. Never paste enrollment secrets, QR codes, OTPs or recovery material into ChatGPT.
3. Recheck both the original topology guard and the new MFA metadata guard; read the exact staging script version, ten bindings, unique D1 and disabled stage subdomain.
4. After a separate approval for staging exposure, validate anonymous denies, Cloudflare Access login, **actual MFA challenge**, negative identity tests, and owner-only data read. Use fictional data only. Confirm 320/390/768/1440px layouts, iPhone Home Screen icon, keyboard/accessibility, exact Markdown download, CSP, no-store and denied sharing endpoints.
5. Exercise stage rollback to the retained prior version and verify the exact Worker version and unavailable exposure afterward. Preserve production version and bindings; no automatic promotion.
6. Gate production release separately on real-device acceptance, encrypted independent restore, per-workspace scope checks, and reviewed rollback. Notion remains read-only until historical migration parity and explicit retirement approval.

## Non-goals and safety

- **No** account-wide authentication change, Cloudflare Access policy mutation, stage hostname routing, deployment or production release is authorized by this PR.
- **No** real client/clinical or family records in the isolated test database.
- **No** public share links, automatic capture enablement, Notion deletion, or Google Drive migration.
- This guard complements, not replaces, actual WebAuthn/TOTP step-up verification and authenticated device testing.
