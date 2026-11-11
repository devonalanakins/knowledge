import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateBaseUrl,validateOwnerSession,validateDownloadFixture,
  checkLockedIcon,runPreflight,LOCKED_MARK_GEOMETRY_SHA256} from '../ops/private-forward/knowledge-release-preflight.mjs';

const base='https://knowledge.example.test';
const ownerCookie='CF_Authorization=aa.bb.'+'c'.repeat(40);
const markdown='# Synthetic acceptance\n\nNo private records.\n';
const markdownHash=createHash('sha256').update(markdown).digest('hex');
const path='M120 100 Q150 130 210 180 Z';
const pathHash=createHash('sha256').update(path).digest('hex');
const icon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="'+path+'"/></svg>';
const headers={
 'Cache-Control':'private, no-store, max-age=0',
 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'
};
const assetHeaders={...headers,'Content-Security-Policy':"default-src 'none'; script-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
const page='<html><head><link rel="manifest" href="/wiki/manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="/wiki/icon.svg"></head><body><a href="/wiki" class="app-brand"><svg data-locked-mark="knowledge-neural-k-2026-11-11"></svg><span>Knowledge</span></a><main class="explorer-shell"></main></body></html>';
const manifest={name:'Knowledge',short_name:'Knowledge',id:'/wiki',scope:'/wiki',
 start_url:'/wiki/explore',display:'standalone',icons:[{src:'/wiki/icon.svg',type:'image/svg+xml',sizes:'any'}]};
function mock({guestStatus=403,guestExposed=false,loginUrl,wrongIcon=false,cacheable=false,
 badDownload=false,throwOnFetch=false,untrustedIconSource=false,scriptAllowed=false}={}){
 const requests=[];
 const fetchFn=async(url,options)=>{
  const u=new URL(url);
  requests.push({host:u.hostname,path:u.pathname,method:options.method,redirect:options.redirect,
    cookie:!!options.headers.Cookie});
  if(throwOnFetch)throw new Error('https://evil.example.test?cookie=private-value');
  if(!options.headers.Cookie&&!guestExposed){
   if(guestStatus===302)return new Response(null,{status:302,
     headers:{Location:loginUrl??'https://owner.cloudflareaccess.com/cdn-cgi/access/login/knowledge'}});
   return new Response('Unauthorized',{status:guestStatus});
  }
  const h=cacheable?{...headers,'Cache-Control':'public, max-age=3600'}:headers;
  const htmlHeaders=scriptAllowed?{...h,'Content-Security-Policy':h['Content-Security-Policy']+"; script-src 'unsafe-inline'"}:h;
  if(['/wiki','/wiki/explore'].includes(u.pathname))
    return new Response(page,{status:200,headers:{...htmlHeaders,'Content-Type':'text/html; charset=utf-8'}});
  if(u.pathname==='/wiki/manifest.webmanifest')
    return new Response(JSON.stringify(untrustedIconSource?{...manifest,icons:[...manifest.icons,{src:'https://evil.example.test/icon.svg'}]}:manifest),{status:200,headers:{...assetHeaders,'Content-Type':'application/manifest+json'}});
  if(u.pathname==='/wiki/icon.svg')
    return new Response(wrongIcon?icon.replace(path,'M1 1'):icon,
      {status:200,headers:{...assetHeaders,'Content-Type':'image/svg+xml'}});
  if(u.pathname==='/wiki/download/acceptance/fictional-draft')
    return new Response(badDownload?'wrong':markdown,{status:200,headers:{
      ...assetHeaders,'Content-Type':'text/markdown','Content-Disposition':
       'attachment; filename="acceptance__fictional-draft.md"'}});
  return new Response('Not found',{status:404});
 };
 return {fetchFn,requests};
}
const owner={baseUrl:base,accessCookie:ownerCookie,expectedHost:'knowledge.example.test',
 downloadFixture:{path:'acceptance/fictional-draft',digest:markdownHash},expectedIconSha256:pathHash};

test('unsafe, redirected or custom-port origins are rejected before requests',()=>{
 assert.equal(validateBaseUrl(base+'/'),base);
 for(const url of ['http://knowledge.example.test','https://user:pw@knowledge.example.test',
  base+'/path',base+'?x=1',base+'#frag',base.replace('https','ftp'),
  'https://knowledge.example.test:8080'])
  assert.throws(()=>validateBaseUrl(url));
});
test('credentialed mode requires exact independently supplied host and single safe cookie',async()=>{
 assert.equal(validateOwnerSession(base,ownerCookie,'knowledge.example.test'),ownerCookie);
 for(const [cookie,expected] of [
  [ownerCookie,undefined],[ownerCookie,'evil.example.test'],[ownerCookie,'knowledge.example.test.evil'],
  ['CF_Authorization=x','knowledge.example.test'],
  ['CF_Authorization=a\r\nX-Attacker:1','knowledge.example.test'],
  ['a=b; CF_Authorization=abc','knowledge.example.test'],
 ])assert.throws(()=>validateOwnerSession(base,cookie,expected));
 const x=mock();
 await assert.rejects(runPreflight({...owner,expectedHost:'evil.example.test',fetchFn:x.fetchFn}),
   /OWNER_HOST_MISMATCH/);
 assert.equal(x.requests.length,0,'must not send owner cookie on mismatched host');
});
test('only explicitly synthetic and digest-pinned document fixtures are allowed',()=>{
 assert.equal(validateDownloadFixture(undefined,undefined),null);
 assert.deepEqual(validateDownloadFixture('acceptance/fictional-draft',markdownHash),
  {path:'acceptance/fictional-draft',digest:markdownHash});
 for(const p of ['projects/private','business/nona','acceptance/../private',
  'acceptance/ABC','acceptance/a%2Fb','acceptance/a?b=1'])
  assert.throws(()=>validateDownloadFixture(p,markdownHash));
 assert.throws(()=>validateDownloadFixture('acceptance/fictional-draft','bad'));
});
test('read-only owner and guest flow passes while explicitly denying release-ready status',async()=>{
 const x=mock();const r=await runPreflight({...owner,fetchFn:x.fetchFn});
 assert.equal(r.failed,0);
 assert.equal(r.tests.length,10);
 assert.equal(r.tests.filter(t=>t.status==='PASS').length,10);
 assert.equal(r.authenticatedChecksRun,true);
 assert.equal(r.syntheticDownloadChecked,true);
 assert.equal(r.productionReady,false);
 assert.equal(r.readOnly,true);
 assert.ok(x.requests.every(z=>z.method==='GET'&&z.redirect==='manual'&&z.host==='knowledge.example.test'));
 assert.equal(x.requests.filter(z=>z.cookie).length,5);
 assert.doesNotMatch(JSON.stringify(r),/CF_Authorization|Private owner|No private records/);
});
test('guest HTTP 200, 404, or malicious login redirects fail closed',async()=>{
 for(const settings of [
   {guestExposed:true},{guestStatus:404},
   {guestStatus:302,loginUrl:'https://cloudflareaccess.com.evil.example/cdn-cgi/access/login'},
   {guestStatus:302,loginUrl:'http://owner.cloudflareaccess.com/cdn-cgi/access/login'}
 ]){
  const x=mock(settings);const r=await runPreflight({baseUrl:base,fetchFn:x.fetchFn});
  assert.equal(r.failed,5);
  assert.equal(r.authenticatedChecksRun,false);
  assert.ok(r.tests.every(t=>t.status==='FAIL'));
 }
 const x=mock({guestStatus:302});const r=await runPreflight({baseUrl:base,fetchFn:x.fetchFn});
 assert.equal(r.failed,0);
 assert.ok(r.tests.every(t=>t.details==='ACCESS_LOGIN_REDIRECT'));
});
test('brand mark must match exact locked vector geometry with no active SVG content',()=>{
 assert.equal(LOCKED_MARK_GEOMETRY_SHA256.length,64);
 checkLockedIcon(icon,pathHash);
 assert.throws(()=>checkLockedIcon(icon,LOCKED_MARK_GEOMETRY_SHA256),/ICON_DIFFERS_FROM_LOCKED_MARK/);
 assert.throws(()=>checkLockedIcon(icon.replace('</svg>','<script>alert(1)</script></svg>'),pathHash),
   /UNSAFE_SVG/);
 assert.throws(()=>checkLockedIcon(icon.replace('</svg>','<path d="M2 2"/></svg>'),pathHash),
   /ICON_UNEXPECTED_PATHS/);
});
test('cacheability, wrong icon and altered download body fail independent gates',async()=>{
 for(const [settings,error] of [
  [{cacheable:true},'HTML_CACHEABLE'],[{wrongIcon:true},'ICON_DIFFERS_FROM_LOCKED_MARK'],
  [{badDownload:true},'DOWNLOAD_BYTES_MISMATCH']
 ]){
  const x=mock(settings);const r=await runPreflight({...owner,fetchFn:x.fetchFn});
  assert.ok(r.tests.some(t=>t.error===error),JSON.stringify(r.tests));
  assert.equal(r.productionReady,false);
 }
});
test('error reports never echo credentials, URLs or remote response bodies',async()=>{
 const x=mock({throwOnFetch:true});const r=await runPreflight({...owner,fetchFn:x.fetchFn});
 assert.ok(r.tests.every(t=>t.error==='REQUEST_FAILED'));
 assert.doesNotMatch(JSON.stringify(r),/private-value|CF_Authorization|evil.example.test|No private records/);
});
test('guest-only checks do not imply readiness and cannot authenticate documents',async()=>{
 const x=mock();const r=await runPreflight({baseUrl:base,fetchFn:x.fetchFn});
 assert.equal(r.failed,0);
 assert.equal(r.authenticatedChecksRun,false);
 assert.equal(r.syntheticDownloadChecked,false);
 assert.equal(r.productionReady,false);
 assert.equal(x.requests.filter(v=>v.cookie).length,0);
});

test('external manifest icons and script-enabled HTML are release failures',async()=>{
 for(const [settings,expected] of [
   [{untrustedIconSource:true},'UNEXPECTED_ICON_SOURCE'],
   [{scriptAllowed:true},'HTML_SCRIPT_POLICY_UNSAFE']
 ]){
   const x=mock(settings),r=await runPreflight({...owner,fetchFn:x.fetchFn});
   assert.ok(r.tests.some(t=>t.error===expected),JSON.stringify(r.tests));
   assert.equal(r.productionReady,false);
 }
});
