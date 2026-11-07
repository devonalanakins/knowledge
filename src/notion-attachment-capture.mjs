/**
 * G20B — owner-selected, small Notion-hosted file-byte capture into MEMORY.
 * No local plaintext files, cross-page crawling, external URL ingestion or
 * writes to Notion. The caller must encrypt and verify before persistence.
 *
 * This is a bounded source-evidence pilot, NOT a complete media migration.
 */
import {createHash} from 'node:crypto';

const HOSTS=new Set([
 'file.notion.so',
 'prod-files-secure.s3.us-west-2.amazonaws.com',
 's3.us-west-2.amazonaws.com',
 's3.us-east-1.amazonaws.com',
]);
const MAX_FILES=8;
const MAX_FILE_BYTES=1_000_000;
const MAX_TOTAL_BYTES=3_000_000;
const MAX_SCAN_NODES=30_000;
const MAX_SCAN_DEPTH=24;
const MAX_CONTENT_TYPE=120;
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fail(code,message){
 const error=new Error(message);error.code=code;throw error;
}
function check(ok,code,message){if(!ok)fail(code,message);}
function canonicalHosts(input){
 check(Array.isArray(input)&&input.length>=1&&input.length<=4,
  'ASSET_HOSTS_REQUIRED','Explicit allowed Notion file hosts are required');
 const out=new Set();
 for(const host of input){
  check(typeof host==='string'&&HOSTS.has(host)&&!out.has(host),
   'INVALID_ASSET_HOST','Unrecognized or duplicate Notion file host');
  out.add(host);
 }
 return out;
}
function fileUrl(candidate,hosts){
 check(typeof candidate==='string'&&candidate.length<=4096,
   'INVALID_ASSET_URL','Notion-hosted file URL required');
 let url;
 try{url=new URL(candidate)}catch{fail('INVALID_ASSET_URL','Invalid file source URL')}
 check(url.protocol==='https:'&&!url.username&&!url.password&&
   !url.hash&&!url.port&&hosts.has(url.hostname)&&
   url.hostname===url.hostname.toLowerCase(),
   'UNTRUSTED_ASSET_URL','File URL origin is not owner-approved');
 return url.href;
}
function findFileReferences(root,basePath){
 const results=[];let nodes=0;
 function visit(value,path,depth){
  check(depth<=MAX_SCAN_DEPTH&&++nodes<=MAX_SCAN_NODES,
   'ASSET_SCAN_LIMIT','Source document exceeds file-reference scan limits');
  if(Array.isArray(value)){
   value.forEach((item,index)=>visit(item,path+'/'+index,depth+1));
   return;
  }
  if(!object(value))return;
  if(value.type==='file'&&object(value.file)){
   results.push({path,kind:'notion',url:value.file.url,
     expiry:value.file.expiry_time??null});
   return;
  }
  if(value.type==='external'&&object(value.external)){
   results.push({path,kind:'external'});
   return;
  }
  if(value.type==='file_upload'&&object(value.file_upload)){
   results.push({path,kind:'upload'});
   return;
  }
  for(const [key,item] of Object.entries(value)){
   const escaped=key.replaceAll('~','~0').replaceAll('/','~1');
   visit(item,path+'/'+escaped,depth+1);
  }
 }
 visit(root,basePath,0);
 return results;
}
/**
 * Stream the decoded response bytes with a hard cap. Redirects are rejected:
 * accepting an unexpected Location would bypass exact-host approval.
 * Only the URL is supplied; no Notion API bearer or cookies are forwarded.
 * An operator-controlled restricted egress/DNS environment is still required.
 */
export async function readNotionFileBytes({
 url,hosts,fetcher=globalThis.fetch,
}={}){
 check(typeof fetcher==='function','INVALID_ASSET_FETCHER',
  'A streaming HTTPS fetcher is required');
 const allowed=hosts instanceof Set?hosts:canonicalHosts(hosts);
 const source=fileUrl(url,allowed);
 let response;
 try{
  response=await fetcher(source,{
   method:'GET',redirect:'error',credentials:'omit',
   cache:'no-store',headers:{'Accept-Encoding':'identity'},
   signal:AbortSignal.timeout(15000),
  });
 }catch{fail('ASSET_DOWNLOAD_FAILED','Notion file fetch failed')}
 check(response&&response.status===200&&response.ok,
  'ASSET_DOWNLOAD_FAILED','Notion file response must be successful without redirects');
 const lengthHeader=response.headers?.get?.('content-length');
 const declared=lengthHeader===null||lengthHeader===undefined?null:Number(lengthHeader);
 check(declared===null||(Number.isSafeInteger(declared)&&declared>=0),
   'INVALID_ASSET_RESPONSE','Invalid asset content length');
 check(declared===null||declared<=MAX_FILE_BYTES,
  'ASSET_TOO_LARGE','Notion asset exceeds per-file limit');
 const reader=response.body?.getReader?.();
 check(reader&&typeof reader.read==='function','ASSET_STREAM_REQUIRED',
  'A bounded streaming asset response is required');
 let used=0;const chunks=[];
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   check(value instanceof Uint8Array,
    'INVALID_ASSET_RESPONSE','Invalid binary stream chunk');
   used+=value.byteLength;
   check(used<=MAX_FILE_BYTES,'ASSET_TOO_LARGE',
    'Notion asset exceeded per-file byte limit');
   chunks.push(value);
  }
 }catch(error){
  await reader.cancel().catch(()=>{});
  throw error;
 }
 check(used>0,'EMPTY_ASSET','Cannot archive an empty Notion file');
 check(declared===null||used===declared,
  'ASSET_LENGTH_MISMATCH','Downloaded asset byte count differs from response');
 const bytes=Buffer.concat(chunks,used);
 const rawType=response.headers?.get?.('content-type');
 const baseType=typeof rawType==='string'?rawType.split(';')[0].trim().toLowerCase():'';
 const mimeType=baseType.length<=MAX_CONTENT_TYPE&&
  /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(baseType)?
   baseType:'application/octet-stream';
 return {bytes,mimeType};
}
/**
 * The collector never stores temporary signed URLs. Only authenticated
 * ciphertext may be written by the calling G19/G20 archive writer.
 */
