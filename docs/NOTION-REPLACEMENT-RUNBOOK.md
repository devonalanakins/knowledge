# Knowledge — Full Notion Replacement (Private Import)

Status: **PRIVATE FULL-SOURCE IMPORT PILOT — NOT CUTOVER READY**.

Notion is now read-only by owner direction. Do not write more Notion project records. Do not disconnect the Notion integration or delete its content before the complete Knowledge migration is verified.

## Source acquisition

Obtain the Notion workspace export in Markdown & CSV format, with subpages and attachments. Preserve its original ZIP as an immutable backup. Knowledge currently imports an **extracted** official export directory, not the ZIP directly. Notion's connected plugin does not provide an atomic full-workspace export action.

The exported workspace may exclude inaccessible roots, archived or deleted pages, external files, source permissions, revision histories or some database relationships. Independently reconcile all private/shared top-level roots, descendants, databases and individual rows, not merely the five previously inventoried registers.

No source ZIP, actual page text, original file names, copied assets, private SQLite database or scope map may be committed to GitHub or placed in public CI.

## Explicit scope mapping

Create a separate owner-only scope-map.json outside the source export. Its content should follow this example, replacing example root names with actual reviewed directories:

    {
      "format":"knowledge-notion-scope-map-v1",
      "rules":[
        {"prefix":"ANEVUM-EXPORT-ROOT","spaceId":"anevum","portal":"anevum-works"},
        {"prefix":"DEVON-STATION-EXPORT-ROOT","spaceId":"devonstation","portal":"independent-software"},
        {"prefix":"CRISTY-OPERATIONS-ROOT","spaceId":"cristy","portal":"cristy-professional"}
      ]
    }

Never map the entire cross-entity export to a shared workspace. Unmapped files are preserved under migration-quarantine instead of assigned by guessing. They must be classified before cutover. Same-scope relationships become private Knowledge links. Cross-space and unresolved links remain non-public provenance metadata.

## Offline private import

This is a **real file importer**. It is not a live Notion API sync. Use a trusted self-hosted machine with a reviewed, encrypted, owner-controlled destination volume; default SQLite, WAL and FTS indexes are not encrypted on their own. The environment flags below are operator assertions, **not** proof of disk encryption.

Keep the extracted source in a 0700 root with 0700 subdirectories and 0600 regular files, no symlinks. Keep the mapping file mode 0600 and the new destination's parent directory 0700. Do not extract untrusted ZIPs as root or without traversal/symlink review.

In the authorized private environment set:

    KNOWLEDGE_PRIVATE_EXPORT_IMPORT=I_APPROVE
    KNOWLEDGE_PRIVATE_STORAGE_REVIEWED=ENCRYPTED_AND_PRIVATE

Then execute:

    npm run notion:import:private -- /private/notion-extracted /private/scope-map.json /private/knowledge-new

The output directory must not already exist. Knowledge stages and validates a fresh installation containing knowledge.sqlite, an assets/ subdirectory and import-report.json. **Back up this entire new private folder (SQLite, assets, and report) as a unit on encrypted storage.** The older per-space JSON export is intentionally blocked for imported Notion records because it omits original bodies and attachment bytes; do not mistake a legacy JSON snapshot for a complete backup. It preserves complete original Markdown, CSV, and HTML text, original source IDs when available, hierarchy, original file paths and SHA-256; referenced assets are copied to the private vault and checked. Source documents stay in the immutable archive even after edits to corresponding wiki entries. The original source export is not modified.

The private importer refuses source documents over 16 MiB, individual attachments over 128 MiB, attachments exceeding 1 GiB overall, overly deep or malformed paths, duplicate Notion IDs, source changes, permissions violations and existing output. It never discards or silently truncates these items to claim completion.

## Current limitations and release blockers

