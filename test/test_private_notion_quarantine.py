"""Synthetic-only tests. Never uses real exports or owner data."""
import hashlib
import hmac
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import unittest
import warnings
import zipfile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

source=Path(__file__).resolve().parents[1]/'ops/private-notion/import_quarantine.py'
spec=importlib.util.spec_from_file_location('additive',source)
import sys
sys.path.insert(0,str(source.parent))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

A='a'*32;B='b'*32;C='c'*32
SECRET='synthetic-passphrase-from-test-only-12345'

def zipfile_make(path, entries):
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for name,bytes_ in entries.items():
            z.writestr(name,bytes_)
    path.chmod(0o600)

def make_stage(root):
    base=root/'stage';base.mkdir(mode=0o700)
    assets=base/'assets';assets.mkdir(mode=0o700)
    db=sqlite3.connect(base/'knowledge.sqlite')
    db.executescript('''
    PRAGMA foreign_keys=ON;
    CREATE TABLE records(id TEXT PRIMARY KEY);
    CREATE TABLE revisions(record_id TEXT,version INTEGER);
    CREATE TABLE notion_originals(record_id TEXT,notion_id TEXT,source_kind TEXT,source_sha256 TEXT,original_text TEXT);
    CREATE TABLE notion_import_assets(stored_name TEXT,sha256 TEXT);
    CREATE TABLE notion_import_references(k TEXT);
    CREATE TABLE notion_csv_rows(k TEXT);
    CREATE TABLE links(k TEXT);
    CREATE TABLE wiki_pages(k TEXT);
    CREATE TABLE shared_pages(k TEXT);
    CREATE TABLE spaces(k TEXT);
    ''')
    for j,(id,text) in enumerate([(A,b'source A original'),(B,b'source B unchanged')]):
        db.execute('INSERT INTO records(id) VALUES (?)',(str(j),))
        db.execute('INSERT INTO revisions VALUES (?,?)',(str(j),1))
        db.execute('INSERT INTO notion_originals VALUES (?,?,?,?,?)',
                   (str(j),id,'markdown',hashlib.sha256(text).hexdigest(),text.decode()))
    binary=b'synthetic asset bytes';name=hashlib.sha256(binary).hexdigest()
    (assets/name).write_bytes(binary);(assets/name).chmod(0o600)
    db.execute('INSERT INTO notion_import_assets VALUES (?,?)',(name,name))
    db.commit();db.close();(base/'knowledge.sqlite').chmod(0o600)
    (base/'import-report.json').write_text('{"synthetic":true}\n');(base/'import-report.json').chmod(0o600)
    (base/'README-PRIVATE.txt').write_text('Synthetic staging receipt only\n')
    (base/'README-PRIVATE.txt').chmod(0o600)
    return base

