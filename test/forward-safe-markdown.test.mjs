import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderSafeMarkdown} from '../src/forward-safe-markdown.mjs';
import {renderOwnerPage,renderOwnerLibrary,renderOwnerHistory,htmlResponse} from '../src/forward-private-browser.mjs';

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
 assert.match(html,/<h1>Agenda<\/h1>/);
 assert.match(html,/<h2>Notes<\/h2>/);
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
 assert.match(html,/<pre><code>const evil = "&lt;script&gt;";<\/code><\/pre>/);
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
