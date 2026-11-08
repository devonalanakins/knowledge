# Knowledge private quarantine: authenticated review and evidence inventory

**Status:** implemented as a local, read-only review tool. Synthetic testing is not a real Notion migration or proof of full workspace coverage.

This release adds `ops/private-notion/review_quarantine.py` after the previously merged private additive importer. Use it **only on the new owner-held quarantine directory** created by `import_quarantine.py`. It must never receive direct access to Cloudflare's live forward Knowledge D1, Notion's live API, or public source folders.

## What is independently checked

1. Open the existing quarantine SQLite database **read-only and immutable**; check SQLite integrity and foreign keys. Refuse symbolic-link paths and unexpected temporary database journals.
2. Prompt privately for the **same separate quarantine passphrase**, derive its scrypt/AES-256-GCM key from the existing random stored salt, and authenticate the key-check HMAC.
3. Enumerate encrypted originals and supplemental ZIP copies. Refuse missing/extra archives, unsafe ZIP members, bad ZIP CRCs, altered file hashes, wrong archive roles/order, or failed AES-GCM authentication. Decrypt only in memory.
4. Reconcile every encrypted supplemental candidate against the exact original ZIP Markdown member: opaque member/source HMAC, original Notion source identifier, source body SHA-256 and length, archive provenance, new/divergent disposition, and authenticated ciphertext. **Missing, changed or extra candidate rows cause failure.**
5. Compare aggregate results with the original private quarantine receipt.
6. Count CSV files and apparent data rows, unkeyed CSV/Markdown, attachment files, and heuristic Markdown link IDs. Report resolved/unresolved link **hints** only; no source names, IDs, body text, attachment bytes or per-source hashes are printed.
7. Refuse wrong passphrase and unexpected content. The review **never writes to SQLite, extracts files, changes Notion, assigns workspace scopes, creates Knowledge pages or approves publication**.

## Private Windows PowerShell procedure

Use only a trusted workstation with the **owner-reviewed encrypted disk and protected local quarantine folder**. Do not send the directory, ZIPs, database, passphrase or private output artifacts into ChatGPT or GitHub.

Update the existing Knowledge development checkout after the source is reviewed and merged:

```powershell
cd "$HOME\knowledge"
git fetch origin
git switch feature/knowledge-ai-wiki-g1-20261105
git pull --ff-only
```

Use the existing Python environment created for the quarantine importer:

```powershell
& .\.venv-quarantine\Scripts\python.exe .\ops\private-notion\review_quarantine.py --quarantine-dir "X:\private\knowledge-quarantine-new" --owner-reviewed-encrypted-volume
```

Enter your locally stored **quarantine** passphrase at the hidden prompt (not the Cloudflare Knowledge root key). The output contains counts only. If the full eleven-export staging has already been created successfully with the original verified inputs, the expected **unique** Markdown source candidate counts are **874 new** and **425 divergent**; additional variant rows may exceed those counts when more than one supplemental ZIP contains the same Notion ID.

The output also identifies source CSV rows, attachments and unresolved link hints, but these numbers **are not migration parity certifications**. Neither CSV rows nor attachments are automatically promoted. Keep the full quarantine directory and backup copies intact for separate local review and later approved scope classification.

## Separate remaining requirements

- There is **no authenticated interactive review UI** for individual quarantined pages yet. This command intentionally does not print private names or reveal content.
- Historical permissions, business/entity ownership, sensitive clinical/client boundaries and exact Notion link semantics remain unverified.
- Markdown link hints are heuristic and cannot be interpreted as complete Notion backlinks or authorized cross-space relationships.
- Large/invalid CSVs cause the review to fail safely or report an aggregate parse-warning count; CSV rows require independent relation/identity verification before any import.
- The copy of the legacy staging SQLite/assets remains plaintext on disk **inside the required encrypted OS volume**. The sealed ZIPs and candidate variants have additional application-level AES-256-GCM encryption. Neither design authorizes a public Knowledge endpoint or distribution to another user.
- Real owner-controlled quarantine creation, off-device recovery, minimum private hosted wiki, Notion source parity and the explicit final Notion retirement decision are still release gates. The live Knowledge MCP remains fictional-write-only.

Tests run on **synthetic exports only** in CI. See `test/test_private_notion_quarantine_review.py`, `docs/NOTION-PRIVATE-ADDITIVE-QUARANTINE.md` and `docs/CUTOVER-READINESS-2026-11-07.md`.
