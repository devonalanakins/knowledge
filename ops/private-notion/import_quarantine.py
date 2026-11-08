#!/usr/bin/env python3
"""Privately stage additive Notion source variants in an encrypted quarantine.

No Notion API calls, no live Knowledge writes, no direct publishing. Existing
Knowledge SQLite records, revisions, wiki, links and FTS remain unchanged in a
new owner-held local copy. Unapproved source variants are AES-256-GCM sealed.
"""
import argparse
import base64
from datetime import datetime, timezone
import getpass
import io
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import zipfile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from reconcile_exports import reconcile, collect_zip, MAX_ARCHIVE_BYTES, ID_IN_NAME

QUARANTINE_FORMAT = 'knowledge-notion-private-quarantine-v1'
MIN_PASSPHRASE = 24
MAX_TOTAL_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_SINGLE_MARKDOWN_BYTES = 16 * 1024 * 1024
ID_RE = re.compile(r'^[a-f0-9]{32}$')
SHA_RE = re.compile(r'^[a-f0-9]{64}$')

class QuarantineError(Exception):
    pass

def refuse():
    raise QuarantineError('Protected private quarantine staging refused')

def file_node(path, is_dir=False):
    p = Path(path)
    st = p.lstat()
    if stat.S_ISLNK(st.st_mode) or not (stat.S_ISDIR(st.st_mode) if is_dir else stat.S_ISREG(st.st_mode)):
        refuse()
    if os.name != 'nt':
        if st.st_mode & 0o077 or (hasattr(os, 'getuid') and st.st_uid != os.getuid()):
            refuse()
        if not is_dir and st.st_nlink != 1:
            refuse()
    return st

def protected_file_bytes(path, max_bytes):
    st = file_node(path)
    if st.st_size < 1 or st.st_size > max_bytes:
        refuse()
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino, opened.st_size) != (st.st_dev, st.st_ino, st.st_size):
            refuse()
        with os.fdopen(fd, 'rb', closefd=False) as source:
            data = source.read(max_bytes + 1)
        after = os.fstat(fd)
        if len(data) != st.st_size or len(data) > max_bytes or after.st_mtime_ns != st.st_mtime_ns:
            refuse()
        return data
    finally:
        os.close(fd)

def validate_location(base, archives, target):
    base = Path(base).resolve(strict=True)
    target = Path(target).absolute()
    sources = [base, *[Path(p).resolve(strict=True) for p in archives]]
    if len(set(sources)) != len(sources) or target.exists() or target.is_symlink():
        refuse()
    parent = target.parent.resolve(strict=True)
    file_node(parent, is_dir=True)
    file_node(base, is_dir=True)
    if target.parent != parent:
        refuse()
    for source in sources:
        if source == target or source in target.parents or target in source.parents:
            refuse()
    for name in ('knowledge.sqlite', 'import-report.json'):
        file_node(base / name)
    file_node(base / 'assets', is_dir=True)
    for archive in sources[1:]:
        file_node(archive)
    for suffix in ('-wal', '-shm', '-journal'):
        if (base / ('knowledge.sqlite' + suffix)).exists():
            refuse()
    return base, [Path(x) for x in sources[1:]], target, parent

def key_from_passphrase(passphrase, salt):
    if not isinstance(passphrase, str) or len(passphrase) < MIN_PASSPHRASE or len(passphrase) > 1024:
        refuse()
    return hashlib.scrypt(passphrase.encode('utf-8'), salt=salt, n=2**15, r=8, p=1, dklen=32, maxmem=64*1024*1024)

def nonce_and_seal(key, body, associated):
    nonce = os.urandom(12)
    return nonce, AESGCM(key).encrypt(nonce, body, associated)

