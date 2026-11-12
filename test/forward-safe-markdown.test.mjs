import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderSafeMarkdown} from '../src/forward-safe-markdown.mjs';
import {createHash} from 'node:crypto';
import {neuralKMark, KNOWLEDGE_NEURAL_K_LOCKED_PATH} from '../src/forward-neural-k.mjs';
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
 assert.match(html,/\/wiki\/explore\?cursor=abc-123#record-[0-9a-f]+"/);
 assert.match(html,/rel="noopener noreferrer"/);
 assert.doesNotMatch(html,/href="https:\/\/[^"]+" onclick=/);
});


test('compact explorer orders the current bounded batch by known timestamp with stable fallback',()=>{
 const older={...fixture,path:'a/entry',title:'Older',updatedAt:'2026-11-08T11:00:00Z'};
 const newer={...fixture,path:'z/entry',title:'Newer',updatedAt:'2026-11-11T11:00:00Z'};
 const unknown={...fixture,path:'c/entry',title:'Unknown',updatedAt:'not-a-date'};
 const input=[older,unknown,newer];
 const html=renderOwnerExplorer(input);
 assert.deepEqual(input,[older,unknown,newer]);
 assert.ok(html.indexOf('Newer')<html.indexOf('Older'));
 assert.ok(html.indexOf('Older')<html.indexOf('Unknown'));
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
 assert.match(htmlResponse(markup).headers.get('content-security-policy'),/default-src 'none'/);
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

test('mobile selected record has a focused reader and cursor-preserving return anchor',()=>{
 const path='projects/return-test';
 const page={...fixture,path,title:'Return to this record'};
 const html=renderOwnerExplorer([page],{selected:page,cursor:'private-cursor'});
 assert.match(html,/class="explorer-shell has-selected"/);
 assert.match(html,/KNOWLEDGE \/ PRIVATE RECORD/);
 assert.doesNotMatch(html,/KNOWLEDGE \/ DECISION RECORD/);
 assert.match(html,/href="\/wiki\/explore\?cursor=private-cursor#record-[0-9a-f]+"/);
 assert.match(html,/<li id="record-[0-9a-f]+"><a href="/);
 assert.match(html,/\.explorer-shell\.has-selected \.explorer-header\{display:none\}/);
 assert.match(html,/<details class="reader-inspector" open>/);
 assert.doesNotMatch(html,/<script\b/);
});

// Header owns the sole create affordance; avoid redundant actions inside record lists.
test('explorer shows a single create control only when owner editor is enabled',()=>{
 const enabled=renderOwnerExplorer([fixture],{selected:fixture,editable:true});
 const disabled=renderOwnerExplorer([fixture],{selected:fixture,editable:false});
 assert.equal((enabled.match(/href="\/wiki\/new"/g)||[]).length,1);
 assert.equal((disabled.match(/href="\/wiki\/new"/g)||[]).length,0);
 assert.match(enabled,/class="header-new"/);
});

test('owner-approved organic Knowledge K silhouette is pinned and old stroked mark cannot return',()=>{
 const imageSha='bc476401fdbdd171fce0756f5e416d6c7fd84bfed23015a4dfcc829f1f016cc7';
 const pathSha=createHash('sha256').update(KNOWLEDGE_NEURAL_K_LOCKED_PATH).digest('hex');
 assert.equal(imageSha.length,64);
 assert.equal(pathSha,'2bfff0621e102904b330d4eb69435617bcf19629659b3da1d943e04b6d9665a7');
 const mark=neuralKMark();
 assert.match(mark,/data-locked-mark="knowledge-neural-k-2026-11-11"/);
 assert.match(mark,/viewBox="100 90 550 620"/);
 assert.match(mark,/role="img" aria-label="Knowledge branching K"/);
 assert.match(mark,/fill="url\(#knowledge-mark-gradient\)"/);
 assert.match(mark,/stop-color="#a4ffd8"/);
 assert.match(mark,/stop-color="#26aca2"/);
 assert.ok((KNOWLEDGE_NEURAL_K_LOCKED_PATH.match(/ Q/g)||[]).length>=70);
 assert.doesNotMatch(mark,/stroke-width="6\.4"|stroke-linecap="round"|<circle\s/);
});


test('Markdown pipe tables render semantic headings, aligned data and a keyboard-scrollable region',()=>{
 const source='Before the table.\n\n| Task | State | Total |\n| :--- | :---: | ---: |\n| Intake | **Ready** | 2 |\n| Report | *Pending* | 14 |\n\nAfter the table.';
 const result=renderSafeMarkdown(source);
 assert.match(result,/class="document-table-scroll" role="region" aria-label="Document table" tabindex="0"/);
 assert.match(result,/<table><thead><tr><th scope="col" class="align-left">Task<\/th><th scope="col" class="align-center">State<\/th><th scope="col" class="align-right">Total<\/th><\/tr><\/thead>/);
 assert.match(result,/<tbody><tr><td class="align-left">Intake<\/td><td class="align-center"><strong>Ready<\/strong><\/td><td class="align-right">2<\/td><\/tr>/);
 assert.match(result,/Report<\/td><td class="align-center"><em>Pending<\/em><\/td>/);
 assert.ok(result.indexOf('Before the table.')<result.indexOf('<table>'));
 assert.ok(result.indexOf('</table>')<result.indexOf('After the table.'));
 assert.match(renderOwnerPage({...fixture,body:source}),/class="document-table-scroll"/);
 assert.match(renderOwnerExplorer([{...fixture,body:source}],{selected:{...fixture,body:source}}),/class="document-table-scroll"/);
});

test('escaped pipes, internal record aliases and inline code stay inside table cells',()=>{
 const source='| Ref | Detail |\n| --- | --- |\n| [[projects/reference|Open \\| verify]] | `a|b` and a\\|b |\n| [Source](https://example.test/item) | x |';
 const html=renderSafeMarkdown(source);
 assert.equal((html.match(/<tr>/g)||[]).length,3);
 assert.match(html,/href="\/wiki\/page\/projects\/reference" class="wiki-link">Open \| verify<\/a>/);
 assert.match(html,/<code>a\|b<\/code> and a\|b/);
 assert.match(html,/href="https:\/\/example.test\/item" rel="noopener noreferrer" target="_blank">Source<\/a>/);
});

test('table values are inert and never permit executable HTML or malformed external links',()=>{
 const text='| <img src=x onerror=alert(1)> | Link |\n| --- | --- |\n| <script>alert(1)</script> | [Bad](javascript:alert(1)) |\n| [Good](https://example.test/) | <svg onload=alert(1)> |';
 const html=renderSafeMarkdown(text);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.match(html,/\[Bad\]\(javascript:alert\(1\)\)/);
 assert.match(html,/&lt;svg onload=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<img\b|<script\b|<svg\b|href="javascript:/i);
 assert.match(html,/<th scope="col">/);
 assert.match(html,/class="document-table-scroll"/);
});

test('non-table pipes and malformed separators preserve text instead of dropping content',()=>{
 for(const text of [
  'Alpha | Beta\nnot a separator\nOne | Two',
  '| Name | Status |\n| --- | oops |\n| A | B |',
 ]){
  const result=renderSafeMarkdown(text);
  assert.doesNotMatch(result,/<table>/);
  assert.match(result,/Alpha|Name/);
  assert.match(result,/<p>/);
 }
 const malformed='| Name | Status |\n| --- | --- |\n| A | B | C |';
 const html=renderSafeMarkdown(malformed);
 assert.match(html,/<table>/);
 assert.match(html,/A \| B \| C/);
});

test('fenced code with a table-shaped sequence remains code',()=>{
 const source='```markdown\n| Header | Count |\n| --- | --- |\n| X | 1 |\n```\n';
 const html=renderSafeMarkdown(source);
 assert.match(html,/<pre><code>/);
 assert.match(html,/\| Header \| Count \|/);
 assert.doesNotMatch(html,/<table>/);
});

test('bounded columns never cause truncation or render a misleading partial table',()=>{
 const columns=Array.from({length:25},(_,i)=>'H'+i);
 const content='| '+columns.join(' | ')+' |\n| '+columns.map(()=>'---').join(' | ')+' |\n| '+columns.map((_,i)=>'V'+i).join(' | ')+' |';
 const html=renderSafeMarkdown(content);
 assert.doesNotMatch(html,/<table>/);
 assert.match(html,/H24/);
 assert.match(html,/V24/);
});

test('table alignment CSS integrates with the locked Knowledge concept and mobile layout',()=>{
 const doc=renderOwnerPage({...fixture,body:'| Name | Total |\n| --- | ---: |\n| Example | 7 |'});
 assert.match(doc,/\.document-table-scroll\{max-width:100%;/);
 assert.match(doc,/\.document-table-scroll:focus-visible/);
 assert.match(doc,/\.document-table-scroll \.align-right\{text-align:right\}/);
 assert.match(doc,/@media\(max-width:740px\)\{\.document-table-scroll/);
 assert.match(doc,/tabindex="0"/);
 assert.doesNotMatch(doc,/<script\b/);
});
