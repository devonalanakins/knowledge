# Knowledge — opt-in GitHub Actions merge-event delivery

**Status 2026-11-08: SOURCE IMPLEMENTED; NOT ACTIVATED.**
This is a narrowly scoped alternative to installing a native GitHub repository
webhook through GitHub's owner settings. It does not change the existing
Cloudflare owner Worker, capture inbox, Access, keys, D1 contents or permissions.

## What it sends

The owner-controlled GitHub Actions workflow
`.github/workflows/knowledge-merge-delivery.yml` listens for a
`pull_request.closed` event and acts only when GitHub states it was merged
into the canonical `devonalanakins/knowledge` repository.

On a configured and approved release, it creates exactly one minimal
JSON object: event `closed`, PR number, immutable repository numeric ID
`1446728034`, repository slug, merge commit SHA, merged timestamp,
and `pull_request.merged=true`. It does **not** send the PR title/body,
comments, contributor identity, branches, discussion text or secrets.

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

The workflow does not check out source or execute PR content. It runs
a fixed inline Node.js script on GitHub's hosted runner and declares
`permissions: {}`. Treat edits to this workflow as a privileged
security change: protect the default branch and require trusted review.
Once a malicious workflow edit is merged into default, repo-controlled
Actions secrets could be compromised. Do not enable while workflow
modification is unreviewed.

No `workflow_dispatch`, `pull_request_target`, repository dispatch
endpoint, new OAuth token or external scheduler is introduced.

## Acceptance and emergency disablement

Synthetic Node tests extract and execute the **actual inline workflow
source** in a child process using only fictional GitHub data and a
mocked network transport. Tests validate a 202 HMAC-signed minimal
receipt, no PR body or identity leakage, refusal of wrong repository
ID, unmerged events, invalid SHA, unexpected endpoint, missing
acknowledgment/key and non-202 responses. Source and CI cannot prove
a provider event was delivered.

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
