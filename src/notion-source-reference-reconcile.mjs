/**
 * G20C: cross-check encrypted archive attachment evidence against the
 * redacted page/block source references. Operates in memory, offline.
 *
 * This checks the archive's INTERNAL consistency. It cannot certify original
 * Notion permissions, bytes, history or workspace coverage independently.
 */
const UUID=/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const LIMITS=Object.freeze({nodes:120000,depth:28,references:6000});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>value.replaceAll('-','').toLowerCase();
function reject(message){
 const error=new Error(message);error.code='INVALID_ARCHIVE';throw error;
}
function requireSafe(value,message){if(!value)reject(message);}
function key(pageId,blockId,path){
 return JSON.stringify([canonical(pageId),blockId?canonical(blockId):null,path]);
}
function walkSource(root,path,sourceId,sourceBlockId,found,budget){
 function descend(value,position,depth){
  requireSafe(depth<=LIMITS.depth&&++budget.nodes<=LIMITS.nodes,
    'Source reference scan exceeds safe bounds');
  if(Array.isArray(value)){
   for(let i=0;i<value.length;i++)descend(value[i],position+'/'+i,depth+1);
   return;
  }
  if(!object(value))return;
  let kind=null;
  if(value.type==='file'){
   requireSafe(object(value.file)&&
     value.file.notionSignedDownloadUrlOmitted===true&&
     Object.keys(value.file).length===1,
     'Unredacted or malformed Notion file URL found in archive');
   kind='notion';
  }else if(value.type==='external'){
   requireSafe(object(value.external),'Malformed external-file reference in archive');
   kind='external';
  }else if(value.type==='file_upload'){
   requireSafe(object(value.file_upload),'Malformed file-upload reference in archive');
   kind='upload';
  }
  if(kind){
   requireSafe(++budget.references<=LIMITS.references,
    'Too many file references in archive');
   const reference={kind,sourcePageId:canonical(sourceId),
     sourceBlockId:sourceBlockId?canonical(sourceBlockId):null,
     sourcePath:position};
   const identity=key(reference.sourcePageId,reference.sourceBlockId,position);
   requireSafe(!found.has(identity),'Repeated source file reference path');
   found.set(identity,reference);
   return;
  }
  for(const [name,child] of Object.entries(value)){
   const escaped=name.replaceAll('~','~0').replaceAll('/','~1');
   descend(child,position+'/'+escaped,depth+1);
  }
 }
 descend(root,path,0);
}
/**
 * No source-body strings, file paths or Notion IDs leave this function.
 * Only aggregate counts should be printed by the private CLI.
 */
export function reconcileEncryptedNotionSourceReferences(snapshot){
 requireSafe(object(snapshot)&&Array.isArray(snapshot.pages)&&
   snapshot.pages.length>=1&&snapshot.pages.length<=8,
   'Archive pages required for source-reference reconciliation');
 const budget={nodes:0,references:0};
 const expected=new Map(),seenPages=new Set();
 let blocks=0;
 for(const page of snapshot.pages){
   requireSafe(object(page)&&UUID.test(page.sourceId||'')&&
     object(page.page)&&Array.isArray(page.blocks),
     'Invalid page source in archive');
   const pageId=canonical(page.sourceId);
   requireSafe(!seenPages.has(pageId),'Repeated page in source archive');
   seenPages.add(pageId);
   walkSource(page.page,'page',pageId,null,expected,budget);
   const seenBlocks=new Set();
   for(const entry of page.blocks){
     requireSafe(object(entry)&&UUID.test(entry.id||'')&&
       object(entry.block),'Invalid original block in archive');
     const blockId=canonical(entry.id);
     requireSafe(!seenBlocks.has(blockId),'Repeated source block in archive');
     seenBlocks.add(blockId);blocks++;
     walkSource(entry.block,'block',pageId,blockId,expected,budget);
   }
 }
 const attachments=snapshot.attachments??[];
 requireSafe(Array.isArray(attachments),'Attachment evidence must be a list');
 const claimed=new Set();
 for(const item of attachments){
   requireSafe(object(item)&&UUID.test(item.sourcePageId||'')&&
     (item.sourceBlockId===null||UUID.test(item.sourceBlockId||''))&&
     typeof item.sourcePath==='string',
     'Invalid attachment provenance');
   const identity=key(item.sourcePageId,item.sourceBlockId,item.sourcePath);
   requireSafe(!claimed.has(identity),'Duplicate source attachment provenance');
   claimed.add(identity);
   const source=expected.get(identity);
   requireSafe(source?.kind==='notion',
     'Attachment bytes lack an exact redacted Notion source reference');
 }
 let notionReferences=0,externalReferences=0,uploadReferences=0;
 for(const ref of expected.values()){
   if(ref.kind==='notion')notionReferences++;
   else if(ref.kind==='external')externalReferences++;
   else uploadReferences++;
 }
 const missingNotionBytes=notionReferences-attachments.length;
 requireSafe(missingNotionBytes>=0,'Extra archived file bytes without source references');
 return {
   selectedPages:seenPages.size,sourceBlocks:blocks,
   notionFileReferences:notionReferences,
   archivedNotionFiles:attachments.length,
   missingNotionFileBytes:missingNotionBytes,
   externalFileReferences:externalReferences,
   pendingUploadReferences:uploadReferences,
   selectedSourceFileReferencesAccounted:
     missingNotionBytes===0&&externalReferences===0&&uploadReferences===0,
   sourceCoverageCertified:false,sourcePermissionsCertified:false,
   originalFileAuthenticityCertified:false,cutoverApproved:false,
 };
}
