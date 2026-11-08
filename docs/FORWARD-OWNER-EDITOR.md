# Knowledge owner draft editor — source only

**Status as of 2026-11-08: implemented in source, NOT deployed or enabled.**

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

**Release gates:** Verify exact-head Node 22/24 CI and focused tests,
independently review CSRF and Access protections, separately back up production
D1, review the Worker upload/rollback and preservation of ALL existing
bindings/secrets, deploy only a reviewed new version, enable the editor ACK
in a separate controlled change and run real authenticated phone/desktop
create/read/edit/conflict/recovery tests. No source merge may set live
Worker bindings automatically. Current production remains unchanged.
