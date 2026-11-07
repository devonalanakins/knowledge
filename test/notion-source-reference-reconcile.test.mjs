import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileEncryptedNotionSourceReferences} from '../src/notion-source-reference-reconcile.mjs';

const PAGE='11111111-1111-1111-1111-111111111111';
const BLOCK='22222222-2222-2222-2222-222222222222';
const TWO='33333333-3333-3333-3333-333333333333';
const file={type:'file',file:{notionSignedDownloadUrlOmitted:true}};
const external={type:'external',external:{url:'https://example.org/asset'}};
const upload={type:'file_upload',file_upload:{id:'fictional-private-upload'}};
function snapshot({pageFiles=[],blockFile=file,attachments=[]}={}){
 return {pages:[{
   sourceId:PAGE,
   page:{id:PAGE,properties:{Files:{type:'files',files:pageFiles}}},
   blocks:blockFile?[{id:BLOCK,block:{object:'block',id:BLOCK,
     type:'image',image:blockFile}}]:[],
 }],attachments};
}
const attachment=(path='block/image',sourceBlockId=BLOCK)=>({
 sourcePageId:PAGE,sourceBlockId,sourcePath:path,
});
test('G20C exact redacted block-reference evidence matches selected archive paths',()=>{
 const v=reconcileEncryptedNotionSourceReferences(snapshot({
   attachments:[attachment()],
 }));
 assert.equal(v.selectedPages,1);
 assert.equal(v.sourceBlocks,1);
 assert.equal(v.notionFileReferences,1);
 assert.equal(v.archivedNotionFiles,1);
 assert.equal(v.missingNotionFileBytes,0);
 assert.equal(v.selectedSourceFileReferencesAccounted,true);
 assert.equal(v.originalFileAuthenticityCertified,false);
 assert.equal(v.sourcePermissionsCertified,false);
 assert.equal(v.cutoverApproved,false);
 assert.ok(!JSON.stringify(v).includes(PAGE));
 assert.ok(!JSON.stringify(v).includes(BLOCK));
 assert.ok(!JSON.stringify(v).includes('block/image'));
});
test('G20C distinguishes missing bytes, external files, and unresolved uploads',()=>{
 const v=reconcileEncryptedNotionSourceReferences(snapshot({
   pageFiles:[file,external,upload],attachments:[],
 }));
 assert.equal(v.notionFileReferences,2);
 assert.equal(v.archivedNotionFiles,0);
 assert.equal(v.missingNotionFileBytes,2);
 assert.equal(v.externalFileReferences,1);
 assert.equal(v.pendingUploadReferences,1);
 assert.equal(v.selectedSourceFileReferencesAccounted,false);
});
test('G20C rejects forged provenance, wrong page and block, duplicates and external pairing',()=>{
 const data=snapshot({
   pageFiles:[external],attachments:[attachment()],
 });
 for(const invalid of [
   {...data,attachments:[attachment('block/unknown')]},
   {...data,attachments:[attachment('block/image',TWO)]},
   {...data,attachments:[{...attachment(),sourcePageId:TWO}]},
   {...data,attachments:[attachment(),attachment()]},
   {...data,attachments:[attachment('page/properties/Files/files/0',null)]},
 ]){
  assert.throws(()=>reconcileEncryptedNotionSourceReferences(invalid),
   {code:'INVALID_ARCHIVE'});
 }
});
test('G20C validates page-file property pointers and escaped JSON names',()=>{
 const v=reconcileEncryptedNotionSourceReferences({
   pages:[{sourceId:PAGE,page:{properties:{
    'Media/Files':{type:'files',files:[file]},
   }},blocks:[]}],
   attachments:[attachment('page/properties/Media~1Files/files/0',null)],
 });
 assert.equal(v.selectedSourceFileReferencesAccounted,true);
});
test('G20C fails closed on unredacted source URL, incomplete marker and malformed scope',()=>{
 for(const raw of [
   {type:'file',file:{url:'https://file.notion.so/signed?secret=1'}},
   {type:'file',file:{notionSignedDownloadUrlOmitted:true,url:'https://example.org'}},
   {type:'file',file:{notionSignedDownloadUrlOmitted:false}},
 ]){
  assert.throws(()=>reconcileEncryptedNotionSourceReferences(snapshot({
   blockFile:raw,attachments:[],
  })),{code:'INVALID_ARCHIVE'});
 }
 assert.throws(()=>reconcileEncryptedNotionSourceReferences({
  pages:[{sourceId:PAGE,page:{},blocks:[]},
    {sourceId:PAGE,page:{},blocks:[]}],
  attachments:[],
 }),{code:'INVALID_ARCHIVE'});
 assert.throws(()=>reconcileEncryptedNotionSourceReferences({
   pages:[{sourceId:PAGE,page:{},blocks:[{id:BLOCK,block:{}},{id:BLOCK,block:{}}]}],
   attachments:[],
 }),{code:'INVALID_ARCHIVE'});
});
test('G20C bounded walk rejects pathological numbers of references',()=>{
 const many=Array.from({length:6001},()=>external);
 assert.throws(()=>reconcileEncryptedNotionSourceReferences({
  pages:[{sourceId:PAGE,page:{files:many},blocks:[]}],attachments:[],
 }),{code:'INVALID_ARCHIVE'});
});
