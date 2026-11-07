/**
 * G22: compare two independently encrypted local snapshots:
 * G18 Notion source metadata and G19–G21 content capture.
 *
 * INTERNAL cross-archive consistency only: neither snapshot is signed by
 * Notion or proves all workspace roots, source permissions or legal consent.
 * No network, Knowledge writes, plaintext disk files or source identifiers
 * in returned reports.
 */
import {createHash} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const normalize=id=>String(id).replaceAll('-','').toLowerCase();
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const MAX_RECORDS=20000;
const MAX_NODES=150000;
const MAX_DEPTH=32;
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function requireValid(value,code,message){if(!value)fail(code,message);}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}

/** Sort property-object keys while omitting only ephemeral Notion file URLs. */
function stableSanitized(value){
 const budget={nodes:0};
 function walk(x,depth){
  requireValid(depth<=MAX_DEPTH&&++budget.nodes<=MAX_NODES,
    'SOURCE_LIMIT_EXCEEDED','Source comparison exceeds protected limits');
  if(Array.isArray(x))return x.map(item=>walk(item,depth+1));
  if(!object(x))return x;
  const result={};
  for(const key of Object.keys(x).sort()){
   const child=x[key];
   if(key==='file'&&object(child)&&typeof child.url==='string'){
    result[key]={notionSignedDownloadUrlOmitted:true};
   }else if(key==='expiry_time'&&typeof x.url==='string'){
    // File URL expiry alone does not change the source document contents.
   }else{
    result[key]=walk(child,depth+1);
   }
  }
  return result;
 }
 return walk(value,0);
}
function validateInventory(inventory){
 requireValid(object(inventory)&&
   inventory.format==='knowledge-notion-api-source-metadata-v1'&&
   Array.isArray(inventory.records)&&inventory.records.length>=1&&
   inventory.records.length<=MAX_RECORDS&&
   SHA.test(inventory.identityFingerprint||''),
   'INVALID_INVENTORY','Protected G18 Notion inventory is invalid');
 const byId=new Map(),immutable=[];
 for(const record of inventory.records){
  requireValid(object(record)&&UUID.test(record.sourceId||'')&&
    UUID.test(record.dataSourceId||'')&&
    typeof record.lastEdited==='string'&&
    Number.isFinite(Date.parse(record.lastEdited))&&
    typeof record.scope==='string'&&
    typeof record.register==='string'&&record.register.length>0&&
    object(record.parent)&&object(record.properties)&&
    Number.isSafeInteger(record.unresolvedRelations)&&
    record.unresolvedRelations>=0,
    'INVALID_INVENTORY','Stored G18 record metadata is malformed');
  const id=normalize(record.sourceId);
  requireValid(!byId.has(id),'DUPLICATE_NOTION_RECORD',
    'Stored G18 inventory repeats a source page');
  byId.set(id,record);
  immutable.push({
   id:record.sourceId,source:record.dataSourceId,
   edited:record.lastEdited,scope:record.scope,register:record.register,
   digest:hash(record.properties),
  });
 }
 immutable.sort((a,b)=>a.id.localeCompare(b.id));
 requireValid(hash(immutable)===inventory.identityFingerprint,
   'INVENTORY_FINGERPRINT_MISMATCH',
   'G18 identity fingerprint does not match encrypted inventory records');
 requireValid(inventory.uniqueSourceRecords===undefined||
   inventory.uniqueSourceRecords===byId.size,
   'INVALID_INVENTORY','Stored source-count claim does not match records');
 return byId;
}
function verifyRelations(source,page){
 const truncated=Object.entries(source.properties).filter(([,property])=>
   object(property)&&property.type==='relation'&&property.has_more===true);
 requireValid(truncated.length===source.unresolvedRelations,
   'INVENTORY_RELATION_DRIFT','G18 relation pagination counts disagree');
 const recovered=page.resolvedRelationProperties??[];
 requireValid(Array.isArray(recovered)&&recovered.length===truncated.length,
   'SOURCE_RELATION_MISMATCH',
   'Content archive does not preserve all paginated relation properties');
 const found=new Map();
 for(const item of recovered){
  requireValid(object(item)&&item.complete===true&&
    typeof item.propertyName==='string'&&
    typeof item.propertyId==='string'&&
    Array.isArray(item.relatedPageIds)&&
    Number.isSafeInteger(item.partialCount),
    'SOURCE_RELATION_MISMATCH','Recovered relation metadata is incomplete');
  requireValid(!found.has(item.propertyName),'SOURCE_RELATION_MISMATCH',
    'Recovered property repeats a source name');
  found.set(item.propertyName,item);
 }
 for(const [name,prop] of truncated){
  const item=found.get(name),prefix=prop.relation;
  requireValid(item&&Array.isArray(prefix)&&item.propertyId===prop.id&&
    item.partialCount===prefix.length&&
    prefix.every((value,index)=>UUID.test(value?.id||'')&&
      item.relatedPageIds[index]===normalize(value.id)),
    'SOURCE_RELATION_MISMATCH',
    'Recovered relations do not preserve the original G18 prefix');
 }
 return truncated.length;
}
/**
 * Called only after caller independently authenticates and verifies the
 * encrypted G19 content snapshot; validates G18's original fingerprint here.
 */
