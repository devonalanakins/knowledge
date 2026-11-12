/**
 * Read-only preflight for the owner-only Knowledge Worker.
 * No service mutations, third-party dependencies, cookie logging or patient fixtures.
 * An authorized operator must pin the expected host before supplying a session cookie.
 */
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {KNOWLEDGE_TOUCH_PNG_SHA256} from '../../src/forward-apple-touch-icon.mjs';

export const LOCKED_MARK_GEOMETRY_SHA256='2bfff0621e102904b330d4eb69435617bcf19629659b3da1d943e04b6d9665a7';
const ROUTES=['/wiki','/wiki/explore','/wiki/manifest.webmanifest','/wiki/icon.svg',
  '/wiki/apple-touch-icon.png','/wiki/download/acceptance/fictional-draft'];
const MAX_BODY=1024*1024;
const TIMEOUT_MS=12000;
const CSP=["default-src 'none'","frame-ancestors 'none'","form-action 'self'"];
const sha256=value=>createHash('sha256').update(value).digest('hex');
function insist(ok,code){if(!ok)throw new Error(code);}

export function validateBaseUrl(raw){
 insist(typeof raw==='string'&&raw.length>0,'MISSING_BASE_URL');
 let u;
 try{u=new URL(raw)}catch{throw new Error('INVALID_BASE_URL')}
 insist(u.protocol==='https:'&&u.hostname&&!u.username&&!u.password&&!u.search&&!u.hash&&
   (u.pathname==='/'||u.pathname==='')&&!u.port,'INSECURE_BASE_URL');
 return u.origin;
}
export function validateDownloadFixture(path,digest){
 if(!path&&!digest)return null;
 insist(typeof path==='string'&&/^acceptance\/[a-z0-9][a-z0-9-]{0,63}$/.test(path),
   'ONLY_SYNTHETIC_ACCEPTANCE_PATH_ALLOWED');
 insist(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest),
   'EXPECTED_DOWNLOAD_SHA256_REQUIRED');
 return {path,digest};
}
export function validateOwnerSession(origin,cookie,expectedHost){
 if(!cookie)return null;
 insist(typeof cookie==='string'&&/^CF_Authorization=[A-Za-z0-9._-]{20,8192}$/.test(cookie),
   'INVALID_OWNER_SESSION_COOKIE');
 insist(typeof expectedHost==='string'&&/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(expectedHost) &&
   expectedHost.length<=253,'EXPECTED_HOST_REQUIRED');
 insist(new URL(origin).hostname===expectedHost,'OWNER_HOST_MISMATCH');
 return cookie;
}
function trustedLogin(res){
 if(![302,303,307].includes(res.status))return false;
 let u;
 try{u=new URL(res.headers.get('location'))}catch{return false}
 return u.protocol==='https:'&&u.hostname.endsWith('.cloudflareaccess.com')&&
   u.hostname!=='cloudflareaccess.com'&&u.pathname.startsWith('/cdn-cgi/access/');
}
function guestDenied(response){
 if([401,403].includes(response.status))return 'DENIED';
 if(trustedLogin(response))return 'ACCESS_LOGIN_REDIRECT';
 throw new Error('UNAUTHENTICATED_ENDPOINT_NOT_DENIED');
}
async function get(fetchFn,origin,route,cookie){
 insist(route.startsWith('/')&&!/[?#]/.test(route),'INVALID_TEST_ROUTE');
 const headers={Accept:'text/html,application/manifest+json,image/svg+xml,image/png,text/markdown'};
 if(cookie)headers.Cookie=cookie;
 return fetchFn(new URL(route,origin),{method:'GET',redirect:'manual',cache:'no-store',
   headers,signal:AbortSignal.timeout(TIMEOUT_MS)});
}
function headersSafe(response,kind){
 const cc=response.headers.get('cache-control')??'';
 insist(/\bno-store\b/i.test(cc),kind.toUpperCase()+'_CACHEABLE');
 insist((response.headers.get('x-content-type-options')??'').toLowerCase()==='nosniff',
   kind.toUpperCase()+'_MISSING_NOSNIFF');
 insist(/noindex/i.test(response.headers.get('x-robots-tag')??''),kind.toUpperCase()+'_INDEXABLE');
 if(kind==='html'){
   const csp=response.headers.get('content-security-policy')??'';
   for(const item of CSP)insist(csp.includes(item),'HTML_MISSING_CSP');
   const script=csp.match(/(?:^|;)\s*script-src\s+([^;]*)/i);
   if(script)insist(script[1].trim()==="'none'",'HTML_SCRIPT_POLICY_UNSAFE');
   insist(/text\/html/i.test(response.headers.get('content-type')??''),'HTML_BAD_CONTENT_TYPE');
 }
}
async function readLimited(response){
 const declared=response.headers.get('content-length');
 if(declared!==null)insist(!/^\d+$/.test(declared)||Number(declared)<=MAX_BODY,'BODY_TOO_LARGE');
 if(!response.body)return new Uint8Array();
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{
  for(;;){
   const x=await reader.read();if(x.done)break;
   size+=x.value.byteLength;insist(size<=MAX_BODY,'BODY_TOO_LARGE');
   chunks.push(x.value);
  }
  const b=new Uint8Array(size);let cursor=0;
  for(const chunk of chunks){b.set(chunk,cursor);cursor+=chunk.byteLength}
  return b;
 }finally{await reader.cancel().catch(()=>{})}
}
function verifyHtml(html,pathDigest){
 insist(/<a href="\/wiki" class="app-brand"/.test(html),'MISSING_PRODUCT_BRAND');
 const mark=html.match(/<svg\b[^>]*data-locked-mark="knowledge-neural-k-2026-11-11"[^>]*>[\s\S]*?<\/svg>/);
 insist(Boolean(mark),'INCORRECT_NEURAL_K_BRAND');
 const paths=[...mark[0].matchAll(/<path\b[^>]*\bd="([^"]+)"/g)];
 insist(paths.length===1&&sha256(paths[0][1])===pathDigest,'INCORRECT_UI_MARK_GEOMETRY');
 insist(/<span>Knowledge<\/span>/.test(html),'INCORRECT_PRODUCT_NAME');
 insist(/<link rel="manifest" href="\/wiki\/manifest\.webmanifest"/.test(html),'MANIFEST_NOT_LINKED');
 insist(/<link rel="icon" type="image\/svg\+xml" href="\/wiki\/icon\.svg"/.test(html),'ICON_NOT_LINKED');
 insist(/<link rel="apple-touch-icon" sizes="180x180" href="\/wiki\/apple-touch-icon\.png"/.test(html),'APPLE_ICON_NOT_LINKED');
 insist(!/<script\b/i.test(html),'UNEXPECTED_CLIENT_SCRIPT');
}
function verifyManifest(html){
 let m;try{m=JSON.parse(html)}catch{throw new Error('INVALID_MANIFEST_JSON')}
 insist(m.name==='Knowledge'&&m.short_name==='Knowledge','INCORRECT_APP_NAME');
 insist(m.id==='/wiki'&&m.scope==='/wiki'&&m.start_url==='/wiki/explore',
   'UNEXPECTED_MANIFEST_SCOPE');
 insist(m.display==='standalone','NOT_STANDALONE');
 insist(Array.isArray(m.icons)&&m.icons.some(i=>i.src==='/wiki/icon.svg'),'APP_ICON_MISSING');
 insist(m.icons.every(i=>i&&i.src==='/wiki/icon.svg'&&i.type==='image/svg+xml'&&i.sizes==='any'),'UNEXPECTED_ICON_SOURCE');
 insist(!m.shortcuts||Array.isArray(m.shortcuts)&&m.shortcuts.every(x=>x&&['/wiki/explore','/wiki-find'].includes(x.url)),'UNSAFE_MANIFEST_SHORTCUT');
 insist(!/https?:\/\//i.test(JSON.stringify(m)),'MANIFEST_EXTERNAL_URL');
 insist(!/DevonStation|Nona Neuropsychology|Akins Works|access_token|Authorization/i.test(JSON.stringify(m)),
   'MANIFEST_LEAKS_IDENTITY');
}
export function checkLockedIcon(svg,digest=LOCKED_MARK_GEOMETRY_SHA256){
 insist(/^<svg\b/.test(svg),'NOT_SVG');
 insist(/viewBox="0 0 512 512"/.test(svg),'ICON_NOT_512_VIEWBOX');
 insist(!/<script\b|onload\s*=|onclick\s*=|<foreignObject|<image\b|<use\b/i.test(svg),
   'UNSAFE_SVG');
 const paths=[...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)];
 insist(paths.length===1,'ICON_UNEXPECTED_PATHS');
 insist(sha256(paths[0][1])===digest,'ICON_DIFFERS_FROM_LOCKED_MARK');
}
export function checkLockedTouchIcon(bytes,digest=KNOWLEDGE_TOUCH_PNG_SHA256){
 insist(bytes instanceof Uint8Array&&bytes.byteLength>=100&&bytes.byteLength<4096,'INVALID_APPLE_ICON_SIZE');
 insist([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),'NOT_PNG');
 const dimensions=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 insist(dimensions.getUint32(16)===180&&dimensions.getUint32(20)===180,'INVALID_APPLE_ICON_DIMENSIONS');
 insist(sha256(bytes)===digest,'APPLE_ICON_DIFFERS_FROM_LOCKED_MARK');
}
async function safe(name,fn){
 try{return {name,status:'PASS',details:await fn()??null}}
 catch(e){return {name,status:'FAIL',
   error:/^[A-Z][A-Z0-9_]+$/.test(e?.message??'')?e.message:'REQUEST_FAILED'}}
}
export async function runPreflight({baseUrl,accessCookie,expectedHost,downloadFixture,
  fetchFn=fetch,expectedIconSha256=LOCKED_MARK_GEOMETRY_SHA256}={}){
 const origin=validateBaseUrl(baseUrl);
 const cookie=validateOwnerSession(origin,accessCookie,expectedHost);
 const checks=[];
 for(const route of ROUTES){
   checks.push(await safe('deny-guest:'+route,async()=>guestDenied(await get(fetchFn,origin,route,null))));
 }
 if(cookie){
   const authenticated=async(route,kind)=>{
     const response=await get(fetchFn,origin,route,cookie);
     insist(response.status===200,kind.toUpperCase()+'_OWNER_REQUEST_FAILED');
     headersSafe(response,kind);
     const bytes=await readLimited(response);
     return {response,bytes,text:kind==='binary'?null:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
   };
   checks.push(await safe('owner-private-library',async()=>{
     verifyHtml((await authenticated('/wiki','html')).text,expectedIconSha256);return 'AUTHENTICATED_OWNER_HTML';
   }));
   checks.push(await safe('owner-private-explorer',async()=>{
     const {text}=await authenticated('/wiki/explore','html');verifyHtml(text,expectedIconSha256);
     insist(/explorer-shell/.test(text),'EXPLORER_NOT_ACTIVE');return 'AUTHENTICATED_OWNER_EXPLORER';
   }));
   checks.push(await safe('owner-home-screen-manifest',async()=>{
     const {response,text}=await authenticated('/wiki/manifest.webmanifest','asset');
     insist(/application\/manifest\+json/i.test(response.headers.get('content-type')??''),
       'MANIFEST_WRONG_CONTENT_TYPE');verifyManifest(text);return 'OWNER_GATED_MANIFEST';
   }));
   checks.push(await safe('owner-locked-app-icon',async()=>{
     const {response,text}=await authenticated('/wiki/icon.svg','asset');
     insist(/image\/svg\+xml/i.test(response.headers.get('content-type')??''),
       'ICON_WRONG_CONTENT_TYPE');checkLockedIcon(text,expectedIconSha256);
     return 'LOCKED_NEURAL_K_SILHOUETTE';
   }));
   checks.push(await safe('owner-native-apple-touch-icon',async()=>{
     const {response,bytes}=await authenticated('/wiki/apple-touch-icon.png','binary');
     insist((response.headers.get('content-type')??'')==='image/png','APPLE_ICON_WRONG_CONTENT_TYPE');
     insist(/script-src 'none'/.test(response.headers.get('content-security-policy')??''),'APPLE_ICON_UNSAFE_CSP');
     insist(response.headers.get('cross-origin-resource-policy')==='same-origin','APPLE_ICON_CROSS_ORIGIN');
     checkLockedTouchIcon(bytes);return 'LOCKED_180PX_NATIVE_APPLE_ICON';
   }));
   if(downloadFixture){
     checks.push(await safe('owner-synthetic-markdown-roundtrip',async()=>{
       const {response,bytes}=await authenticated('/wiki/download/'+downloadFixture.path,'asset');
       insist(/text\/markdown/i.test(response.headers.get('content-type')??''),
         'DOWNLOAD_NOT_MARKDOWN');
       insist(/^attachment; filename="[a-z0-9_-]+\.md"$/.test(
          response.headers.get('content-disposition')??''),'UNSAFE_DOWNLOAD_FILENAME');
       insist(sha256(bytes)===downloadFixture.digest,'DOWNLOAD_BYTES_MISMATCH');
       return 'EXACT_SOURCE_MD_VERIFIED';
     }));
   }
 }
 return {schema:'knowledge-release-preflight-v1',targetHost:new URL(origin).hostname,
   timestamp:new Date().toISOString(),tests:checks,
   failed:checks.filter(x=>x.status==='FAIL').length,readOnly:true,
   authenticatedChecksRun:Boolean(cookie),syntheticDownloadChecked:Boolean(cookie&&downloadFixture),
   productionReady:false,releaseReason:'Provider deployment, owner-device UX, restore and rollback need independent acceptance.'};
}
async function cli(){
 let fixture;try{fixture=validateDownloadFixture(process.env.KNOWLEDGE_PREFLIGHT_DOWNLOAD_PATH,
   process.env.KNOWLEDGE_PREFLIGHT_DOWNLOAD_SHA256)}
 catch(e){process.stderr.write('Configuration rejected: '+e.message+'\n');process.exitCode=2;return}
 let receipt;
 try{receipt=await runPreflight({baseUrl:process.env.KNOWLEDGE_BASE_URL,
   accessCookie:process.env.KNOWLEDGE_ACCESS_COOKIE,
   expectedHost:process.env.KNOWLEDGE_PREFLIGHT_EXPECTED_HOST,downloadFixture:fixture})}
 catch(e){process.stderr.write('Preflight not executed: '+
   (/^[A-Z][A-Z0-9_]+$/.test(e?.message??'')?e.message:'REQUEST_FAILED')+'\n');
   process.exitCode=2;return}
 process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
 if(process.env.KNOWLEDGE_PREFLIGHT_REPORT)
   await writeFile(resolve(process.env.KNOWLEDGE_PREFLIGHT_REPORT),
     JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
 if(receipt.failed)process.exitCode=1;
 else if(!receipt.authenticatedChecksRun||!receipt.syntheticDownloadChecked)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 await cli();