def create_tables(db, salt, key):
    db.executescript('''
    CREATE TABLE notion_quarantine_config (
      id INTEGER PRIMARY KEY CHECK (id=1), format TEXT NOT NULL,
      kdf_salt BLOB NOT NULL, kdf_check BLOB NOT NULL
    );
    CREATE TABLE notion_quarantine_archives (
      ordinal INTEGER PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('original','supplemental')),
      archive_sha256 TEXT NOT NULL, encrypted_sha256 TEXT NOT NULL,
      byte_count INTEGER NOT NULL CHECK(byte_count>0), encrypted_filename TEXT NOT NULL UNIQUE
    );
    CREATE TABLE notion_quarantine_variants (
      id INTEGER PRIMARY KEY, archive_ordinal INTEGER NOT NULL REFERENCES notion_quarantine_archives(ordinal),
      member_token TEXT NOT NULL, source_token TEXT NOT NULL, source_sha256 TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK (disposition IN ('new','divergent')),
      source_bytes INTEGER NOT NULL CHECK(source_bytes>=0),
      nonce BLOB NOT NULL, sealed BLOB NOT NULL,
      UNIQUE(archive_ordinal,member_token)
    );
    CREATE TRIGGER notion_quarantine_config_no_update BEFORE UPDATE ON notion_quarantine_config
      BEGIN SELECT RAISE(ABORT,'immutable quarantine config'); END;
    CREATE TRIGGER notion_quarantine_config_no_delete BEFORE DELETE ON notion_quarantine_config
      BEGIN SELECT RAISE(ABORT,'immutable quarantine config'); END;
    CREATE TRIGGER notion_quarantine_archives_no_update BEFORE UPDATE ON notion_quarantine_archives
      BEGIN SELECT RAISE(ABORT,'immutable quarantine archive'); END;
    CREATE TRIGGER notion_quarantine_archives_no_delete BEFORE DELETE ON notion_quarantine_archives
      BEGIN SELECT RAISE(ABORT,'immutable quarantine archive'); END;
    CREATE TRIGGER notion_quarantine_variants_no_update BEFORE UPDATE ON notion_quarantine_variants
      BEGIN SELECT RAISE(ABORT,'immutable quarantine source'); END;
    CREATE TRIGGER notion_quarantine_variants_no_delete BEFORE DELETE ON notion_quarantine_variants
      BEGIN SELECT RAISE(ABORT,'immutable quarantine source'); END;
    ''')
    db.execute('INSERT INTO notion_quarantine_config(id,format,kdf_salt,kdf_check) VALUES(1,?,?,?)',
               (QUARANTINE_FORMAT, salt, hmac.new(key, b'Knowledge private quarantine key check v1', hashlib.sha256).digest()))

def byte_digest(data):
    return hashlib.sha256(data).hexdigest()

def preserve_original_assets(base, stage, db):
    entries = sorted((base / 'assets').iterdir(), key=lambda p: p.name)
    (stage / 'assets').mkdir(mode=0o700)
    for asset in entries:
        if not SHA_RE.fullmatch(asset.name):
            refuse()
        data = protected_file_bytes(asset, 128*1024*1024)
        if byte_digest(data) != asset.name:
            refuse()
        dst = stage / 'assets' / asset.name
        with dst.open('xb') as f:
            f.write(data)
        dst.chmod(0o600)
    for name, digest in db.execute('SELECT stored_name,sha256 FROM notion_import_assets'):
        if not SHA_RE.fullmatch(str(name)) or not SHA_RE.fullmatch(str(digest)) or name != digest:
            refuse()
        file_node(stage / 'assets' / name)
    report = protected_file_bytes(base / 'import-report.json', 4*1024*1024)
    with (stage / 'import-report.json').open('xb') as out:
        out.write(report)
    (stage / 'import-report.json').chmod(0o600)
    # Preserve the original staging receipts and bundled source evidence too.
    # These remain private and require the owner-reviewed encrypted volume.
    for name in ('README-PRIVATE.txt','bundle-sha256.txt',
                 'independent-verification.json','notion-original-export.zip'):
        candidate=base / name
        if candidate.exists() or candidate.is_symlink():
            data=protected_file_bytes(candidate,MAX_ARCHIVE_BYTES)
            with (stage / name).open('xb') as out:
                out.write(data)
            (stage / name).chmod(0o600)

def verify_stage_copy(source, dest):
    if source.execute('PRAGMA integrity_check').fetchone() != ('ok',):
        refuse()
    if source.execute('PRAGMA foreign_key_check').fetchone() is not None:
        refuse()
    if dest.execute('PRAGMA integrity_check').fetchone() != ('ok',):
        refuse()
    if dest.execute('PRAGMA foreign_key_check').fetchone() is not None:
        refuse()
    for table in ('records','revisions','notion_originals','notion_import_assets',
                  'notion_import_references','notion_csv_rows','links','wiki_pages','shared_pages','spaces'):
        before = source.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
        after = dest.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
        if before != after:
            refuse()