export function reconcileNotionInventoryWithContent(inventory,content){
 const sourceById=validateInventory(inventory);
 requireValid(object(content)&&
   content.format==='knowledge-notion-private-content-batch-v1'&&
   content.sourceInventoryFingerprint===inventory.identityFingerprint&&
   content.mode==='OWNER_SELECTED_READ_ONLY'&&content.scope==='anevum'&&
   Array.isArray(content.pages)&&content.pages.length>=1&&
   content.pages.length<=8&&
   Array.isArray(content.sourceIds)&&
   content.sourceIds.length===content.pages.length,
   'SOURCE_INVENTORY_MISMATCH',
   'Selected content archive belongs to a different source inventory');
 const used=new Set();
 let recoveredRelationProperties=0;
 for(let i=0;i<content.pages.length;i++){
  const page=content.pages[i];
  requireValid(object(page)&&UUID.test(page.sourceId||'')&&
    content.sourceIds[i]===page.sourceId,
    'SOURCE_SELECTION_MISMATCH','Selected source ID order changed');
  const id=normalize(page.sourceId);
  const original=sourceById.get(id);
  requireValid(original&&!used.has(id)&&original.scope==='anevum'&&
    original.archived===false&&original.inTrash===false,
    'SOURCE_SELECTION_MISMATCH','Content includes an unapproved or repeated source page');
  used.add(id);
  requireValid(object(page.page)&&UUID.test(page.page.id||'')&&
    normalize(page.page.id)===id&&
    page.scope===original.scope&&
    page.register===original.register&&
    normalize(page.dataSourceId||'')===normalize(original.dataSourceId)&&
    page.lastEdited===original.lastEdited&&
    page.page.last_edited_time===original.lastEdited&&
    page.sourceUrl===original.sourceUrl&&
    equal(page.parent,original.parent)&&
    equal(page.page.parent,original.parent),
    'SOURCE_METADATA_MISMATCH','Captured page identity or source properties drifted');
  requireValid(equal(stableSanitized(page.page.properties),
    stableSanitized(original.properties)),
    'SOURCE_PROPERTIES_MISMATCH',
    'Captured page properties differ from the original inventory');
  recoveredRelationProperties+=verifyRelations(original,page);
 }
 return {
  format:'knowledge-notion-dual-archive-reconciliation-v1',
  encryptedInventoryFingerprintVerified:true,
  selectedPagesReconciled:used.size,
  originalInventoryPages:sourceById.size,
  paginatedRelationPropertiesReconciled:recoveredRelationProperties,
  selectedSourceMetadataConsistent:true,
  selectedSourcePropertiesConsistent:true,
  selectedArchivesInternallyConsistent:true,
  independentNotionSourceCertified:false,
  sourcePermissionsCertified:false,
  completeWorkspaceSourceCoverageCertified:false,
  privateRehearsalAuthorized:false,
  liveNotionSourceReadPerformed:false,
  dataImported:false,
  productionReady:false,
  cutoverApproved:false,
 };
}