export function createNotionAttachmentCollector({
 approvedHosts,fetcher=globalThis.fetch,now=Date.now,
}={}){
 const hosts=canonicalHosts(approvedHosts);
 check(typeof now==='function','INVALID_CLOCK','Clock is required');
 const attachments=[],warnings=[];
 let totalBytes=0;
 return {
  get capturedCount(){return attachments.length;},
  async collect(root,{sourcePageId,sourceBlockId=null,path='source'}={}){
   check(typeof sourcePageId==='string'&&/^[a-f0-9-]{32,36}$/i.test(sourcePageId)&&
     (sourceBlockId===null||typeof sourceBlockId==='string')&&
     typeof path==='string','INVALID_ASSET_SOURCE','Source provenance required');
   const refs=findFileReferences(root,path);
   for(const ref of refs){
    if(ref.kind==='external'||ref.kind==='upload'){
     warnings.push({code:ref.kind==='external'?
       'EXTERNAL_ASSET_NOT_CAPTURED':'UNSUPPORTED_ASSET_REFERENCE',
       sourcePageId,sourceBlockId,path:ref.path});
     continue;
    }
    check(attachments.length<MAX_FILES,
      'ASSET_LIMIT_EXCEEDED','Selected file count exceeds protected limit');
    const time=Number(new Date(ref.expiry));
    check(typeof ref.expiry==='string'&&Number.isFinite(time)&&
      time>now(),'EXPIRED_NOTION_FILE','Notion temporary download URL expired');
    const {bytes,mimeType}=await readNotionFileBytes({
      url:ref.url,hosts,fetcher,
    });
    totalBytes+=bytes.byteLength;
    check(totalBytes<=MAX_TOTAL_BYTES,
      'ASSET_LIMIT_EXCEEDED','Selected file bytes exceed protected limit');
    const record={sourcePageId,sourceBlockId,sourcePath:ref.path,
      byteLength:bytes.byteLength,mimeType,
      sha256:sha(bytes),base64:bytes.toString('base64')};
    attachments.push(record);
    bytes.fill(0);
   }
   return {captured:refs.filter(ref=>ref.kind==='notion').length,
     unsupported:refs.filter(ref=>ref.kind!=='notion').length};
  },
  finish(){
   return {attachments,warnings,bytes:totalBytes};
  },
 };
}
export function verifyNotionAttachmentBytes(attachments){
 check(Array.isArray(attachments)&&attachments.length<=MAX_FILES,
   'INVALID_ATTACHMENT_ARCHIVE','Invalid attachment evidence list');
 let bytesTotal=0;
 const sources=new Set();
 for(const record of attachments){
  check(object(record)&&typeof record.sourcePageId==='string'&&
    /^[a-f0-9-]{32,36}$/i.test(record.sourcePageId)&&
    typeof record.sourcePath==='string'&&
    record.sourcePath.length<=1024&&
    (record.sourceBlockId===null||
      (typeof record.sourceBlockId==='string'&&
       /^[a-f0-9-]{32,36}$/i.test(record.sourceBlockId)))&&
    typeof record.mimeType==='string'&&
    /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(record.mimeType)&&
    Number.isSafeInteger(record.byteLength)&&
    record.byteLength>0&&record.byteLength<=MAX_FILE_BYTES&&
    typeof record.sha256==='string'&&/^[a-f0-9]{64}$/.test(record.sha256)&&
    typeof record.base64==='string'&&
    record.base64.length<=Math.ceil(MAX_FILE_BYTES*4/3)+4&&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.base64),
    'INVALID_ATTACHMENT_ARCHIVE','Invalid attachment record');
  const key=[record.sourcePageId,record.sourceBlockId,record.sourcePath].join('|');
  check(!sources.has(key),'INVALID_ATTACHMENT_ARCHIVE',
   'Repeated attachment provenance');
  sources.add(key);
  const buffer=Buffer.from(record.base64,'base64');
  check(buffer.toString('base64')===record.base64&&
    buffer.length===record.byteLength&&sha(buffer)===record.sha256,
    'INVALID_ATTACHMENT_ARCHIVE','Attachment bytes fail SHA-256 round trip');
  bytesTotal+=buffer.length;
  check(bytesTotal<=MAX_TOTAL_BYTES,'INVALID_ATTACHMENT_ARCHIVE',
   'Attachment recovery limit exceeded');
  buffer.fill(0);
 }
 return {files:attachments.length,bytes:bytesTotal};
}
