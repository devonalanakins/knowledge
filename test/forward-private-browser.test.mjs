import {test} from 'node:test';
import assert from 'node:assert/strict';
import {htmlResponse,renderOwnerLibrary,renderOwnerPage,renderOwnerNotFound,renderOwnerHistory,renderOwnerExplorer,renderOwnerRevisionComparison,renderOwnerEditor}
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

test('version-history links are escaped and current revision distinguished',()=>{
 const html=renderOwnerHistory(page,[{version:2,title:'Revised',updatedAt:page.updatedAt},
   {version:1,title:'Old <img>',updatedAt:page.updatedAt}]);
 assert.match(html,/Version history/);
 assert.match(html,/Revision 2 · Current/);
 assert.match(html,/\/wiki\/revision\/acceptance\/fictional-draft\/1/);
 assert.match(html,/Old &lt;img&gt;/);
 assert.ok(!html.includes('<img>'));
 assert.match(renderOwnerPage(page,{historical:true}),/Historical revision/);
});


test('explorer title sorting is confined to a batch and preserves links across selection',()=>{
 const pages=[
  {path:'notes/zeta',title:'Zeta',version:1,updatedAt:'2026-11-10T10:00:00Z'},
  {path:'notes/beta',title:'beta',version:1,updatedAt:'2026-11-11T10:00:00Z'},
  {path:'notes/alpha',title:'Alpha',version:2,updatedAt:'2026-11-09T10:00:00Z'},
 ];
 const selected={...pages[1],body:'# Beta contents'};
 const snapshot=JSON.stringify(pages);
 const html=renderOwnerExplorer(pages,{selected,order:'title',cursor:'opaque-safe',
   nextCursor:'opaque-next'});
 const titles=['Alpha','beta','Zeta'].map(x=>html.indexOf('class="explorer-row-title">'+x+'</span>'));
 assert.ok(titles.every(x=>x>=0)&&titles[0]<titles[1]&&titles[1]<titles[2]);
 assert.equal(JSON.stringify(pages),snapshot,'the input batch is never mutated');
 assert.match(html,/href="\/wiki\/explore\?cursor=opaque-safe&amp;order=title&amp;selected=notes%2Fbeta"/);
 assert.match(html,/href="\/wiki\/explore\?cursor=opaque-safe&amp;order=title&amp;selected=notes%2Falpha"[^>]*>Previous record/);
 assert.match(html,/href="\/wiki\/explore\?cursor=opaque-safe&amp;order=title&amp;selected=notes%2Fzeta"[^>]*>Next record/);
 assert.match(html,/href="\/wiki\/explore\?cursor=opaque-safe&amp;order=title#record-/);
 assert.match(html,/href="\/wiki\/explore\?cursor=opaque-next&amp;order=title"[^>]*>Next batch/);
 assert.match(html,/aria-label="Sort current batch"/);
 assert.match(html,/aria-current="true">Title A–Z/);
 assert.doesNotMatch(html,/<script\b/);
});

test('explorer latest mode retains previous behavior, with valid empty and edge states',()=>{
 const pages=[
  {path:'notes/a',title:'Alpha',version:1,updatedAt:'2026-11-10T10:00:00Z'},
  {path:'notes/b',title:'Beta',version:1,updatedAt:'2026-11-11T10:00:00Z'},
 ];
 const latest=renderOwnerExplorer(pages,{selected:{...pages[1],body:'Safe'},order:'recent'});
 assert.ok(latest.indexOf('class="explorer-row-title">Beta</span>')<
   latest.indexOf('class="explorer-row-title">Alpha</span>'));
 assert.match(latest,/aria-current="true">Latest/);
 assert.doesNotMatch(latest,/Previous record<\/a>/,'first record has no previous');
 assert.match(latest,/Next record<\/a>/);
 assert.match(renderOwnerExplorer([],{order:'title'}),/No records in this batch/);
 assert.throws(()=>renderOwnerExplorer(pages,{order:'javascript:alert(1)'}),
   /KNOWLEDGE_BROWSER_INVALID_DATA/);
});


test('private revision comparison keeps the full Markdown line sequence and escapes hostile text',()=>{
 const before={path:'notes/fictional',title:'Earlier <img src=x>',body:'# Title\nkeep\n<script>alert(1)</script>\nold',version:2,sourceUrl:null};
 const after={...before,title:'Later & safer',body:'# Title\nkeep\nadded\n<script>alert(1)</script>\nnew',version:3,sourceUrl:'https://example.test/'};
 const html=renderOwnerRevisionComparison(before,after);
 assert.match(html,/Compare revisions/);
 assert.match(html,/2 added · 1 removed/);
 assert.match(html,/compare-added/);
 assert.match(html,/compare-removed/);
 assert.match(html,/compare-unchanged/);
 assert.match(html,/Title changed/);
 assert.match(html,/Source reference changed/);
 assert.match(html,/Earlier &lt;img src=x&gt;/);
 assert.match(html,/Later &amp; safer/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script\b|<img\b|https:\/\/example\.test\/"/);
 assert.match(html,/href="\/wiki\/revision\/notes\/fictional\/2"/);
 assert.match(html,/href="\/wiki\/revision\/notes\/fictional\/3"/);
 assert.match(html,/href="\/wiki\/history\/notes\/fictional"/);
});

test('private comparison reports identical text, preserves unusual whitespace and falls back without truncation',()=>{
 const base={path:'notes/a',title:'A',body:'unchanged  \n\tindent\n',version:1};
 const equal=renderOwnerRevisionComparison(base,{...base,version:2});
 assert.match(equal,/No Markdown text changes/);
 assert.match(equal,/unchanged  /);
 assert.match(equal,/\tindent/);
 const long=Array.from({length:400},(_,n)=>'line-'+n).join('\n');
 const fallback=renderOwnerRevisionComparison({...base,body:long},{...base,body:long+'-changed',version:2});
 assert.match(fallback,/too many lines for an efficient inline difference/);
 assert.match(fallback,/line-399-changed/);
 assert.match(fallback,/Revision 1<\/h2>/);
 assert.match(fallback,/Revision 2<\/h2>/);
 assert.doesNotMatch(fallback,/<ol class="compare-lines"/);
});

test('private comparison rejects mismatched and non-adjacent or unsafe revisions',()=>{
 const a={path:'notes/a',title:'A',body:'',version:1};
 for(const b of [
  {...a,version:1},{...a,version:3},{...a,version:2,path:'notes/b'},
  {...a,version:2,body:null},{...a,version:2,path:'../bad'},
 ]){
  assert.throws(()=>renderOwnerRevisionComparison(a,b),/KNOWLEDGE_COMPARISON_INVALID_DATA/);
 }
 const history=renderOwnerHistory({...a,version:2,updatedAt:'2026-11-11T12:00:00Z'},[
  {...a,version:2,updatedAt:'2026-11-11T12:00:00Z'},
  {...a,version:1,updatedAt:'2026-11-10T12:00:00Z'},
 ]);
 assert.match(history,/href="\/wiki\/compare\/notes\/a\/2">Compare with revision 1/);
 assert.doesNotMatch(history,/\/wiki\/compare\/notes\/a\/1/);
 assert.match(renderOwnerPage({...a,version:2}),/Compare with previous/);
 assert.doesNotMatch(renderOwnerPage(a),/Compare with previous/);
});


test('Explorer full-record links and explicit returns preserve selected batch and sort',()=>{
 const pages=[{path:'notes/alpha',title:'Alpha',body:'Some note',version:2,
   updatedAt:'2026-11-11T10:00:00Z'}];
 const list=renderOwnerExplorer(pages,{selected:pages[0],cursor:'opaque-safe',order:'title'});
 assert.match(list,/href="\/wiki\/page\/notes\/alpha\?from=explore&amp;cursor=opaque-safe&amp;order=title"/);
 const read=renderOwnerPage(pages[0],{returnContext:{from:'explore',cursor:'opaque-safe',order:'title'}});
 assert.match(read,/Back to Explorer/);
 assert.match(read,/href="\/wiki\/explore\?cursor=opaque-safe&amp;order=title#record-/);
 assert.doesNotMatch(read,/href="\/wiki\/explore[^\"]*selected=/);
 assert.match(read,/href="\/wiki\/download\/notes\/alpha" download/);
 const standard=renderOwnerPage(pages[0]);
 assert.doesNotMatch(standard,/Back to Explorer|Back to search results/);
});

test('private search returns to exact query and record anchor without unsafe href content',()=>{
 const hostile='<img src=x onerror=alert(1)>';
 const record={...page,title:hostile};
 const results=renderOwnerLibrary([record],{query:hostile,indexed:true});
 assert.match(results,/\/wiki\/page\/acceptance\/fictional-draft\?from=search&amp;q=%3Cimg\+src%3Dx\+onerror%3Dalert%281%29%3E/);
 assert.ok(!results.includes('<img src='));
 const full=renderOwnerPage(record,{returnContext:{from:'search',query:hostile}});
 assert.match(full,/Back to search results/);
 assert.match(full,/href="\/wiki-find\?q=%3Cimg\+src%3Dx\+onerror%3Dalert%281%29%3E#record-/);
 assert.ok(!full.includes('<img src='));
 assert.match(renderOwnerPage(record,{returnContext:{from:'search',query:''}}),/href="\/wiki-find\?q=#record-/);
});

test('rendered return links fail closed on unexpected route sources and oversized input',()=>{
 const record={...page,path:'notes/a'};
 for(const context of [
  {from:'https://attacker.example/steal'},
  {from:'explore',order:'arbitrary'},
  {from:'explore',cursor:'x'.repeat(513)},
  {from:'search',query:'x'.repeat(161)},
  {from:'search',query:null},
  null,
 ]){
  if(context===null){
   assert.doesNotMatch(renderOwnerPage(record,{returnContext:context}),/Back to Explorer/);
  }else assert.throws(()=>renderOwnerPage(record,{returnContext:context}),/KNOWLEDGE_BROWSER_INVALID_RETURN_CONTEXT/);
 }
 assert.throws(()=>renderOwnerPage({...record,path:'../escape'},{
  returnContext:{from:'explore',order:'recent'},
 }),/KNOWLEDGE_BROWSER_INVALID_RETURN_CONTEXT/);
});


test('edit links and editor actions preserve bounded Explorer and search return context',()=>{
 const doc={...page,path:'notes/fictional',title:'Fictional',body:'Safe text'};
 const context={from:'explore',cursor:'opaque-safe',order:'title'};
 const explorer=renderOwnerExplorer([doc],{selected:doc,cursor:'opaque-safe',order:'title',editEnabled:true});
 assert.match(explorer,/href="\/wiki\/edit\/notes\/fictional\?from=explore&amp;cursor=opaque-safe&amp;order=title"/);
 const full=renderOwnerPage(doc,{editable:true,returnContext:context});
 assert.match(full,/href="\/wiki\/edit\/notes\/fictional\?from=explore&amp;cursor=opaque-safe&amp;order=title"/);
 const editor=renderOwnerEditor(doc,'fictional-token',{returnContext:context});
 assert.match(editor,/action="\/wiki\/edit\/notes\/fictional\?from=explore&amp;cursor=opaque-safe&amp;order=title"/);
 assert.match(editor,/href="\/wiki\/page\/notes\/fictional\?from=explore&amp;cursor=opaque-safe&amp;order=title">Cancel/);
 const unsaved=renderOwnerEditor(doc,'fictional-token',{attempt:{title:'Edits',body:'Unsaved'},
   error:'Conflict',returnContext:context});
 assert.match(unsaved,/Unsaved/);
 assert.match(unsaved,/href="\/wiki\/page\/notes\/fictional\?from=explore&amp;cursor=opaque-safe&amp;order=title">Open latest/);
 const hostile='<img src=x onerror=alert(1)>';
 const searchContext={from:'search',query:hostile};
 const searchFull=renderOwnerPage(doc,{editable:true,returnContext:searchContext});
 assert.match(searchFull,/href="\/wiki\/edit\/notes\/fictional\?from=search&amp;q=%3Cimg\+src%3Dx\+onerror%3Dalert%281%29%3E"/);
 const searchEdit=renderOwnerEditor(doc,'fictional-token',{returnContext:searchContext});
 assert.match(searchEdit,/action="\/wiki\/edit\/notes\/fictional\?from=search&amp;q=%3Cimg\+src%3Dx\+onerror%3Dalert%281%29%3E"/);
 assert.doesNotMatch(searchEdit,/<img src=/);
 assert.doesNotMatch(renderOwnerEditor(doc,'fictional-token'),/\?from=/);
});

test('editor refuses untrusted or oversized navigation context before constructing links',()=>{
 const doc={...page,path:'notes/fictional'};
 for(const returnContext of [
  {from:'https://attacker.example/path'},
  {from:'explore',order:'unknown'},
  {from:'explore',cursor:'x'.repeat(513)},
  {from:'search',query:'a'.repeat(161)},
  {from:'search',query:null},
 ]){
  assert.throws(()=>renderOwnerEditor(doc,'fictional-token',{returnContext}),
    /KNOWLEDGE_BROWSER_INVALID_RETURN_CONTEXT/);
 }
});
