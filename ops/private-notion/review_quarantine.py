#!/usr/bin/env python3
"""Owner-local read-only authentication + aggregate CSV/media/link review.

No decrypted source is written to disk. No page/attachment is published,
no Notion API is used, and no personally identifiable title or ID is logged.
"""
import argparse
import base64
import collections
import csv
import getpass
import hashlib
import hmac
import io
import json
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys
import zipfile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from import_quarantine import (
    QUARANTINE_FORMAT, key_from_passphrase, protected_file_bytes, file_node,
    MAX_ARCHIVE_BYTES, MAX_SINGLE_MARKDOWN_BYTES,
)
import reconcile_exports as exports

ID_IN_NAME=exports.ID_IN_NAME
MAX_MEMBERS=getattr(exports,'MAX_MEMBERS',getattr(exports,'MAX_ARCHIVE_MEMBERS',50000))
MAX_TOTAL_UNCOMPRESSED=getattr(exports,'MAX_TOTAL_UNCOMPRESSED',
    getattr(exports,'MAX_ARCHIVE_UNCOMPRESSED',1024*1024*1024))
MAX_MEMBER=getattr(exports,'MAX_MEMBER',getattr(exports,'MAX_SINGLE_MEMBER',128*1024*1024))
MAX_DB_BYTES=512*1024*1024
MAX_TOTAL_CSV_ROWS=1000000
MAX_CSV_FILE_ROWS=100000
MAX_CSV_COLUMNS=1000
ASSET_TYPES={'.svg','.png','.jpg','.jpeg','.webp','.pdf','.gif','.mp4','.mov','.mp3','.wav','.heic'}
LINK=re.compile(r'\]\(([^)\r\n]{1,3000})\)')
ID=re.compile(r'[a-fA-F0-9]{32}')
SHA=re.compile(r'^[a-f0-9]{64}$')

class ReviewError(Exception):
    pass

def refuse():
    raise ReviewError('Private quarantine integrity review refused')

def digest(blob):
    return hashlib.sha256(blob).hexdigest()

def token(key,prefix,value):
    return hmac.new(key,prefix+value,hashlib.sha256).hexdigest()

def archive_members(raw):
    """Bounded ZIP iterator; verify member CRC while staying in memory."""
    try: archive=zipfile.ZipFile(io.BytesIO(raw))
    except (OSError,ValueError,zipfile.BadZipFile): refuse()
    with archive:
        entries=archive.infolist()
        if len(entries)>MAX_MEMBERS: refuse()
        names=set()
        total=0
        for info in entries:
            name=info.filename
            path=PurePosixPath(name)
            if (not name or name in names or name.startswith('/') or '\\' in name
                or '\x00' in name or ':' in name
                or any(part in ('.','..','') for part in path.parts)
                or stat.S_ISLNK((info.external_attr>>16)&0xffff)): refuse()
            names.add(name)
            if info.is_dir(): continue
            total+=info.file_size
            if info.file_size>MAX_MEMBER or total>MAX_TOTAL_UNCOMPRESSED: refuse()
            try:
                with archive.open(info) as reader:
                    parts=[]
                    size=0
                    while block:=reader.read(512*1024):
                        size+=len(block)
                        if size>MAX_MEMBER: refuse()
                        parts.append(block)
                    body=b''.join(parts)
            except (OSError,EOFError,ValueError,zipfile.BadZipFile,RuntimeError): refuse()
            if len(body)!=info.file_size: refuse()
            yield name,path.suffix.lower(),body

