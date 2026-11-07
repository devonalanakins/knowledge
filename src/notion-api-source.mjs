/**
 * G18 — Read-only Notion API 2025-09-03 source inventory.
 * Captures original structured PAGE METADATA, not content blocks or files.
 * Caller chooses permitted data sources. No Notion, Knowledge or access writes.
 * Never print, publish or commit the returned private inventory.
 */
import {createHash} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const SCOPES=new Set(['anevum','devonstation','mizvo']);
const MAX_REGISTERS=24;
const MAX_ROWS=20000;
const MAX_REQUEST_BYTES=8*1024*1024;
const VERSION='2025-09-03';
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function required(ok,code,message){if(!ok)fail(code,message);}
const normalize=id=>String(id).replaceAll('-','').toLowerCase();
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fingerprint=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function isISO(x){return typeof x==='string'&&Number.isFinite(Date.parse(x))}
/**
 * Use a fixed notion.com HTTPS host; injected fetch is strictly for tests.
 * Only the caller's environment supplies the token. Errors never reveal
 * auth headers, remote page content, raw IDs, or unexpected server bodies.
 */
export function createReadOnlyNotionClient({
 token,fetcher=globalThis.fetch,delay=async ms=>new Promise(r=>setTimeout(r,ms)),
}={}){
 required(typeof token==='string'&&token.length>=8&&token.length<=2048 &&
   !/[\r\n]/.test(token),'NOTION_TOKEN_REQUIRED',
   'Provide a scoped Notion API token securely outside source control');
 required(typeof fetcher==='function'&&typeof delay==='function',
   'INVALID_CLIENT','Fetch and delay implementations required');
 let lastRequest=0;
 async function request(path,{method='GET',body=null}={}){
   // Whitelist safe GETs and the two read-only POST query endpoints.
   // "POST" is not automatically safe in the Notion API (pages.create).
   const isQuery=method==='POST'&&
     (/^\/v1\/data_sources\/[a-f0-9-]{32,36}\/query$/.test(path)||
      path==='/v1/search');
   const isRead=method==='GET'&&
     (/^\/v1\/(?:pages|databases|data_sources)\/[a-f0-9-]{32,36}$/.test(path)||
      /^\/v1\/blocks\/[a-f0-9-]{32,36}\/children(?:\?(?:page_size=\d{1,3}|start_cursor=[A-Za-z0-9_-]+)(?:&(page_size=\d{1,3}|start_cursor=[A-Za-z0-9_-]+))?)?$/.test(path));
   // G20: read-only pagination of explicit page-property items. The property
   // segment must be URL encoded; arbitrary Notion endpoints remain blocked.
   const propertyMatch=method==='GET'&&typeof path==='string'&&
     /^\/v1\/pages\/[a-f0-9-]{32,36}\/properties\/((?:[A-Za-z0-9_.!~*'()-]|%[0-9A-Fa-f]{2}){1,150})(?:\?page_size=100(?:&start_cursor=[A-Za-z0-9_-]{1,180})?)?$/.exec(path);
   let isPropertyRead=false;
   if(propertyMatch){
     try{
       const decoded=decodeURIComponent(propertyMatch[1]);
       isPropertyRead=decoded.length>0&&decoded.length<=64&&
         decoded!=='.'&&decoded!=='..'&&
         encodeURIComponent(decoded)===propertyMatch[1];
     }catch{isPropertyRead=false}
   }
   required(typeof path==='string'&&path.startsWith('/v1/')&&
     !path.includes('..')&&!path.includes('#')&&(isQuery||isRead||isPropertyRead),
     'INVALID_PATH','Notion API path or mutation method rejected');
   for(let attempt=0;attempt<4;attempt++){
     const elapsed=Date.now()-lastRequest;
     if(elapsed<375)await delay(375-elapsed);
     lastRequest=Date.now();
     let response;
     try{
       response=await fetcher('https://api.notion.com'+path,{
         method,headers:{
           Authorization:'Bearer '+token,'Notion-Version':VERSION,
           ...(body?{'Content-Type':'application/json'}:{}),
         },
         ...(body?{body:JSON.stringify(body)}:{}),
         redirect:'error',
       });
     }catch{fail('NOTION_TRANSPORT_ERROR','Notion connection failed')}
     if(response.status===429){
       if(attempt===3)fail('NOTION_RATE_LIMITED','Notion request retry limit exceeded');
       const retry=Number(response.headers?.get?.('retry-after'));
       await delay(Number.isFinite(retry)&&retry>0&&retry<=10?retry*1000:1000*(attempt+1));
       continue;
     }
     required(response.ok,'NOTION_HTTP_ERROR','Notion API returned an error status');
     const length=Number(response.headers?.get?.('content-length'));
     if(Number.isFinite(length)&&length>MAX_REQUEST_BYTES)
       fail('NOTION_RESPONSE_TOO_LARGE','Notion response too large');
     const reader=response.body?.getReader?.();
     let text;
     if(reader){
       const chunks=[];let size=0;
       while(true){
         const {done,value}=await reader.read();if(done)break;
         size+=value.byteLength;
         if(size>MAX_REQUEST_BYTES){await reader.cancel().catch(()=>{});
           fail('NOTION_RESPONSE_TOO_LARGE','Notion response too large')}
         chunks.push(value);
       }
       const all=new Uint8Array(size);let offset=0;
       for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength}
       try{text=new TextDecoder('utf-8',{fatal:true}).decode(all)}
       catch{fail('INVALID_NOTION_RESPONSE','Invalid Notion UTF-8 response')}
     }else{
       text=await response.text();
       if(Buffer.byteLength(text,'utf8')>MAX_REQUEST_BYTES)
         fail('NOTION_RESPONSE_TOO_LARGE','Notion response too large');
     }
     let json;
     try{json=JSON.parse(text)}catch{fail('INVALID_NOTION_RESPONSE','Invalid Notion JSON response')}
     required(object(json),'INVALID_NOTION_RESPONSE','Unexpected Notion response format');
     return json;
   }
   fail('NOTION_RATE_LIMITED','Notion request retry limit exceeded');
 }
 return {request};
}
function checkConfig(registers){
 required(Array.isArray(registers)&&registers.length>=1&&
   registers.length<=MAX_REGISTERS,'INVALID_SOURCE_CONFIG','1–24 data sources required');
 const seen=new Set();
 return registers.map((r,index)=>{
   required(object(r)&&UUID.test(r.dataSourceId||'')&&
     SCOPES.has(r.scope)&&typeof r.register==='string'&&
     /^[a-z][a-z0-9-]{2,63}$/.test(r.register)&&
     (r.expectedCount===undefined||
       (Number.isSafeInteger(r.expectedCount)&&r.expectedCount>=0&&r.expectedCount<=MAX_ROWS)),
     'INVALID_SOURCE_CONFIG','Invalid register metadata/permission scope');
   const id=normalize(r.dataSourceId);
   if(seen.has(id))fail('DUPLICATE_SOURCE','Repeated Notion data source');
   seen.add(id);
   return {dataSourceId:id,scope:r.scope,register:r.register,
     expectedCount:r.expectedCount??null,sequence:index};
 });
}
/**
 * Independently enumerate each explicitly configured database data source.
 * Metadata is held only in memory. Full blocks, comments, files and permission
 * graphs are NOT covered. A complete cursor traversal is not source consent.
 */
export async function enumerateNotionSourceMetadata({
 client,registers,allowMetadataOnly=false,
}={}){
 required(allowMetadataOnly===true,'INVENTORY_NOT_AUTHORIZED',
   'Explicit metadata-only enumeration required');
 required(client&&typeof client.request==='function',
   'INVALID_CLIENT','Validated Notion read-only client required');
 const config=checkConfig(registers);
 const entries=[],counts={},warnings=[],seen=new Map();
 for(const reg of config){
   let cursor=null,pages=0,count=0;const cursors=new Set();
   do{
     const response=await client.request('/v1/data_sources/'+reg.dataSourceId+'/query',{
       method:'POST',
       body:{page_size:100,...(cursor?{start_cursor:cursor}:{})},
     });
     required(Array.isArray(response.results)&&
       typeof response.has_more==='boolean',
       'INVALID_NOTION_RESPONSE','Unexpected Notion collection response');
     pages++;
     for(const page of response.results){
       required(object(page)&&page.object==='page'&&UUID.test(page.id||'')&&
         typeof page.url==='string'&&page.url.startsWith('https://')&&
         isISO(page.last_edited_time)&&object(page.properties),
         'INVALID_NOTION_PAGE','Incomplete Notion page metadata');
       const sourceId=normalize(page.id);
       if(seen.has(sourceId))
         fail('DUPLICATE_NOTION_RECORD','Record present in multiple source registers');
       seen.set(sourceId,reg.register);
       let unresolvedRelations=0,unresolvedFiles=0;
       for(const prop of Object.values(page.properties)){
         if(!object(prop))continue;
         if(prop.type==='relation'&&prop.has_more===true)unresolvedRelations++;
         if(prop.type==='files'&&Array.isArray(prop.files)&&prop.files.length)unresolvedFiles+=prop.files.length;
       }
       const entry={
         sourceId,register:reg.register,scope:reg.scope,
         dataSourceId:reg.dataSourceId,parent:page.parent??null,
         lastEdited:page.last_edited_time,sourceUrl:page.url,
         archived:page.archived===true,inTrash:page.in_trash===true,
         properties:page.properties,
         unresolvedRelations,externalFileReferences:unresolvedFiles,
       };
       entries.push(entry);count++;
       if(entries.length>MAX_ROWS)fail('INVENTORY_TOO_LARGE','Inventory exceeds hard page limit');
       if(unresolvedRelations)warnings.push({code:'PAGINATED_RELATION_PROPERTY',sourceId});
       if(unresolvedFiles)warnings.push({code:'FILE_REFERENCES_NOT_ARCHIVED',sourceId});
     }
     if(response.has_more){
       const next=response.next_cursor;
       if(typeof next!=='string'||!next||cursors.has(next))
         fail('INVALID_NOTION_CURSOR','Pagination did not advance');
       cursors.add(next);cursor=next;
     }else cursor=null;
     if(pages>250)fail('INVENTORY_TOO_LARGE','Too many pages in source register');
   }while(cursor);
   counts[reg.register]={pages:count,apiLoads:pages,complete:true,
     matchedObservedCount:reg.expectedCount===null?null:count===reg.expectedCount};
   if(reg.expectedCount!==null&&count!==reg.expectedCount)
     warnings.push({code:'COUNT_DRIFT',register:reg.register,observed:count,
       expected:reg.expectedCount});
 }
 const immutable=entries.map(r=>({id:r.sourceId,source:r.dataSourceId,
   edited:r.lastEdited,scope:r.scope,register:r.register,
   digest:fingerprint(r.properties)})).sort((a,b)=>a.id.localeCompare(b.id));
 return {format:'knowledge-notion-api-source-metadata-v1',
   sourceApiVersion:VERSION,scope:'EXPLICIT_CONFIG_ONLY',
   counts,records:entries,uniqueSourceRecords:seen.size,
   identityFingerprint:fingerprint(immutable),warnings,
   fullPageBodiesCaptured:false,attachmentsCaptured:false,
   sourcePermissionsCertified:false,sourceCoverageCertified:false,
   sensitiveDataScreened:false,realDataImported:false,cutoverApproved:false};
}
