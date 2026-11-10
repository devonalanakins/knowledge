# Knowledge capture: bound-but-disabled release inventory

This is the **current** release verification lane after the nonpublic
capture processor gained exactly one named private service binding to the
existing owner Knowledge Worker on November 10, 2026.

The earlier `wrangler.capture-processor.staged.json` and
`capture:staging-guard` intentionally describe a historical **D1-only**
phase. They are retained as evidence and are NOT a safe production deploy
recipe for the current bound processor. Never deploy the D1-only manifest
over this release or run `capture:stage-version -- processor` from it.

## What the new read-only guard verifies

`capture:bound-guard` checks the three deployed Worker **versions**, the
corresponding script-level binding metadata, exact 100% active version IDs,
compatibility date, handler shapes and every binding:

- Owner: existing ten secret_text bindings and exactly one encrypted owner
  D1; named `KnowledgeCaptureEntrypoint` present; original owner HTTP
  Worker remains available over its existing Access-controlled URL.
  **No owner machine capture acknowledgement or machine key** is present.
- Ingress: exactly one isolated capture D1, no service binding, no secrets.
- Processor: exactly the isolated capture D1 and one service binding
  `KNOWLEDGE_CAPTURE_WRITER` to
  `knowledge-forward-private/KnowledgeCaptureEntrypoint`. No secret
  material or additional bindings.
- All three: no Cron schedules, no preview URLs, and exactly one 100%
  active version. Ingress and processor have disabled workers.dev URLs;
  owner URL remains enabled with its existing Access protection.
- Account Worker custom domains and every visible zone Worker route must
  show no route to either capture Worker. Unavailable/incomplete route or
  deployment inventory is a failure, never an implicit pass.

The read-only Cloudflare API calls return metadata, not Worker secret values,
D1 rows, private page bodies or signing keys. The report omits provider
routes, domain names and secret content. It is an exact-state release guard,
**not** an activation command, runtime machine-RPC proof, backup restore or
approval to expose a webhook.

## Operator-controlled read-only check

Use a private execution environment with a narrowly scoped, credentialed
Cloudflare read token, not a chat message or public CI. Set
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` privately.
Set the **exact independently observed active version IDs** as:

- `KNOWLEDGE_CAPTURE_INGRESS_ACTIVE_VERSION`
- `KNOWLEDGE_CAPTURE_PROCESSOR_ACTIVE_VERSION`
- `KNOWLEDGE_OWNER_ACTIVE_VERSION`

Set `KNOWLEDGE_CAPTURE_BOUND_GUARD_ACK=READ_ONLY_BOUND_DISABLED_V1` and run
`npm run capture:bound-guard`. The CLI prints only a compact status,
findings, rollback version IDs and `deploymentAuthorized:false`,
`activationAuthorized:false`, `liveCaptureVerified:false`.

Status `BOUND_DISABLED_MATCH` means metadata matches the reviewed
bound-but-inactive release. `BLOCKED` or
`KNOWLEDGE_CAPTURE_BOUND_GUARD_UNAVAILABLE` means no promotion or
activation is authorized. The expected versions are explicit rather than
automatically trusting the latest deployment; any change must be reviewed.

## Remaining prerequisites to actually turn capture on

Independently provision separate recoverable encrypted-inbox, signing and
machine HMAC keys in approved secret custody, configure narrowed owner and
processor machine permissions, install the Actions signing secret and
disabled-to-enabled delivery flags through an authorized GitHub settings
workflow, then separately authorize the HMAC-only public ingress route and
processor Cron. Verify source confirmation, one genuine nonclinical GitHub PR
merge, encrypted receipt, exact owner Knowledge readback, duplicate denial,
Access preservation, backups and rollback. None of these are done by this
guard or by its unit tests. Notion remains read-only.
