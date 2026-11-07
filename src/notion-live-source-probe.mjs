/**
 * G23 — minimal, fail-closed read-only Notion metadata probe.
 *
 * This checks the previously inventoried, explicitly selected Anevum pages
 * against the live read-only API response. It does not fetch blocks, media,
 * child pages, database records, permissions, history or other workspace roots.
 * The returned report is intentionally aggregate-only. No production release
 * or private-data authorization is inferred from a successful HTTP read.
 */
import {validateInventory,checkPage} from './notion-content-export.mjs';
import {verifyNotionInventoryFingerprint} from './notion-dual-archive-reconcile.mjs';

function reject(code,message){const error=new Error(message);error.code=code;throw error;}
function requireValid(ok,code,message){if(!ok)reject(code,message);}

/**
 * A bounded, double-read probe detects page edits occurring during the
 * selected sample. No source or Knowledge writes are ever performed.
 *
 * "allowRead" is an explicit execution opt-in, NOT a compliance certification.
 * Real access must occur only in a separately approved private environment.
 */
export async function probeSelectedNotionSource({
 inventory,selection,client,allowRead=false,
}={}){
 requireValid(allowRead===true,'SOURCE_PROBE_NOT_AUTHORIZED',
   'Explicit read-only source probe opt-in required');
 requireValid(client&&typeof client.request==='function',
   'INVALID_CLIENT','Read-only Notion API client required');
 const verified=verifyNotionInventoryFingerprint(inventory);
 const selected=validateInventory(inventory,selection);
 requireValid(selected.length>=1&&selected.length<=8,
   'INVALID_SELECTION','Selected sample exceeds eight Notion pages');
 // Confirm every selected record is valid before the FIRST network read.
 for(const source of selected){
  requireValid(source.scope==='anevum'&&
    source.archived===false&&source.inTrash===false&&
    typeof source.sourceId==='string'&&
    /^[a-f0-9]{32}$/.test(source.sourceId),
    'SOURCE_SCOPE_BLOCKED','Only protected active Anevum source IDs are allowed');
 }
 // The client controls transport. The production CLI constructs the existing
 // strictly read-only allowlisted Notion API client, never a mutation client.
 for(const source of selected){
  const page=await client.request('/v1/pages/'+source.sourceId);
  checkPage(page,source);
 }
 // Read each selected page once more after the entire batch to detect
 // concurrent edits, including changes between different pages in the batch.
 for(const source of selected){
  const page=await client.request('/v1/pages/'+source.sourceId);
  checkPage(page,source);
 }
 return {
  format:'knowledge-notion-live-metadata-probe-v1',
  selectedPagesCompared:selected.length,
  selectedRegistersCompared:new Set(selected.map(x=>x.register)).size,
  metadataReadRequests:selected.length*2,
  encryptedInventoryFingerprintVerified:
    verified.sourceInventoryFingerprintVerified,
  selectedPageIdentityMatched:true,
  selectedPageParentMatched:true,
  selectedPageEditMarkersMatched:true,
  selectedPagePropertiesMatched:true,
  sourceClientInvoked:true,
  blockBodiesRead:false,
  mediaBytesDownloaded:false,
  relatedPagesTraversed:false,
  notionSourceMutated:false,
  knowledgeRecordsModified:false,
  // None of the following can be inferred from effective read access.
  sourceLegalOwnershipCertified:false,
  sourcePermissionsCertified:false,
  completeWorkspaceCoverageCertified:false,
  restrictedNetworkEgressCertified:false,
  independentNotionSourceCertified:false,
  independentRecoveryVerified:false,
  privateRehearsalAuthorized:false,
  dataImported:false,productionReady:false,cutoverApproved:false,
 };
}
