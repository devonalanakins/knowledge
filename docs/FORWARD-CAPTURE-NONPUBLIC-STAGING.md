# Knowledge capture — nonpublic, disabled staging manifests

**Status 2026-11-09: SOURCE-ONLY. DO NOT DEPLOY FROM THESE FILES.**

Two exact Worker manifests are available for review:
- `ops/private-forward/wrangler.capture-ingress.staged.json`
- `ops/private-forward/wrangler.capture-processor.staged.json`

Both point to the existing `knowledge-capture-inbox-private` D1 with the
same previously verified Cloudflare database ID. Neither references the owner
`knowledge-forward-private` database. No worker is added, and no live
Cloudflare configuration was changed by this source update.

## Deliberate initial disabled behavior

- Both use `workers_dev: false` and `preview_urls: false`.
- Neither has any routes, HTTP-facing site, `triggers`, Cron, service binding,
  secrets, activation acknowledgments or repository allowlist.
- The ingress returns an empty 503 on its exact `POST /github` path without
  activation bindings; it cannot enqueue a GitHub event.
- The processor's HTTP interface returns 404. Without a Cron trigger it
  does not drain the encrypted inbox.
- Neither can read owner Knowledge pages, call the machine writer, access
  owner keys, impersonate Cloudflare Access, or permit clinical data.

**Important:** these files are *not* a safe self-sufficient `wrangler deploy`
command against existing Workers. Cloudflare deployments can replace remote
settings and remove dashboard-managed text variables unless their bindings
are explicitly preserved. A deployment of the alternate owner main module
requires an independently reviewed, full eleven-binding inventory,
rollback version and correct auth/session behavior. No production deploy
should be attempted as a result of these manifests or green CI.

## Before any controlled provider deployment

1. Verify protected main commit and complete Node 22, Node 24 and G24 test
   results, including `test/capture-nonpublic-staging-config.test.mjs`.
2. Recheck existing Cloudflare Worker versions, D1 binding IDs, and the
   `workers.dev` subdomain/preview flags; preserve rollback evidence.
3. Validate the Wrangler build and bundled module format in a local
   `--dry-run` only, without uploading or changing the existing Workers.
4. Compare the complete desired bindings and any currently configured
   dashboard-managed settings before a version upload. Do not silently
   replace/remove existing bindings.
5. Only after explicit release authorization, separately stage a version
   while keeping routes, previews, Cron and source delivery disabled.
6. Independently verify the deployed module and binding preservation,
   disabled endpoint behavior, zero receipts, owner Access, and rollback.

**Additional future activation gates:** dedicated recoverable signing and
encryption keys, named owner WorkerEntrypoint service binding, review of
GitHub Actions access, real protected-branch event verification, rollback,
encrypted inbox acceptance and an independently read-back Knowledge draft.
Do not interpret a reviewed manifest or local canary as authorization to
enable externally accessible capture.

The existing direct ChatGPT-to-Knowledge owner draft workflow remains
independent of this integration. Notion remains read-only migration evidence.

## Read-only configuration drift and rollback guard (2026-11-09)

The two staged manifests now retain the existing **2026-11-07** compatibility
date, independently observed on both live capture Workers. Previously they
specified 2026-11-08, an unintended version behavior change.

In the owner's private environment, supply a narrowly restricted Workers
metadata-read API token and account ID, plus
`KNOWLEDGE_CAPTURE_STAGING_GUARD_ACK=READ_ONLY_STAGING_REVIEW_V1`.
Run `npm run capture:staging-guard`. The guard performs only eight GET
requests: settings, deployments, schedules and subdomain for each of the
two disabled capture Workers. It verifies pinned D1 isolation, exact
bindings and deployment compatibility, absence of Cron/public exposure,
and returns currently deployed version IDs for rollback planning.

`STAGING_METADATA_MATCH` means metadata matches **only**. It is not an
executed Wrangler build, a tested rollback, verified secret custody or
permission to deploy. Nonzero exit statuses indicate drift or unavailable
evidence. Do not blindly run `wrangler deploy` with partial configs;
remote dashboard-managed bindings may be replaced. No secrets, page data,
D1 records, provider token or credential values appear in output.

A future controlled version upload must preserve existing binding names,
identity and rollback version, and separately validate the bundle using
a non-uploading dry run. A human-approved deployment remains a separate gate.

## CI-only bundle verification (2026-11-09)

`.github/workflows/verify-capture-bundles.yml` validates the actual
staged capture ingress and processor bundles on reviewed pushes and PRs.
It uses Node 22, a pinned Wrangler version, and `wrangler deploy
--dry-run --config ... --outdir /tmp/knowledge-capture-bundles/...`.
Despite the command name, **`--dry-run` does not upload or deploy a Worker**.
The job provides no Cloudflare API token, account ID, D1 secret, or GitHub
write permission. It checks both generated JavaScript bundle artifacts.
No build output containing private information is uploaded as a CI artifact.

A passing dry-run proves that the checked-in disabled source can be bundled
by this Wrangler version in GitHub CI. It does **not** prove parity with
production's currently deployed module, binding preservation, correct
runtime identity, a successful Cloudflare rollout, or a tested rollback.
Do not change production Workers merely because the CI job is green.
