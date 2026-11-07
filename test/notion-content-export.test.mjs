import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureSelectedNotionContent} from '../src/notion-content-export.mjs';

const A='11111111-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222';
const C='33333333-3333-3333-3333-333333333333';
const D='44444444-4444-4444-4444-444444444444';
const E='55555555-5555-5555-5555-555555555555';
const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const normalized=id=>id.replaceAll('-','');
const pageUrl='https://www.notion.so/'+normalized(A);
const props={Title:{type:'title',title:[{type:'text',plain_text:'Synthetic knowledge',
  text:{content:'Synthetic knowledge'}}]}};
const record={
 sourceId:normalized(A),scope:'anevum',register:'canon-encyclopedia',
 dataSourceId:normalized(DS),sourceUrl:pageUrl,
 archived:false,inTrash:false,unresolvedRelations:0,
 lastEdited:'2026-11-06T12:00:00.000Z',
 parent:{type:'data_source_id',data_source_id:DS},properties:props,
};
const inventory={format:'knowledge-notion-api-source-metadata-v1',
 identityFingerprint:'a'.repeat(64),records:[record]};
const selection={format:'knowledge-notion-content-selection-v1',
 mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',sourceIds:[A]};
const page={object:'page',id:A,parent:record.parent,properties:props,
 url:pageUrl,last_edited_time:record.lastEdited,archived:false,in_trash:false};
function paragraph(id,{has_children=false,body='Synthetic block text',mention=null}={}){
 return {object:'block',id,type:'paragraph',has_children,
   paragraph:{rich_text:[mention??{type:'text',plain_text:body,text:{content:body}}]}};
}
function image(id){
 return {object:'block',id,type:'image',has_children:false,
   image:{type:'file',file:{url:'https://s3.example.org/SIGNED_SECRET?x=1',
     expiry_time:'2026-11-06T12:30:00Z'},caption:[]}};
}
function api(routes){
 const calls=[];
 return {calls,client:{request:async(path)=>{
   calls.push(path);
   const val=routes[path];
   if(!val)throw Error('Unexpected test API route: '+path);
   return typeof val==='function'?val():structuredClone(val);
 }}};
}
function routes(){
 return {
  ['/v1/pages/'+normalized(A)]:page,
  ['/v1/blocks/'+normalized(A)+'/children?page_size=100']:
    {results:[paragraph(B,{has_children:true})],has_more:true,next_cursor:'cursor-1'},
  ['/v1/blocks/'+normalized(A)+'/children?page_size=100&start_cursor=cursor-1']:
    {results:[image(D)],has_more:false,next_cursor:null},
  ['/v1/blocks/'+normalized(B)+'/children?page_size=100']:
    {results:[paragraph(C,{mention:{type:'mention',
      mention:{type:'page',page:{id:E}},plain_text:'Reference E'}})],
     has_more:false,next_cursor:null},
 };
}
test('G19 preserves native rich text, page hierarchy, page properties, Notion IDs and all nested block cursors',async()=>{
 const fixture=api(routes());
 const result=await captureSelectedNotionContent({
   client:fixture.client,inventory,selection,allowContentCapture:true});
 assert.equal(result.counts.pages,1);
 assert.equal(result.counts.blocks,3);
 assert.equal(result.pages[0].blocks.length,3);
 assert.deepEqual(result.pages[0].blocks.map(x=>x.order),[0,1,0]);
 assert.equal(result.pages[0].blocks[2].parentBlockId,normalized(B));
 assert.equal(result.pages[0].blocks[2].depth,1);
 assert.deepEqual(result.pages[0].referencedNotionIds,[normalized(E)]);
 assert.equal(result.pages[0].page.properties.Title.title[0].plain_text,'Synthetic knowledge');
 assert.equal(result.pages[0].warnings[0].code,'MEDIA_BYTES_NOT_CAPTURED');
 const serialized=JSON.stringify(result);
 assert.ok(!serialized.includes('SIGNED_SECRET'));
 assert.ok(!serialized.includes('s3.example.org'));
 assert.ok(serialized.includes('Reference E'));
 assert.equal(result.realDataImported,false);
 assert.equal(result.externalPermissionsCertified,false);
 assert.equal(result.mediaBytesCaptured,false);
 assert.equal(result.sourceCoverageCertified,false);
 assert.equal(result.cutoverApproved,false);
 assert.equal(result.plaintextDiskWritten,false);
 assert.equal(fixture.calls.filter(x=>x.includes('/v1/pages/')).length,2);
 assert.ok(fixture.calls.some(x=>x.includes('start_cursor=cursor-1')));
 assert.match(result.archiveSha256,/^[a-f0-9]{64}$/);
});
test('G19 explicit source selection is required; unrelated or protected scopes cannot be captured',async()=>{
 const {client,calls}=api(routes());
 for(const choose of [
   {...selection,mode:'ALL_WORKSPACE'},
   {...selection,scope:'cristy'},
   {...selection,sourceIds:[]},
   {...selection,sourceIds:[A,A]},
   {...selection,sourceIds:[E]},
 ]){
   await assert.rejects(()=>captureSelectedNotionContent({
     client,inventory,selection:choose,allowContentCapture:true
   }));
 }
 const outside={...inventory,records:[{...record,scope:'cristy'}]};
 await assert.rejects(()=>captureSelectedNotionContent({
   client,inventory:outside,selection,allowContentCapture:true
 }),{code:'SOURCE_SCOPE_BLOCKED'});
 await assert.rejects(()=>captureSelectedNotionContent({client,inventory,selection}),
   {code:'CONTENT_CAPTURE_NOT_AUTHORIZED'});
 assert.deepEqual(calls,[]);
});
test('G19 drift in page properties, parent, edit marker or archive state fails closed',async()=>{
 for(const mutation of [
   {properties:{Title:{type:'title',title:[]}}},
   {last_edited_time:'2026-11-06T13:00:00.000Z'},
   {parent:{type:'page_id',page_id:E}},
   {archived:true},
 ]){
   const sourceRoutes=routes();
   sourceRoutes['/v1/pages/'+normalized(A)]={...page,...mutation};
   await assert.rejects(()=>captureSelectedNotionContent({
     client:api(sourceRoutes).client,inventory,selection,allowContentCapture:true
   }),{code:'SOURCE_CHANGED'});
 }
});
test('G19 concurrent source edits after block enumeration abort instead of sealing stale content',async()=>{
 const testRoutes=routes();let requestNumber=0;
 testRoutes['/v1/pages/'+normalized(A)]=()=>{
   requestNumber++;return {...page,last_edited_time:
     requestNumber>1?'2026-11-06T15:00:00.000Z':record.lastEdited};
 };
 await assert.rejects(()=>captureSelectedNotionContent({
   client:api(testRoutes).client,inventory,selection,allowContentCapture:true,
 }),{code:'SOURCE_CHANGED'});
});
test('G19 repeated cursors, duplicate block IDs and depth-overflow are blocked',async()=>{
 const repeats=routes();
 repeats['/v1/blocks/'+normalized(A)+'/children?page_size=100&start_cursor=cursor-1']=
   {results:[image(D)],has_more:true,next_cursor:'cursor-1'};
 await assert.rejects(()=>captureSelectedNotionContent({
   client:api(repeats).client,inventory,selection,allowContentCapture:true,
 }),{code:'INVALID_NOTION_CURSOR'});
 const duplicates=routes();
 duplicates['/v1/blocks/'+normalized(A)+'/children?page_size=100&start_cursor=cursor-1']=
   {results:[paragraph(B)],has_more:false,next_cursor:null};
 await assert.rejects(()=>captureSelectedNotionContent({
   client:api(duplicates).client,inventory,selection,allowContentCapture:true,
 }),{code:'DUPLICATE_BLOCK'});
 const malformed=routes();
 malformed['/v1/blocks/'+normalized(B)+'/children?page_size=100']=
   {results:[{object:'block',id:C,type:'paragraph',has_children:true}],
    has_more:false,next_cursor:null};
 await assert.rejects(()=>captureSelectedNotionContent({
   client:api(malformed).client,inventory,selection,allowContentCapture:true,
 }),{code:'INVALID_CONTENT_RESPONSE'});
});
test('G19 child database and remote synced blocks are explicitly marked incomplete',async()=>{
 const sourceRoutes=routes();
 sourceRoutes['/v1/blocks/'+normalized(A)+'/children?page_size=100']={
   results:[
     {object:'block',id:B,type:'child_database',has_children:true,child_database:{title:'Another database'}},
     {object:'block',id:C,type:'synced_block',has_children:true,
       synced_block:{synced_from:{block_id:E}}},
   ],
   has_more:false,next_cursor:null,
 };
 const out=await captureSelectedNotionContent({
   client:api(sourceRoutes).client,inventory,selection,allowContentCapture:true,
 });
 assert.deepEqual(out.pages[0].warnings.map(x=>x.code).sort(),[
   'CHILD_PAGE_OR_DATABASE_NOT_EXPANDED','REMOTE_SYNCED_BLOCK_NOT_EXPANDED',
 ]);
 assert.equal(out.counts.blocks,2);
 assert.equal(out.pages[0].blocks[0].block.child_database.title,'Another database');
});
