# Owner-only Knowledge Markdown downloads

**Status:** source implementation, awaiting CI and owner-browser acceptance. This is a small, working export slice toward the larger files-and-records workspace; it is not an attachment hosting or historical recovery system.

## User journey

1. The already authenticated owner opens a current private record or selects it in the compact explorer.
2. The **Download .md** link performs a GET to `/wiki/download/<validated-path>` at the same Knowledge origin. No automatic download or background export is issued.
3. The existing Worker checks the direct Cloudflare Access audience/email, derives the current encrypted instance keys, and authenticates/decrypts exactly that record from D1.
4. The response sends **the original Markdown body unchanged** as `text/markdown` with `Content-Disposition: attachment`, `nosniff`, `private, no-store`, `no-referrer`, a strict sandbox CSP, and an ASCII filename made from the validated canonical path. An absent path is denied without disclosing another record's body.
5. Historical revision views do not offer a misleading latest-record download. They remain available via version history; revision-specific exports would need their own explicit UX and safety verification.

Example: `projects/test/overview` becomes `projects__test__overview.md`. Double underscores cannot occur in valid source path components, so filenames remain reversible.

## Security boundary

- The **downloaded file is readable plaintext** outside Knowledge's server-side encryption and can be copied, synced or backed up by the user's device. Use a trusted device; do not treat a local download as an encrypted backup or share it without separate authorization.
- This route is owner-only. It does not create public links, external recipients, file upload grants, new tenants, or permission changes. It never decrypts unrelated records.
- The feature does not persist an extra server-side copy, change the historical Notion archives, or touch the public snapshot viewer.
- This is **not** a complete portable backup. Plain Markdown downloads do not include all metadata, history, attachments, relationships, ACLs or encryption keys.

## Acceptance

- Source checks: Node 22/24 and isolated G24; unit checks for exact content, filename/path rejection, response security headers; integration checks for owner Access, missing/wrong path, unsupported methods, no D1 mutation.
- Before production: verify actual owner iPhone download and file round-trip, accessibility and trusted-device messaging; compare the active Worker source and bindings, observe rollback version, then approve a controlled owner-only release.
- Notion remains READ-ONLY and unretired; Drive-style upload, previews, folders, file versions and recipient sharing are separate future scope.
