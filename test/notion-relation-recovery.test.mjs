import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capturePaginatedRelationProperties} from '../src/notion-relation-recovery.mjs';
import {captureSelectedNotionContent} from '../src/notion-content-export.mjs';
import {createReadOnlyNotionClient} from '../src/notion-api-source.mjs';

const A='11111111-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222';
const C='33333333-3333-3333-3333-333333333333';
const D='44444444-4444-4444-4444-444444444444';
const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const norm=id=>id.replaceAll('-','').toLowerCase();
const ID='Related: source';
const PATH='/v1/pages/'+norm(A)+'/properties/'+encodeURIComponent(ID)+'?page_size=100';
const CURSOR=PATH+'&start_cursor=second';
const props={Title:{id:'title',type:'title',title:[]},
  Related:{id:ID,type:'relation',has_more:true,relation:[{id:B}]}};
const parent={type:'data_source_id',data_source_id:DS};
const source={sourceId:norm(A),register:'canon',
  scope:'anevum',dataSourceId:norm(DS),sourceUrl:'https://www.notion.so/'+norm(A),
  lastEdited:'2026-11-06T12:00:00.000Z',parent,properties:props,
  unresolvedRelations:1,archived:false,inTrash:false};
const inventory={format:'knowledge-notion-api-source-metadata-v1',
  identityFingerprint:'a'.repeat(64),records:[source]};
const page={object:'page',id:A,parent,url:source.sourceUrl,
  last_edited_time:source.lastEdited,properties:props,
  archived:false,in_trash:false};
const selection={format:'knowledge-notion-content-selection-v1',
  mode:'OWNER_SELECTED_READ_ONLY',scope:'anevum',
  resolvePaginatedRelations:true,sourceIds:[A]};
