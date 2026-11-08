# Knowledge — private Notion ownership and scope proposals

**Release classification: owner-local review support only.** This does not publish, promote, share, or grant permissions for any record. Notion remains read-only, and the live Knowledge Worker stays fictional-write-only.

After the verified 11-export additive quarantine has been created and independently backed up on an encrypted owner-controlled disk, use `ops/private-notion/scope_review.py` to review one preserved source variant at a time. The existing authenticated quarantine review is run as a prerequisite **before every action**. No private source bytes or recovered keys are submitted to ChatGPT, GitHub Actions, Cloudflare, or other applications.

## Supported actions

`inventory`: reports only aggregate quarantined variant and proposal counts. Does not reveal source names or content.

`show`: requires `--reveal-local` **and** a trusted interactive terminal. It displays the selected variant's original source name and at most the first 800 characters locally. `--full` intentionally reveals the entire original body in that terminal. This is **not safe on shared, recorded, remotely observed, or logged terminals**, and some source material might require an independently authorized clinical/business reviewer. Do not show content you are not permitted to access.

`propose`: stores one manually chosen, **non-authorizing** workspace proposal in a *new* AES-256-GCM-encrypted ledger file; it never alters or overwrites previous ledger versions or the quarantine database. Decisions are bound to the exact quarantine SQLite SHA-256 and the specific sealed source variant, and successive files reference the checksum of their preceding ledger. This is a local preservation chain, **not an independent tamper-proof audit log**. Retain and back up the full chain.

Valid proposed workspace categories are `personal`, `family`, `cristy`, `devonstation`, `mizvo`, `anevum`, and `unassigned`. The only classifications are `unknown`, `nonclinical`, `sensitive`, and `clinical-or-client`. `unknown`, `clinical-or-client`, or `unresolved` decisions must remain **unassigned**. No category grants any read/write permission or approves import. A named, appropriately authorized reviewer and subsequent access-control release are needed before any record can enter a normal Knowledge workspace.

## Owner-controlled Windows PowerShell example

From the already updated `knowledge` development checkout, using the Python environment created for the quarantine importer:

```powershell
cd "$HOME\knowledge"
$py = ".\.venv-quarantine\Scripts\python.exe"
$private = "X:\private\knowledge-quarantine-new"   # your actual encrypted-volume location

# Aggregate-only; no record names or text
& $py .\ops\private-notion\scope_review.py --quarantine-dir $private --owner-reviewed-encrypted-volume inventory

# Only on a trusted private terminal after confirming permission to view content
& $py .\ops\private-notion\scope_review.py --quarantine-dir $private --owner-reviewed-encrypted-volume show --variant-id 1 --reveal-local

# Example: unresolved and unknown source remains unassigned, no access granted
& $py .\ops\private-notion\scope_review.py --quarantine-dir $private --owner-reviewed-encrypted-volume propose --variant-id 1 --scope unassigned --classification unknown --reason unresolved --output "X:\private\scope-ledger-0001.enc.json"

# Every additional proposal creates a different file and references the preceding ledger
& $py .\ops\private-notion\scope_review.py --quarantine-dir $private --owner-reviewed-encrypted-volume propose --variant-id 2 --scope unassigned --classification clinical-or-client --reason requires-second-review --ledger "X:\private\scope-ledger-0001.enc.json" --output "X:\private\scope-ledger-0002.enc.json"

# Confirm the existing ledger remains authenticated and its private counts unchanged
& $py .\ops\private-notion\scope_review.py --quarantine-dir $private --owner-reviewed-encrypted-volume inventory --ledger "X:\private\scope-ledger-0002.enc.json"
```

The command prompts privately for the **separate quarantine passphrase**. Do not supply it in command arguments, screenshots, chats, CI secrets, or GitHub. A trusted encrypted volume is required, but the supplied flag is a *manual owner assertion*, not automated BitLocker/FileVault verification.

The local output for `show` can contain sensitive/private material. It must never be included in normal engineering logs. The ledger is encrypted but retains a database fingerprint and non-sensitive format/revision metadata; store it only on the verified owner-controlled encrypted volume. Each ledger filename must not already exist; the source database and prior ledger files remain untouched.

## Acceptance and remaining boundaries

Synthetic-only CI checks refuse wrong keys, changed/corrupted ledger ciphertext, altered source databases, unauthorized scopes, missing variants, symlink output targets, non-interactive content disclosure, and silent overwrites. They confirm **only** that the local tool works with synthetic fixtures.

There is **no record promotion, role-based sharing, clinical authorization, or migration into Cloudflare** in this release. CSV row mapping, attachments, parent relationships, cross-scope links, complete live Notion permission parity, a secure desktop/mobile reader, and explicit final cutover sign-off all remain gates before removing Notion. The original eleven ZIP exports and historical staging databases must remain preserved.

Related: `docs/NOTION-PRIVATE-ADDITIVE-QUARANTINE.md`, `docs/NOTION-PRIVATE-QUARANTINE-REVIEW.md`, and `docs/CUTOVER-READINESS-2026-11-07.md`.
