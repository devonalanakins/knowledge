/**
 * Compare a Notion export preflight with a separately obtained API inventory.
 * This tool is read-only and has no authority to import, approve or publish data.
 * Record IDs and parent relationships are sensitive source metadata.
 */
import { ExportInspectionError } from './notion-export.mjs';

const ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const SCOPES = new Set(['personal','family','devonstation','anevum','cristy','mizvo','external','unknown']);
const KINDS = new Set(['page','database','database_row']);
const fail=(message)=>{throw new ExportInspectionError('INVALID_INVENTORY',message)};
const normalizedId=(id)=>{if(typeof id!=='string'||!ID.test(id))fail('Source inventory requires valid Notion identifiers');return id.toLowerCase().replaceAll('-','')};
const basic=(x)=> x !== null&&typeof x==='object'&&!Array.isArray(x);

/**
 * The returned detailed arrays contain sensitive IDs: they must never be logged
 * publicly. `summary` is aggregate-only and safe for routine diagnostics.
 * `migrationApproved` is deliberately always false; independent content,
 * permissions, and restore checks remain separate gates.
 */
export function reconcileNotionInventory(preflight,inventory){
  if(!basic(preflight)||preflight.format!=='knowledge-notion-preflight-v1'||!Array.isArray(preflight.entries)||!basic(preflight.summary)){
    fail('Expected validated Notion export preflight');
  }
  if(!basic(inventory)||inventory.format!=='knowledge-notion-inventory-v1'||!Array.isArray(inventory.records)||inventory.records.length>100000){
    fail('Expected separately obtained, bounded Notion inventory');
  }
  const ids=new Map(), repeated=[];
  const scopes=Object.fromEntries([...SCOPES].map(x=>[x,{total:0,matched:0,missing:0,rowsWithoutIdentityMatch:0,inaccessible:0}]));
  for(const record of inventory.records){
    if(!basic(record)||!KINDS.has(record.kind)||!SCOPES.has(record.scope)||typeof record.accessible!=='boolean'){
      fail('Inventory records require id, kind, explicit source scope and access flag');
    }
    const id=normalizedId(record.id);
    if(ids.has(id))repeated.push(id);
    else ids.set(id,{...record,id});
  }
  const inExport=new Map();
  for(const entry of preflight.entries){
    if(!basic(entry))fail('Invalid preflight entry');
    if(entry.originalNotionId){
      const id=normalizedId(entry.originalNotionId);
      const listed=inExport.get(id)||[];
      listed.push(entry);
      inExport.set(id,listed);
    }
  }
  const missing=[],rowsUnmapped=[],inaccessible=[],unknownScopes=[];
  let matched=0;
  for(const [id,record] of ids){
    const scope=scopes[record.scope];scope.total++;
    if(!record.accessible){inaccessible.push(id);scope.inaccessible++;}
    if(record.scope==='unknown')unknownScopes.push(id);
    if(inExport.has(id)){matched++;scope.matched++;}
    else if(record.kind==='database_row'){rowsUnmapped.push(id);scope.rowsWithoutIdentityMatch++;}
    else {missing.push(id);scope.missing++;}
  }
  const extra=[...inExport.keys()].filter(id=>!ids.has(id));
  const csvRows=Number(preflight.summary.databaseCsvRows||0);
  const summary={
    inventoryRecords:inventory.records.length,
    inventoryUniqueIds:ids.size,
    exportedDistinctIds:inExport.size,
    matchedDirectIds:matched,
    missingExportedPagesOrDatabases:missing.length,
    databaseRowsWithoutIdMatch:rowsUnmapped.length,
    extraExportIds:extra.length,
    duplicateInventoryIds:repeated.length,
    inaccessibleInventoryIds:inaccessible.length,
    recordsWithUnknownScope:unknownScopes.length,
    csvRowsWithoutRecordReconciliation:csvRows,
    preflightWarnings:Object.values(preflight.summary.warnings||{}).reduce((a,n)=>a+(Number(n)||0),0),
    sourceScopeCounts:scopes,
    inventoryClaimsFullEnumeration:inventory.enumerationComplete===true,
    identityCoverageProven:false,
    permissionCoverageProven:false,
    sourceContentFidelityProven:false,
    migrationApproved:false,
  };
  return {
    format:'knowledge-notion-coverage-v1', summary,
    sensitiveDetails:{missingSourceIds:missing,unmappedRowIds:rowsUnmapped,extraExportIds:extra,duplicateInventoryIds:repeated,inaccessibleIds:inaccessible,unknownScopeIds:unknownScopes},
    nextGates:[
      'Reconcile every database row against stable source IDs and relations',
      'Verify all private and shared root pages are accessible and exported',
      'Approve scope boundaries and classify imported content',
      'Verify content fidelity, archived assets, source URLs and backlinks',
      'Independently decrypt, restore, search and audit permissions before a bounded cutover',
    ],
  };
}
