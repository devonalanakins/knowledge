# Eleven-export Notion ZIP reconciliation — private source evidence

## November 8, 2026 — independent root inventory addendum

The authenticated legacy Notion connection listed **11 private top-level pages/databases and one directly shared top-level database**. Read-only root-ID comparison against the preserved original plus ten supplemental ZIP exports found that **all twelve roots occur in those eleven archives**. All twelve root fetches were available, without Notion writes. This establishes top-level root *presence only*, not complete descendant, attachment, permission, source-variant or revision coverage.

A combined original/supplemental ZIP comparison finds **3,312 distinct identifiers across Markdown and CSV filenames**, **3,278 distinct Markdown identifiers**, **874 new Markdown identifiers absent from the original archive**, and **425 original Markdown identities having differing supplemental bytes**. These conflicts remain immutable/quarantined, not last-writer-wins migration input. The original stage retains 2,646 reconstructed records and seven workspace scopes. Clinical/client, family, creative and professional record boundaries still require individual reviewed authorization and encrypted target storage before any promotion to live Knowledge.

This addendum updates root *presence* status without modifying or superseding the earlier source-integrity results or certifying retirement. Notion remains read-only.

---

**Date:** November 7, 2026. **Status:** READ-ONLY SOURCE RECONCILIATION VERIFIED. **Notion retirement:** NO-GO.

This evidence describes an actual aggregate-only comparison performed in an isolated working container against eleven **user-owned Notion export ZIPs** and the existing private staged Knowledge SQLite from the previously produced migration package. The raw ZIPs, SQLite bytes, source IDs, filenames, page text, private business data, media and per-document hashes are **not** in this repository or CI.

## Reconciliation result (live private files; no source mutation)

| Measure | Verified |
|---|---:|
| Source ZIP files | 11 (one original workspace ZIP + ten later root exports) |
| Original workspace archive entries | 2,499 |
| Supplemental export entries | 2,389 |
| Original Markdown page IDs with matching staged SHA-256 | 2,404 / 2,404 |
| Previously staged Knowledge records | 2,646 |
| Supplemental Markdown source IDs | 2,227 |
| Supplemental new Markdown source IDs (not already in stage) | 874 |
| Supplemental Markdown IDs overlapping the staged original | 1,353 |
| Overlapping Markdown IDs with identical bytes | 928 |
| Overlapping Markdown IDs with differing source text | 425 |
| Supplemental CSV files | 107 |
| Supplemental binary assets (SVG, PNG, JPG) | 54 |
| Supplemental Markdown files lacking a Notion ID | 1 |
| Supplemental CSV files lacking a Notion ID in the filename | 51 |

All eleven ZIPs passed integrity/CRC and bounded safe-member inspection. Original staged SQLite passed `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, and all 2,404 original Notion Markdown source bytes matched their stored stage hashes.

**Important counts:** the 2,646 staged records comprise 2,406 Markdown, 44 CSV and 196 CSV-row-derived entries; 2,404 original Markdown pages carry extractable source IDs. The 874 new Markdown IDs are not a promise of 874 new published wiki pages: every new source requires correct scope, attachments and hierarchy. The 425 divergent pages represent **candidate** versions or export differences; do not assume which is latest or overwrite the earlier original. The original source and later export must both remain recoverable.

## Repeatable verifier

`ops/private-notion/reconcile_exports.py` is a Python standard-library, **read-only** verifier. It accepts one trusted original ZIP, one staged private Knowledge SQLite, and 1–11 supplemental ZIPs. It checks ZIP CRC, path safety, symlinks, duplicate paths and resource limits; checks SQLite integrity and foreign keys; independently compares original per-document hashes to immutable stage rows; and prints **aggregate counts only**.

Example (private trusted device on encrypted storage; use actual owner-held local paths, not public CI):

```sh
python3 ops/private-notion/reconcile_exports.py \
  --staged-db /private/knowledge/knowledge.sqlite \
  --original-zip /private/notion/original.zip \
  --supplemental-zip /private/notion/root-1.zip \
  --supplemental-zip /private/notion/root-2.zip
```

Repeat `--supplemental-zip` for all ten root ZIPs. The command does **not** extract ZIPs to public directories, print any filename/source ID, write Knowledge records, modify SQLite, or connect to Notion. Run `python3 -m unittest discover -s test -p 'test_private_notion_zip_reconcile.py' -v` to verify synthetic fixture coverage. GitHub Actions runs **only synthetic fixtures**.

## Current source decision

- **Preserve unchanged:** 928 repeated original IDs with matching Markdown bytes require no second wiki body, but retain supplemental ZIP as provenance.
- **Quarantine new content:** 874 additional Markdown source IDs need an explicit reviewed workspace owner/scope and verified parent hierarchy. No automatic inclusion in `personal` or shared space.
- **Quarantine divergences:** 425 differing Markdown source IDs need a conflict-resolution/preservation plan with both immutable bodies and historical evidence, not last-writer-wins.
- **Review unkeyed sources:** the supplemental Markdown lacking a Notion ID, 51 CSV exports lacking IDs, and all CSV-row and attachment relationships need separate identity linkage.
- **Source coverage remains incomplete:** this is reconciliation of *provided archives*, not proof that Notion exports contained every accessible private/shared page or current permissions. Compare against read-only Notion root/descendant inventory before retirement.

The next increment is a **private, encrypted, additive quarantine import** and a separate provenance/attachment reconciliation, without copying any private source into public GitHub or the fictional-only live forward D1. Approving this aggregate report does not enable normal writing or permit deleting/disconnecting Notion.

Owning source PR: https://github.com/devonalanakins/knowledge/pull/1 .