CSV database files are preserved whole **and their rows are reconstructed as separate searchable Knowledge wiki entries**, retaining all headers, ordered cell values and a link to the preserved original database. Database views, complex formulas, cross-database relations, original Notion revision histories, synced blocks, unsupported external assets, missing/unavailable pages, embedded rich block layout and the actual permission graph are **not** fully reproduced or independently reconciled. Attachment bytes are preserved in the private vault, but the wiki's inline media reader is incomplete. The current active SQLite destination is not natively encrypted: a verified encrypted host volume is required before real private use.

The import report confirms counts of reconstructed CSV rows but explicitly leaves externalNotionReconciliationComplete, databaseRelationsReconciled, notionDatabaseViewsRebuilt, sourcePermissionReviewComplete, encryptedActiveDatabaseVerified, productionReady and cutoverApproved set to false.

Before disconnecting the Notion plugin, verify complete source inventory, original bodies, every database row, attachments, hierarchy/backlinks, sensitivity controls, current project decisions, independent backup and restore, desktop/iPhone reader access, and authenticated ChatGPT/Knowledge read/write. Never treat green synthetic CI, source archive counts or an owner's environment variable as a substitute for those checks.

Notion is READ-ONLY now, but source retention remains mandatory until Knowledge is ready.


## Read-only recovery of remaining Notion roots

The user's original workspace ZIP is not necessarily complete. Reconcile original
Notion IDs against each accessible private/shared root, descendants and data
source rows. Do not infer completeness from ZIP size or the old configured registers.

The owner-local hierarchy recovery command makes READ-ONLY Notion API requests
for explicit selected roots. It is a NETWORKED command, unlike the G24 offline
archive verifier. It requires independently restricted outbound access to
api.notion.com, a separately scoped Notion token, and encrypted owner-only
storage. Neither the token nor any private source content belongs in GitHub or CI.

Create a private owner-only JSON manifest containing this synthetic example:

    {
      "format": "knowledge-notion-recovery-roots-v1",
      "scopeReviewStatus": "APPROVED",
      "roots": [
        {
          "id": "11111111-1111-1111-1111-111111111111",
          "kind": "page",
          "scope": "devonstation",
          "portal": "independent-software"
        }
      ]
    }

The ID above is fictitious. Actual root IDs and scopes must be reviewed privately.
A provisional classification is rejected before the first network call. Uncertain
cross-entity records should be explicitly classified into migration-quarantine:
they remain outside the generated sharing scope map and import into the private
fallback review space.

On the approved private host set the environment values:

    KNOWLEDGE_PRIVATE_NOTION_RECOVERY=I_APPROVE
    KNOWLEDGE_PRIVATE_STORAGE_REVIEWED=ENCRYPTED_AND_PRIVATE
    NOTION_API_TOKEN=(owner-scoped API token; never commit this value)

Then execute the new command:

    npm run notion:recover:private -- /owner-only/roots.json /owner-only/new-recovery

The destination must not exist. The command follows only child pages, nested
blocks, databases and their data source rows. It iterates every cursor and
re-reads source page edit markers before publication. It preserves original
page properties and redacted block JSON, creates searchable Markdown files
with original Notion IDs and linked child-page hierarchy, and writes a private
scope-map.json and aggregate recovery-report.json. No Notion mutation method
is permitted. No page text or private source IDs are printed to stdout.

Import this recovered folder alongside the original ZIP into a NEW Knowledge
instance after reviewing overlapping IDs and scoped classifications. Do not
overwrite the already staged database or try to merge duplicate roots without
idempotent source-to-destination reconciliation.

RELEASE NO-GO: The standard Notion API may omit inaccessible or deleted pages,
original revisions, comments, source permissions and database view semantics.
The recovery currently preserves file references but DOES NOT download file
bytes; the report lists uncaptured media references and truncated property types.
Success at reading selected roots is not proof that all of Notion was recovered.
Independent source coverage, attachment fidelity, secure active Knowledge
storage, full backup/restore, private desktop/iPhone access and authenticated
ChatGPT Knowledge writeback remain separate requirements.

Notion stays read-only and retains its original records and connected plugin
until the complete replacement is independently verified and approved.
