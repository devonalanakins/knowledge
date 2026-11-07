#!/usr/bin/env python3
"""Owner-local, append-only Knowledge Notion recovery merge.

Merges a verified *read-only* staged Knowledge database with an explicitly
scoped private recovered hierarchy. Publishes ONLY a fresh destination.
All imported original Markdown and Notion JSON are immutable source evidence.
No Notion network operations, no modification of original database or export.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

NOTION_ID = re.compile(r"\s([a-f0-9]{32})\.md$", re.I)
HEX = re.compile(r"^[a-f0-9]{32}$", re.I)
SCOPES = {"anevum", "devonstation", "mizvo", "cristy", "family", "personal", "migration-quarantine"}
KINDS = {"knowledge-notion-original-page-v1", "knowledge-notion-original-database-v1"}
MAX_FILES, MAX_MARKDOWN, MAX_JSON = 10000, 16 * 1024 * 1024, 32 * 1024 * 1024


class MergeError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def insist(condition, code):
    if not condition:
        raise MergeError(code)


def owner_node(path, is_dir=False):
    path = Path(path)
    st = path.lstat()
    insist(stat.S_ISDIR(st.st_mode) if is_dir else stat.S_ISREG(st.st_mode), "UNSAFE_NODE_TYPE")
    insist(not path.is_symlink() and not (st.st_mode & 0o077), "UNSAFE_NODE_PERMISSIONS")
    insist(st.st_uid == os.getuid(), "UNSAFE_NODE_OWNER")
    if not is_dir:
        insist(st.st_nlink == 1, "UNSAFE_HARDLINK")
    return st


def hash_bytes(data):
    return hashlib.sha256(data).hexdigest()


def json_file(path, max_bytes=MAX_JSON):
    owner_node(path)
    insist(path.stat().st_size <= max_bytes, "SOURCE_LIMIT_EXCEEDED")
    return json.loads(path.read_text(encoding="utf-8"))


def inventory_recovery(source):
    source = Path(source).resolve(strict=True)
    owner_node(source, is_dir=True)
    scope_map = json_file(source / "scope-map.json")
    report = json_file(source / "recovery-report.json")
    insist(scope_map.get("format") == "knowledge-notion-scope-map-v1", "SCOPE_MAP_INVALID")
    insist(report.get("sourceUnmodified") is True and report.get("cutoverApproved") is False,
           "SOURCE_REPORT_INVALID")
    rules = scope_map.get("rules")
    insist(isinstance(rules, list), "SCOPE_MAP_INVALID")
    for rule in rules:
        insist(rule.get("spaceId") in SCOPES and isinstance(rule.get("portal"), str)
               and isinstance(rule.get("prefix"), str) and ".." not in rule["prefix"].split("/"),
               "SCOPE_MAP_INVALID")
    entries = []
    scanned = 0
    metadata_paths = set()
    markdown_paths = set()
    for current, dirs, files in os.walk(source, followlinks=False):
        current = Path(current)
        owner_node(current, is_dir=True)
        for directory in dirs:
            owner_node(current / directory, is_dir=True)
        for filename in files:
            scanned += 1
            insist(scanned <= MAX_FILES, "SOURCE_LIMIT_EXCEEDED")
            path = current / filename
            owner_node(path)
            rel_file = path.relative_to(source).as_posix()
            if filename.endswith(".notion.json"):
                metadata_paths.add(rel_file)
                continue
            if not filename.lower().endswith(".md"):
                insist(rel_file in ("scope-map.json", "recovery-report.json"),
                       "UNEXPECTED_RECOVERY_FILE")
                continue
            markdown_paths.add(rel_file)
            match = NOTION_ID.search(filename)
            insist(match is not None, "SOURCE_ID_MISSING")
            ident = match.group(1).lower()
            rel = path.relative_to(source).as_posix()
            raw_path = path.with_suffix(".notion.json")
            raw = json_file(raw_path)
            insist(raw.get("format") in KINDS, "SOURCE_METADATA_INVALID")
            original = raw.get("page") if raw["format"].endswith("page-v1") else raw.get("database")
            original_id = raw.get("originalId") or (original or {}).get("id")
            insist(isinstance(original_id, str) and HEX.fullmatch(original_id.replace("-", ""))
                   and original_id.replace("-", "").lower() == ident, "SOURCE_ID_MISMATCH")
            scope, portal = raw.get("scope"), raw.get("portal")
            insist(scope in SCOPES and isinstance(portal, str), "SOURCE_SCOPE_INVALID")
            scope_prefix = f"{scope}/{portal}-"
            insist(rel.startswith(scope_prefix), "SOURCE_SCOPE_INVALID")
            # A recovery always originates from exactly one reviewed root rule;
            # quarantine has no scope-map rule by design.
            if scope != "migration-quarantine":
                insist(any(rule["spaceId"] == scope and rule["portal"] == portal
                      and (rel.startswith(rule["prefix"].strip("/") + "/")
                           or rel == rule["prefix"]) for rule in rules), "SOURCE_SCOPE_UNREVIEWED")
            owner_node(path)
            insist(path.stat().st_size <= MAX_MARKDOWN, "SOURCE_LIMIT_EXCEEDED")
            md_bytes = path.read_bytes()
            md_text = md_bytes.decode("utf-8", errors="strict")
            raw_bytes = raw_path.read_bytes()
            insist(len(raw_bytes) <= MAX_JSON and
                   json.loads(raw_bytes.decode("utf-8", "strict")) == raw,
                   "SOURCE_CHANGED")
            parent_id = raw.get("parentId")
            if parent_id is not None:
                insist(isinstance(parent_id, str) and HEX.fullmatch(parent_id.replace("-", "")),
                       "SOURCE_PARENT_INVALID")
                parent_id = parent_id.replace("-", "").lower()
            title = filename[:match.start()].strip()[:160] or "Untitled source"
            entries.append({"id": ident, "scope": scope, "portal": portal,
                            "parent": parent_id, "rel": rel, "title": title,
                            "md": md_text, "md_hash": hash_bytes(md_bytes),
                            "raw_hash": hash_bytes(raw_bytes), "raw_bytes": raw_bytes,
                            "raw_rel": raw_path.relative_to(source).as_posix()})
    # Every recovered source document must have exactly one paired metadata
    # record. Do not silently discard orphan originals or unknown source files.
    required_metadata = {Path(path).with_suffix(".notion.json").as_posix()
                         for path in markdown_paths}
    insist(metadata_paths == required_metadata, "RECOVERY_PAIR_MISMATCH")
    insist(entries and len(entries) == report.get("sourceDocumentsWritten"),
           "SOURCE_COUNT_MISMATCH")
    seen = {}
    for entry in entries:
        insist(entry["id"] not in seen, "DUPLICATE_RECOVERED_ID")
        seen[entry["id"]] = entry
    return entries, report


def verify_database(conn):
    insist(conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "DATABASE_CORRUPT")
    insist(conn.execute("PRAGMA foreign_key_check").fetchall() == [], "INVALID_FOREIGN_KEYS")


def merge(base_dir, recovery_dir, output_dir):
    base_dir = Path(base_dir).resolve(strict=True)
    recovery_dir = Path(recovery_dir).resolve(strict=True)
    output_dir = Path(output_dir).resolve()
    insist(base_dir != recovery_dir and output_dir not in (base_dir, recovery_dir), "INVALID_DESTINATION")
    # Never create the new output inside an input or include inputs within
    # the output; both original source datasets must remain immutable.
    insist(not output_dir.is_relative_to(base_dir) and
           not output_dir.is_relative_to(recovery_dir) and
           not base_dir.is_relative_to(output_dir) and
           not recovery_dir.is_relative_to(output_dir), "INVALID_DESTINATION")
    insist(not output_dir.exists(), "ALREADY_EXISTS")
    owner_node(base_dir, is_dir=True)
    owner_node(recovery_dir, is_dir=True)
    parent = output_dir.parent.resolve(strict=True)
    owner_node(parent, is_dir=True)
    db_path = base_dir / "knowledge.sqlite"
    owner_node(db_path)
    assets_dir = base_dir / "assets"
    owner_node(assets_dir, is_dir=True)
    entries, upstream_report = inventory_recovery(recovery_dir)
    stage = Path(tempfile.mkdtemp(prefix=".knowledge-merge-", dir=str(parent)))
    os.chmod(stage, 0o700)
    old = None
    merged = None
    published = False
    try:
        (stage / "assets").mkdir(mode=0o700)
        old = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        verify_database(old)
        merged = sqlite3.connect(stage / "knowledge.sqlite")
        old.backup(merged)
        merged.execute("PRAGMA foreign_keys=ON")
        verify_database(merged)
        before = merged.execute("SELECT COUNT(*) FROM records").fetchone()[0]
        seen = dict(merged.execute("SELECT notion_id, record_id FROM notion_originals WHERE notion_id IS NOT NULL"))
        by_space = dict(merged.execute("SELECT notion_id, space_id FROM notion_originals WHERE notion_id IS NOT NULL"))
        seen_sha = dict(merged.execute("SELECT notion_id, source_sha256 FROM notion_originals WHERE notion_id IS NOT NULL"))
        inserted = []
        conflicts = 0
        duplicate = 0
        now = datetime.now(timezone.utc).isoformat()
        def preserve_raw(item):
            original_path = "recovered:" + item["raw_rel"]
            existing = merged.execute(
                "SELECT sha256 FROM notion_import_assets WHERE original_path=?", (original_path,)
            ).fetchone()
            if existing:
                insist(existing[0] == item["raw_hash"], "CONFLICTING_RAW_SOURCE_EVIDENCE")
            else:
                merged.execute("INSERT INTO notion_import_assets(original_path,space_id,sha256,bytes,stored_name) VALUES (?,?,?,?,?)",
                               (original_path, item["scope"], item["raw_hash"],
                                len(item["raw_bytes"]), item["raw_hash"]))
            dst = stage / "assets" / item["raw_hash"]
            if not dst.exists():
                with open(dst, "xb") as f:
                    f.write(item["raw_bytes"])
                os.chmod(dst, 0o600)
        for item in entries:
            if item["id"] in seen:
                if item["scope"] != by_space[item["id"]] or item["md_hash"] != seen_sha[item["id"]]:
                    conflicts += 1
                else:
                    duplicate += 1
                    preserve_raw(item)
                continue
            space = item["scope"]
            if merged.execute("SELECT 1 FROM spaces WHERE id=?", (space,)).fetchone() is None:
                merged.execute("INSERT INTO spaces(id,label,created_at) VALUES (?,?,?)",
                               (space, space, now))
            record_id = uuid.uuid4().hex
            path = f"{item['portal']}/original-document/{item['id']}"
            insist(merged.execute("SELECT 1 FROM wiki_pages WHERE space_id=? AND path=?",
                                  (space, path)).fetchone() is None, "WIKI_PATH_COLLISION")
            body = "Recovered Notion source preserved as immutable Knowledge original."
            row = (record_id, space, "article", item["title"], body, "recorded",
                   "https://www.notion.so/" + item["id"], 1, now, now)
            merged.execute("INSERT INTO records(id,space_id,kind,title,body,status,source_url,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", row)
            merged.execute("INSERT INTO revisions(space_id,record_id,version,kind,title,body,status,source_url,changed_at) VALUES (?,?,?,?,?,?,?,?,?)",
                           (space, record_id, 1, "article", item["title"], body, "recorded", row[6], now))
            merged.execute("INSERT INTO wiki_pages(space_id,path,record_id) VALUES (?,?,?)",
                           (space, path, record_id))
            merged.execute("INSERT INTO notion_originals(space_id,record_id,source_key,notion_id,original_path,parent_notion_id,source_kind,source_sha256,source_bytes,original_text,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                           (space, record_id, "notion:" + item["id"], item["id"],
                            "recovered:" + item["rel"], item["parent"], "markdown",
                            item["md_hash"], len(item["md"].encode("utf-8")), item["md"], now))
            merged.execute("INSERT INTO notion_originals_fts(record_id,original_text) VALUES (?,?)",
                           (record_id, item["md"]))
            preserve_raw(item)
            seen[item["id"]] = record_id
            by_space[item["id"]] = space
            inserted.append(item)
        # Do not silently accept conflicting original-ID provenance.
        insist(conflicts == 0, "CONFLICTING_SOURCE_OR_SCOPE")
        for item in inserted:
            parent_id = item["parent"]
            if not parent_id or parent_id == item["id"]:
                continue
            dest_record = seen.get(parent_id)
            target = dest_record if by_space.get(parent_id) == item["scope"] else None
            merged.execute("INSERT OR IGNORE INTO notion_import_references(from_record_id,target_notion_id,target_record_id,relation_kind) VALUES (?,?,?,?)",
                           (seen[item["id"]], parent_id, target, "parent"))
            if target and target != seen[item["id"]]:
                merged.execute("INSERT OR IGNORE INTO links(space_id,from_id,to_id,kind,created_at) VALUES (?,?,?,?,?)",
                               (item["scope"], seen[item["id"]], target, "relates", now))
        merged.commit()
        for asset in assets_dir.iterdir():
            owner_node(asset)
            dest = stage / "assets" / asset.name
            if dest.exists():
                insist(hash_bytes(dest.read_bytes()) == hash_bytes(asset.read_bytes()),
                       "ASSET_HASH_COLLISION")
            else:
                shutil.copyfile(asset, dest)
                os.chmod(dest, 0o600)
        for filename, sha in merged.execute("SELECT stored_name,sha256 FROM notion_import_assets"):
            candidate = stage / "assets" / filename
            insist(candidate.exists() and hash_bytes(candidate.read_bytes()) == sha,
                   "ASSET_INTEGRITY_FAILED")
        verify_database(merged)
        after = merged.execute("SELECT COUNT(*) FROM records").fetchone()[0]
        insist(after == before + len(inserted), "MERGE_RECORD_COUNT_INVALID")
        report = {"format": "knowledge-notion-additive-merge-v1",
                  "originalRecordsRetained": before, "newSourceRecords": len(inserted),
                  "matchingDuplicateSources": duplicate, "conflictingSources": conflicts,
                  "mergedRecords": after,
                  "sourcePagesExamined": len(entries),
                  "sourceUnmodified": True, "existingKnowledgeUnmodified": True,
                  "allRecoveredRawEvidencePreserved": True,
                  "sourceMediaReferencesUncaptured": upstream_report.get("mediaReferencesUncaptured"),
                  "sourcePropertiesUnexpanded": upstream_report.get("unexpandedProperties"),
                  "notionModified": False, "dataWrittenToGithub": False,
                  "fullWorkspaceCoverageCertified": False, "activeStorageEncryptionCertified": False,
                  "productionReady": False, "notionRetirementApproved": False}
        merged.close(); merged = None
        old.close(); old = None
        for file in stage.iterdir():
            if file.is_file(): os.chmod(file, 0o600)
        (stage / "merge-report.json").write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
        os.chmod(stage / "merge-report.json", 0o600)
        insist(not output_dir.exists(), "ALREADY_EXISTS")
        stage.rename(output_dir)
        published = True
        return report
    finally:
        if merged is not None: merged.close()
        if old is not None: old.close()
        if not published: shutil.rmtree(stage, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Merge private Notion recovery into NEW Knowledge instance")
    parser.add_argument("base", help="existing owner-only staged Knowledge directory")
    parser.add_argument("recovery", help="owner-only complete Notion recovery output")
    parser.add_argument("destination", help="new destination, must not already exist")
    args = parser.parse_args()
    try:
        report = merge(args.base, args.recovery, args.destination)
        print(json.dumps(report, sort_keys=True))
    except Exception as exc:
        code = exc.code if isinstance(exc, MergeError) else "PRIVATE_MERGE_FAILED"
        print(f"{code}: Private Knowledge merge failed; no original source was modified",file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
