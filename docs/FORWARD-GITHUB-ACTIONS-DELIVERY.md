# Knowledge — opt-in GitHub Actions merge-event delivery

**Status 2026-11-10: OIDC AUTHENTICATION SOURCE ADDED; NOT ACTIVATED.**
This is a narrowly scoped alternative to installing a native GitHub repository
webhook through GitHub's owner settings. It does not change the existing
Cloudflare owner Worker, capture inbox, Access, keys, D1 contents or permissions.

## What it sends

The checked-in `.github/workflows/knowledge-merge-delivery.yml` listens only
for **pushes to the canonical `main` branch**. Unlike the prior
`pull_request_target.closed` sender (now superseded), a push run does not
execute a privileged pull-request event or read untrusted PR code.

After the explicit owner activation gate, the workflow validates the push
repository ID `1446728034`, branch, tip SHA, full supplied commit list,
non-forced / non-deleted state and event metadata. It requests, with a
**read-only GitHub token**, the PRs associated with each pushed commit using
the official GitHub `GET /repos/{owner}/{repo}/commits/{sha}/pulls` API.
Only a closed, merged PR with an exact matching merge commit SHA and
approved main-branch base repository ID is eligible. Direct pushes,
unrelated and open PRs, non-main PRs and partial/forced pushes do not
produce receipts. Invalid and incomplete GitHub responses fail closed.

Each eligible receipt carries only `action=closed`, PR number, pinned
repository ID and slug, merge SHA, merged timestamp and `merged=true`.
No PR title, description, author identity, branch content, commit message
or third-party private data is transmitted.

The workflow supports two explicitly selected authentication modes.
**Preferred `github_oidc_v1`** requests a short-lived GitHub-signed RS256
OIDC assertion using `id-token: write` (no permanent GitHub Actions signing
secret). The token's audience includes the SHA-256 digest of the exact
JSON request bytes, preventing substitution of different merge receipts.
The ingress verifies GitHub's JWKS signature, issuer, audience, time bounds,
immutable repository ID, main branch, trusted workflow, job context, and
push SHA. The alternate `hmac_v1` mode retains the older independently
managed HMAC shared secret and `X-Hub-Signature-256` header for backwards
compatibility, never as an automatic fallback.
Both use HTTPS `POST /github`, `X-GitHub-Event=pull_request` and a UUID
delivery ID. Neither mode accepts authentication just because a GitHub
event-shaped body was received.
A 202 response means the encrypted D1 inbox accepted a receipt, NOT that
the authoritative Knowledge record was saved. Only the separately
authenticated owner write/readback can certify `SAVED`.

## Independent source verification at the encrypted inbox

**HMAC authentication alone is not authorization to create a project record.**
The ingress now independently queries the canonical **public GitHub PR REST
endpoint** before inserting any encrypted receipt. It requires the exact
immutable repository ID, main-branch base repository, closed+merged state,
merge commit SHA and normalized merge time to agree with the authenticated
canonical receipt. Signed but fictional, stale or altered merge claims are
rejected with an empty **403**; missing, rate-limited or malformed GitHub
responses fail closed with an empty **503** for safe retry. Neither response
creates an inbox item, and neither should be reported as saved.

The source fetch uses a fixed URL derived from the allowlisted repository
and PR number, GET only, no redirects or query strings, and a bounded
UTF-8 JSON response. No third-party PR body/title is stored. It needs no
owner key, Cloudflare administrative token, or GitHub write token. This
release supports **public repositories only** for independent source
confirmation; private repository sources require a separately reviewed
least-privilege read credential and are otherwise unavailable, not
silently trusted. The end-to-end fictional canary deliberately bypasses
real GitHub source verification *inside its synthetic-only module*; it
does not validate live source truth or constitute production acceptance.

**Bounded trigger coverage:** this is a best-effort, event-driven sender,
not a retroactive scan. The push payload must contain a complete unique
commit array of at most 50 entries and `distinct_size` must match.
Large/truncated or malformed pushes are rejected instead of silently
omitting records. GitHub API errors, ambiguous merge associations and
incomplete pagination also fail. Some unsupported merge strategies may
require an independently reviewed reconciliation procedure; these are
not automatically marked captured.

## Required separate activation

Everything remains dormant until a protected repository administrator
reviews and configures **all** of the following:

1. Activate a separately reviewed owner-scoped Cloudflare receipt inbox
   and processor with isolated encryption, machine HMAC identity,
   the named private owner RPC, and tested rollback. Do NOT put the
   owner root key into Actions or ingress. The current live ingress and
   processor are placeholders; no real merge receipt can be saved by them.
2. Deploy the exact trusted GitHub capture ingress source to the
   dedicated `knowledge-capture-ingress-private` Worker, with a
   public *signature-validated /github-only route* and pinned matching
   `CAPTURE_INGRESS_URL` at the approved Cloudflare `workers.dev` hostname.
   This is an externally accessible authentication surface; it is **not**
   authorized merely by merging this workflow.
3. Choose and explicitly set repository variable `KNOWLEDGE_CAPTURE_AUTH_MODE`
   to `github_oidc_v1` (preferred) or `hmac_v1` (legacy). The
   ingress must independently be configured with the **identical**
   `CAPTURE_AUTH_METHOD`, and must not accept the other mode's headers.
   For OIDC the ingress must **not** have `CAPTURE_WEBHOOK_SECRET`;
   the runner obtains short-lived OIDC tokens through GitHub's
   `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`
   only when the job runs. This removes the need for
   `KNOWLEDGE_CAPTURE_SIGNING_SECRET` in GitHub Actions.
   For the legacy HMAC mode only, separately configure that Actions
   secret and the matching `CAPTURE_WEBHOOK_SECRET` secret_text Worker
   binding. Never reuse owner/machine/inbox keys.