class QuarantineTest(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup)
        self.root=Path(self.t.name)
        self.base=make_stage(self.root)
        self.original=self.root/'original.zip'
        self.supp=self.root/'supp.zip'
        self.dest=self.root/'result'
        zipfile_make(self.original, {'A '+A+'.md':b'source A original','B '+B+'.md':b'source B unchanged'})
        zipfile_make(self.supp, {'A '+A+'.md':b'source A changed','B '+B+'.md':b'source B unchanged',
                                 'C '+C+'.md':b'brand new source','NoID.md':b'non-keyed source',
                                 'Extra.csv':b'header\nrow\n','image.svg':b'<svg/>'})
        self.dbhash=hashlib.sha256((self.base/'knowledge.sqlite').read_bytes()).hexdigest()
    def build(self,passphrase=SECRET, supps=None):
        return mod.stage_additive(self.base,self.original,supps or [self.supp],
                                  self.dest,passphrase,volume_reviewed=True)
    def test_preserves_original_stage_and_quarantines_new_and_conflicting(self):
        report=self.build()
        self.assertEqual(report['original_records_retained'],2)
        self.assertEqual(report['new_source_ids_quarantined'],1)
        self.assertEqual(report['divergent_source_ids_quarantined'],1)
        self.assertEqual(report['encrypted_archives_retained'],2)
        self.assertFalse(report['records_published'])
        self.assertEqual(self.dbhash,hashlib.sha256((self.base/'knowledge.sqlite').read_bytes()).hexdigest())
        d=sqlite3.connect(self.dest/'knowledge.sqlite')
        self.assertEqual(d.execute('SELECT COUNT(*) FROM records').fetchone()[0],2)
        self.assertEqual(d.execute('SELECT COUNT(*) FROM revisions').fetchone()[0],2)
        self.assertEqual(d.execute('SELECT COUNT(*) FROM wiki_pages').fetchone()[0],0)
        self.assertEqual(d.execute('SELECT COUNT(*) FROM notion_quarantine_variants').fetchone()[0],2)
        self.assertEqual(d.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(d.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(sorted(x[0] for x in d.execute('SELECT disposition FROM notion_quarantine_variants')),
                         ['divergent','new'])
        self.assertEqual(len(list((self.dest/'assets').iterdir())),1)
        self.assertEqual((self.dest/'README-PRIVATE.txt').read_text(),
                         'Synthetic staging receipt only\n')
        for row in d.execute('SELECT source_token,source_sha256,nonce,sealed,archive_ordinal FROM notion_quarantine_variants'):
            token,digest,nonce,sealed,ordinal=row
            self.assertEqual(len(token),64)
            self.assertNotIn(b'brand new source',sealed)
        for table in ['notion_quarantine_archives','notion_quarantine_variants']:
            with self.assertRaises(sqlite3.DatabaseError):
                d.execute(f'DELETE FROM {table}')
        d.close()
        self.assertFalse((self.dest/'knowledge.sqlite-wal').exists())
    def test_archive_and_candidate_ciphertext_authenticated(self):
        self.build(); d=sqlite3.connect(self.dest/'knowledge.sqlite')
        salt,check=d.execute('SELECT kdf_salt,kdf_check FROM notion_quarantine_config').fetchone()
        key=mod.key_from_passphrase(SECRET,salt)
        self.assertEqual(check,hmac.new(key,b'Knowledge private quarantine key check v1',hashlib.sha256).digest())
        for ordinal,archive_sha,name in d.execute('SELECT ordinal,archive_sha256,encrypted_filename FROM notion_quarantine_archives'):
            raw=(self.dest/'archives'/name).read_bytes()
            original=AESGCM(key).decrypt(raw[:12],raw[12:],b'notion-archive-v1:'+archive_sha.encode())
            self.assertEqual(hashlib.sha256(original).hexdigest(),archive_sha)
            self.assertTrue(zipfile.is_zipfile(io.BytesIO(original)))
            self.assertEqual(hashlib.sha256(original).hexdigest(),
                             hashlib.sha256((self.original if ordinal==0 else self.supp).read_bytes()).hexdigest())
        for (token,sha,arc,nonce,sealed) in d.execute('''SELECT v.source_token,v.source_sha256,a.archive_sha256,v.nonce,v.sealed
          FROM notion_quarantine_variants v JOIN notion_quarantine_archives a ON v.archive_ordinal=a.ordinal'''):
            aad=b'notion-quarantine-v1:'+token.encode()+b':'+sha.encode()+b':'+arc.encode()
            payload=json.loads(AESGCM(key).decrypt(nonce,sealed,aad))
            body=__import__('base64').b64decode(payload['body_b64'])
            self.assertEqual(hashlib.sha256(body).hexdigest(),sha)
            self.assertEqual(len(payload['notion_id']),32)
            with self.assertRaises(Exception):
                AESGCM(b'X'*32).decrypt(nonce,sealed,aad)
        d.close()
    def test_unchanged_only_does_not_make_quarantine_records(self):
        zipfile_make(self.supp,{'A '+A+'.md':b'source A original'})
        report=self.build()
        self.assertEqual(report['new_source_ids_quarantined'],0)
        self.assertEqual(report['divergent_source_ids_quarantined'],0)
        self.assertEqual(sqlite3.connect(self.dest/'knowledge.sqlite').execute('SELECT COUNT(*) FROM notion_quarantine_variants').fetchone()[0],0)
    def test_additive_duplicate_evidence_retained_without_overwriting(self):
        other=self.root/'other.zip'
        zipfile_make(other,{'A '+A+'.md':b'source A changed again','C '+C+'.md':b'brand new source'})
        report=self.build(supps=[self.supp,other])
        self.assertEqual(report['new_source_ids_quarantined'],1)
        self.assertEqual(report['divergent_source_ids_quarantined'],1)
        self.assertEqual(report['new_source_variants'],2)
        self.assertEqual(report['divergent_source_variants'],2)
        self.assertEqual(report['encrypted_archives_retained'],3)
    def test_nonprivate_source_refused_before_writes(self):
        self.supp.chmod(0o644)
        with self.assertRaises(mod.QuarantineError): self.build()
        self.assertFalse(self.dest.exists())
    def test_symlinked_zip_source_refused_even_if_destination_is_private(self):
        link=self.root/'redirected-source.zip'
        link.symlink_to(self.supp)
        with self.assertRaises(mod.QuarantineError):
            self.build(supps=[link])
        self.assertFalse(self.dest.exists())
    def test_short_passphrase_refused_without_output(self):
        with self.assertRaises(mod.QuarantineError): self.build(passphrase='123')
        self.assertFalse(self.dest.exists())
    def test_preexisting_destination_not_overwritten(self):
        self.dest.mkdir()
        sentinel=self.dest/'sentinel';sentinel.write_text('do not touch')
        with self.assertRaises(mod.QuarantineError): self.build()
        self.assertEqual(sentinel.read_text(),'do not touch')
    def test_changed_original_hash_refused(self):
        zipfile_make(self.original,{'A '+A+'.md':b'tampered source','B '+B+'.md':b'source B unchanged'})
        with self.assertRaises(Exception):self.build()
        self.assertFalse(self.dest.exists())
    def test_untrusted_zip_entry_rejected_without_output(self):
        zipfile_make(self.supp,{'../escape.md':b'secret'})
        with self.assertRaises(Exception):self.build()
        self.assertFalse(self.dest.exists())

if __name__=='__main__':unittest.main()