def stage_additive(base_dir, original_zip, supplemental_zips, destination, passphrase, volume_reviewed=False):
    if volume_reviewed is not True or len(supplemental_zips) < 1 or len(supplemental_zips) > 11:
        refuse()
    base,archives,target,parent = validate_location(base_dir,[original_zip,*supplemental_zips],destination)
    staged_db = base / 'knowledge.sqlite'
    before_db_sha = byte_digest(protected_file_bytes(staged_db,512*1024*1024))
    summary = reconcile(staged_db, archives[0],archives[1:])
    stage = Path(tempfile.mkdtemp(prefix='.knowledge-quarantine-', dir=parent))
    stage.chmod(0o700)
    original_db = copy_db = None
    done = False
    try:
        (stage / 'archives').mkdir(mode=0o700)
        original_db = sqlite3.connect(f'file:{staged_db}?mode=ro',uri=True)
        copy_db = sqlite3.connect(stage / 'knowledge.sqlite')
        original_db.backup(copy_db)
        copy_db.execute('PRAGMA foreign_keys=ON')
        verify_stage_copy(original_db,copy_db)
        preserve_original_assets(base,stage,copy_db)
        salt = os.urandom(16)
        key = key_from_passphrase(passphrase,salt)
        create_tables(copy_db,salt,key)
        stage_originals = {str(source_id).replace('-','').lower(): digest for source_id,digest in
                           original_db.execute("SELECT notion_id,source_sha256 FROM notion_originals WHERE source_kind='markdown' AND notion_id IS NOT NULL")}
        new_tokens,divergent_tokens = set(),set()
        new_variants = 0
        divergent_variants = 0
        archived_bytes = 0
        for ordinal,zip_path in enumerate(archives):
            data = protected_file_bytes(zip_path,MAX_ARCHIVE_BYTES)
            archived_bytes += len(data)
            if archived_bytes > MAX_TOTAL_ARCHIVE_BYTES:
                refuse()
            archive_sha = byte_digest(data)
            nonce,ciphertext = nonce_and_seal(key,data,b'notion-archive-v1:' + archive_sha.encode())
            sealed_bytes = nonce + ciphertext
            encrypted_name = f'{ordinal:02d}-{archive_sha}.enc'
            encrypted = stage / 'archives' / encrypted_name
            with encrypted.open('xb') as output:
                output.write(sealed_bytes)
            encrypted.chmod(0o600)
            if AESGCM(key).decrypt(sealed_bytes[:12],sealed_bytes[12:],
                                   b'notion-archive-v1:' + archive_sha.encode()) != data:
                refuse()
            copy_db.execute('INSERT INTO notion_quarantine_archives VALUES (?,?,?,?,?,?)',
                            (ordinal,'original' if ordinal==0 else 'supplemental',archive_sha,
                             byte_digest(sealed_bytes),len(data),encrypted_name))
            if ordinal == 0:
                continue
            # The read-only verifier has already validated CRC, paths, member identity and counts.
            preflight = collect_zip(zip_path)
            if preflight.get('zip_hash',preflight.get('zip_sha256')) != archive_sha:
                refuse()
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for info in z.infolist():
                    if info.is_dir() or not info.filename.lower().endswith('.md'):
                        continue
                    match = ID_IN_NAME.search(Path(info.filename).name)
                    if not match:
                        continue  # Entire source remains in the encrypted archive, unclassified.
                    notion_id = match.group(1).lower()
                    with z.open(info) as inp:
                        body = inp.read(MAX_SINGLE_MARKDOWN_BYTES+1)
                    if len(body)>MAX_SINGLE_MARKDOWN_BYTES:
                        refuse()
                    digest = byte_digest(body)
                    known = stage_originals.get(notion_id)
                    if known == digest:
                        continue
                    status='divergent' if known is not None else 'new'
                    token = hmac.new(key,b'notion-source-id-v1:' + notion_id.encode(),hashlib.sha256).hexdigest()
                    member_token = hmac.new(key,b'notion-member-v1:' + archive_sha.encode() + b':' + info.filename.encode(),hashlib.sha256).hexdigest()
                    payload=json.dumps({'notion_id':notion_id,'archive_sha256':archive_sha,
                        'member_name':info.filename,'body_b64':base64.b64encode(body).decode()},
                        ensure_ascii=False,separators=(',',':')).encode()
                    aad=b'notion-quarantine-v1:'+token.encode()+b':'+digest.encode()+b':'+archive_sha.encode()
                    nonce,sealed=nonce_and_seal(key,payload,aad)
                    copy_db.execute('INSERT INTO notion_quarantine_variants '
                                    '(archive_ordinal,member_token,source_token,source_sha256,disposition,source_bytes,nonce,sealed) '
                                    'VALUES (?,?,?,?,?,?,?,?)',
                                    (ordinal,member_token,token,digest,status,len(body),nonce,sealed))
                    if status=='new':
                        new_tokens.add(token);new_variants+=1
                    else:
                        divergent_tokens.add(token);divergent_variants+=1
        if len(new_tokens)!=summary['supplemental_new_markdown_source_ids'] or \
                len(divergent_tokens)!=summary['supplemental_conflicting_markdown_candidates']:
            refuse()
        copy_db.commit()
        verify_stage_copy(original_db,copy_db)
        if byte_digest(protected_file_bytes(staged_db,512*1024*1024)) != before_db_sha:
            refuse()
        for archive in archives:
            file_node(archive)
        if any(byte_digest(protected_file_bytes(archive,MAX_ARCHIVE_BYTES)) !=
               archive_sha for archive,archive_sha in zip(archives,
               (r[0] for r in copy_db.execute('SELECT archive_sha256 FROM notion_quarantine_archives ORDER BY ordinal')))):
            refuse()
        if copy_db.execute('SELECT COUNT(*) FROM notion_quarantine_variants').fetchone()[0] != new_variants+divergent_variants:
            refuse()
        if copy_db.execute('PRAGMA integrity_check').fetchone() != ('ok',):
            refuse()
        copy_db.close();copy_db=None
        original_db.close();original_db=None
        (stage / 'knowledge.sqlite').chmod(0o600)
        report={'format':QUARANTINE_FORMAT,'source_zip_count':len(archives),
                'original_records_retained':summary['staged_records'],
                'new_source_ids_quarantined':len(new_tokens),'new_source_variants':new_variants,
                'divergent_source_ids_quarantined':len(divergent_tokens),
                'divergent_source_variants':divergent_variants,
                'encrypted_archives_retained':len(archives),
                'supplemental_csv_files_preserved_in_archives':summary['supplemental_csv_files'],
                'supplemental_assets_preserved_in_archives':summary['supplemental_assets'],
                'existing_records_modified':False,'source_archives_modified':False,
                'knowledge_live_modified':False,'records_published':False,
                'workspace_scope_review_complete':False,'notion_retirement_approved':False}
        out=stage/'quarantine-report.json'
        out.write_text(json.dumps(report,sort_keys=True)+'\n',encoding='utf8');out.chmod(0o600)
        if target.exists():
            refuse()
        stage.rename(target)
        done=True
        return report
    finally:
        if copy_db is not None:
            copy_db.close()
        if original_db is not None:
            original_db.close()
        if not done:
            shutil.rmtree(stage,ignore_errors=True)

def main(argv=None):
    p=argparse.ArgumentParser(description='Create new encrypted private quarantine from immutable Notion sources')
    p.add_argument('--base-dir',required=True)
    p.add_argument('--original-zip',required=True)
    p.add_argument('--supplemental-zip',action='append',required=True)
    p.add_argument('--destination',required=True)
    p.add_argument('--owner-reviewed-encrypted-volume',action='store_true')
    a=p.parse_args(argv)
    try:
        if not sys.stdin.isatty() or not sys.stdout.isatty():
            refuse()
        secret=getpass.getpass('Private quarantine passphrase (hidden): ')
        again=getpass.getpass('Confirm private quarantine passphrase (hidden): ')
        if not hmac.compare_digest(secret,again):
            refuse()
        result=stage_additive(a.base_dir,a.original_zip,a.supplemental_zip,
                              a.destination,secret,a.owner_reviewed_encrypted_volume)
        print(json.dumps(result,sort_keys=True))
    except Exception:
        print('PRIVATE_QUARANTINE_FAILED: private staging refused; original sources unchanged',file=sys.stderr)
        return 1
    return 0

if __name__=='__main__':
    raise SystemExit(main())
