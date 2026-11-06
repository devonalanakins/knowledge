/**
 * Private, metadata-only review of a possible Notion-to-Knowledge organization.
 * Nothing is read from source bodies, written to a database, shared or imported.
 * A proposed path or backlink is NOT an approved migration.
 */
import {PORTALS,RECORD_TYPES,LIFECYCLE_STATUSES,CANON_STATUSES,LINK_KINDS,
  portalById,normalizeTitle,proposedPath} from './wiki-taxonomy.mjs';
import {verifyHierarchyApproval} from './hierarchy-approval.mjs';

const UUID=/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const SHA=/^[a-f0-9]{64}$/i;
const TYPES=new Set(['markdown','html','database_csv']);
function cleanId(value) {
  return typeof value==='string'&&UUID.test(value) ? value.replaceAll('-','').toLowerCase() : null;
}
function validUrl(value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;
  } catch {return false;}
}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}

/** All titles, IDs and paths in the return value are sensitive private metadata. */
export function planOrganizedMigration({preflight,inventory,classifications=[],trustedReviewers={},approvalOptions={}}={}) {
  if(preflight?.format!=='knowledge-notion-preflight-v1'||!Array.isArray(preflight.entries)||
     preflight.entries.length>100000||!object(preflight.summary)||
     inventory?.format!=='knowledge-notion-inventory-v1'||!Array.isArray(inventory.records)||
     inventory.records.length>100000||!Array.isArray(classifications)||
     classifications.length>100000||!object(trustedReviewers)||!object(approvalOptions))
     throw new TypeError('Expected bounded Notion preflight, inventory, classifications and trusted reviewer configuration');
  const findings=[],findingKeys=new Set();
  function flag(code,id,severity='blocker',target=null){
    const k=[code,id,target].join(':');
    if(!findingKeys.has(k)){findingKeys.add(k);findings.push({code,id,severity,...(target?{target}:{})});}
  }
  function index(rows,idField,dupCode,invalidCode){
    const result=new Map();
    for(const row of rows){
      const id=object(row)?cleanId(row[idField]):null;
      if(!id){flag(invalidCode,null);continue;}
      if(result.has(id)){flag(dupCode,id);continue;}
      result.set(id,row);
    }
    return result;
  }
  // Export files without original IDs are not silently dropped.
  const exports=new Map();
  for(const entry of preflight.entries){
    if(!object(entry)){flag('INVALID_EXPORT_ENTRY',null);continue;}
    const id=entry.originalNotionId===null?null:cleanId(entry.originalNotionId);
    if(!id){if(TYPES.has(entry.type))flag('MISSING_OR_INVALID_SOURCE_ID',null);continue;}
    if(exports.has(id))flag('DUPLICATE_EXPORTED_ID',id);
    else exports.set(id,entry);
  }
  const originals=index(inventory.records,'id','DUPLICATE_INVENTORY_ID','INVALID_INVENTORY_ID');
  const choices=index(classifications,'id','DUPLICATE_CLASSIFICATION_ID','INVALID_CLASSIFICATION_ID');
  const nodes=[],byId=new Map(),byPath=new Map(),byTitle=new Map(),byAlias=new Map();
  for(const [id,original] of originals){
    const exportEntry=exports.get(id),chosen=choices.get(id);
    if(!exportEntry){flag('MISSING_EXPORTED_ORIGINAL',id);continue;}
    if(!['page','database_row'].includes(original.kind)||original.accessible!==true||
        typeof original.scope!=='string'||original.scope==='unknown')
      flag('UNVERIFIED_SOURCE_ACCESS_OR_SCOPE',id);
    if(exportEntry.type!=='markdown')flag('NON_MARKDOWN_FIDELITY_REVIEW',id);
    if(!SHA.test(exportEntry.sha256??'')||!Number.isSafeInteger(exportEntry.bytes)||
       exportEntry.bytes<0)flag('INVALID_EXPORT_FINGERPRINT',id);
    if(exportEntry.missingLocalLinks>0||exportEntry.remoteNotionLinks>0)
      flag('BROKEN_OR_UNRESOLVED_SOURCE_LINKS',id);
    if(!chosen){flag('UNCLASSIFIED_SOURCE',id);continue;}
    const portal=portalById(chosen.portal);
    if(!portal){flag('UNKNOWN_PORTAL',id);continue;}
    if(!portal.scopes.includes(original.scope))flag('PORTAL_SCOPE_MISMATCH',id);
    if(!RECORD_TYPES.includes(chosen.recordType))flag('UNKNOWN_RECORD_TYPE',id);
    if(!LIFECYCLE_STATUSES.includes(chosen.status))flag('UNVERIFIED_LIFECYCLE',id);
    if(chosen.portal==='transcosmic-canon'&&!CANON_STATUSES.includes(chosen.canonStatus))
      flag('CANON_AUTHORITY_REVIEW_REQUIRED',id);
    if(typeof chosen.title!=='string'||chosen.title.trim().length===0||chosen.title.length>160)
      flag('INVALID_TITLE',id);
    if(!validUrl(chosen.sourceUrl))flag('MISSING_SOURCE_PROVENANCE',id);
    const path=proposedPath(chosen.portal,chosen.recordType,chosen.title);
    if(!path||path.length>240)flag('INVALID_PROPOSED_PATH',id);
    const parent=chosen.parentId==null?null:cleanId(chosen.parentId);
    if(chosen.parentId!=null&&!parent)flag('INVALID_PARENT_ID',id);
    if(parent===id)flag('SELF_PARENT',id);
    const sourceParent=exportEntry.parentNotionId==null?null:cleanId(exportEntry.parentNotionId);
    if(exportEntry.parentNotionId!=null&&!sourceParent)
      flag('INVALID_SOURCE_PARENT_ID',id);
    if(sourceParent!==parent){
      // A boolean supplied by the mutable catalog is NOT an approval.
      // A separately trusted, scoped and signed receipt is mandatory.
      if(typeof chosen.parentChangeReason!=='string'||
         chosen.parentChangeReason.trim().length<12||
         chosen.parentChangeReason.length>500)
        flag('UNJUSTIFIED_HIERARCHY_CHANGE',id);
      if(!object(chosen.hierarchyApproval))
        flag('UNREVIEWED_SOURCE_HIERARCHY',id);
      else if(!verifyHierarchyApproval(chosen.hierarchyApproval,{
        sourceId:id,scope:original.scope,sourceSha256:exportEntry.sha256,
        fromParentId:sourceParent,toParentId:parent,toPath:path,
        reason:chosen.parentChangeReason,
      },trustedReviewers,approvalOptions))
        flag('UNVERIFIED_HIERARCHY_APPROVAL',id);
    }
    if(!Array.isArray(chosen.links))flag('UNREVIEWED_RELATIONS',id,'review');
    if(Array.isArray(chosen.aliases)&&chosen.aliases.length>32)flag('TOO_MANY_ALIASES',id);
    const aliases=Array.isArray(chosen.aliases)?chosen.aliases.slice(0,32).filter(x=>typeof x==='string'&&x.trim()&&x.length<=160):[];
    if(Array.isArray(chosen.aliases)&&chosen.aliases.some(x=>typeof x!=='string'||x.length>160))flag('INVALID_ALIAS',id);
    const node={id,scope:original.scope,portal:portal.id,color:portal.color,
      recordType:chosen.recordType,title:chosen.title,status:chosen.status,
      canonStatus:portal.id==='transcosmic-canon'?chosen.canonStatus:null,
      path,sourceUrl:chosen.sourceUrl,sourceSha256:exportEntry.sha256,
      parentId:parent,originalParentId:sourceParent,
      aliases,outbound:[],backlinks:[]};
    nodes.push(node);byId.set(id,node);
    if(path){
      const pathKey=original.scope+':'+path;
      if(byPath.has(pathKey))flag('CANONICAL_PATH_COLLISION',id,'blocker',byPath.get(pathKey));
      else byPath.set(pathKey,id);
    }
    const subjectKey=[original.scope,portal.id,normalizeTitle(chosen.title)].join(':');
    const match=byTitle.get(subjectKey);
    if(!normalizeTitle(chosen.title)){} // Invalid titles have no meaningful identity key.
    else if(match&&match.recordType===chosen.recordType)flag('POSSIBLE_DUPLICATE_SUBJECT',id,'blocker',match.id);
    else if(match)flag('RELATED_SUBJECT_DIFFERENT_REGISTER',id,'review',match.id);
    else byTitle.set(subjectKey,{id,recordType:chosen.recordType});
    for(const alias of [chosen.title,...aliases]){
      const aliasKey=[original.scope,portal.id,chosen.recordType,normalizeTitle(alias)].join(':');
      if(!normalizeTitle(alias))continue;
      const existing=byAlias.get(aliasKey);
      if(existing&&existing!==id)flag('ALIAS_COLLISION',id,'blocker',existing);
      else byAlias.set(aliasKey,id);
    }
  }
  for(const id of exports.keys())if(!originals.has(id))flag('EXPORT_ID_NOT_IN_INVENTORY',id);
  for(const id of choices.keys())if(!originals.has(id))flag('CLASSIFICATION_NOT_IN_INVENTORY',id);
  if(inventory.enumerationComplete!==true)flag('INCOMPLETE_INVENTORY',null);
  if(preflight.summary.workspaceCoverageVerified!==true)flag('UNCERTIFIED_EXPORT_COVERAGE',null);
  const edges=[],seenEdges=new Set();
  function connect(from,to,type,owner){
    const src=byId.get(from),dst=byId.get(to);
    if(!src||!dst){flag('UNRESOLVED_REFERENCE',owner,'blocker',to);return;}
    if(src.scope!==dst.scope){flag('CROSS_SCOPE_LINK_FORBIDDEN',owner,'blocker',to);return;}
    const key=[from,to,type].join(':');
    if(seenEdges.has(key))return;
    seenEdges.add(key);
    edges.push({from,to,type});src.outbound.push({to,type});dst.backlinks.push({from,type});
  }
  for(const node of nodes){
    const chosen=choices.get(node.id);
    if(node.parentId)connect(node.parentId,node.id,'contains',node.id);
    if(Array.isArray(chosen.links)){
      if(chosen.links.length>200)flag('TOO_MANY_LINKS',node.id);
      for(const item of chosen.links.slice(0,200)){
        const target=cleanId(item?.targetId);
        if(!target||!LINK_KINDS.includes(item.type)){flag('INVALID_LINK',node.id);continue;}
        if(target===node.id){flag('SELF_LINK',node.id);continue;}
        connect(node.id,target,item.type,node.id);
      }
    }
  }
  for(const node of nodes){
    const visited=new Set();let parent=node.id;
    while(parent){
      if(visited.has(parent)){flag('HIERARCHY_CYCLE',node.id);break;}
      visited.add(parent);
      parent=byId.get(parent)?.parentId??null;
    }
    if(!node.parentId&&node.recordType!=='index'&&!node.backlinks.length)
      flag('POSSIBLE_ORPHAN',node.id,'review');
  }
  nodes.sort((a,b)=>(a.path??'').localeCompare(b.path??'')||a.id.localeCompare(b.id));
  findings.sort((a,b)=>String(a.id).localeCompare(String(b.id))||a.code.localeCompare(b.code));
  const counts=Object.fromEntries(PORTALS.map(p=>[p.id,nodes.filter(n=>n.portal===p.id).length]));
  return {format:'knowledge-organization-review-v1',mode:'METADATA_ONLY_PRIVATE_REVIEW',
    counts,legend:PORTALS.map(p=>({id:p.id,label:p.label,color:p.color})),
    imported:false,fullSourceCoverageVerified:false,cutoverApproved:false,
    nodes,edges,findings,blockingFindings:findings.filter(f=>f.severity==='blocker').length};
}
