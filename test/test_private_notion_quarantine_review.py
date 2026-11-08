"""Only synthetic source data is used in this test suite."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE/'ops'/'private-notion'))
from import_quarantine import stage_additive,QuarantineError
from review_quarantine import inspect_private_quarantine,ReviewError

spec=importlib.util.spec_from_file_location('fixture',HERE/'test'/'test_private_notion_quarantine.py')
fixture=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

class ReviewTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.stage=fixture.make_stage(self.root)
        self.original=self.root/'original.zip'
        self.supp=self.root/'supplement.zip'
        self.dest=self.root/'review-target'
        fixture.zipfile_make(self.original,{
            'A '+fixture.A+'.md':b'source A original',
            'B '+fixture.B+'.md':b'source B unchanged',
        })
        fixture.zipfile_make(self.supp,{
            'A '+fixture.A+'.md':b'source A changed',
            'B '+fixture.B+'.md':b'source B unchanged',
            'C '+fixture.C+'.md':b'brand new source',
            'NoID.md':b'no stable ID',
            'Extra.csv':b'column,name\na,one\nb,two\n',
            'image.svg':b'<svg/>',
        })
        self.secret=fixture.SECRET
        stage_additive(self.stage,self.original,[self.supp],self.dest,self.secret,volume_reviewed=True)
    def verify(self):
        return inspect_private_quarantine(self.dest,self.secret,volume_reviewed=True)
    def test_authentic_receipt_aggregate_only_and_database_unmodified(self):
        before=hashlib.sha256((self.dest/'knowledge.sqlite').read_bytes()).hexdigest()
        report=self.verify()
        self.assertTrue(report['authenticated'])
        self.assertEqual(report['archives_verified'],2)
        self.assertEqual(report['new_source_ids_quarantined'],1)
        self.assertEqual(report['divergent_source_ids_quarantined'],1)
        self.assertEqual(report['encrypted_variants_verified'],2)
        self.assertEqual(report['csv_files_observed'],1)
        self.assertEqual(report['csv_data_rows_observed'],2)
        self.assertEqual(report['attachments_observed'],1)
        self.assertEqual(report['unkeyed_markdown'],1)
        self.assertFalse(report['source_scope_certified'])
        self.assertFalse(report['notion_retirement_ready'])
        text=json.dumps(report)
        for secret in [fixture.A,fixture.B,fixture.C,'source A','brand new source',
                       'Extra.csv','image.svg',self.secret]:
            self.assertNotIn(secret,text)
        self.assertEqual(before,hashlib.sha256((self.dest/'knowledge.sqlite').read_bytes()).hexdigest())
        self.assertFalse((self.dest/'knowledge.sqlite-wal').exists())
    def test_wrong_passphrase_or_unreviewed_volume_refused(self):
        with self.assertRaises((ReviewError,ValueError)):
            inspect_private_quarantine(self.dest,'incorrect synthetic passphrase at least 24 chars',
                                       volume_reviewed=True)
        with self.assertRaises(ReviewError):
            inspect_private_quarantine(self.dest,self.secret,volume_reviewed=False)
    def test_corrupted_archive_refused(self):
        file=next((self.dest/'archives').iterdir())
        body=bytearray(file.read_bytes());body[-3]^=1;file.write_bytes(body)
        with self.assertRaises(ReviewError):self.verify()
    def test_deleted_variant_refused_even_when_db_is_structurally_valid(self):
        db=sqlite3.connect(self.dest/'knowledge.sqlite')
        db.execute('DROP TRIGGER notion_quarantine_variants_no_delete')
        db.execute('DELETE FROM notion_quarantine_variants WHERE id=(SELECT MIN(id) FROM notion_quarantine_variants)')
        db.commit();db.close()
        with self.assertRaises(ReviewError):self.verify()
    def test_tampered_variant_ciphertext_refused(self):
        db=sqlite3.connect(self.dest/'knowledge.sqlite')
        db.execute('DROP TRIGGER notion_quarantine_variants_no_update')
        db.execute('UPDATE notion_quarantine_variants SET sealed=? WHERE id=(SELECT MIN(id) FROM notion_quarantine_variants)',(b'X'*80,))
        db.commit();db.close()
        with self.assertRaises(ReviewError):self.verify()
    def test_missing_archive_refused(self):
        next((self.dest/'archives').iterdir()).unlink()
        with self.assertRaises((ReviewError,FileNotFoundError)):self.verify()
    def test_symlink_to_archive_refused(self):
        file=next((self.dest/'archives').iterdir())
        moved=file.with_suffix('.reference')
        file.rename(moved);file.symlink_to(moved)
        with self.assertRaises((ReviewError,QuarantineError,ValueError)):self.verify()
    def test_inconsistent_report_fails_closed(self):
        file=self.dest/'quarantine-report.json'
        data=json.loads(file.read_text())
        data['new_source_ids_quarantined']=50000
        file.write_text(json.dumps(data))
        file.chmod(0o600)
        with self.assertRaises(ReviewError):self.verify()
    def test_corrupted_staging_foreign_key_fails(self):
        db=sqlite3.connect(self.dest/'knowledge.sqlite')
        db.execute('DROP TRIGGER notion_quarantine_archives_no_delete')
        db.execute('DELETE FROM notion_quarantine_archives WHERE ordinal=1')
        db.commit();db.close()
        with self.assertRaises(ReviewError):self.verify()
    def test_markdown_links_are_heuristics_not_permissions(self):
        known=fixture.C;unknown='d'*32
        fixture.zipfile_make(self.supp,{
            'A '+fixture.A+'.md':b'source A changed',
            'C '+fixture.C+'.md':('New content [known]('+known+'.md) [unknown]('+unknown+'.md)').encode(),
        })
        shutil.rmtree(self.dest)
        stage_additive(self.stage,self.original,[self.supp],self.dest,self.secret,volume_reviewed=True)
        r=self.verify()
        self.assertEqual(r['markdown_link_hints'],2)
        self.assertEqual(r['markdown_link_hints_resolved'],1)
        self.assertEqual(r['markdown_link_hints_unresolved'],1)
        self.assertFalse(r['source_scope_certified'])

if __name__=='__main__':
    unittest.main()
