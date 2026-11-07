# ChatGPT → Knowledge cutover setup

**Operating policy locked:** November 7, 2026. **Migration status:** NOT READY FOR PRODUCTION CUTOVER.

This document supplements [the private Notion replacement runbook](NOTION-REPLACEMENT-RUNBOOK.md) and [the active migration draft PR](https://github.com/devonalanakins/knowledge/pull/1). It does not certify deployment or source completeness.

## Current decision — stop the dual-write problem

- Stop writing **new** records to Notion now. Do not update project progress there, mirror GitHub changes there or run incremental Notion→Knowledge synchronization merely because a developer completes work.
- Keep Notion connected only as a **read-only historical input** while source recovery and validation proceed. Its previous role as a routine operating hub is superseded.
- Knowledge is the intended owner of durable project decisions, wiki articles and record history **after** private production authentication and ChatGPT read/write are verified.
- GitHub owns code, issues, PRs and CI evidence. Cloudflare (or the verified actual hosting provider) owns live deployment truth. These remain distinct from Knowledge.
- Until Knowledge is securely writable, record non-sensitive engineering checkpoints in the **existing** owning GitHub issue/PR. For private personal/family/business/clinical decisions without a separately authorized protected store, provide a clearly marked `PENDING KNOWLEDGE / UNSAVED` handoff rather than inventing a saved page or using an unsafe/public fallback.

## ChatGPT skill and instruction migration

Update the **existing** custom skills, not their names or invocation model:

| Skill | Required change |
| --- | --- |
| Fresh Chat Continuity | Route new project decisions and session handoffs to verified Knowledge; no new Notion checkpoints |
| Verified Software Delivery | Use current repo/CI and deployed provider for evidence; write to Knowledge only after readback |
| AI Code Integrity Audit | Source-ground review; no Notion findings writeback |
| Visual Briefing & Design Review | Knowledge-first context; respect pending state |
| Rigorous Inquiry | Research continuity in Knowledge when accessible; never create Notion learning notes |

Install full **single-skill ZIP archives** for each changed skill in ChatGPT's Skills interface. Avoid having stale duplicate versions enabled. Skills and custom instructions can express policy, but **cannot by themselves** deploy Knowledge or install an authenticated connector. Other installed skills that do not write Notion do not need to be changed just for this cutover.

For any account/workspace custom instructions, add the concise rule:

> Effective November 7, 2026, Notion is read-only legacy migration evidence; never create or update Notion records. DevonStation Knowledge is the designated durable wiki, but only claim a record was saved after an authorized authenticated Knowledge write and readback. Until then, put non-sensitive engineering progress in its existing GitHub issue/PR and mark private decisions PENDING KNOWLEDGE / UNSAVED. Preserve entity boundaries and never claim migration, deployment or cutover complete without verified evidence.

## Source/data completion — no destructive shortcut

1. Preserve the original owner-supplied export, encrypted archive, previous staging output and source hashes. Do not restart the migration or overwrite the staged store.
2. Independently enumerate and recover the outstanding Notion roots and their descendants using approved private read-only source access. Use `npm run notion:recover:private` only in a trusted, encrypted owner-controlled environment with authorized scopes.
3. Reconcile the original source IDs, databases, every row, links/relations, assets, ownership, unsupported Notion features and archive omissions. Quarantine unknown/conflicting scopes. The current archive and API can each miss content.
4. Import recovered sources into a fresh/reconcilable private target, **never** overwrite originals or silently duplicate existing IDs. Preserve original source bodies, normalized wiki projection and provenance independently.
5. Verify an **independent fresh restore** of encrypted originals and Knowledge database/asset vault and test search, links, correct record bodies, scope checks, revision history and permission boundaries.

## Secure product/connector completion

1. Implement reviewed private persistent Knowledge hosting, authenticated desktop and iPhone reader, access-scoped editing, active data-at-rest protection, backups, logging, recovery and abuse protection.
2. Establish verified Cloudflare Access/Managed OAuth (or an independently reviewed supported identity route) and a private remote MCP/connector compatible with the actual ChatGPT environment. The current synthetic read-only endpoint is **not** proof of production integration.
3. Exercise a real authorized identity through: list → search → read → consented draft capture/update → readback of exact page ID/revision/scope. Test wrong user/scope, network faults, conflict handling, refusal to publish and approval separation.
4. Do not make an unauthenticated/public endpoint available merely to connect ChatGPT. Never treat a successful provider build or synthetic CI as user-facing functionality.

## Retirement approval gate

The owner must review independent PASS evidence for **all** of the following before disconnecting Notion: complete source inventory and reconciliation, lossless recoverable originals, verified encrypted backup/restore, correct per-entity permissions, production Knowledge desktop/iPhone read/write, working authenticated ChatGPT Knowledge integration, and rollback. Retain the original secured export even after disconnect unless separately approved for disposal. Deleting Notion source records is a distinct consequential action requiring separate approval.

## Truthful status vocabulary

- `LOCKED` = approved direction, not necessarily implemented.
- `IMPLEMENTED` = code or artifact exists at an exact SHA/path.
- `VERIFIED` = named checks were observed.
- `LIVE` = actual production endpoint and user path observed.
- `PENDING KNOWLEDGE / UNSAVED` = required record has not reached a verified authorized Knowledge store.
- `CUTOVER NO-GO` = at least one retirement prerequisite remains unmet.

**No automatic Notion deletion, synchronization job, production merge or deploy is authorized by this documentation.**
