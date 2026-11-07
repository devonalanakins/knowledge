import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 createNotionAttachmentCollector,readNotionFileBytes,verifyNotionAttachmentBytes,
} from '../src/notion-attachment-capture.mjs';

const A='11111111-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222';
const URL='https://file.notion.so/synthetic-asset?id=redacted-test-signature';
const NOW=()=>Date.parse('2026-11-06T12:00:00Z');
const EXPIRY='2026-11-06T12:30:00Z';
const BYTES=Buffer.from('synthetic private asset not suitable for GitHub','utf8');
const manifest=(url=URL,expiry=EXPIRY)=>({
  object:'block',id:B,type:'image',image:{
   type:'file',file:{url,expiry_time:expiry},caption:[],
  },has_children:false,
});
const streamResponse=(buffer=BYTES,{status=200,headers={}}={})=>
 new Response(buffer,{status,headers:{
   'content-type':'image/png',...headers,
 }});
const allowed=['file.notion.so'];

test('G20B captures owner-selected file bytes in memory with digest and provenance',async()=>{
 const requests=[];
 const collector=createNotionAttachmentCollector({
  approvedHosts:allowed,now:NOW,
  fetcher:async(url,options)=>{
   requests.push({url,options});
   return streamResponse();
  },
 });
 await collector.collect(manifest(),{sourcePageId:A,sourceBlockId:B,path:'block'});
 const archive=collector.finish();
 assert.equal(archive.attachments.length,1);
 assert.equal(archive.warnings.length,0);
 assert.equal(archive.bytes,BYTES.length);
 const restored=verifyNotionAttachmentBytes(archive.attachments);
 assert.deepEqual(restored,{files:1,bytes:BYTES.length});
 const file=archive.attachments[0];
 assert.equal(file.sourcePageId,A);
 assert.equal(file.sourceBlockId,B);
 assert.equal(file.sourcePath,'block/image');
 assert.equal(Buffer.from(file.base64,'base64').toString(),BYTES.toString());
 assert.match(file.sha256,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(archive).includes('redacted-test-signature'));
 assert.ok(!JSON.stringify(archive).includes('file.notion.so'));
 assert.equal(requests.length,1);
 assert.equal(requests[0].options.redirect,'error');
 assert.equal(requests[0].options.credentials,'omit');
 assert.equal(requests[0].options.method,'GET');
 assert.equal(requests[0].options.headers['Accept-Encoding'],'identity');
});
test('G20B refuses absent opt-in host configuration, external origins and URL tricks',async()=>{
 for(const hosts of [
  [],['evil.example.com'],['file.notion.so','file.notion.so'],
  ['file.notion.so','127.0.0.1'],
 ]){
  assert.throws(()=>createNotionAttachmentCollector({approvedHosts:hosts}),{
   code:hosts.length===0?'ASSET_HOSTS_REQUIRED':'INVALID_ASSET_HOST',
  });
 }
 let called=0;
 const fetcher=async()=>{called++;return streamResponse()};
 for(const url of [
  'http://file.notion.so/unsafe',
  'https://file.notion.so.evil.example.com/unsafe',
  'https://user:pass@file.notion.so/unsafe',
  'https://file.notion.so:8443/unsafe',
  'https://file.notion.so/safe#fragment',
  'https://127.0.0.1/internal',
  'https://169.254.169.254/metadata',
  'file:///etc/passwd',
 ]){
  await assert.rejects(()=>readNotionFileBytes({
   url,hosts:allowed,fetcher,
  }),{code:'UNTRUSTED_ASSET_URL'});
 }
 assert.equal(called,0);
});
test('G20B blocks expired Notion signatures before download and never follows external files',async()=>{
 let downloads=0;
 const collector=createNotionAttachmentCollector({
  approvedHosts:allowed,now:NOW,
  fetcher:async()=>{downloads++;return streamResponse()},
 });
 await assert.rejects(()=>collector.collect(manifest(URL,'2026-11-06T11:59:59Z'),{
   sourcePageId:A,sourceBlockId:B,path:'block',
 }),{code:'EXPIRED_NOTION_FILE'});
 assert.equal(downloads,0);
 await collector.collect({type:'external',external:{url:'https://example.org/remote'}},{
   sourcePageId:A,path:'properties',
 });
 assert.equal(downloads,0);
 assert.equal(collector.finish().warnings[0].code,'EXTERNAL_ASSET_NOT_CAPTURED');
});
test('G20B refuses redirect, malformed HTTP response, content length mismatch and non-stream response',async()=>{
 for(const [response,code] of [
  [new Response(null,{status:302,headers:{location:'http://169.254.169.254/'}}),
    'ASSET_DOWNLOAD_FAILED'],
  [new Response('missing',{status:404}),'ASSET_DOWNLOAD_FAILED'],
  [streamResponse(BYTES,{headers:{'content-length':'1'}}),'ASSET_LENGTH_MISMATCH'],
  [streamResponse(BYTES,{headers:{'content-length':'1000001'}}),'ASSET_TOO_LARGE'],
  [streamResponse(BYTES,{headers:{'content-length':'not-number'}}),'INVALID_ASSET_RESPONSE'],
  [{status:200,ok:true,headers:{get:()=>null},body:null},'ASSET_STREAM_REQUIRED'],
 ]){
  await assert.rejects(()=>readNotionFileBytes({
   url:URL,hosts:allowed,fetcher:async()=>response,
  }),{code});
 }
});
test('G20B bounds streamed bytes even when server omits Content-Length',async()=>{
 const reader={read:async()=>{
   return {done:false,value:new Uint8Array(1_000_001)};
 },cancel:async()=>{}};
 await assert.rejects(()=>readNotionFileBytes({
  url:URL,hosts:allowed,
  fetcher:async()=>({status:200,ok:true,headers:{get:()=>null},
    body:{getReader:()=>reader}}),
 }),{code:'ASSET_TOO_LARGE'});
});
test('G20B fails closed on incomplete, forged, duplicated or oversized recovery attachments',async()=>{
 const collector=createNotionAttachmentCollector({
  approvedHosts:allowed,now:NOW,fetcher:async()=>streamResponse(),
 });
 await collector.collect(manifest(),{sourcePageId:A,sourceBlockId:B,path:'block'});
 const valid=collector.finish().attachments[0];
 for(const modified of [
  {...valid,sha256:'0'.repeat(64)},
  {...valid,base64:Buffer.from('different bytes').toString('base64')},
  {...valid,base64:'%'},
  {...valid,byteLength:valid.byteLength+1},
  {...valid,sourceBlockId:'invalid'},
 ]){
  assert.throws(()=>verifyNotionAttachmentBytes([modified]),{
   code:'INVALID_ATTACHMENT_ARCHIVE'});
 }
 assert.throws(()=>verifyNotionAttachmentBytes([valid,valid]),{
   code:'INVALID_ATTACHMENT_ARCHIVE'});
 assert.throws(()=>verifyNotionAttachmentBytes(Array(9).fill(valid)),{
   code:'INVALID_ATTACHMENT_ARCHIVE'});
});
test('G20B enforces total selected asset count and size without writing any file',async()=>{
 let calls=0;
 const collector=createNotionAttachmentCollector({
  approvedHosts:allowed,now:NOW,fetcher:async()=>{
   calls++;return streamResponse(Buffer.alloc(430_000,65));
  },
 });
 const root={children:Array.from({length:9},(_,i)=>({
  type:'file',file:{url:URL,expiry_time:EXPIRY},key:i,
 }))};
 await assert.rejects(()=>collector.collect(root,{
  sourcePageId:A,path:'page',
 }),{code:'ASSET_LIMIT_EXCEEDED'});
 assert.ok(calls>=7&&calls<=8);
});

test('G20B rejects nonprogress streams, cancels input and does not hang',async()=>{
 let cancelled=0;
 const reader={read:async()=>({done:false,value:new Uint8Array(0)}),
  cancel:async()=>{cancelled++}};
 await assert.rejects(()=>readNotionFileBytes({
  url:URL,hosts:allowed,
  fetcher:async()=>({status:200,ok:true,headers:{get:()=>null},
   body:{getReader:()=>reader}}),
 }),{code:'INVALID_ASSET_RESPONSE'});
 assert.equal(cancelled,1);
});
test('G20B source reference budgets reject many unsupported links without network access',async()=>{
 let networkRequests=0;
 const collector=createNotionAttachmentCollector({approvedHosts:allowed,
  now:NOW,fetcher:async()=>{networkRequests++;return streamResponse()}});
 const many={children:Array.from({length:33},(_,i)=>({
  type:'external',external:{url:'https://example.org/foreign-'+i},
 }))};
 await assert.rejects(()=>collector.collect(many,{
  sourcePageId:A,path:'page',
 }),{code:'ASSET_REFERENCE_LIMIT'});
 assert.equal(networkRequests,0);
});
