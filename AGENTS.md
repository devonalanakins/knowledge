# Knowledge repository — agent operating instructions

> Effective 2026-11-07. Scope: source changes and migration work in this repository.
> For production actions, repository instructions do not replace owner approval, security review, or live evidence.

## Canonical record policy

- **Notion is read-only migration evidence.** Never create or update a Notion project page, tracker, status checkpoint, memory item, or dual-write sync. Do not disconnect the Notion source, revoke recovery access, or delete original content before the separately approved verified cutover.
- **DevonStation Knowledge is the approved destination for durable wiki and project records, but it is not yet assumed deployed or linked to ChatGPT.** Only say a Knowledge record was saved after an authenticated write to the intended protected deployment and independent readback of the correct revision and scope.
- Until then, write non-sensitive **engineering evidence** only in the existing owning GitHub issue/PR. For private or cross-entity decisions that lack an authorized secure sink, produce a clearly marked **PENDING KNOWLEDGE / UNSAVED** handoff; never save that content in public issues, logs or test artifacts.
- Do not pretend existing synthetic MCP/OAuth tests prove production. A private imported SQLite archive is not an authenticated live Knowledge wiki.

## Migration and security

1. Read `docs/NOTION-REPLACEMENT-RUNBOOK.md` and `docs/CHATGPT-KNOWLEDGE-CUTOVER.md` before migration or recordkeeping changes.
2. Preserve original export bytes, provenance, source IDs and ownership classification. Independently reconcile missing Notion roots, descendants, rows, assets and relationships; quarantine ambiguous scopes.
3. Do not copy source ZIPs, names, attachments, SQLite data, credentials, approval secrets or patient/client materials to Git, public CI, generated fixtures or chat.
4. Use protected encrypted storage, least-privilege identity and access controls. An environment flag alone is not proof of encryption or authorization. Keep personal, family, Cristy professional/clinical, ANEVUM, DevonStation and clients separated.
5. Verify independent restore, authenticated desktop/iPhone access, scope isolation and actual ChatGPT read/search/write/readback before cutover. No automatic migration approval from a passing synthetic test.

## Engineering workflow

Inspect latest branch, issue/PR, owning source and release gates before editing. Work in reviewable increments, run `npm run check` and `npm test` or report why not run, and cite exact CI/commit SHA. Never claim merged, deployed, authenticated, integrated, or live without matching evidence. Prefer PRs over direct changes to protected branches. Recheck the destination branch and latest owner instruction; older migration milestones are historical.

This policy governs new work and does **not** retrospectively change an old Notion record or mean the Notion connector can already be removed.