const item=id=>({object:'property_item',id:ID,type:'relation',relation:{id}});
const first={object:'list',results:[item(B)],has_more:true,next_cursor:'second'};
const second={object:'list',results:[item(C)],has_more:false,next_cursor:null};
function api(override={}){
  const routes={
    [PATH]:first,[CURSOR]:second,
    ['/v1/pages/'+norm(A)]:page,
    ['/v1/blocks/'+norm(A)+'/children?page_size=100']:
      {object:'list',results:[],has_more:false,next_cursor:null},
    ...override,
  };
  const calls=[];
  return {calls,client:{request:async(path)=>{
    calls.push(path);
    const value=routes[path];
    if(!value)throw Error('Unexpected synthetic route '+path);
    return typeof value==='function'?structuredClone(value()):structuredClone(value);
  }}};
}
test('G20 resolves all relation cursors and preserves original source prefix and identities',async()=>{
 const fixture=api();
 const result=await capturePaginatedRelationProperties({
   client:fixture.client,source,page,enabled:true});
 assert.deepEqual(result.relations[0].relatedPageIds,[norm(B),norm(C)]);
 assert.equal(result.relations[0].partialCount,1);
 assert.equal(result.relations[0].complete,true);
 assert.match(result.relations[0].sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(result.referencedIds,[norm(B),norm(C)]);
 assert.equal(result.requestCount,2);
 assert.deepEqual(fixture.calls,[PATH,CURSOR]);
});
test('G20 requires explicit owner selection and matches protected source inventory before requests',async()=>{
 const f=api();
 await assert.rejects(()=>capturePaginatedRelationProperties({
   client:f.client,source,page}),{code:'UNRESOLVED_RELATIONS'});
 await assert.rejects(()=>capturePaginatedRelationProperties({
   client:f.client,source:{...source,unresolvedRelations:0},page,enabled:true}),
   {code:'RELATION_INVENTORY_DRIFT'});
 await assert.rejects(()=>captureSelectedNotionContent({
   client:f.client,inventory,selection:{...selection,resolvePaginatedRelations:false},
   allowContentCapture:true}),{code:'UNRESOLVED_RELATIONS'});
 assert.deepEqual(f.calls,[]);
});
test('G20 integrates full relations into selected encrypted-archive source content',async()=>{
 const f=api();
 const captured=await captureSelectedNotionContent({
   client:f.client,inventory,selection,allowContentCapture:true});
 assert.equal(captured.counts.pages,1);
 assert.equal(captured.counts.resolvedRelationItems,2);
 assert.equal(captured.counts.blocks,0);
 assert.deepEqual(captured.pages[0].referencedNotionIds,[norm(B),norm(C)]);
 assert.deepEqual(captured.pages[0].resolvedRelationProperties[0].relatedPageIds,
   [norm(B),norm(C)]);
 assert.equal(captured.pages[0].page.properties.Related.has_more,true);
 assert.equal(captured.cutoverApproved,false);
 assert.equal(captured.mediaBytesCaptured,false);
 assert.match(captured.archiveSha256,/^[a-f0-9]{64}$/);
 assert.equal(f.calls.filter(x=>x===PATH).length,1);
});
test('G20 rejects repeated cursors, duplicate relations, invalid relation shapes and stale prefixes',async()=>{
 for(const [name,patch,code] of [
   ['cursor',{[CURSOR]:{...second,has_more:true,next_cursor:'second'}},
     'INVALID_RELATION_CURSOR'],
   ['duplicate',{[CURSOR]:{...second,results:[item(B)]}},
     'DUPLICATE_RELATION_ITEM'],
   ['shape',{[PATH]:{...first,results:[{object:'property_item',id:ID,
      type:'title',title:[]}] }},'INVALID_RELATION_RESPONSE'],
   ['prefix',{[PATH]:{...first,results:[item(C)]}},'RELATION_SOURCE_CHANGED'],
   ['empty-cursor',{[PATH]:{...first,results:[]}},'INVALID_RELATION_CURSOR'],
 ]){
   const f=api(patch);
   await assert.rejects(()=>capturePaginatedRelationProperties({
     client:f.client,source,page,enabled:true}),{code},name);
 }
});
test('G20 rejects malformed property IDs, duplicate IDs and page relation limits',async()=>{
 const f=api();
 await assert.rejects(()=>capturePaginatedRelationProperties({
   client:f.client,source,page:{...page,properties:{
     Related:{...props.Related,id:'..'},
   }},enabled:true}),{code:'INVALID_RELATION_PROPERTY'});
 const multi={...page,properties:{
   Related:props.Related,Other:{...props.Related},
 }};
 await assert.rejects(()=>capturePaginatedRelationProperties({
   client:f.client,source:{...source,unresolvedRelations:2},
   page:multi,enabled:true}),{code:'DUPLICATE_RELATION_PROPERTY'});
 const many={...page,properties:Object.fromEntries(Array.from({length:13},(_,i)=>
   ['p'+i,{...props.Related,id:'x'+i}]))};
 await assert.rejects(()=>capturePaginatedRelationProperties({
   client:f.client,source:{...source,unresolvedRelations:13},
   page:many,enabled:true}),{code:'RELATION_LIMIT_EXCEEDED'});
 assert.deepEqual(f.calls,[]);
});
test('G20 read-only client permits encoded relation property GET but rejects mutation and unsafe paths',async()=>{
 const calls=[];
 const c=createReadOnlyNotionClient({
   token:'synthetic-notion-token-no-real-access',delay:async()=>{},
   fetcher:async(url,options)=>{
     calls.push({url,method:options.method});
     return new Response(JSON.stringify(first),{status:200});
   },
 });
 const returned=await c.request(PATH);
 assert.equal(returned.results[0].relation.id,B);
 for(const [path,method] of [
   [PATH,'PATCH'],
   ['/v1/pages/'+norm(A)+'/properties/%2e%2e?page_size=100','GET'],
   ['/v1/pages/'+norm(A)+'/properties/Related%3A%20source?extra=1','GET'],
   ['/v1/pages/'+norm(A)+'/properties/Related%3A%20source?start_cursor=abc%0D','GET'],
   ['/v1/pages/'+norm(A)+'/properties/Other?page_size=500','GET'],
   ['/v1/pages/'+norm(A)+'/properties/Other/../../create','GET'],
 ]){
   await assert.rejects(()=>c.request(path,{method}),{code:'INVALID_PATH'});
 }
 assert.equal(calls.length,1);
 assert.equal(calls[0].method,'GET');
 assert.ok(calls[0].url.startsWith('https://api.notion.com/v1/pages/'));
});

test('G20 Notion already-percent-encoded property IDs are not double encoded',async()=>{
 const encodedId='f%5C%5C%3Ap';
 const encodedPath='/v1/pages/'+norm(A)+'/properties/'+encodedId+'?page_size=100';
 const encodedProps={...props,Related:{...props.Related,id:encodedId}};
 const original={...page,properties:encodedProps};
 const f=api({[encodedPath]:{object:'list',
   results:[{object:'property_item',id:encodedId,type:'relation',relation:{id:B}}],
   has_more:false,next_cursor:null}});
 const result=await capturePaginatedRelationProperties({
   client:f.client,source:{...source,properties:encodedProps},
   page:original,enabled:true,
 });
 assert.deepEqual(f.calls,[encodedPath]);
 assert.deepEqual(result.relations[0].relatedPageIds,[norm(B)]);
 assert.equal(result.relations[0].propertyId,encodedId);
});
