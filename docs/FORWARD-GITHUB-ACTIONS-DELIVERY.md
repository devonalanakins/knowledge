# Knowledge — opt-in GitHub Actions merge-event delivery

**Status 2026-11-08: SOURCE IMPLEMENTED; NOT ACTIVATED.**
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

The workflow HMAC-signs the **exact JSON bytes** with an independently
held Actions secret. It sends HTTPS `POST /github` to the allowlisted
Cloudflare ingress with the existing `X-Hub-Signature-256` header,
`X-GitHub-Event=pull_request` and a UUID delivery ID. The header is an
internal **Actions-originated signature**, not a native GitHub webhook.
Cloudflare independently verifies its own shared signing secret.
A 202 response means the encrypted D1 inbox accepted a receipt, NOT that
the authoritative Knowledge record was saved. Only the separately
authenticated owner write/readback can certify `SAVED`.

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
3. Configure repository Actions secret `KNOWLEDGE_CAPTURE_SIGNING_SECRET`
   with a fresh independent >=32-byte random value equal to the ingress
   `CAPTURE_WEBHOOK_SECRET` binding. Never print it, share with ChatGPT,
   store in workflow text or reuse a Knowledge root/recovery/machine key.
4. Configure repository variable `KNOWLEDGE_CAPTURE_INGRESS_URL`
   to the exact canonical
   `https://knowledge-capture-ingress-private.<account>.workers.dev/github`
   address. The runner refuses HTTP, mismatching Worker names,
   credentials, URL parameters, fragments or redirects.
5. After branch-protection/required-review and exact deployment checks,
   explicitly set repository variable
   `KNOWLEDGE_CAPTURE_DELIVERY_ACK=OWNER_APPROVED_GITHUB_CAPTURE_V1`.
   **Without this value the job is skipped and no secret is read.**
   This is a deliberate, reversible activation step, not performed by
   the source change.

The workflow now uses a normal `push` event on `main`, not
`pull_request_target`. Its only GitHub token permissions are
`contents: read` and `pull-requests: read` so it can verify the
push-to-merged-PR association. This eliminates the previous need to
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
