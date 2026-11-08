# Knowledge owner draft editor — deployed, real-user acceptance pending

**Operational status as of 2026-11-08: enabled for owner-only, existing nonclinical personal drafts.** The source-level security tests and Cloudflare configuration were verified, but actual authenticated desktop/iPhone editor use has not been independently accepted. **Do not label full editor UX VERIFIED until real hosted create/read/edit/conflict/recovery checks pass.**

The existing owner-only Cloudflare Knowledge Worker now contains a separate
opt-in HTML draft-editor route, alongside its unchanged /mcp and read-only /wiki
routes. It uses the SAME encrypted D1 page writer, not a replacement database.

- GET /wiki/edit/<path> renders an owner-only HTML form for an EXISTING draft.
- POST /wiki/edit/<path> requires direct Cloudflare Access owner identity,
  matching same-origin Origin and optional Sec-Fetch-Site, strict form content
  type/field count, and HMAC anti-CSRF token bound to scope, owner, path and
  existing revision. The CSRF subkey is domain-separated from content, path
  indexing, pagination and search keys.
- Saving calls the existing expectedVersion-guarded, transactional encrypted
  writer; it verifies exact title/body/**expected new version** by re-reading
  D1 before displaying SAVED. A no-change submission confirms that the existing
  revision is already stored without claiming a new revision or mutating history. A stale version shows HTTP 409 and retains attempted
  text for manual reconciliation; no automatic overwrites.
- Read-only mode remains the default, including for a Worker without the
  explicit KNOWLEDGE_OWNER_EDITOR_ACK=OWNER_ONLY_DRAFT_EDITOR_V1 binding.
  The editor additionally requires the existing browser ACK and unrestricted
  nonclinical private-write ACK. Acceptance-only/fictional mode cannot edit.
- HTML escapes all draft contents. The editor uses no JavaScript or external
  assets. Browser security headers continue to deny active content, caching,
  framing and indexing. It provides keyboard labels, accessible alert and
  status messages, touch-sized save control and narrow-viewport layouts.

**Limitations:** Only edits of existing owner-scoped nonclinical drafts.
Creation, collections, shared editors, permissions, native rich Markdown,
autosave, attachments and private historical import are not in this release.
Do not enable public access or use this interface for clinical/client data.
An owner still needs an actual authenticated desktop and iPhone acceptance
test before the interface is called production-ready.

**Release evidence (November 8, 2026):**

- Source `main` `cd68e6b6d2ffa3acdfd0761875d5b3dab66122eb`; exact-head [GitHub Actions run #42527081748](https://github.com/devonalanakins/knowledge/actions/runs/42527081748) passed `node (22)`, `node (24)` and `G24 offline encrypted vault container isolation`.
- Reviewed source deployed first to a separate, non-live Cloudflare version `1d9b9116-d16d-4d95-89df-95143328a9d6`, then promoted at 100%. A subsequent separately applied editor ACK produced live owner Worker version `081c4244-a568-4dd0-9c82-0695b27b0e4d` at 100%.
- Existing 10 Worker bindings matched by name/type before deployment and remain present afterward; the only additional binding is `KNOWLEDGE_OWNER_EDITOR_ACK`. The machine-capture secret/binding remains absent. Cloudflare Access still has the existing owner-only self-hosted app and one email allow policy.
- Scheduled private R2 ciphertext snapshot from 08:00 UTC independently read back with its stored SHA-256 and exactly matched the live D1 instance, page and revision rows: 1 instance, 3 encrypted pages, 8 immutable revisions. No new data migration or overwrite. This is a **same-provider snapshot**, not an assistant-witnessed off-provider owner-key restore.
- Authenticated ChatGPT Knowledge read of `projects/devonstation-knowledge` succeeded after deployment and editor activation; the existing draft remains version 4. The owner editor's actual hosted GET/POST and conflict workflow have **not** been validated through an authenticated desktop/iPhone browser, and no browser POST was attempted here.
- Last previous production deployment `bf1ea505-df98-4e77-ab30-92ba4610f7f7` is retained for rollback. Remove/revoke the separate editor ACK to disable editing if acceptance fails; preserve existing records, credentials, encrypted D1 and original Notion archives.

**Outstanding human acceptance:** On both desktop and iPhone, sign in as the authorized owner, open an existing non-sensitive draft, confirm a no-change save does not create a revision, make one intentional edit and verify exact revision readback, then test stale-version 409 reconciliation and navigation. Recheck the actual protected route and rollback behavior. Do not use patient/client records. Owner approval of the full human UX, historical Notion parity, cross-scope controls, automatic ChatGPT capture and Notion retirement are separate gates.
