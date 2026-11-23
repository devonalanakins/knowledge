# Knowledge product transition: the Dadog Memory engine

**Owner decision:** November 23, 2026  
**Status:** LOCKED direction; migration and integration NOT IMPLEMENTED  
**Audience:** public engineering collaborators; **do not place private user records here**

## Decision

The planned **standalone Knowledge application UI** is now **PARKED** as a separate long-term product. Its intended personal end-user experience will become **Memory inside Dadog**. Knowledge remains valuable, maintained **source infrastructure and historical evidence**: search, source references, versioned records, owner-only authenticated drafts, encrypted storage, backups, restore and readback should be evaluated and reused rather than thrown away.

**PARKED refers to the separate product/UI roadmap, not to a shutdown of existing protected services, data stores, security patches, or backups.** This is not authorization to archive the repository, delete its data, stop cron or alerts, migrate credentials, rewrite identity boundaries or merge outstanding drafts. Current source functionality and release gates remain in force until independently verified successor functionality and an approved cutover.

The target product is Dadog, a separate private personal assistant application. Its private owner interface is not the same as its public-safe Home Screen shell. Dadog Memory is **not ChatGPT's built-in Memory**, and this decision does not guarantee cross-chat recall in ChatGPT.

## Preserve vs. park

| Area | Direction |
| --- | --- |
| Knowledge backend, self-hostable code, read/search, immutable revisions, source provenance and licensed source history | **RETAIN**; evaluate an authenticated private adapter to Dadog |
| Encrypted private owner records and keys, backups, restore and access controls | **PRESERVE**; no destructive migration or permission change |
| Standalone Knowledge UI expansions and broad new manual-wiki feature development | **PARK** unless necessary for recovery, security, usability of existing data, or migration proof |
| Pending PRs for explorer/sharing and migrations | **REVIEW INDIVIDUALLY**; no automatic merge or closure |
| Read-only Notion originals and migration/quarantine inventory | **RETAIN READ-ONLY**; no new Notion writes or retirement |
| Dadog's unified Memory interface, read-only adapter and owner memory controls | **TARGET / NOT CONNECTED**; first prove a protected read-only slice |
| Other businesses, clinical content, shared teams and public publishing | **OUT OF SCOPE**; no implicit data co-mingling |

## Adapter-first integration requirements

1. **Authenticate before querying.** Implement owner-only server-side access to the retained Knowledge core from Dadog's protected app, never through the public-safe shell or by sending private bearer tokens to client JavaScript.
2. **Keep scopes distinct.** Personal, family, independent engineering and other entities must not silently share search results. No Nona/client/clinical ingestion without separate approved security and contractual controls.
3. **Make evidence explicit.** A retrieved item reports its source, revision, scope, freshness and classification (user-stated intention, proposal, owner-approved decision, verified observation, superseded or pending write). Do not portray synthetic neural visualizations as the AI's internal thoughts.
4. **Write only after owner-reviewed consent.** Check the existing revision first, use the established compare-and-swap/draft policy, and independently read back the correct id/version/scope before displaying “saved.” A refused `ACCESS_REQUIRED` call is **unsaved**.
5. **Build memory controls.** Correction with version history, export, owner-directed removal/retention and auditable change history must be defined before retiring standalone owner access. Retained backups require explicit deletion/retention semantics.
6. **Self-hostability.** Prefer a portable adapter API over binding Dadog's product model directly to one host's private D1/Cloudflare configuration. Preserve repository license obligations on reuse.
7. **No automatic personal data into GitHub.** Store only engineering diagrams, schemas, synthetic test content and evidence. Never commit private household commitments, family conversations, health details, access tokens, archives or real memory payloads.

## Cutover acceptance, not a calendar promise

- Inventory and recover current owner records, historic source IDs, revisions, backups and attached content (where applicable); verify an independent restore.
- Demonstrate owner/anonymous/wrong-owner/revoked-owner and cross-scope access tests on a real protected environment.
- Prove Dadog can fetch one allowed synthetic record and display source, scope and revision; fail closed when unavailable or unauthorized.
- Only after protected read acceptance, implement owner-approved capture, correction, idempotent update and verified readback.
- Require iPhone and desktop acceptance, export/retention and rollback proof, exact-head CI and security review.
- Get separate owner approval before disabling endpoints, archiving this repository, modifying production storage or keys, or deleting any data.

## Current observed blocker

On November 23, 2026 the current ChatGPT → private Knowledge connector returned `FORBIDDEN: ACCESS_REQUIRED` on an attempted read/search. This **does not prove the underlying Worker or data is offline**. It means no record could be verified or written through that session. The existing authorization/reconnection engineering work remains relevant, now primarily as a safe bridge into Dadog Memory.

## References

- `AGENTS.md`: no-Notion-writes, migration provenance, privacy and release policy.
- `docs/CHATGPT-KNOWLEDGE-CUTOVER.md`: owner capture implementation and separate ChatGPT integration gate.
- `docs/NOTION-REPLACEMENT-RUNBOOK.md`: historical source preservation/retirement gates.
- Dadog's private source repository and its 2026-11-23 memory ADR contain the owner-only experience design. Do not mirror any private memory records here.

**This record changes direction only. No code, existing data, deployment or storage endpoint is migrated by the document itself.**
