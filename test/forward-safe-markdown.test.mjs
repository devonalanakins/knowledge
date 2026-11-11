import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderSafeMarkdown} from '../src/forward-safe-markdown.mjs';
import {renderOwnerPage,renderOwnerLibrary,renderOwnerHistory,renderOwnerExplorer,htmlResponse} from '../src/forward-private-browser.mjs';

const fixture={
  path:'business/nona-neuropsychology/meeting-notes',
  title:'Review & coordination',
  body:'# Agenda\n\n**Decision:** review costs.\n\n- Open items\n- Secure referrals\n\n## Notes\n\n> Internal only\n\nUse `expectedVersion`.\n\n[Source](https://example.org/notes?x=1&y=2)',
  version:3,status:'draft',sourceUrl:'https://example.org/source',
  updatedAt:'2026-11-11T17:00:00Z',
};

test('owner renderer displays structured Markdown while preserving inert source text',()=>{
 const html=renderOwnerPage(fixture,{editable:true});
 assert.match(html,/<article aria-label="Page content" class="document">/);
 assert.match(html,/<h2>Agenda<\/h2>/);
 assert.match(html,/<h3>Notes<\/h3>/);
 assert.match(html,/<strong>Decision:<\/strong>/);
 assert.match(html,/<ul><li>Open items<\/li><li>Secure referrals<\/li><\/ul>/);
 assert.match(html,/<blockquote><p>Internal only<\/p><\/blockquote>/);
 assert.match(html,/<code>expectedVersion<\/code>/);
 assert.match(html,/<a href="https:\/\/example.org\/notes\?x=1&amp;y=2" rel="noopener noreferrer" target="_blank">Source<\/a>/);
 assert.match(html,/Version history/);
 assert.match(html,/Edit draft/);
 assert.match(html,/Owner-only/);
 assert.match(html,/Copying this page URL does not grant access/);
 assert.doesNotMatch(html,/href="\/s\//);
 assert.doesNotMatch(html,/<script\b/);
});

test('markdown never interprets source HTML or unsafe links as executable HTML',()=>{
 const payload='# Welcome\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))\n\n[encoded](https://example.test/?q=" onclick="alert(1))';
 const html=renderSafeMarkdown(payload);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/&lt;img src=x onerror=/);
 assert.doesNotMatch(html,/<script\b|<img\b|<iframe\b/);
 assert.doesNotMatch(html,/href="javascript:/i);
 assert.doesNotMatch(html,/href="[^"]*"\s+onclick=/i);
 assert.match(html,/\[unsafe\]/);
});

test('code fences and inline markup are HTML-escaped and remain readable',()=>{
 const html=renderSafeMarkdown('## Build\n\n```js\nconst evil = "<script>";\n```\n\nMake **one** *clear* decision.\n');
 assert.match(html,/<pre><code>const evil = &quot;&lt;script&gt;&quot;;<\/code><\/pre>/);
 assert.match(html,/<strong>one<\/strong>/);
 assert.match(html,/<em>clear<\/em>/);
 assert.doesNotMatch(html,/<script\b/);
});

test('private library uses responsive shell and no automatic sharing',async()=>{
 const markup=renderOwnerLibrary([fixture],{editable:true});
 const response=htmlResponse(markup);
 assert.equal(response.status,200);
 assert.match(response.headers.get('cache-control'),/no-store/);
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
 assert.match(markup,/aria-label="Knowledge navigation"/);
 assert.match(markup,/Skip to content/);
 assert.match(markup,/New draft/);
 assert.match(markup,/@media\(max-width:740px\)/);
 assert.match(markup,/business\/nona-neuropsychology\/meeting-notes/);
 assert.doesNotMatch(markup,/<script\b/);
 assert.doesNotMatch(markup,/<img src=/);
});

test('historical records remain read-only and owner-only',()=>{
 const html=renderOwnerPage(fixture,{editable:true,historical:true});
 assert.match(html,/Historical revision/);
 assert.doesNotMatch(html,/Edit draft/);
 assert.match(html,/sharing is not enabled/i);
 const history=renderOwnerHistory(fixture,[{version:3,title:fixture.title,updatedAt:fixture.updatedAt}]);
 assert.match(history,/Revision 3/);
});

test('internal Knowledge links work only for validated paths and escape labels',()=>{
 const input='See [[business/nona-neuropsychology/meeting-notes|Nona <review>]] and [[projects/devonstation-knowledge]].';
 const html=renderSafeMarkdown(input);
 assert.match(html,/href="\/wiki\/page\/business\/nona-neuropsychology\/meeting-notes"/);
 assert.match(html,/Nona &lt;review&gt;/);
 assert.match(html,/href="\/wiki\/page\/projects\/devonstation-knowledge"/);
 assert.doesNotMatch(html,/<review>/);
 const illegal=renderSafeMarkdown('[[../private|Escape]] [[foo/" onclick="alert(1)|Bad]]');
 assert.doesNotMatch(illegal,/href="\.\.|onclick="/);
});


test('compact explorer links and content are escaped and focus on the selected record',()=>{
 const page={...fixture,body:'# Decision\n\nUse **only** the reviewed record. <script>alert(1)</script>'};
 const html=renderOwnerExplorer([page],{selected:page,editable:true,previewEnabled:true});
 assert.match(html,/aria-label="Records in current batch"/);
 assert.match(html,/class="explorer-layout has-selected"/);
 assert.match(html,/aria-current="page"/);
 assert.match(html,/Open full record/);
 assert.match(html,/Private share preview/);
 assert.match(html,/Back to records/);
 assert.match(html,/<h2 class="reader-title">Review &amp; coordination<\/h2>/);
 assert.match(html,/<article aria-label="Selected record content"/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script\b/);
 assert.match(html,/@media\(max-width:740px\)/);
 assert.match(html,/has-selected \.explorer-list/);
 assert.doesNotMatch(html,/href="\/s\//);
 const blank=renderOwnerExplorer([page]);
 assert.match(blank,/Choose a record/);
 assert.doesNotMatch(blank,/Private share preview/);
});
test('explorer selected-record path links cannot execute HTML or supply external URLs',()=>{
 const path='projects/fictional';
 const page={...fixture,path,title:'A <img src=x onerror=1>',body:'Read [external](https://example.test/reference).'};
 const html=renderOwnerExplorer([page],{selected:page,cursor:'abc-123'});
 assert.match(html,/A &lt;img src=x onerror=1&gt;/);
 assert.doesNotMatch(html,/<img\b|<script\b/);
 assert.match(html,/\/wiki\/explore\?cursor=abc-123&amp;selected=projects%2Ffictional/);
 assert.match(html,/\/wiki\/explore\?cursor=abc-123"/);
 assert.match(html,/rel="noopener noreferrer"/);
 assert.doesNotMatch(html,/href="https:\/\/[^"]+" onclick=/);
});


test('compact explorer sorts a bounded batch without modifying the supplied list',()=>{
 const later={...fixture,path:'z/entry',title:'Last'};
 const early={...fixture,path:'a/entry',title:'First'};
 const input=[later,early];
 const html=renderOwnerExplorer(input);
 assert.deepEqual(input,[later,early]);
 assert.ok(html.indexOf('First')<html.indexOf('Last'));
 assert.match(html,/<h2>Choose a record<\/h2>/);
});


test('approved independent Knowledge identity uses the neural K and never labels product DevonStation',()=>{
 const markup=renderOwnerExplorer([fixture],{selected:fixture,editable:true,previewEnabled:false});
 assert.match(markup,/<a href="\/wiki" class="app-brand" aria-label="Knowledge home">/);
 assert.match(markup,/<svg class="neural-k"[^>]*aria-label="Knowledge branching K"/);
 assert.match(markup,/>Knowledge<\/span><\/a>/);
 assert.match(markup,/class="workspace-indicator" title="Current authorized workspace"/);
 assert.match(markup,/Private workspace<\/span>/);
 assert.doesNotMatch(markup,/DEVONSTATION|DevonStation Knowledge|Devon Works|Akins Works/);
 assert.match(markup,/aria-label="Knowledge navigation"/);
 assert.match(markup,/aria-label="Mobile Knowledge navigation"/);
 assert.match(markup,/class="reader-inspector" open/);
 assert.match(markup,/Record reader/);
 assert.match(markup,/Owner-only/);
 assert.doesNotMatch(markup,/href="\/s\/|Create public link|Invite member/);
});

test('approved compact concept preserves routes, privacy and responsive design contracts',()=>{
 const markup=renderOwnerExplorer([fixture],{selected:fixture});
 const home=renderOwnerLibrary([fixture],{editable:false});
 for(const href of ['/wiki','/wiki/explore','/wiki-find']) {
   assert.ok(markup.includes('href="'+href+'"'),href);
 }
 assert.match(markup,/--canvas:#081418/);
 assert.match(markup,/@media\(max-width:1160px\)/);
 assert.match(markup,/@media\(max-width:740px\)/);
 assert.match(markup,/@media\(max-width:350px\)/);
 assert.match(markup,/prefers-reduced-motion:reduce/);
 assert.match(markup,/env\(safe-area-inset-bottom,0px\)/);
 assert.match(markup,/No recipient or public link has been granted access/);
 assert.match(markup,/Content-Security-Policy/);
 assert.match(home,/Knowledge home/);
 assert.doesNotMatch(home,/DEVONSTATION/);
});

test('selected record data and title are escaped even in inspector and register',()=>{
 const injected={...fixture,title:'<script>hello<\/script>',path:'projects/valid-notes',updatedAt:'<img src=x onerror=1>',body:'## Safe text'};
 const markup=renderOwnerExplorer([injected],{selected:injected});
 assert.match(markup,/&lt;script&gt;hello&lt;\/script&gt;/);
 assert.match(markup,/&lt;img src=x onerror=1&gt;/);
 assert.doesNotMatch(markup,/<script\b|<img\b/);
 assert.match(markup,/aria-label="Selected record actions"/);
 const withoutAccess=renderOwnerExplorer([injected],{selected:injected,editable:false,previewEnabled:false});
 assert.doesNotMatch(withoutAccess,/href="\/wiki\/edit\/|href="\/wiki\/preview\//);
});
