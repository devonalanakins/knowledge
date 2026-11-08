#!/usr/bin/env python3
"""Private owner-local scope proposals for encrypted Notion quarantine variants.

All decisions are only encrypted PROPOSALS, never access grants or imports.
Decrypting a source for local inspection requires an explicit interactive flag.
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from import_quarantine import key_from_passphrase, protected_file_bytes, file_node, QuarantineError
from review_quarantine import inspect_private_quarantine, ReviewError

FORMAT = 'knowledge-notion-private-scope-proposals-v1'
SCOPES = ('personal', 'family', 'cristy', 'devonstation', 'mizvo', 'anevum', 'unassigned')
CLASSIFICATIONS = ('unknown', 'nonclinical', 'sensitive', 'clinical-or-client')
REASONS = ('owner-provenance', 'source-context', 'requires-second-review', 'unresolved')
SHA = re.compile(r'^[0-9a-f]{64}$')
MAX_LEDGER_BYTES = 8 * 1024 * 1024
MAX_ENTRIES = 10000

class ScopeReviewError(Exception):
    pass

def refuse():
    raise ScopeReviewError('Private scope review refused: invalid input or changed source')

def sha256(raw):
    return hashlib.sha256(raw).hexdigest()

def _valid_node(path, *, max_bytes=MAX_LEDGER_BYTES):
    try:
        return protected_file_bytes(Path(path), max_bytes)
    except (OSError, ValueError, QuarantineError):
        refuse()

def _root_verified(root, passphrase):
    root = Path(root)
    if not root.is_absolute() or root.is_symlink() or root.resolve(strict=True) != root:
        refuse()
    file_node(root, is_dir=True)
    try:
        summary = inspect_private_quarantine(root, passphrase, volume_reviewed=True)
    except (ReviewError, QuarantineError, ValueError):
        refuse()
    dbpath = root / 'knowledge.sqlite'
    blob = _valid_node(dbpath, max_bytes=512 * 1024 * 1024)
    con = sqlite3.connect(dbpath.as_uri() + '?mode=ro&immutable=1', uri=True)
    try:
        con.execute('PRAGMA query_only=ON')
        salt, check = con.execute('SELECT kdf_salt,kdf_check FROM notion_quarantine_config WHERE id=1').fetchone()
        key = key_from_passphrase(passphrase, salt)
        import hmac
        expected = hmac.new(key, b'Knowledge private quarantine key check v1', hashlib.sha256).digest()
        if not hmac.compare_digest(expected, check):
            refuse()
        rows = con.execute('''SELECT v.id,v.archive_ordinal,v.member_token,v.source_token,
            v.source_sha256,v.disposition,v.source_bytes,v.nonce,v.sealed,a.archive_sha256
            FROM notion_quarantine_variants v
            JOIN notion_quarantine_archives a ON v.archive_ordinal=a.ordinal
            ORDER BY v.archive_ordinal,v.id''').fetchall()
        if len(rows) != summary['encrypted_variants_verified']:
            refuse()
        return key, sha256(blob), rows, summary
    finally:
        con.close()

def _reveal(row, key):
    _, ordinal, member_token, source_token, digest, disposition, size, nonce, sealed, archive_sha = row
    aad = b'notion-quarantine-v1:' + source_token.encode() + b':' + digest.encode() + b':' + archive_sha.encode()
    try:
        item = json.loads(AESGCM(key).decrypt(nonce, sealed, aad))
        if set(item) != {'notion_id','archive_sha256','member_name','body_b64'}:
            refuse()
        body = base64.b64decode(item['body_b64'], validate=True)
    except (ValueError, TypeError, KeyError):
        refuse()
    if sha256(body) != digest or len(body) != size:
        refuse()
    return item['member_name'], body

def _validated_ledger(data, key, db_sha, rows):
    if not isinstance(data, dict) or set(data) != {
        'format','database_sha256','revision','previous_sha256','nonce','ciphertext'}:
        refuse()
    if data['format'] != FORMAT or data['database_sha256'] != db_sha:
        refuse()
    revision = data['revision']
    if not isinstance(revision, int) or isinstance(revision,bool) or not (1 <= revision <= MAX_ENTRIES):
        refuse()
    prev = data['previous_sha256']
    if prev is not None and (not isinstance(prev, str) or not SHA.fullmatch(prev)):
        refuse()
    if revision == 1 and prev is not None or revision > 1 and prev is None:
        refuse()
    try:
        nonce = base64.b64decode(data['nonce'], validate=True)
        cipher = base64.b64decode(data['ciphertext'], validate=True)
        if len(nonce) != 12 or len(cipher) < 17:
            refuse()
        aad = f'{FORMAT}:{db_sha}:{revision}:{prev or "genesis"}'.encode()
        body = json.loads(AESGCM(key).decrypt(nonce, cipher, aad))
    except (ValueError, KeyError, TypeError):
        refuse()
    if not isinstance(body, dict) or set(body) != {'entries'} or not isinstance(body['entries'], list):
        refuse()
    if len(body['entries']) != revision:
        refuse()
    by_id = {row[0]:row for row in rows}
    for i, entry in enumerate(body['entries'], start=1):
        if not isinstance(entry, dict) or set(entry) != {
            'sequence','variant_id','archive_ordinal','source_token','member_token',
            'source_sha256','proposed_scope','classification','reason','state'}:
            refuse()
        selected = by_id.get(entry['variant_id']) if type(entry['variant_id']) is int else None
        if not selected or entry['sequence'] != i or type(entry['sequence']) is not int:
            refuse()
        if (entry['archive_ordinal'], entry['member_token'], entry['source_token'], entry['source_sha256']) != (
                selected[1], selected[2], selected[3], selected[4]):
            refuse()
        if (entry['proposed_scope'] not in SCOPES or entry['classification'] not in CLASSIFICATIONS
                or entry['reason'] not in REASONS or entry['state'] != 'proposal-only'):
            refuse()
        if (entry['classification'] in ('unknown', 'clinical-or-client') or
                entry['reason'] == 'unresolved') and entry['proposed_scope'] != 'unassigned':
            refuse()
    return body['entries']

def _load_ledger(path, key, db_sha, rows):
    if path is None:
        return [], None
    raw = _valid_node(path)
    try:
        data = json.loads(raw)
    except (UnicodeError,ValueError):
        refuse()
    entries = _validated_ledger(data, key, db_sha, rows)
    return entries, sha256(raw)

def _new_ledger(entries, prev, key, db_sha):
    revision = len(entries)
    nonce = os.urandom(12)
    aad = f'{FORMAT}:{db_sha}:{revision}:{prev or "genesis"}'.encode()
    plaintext = json.dumps({'entries':entries},separators=(',',':'),sort_keys=True).encode()
    cipher = AESGCM(key).encrypt(nonce, plaintext, aad)
    return json.dumps({
        'format':FORMAT,'database_sha256':db_sha,'revision':revision,
        'previous_sha256':prev,'nonce':base64.b64encode(nonce).decode(),
        'ciphertext':base64.b64encode(cipher).decode(),
    },separators=(',',':'),sort_keys=True).encode()

def _write_exclusive(path, data):
    target=Path(path)
    if not target.is_absolute() or target.exists() or target.is_symlink():
        refuse()
    if target.parent.is_symlink() or target.parent.resolve(strict=True) != target.parent:
        refuse()
    file_node(target.parent, is_dir=True)
    descriptor=os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor,'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
    except Exception:
        try:
            target.unlink()
        except OSError:
            pass
        raise

def scope_inventory(root, passphrase, *, ledger=None):
    key, dbsha, rows, summary = _root_verified(root,passphrase)
    entries, _ = _load_ledger(ledger,key,dbsha,rows)
    return {'format':FORMAT,'quarantined_variants':len(rows),
            'scope_proposals':len(entries),'distinct_variants_proposed':len(set(x['variant_id'] for x in entries)),
            'quarantine_remains_private':True,'permissions_granted':False,
            'clinical_review_certified':False,'notion_retirement_ready':False}

def scope_preview(root, passphrase, variant_id, *, reveal_local=False, full=False):
    if reveal_local is not True or type(variant_id) is not int or variant_id < 1:
        refuse()
    key,_,rows,_ = _root_verified(root,passphrase)
    row = next((r for r in rows if r[0] == variant_id),None)
    if row is None:
        refuse()
    name, body = _reveal(row,key)
    # Explicitly owner-visible local terminal content; not returned in the aggregate API.
    preview = body.decode('utf-8','replace')
    if not full:
        preview = preview[:800]
    return {'variant_id':row[0],'disposition':row[5],
            'local_member_name':name,'local_content_preview':preview,
            'truncated':not full and len(body)>800,
            'scope_approved':False}

def propose_scope(root,passphrase,variant_id,scope,classification,reason,output_path,*,ledger=None):
    if (type(variant_id) is not int or variant_id < 1 or scope not in SCOPES or
        classification not in CLASSIFICATIONS or reason not in REASONS):
        refuse()
    # Unknown and clinical/client material must stay entirely unassigned.
    # Only a separate authorization process may release these boundaries.
    if (classification in ('unknown', 'clinical-or-client') or reason == 'unresolved') and scope != 'unassigned':
        refuse()
    key, dbsha, rows, _ = _root_verified(root,passphrase)
    selected = next((r for r in rows if r[0] == variant_id),None)
    if selected is None:
        refuse()
    prior, previous_hash = _load_ledger(ledger,key,dbsha,rows)
    if len(prior) >= MAX_ENTRIES:
        refuse()
    entry={'sequence':len(prior)+1, 'variant_id':selected[0], 'archive_ordinal':selected[1],
        'member_token':selected[2], 'source_token':selected[3],
        'source_sha256':selected[4], 'proposed_scope':scope,
        'classification':classification, 'reason':reason, 'state':'proposal-only'}
    blob=_new_ledger([*prior,entry],previous_hash,key,dbsha)
    if len(blob)>MAX_LEDGER_BYTES:
        refuse()
    _write_exclusive(output_path,blob)
    try:
        readback=_valid_node(output_path)
        if readback!=blob:
            refuse()
        _validated_ledger(json.loads(readback),key,dbsha,rows)
    except Exception:
        Path(output_path).unlink(missing_ok=True)
        raise
    return {'format':FORMAT,'new_revision':entry['sequence'],'total_proposals':len(prior)+1,
            'ledger_saved':True,'permissions_granted':False,'records_published':False}

def main(argv=None):
    parser=argparse.ArgumentParser(description='Owner-local review-only Notion quarantine scope proposals')
    parser.add_argument('--quarantine-dir', required=True)
    parser.add_argument('--owner-reviewed-encrypted-volume',action='store_true')
    commands=parser.add_subparsers(dest='command',required=True)
    inventory=commands.add_parser('inventory')
    inventory.add_argument('--ledger')
    show=commands.add_parser('show')
    show.add_argument('--variant-id',required=True,type=int)
    show.add_argument('--reveal-local',action='store_true')
    show.add_argument('--full',action='store_true')
    decide=commands.add_parser('propose')
    decide.add_argument('--variant-id',required=True,type=int)
    decide.add_argument('--scope',required=True,choices=SCOPES)
    decide.add_argument('--classification',required=True,choices=CLASSIFICATIONS)
    decide.add_argument('--reason',required=True,choices=REASONS)
    decide.add_argument('--ledger')
    decide.add_argument('--output',required=True)
    args=parser.parse_args(argv)
    if not (sys.stdin.isatty() and sys.stdout.isatty() and args.owner_reviewed_encrypted_volume):
        print('PRIVATE_SCOPE_REVIEW_REFUSED: interactive owner-controlled encrypted volume required',file=sys.stderr)
        return 1
    try:
        passphrase=getpass.getpass('Private quarantine passphrase (hidden): ')
        if args.command=='inventory':
            result=scope_inventory(args.quarantine_dir,passphrase,ledger=args.ledger)
        elif args.command=='show':
            if not args.reveal_local:
                refuse()
            print('LOCAL PRIVATE VIEW: do not screen-share, capture, or paste private content.')
            result=scope_preview(args.quarantine_dir,passphrase,args.variant_id,
                reveal_local=True,full=args.full)
        else:
            result=propose_scope(args.quarantine_dir,passphrase,args.variant_id,
                args.scope,args.classification,args.reason,args.output,ledger=args.ledger)
        print(json.dumps(result,ensure_ascii=True,indent=2))
        return 0
    except Exception:
        print('PRIVATE_SCOPE_REVIEW_REFUSED: invalid source, ledger, or permission precondition',file=sys.stderr)
        return 1
if __name__=='__main__':
    raise SystemExit(main())
