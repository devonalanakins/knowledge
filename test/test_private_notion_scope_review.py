"""Synthetic-only tests for owner-local scope proposal ledger."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ops'/'private-notion'))
from import_quarantine import stage_additive
import scope_review as scope
from scope_review import (scope_inventory,scope_preview,propose_scope,ScopeReviewError)

spec=importlib.util.spec_from_file_location('fixture',ROOT/'test'/'test_private_notion_quarantine.py')
f=importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)

class ScopeReviewTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.stage=f.make_stage(self.root)
        self.original=self.root/'original.zip'
        self.supp=self.root/'extra.zip'
        self.dest=self.root/'quarantine'
        f.zipfile_make(self.original, {'A '+f.A+'.md':b'source A original',
                    'B '+f.B+'.md':b'source B unchanged'})
        f.zipfile_make(self.supp, {'A '+f.A+'.md':b'source A changed',
                    'B '+f.B+'.md':b'source B unchanged',
                    'C '+f.C+'.md':b'brand new source'})
        stage_additive(self.stage,self.original,[self.supp],self.dest,
                      f.SECRET,volume_reviewed=True)
        self.db=self.dest/'knowledge.sqlite'
        self.db_hash=hashlib.sha256(self.db.read_bytes()).hexdigest()
        self.ledger1=self.root/'scope-01.enc.json'
        self.ledger2=self.root/'scope-02.enc.json'
    def propose(self,filename,**kwargs):
        return propose_scope(self.dest, f.SECRET, kwargs.get('variant_id',1),
          kwargs.get('scope','personal'),kwargs.get('classification','sensitive'),
          kwargs.get('reason','requires-second-review'),filename,
          ledger=kwargs.get('ledger'))
    def test_inventory_contains_only_aggregate_denial_information(self):
        result=scope_inventory(self.dest,f.SECRET)
        self.assertEqual(result['quarantined_variants'],2)
        self.assertEqual(result['scope_proposals'],0)
        self.assertFalse(result['permissions_granted'])
        text=json.dumps(result)
        for v in [f.A,f.B,f.C,f.SECRET,'source A','brand new source']:
            self.assertNotIn(v,text)
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(),self.db_hash)
    def test_ledger_is_encrypted_and_binds_to_exact_quarantine(self):
        saved=self.propose(self.ledger1)
        self.assertEqual(saved['new_revision'],1)
        self.assertFalse(saved['permissions_granted'])
        raw=self.ledger1.read_bytes()
        for v in [f.A,f.B,f.C,f.SECRET,b'personal',b'sensitive',b'source A changed']:
            self.assertNotIn(v if isinstance(v,bytes) else v.encode(),raw)
        inventory=scope_inventory(self.dest,f.SECRET,ledger=self.ledger1)
        self.assertEqual(inventory['scope_proposals'],1)
        self.assertEqual(inventory['distinct_variants_proposed'],1)
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(),self.db_hash)
        self.assertFalse((self.dest/'knowledge.sqlite-wal').exists())
        with self.assertRaises(ScopeReviewError):
            scope_inventory(self.dest,'different private passphrase not genuine',ledger=self.ledger1)
    def test_append_only_revision_keeps_prior_ledger_unchanged(self):
        self.propose(self.ledger1)
        old=self.ledger1.read_bytes()
        v2=self.propose(self.ledger2,variant_id=2,scope='unassigned',
                        classification='unknown',reason='unresolved',ledger=self.ledger1)
        self.assertEqual(v2['new_revision'],2)
        self.assertEqual(old,self.ledger1.read_bytes())
        self.assertEqual(scope_inventory(self.dest,f.SECRET,ledger=self.ledger2)['scope_proposals'],2)
        self.assertFalse(scope_inventory(self.dest,f.SECRET,ledger=self.ledger2)['permissions_granted'])
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(),self.db_hash)
    def test_repeated_variant_keeps_history_rather_than_overwriting(self):
        self.propose(self.ledger1)
        self.propose(self.ledger2,variant_id=1,scope='unassigned',reason='unresolved',
                     ledger=self.ledger1)
        observed=scope_inventory(self.dest,f.SECRET,ledger=self.ledger2)
        self.assertEqual(observed['scope_proposals'],2)
        self.assertEqual(observed['distinct_variants_proposed'],1)
    def test_imported_ledger_cannot_sneak_unknown_or_clinical_assignment(self):
        key,sha,rows,_=scope._root_verified(self.dest,f.SECRET)
        r=rows[0]
        invalid={'sequence':1,'variant_id':r[0],'archive_ordinal':r[1],
                 'member_token':r[2],'source_token':r[3],'source_sha256':r[4],
                 'proposed_scope':'personal','classification':'clinical-or-client',
                 'reason':'source-context','state':'proposal-only'}
        blob=scope._new_ledger([invalid],None,key,sha)
        self.ledger1.write_bytes(blob);self.ledger1.chmod(0o600)
        with self.assertRaises(ScopeReviewError):
            scope_inventory(self.dest,f.SECRET,ledger=self.ledger1)
    def test_outdated_or_modified_ledger_is_rejected(self):
        self.propose(self.ledger1)
        doc=json.loads(self.ledger1.read_text())
        doc['database_sha256']='a'*64
        self.ledger1.write_text(json.dumps(doc));self.ledger1.chmod(0o600)
        with self.assertRaises(ScopeReviewError):
            scope_inventory(self.dest,f.SECRET,ledger=self.ledger1)
    def test_ciphertext_mutation_rejected(self):
        self.propose(self.ledger1)
        doc=json.loads(self.ledger1.read_text())
        original=base64.b64decode(doc['ciphertext'],validate=True)
        mutated=bytearray(original)
        mutated[0]^=1
        doc['ciphertext']=base64.b64encode(mutated).decode()
        self.assertNotEqual(base64.b64decode(doc['ciphertext'],validate=True),original)
        self.ledger1.write_text(json.dumps(doc));self.ledger1.chmod(0o600)
        with self.assertRaises(ScopeReviewError):
            scope_inventory(self.dest,f.SECRET,ledger=self.ledger1)
    def test_invalid_scope_reason_or_variant_fails_without_output(self):
        for values in [dict(scope='some-other-client'),dict(classification='public'),
                       dict(reason='automatically-approved'),dict(variant_id=0),
                       dict(variant_id=999),
                       dict(scope='personal',classification='clinical-or-client'),
                       dict(scope='anevum',classification='unknown'),
                       dict(scope='personal',reason='unresolved')]:
            with self.assertRaises(ScopeReviewError):
                self.propose(self.ledger1,**values)
            self.assertFalse(self.ledger1.exists())
    def test_refuses_existing_output_and_preserves_sentinel(self):
        self.ledger1.write_text('do not overwrite');self.ledger1.chmod(0o600)
        with self.assertRaises(ScopeReviewError):
            self.propose(self.ledger1)
        self.assertEqual(self.ledger1.read_text(),'do not overwrite')
    def test_reveal_requires_owner_explicit_optin(self):
        with self.assertRaises(ScopeReviewError):
            scope_preview(self.dest,f.SECRET,1)
        result=scope_preview(self.dest,f.SECRET,1,reveal_local=True)
        self.assertEqual(result['disposition'],'divergent')
        self.assertIn('source A changed',result['local_content_preview'])
        self.assertFalse(result['scope_approved'])
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(),self.db_hash)
    def test_cli_refuses_noninteractive_pipes(self):
        cli=ROOT/'ops'/'private-notion'/'scope_review.py'
        p=subprocess.run([sys.executable,str(cli),'--quarantine-dir',str(self.dest),
                          '--owner-reviewed-encrypted-volume','show','--variant-id','1',
                          '--reveal-local'],input='synthetic only',capture_output=True,text=True,
                         timeout=15)
        self.assertNotEqual(p.returncode,0)
        self.assertEqual(p.stdout,'')
        self.assertNotIn('source A',p.stderr)
    def test_output_ledger_symlink_refused(self):
        self.ledger1.symlink_to(self.db)
        with self.assertRaises(ScopeReviewError):
            self.propose(self.ledger1)
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(),self.db_hash)

if __name__=='__main__':
    unittest.main()