def inspect_private_quarantine(directory,passphrase,*,volume_reviewed=False):
    """Authenticate all encrypted artifacts; return counters, never source data."""
    if volume_reviewed is not True: refuse()
    root=Path(directory)
    if not root.is_absolute() or root.is_symlink() or root.resolve(strict=True)!=root: refuse()
    file_node(root,is_dir=True)
    for part in ('archives','assets'): file_node(root/part,is_dir=True)
    db_file=root/'knowledge.sqlite'
    file_node(db_file)
    if db_file.stat().st_size>MAX_DB_BYTES: refuse()
    if any((root/('knowledge.sqlite'+suffix)).exists()
           for suffix in ('-wal','-shm','-journal')): refuse()
    db=sqlite3.connect(db_file.as_uri()+'?mode=ro&immutable=1',uri=True)
    try:
        db.execute('PRAGMA query_only=ON')
        if db.execute('PRAGMA integrity_check').fetchone()!=('ok',) or \
           db.execute('PRAGMA foreign_key_check').fetchone() is not None: refuse()
        row=db.execute('SELECT format,kdf_salt,kdf_check FROM notion_quarantine_config WHERE id=1').fetchone()
        if not row or row[0]!=QUARANTINE_FORMAT or not isinstance(row[1],bytes) or \
           len(row[1])!=16 or not isinstance(row[2],bytes) or len(row[2])!=32: refuse()
        key=key_from_passphrase(passphrase,row[1])
        check=hmac.new(key,b'Knowledge private quarantine key check v1',hashlib.sha256).digest()
        if not hmac.compare_digest(check,row[2]): refuse()
        archives=db.execute('SELECT ordinal,role,archive_sha256,encrypted_sha256,byte_count,encrypted_filename FROM notion_quarantine_archives ORDER BY ordinal').fetchall()
        if not 2<=len(archives)<=12: refuse()
        actual_files={p.name for p in (root/'archives').iterdir() if p.is_file()}
        expected={}
        base_ids={}
        for raw_id,sha in db.execute("SELECT notion_id,source_sha256 FROM notion_originals WHERE source_kind='markdown' AND notion_id IS NOT NULL"):
            source_id=str(raw_id).replace('-','').lower()
            if not re.fullmatch('[a-f0-9]{32}',source_id) or not SHA.fullmatch(str(sha)) or source_id in base_ids: refuse()
            base_ids[source_id]=sha
        source_ids=set(base_ids)
        counts=collections.Counter()
        link_targets=[]
        members={}
        supplemental_hashes=collections.defaultdict(set)
        for ordinal,role,sha,encrypted_sha,byte_count,filename in archives:
            if ordinal!=len(members) or role!=('original' if ordinal==0 else 'supplemental') or \
               not SHA.fullmatch(str(sha)) or not SHA.fullmatch(str(encrypted_sha)) or \
               filename!=f'{ordinal:02d}-{sha}.enc' or not isinstance(byte_count,int) or \
               not 0<byte_count<=MAX_ARCHIVE_BYTES: refuse()
            expected[ordinal]=(sha,filename)
            encrypted=protected_file_bytes(root/'archives'/filename,MAX_ARCHIVE_BYTES+64)
            if digest(encrypted)!=encrypted_sha or len(encrypted)<29: refuse()
            try: raw=AESGCM(key).decrypt(encrypted[:12],encrypted[12:],b'notion-archive-v1:'+sha.encode())
            except Exception: refuse()
            if len(raw)!=byte_count or digest(raw)!=sha: refuse()
            members[ordinal]={}
            for name,ext,body in archive_members(raw):
                mdigest=digest(body)
                members[ordinal][name]=(ext,mdigest,len(body))
                if ext=='.md':
                    counts['markdown_members']+=1
                    match=ID_IN_NAME.search(PurePosixPath(name).name)
                    if match:
                        source_id=match.group(1).lower()
                        source_ids.add(source_id)
                        if ordinal==0 and base_ids.get(source_id)!=mdigest: refuse()
                        if ordinal!=0: supplemental_hashes[source_id].add(mdigest)
                    else: counts['unkeyed_markdown']+=1
                    if len(body)>MAX_SINGLE_MARKDOWN_BYTES: refuse()
                    try: text=body.decode('utf-8')
                    except UnicodeError: counts['unreadable_markdown']+=1
                    else:
                        for link in LINK.findall(text):
                            hints=ID.findall(link)
                            if hints:
                                counts['link_hints']+=1
                                link_targets.append(hints[-1].lower())
                elif ext=='.csv':
                    counts['csv_files']+=1
                    if ID_IN_NAME.search(PurePosixPath(name).name) is None: counts['unkeyed_csv']+=1
                    try:
                        reader=csv.reader(io.StringIO(body.decode('utf-8-sig')),strict=True)
                        line_count=0
                        for cells in reader:
                            line_count+=1
                            if line_count>MAX_CSV_FILE_ROWS or len(cells)>MAX_CSV_COLUMNS: refuse()
                        if line_count: counts['csv_data_rows_observed']+=line_count-1
                        if counts['csv_data_rows_observed']>MAX_TOTAL_CSV_ROWS: refuse()
                    except (csv.Error,UnicodeError): counts['csv_parse_warnings']+=1
                elif ext in ASSET_TYPES: counts['attachments']+=1
                else: counts['other_files']+=1
            counts['archives_verified']+=1
        if actual_files!={filename for _,filename in expected.values()}: refuse()
        variant_rows=db.execute("""SELECT v.archive_ordinal,v.member_token,v.source_token,
          v.source_sha256,v.disposition,v.source_bytes,v.nonce,v.sealed,a.archive_sha256
          FROM notion_quarantine_variants v JOIN notion_quarantine_archives a
          ON a.ordinal=v.archive_ordinal""").fetchall()
        validated=set()
        for ordinal,member_token,source_token,sha,disposition,source_bytes,nonce,sealed,archive_sha in variant_rows:
            if (ordinal not in expected or ordinal==0 or archive_sha!=expected[ordinal][0]
                or not isinstance(member_token,str) or not SHA.fullmatch(member_token)
                or not isinstance(source_token,str) or not SHA.fullmatch(source_token)
                or not SHA.fullmatch(str(sha)) or disposition not in ('new','divergent')
                or not isinstance(nonce,bytes) or len(nonce)!=12 or not isinstance(sealed,bytes)
                or len(sealed)<17 or (ordinal,member_token) in validated): refuse()
            validated.add((ordinal,member_token))
            aad=b'notion-quarantine-v1:'+source_token.encode()+b':'+sha.encode()+b':'+archive_sha.encode()
            try:
                payload=json.loads(AESGCM(key).decrypt(nonce,sealed,aad))
                if not isinstance(payload,dict) or set(payload)!={'notion_id','archive_sha256','member_name','body_b64'}: refuse()
                source_id=payload['notion_id']
                member_name=payload['member_name']
                body=base64.b64decode(payload['body_b64'],validate=True)
            except Exception: refuse()
            if (not isinstance(source_id,str) or not re.fullmatch('[a-f0-9]{32}',source_id)
                or not isinstance(member_name,str) or archive_sha!=payload['archive_sha256']
                or digest(body)!=sha or len(body)!=source_bytes
                or token(key,b'notion-source-id-v1:',source_id.encode())!=source_token
                or token(key,b'notion-member-v1:',archive_sha.encode()+b':'+member_name.encode())!=member_token
                or disposition!=('divergent' if source_id in base_ids else 'new')
                or (source_id in base_ids and base_ids[source_id]==sha)): refuse()
            actual=members[ordinal].get(member_name)
            if actual is None or actual!=('.md',sha,source_bytes): refuse()
            counts[disposition+'_variants']+=1
        new_ids=set()
        divergent_ids=set()
        for source_id,hashes in supplemental_hashes.items():
            if any(value!=base_ids.get(source_id) for value in hashes):
                if source_id in base_ids: divergent_ids.add(source_id)
                else: new_ids.add(source_id)
        candidate_count=0
        for ordinal,group in members.items():
            if ordinal==0: continue
            for name,(ext,sha,size) in group.items():
                if ext!='.md': continue
                match=ID_IN_NAME.search(PurePosixPath(name).name)
                if match is None: continue
                if base_ids.get(match.group(1).lower())==sha: continue
                member_token=token(key,b'notion-member-v1:',expected[ordinal][0].encode()+b':'+name.encode())
                if (ordinal,member_token) not in validated: refuse()
                candidate_count+=1
        if candidate_count!=len(validated): refuse()
        report_bytes=protected_file_bytes(root/'quarantine-report.json',4*1024*1024)
        try: report=json.loads(report_bytes)
        except Exception: refuse()
        if (report.get('format')!=QUARANTINE_FORMAT or report.get('records_published') is not False
            or report.get('new_source_ids_quarantined')!=len(new_ids)
            or report.get('divergent_source_ids_quarantined')!=len(divergent_ids)
            or report.get('new_source_variants')!=counts['new_variants']
            or report.get('divergent_source_variants')!=counts['divergent_variants']
            or report.get('source_zip_count')!=counts['archives_verified']): refuse()
        return {
            'format':'knowledge-notion-private-quarantine-review-v1',
            'authenticated':True,
            'archives_verified':counts['archives_verified'],
            'original_records_preserved':report.get('original_records_retained'),
            'new_source_ids_quarantined':len(new_ids),
            'divergent_source_ids_quarantined':len(divergent_ids),
            'encrypted_variants_verified':len(validated),
            'csv_files_observed':counts['csv_files'],
            'csv_data_rows_observed':counts['csv_data_rows_observed'],
            'csv_parse_warnings':counts['csv_parse_warnings'],
            'unkeyed_csv_files':counts['unkeyed_csv'],
            'attachments_observed':counts['attachments'],
            'unkeyed_markdown':counts['unkeyed_markdown'],
            'markdown_link_hints':counts['link_hints'],
            'markdown_link_hints_resolved':sum(sid in source_ids for sid in link_targets),
            'markdown_link_hints_unresolved':sum(sid not in source_ids for sid in link_targets),
            'source_scope_certified':False,
            'original_notion_permissions_certified':False,
            'csv_rows_promoted':False,
            'attachments_promoted':False,
            'live_knowledge_modified':False,
            'notion_retirement_ready':False,
        }
    finally: db.close()

def main(argv=None):
    parser=argparse.ArgumentParser(description='Aggregate-only authenticated quarantine and CSV/media review')
    parser.add_argument('--quarantine-dir',required=True)
    parser.add_argument('--owner-reviewed-encrypted-volume',action='store_true')
    args=parser.parse_args(argv)
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        print('PRIVATE_QUARANTINE_REVIEW_FAILED: owner-controlled interactive terminal required',file=sys.stderr)
        return 1
    try:
        passphrase=getpass.getpass('Private quarantine passphrase (hidden): ')
        result=inspect_private_quarantine(args.quarantine_dir,passphrase,
            volume_reviewed=args.owner_reviewed_encrypted_volume)
        print(json.dumps(result,sort_keys=True))
        return 0
    except Exception:
        print('PRIVATE_QUARANTINE_REVIEW_FAILED: private review refused',file=sys.stderr)
        return 1

if __name__=='__main__':
    raise SystemExit(main())
