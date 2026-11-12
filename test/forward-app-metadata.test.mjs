import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {KNOWLEDGE_NEURAL_K_LOCKED_PATH} from '../src/forward-neural-k.mjs';
import {KNOWLEDGE_TOUCH_PNG_SHA256,knowledgeTouchPng} from '../src/forward-apple-touch-icon.mjs';
import {knowledgeAppManifest,knowledgeAppIconSvg,knowledgeAppAssetResponse} from '../src/forward-app-metadata.mjs';
import {renderOwnerLibrary,htmlResponse} from '../src/forward-private-browser.mjs';

test('app manifest is scoped to private Knowledge without a fictitious tenant or offline capability',()=>{
 const manifest=knowledgeAppManifest();
 assert.deepEqual(Object.keys(manifest).sort(),['background_color','categories','description','display',
    'icons','id','lang','name','scope','short_name','shortcuts','start_url','theme_color'].sort());
 assert.equal(manifest.name,'Knowledge');
 assert.equal(manifest.id,'/wiki');
 assert.equal(manifest.start_url,'/wiki/explore');
 assert.equal(manifest.scope,'/wiki');
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.theme_color,'#0b2126');
 assert.equal(manifest.icons.length,1);
 assert.deepEqual(manifest.icons[0],{src:'/wiki/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'});
 assert.deepEqual(manifest.shortcuts.map(x=>x.url),['/wiki/explore','/wiki-find']);
 assert.doesNotMatch(JSON.stringify(manifest),/DevonStation|Nona|Akins Works|service.worker|offline|\?token|business\/|clinical/i);
});

test('standalone icon preserves exact locked filled neural-K path with no active content',()=>{
 const svg=knowledgeAppIconSvg();
 assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
 assert.match(svg,/viewBox="0 0 512 512"/);
 assert.match(svg,/<rect width="512" height="512" rx="104"/);
 assert.match(svg,/transform="translate\(112 82\) scale\(\.65\) translate\(-162 -119\)"/);
 assert.ok(svg.includes('d="'+KNOWLEDGE_NEURAL_K_LOCKED_PATH+'"'));
 assert.equal(createHash('sha256').update(KNOWLEDGE_NEURAL_K_LOCKED_PATH).digest('hex'),
   '2bfff0621e102904b330d4eb69435617bcf19629659b3da1d943e04b6d9665a7');
 assert.doesNotMatch(svg,/<script\b|onload=|onclick=|<foreignObject|<image\b|href=/i);
 assert.equal((svg.match(/<path /g)||[]).length,1);
});

test('manifest and icon responses are static, private, uncacheable and do not contain records',async()=>{
 const manifest=knowledgeAppAssetResponse('manifest');
 const icon=knowledgeAppAssetResponse('icon');
 const apple=knowledgeAppAssetResponse('apple-icon');
 for(const r of [manifest,icon,apple]){
  assert.equal(r.status,200);
  assert.match(r.headers.get('cache-control'),/private, no-store/);
  assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.match(r.headers.get('x-robots-tag'),/noindex/);
  assert.equal(r.headers.get('cross-origin-resource-policy'),'same-origin');
 }
 assert.match(manifest.headers.get('content-type'),/application\/manifest\+json/);
 assert.match(icon.headers.get('content-type'),/image\/svg\+xml/);
 assert.equal(apple.headers.get('content-type'),'image/png');
 assert.deepEqual(await manifest.json(),knowledgeAppManifest());
 assert.deepEqual(new Uint8Array(await apple.arrayBuffer()),knowledgeTouchPng());
 assert.equal(await icon.text(),knowledgeAppIconSvg());
 assert.equal(knowledgeAppAssetResponse('unknown').status,404);
});

test('every owner page advertises same-origin app metadata but no service-worker caching',()=>{
 const html=renderOwnerLibrary([],{editable:false});
 assert.match(html,/<meta name="apple-mobile-web-app-capable" content="yes">/);
 assert.match(html,/<meta name="theme-color" content="#0b2126">/);
 assert.match(html,/<link rel="manifest" href="\/wiki\/manifest\.webmanifest">/);
 assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="\/wiki\/icon\.svg">/);
 assert.match(html,/<link rel="apple-touch-icon" sizes="180x180" href="\/wiki\/apple-touch-icon\.png">/);
 assert.doesNotMatch(html,/<script\b|navigator\.serviceWorker|apple-touch-icon href="https?:/i);
 const policy=htmlResponse(html).headers.get('content-security-policy');
 assert.match(policy,/manifest-src 'self'/);
 assert.match(policy,/img-src 'self'/);
 assert.doesNotMatch(policy,/script-src 'self'|connect-src 'self'/);
 assert.doesNotMatch(html,/<script src=/);
});

test('native iPhone icon preserves locked artwork as stable opaque PNG with no record bytes',()=>{
 const bytes=knowledgeTouchPng();
 assert.ok(bytes instanceof Uint8Array);
 assert.equal(KNOWLEDGE_TOUCH_PNG_SHA256,'e608e54acf6dcc3c27cb0300cb9c10d77fc241aed9d3937f07b7db374eb1a5ad');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),KNOWLEDGE_TOUCH_PNG_SHA256);
 assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 assert.equal(view.getUint32(16),180);
 assert.equal(view.getUint32(20),180);
 assert.ok(bytes.length<4096,'Icon should be lightweight');
 assert.doesNotMatch(Buffer.from(bytes).toString('latin1'),/Fictional acceptance|CF_Authorization|projects\//);
});
