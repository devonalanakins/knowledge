import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyNotionClient,enumerateNotionSourceMetadata} from '../src/notion-api-source.mjs';

const A='11111111-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222';
const C='33333333-3333-3333-3333-333333333333';
const DS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SECOND='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const registers=[{dataSourceId:DS,scope:'anevum',register:'canon-articles',expectedCount:3}];
function page(id,extra={}){
 return {object:'page',id,url:'https://www.notion.so/'+id.replaceAll('-',''),
   last_edited_time:'2026-11-06T12:00:00.000Z',
   parent:{type:'data_source_id',data_source_id:DS},
   properties:{Title:{id:'title',type:'title',title:[]},
     Related:{id:'rel',type:'relation',relation:[],has_more:false}},...extra};
}
function responses(items){
 const calls=[];
 const fetcher=async(url,options)=>{
   calls.push({url,method:options.method,body:options.body,
     version:options.headers['Notion-Version'],
     auth:options.headers.Authorization,redirect:options.redirect});
   const item=items.shift();
   return new Response(JSON.stringify(item),{
     status:200,headers:{'Content-Type':'application/json'}});
 };
 return {calls,fetcher};
}
const client=x=>createReadOnlyNotionClient({
 token:'synthetic-token-never-usable',
 fetcher:x.fetcher,delay:async()=>{},
});
test('G18 enumerates every cursor of explicitly configured read-only source metadata',async()=>{
 const responsesApi=responses([
   {object:'list',results:[page(A),page(B)],has_more:true,next_cursor:'cursor-two'},
   {object:'list',results:[page(C)],has_more:false,next_cursor:null},
 ]);
 const result=await enumerateNotionSourceMetadata({
   client:client(responsesApi),registers,allowMetadataOnly:true});
 assert.equal(result.uniqueSourceRecords,3);
 assert.equal(result.records.length,3);
 assert.equal(result.counts['canon-articles'].apiLoads,2);
 assert.equal(result.counts['canon-articles'].matchedObservedCount,true);
 assert.equal(result.warnings.length,0);
 assert.equal(result.sourceCoverageCertified,false);
 assert.equal(result.realDataImported,false);
 assert.equal(result.cutoverApproved,false);
 assert.match(result.identityFingerprint,/^[0-9a-f]{64}$/);
 assert.deepEqual(responsesApi.calls.map(x=>x.method),['POST','POST']);
 assert.deepEqual(responsesApi.calls.map(x=>x.version),['2025-09-03','2025-09-03']);
 assert.ok(responsesApi.calls.every(x=>x.url.includes('/v1/data_sources/')));
 assert.ok(responsesApi.calls.every(x=>x.redirect==='error'));
 assert.equal(JSON.parse(responsesApi.calls[1].body).start_cursor,'cursor-two');
 assert.equal(JSON.parse(responsesApi.calls[0].body).page_size,100);
});
test('G18 fails closed for duplicate IDs in different registers and repeated pagination cursor',async()=>{
 const response=responses([
   {results:[page(A)],has_more:false,next_cursor:null},
   {results:[page(A)],has_more:false,next_cursor:null},
 ]);
 await assert.rejects(()=>enumerateNotionSourceMetadata({
   client:client(response),
   registers:[...registers,{dataSourceId:SECOND,scope:'anevum',register:'timeline'}],
   allowMetadataOnly:true}),{code:'DUPLICATE_NOTION_RECORD'});
 const cyc=responses([
   {results:[page(A)],has_more:true,next_cursor:'same'},
   {results:[page(B)],has_more:true,next_cursor:'same'},
 ]);
 await assert.rejects(()=>enumerateNotionSourceMetadata({
   client:client(cyc),registers,allowMetadataOnly:true}),{code:'INVALID_NOTION_CURSOR'});
});
test('G18 restricted scopes, invalid sources and authorization omission are rejected before requests',async()=>{
 const fake=responses([]);
 for(const reg of [
   {dataSourceId:DS,scope:'cristy',register:'clinical'},
   {dataSourceId:'invalid',scope:'anevum',register:'canon'},
   {dataSourceId:DS,scope:'anevum',register:'c'},
   {...registers[0],expectedCount:-1},
 ]){
   await assert.rejects(()=>enumerateNotionSourceMetadata({
     client:client(fake),registers:[reg],allowMetadataOnly:true}),{code:'INVALID_SOURCE_CONFIG'});
 }
 await assert.rejects(()=>enumerateNotionSourceMetadata({
   client:client(fake),registers}),{code:'INVENTORY_NOT_AUTHORIZED'});
 await assert.rejects(()=>enumerateNotionSourceMetadata({
   client:client(fake),registers:[registers[0],registers[0]],
   allowMetadataOnly:true}),{code:'DUPLICATE_SOURCE'});
 assert.equal(fake.calls.length,0);
});
test('G18 count drift is marked, never certified, and relation/file references need separate retrieval',async()=>{
 const f=responses([{results:[page(A,{properties:{
   Files:{type:'files',files:[{type:'file',file:{url:'https://example.org/a'}}]},
   Related:{type:'relation',relation:[],has_more:true},
 }})],has_more:false,next_cursor:null}]);
 const result=await enumerateNotionSourceMetadata({
   client:client(f),registers,allowMetadataOnly:true});
 assert.equal(result.counts['canon-articles'].matchedObservedCount,false);
 assert.deepEqual(result.warnings.map(x=>x.code).sort(),
   ['COUNT_DRIFT','FILE_REFERENCES_NOT_ARCHIVED','PAGINATED_RELATION_PROPERTY']);
 assert.equal(result.attachmentsCaptured,false);
 assert.equal(result.sourcePermissionsCertified,false);
});
test('G18 read-only client rejects malformed transport and never emits token in exceptions',async()=>{
 assert.throws(()=>createReadOnlyNotionClient({token:'short'}),{code:'NOTION_TOKEN_REQUIRED'});
 const x=responses([{results:[],has_more:false,next_cursor:null}]);
 const c=client(x);
 await assert.rejects(()=>c.request('https://other.example/'),{code:'INVALID_PATH'});
 await assert.rejects(()=>c.request('/v1/../evil'),{code:'INVALID_PATH'});
 const secret='secret_api_token_to_never_appear';
 const bad=createReadOnlyNotionClient({token:secret,
   delay:async()=>{},fetcher:async()=>new Response('secret_api_token_to_never_appear',{status:401})});
 await assert.rejects(()=>bad.request('/v1/search',{method:'POST',body:{}}),
   error=>error.code==='NOTION_HTTP_ERROR'&&!String(error).includes(secret));
});
test('G18 retry-after handles rate limits without unlimited loops',async()=>{
 let count=0,delays=[];
 const c=createReadOnlyNotionClient({
   token:'synthetic-token-never-usable',delay:async ms=>{delays.push(ms)},
   fetcher:async()=>{
     count++;
     return count===1?new Response('rate limit',{status:429,headers:{'retry-after':'1'}}):
       new Response(JSON.stringify({results:[],has_more:false,next_cursor:null}),{status:200});
   },
 });
 const response=await c.request('/v1/data_sources/'+DS+'/query',{method:'POST',body:{page_size:100}});
 assert.equal(response.results.length,0);
 assert.equal(count,2);
 assert.ok(delays.some(ms=>ms===1000));
});
