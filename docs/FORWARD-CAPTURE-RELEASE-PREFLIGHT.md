# Automatic capture — read-only release metadata preflight

**Status (2026-11-09): SOURCE-ONLY; REAL CAPTURE NOT ACTIVATED.**

This command inventories the *existing* three Cloudflare Workers used by the
personal, nonclinical GitHub-merge receipt pipeline. It does not provision,
deploy, activate, send, retry, or decrypt anything.

## Owner-controlled usage

Use a separately restricted Cloudflare **Workers read** API credential in the
owner's private environment. Do not print, copy, or store the credential in
a shell script, GitHub, screenshots, chat, or ordinary logs.

Set these process environment variables through private credential custody:

- `KNOWLEDGE_CAPTURE_PREFLIGHT_ACK=READ_ONLY_METADATA_V1`
- `CLOUDFLARE_API_TOKEN` — read-only Workers metadata token
- `CLOUDFLARE_ACCOUNT_ID` — exact selected account ID

Then run `npm run capture:preflight`.

The tool performs exactly nine GET requests: settings, deployments and
schedules for `knowledge-forward-private`,
`knowledge-capture-ingress-private`, and
`knowledge-capture-processor-private`. No GitHub credential is needed;
no D1 rows, R2 objects, script source, logs, or secret values are read.

Output contains only an ordered list of missing, unexpected, or wrong-type
binding **names** and aggregate readiness. It does not echo database IDs,
secret text, token values, URL values, or private record content.

Exit status: 0 for `METADATA_READY_FOR_SEPARATE_REVIEW`; 2 for `NOT_READY`;
1 when provider access/metadata is unavailable or malformed. All reports
include `releaseAuthorized: false` and `liveCaptureVerified: false`.

## Explicitly incomplete gates

The command checks for correct *metadata presence* and type only. It checks
D1 isolation (owner database distinct from the capture inbox), capture
workers sharing one inbox, exact named service-binding target, processor Cron,
unprivileged binding separation, and one 100% deployed version per Worker.

It cannot independently verify HMAC secret equality/entropy or custody,
Cloudflare Access identity, Worker route privacy, repository branch rules,
GitHub Actions variables, source SHA, actual Worker entrypoint behavior,
D1 data, backup recovery, successful event delivery, rollback, or actual
Knowledge readback. Provider metadata can be misconfigured despite matching
names. Thus a green preflight does **not** authorize activation.

The GitHub Actions sender remains off unless independently activated. Never
enable the public `/github` endpoint, processor Cron, machine receiver, or
repository delivery ACK from this report alone. Do not reuse the production
Knowledge root key, weaken owner Access, import historical Notion material,
or permit clinical, client or unrelated workspace capture.

See `FORWARD-GITHUB-ACTIONS-DELIVERY.md`,
`FORWARD-CAPTURE-MACHINE-RPC.md`, and
`FORWARD-CAPTURE-PROCESSOR.md` for the separately approved acceptance gates.
