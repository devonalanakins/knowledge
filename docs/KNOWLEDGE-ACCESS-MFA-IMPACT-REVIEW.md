# Knowledge — Read-only Cloudflare Access MFA impact review

**Status:** Source-only inspection. This procedure never configures, enables, disables, or authorizes MFA, routing, D1, DNS, or any Worker deployment.

## Why this review exists

On November 11, 2026, a provider read-only inventory counted **24 self-hosted Cloudflare Access apps and 25 associated app policies**. Neither the Access organization nor any of those app/policy objects exposed explicit independent MFA settings. Knowledge's staging Worker was isolated and its `workers.dev` route disabled. These facts do **not** prove every application is properly protected or that a future organization change has no impact.

Cloudflare independent MFA has three separate layers: organization **allowed methods and enrollment**, global **enforcement by default**, and app/policy **enforcement overrides**. Policy settings supersede application settings, which supersede organization settings. Cloudflare documents that allowed-method setup must precede setting a custom staged enforcement requirement. A proposed change must be reviewed against all current apps, not assumed confined to Knowledge.

Official provider reference: [Independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/) and [MFA requirements](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/).

## Updated provider state — November 12, 2026

The organization now allows TOTP, WebAuthn security keys and biometrics, with a 1h MFA session; the **single owner-only staging Access policy** has an explicit custom MFA requirement. The staging application intentionally **inherits** instead of duplicating the policy requirement. This is valid under Cloudflare's documented priority: policy > application > organization.

The revised impact audit distinguishes this one deliberate stage policy requirement from MFA overrides on unrelated applications. It still records aggregate custom-policy counts and never grants release approval. The organization API GET omits `mfa_required_for_all_apps` even though the update explicitly requested `false`; therefore `ORGANIZATION_GLOBAL_MFA_DEFAULT_NOT_VERIFIED_OFF` remains a conservative finding until independent effective-setting verification. Both public and preview staging subdomains must remain disabled.

Owner authenticator enrollment, recovery, actual challenge and physical-device acceptance are **NOT VERIFIED**. No route or production change is authorized by this source review.

## Scope

`npm run knowledge:mfa:impact` makes a bounded series of **GET-only** requests to the exact account Access organization, Access application list, application detail, application policies, and disabled staging Worker subdomain. It inspects at most 99 application objects (fails closed at 100 or higher), queries every app's current settings and policies, rejects incomplete pages, unexpected IDs, failed reads and malformed responses, and returns **aggregate counts only**. App names, URLs, IDs, emails, policies' content and API tokens are not included in the returned report. A least-privilege pre-existing **read-only** Cloudflare token is required; do not create, print, upload, or paste tokens to perform this review.

Run from an owner-controlled environment whose process environment already contains `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Explicitly acknowledge the account-wide **read scope**:

```sh
export KNOWLEDGE_ACCESS_IMPACT_ACK=READ_ONLY_ALL_ACCESS_APPS_V1
npm run knowledge:mfa:impact
```

The command always exits **2** when a complete review report is available, because human authorization remains required. Exit **1** means the API/inventory was unavailable or incomplete. It never exits 0 as an implicit authorization. The report has `organizationChangeAuthorized:false`, `stageRouteChangeAuthorized:false`, `productionReleaseAuthorized:false`, and `actualMfaChallengeVerified:false` regardless of configuration state.

## Human security gate before changing MFA

1. Independently confirm the owner has at least two workable enrollment/recovery methods and understands impact on the Access app launcher, account access, collaborators and all other apps.
2. Confirm allowed browser methods at the **organization** level and determine whether **Apply global MFA settings by default** should remain disabled. Do not change organization/global enforcement through this read-only procedure.
3. Review explicit app/policy exemptions and overrides. Do not assume that an inherited or absent MFA field proves a factor was required.
4. The owner-only **Knowledge staging policy** now has a custom independent MFA requirement without changing the stage application's unrelated settings. Confirm owner enrollment and recovery, and re-read the exact policy to detect changes before any routing.
5. Re-run the existing stage topology and Knowledge stage MFA metadata guards. Only after a separate stage-routing approval, perform a **real** Access identity + MFA challenge with negative owner/guest tests on devices, verify exact Markdown downloads, encrypted staging isolation, and rollback.
6. Production and Notion remain unchanged until independently verified release, backup/restore, migration parity and final approval.

**Do not confuse a green CI result or metadata inspection with successful MFA challenge.** This command is a review artifact, not an identity enrollment or release workflow.
