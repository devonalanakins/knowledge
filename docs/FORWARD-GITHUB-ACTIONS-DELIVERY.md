# Knowledge — opt-in GitHub Actions merge-event delivery

**Status 2026-11-08: SOURCE IMPLEMENTED; NOT ACTIVATED.**
This is a narrowly scoped alternative to installing a native GitHub repository
webhook through GitHub's owner settings. It does not change the existing
Cloudflare owner Worker, capture inbox, Access, keys, D1 contents or permissions.

## What it sends

The owner-controlled GitHub Actions workflow
`.github/workflows/knowledge-merge-delivery.yml` listens for a
`pull_request_target.closed` event and acts only when GitHub states it was merged
into the canonical `devonalanakins/knowledge` repository, **and the
pull request targets its `main` base branch and pinned base repository ID**.

On a configured and approved release, it creates exactly one minimal
JSON object: event `closed`, PR number, immutable repository numeric ID
`1446728034`, repository slug, merge commit SHA, merged timestamp,
and `pull_request.merged=true`. It does **not** send the PR title/body,
comments, contributor identity, branches, discussion text or secrets.

The sender checks the repository identity in both the event-level
repository and the PR base repository, plus `base.ref=main`. An
otherwise legitimate merge into a development or release branch must
not generate a canonical Knowledge milestone. This branch check is
performed both by the GitHub Actions job condition and the fixed inline
runtime, before any signing secret is used for transport.

The workflow HMAC-signs the exact JSON bytes with a repository Actions
secret. It sends `POST /github` with
`X-Hub-Signature-256`, `X-GitHub-Event=pull_request`, a synthetic
UUID delivery ID, and `Content-Type=application/json`. A 202 response
means the encrypted D1 inbox durably accepted the receipt, not that the
Knowledge project record has been saved. Only the separate authorized
processor/owner readback can attest that later state.

**Provenance boundary:** The HMAC signature is made by a protected GitHub
Actions run, **not by GitHub's native webhook delivery system**. It
authenticates the configured Actions sender to the Cloudflare ingress;
it is not independent evidence that GitHub signed the original event.
The inbox still enforces the pinned repository ID, personal path prefix,
draft-only canonical receipt format, and verified owner readback.

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

The workflow uses **`pull_request_target`**, not ordinary
`pull_request`, because fork-originated pull-request workflows normally
cannot receive repository Actions secrets. The target event executes
the workflow definition from the trusted default branch, not PR-proposed
workflow changes. This lets merges from approved external contributors
be handled without enabling fork-secret access in general CI.

No PR code or checkout is executed: a fixed inline Node.js sender receives
only a minimal allowlisted metadata object. The workflow declares
`permissions: {}` to deny a scoped GitHub token despite the normally
privileged target event. This is a high-trust workflow; treat edits as a
privileged security change. Protect the default branch and require
trusted review before enabling its secret.
Once a malicious workflow edit is merged into default, repo-controlled
Actions secrets could be compromised. Do not enable while workflow
modification is unreviewed.

No `workflow_dispatch`, PR checkout, repository dispatch endpoint,
new OAuth token or external scheduler is introduced. Do NOT replace this
with a privileged PR checkout or add runtime code from a fork.
GitHub's event security reference:
https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target

## Acceptance and emergency disablement

Synthetic Node tests extract and execute the **actual inline workflow
source** in a child process using only fictional GitHub data and a
mocked network transport. Tests validate a 202 HMAC-signed minimal
receipt, no PR body or identity leakage, refusal of wrong repository
ID, unmerged events, invalid SHA, unexpected endpoint, missing
acknowledgment/key and non-202 responses. Source and CI cannot prove
a provider event was delivered.

The cross-component synthetic contract test
`test/knowledge-actions-to-owner-contract.test.mjs` goes beyond the
isolated sender mock. It executes the actual checked-in Actions inline
sender, sends its HMAC-authenticated bytes through the actual ingress
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
