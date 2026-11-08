#!/usr/bin/env python3
"""Read-only reconciliation of official Notion ZIP exports and private staging.

Prints AGGREGATE counts only. Never exposes names, IDs, paths, text, or hashes.
Never modifies Notion, the source archives, or the staged Knowledge SQLite DB.
No third-party packages required. Run only with owner-controlled private files.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys
import zipfile

MAX_ZIPS = 12
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_MEMBERS = 50000
MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024
MAX_MEMBER = 128 * 1024 * 1024
MAX_SQLITE = 512 * 1024 * 1024
ID_IN_NAME = re.compile(r'(?:^|[\s_-])([a-fA-F0-9]{32})\.(md|csv)$')
ID = re.compile(r'^[0-9a-f]{32}$')
SHA = re.compile(r'^[0-9a-f]{64}$')

class AuditError(Exception):
    pass

def reject():
    raise AuditError('Unsafe, incomplete, or changed private source input')

def protected(path, size):
    p = Path(path)
    if not p.is_absolute():
        reject()
    s = p.lstat()
    if not stat.S_ISREG(s.st_mode) or stat.S_ISLNK(s.st_mode) or s.st_size <= 0 or s.st_size > size:
        reject()
    return s

def collect_zip(path):
    first = protected(path, MAX_ARCHIVE_BYTES)
    ids = collections.defaultdict(lambda: collections.defaultdict(set))
    extensions, unidentified = collections.Counter(), collections.Counter()
    member_names = set()
    total = 0
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as handle:
        opened = os.fstat(handle.fileno())
        if (not stat.S_ISREG(opened.st_mode) or opened.st_dev != first.st_dev
                or opened.st_ino != first.st_ino or opened.st_size != first.st_size):
            reject()
        zip_digest = hashlib.sha256()
        for block in iter(lambda: handle.read(512 * 1024), b''):
            zip_digest.update(block)
        handle.seek(0)
        with zipfile.ZipFile(handle) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_MEMBERS:
                reject()
            for entry in entries:
                path_name = entry.filename
                member = PurePosixPath(path_name)
                if (not path_name or path_name in member_names or path_name.startswith('/')
                        or '\\' in path_name or '\x00' in path_name or ':' in path_name
                        or any(segment in ('', '.', '..') for segment in member.parts)
                        or stat.S_ISLNK((entry.external_attr >> 16) & 0xffff)):
                    reject()
                member_names.add(path_name)
                if entry.is_dir():
                    continue
                total += entry.file_size
                if entry.file_size > MAX_MEMBER or total > MAX_TOTAL_UNCOMPRESSED:
                    reject()
                ext = member.suffix.lower()
                extensions[ext] += 1
                matched = ID_IN_NAME.search(member.name)
                if not matched:
                    unidentified[ext] += 1
                digest = hashlib.sha256()
                with archive.open(entry) as source:
                    for block in iter(lambda: source.read(512 * 1024), b''):
                        digest.update(block)  # also checks ZIP member CRC on full read
                if matched:
                    ids[matched.group(1).lower()][ext].add(digest.hexdigest())
        after = os.fstat(handle.fileno())
        if (opened.st_dev != after.st_dev or opened.st_ino != after.st_ino
                or opened.st_size != after.st_size or opened.st_mtime_ns != after.st_mtime_ns):
            reject()
    return {'ids': ids, 'extensions': extensions,
            'unidentified': unidentified, 'zip_hash': zip_digest.hexdigest()}

def staged_markdown(db_file):
    protected(db_file, MAX_SQLITE)
    con = sqlite3.connect(Path(db_file).as_uri() + '?mode=ro&immutable=1', uri=True)
    try:
        if con.execute('PRAGMA integrity_check').fetchone() != ('ok',):
            reject()
        if con.execute('PRAGMA foreign_key_check').fetchone() is not None:
            reject()
        source = con.execute(
            "SELECT notion_id,source_sha256 FROM notion_originals "
            "WHERE source_kind='markdown' AND notion_id IS NOT NULL").fetchall()
        ids = {}
        for raw_id, raw_sha in source:
            key = str(raw_id).replace('-', '').lower()
            if not ID.fullmatch(key) or not SHA.fullmatch(str(raw_sha)) or key in ids:
                reject()
            ids[key] = str(raw_sha)
        count = con.execute('SELECT COUNT(*) FROM records').fetchone()[0]
        return ids, count
    finally:
        con.close()

def reconcile(staged_file, original_zip, supplemental_zips):
    if not (1 <= len(supplemental_zips) < MAX_ZIPS):
        reject()
    paths = [Path(p) for p in [staged_file, original_zip, *supplemental_zips]]
    if len({str(p.resolve(strict=True)) for p in paths}) != len(paths):
        reject()
    staged, records = staged_markdown(staged_file)
    original = collect_zip(original_zip)
    original_md = {id: entry['.md'] for id, entry in original['ids'].items() if '.md' in entry}
    if set(staged) != set(original_md) or any(
            staged[id] not in original_md[id] for id in staged):
        reject()
    supplemental = collections.defaultdict(lambda: collections.defaultdict(set))
    extensions, unidentified = collections.Counter(), collections.Counter()
    for archive_path in supplemental_zips:
        archive = collect_zip(archive_path)
        extensions.update(archive['extensions'])
        unidentified.update(archive['unidentified'])
        for id, by_ext in archive['ids'].items():
            for ext, variants in by_ext.items():
                supplemental[id][ext].update(variants)
    markdown = {id: entry['.md'] for id, entry in supplemental.items() if '.md' in entry}
    overlap = set(markdown) & set(staged)
    identical = sum(1 for id in overlap if len(markdown[id]) == 1 and staged[id] in markdown[id])
    return {
        'format': 'knowledge-private-notion-zip-reconciliation-v1',
        'source_zip_count': len(supplemental_zips) + 1,
        'source_integrity_verified': True,
        'staged_sqlite_integrity_verified': True,
        'staged_records': records,
        'original_markdown_source_ids': len(original_md),
        'original_markdown_hashes_match_staging': len(staged),
        'supplemental_markdown_source_ids': len(markdown),
        'supplemental_new_markdown_source_ids': len(set(markdown) - set(staged)),
        'supplemental_overlapping_markdown_source_ids': len(overlap),
        'supplemental_unchanged_markdown_sources': identical,
        'supplemental_conflicting_markdown_candidates': len(overlap) - identical,
        'supplemental_internal_multi_variant_ids': sum(1 for variants in markdown.values() if len(variants) > 1),
        'supplemental_csv_files': extensions['.csv'],
        'supplemental_assets': sum(extensions[ext] for ext in ('.svg', '.png', '.jpg', '.jpeg', '.webp', '.pdf')),
        'unidentified_supplemental_markdown': unidentified['.md'],
        'unidentified_supplemental_csv': unidentified['.csv'],
        'staged_records_modified': False,
        'data_imported': False,
        'all_scope_boundaries_verified': False,
        'full_workspace_coverage_certified': False,
        'notion_retirement_ready': False,
    }

def main(argv=None):
    parser = argparse.ArgumentParser(description='Private, aggregate-only Notion ZIP source reconciliation')
    parser.add_argument('--staged-db', required=True)
    parser.add_argument('--original-zip', required=True)
    parser.add_argument('--supplemental-zip', action='append', required=True)
    args = parser.parse_args(argv)
    try:
        result = reconcile(args.staged_db, args.original_zip, args.supplemental_zip)
    except (AuditError, OSError, ValueError, sqlite3.Error, zipfile.BadZipFile, RuntimeError):
        print('SOURCE_RECONCILIATION_FAILED: protected source check refused', file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
