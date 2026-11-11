import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {KNOWLEDGE_NEURAL_K_LOCKED_PATH} from '../src/forward-neural-k.mjs';
import {knowledgeAppManifest,knowledgeAppIconSvg,knowledgeAppAssetResponse} from '../src/forward-app-metadata.mjs';
import {renderOwnerLibrary} from '../src/forward-private-browser.mjs';

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
 for(const r of [manifest,icon]){
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
 assert.deepEqual(await manifest.json(),knowledgeAppManifest());
 assert.equal(await icon.text(),knowledgeAppIconSvg());
 assert.equal(knowledgeAppAssetResponse('unknown').status,404);
});

test('every owner page advertises same-origin app metadata but no service-worker caching',()=>{
 const html=renderOwnerLibrary([],{editable:false});
 assert.match(html,/<meta name="apple-mobile-web-app-capable" content="yes">/);
 assert.match(html,/<meta name="theme-color" content="#0b2126">/);
 assert.match(html,/<link rel="manifest" href="\/wiki\/manifest\.webmanifest">/);
 assert.match(html,/<link rel="icon" type="image\/svg\+xml" href="\/wiki\/icon\.svg">/);
 assert.doesNotMatch(html,/<script\b|navigator\.serviceWorker|apple-touch-icon href="https?:/i);
});
