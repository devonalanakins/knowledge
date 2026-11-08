"""Synthetic-only tests for private read-only Notion export reconciliation."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import warnings
import zipfile

module_path=Path(__file__).resolve().parents[1]/'ops/private-notion/reconcile_exports.py'
spec=importlib.util.spec_from_file_location('reconciler',module_path)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
ID1='a'*32
ID2='b'*32
ID3='c'*32

def makezip(path,files):
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for key,body in files.items():
            archive.writestr(key,body)

def stage(path,docs):
    con=sqlite3.connect(path)
    con.executescript(
        'CREATE TABLE notion_originals (notion_id TEXT,source_sha256 TEXT,source_kind TEXT);'
        'CREATE TABLE records (id TEXT);')
    import hashlib
    for n,(id,body) in enumerate(docs.items()):
        con.execute('INSERT INTO notion_originals VALUES (?,?,?)',
                    (id,hashlib.sha256(body).hexdigest(),'markdown'))
        con.execute('INSERT INTO records VALUES (?)',(str(n),))
    con.commit()
    con.close()

class TestNotionExportReconciliation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db=Path(self.temp.name)/'staged.sqlite'
        self.original=Path(self.temp.name)/'original.zip'
        self.extra=Path(self.temp.name)/'supplement.zip'
        stage(self.db,{ID1:b'first'})
        makezip(self.original,{'First '+ID1+'.md':b'first'})
        makezip(self.extra,{'First '+ID1+'.md':b'first','Edited '+ID2+'.md':b'new'})
    def test_existing_and_new_sources_preserved_in_counts(self):
        outcome=mod.reconcile(self.db,self.original,[self.extra])
        self.assertEqual(outcome['supplemental_new_markdown_source_ids'],1)
        self.assertEqual(outcome['supplemental_unchanged_markdown_sources'],1)
        self.assertEqual(outcome['supplemental_conflicting_markdown_candidates'],0)
        self.assertEqual(outcome['staged_records'],1)
        self.assertNotIn(ID1,json.dumps(outcome))
        self.assertFalse(outcome['data_imported'])
    def test_changed_duplicate_reported_as_unresolved(self):
        makezip(self.extra,{'First '+ID1+'.md':b'edited','Third '+ID3+'.md':b'other'})
        outcome=mod.reconcile(self.db,self.original,[self.extra])
        self.assertEqual(outcome['supplemental_conflicting_markdown_candidates'],1)
        self.assertEqual(outcome['supplemental_new_markdown_source_ids'],1)
    def test_conflict_even_when_one_of_two_supplementals_matches_staging(self):
        second=Path(self.temp.name)/'second.zip'
        makezip(second,{'First '+ID1+'.md':b'different'})
        outcome=mod.reconcile(self.db,self.original,[self.extra,second])
        self.assertEqual(outcome['supplemental_conflicting_markdown_candidates'],1)
        self.assertEqual(outcome['supplemental_internal_multi_variant_ids'],1)
    def test_refuses_staging_mismatch(self):
        makezip(self.original,{'First '+ID1+'.md':b'tampered'})
        with self.assertRaises(mod.AuditError):
            mod.reconcile(self.db,self.original,[self.extra])
    def test_refuses_unsafe_member_path(self):
        makezip(self.extra,{'../other-workspace.md':b'secret'})
        with self.assertRaises(mod.AuditError):
            mod.reconcile(self.db,self.original,[self.extra])
    def test_refuses_repeated_zip_member(self):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',UserWarning)
            with zipfile.ZipFile(self.extra,'w') as archive:
                archive.writestr('Duplicate '+ID2+'.md',b'a')
                archive.writestr('Duplicate '+ID2+'.md',b'b')
        with self.assertRaises(mod.AuditError):
            mod.reconcile(self.db,self.original,[self.extra])
    def test_refuses_symlink_members(self):
        info=zipfile.ZipInfo('Link '+ID2+'.md')
        info.create_system=3
        info.external_attr=(0o120777 << 16)
        with zipfile.ZipFile(self.extra,'w') as archive:
            archive.writestr(info,b'target')
        with self.assertRaises(mod.AuditError):
            mod.reconcile(self.db,self.original,[self.extra])
    def test_refuses_same_export_twice(self):
        with self.assertRaises(mod.AuditError):
            mod.reconcile(self.db,self.original,[self.original])
    def test_unidentified_markdown_not_assigned_guessed_id(self):
        makezip(self.extra,{'Untitled.md':b'unnamed'})
        outcome=mod.reconcile(self.db,self.original,[self.extra])
        self.assertEqual(outcome['unidentified_supplemental_markdown'],1)
        self.assertEqual(outcome['supplemental_new_markdown_source_ids'],0)

if __name__ == '__main__':
    unittest.main()
