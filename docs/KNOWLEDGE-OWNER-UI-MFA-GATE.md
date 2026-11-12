# Knowledge owner UI — independent MFA readiness gate

Status: **SOURCE-ONLY PRE-ROUTE GUARD**. This is not an MFA setup command, security approval, or hosted staging acceptance.

## Purpose and scope

Knowledge's dedicated `knowledge-owner-ui-stage` Worker and synthetic-only D1 have already been provisioned. Its public `workers.dev` subdomain remains disabled. The previous staging review found Cloudflare Access error 12130 when trying to configure an independent second factor: the organization had no allowed authenticator. Production `knowledge-forward-private` and the seven-portal source remain unchanged. Do not lower this barrier to speed up browser QA.

The standalone, read-only `knowledge:mfa:inspect` command supplements (but does **not** replace) `knowledge:stage:inspect`. Its scope is only the exact Knowledge staging hostname and Cloudflare Access independent-MFA metadata. No patient, client, historical Notion, or private Knowledge records are read. The guard performs **five fixed Cloudflare GETs**: organization, Access apps, staging Worker subdomain, exact staging app, and the exact app's policies. It follows no redirects, outputs no owner email, app ID or token, and never mutates Access, routing, D1 or Worker deployments.

## Current observed blocker — November 11, 2026

Read-only Cloudflare inspection found Cloudflare and one-time-PIN identity provider types; no explicit independent-MFA configuration fields in the organization, staging app or staging Access allow policy. The staging allow policy targets one owner email, but that **does not demonstrate MFA**. The stage subdomain was confirmed disabled.

Cloudflare's independent MFA feature requires organization-level authenticator setup before per-application settings can require MFA. Do not infer successful login, MFA challenge or edge enforcement solely from a read-only API response or synthetic test. See:

- [Cloudflare Access: Enforce MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/)
- [Cloudflare Access: Independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/)

## Read-only execution (owner's trusted environment)

With an existing least-privilege Cloudflare read token available **only as an environment variable**, not in shell history, process arguments, stdout, issue comments or CI logs:

```sh
export KNOWLEDGE_UI_MFA_GUARD_ACK=READ_ONLY_OWNER_UI_MFA_REVIEW_V1
npm run knowledge:mfa:inspect
```

The environment must already include `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Do not create or upload a new token in order to run this check without the owner's security review. No credentials should be pasted into ChatGPT.

The command returns a redacted JSON finding and exits 2 for **BLOCKED**, 1 for unavailable/error, or 0 for **MFA_METADATA_CONFIGURED**. This deliberately conservative status requires:

1. The organization declares a nonempty permitted independent-MFA authenticator set and a bounded MFA session duration.
2. The isolated staging Access application has an **explicit custom MFA requirement** (`mfa_config.mfa_disabled === false`), a nonempty subset of organization-supported browser MFA methods and an MFA session duration; absent/implicit MFA fields or app exemptions fail closed even when method names appear. An organization-level allowed-method list alone does **not** mean MFA is enforced.
3. Exactly one narrow `allow` policy with a single explicit owner email, no Everyone, bypass, groups or tokens; a policy that inherits the app must have **no MFA override**, while any explicit custom policy override must itself set `mfa_disabled === false` with an allowed method subset and bounded session duration.
4. The exact isolated staging hostname remains disabled/unrouted.

A positive metadata report is **not permission to enable the stage hostname**, and does not prove MFA enrollment, Cloudflare Access enforcement, an owner's real browser login, or readiness for production.

## Fixed fictional browser acceptance (source only; stage not updated)

The existing stage has `KNOWLEDGE_ACCEPTANCE_ONLY_ACK` and does **not** have unrestricted write or editor ACK bindings. To cover browser create/edit plumbing without widening authorization, the proposed UI exposes a **pre-filled read-only form** only for `acceptance/fictional-draft` and the fixed first/second bodies already enforced by `draftWrite()`. The form still submits through Cloudflare's owner identity, owner-bound HMAC CSRF, encrypted D1 CAS and immutable revision readback. Forged paths, changed titles/bodies, wrong identity, and replay beyond revision 2 are denied. After creation the New action disappears; after revision 2 the Edit action disappears. Existing stage configuration requires no new binding for this source code to operate, but the **current deployed stage version does not include this change** until a separately reviewed stage-only update.

This is a **fixed-payload functional wiring test**, not acceptance of freeform user editing. No real records are allowed. It cannot prove MFA, physically authenticated iPhone or desktop behavior, deployment source parity, independent restore or production release authorization. Previous approvals for MFA and route exposure are still mandatory.

## Human-reviewed sequence after the blocker

1. Owner reviews Cloudflare's organization-wide independent-MFA feature, authenticator enrollment/recovery, existing Cloudflare Access apps, possible account lockouts and impact on collaborators. Prefer phishing-resistant security keys where practicable; TOTP may be an enrollment/recovery choice. Do **not** silently enable global MFA enforcement or modify production apps.
2. Only after separate scope-specific security approval and enrollment/recovery verification, configure allowed authenticators at the organization boundary, then an **explicit staging-only** independent-MFA requirement. Review actual inherited policy overrides. Do not weaken the one-owner allow selector.
3. Recheck both the original topology guard and the new MFA metadata guard; read the exact staging script version, ten bindings, unique D1 and disabled stage subdomain.
4. After a separate approval for staging exposure, validate anonymous denies, Cloudflare Access login, **actual MFA challenge**, negative identity tests, and owner-only data read. Use fictional data only. Confirm 320/390/768/1440px layouts, iPhone Home Screen icon, keyboard/accessibility, exact Markdown download, CSP, no-store and denied sharing endpoints.
5. Exercise stage rollback to the retained prior version and verify the exact Worker version and unavailable exposure afterward. Preserve production version and bindings; no automatic promotion.
6. Gate production release separately on real-device acceptance, encrypted independent restore, per-workspace scope checks, and reviewed rollback. Notion remains read-only until historical migration parity and explicit retirement approval.

## Non-goals and safety

- **No** account-wide authentication change, Cloudflare Access policy mutation, stage hostname routing, deployment or production release is authorized by this PR.
- **No** real client/clinical or family records in the isolated test database.
- **No** public share links, automatic capture enablement, Notion deletion, or Google Drive migration.
- This guard complements, not replaces, actual WebAuthn/TOTP step-up verification and authenticated device testing.
