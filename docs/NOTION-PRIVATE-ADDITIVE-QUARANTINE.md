# Knowledge — private additive Notion quarantine

**Release state:** CODE AND SYNTHETIC TESTS ONLY until an owner-controlled encrypted-volume run is independently verified. This does **not** import into live Cloudflare D1, publish a wiki page, change Notion, or approve retirement.

## What is protected

- The original 2,646 staged Knowledge records, their revisions, source originals, links, FTS indexes, and copied assets remain in a **new database copy**, unchanged. The original staged SQLite and ZIP exports are opened read-only and hash-checked.
- All eleven official Notion ZIP archives (one original workspace export and ten supplemental root exports) are retained inside the new target as **AES-256-GCM encrypted files**, checked immediately by authenticated decryption and original SHA-256.
- Additional Markdown IDs are stored in an isolated `notion_quarantine_variants` table: opaque HMAC source/member identifiers, original SHA-256 and authenticated encrypted content, distinguished as **new** or **divergent**. Candidate titles, paths, bodies, and Notion IDs are **inside the encrypted payload**, not ordinary wiki records.
- Unchanged source files do not create duplicate wiki records; the source ZIP remains encrypted provenance. Undecidable CSV rows, attachments, and unkeyed Markdown remain preserved in encrypted ZIPs but **not classified or published**.
- Original staged receipts and bundled source materials (if present) are also preserved in the private copy.
- The output is created in a new 0700 directory with 0600 files on Unix-like hosts. It will **refuse existing destinations**, untrusted ZIP paths/symlinks, incomplete originals, changed archive hashes, staged SQLite corruption, invalid passphrases, or mismatch between expected new/conflicting ID counts.

**Important encryption boundary:** The new quarantine *variants and archives* are encrypted at the application level. The copied legacy `knowledge.sqlite`, its original `records` and asset files are **not themselves encrypted by this tool**. Therefore the **entire output must live on an owner-verified encrypted local volume** (e.g. BitLocker, FileVault, LUKS) with appropriate ACLs. The CLI flag is an owner assertion, not an automated disk-encryption attestation.

The new quarantine passphrase is independent of `KNOWLEDGE_DATA_KEY` and **must not be pasted into ChatGPT/GitHub, provided on the command line, or reused as your Knowledge Worker root key**. Preserve its recovery in an independently accessible password manager.

## Run on an owner-controlled Windows workstation

First, update the repository's current development branch after the reviewed PR is merged:

```powershell
cd "$HOME\knowledge"
git fetch origin
git switch feature/knowledge-ai-wiki-g1-20261105
git pull --ff-only
```

Create a dedicated Python environment on the trusted workstation and install the pinned open-source encryption package:

```powershell
py -3 -m venv .venv-quarantine
.\.venv-quarantine\Scripts\python.exe -m pip install -r ops\private-notion\requirements-quarantine.txt
```

Keep the **extracted original private staging directory** (containing `knowledge.sqlite`, `assets/`, and `import-report.json`) and eleven original ZIP files on a private, encrypted drive. No file must be supplied to public CI or committed to this repository. To avoid the wrong ZIP being selected, supply all ten supplemental export paths explicitly. For example:

```powershell
$roots = @(
  "X:\private\notion\supplemental-01.zip"
  # ... include the other nine reviewed, exact supplemental ZIP paths here
)
$arguments = @(
  "--base-dir", "X:\private\staged-knowledge",
  "--original-zip", "X:\private\notion\original-workspace.zip",
  "--destination", "X:\private\knowledge-quarantine-new",
  "--owner-reviewed-encrypted-volume"
)
foreach ($root in $roots) { $arguments += @("--supplemental-zip", $root) }
& .\.venv-quarantine\Scripts\python.exe .\ops\private-notion\import_quarantine.py @arguments
```

The destination must **not** already exist. The script prompts twice for a new private quarantine passphrase without printing it. On completion it emits **only aggregate counts**. The prior read-only evidence for the 11 provided ZIPs predicts 874 new Markdown IDs, 425 divergent IDs, and preservation of 11 encrypted ZIPs. If the verified source counts change, the tool refuses to publish an output.

Afterward, back up the **entire new private directory** to a separate encrypted owner-held location, then test recovery of both the passphrase and the encrypted archive/variant evidence on another trusted machine. The importer's built-in synthetic decryption checks **do not** constitute independent recovery of the owner's real historical data.

## Security and production gates

- **No destination is connected to the live Knowledge MCP Worker.** `KNOWLEDGE_PRIVATE_WRITE_ACK` remains unset, and only fictional-only Knowledge acceptance writing is permitted.
- **Quarantine is not classification.** Review and approve ownership, source permissions, hierarchy, cross-scope links, medical/client restrictions, media, CSV rows, and conflicting versions before any page is eligible for a dedicated owner-only reader or import.
- **No automatic conflict resolution:** both the original staged source and every divergent supplemental version must survive. No last-writer-wins.
- **No safe restoration interface for quarantine yet:** a review-only local decrypt/rehydration tool with exact provenance and ACL checks is a subsequent reviewable task. Do not treat the new database as production-ready.
- A successful synthetic CI run demonstrates the code's defined constraints; it does not certify the real Windows volume, all ZIP source coverage, legal permissions, or the complete Notion workspace.

Documentation of source coverage: `docs/NOTION-ELEVEN-EXPORT-RECONCILIATION-2026-11-07.md`. Existing retirement gates: `docs/CUTOVER-READINESS-2026-11-07.md`. Notion remains read-only and connected until separately approved final cutover.