4. Configure repository variable `KNOWLEDGE_CAPTURE_INGRESS_URL`
   to the exact canonical
   `https://knowledge-capture-ingress-private.<account>.workers.dev/github`
   address. The runner refuses HTTP, mismatching Worker names,
   credentials, URL parameters, fragments or redirects.
5. After branch-protection/required-review and exact deployment checks,
   explicitly set repository variable
   `KNOWLEDGE_CAPTURE_DELIVERY_ACK=OWNER_APPROVED_GITHUB_CAPTURE_V1`.
   **Without this value the job is skipped and no token or signing secret is used.**
   This is a deliberate, reversible activation step, not performed by
   the source change.

The workflow now uses a normal `push` event on `main`, not
`pull_request_target`. Its GitHub token permissions are `contents: read` and
`pull-requests: read` for the merge association, plus `id-token: write`
for short-lived GitHub OIDC identity issuance. OIDC does **not** confer
repository content write privileges. This eliminates the previous need to
expose signing credentials on a privileged PR-closure trigger.
No checkout or PR code execution is involved.

**Branch protection remains a hard prerequisite.** A malicious person
with write access to an unprotected default branch can change the
workflow and steal an enabled signing secret. Protect `main`, enforce
trusted review and required CI before placing any signing secret or
enablement ACK in GitHub Actions. Current provider readback found
`main` unprotected on November 8, 2026. The default-disabled job
must remain inactive until that changes and is independently verified.

No `workflow_dispatch`, `pull_request_target`, PR checkout,
repository dispatch endpoint, new OAuth token or external scheduler is
introduced. Replacing this with a privileged PR event is not approved.
GitHub API reference:
https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit

## Acceptance and emergency disablement

Synthetic Node tests extract and execute the **actual inline workflow
source** in a child process using only fictional push metadata, mocked
GitHub commit-to-PR API responses, and mocked ingress transport. They
validate a 202 HMAC-signed minimal receipt, no PR body/identity leakage,
direct-push no-op, forced and incomplete-push failure, wrong repository
or branch, malformed or ambiguous API lookup, missing ACK/key/token,
unsafe endpoint and rejected ingress responses. Source/CI tests do not
prove any real provider delivery or authoritative Knowledge save.

The cross-component synthetic contract test
`test/knowledge-actions-to-owner-contract.test.mjs` goes beyond the
isolated sender mock. It executes the actual checked-in Actions inline
sender, retrieves a fictional merge association through the mocked GitHub API,
then sends its HMAC-authenticated bytes through the actual ingress
handler into a local SQLite implementation of the encrypted D1 inbox,
drains with the actual scheduled processor and machine proof, then
checks the actual owner-worker encrypted page and authenticated wiki
readback. The test also checks the repeated receipt produces no duplicate,
a tampered signed body receives 401, ciphertext excludes untrusted PR text,
and wrong repository identity refuses transport. The fixture
`test/support/knowledge-actions-wire-fixture.mjs` is intentionally
**fictional and test-only**, with separate disposable keys and zero
Cloudflare or GitHub provider network access. It does not prove actual
production delivery, original owner-key restore or trigger scheduling.

For live acceptance after the activation above, merge one reviewed
non-sensitive PR and independently verify: one Actions delivery
receives 202; encrypted inbox status advances from queued to saved;
one authorized Knowledge revision exists and reads back; a
replayed sender produces no duplicate. Rehearse negative provider
delivery and retry without falsely marking saved. Keep all source,
delivery and private authorization evidence separately scoped.

**Disable safely:** remove or change
`KNOWLEDGE_CAPTURE_DELIVERY_ACK` in the repository variables.
This prevents future job execution without touching queued receipts.
The private processor, ingress route and keys are separately
revocable, but require their own reviewed operation.
Do not delete source payloads, revoke owner recovery keys or
disconnect Notion as part of disabling this feature.

### Remaining release gates

Actual owner-key offline recovery, independently verified alerts,
production capture RPC isolation, hosted desktop/iPhone editor,
workspace isolation, historical Notion reconciliation and explicit
Notion retirement approval remain independent NO-GO requirements.

## Security and release boundaries for OIDC

GitHub Actions OIDC is **not** a free-standing authorization bypass.
The token is requested for each distinct receipt body with a digest-bound
`aud` claim and is accepted only from the specific reviewed
`.github/workflows/knowledge-merge-delivery.yml` on the trusted main
branch of repository ID `1446728034`. The identity assertion's source
SHA must match the `knowledge_push_sha` field in the body. The ingress
still checks the real GitHub PR through the public REST API and requires
exact repository ID, main base, merge SHA and normalized time before an
isolated encrypted receipt is queued.

The old `hmac_v1` integration is retained as a controlled alternative,
not an implicit fallback. Missing `CAPTURE_AUTH_METHOD`, mismatched
mode, missing JWT, invalid signature, expired assertion, wrong audience,
wrong workflow, a changed body, or missing GitHub source evidence fail
closed without queueing. If GitHub's JWKS endpoint is unreachable,
the OIDC path returns unavailable and must be retried, not accepted.
No JWT, runner token, PR body, owner key, machine key or ciphertext is
printed or stored in GitHub Actions logs.

The OIDC path removes the **GitHub Actions shared signing-secret** gate,
not the separate encrypted-inbox root key, machine HMAC proof, Access
controls, GitHub repository activation variable, Cloudflare ingress URL,
processor Cron, network exposure review, or genuine event acceptance.
Production remains disabled until those are separately approved and
independently verified. Synthetic signature and encrypted D1 tests are
not a live GitHub receipt.
