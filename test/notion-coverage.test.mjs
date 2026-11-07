import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileNotionInventory } from '../src/notion-coverage.mjs';
const id=a=>a.repeat(32);
const page=(sourceId,kind='page',scope='personal',accessible=true)=>({id:sourceId,kind,scope,accessible});
const report={format:'knowledge-notion-preflight-v1',entries:[{originalNotionId:id('a')},{originalNotionId:id('b')},{originalNotionId:null}],summary:{databaseCsvRows:2,warnings:{UNVERIFIED_CSV:1}}};
const inventory=(records,enumerationComplete=true)=>({format:'knowledge-notion-inventory-v1',enumerationComplete,records});
test('comparator reconciles IDs without claiming full migration on matched pages',()=>{
 const result=reconcileNotionInventory(report,inventory([page(id('a')),page(id('b'))]));
 assert.equal(result.summary.matchedDirectIds,2);
 assert.equal(result.summary.missingExportedPagesOrDatabases,0);
 assert.equal(result.summary.csvRowsWithoutRecordReconciliation,2);
 assert.equal(result.summary.migrationApproved,false);
 assert.equal(result.summary.permissionCoverageProven,false);
 assert.equal(result.summary.sourceContentFidelityProven,false);
});
test('separates missing database rows from missing pages and permission boundaries',()=>{
 const result=reconcileNotionInventory(report,inventory([
  page(id('a'),'page','devonstation'),page(id('c'),'page','cristy'),page(id('d'),'database_row','anevum'),page(id('e'),'page','unknown',false),
 ]));
 assert.equal(result.summary.matchedDirectIds,1);
 assert.equal(result.summary.missingExportedPagesOrDatabases,2);
 assert.equal(result.summary.databaseRowsWithoutIdMatch,1);
 assert.equal(result.summary.inaccessibleInventoryIds,1);
 assert.equal(result.summary.recordsWithUnknownScope,1);
 assert.equal(result.summary.extraExportIds,1);
 assert.equal(result.sensitiveDetails.missingSourceIds.length,2);
 assert.equal(result.summary.sourceScopeCounts.cristy.missing,1);
 assert.equal(result.summary.migrationApproved,false);
});
test('flags repeated inventory records and accepts hyphenated UUIDs',()=>{
 const result=reconcileNotionInventory(report,inventory([page(id('a')),page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')]));
 assert.equal(result.summary.duplicateInventoryIds,1);
 assert.equal(result.summary.inventoryUniqueIds,1);
 assert.equal(result.summary.migrationApproved,false);
});
test('rejects unknown scope, malformed ID, missing access evidence and invalid report',()=>{
 for(const row of [page('not-an-id'),page(id('f'),'page','unscoped'),{id:id('f'),kind:'page',scope:'personal'}]){
  assert.throws(()=>reconcileNotionInventory(report,inventory([row])),{code:'INVALID_INVENTORY'});
 }
 assert.throws(()=>reconcileNotionInventory({},inventory([])),{code:'INVALID_INVENTORY'});
});
test('inventory-only assertions cannot make incomplete exports appear complete',()=>{
 const result=reconcileNotionInventory(report,inventory([],true));
 assert.equal(result.summary.inventoryClaimsFullEnumeration,true);
 assert.equal(result.summary.extraExportIds,2);
 assert.equal(result.summary.identityCoverageProven,false);
});
