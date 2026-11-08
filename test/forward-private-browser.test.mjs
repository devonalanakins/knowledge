import {test} from 'node:test';
import assert from 'node:assert/strict';
import {htmlResponse,renderOwnerLibrary,renderOwnerPage,renderOwnerNotFound}
  from '../src/forward-private-browser.mjs';
const page={path:'acceptance/fictional-draft',title:'Safe & <script>alert(1)</script>',
  body:'Hello <img src=x onerror=alert(1)>',version:2,status:'draft',
  updatedAt:'2026-11-07T00:00:00Z',sourceUrl:'https://example.test/?a=1&b=2'};

test('owner browser HTML has strict no-store security headers and no executable scripts',async()=>{
 const r=htmlResponse(renderOwnerPage(page));
 const txt=await r.text();
 assert.equal(r.status,200);
 assert.match(r.headers.get('cache-control'),/no-store/);
 assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
 assert.match(r.headers.get('x-robots-tag'),/noindex/);
 assert.ok(!txt.includes('<script>'));
 assert.ok(!txt.includes('<img src='));
 assert.match(txt,/&lt;script&gt;/);
 assert.match(txt,/&lt;img src=/);
 assert.match(txt,/https:\/\/example.test\/\?a=1&amp;b=2/);
 assert.match(txt,/name="viewport"/);
 assert.match(txt,/@media\(max-width:740px\)/);
});
test('search escapes user query and results; metadata stays readable',()=>{
 const markup=renderOwnerLibrary([page],{query:'<script>'});
 assert.ok(!markup.includes('<script>'));
 assert.match(markup,/value="&lt;script&gt;"/);
 assert.match(markup,/matching page/);
 assert.match(markup,/\/wiki\/page\/acceptance\/fictional-draft/);
 const missing=renderOwnerLibrary([],{query:'none'});
 assert.match(missing,/No matching pages/);
});
test('library does not mutate input and preserves stable sort',()=>{
 const others=[{path:'z/other',title:'Z',version:1,body:'last'}, {...page}];
 const html=renderOwnerLibrary(others);
 assert.equal(others[0].path,'z/other');
 assert.ok(html.indexOf('acceptance/fictional-draft')<html.indexOf('z/other'));
 assert.match(renderOwnerNotFound(),/Page not found/);
});
