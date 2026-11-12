import {neuralKMark,uiGlyph} from './forward-neural-k.mjs';
import {CONCEPT_THEME} from './forward-concept-theme.mjs';
import {renderSafeMarkdown} from './forward-safe-markdown.mjs';
import {OWNER_THEME} from './forward-owner-theme.mjs';
/** Read-only owner-only HTML rendering of forward Knowledge drafts. No script or state. */
const STYLE=`:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0c1017;color:#edf1f5}*{box-sizing:border-box}body{margin:0;line-height:1.55}a{color:#87dce5;text-decoration:none}a:hover{text-decoration:underline}a:focus-visible,input:focus-visible,button:focus-visible{outline:3px solid #87dce5;outline-offset:3px}.shell{max-width:1280px;min-height:100vh;margin:auto;display:grid;grid-template-columns:236px minmax(0,1fr);gap:28px;padding:28px}.rail{border-right:1px solid #2d3744;padding-right:22px}.rail nav{display:grid;gap:12px}.mark{font-size:12px;letter-spacing:.16em;font-weight:700;color:#87dce5}.sub,.meta{color:#a4b5c3;font-size:13px}main{min-width:0}.surface{border-radius:20px;background:#151d29;border:1px solid #2c3b4a;padding:28px 32px;min-height:65vh}.search{display:flex;gap:12px;max-width:680px;margin:18px 0 30px}.search input{flex:1;min-width:0;background:#101823;border:1px solid #566476;color:inherit;border-radius:10px;padding:11px 13px;font:inherit}.search button{background:#86e0e5;color:#081218;border:0;border-radius:10px;font-weight:700;padding:10px 16px;cursor:pointer}h1{font-size:clamp(1.65rem,3vw,2.6rem);line-height:1.17;overflow-wrap:anywhere}h2{font-size:1.1rem;margin:26px 0 12px}.list{list-style:none;margin:16px 0;padding:0;display:grid;gap:10px}.list a{display:block;border:1px solid #314357;border-radius:13px;padding:14px 16px;background:#1b2937}.list a span{display:block;font-weight:650;color:#edf1f5}.list a small{display:block;overflow-wrap:anywhere;color:#a4b5c3}.content{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-width:75ch;margin:24px 0 40px}.crumb{font-size:13px;color:#a4b5c3;overflow-wrap:anywhere}.meta{border-top:1px solid #334250;padding-top:16px;margin-top:20px}.empty{border:1px dashed #435363;border-radius:12px;padding:18px;color:#a4b5c3}@media(max-width:740px){.shell{display:block;padding:12px}.rail{border:0;border-bottom:1px solid #2d3744;padding:8px 10px 15px;margin-bottom:14px}.rail nav{display:flex;gap:16px;flex-wrap:wrap}.surface{min-height:65vh;padding:21px 17px;border-radius:16px}.search{flex-wrap:wrap}.search button{min-height:44px}.search input{min-height:44px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}`;
const EDIT_STYLE='.editor{display:grid;gap:18px;max-width:76ch}.field{display:grid;gap:7px}.field label{font-weight:650}.field input,.field textarea{width:100%;background:#101823;color:#edf1f5;border:1px solid #617384;border-radius:11px;padding:12px 14px;font:inherit}.field textarea{min-height:34vh;resize:vertical;line-height:1.6}.field input:focus-visible,.field textarea:focus-visible{outline:3px solid #87dce5;outline-offset:2px}.action{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.action button{background:#86e0e5;color:#081218;border:0;border-radius:10px;font:inherit;font-weight:700;padding:12px 18px;cursor:pointer;min-height:44px}.notice{padding:13px 16px;border:1px solid #688b91;border-radius:11px;background:#17303d;color:#e8f9fb}.conflict{border-color:#b99b6d;background:#30271e;color:#fff1de}.limit{color:#a4b5c3;font-size:13px}@media(max-width:740px){.field textarea{min-height:45vh}.action button{width:100%}}.editor.acceptance-editor .field textarea{min-height:110px;height:116px;resize:none}';
const REVISION_COMPARE_STYLE='.compare-actions{display:flex;gap:14px;flex-wrap:wrap;margin:14px 0}.compare-summary{margin:15px 0;color:#b9ccd2}.compare-lines{list-style:none;padding:0;margin:16px 0;border:1px solid #304b51;border-radius:12px;overflow:hidden}.compare-line{display:grid;grid-template-columns:88px minmax(0,1fr);border-bottom:1px solid #30414a;font-size:13px}.compare-line:last-child{border-bottom:0}.compare-line-kind{padding:7px 10px;color:#b9cbd0;white-space:nowrap}.compare-line code{padding:7px 10px;white-space:pre-wrap;overflow-wrap:anywhere;color:inherit}.compare-removed{background:#352329;color:#ffcdcf}.compare-added{background:#16372f;color:#d2f5e3}.compare-unchanged{background:#16212a;color:#b2c2d0}.compare-full{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border:1px solid #304b51;border-radius:10px;max-height:38rem;overflow-y:auto}@media(max-width:740px){.compare-line{grid-template-columns:72px minmax(0,1fr)}.compare-line-kind{padding:8px 5px;font-size:11px}.compare-line code{padding:8px 6px}}';
const esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const link=path=>'/wiki/page/'+path;
const anchorId=path=>'record-'+Array.from(path,ch=>ch.charCodeAt(0).toString(16).padStart(2,'0')).join('');
/** Only bounded, same-origin routes can be used as return destinations.
 * The source is either the private Explorer batch or the private search query.
 * Never accept a caller-supplied URL or make a redirect.
 */
function returnLocation(path,context){
 if(context===null)return null;
 const validPath=/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,7}$/;
 if(typeof path!=='string'||path.length>240||!validPath.test(path)||
   path.split('/').some(part=>part.length>64)||!context||typeof context!=='object')
   throw new Error('KNOWLEDGE_BROWSER_INVALID_RETURN_CONTEXT');
 const params=new URLSearchParams();
 if(context.from==='explore'){
   if((context.cursor!==undefined&&context.cursor!==null&&
     (typeof context.cursor!=='string'||!context.cursor||context.cursor.length>512))||
     !['recent','title'].includes(context.order??'recent'))
     throw new Error('KNOWLEDGE_BROWSER_INVALID_RETURN_CONTEXT');
   if(context.cursor)params.set('cursor',context.cursor);
   if(context.order==='title')params.set('order','title');
   // Do not reselect the reader: on phones a selected record hides the list.
   return {label:'Back to Explorer',href:'/wiki/explore'+(params.size?'?'+esc(params.toString()):'')+'#'+anchorId(path)};
 }
 if(context.from==='search'&&typeof context.query==='string'&&context.query.length<=160){
   params.set('q',context.query);
   return {label:'Back to search results',href:'/wiki-find?'+esc(params.toString())+'#'+anchorId(path)};
 }
 throw new Error('KNOWLEDGE_BROWSER_INVALID_RETURN_CONTEXT');
}

const titleText=x=>x===undefined?'Knowledge':x;
function template(title,inside,{editable=false}={}){
 const active=title==='Explore'?'explore':title==='Library'?'home':title==='Search'?'search':'';
 const nav=(path,name,glyph,key)=>'<a href="'+path+'"'+(key===active?' aria-current="page"':'')+'>'+uiGlyph(glyph)+'<span>'+name+'</span></a>';
 const header='<header class="app-header"><a href="/wiki" class="app-brand" aria-label="Knowledge home">'+
   '<span class="app-logo">'+neuralKMark()+'</span><span>Knowledge</span></a>'+
   '<span class="workspace-indicator" title="Current authorized workspace">'+uiGlyph('folder')+'Private workspace</span>'+
   '<a class="global-find" href="/wiki-find" aria-label="Search private Knowledge records">'+
   uiGlyph('search')+'<span class="global-placeholder">Search your Knowledge…</span>'+
   '<span class="global-shortcut">Find</span></a>'+
   '<div class="header-actions">'+(editable?'<a class="header-new" href="/wiki/new">'+uiGlyph('plus')+'New</a>':'')+
   '<span class="header-private" title="Owner-only records">'+uiGlyph('lock')+'Private</span></div></header>';
 const rail='<aside class="rail"><nav aria-label="Knowledge navigation">'+
   nav('/wiki','Home','home','home')+nav('/wiki/explore','Browse','folder','explore')+
   nav('/wiki-find','Search','search','search')+'</nav>'+
   '<p class="rail-label">YOUR LIBRARY</p><nav aria-label="Library navigation">'+
   nav('/wiki/explore','Records','file','explore')+'</nav>'+
   '<div class="rail-bottom"><strong>Protected workspace</strong><p>Private records require owner authentication. No public sharing is active.</p></div></aside>';
 const mobile='<nav class="mobile-nav" aria-label="Mobile Knowledge navigation">'+
   nav('/wiki','Home','home','home')+nav('/wiki/explore','Browse','folder','explore')+
   nav('/wiki-find','Search','search','search')+'</nav>';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0b2126">'+
   '<meta name="apple-mobile-web-app-capable" content="yes">'+
   '<meta name="apple-mobile-web-app-title" content="Knowledge">'+
   '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'+
   '<link rel="icon" type="image/svg+xml" href="/wiki/icon.svg">'+
   '<link rel="apple-touch-icon" sizes="180x180" href="/wiki/apple-touch-icon.png">'+
   '<link rel="manifest" href="/wiki/manifest.webmanifest">'+
   '<title>'+esc(titleText(title))+' · Knowledge</title>'+
   '<style>'+STYLE+EDIT_STYLE+REVISION_COMPARE_STYLE+OWNER_THEME+CONCEPT_THEME+'</style></head><body>'+
   '<a class="skip-link" href="#main">Skip to content</a><div class="shell">'+header+rail+
   '<main id="main"><div class="surface">'+inside+'</div></main>'+mobile+'</div></body></html>';
}
export function htmlResponse(markup,status=200){
 return new Response(markup,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
}
export function renderOwnerLibrary(pages,{query=null,paginated=false,nextCursor=null,indexed=false,truncated=false,editable=false}={}){
 if(!Array.isArray(pages)||pages.some(x=>typeof x?.path!=='string'||typeof x?.title!=='string'))throw new Error('KNOWLEDGE_BROWSER_INVALID_DATA');
 const sorted=[...pages].sort((a,b)=>a.path.localeCompare(b.path));
 const filtered=!indexed&&typeof query==='string'&&query.trim()?sorted.filter(p=>[p.path,p.title,p.body].some(x=>typeof x==='string'&&x.normalize('NFKC').toLowerCase().includes(query.trim().normalize('NFKC').toLowerCase()))):sorted;
 const show=filtered.slice(0,100);
 const origin=typeof query==='string'?'?'+esc(new URLSearchParams({from:'search',q:query}).toString()):'';
 const list=show.length?'<ul class="list" aria-label="Knowledge records">'+show.map(p=>'<li id="'+anchorId(p.path)+'"><a href="'+link(esc(p.path))+origin+'"><span class="item-title">'+esc(p.title)+'</span><small class="item-path">'+esc(p.path)+'</small><span class="kind">'+esc(p.path.split('/')[0])+'</span><small class="item-rev">r'+Number(p.version)+'</small></a></li>').join('')+'</ul>':'<p class="empty">No matching pages in this private workspace.</p>';
 const search='<form class="search" role="search" action="/wiki-find" method="get"><label for="q" class="sub">Search Knowledge</label><input id="q" name="q" type="search" maxlength="160" value="'+esc(query??'')+'" autocomplete="off"><button type="submit">Find</button></form>';
 const next=paginated&&nextCursor?'<nav aria-label="Page navigation"><a rel="next" href="/wiki?cursor='+esc(encodeURIComponent(nextCursor))+'">Next pages →</a></nav>':'';
 return template(query?'Search':'Library','<p class="eyebrow">PRIVATE WORKSPACE</p><h1>'+esc(query?'Search Knowledge':'Your Knowledge library')+'</h1>'+(editable?'<p><a class="new-draft-link" href="/wiki/new">New draft</a></p>':'')+search+(indexed?'<p class="sub">Matches every search word, in any order.</p>':'')+'<p class="meta">'+filtered.length+(paginated?' page'+(filtered.length===1?'':'s')+' in this batch':' matching page'+(filtered.length===1?'':'s'))+(truncated?' · More matches exist; add search words to narrow results':filtered.length>100?' · Showing first 100':'')+'</p>'+list+next);
}
/** Compact, server-rendered three-area explorer: private navigation, row register and reader.
 * The Worker supplies only Access-authorized decrypted records; no client script.
 */
export function renderOwnerExplorer(pages,{selected=null,cursor=null,nextCursor=null,order='recent',editable=false,editEnabled=editable,previewEnabled=false}={}){
 if(!Array.isArray(pages)||pages.some(p=>typeof p?.path!=='string'||typeof p?.title!=='string'||!Number.isInteger(p?.version))||
    (selected!==null&&(typeof selected.path!=='string'||typeof selected.title!=='string'||typeof selected.body!=='string'))||
    (cursor!==null&&typeof cursor!=='string')||(nextCursor!==null&&typeof nextCursor!=='string')||
    !['recent','title'].includes(order))
   throw new Error('KNOWLEDGE_BROWSER_INVALID_DATA');
 // Sorting is deliberately local to the encrypted, cursor-bounded batch.
 const updatedAtMs=p=>{const value=typeof p.updatedAt==='string'?Date.parse(p.updatedAt):NaN;return Number.isFinite(value)?value:-Infinity;};
 const sorted=[...pages].sort((a,b)=>order==='title'
   ?a.title.localeCompare(b.title,undefined,{sensitivity:'base'})||a.path.localeCompare(b.path)
   :updatedAtMs(b)-updatedAtMs(a)||a.path.localeCompare(b.path));
 // Preserves the selected batch and sort without client-side state or scripts.
 const exploreHref=(path=null,sort=order,batchCursor=cursor)=>{
   const params=new URLSearchParams();
   if(batchCursor)params.set('cursor',batchCursor);
   if(sort!=='recent')params.set('order',sort);
   if(path)params.set('selected',path);
   const query=params.toString();
   return '/wiki/explore'+(query?'?'+esc(query):'');
 };
 const explorePath=path=>exploreHref(path);
 const selectedIndex=selected?sorted.findIndex(p=>p.path===selected.path):-1;
 const neighbors=selectedIndex<0?'':'<nav class="reader-neighbors" aria-label="Move between records in this batch">'+
   (selectedIndex>0?'<a rel="prev" href="'+explorePath(sorted[selectedIndex-1].path)+'">Previous record</a>':'')+
   (selectedIndex<sorted.length-1?'<a rel="next" href="'+explorePath(sorted[selectedIndex+1].path)+'">Next record</a>':'')+'</nav>';
 const sortControls='<nav class="explorer-sort" aria-label="Sort current batch">'+
   '<a href="'+exploreHref(null,'recent')+'"'+(order==='recent'?' aria-current="true"':'')+'>Latest</a>'+
   '<a href="'+exploreHref(null,'title')+'"'+(order==='title'?' aria-current="true"':'')+'>Title A–Z</a></nav>';
 const register=sorted.length?'<ul class="explorer-register" aria-label="Records in current batch">'+sorted.map(p=>
   '<li id="'+anchorId(p.path)+'"><a href="'+explorePath(p.path)+'"'+(selected?.path===p.path?' aria-current="page"':'')+'>'+
   '<span class="register-icon">'+uiGlyph('file')+'</span>'+
   '<span class="register-text"><span class="explorer-row-title">'+esc(p.title)+'</span>'+
   '<small>'+esc(p.path)+' · r'+Number(p.version)+'</small></span>'+
   '<time class="register-updated">'+esc(typeof p.updatedAt==='string'?p.updatedAt.slice(0,10):'')+'</time></a></li>').join('')+'</ul>':
   '<p class="empty">No records in this batch.</p>';
 const fromExplore=new URLSearchParams({from:'explore'});
 if(cursor)fromExplore.set('cursor',cursor);
 if(order==='title')fromExplore.set('order','title');
 const controls=selected?'<nav class="record-actions" aria-label="Selected record actions">'+
   '<a href="/wiki/page/'+esc(selected.path)+'?'+esc(fromExplore.toString())+'">'+uiGlyph('file')+'Open full record</a>'+ 
   '<a href="/wiki/download/'+esc(selected.path)+'" download>'+uiGlyph('file')+'Download .md</a>'+
   (editEnabled?'<a href="/wiki/edit/'+esc(selected.path)+'">'+uiGlyph('edit')+'Edit draft</a>':'')+
   '<a href="/wiki/history/'+esc(selected.path)+'">'+uiGlyph('history')+'History</a>'+
   (previewEnabled?'<a href="/wiki/preview/'+esc(selected.path)+'">'+uiGlyph('shield')+'Private share preview</a>':'')+'</nav>':'';
 const inspector=selected?'<details class="reader-inspector" open><summary>Details</summary>'+
   '<dl><dt>Type</dt><dd>Record</dd><dt>Access</dt><dd>Owner-only</dd>'+
   '<dt>State</dt><dd>Private draft</dd><dt>Revision</dt><dd>r'+Number(selected.version)+'</dd>'+
   '<dt>Updated</dt><dd>'+esc(selected.updatedAt??'Unknown')+'</dd></dl>'+
   '<p class="inspector-caption">This document remains private. Access is rechecked by the protected service; a copied URL does not grant permission.</p>'+
   '</details>':'';
 const detail=selected?'<div class="reader-body">'+
   '<p class="explorer-back"><a href="'+exploreHref(null)+'#'+anchorId(selected.path)+'">'+uiGlyph('back')+'Back to records</a></p>'+
   '<p class="crumb"><a href="/wiki">Library</a> / <span>'+esc(selected.path)+'</span></p>'+
   '<div class="reader-head"><p class="eyebrow">KNOWLEDGE / PRIVATE RECORD</p></div>'+
   '<h2 class="reader-title">'+esc(selected.title)+'</h2>'+
   '<p class="record-meta"><span class="status-label">Owner-only</span><span>Draft · revision '+Number(selected.version)+'</span></p>'+
   controls+neighbors+'<article aria-label="Selected record content" class="document">'+renderSafeMarkdown(selected.body)+'</article>'+
   '<p class="sharing-note">Private record. No recipient or public link has been granted access. Downloaded Markdown is plaintext on your device.</p></div>'+
   inspector:
   '<div class="explorer-empty"><p class="eyebrow">YOUR WORKSPACE</p><h2>Choose a record</h2>'+
   '<p>Select a row to read it here without leaving the private Knowledge explorer.</p></div>';
 const next=nextCursor?'<a class="explorer-next" rel="next" href="'+exploreHref(null,order,nextCursor)+'">Next batch</a>':'';
 return template('Explore','<div class="explorer-shell'+(selected?' has-selected':'')+'">'+
   '<header class="explorer-header"><div class="explorer-heading"><p class="eyebrow">YOUR PRIVATE WORKSPACE</p>'+
   '<h1>Records</h1><p class="sub">'+pages.length+' records in this batch</p></div></header>'+
   '<div class="explorer-layout'+(selected?' has-selected':'')+'">'+
   '<section class="explorer-list" aria-label="Record register"><div class="explorer-toolbar"><strong>Records · '+(order==='recent'?'latest':'title A–Z')+' in batch</strong>'+sortControls+
   '<a href="/wiki-find">Search all</a></div>'+register+next+'</section>'+
   '<section class="explorer-detail" aria-label="Record reader">'+detail+'</section></div></div>',{editable});
}

export function renderOwnerPage(page,{historical=false,editable=false,saved=false,unchanged=false,previewEnabled=false,returnContext=null}={}){
 if(!page||typeof page.title!=='string'||typeof page.path!=='string'||typeof page.body!=='string')throw new Error('KNOWLEDGE_BROWSER_INVALID_DATA');
 const back=returnLocation(page.path,returnContext);
 const returnNav=back?'<p class="explorer-back"><a href="'+back.href+'">'+uiGlyph('back')+back.label+'</a></p>':'';
 const source=page.sourceUrl&&/^https:\/\//.test(page.sourceUrl)?'<p><a rel="noreferrer noopener" href="'+esc(page.sourceUrl)+'">Original source</a></p>':'';
 const controls='<nav class="record-actions" aria-label="Record actions">'+
   '<a href="/wiki/history/'+esc(page.path)+'">Version history</a>'+
   (Number.isInteger(page.version)&&page.version>1?'<a href="/wiki/compare/'+esc(page.path)+'/'+page.version+'">Compare with previous</a>':'')+ 
   (!historical?'<a href="/wiki/download/'+esc(page.path)+'" download>Download .md</a>':'')+
   (editable&&!historical?'<a href="/wiki/edit/'+esc(page.path)+'">Edit draft</a>':'')+
   (previewEnabled&&!historical?'<a href="/wiki/preview/'+esc(page.path)+'">Preview for sharing</a>':'')+'</nav>';
 const message=saved?'<p role="status" class="notice">Saved and verified · revision '+Number(page.version)+'</p>':
   unchanged?'<p role="status" class="notice">No changes to save · revision '+Number(page.version)+'</p>':'';
 const main=returnNav+'<p class="crumb"><a href="/wiki">Library</a> / '+esc(page.path)+'</p>'+
   '<p class="eyebrow">KNOWLEDGE / RECORD</p><h1>'+esc(page.title)+'</h1>'+
   '<div class="record-meta"><span class="status-label">Owner-only</span><span>'+(historical?'Historical revision':'Draft')+' · revision '+Number(page.version)+'</span><span>'+esc(page.updatedAt??'')+'</span></div>'+
   message+controls+'<article aria-label="Page content" class="document">'+renderSafeMarkdown(page.body)+'</article>'+
   '<footer class="document-footer">'+source+
   '<p>Internal path: <code>'+esc(page.path)+'</code></p>'+
   '<p class="sharing-note"><strong>Private record.</strong> Copying this page URL does not grant access. Anyone-with-the-link sharing is not enabled. Downloaded Markdown leaves Knowledge encryption.</p>'+
   '</footer>';
 return template(page.title,main);
}
/** Owner-authenticated review only. It never creates a token, release or shared record.
 * Deliberately no private hyperlinks or source metadata appear in preview content.
 */
export function renderOwnerSharePreview(page){
 if(!page||typeof page.path!=='string'||typeof page.title!=='string'||typeof page.body!=='string'||!Number.isInteger(page.version))
   throw new Error('KNOWLEDGE_BROWSER_INVALID_DATA');
 const main='<p class="crumb"><a href="/wiki/page/'+esc(page.path)+'">Back to private record</a></p>'+
   '<p class="eyebrow">OWNER-ONLY / DISCLOSURE REVIEW</p>'+
   '<p role="status" class="notice conflict"><strong>Private preview only — not shared.</strong> This is not a public link and no recipient has access. Inspect every line for confidential details before considering an independently approved release.</p>'+
   '<h1>'+esc(page.title)+'</h1>'+
   '<p class="record-meta">Potential recipient content · draft revision '+Number(page.version)+' · not approved for publication</p>'+
   '<article aria-label="Private recipient preview" class="document">'+
     renderSafeMarkdown(page.body,{internalLinks:false,externalLinks:false})+'</article>'+
   '<p class="sharing-note"><strong>No publication occurred.</strong> A future release will require explicit owner review, a separate approved snapshot, expiration and revocation controls. Private documents must never be treated as public by copying this URL.</p>';
 return template('Private preview · '+page.title,main);
}

export function renderOwnerNotFound(){return template('Not found','<h1>Page not found</h1><p>This page is not available in your Knowledge workspace.</p><a href="/wiki">Return to library</a>');}

/** Owner-only immutable-history index. Each row must already be authenticated. */
export function renderOwnerHistory(page,versions){
 if(!page||typeof page.path!=='string'||typeof page.title!=='string'||
    !Array.isArray(versions)||versions.some(v=>!Number.isInteger(v?.version)||
      typeof v?.updatedAt!=='string'||typeof v?.title!=='string'))
   throw new Error('KNOWLEDGE_BROWSER_INVALID_DATA');
 const items=versions.map(v=>'<li><a href="/wiki/revision/'+esc(page.path)+'/'+v.version+'"><span>Revision '+v.version+(v.version===page.version?' · Current':'')+'</span><small>'+esc(v.title)+' · '+esc(v.updatedAt)+'</small></a>'+(v.version>1?'<a class="revision-compare-link" href="/wiki/compare/'+esc(page.path)+'/'+v.version+'">Compare with revision '+(v.version-1)+'</a>':'')+'</li>').join('');
 return template('Version history','<p class="crumb"><a href="/wiki">Library</a> / <a href="/wiki/page/'+esc(page.path)+'">'+esc(page.path)+'</a></p><h1>Version history</h1><p class="sub">'+esc(page.title)+' · Immutable revisions · Owner only</p><ul class="list">'+items+'</ul>');
}

/** Compare adjacent, already-authenticated immutable revisions.
 * A bounded line LCS handles normal notes; large notes show both complete
 * originals instead of producing a misleading or expensive approximate diff.
 */
export function renderOwnerRevisionComparison(before,after){
 const valid=p=>p&&typeof p.path==='string'&&p.path.length<=240&&
   /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,7}$/.test(p.path)&&
   typeof p.title==='string'&&typeof p.body==='string'&&
   Number.isInteger(p.version)&&p.version>=1&&p.version<=128;
 if(!valid(before)||!valid(after)||before.path!==after.path||
    after.version!==before.version+1)throw new Error('KNOWLEDGE_COMPARISON_INVALID_DATA');
 const oldLines=before.body.split('\n'),newLines=after.body.split('\n');
 const changedTitle=before.title!==after.title?
   '<p class="notice">Title changed: <strong>'+esc(before.title)+'</strong> → <strong>'+esc(after.title)+'</strong></p>':'';
 const changedSource=(before.sourceUrl??null)!==(after.sourceUrl??null)?
   '<p class="sub">Source reference changed between these revisions.</p>':'';
 let changes;
 if(oldLines.length+newLines.length>4096||oldLines.length*newLines.length>120000){
   changes='<p class="compare-summary">This document has too many lines for an efficient inline difference. Both complete immutable versions appear below; no content is hidden or approximated.</p>'+
     '<h2>Revision '+before.version+'</h2><pre class="compare-full">'+esc(before.body)+'</pre>'+
     '<h2>Revision '+after.version+'</h2><pre class="compare-full">'+esc(after.body)+'</pre>';
 }else{
   const width=newLines.length+1;
   const lcs=Array.from({length:oldLines.length+1},()=>new Uint16Array(width));
   for(let i=oldLines.length-1;i>=0;i--){
     for(let j=newLines.length-1;j>=0;j--){
       lcs[i][j]=oldLines[i]===newLines[j]?lcs[i+1][j+1]+1:
         Math.max(lcs[i+1][j],lcs[i][j+1]);
     }
   }
   const lines=[];
   let i=0,j=0,added=0,removed=0;
   while(i<oldLines.length||j<newLines.length){
     if(i<oldLines.length&&j<newLines.length&&oldLines[i]===newLines[j]){
       lines.push(['unchanged',oldLines[i]]);i++;j++;
     }else if(i<oldLines.length&&(j===newLines.length||lcs[i+1][j]>=lcs[i][j+1])){
       lines.push(['removed',oldLines[i++]]);removed++;
     }else{
       lines.push(['added',newLines[j++]]);added++;
     }
   }
   const labels={removed:'Removed',added:'Added',unchanged:'Unchanged'};
   changes='<p class="compare-summary">'+added+' added · '+removed+' removed · '+
     (added===0&&removed===0?'No Markdown text changes':'Unchanged lines retained for context')+'</p>'+
     '<ol class="compare-lines" aria-label="Line-by-line Markdown comparison">'+
     lines.map(([kind,value])=>'<li class="compare-line compare-'+kind+'"><span class="compare-line-kind">'+
       labels[kind]+'</span><code>'+esc(value)+'</code></li>').join('')+'</ol>';
 }
 const base='/wiki/revision/'+esc(after.path)+'/';
 const links='<nav class="compare-actions" aria-label="Revision navigation">'+
   '<a href="'+base+before.version+'">View revision '+before.version+'</a>'+
   '<a href="'+base+after.version+'">View revision '+after.version+'</a>'+
   '<a href="/wiki/page/'+esc(after.path)+'">Current record</a></nav>';
 return template('Compare revisions','<p class="crumb"><a href="/wiki">Library</a> / '+
   '<a href="/wiki/history/'+esc(after.path)+'">Version history</a> / Compare</p>'+
   '<p class="eyebrow">KNOWLEDGE / PRIVATE HISTORY</p><h1>Compare revisions</h1>'+
   '<p class="sub">'+esc(after.path)+' · revision '+before.version+' → '+after.version+
   ' · Owner only</p>'+links+changedTitle+changedSource+changes);
}

/** Signed-token, no-JavaScript editor. The Worker handles authentication and CAS. */
export function renderOwnerEditor(page,csrf,{attempt=null,error=null,retry=false,invalidField=null,acceptanceOnly=false}={}){
 if(!page||typeof page.path!=='string'||typeof page.title!=='string'||
    typeof page.body!=='string'||!Number.isInteger(page.version)||page.version<1||
    typeof csrf!=='string')throw new Error('KNOWLEDGE_EDITOR_INVALID_DATA');
 const title=attempt?.title??page.title,body=attempt?.body??page.body;
 const notice=error?'<p id="edit-error" role="alert" class="notice conflict">'+esc(error)+'</p>':
   acceptanceOnly?'<p class="sub">Fictional staging acceptance only. This form can save exactly the approved second revision. Title and content are fixed. No personal, patient or business information is permitted.</p>':
   '<p class="sub">Owner-only draft editor. Saving creates a verified immutable revision.</p>';
 const titleAttrs=invalidField==='title'?' aria-invalid="true" aria-describedby="edit-error"':'';
 const bodyAttrs=invalidField==='body'?' aria-invalid="true" aria-describedby="edit-error"':'';
 const bodyFields='<div class="field"><label for="edit-title">Title</label><input id="edit-title" name="title" required maxlength="160" value="'+esc(title)+'"'+(acceptanceOnly?' readonly':'')+titleAttrs+'></div>'+
   '<div class="field"><label for="edit-body">Markdown content</label><textarea id="edit-body" name="body"'+(acceptanceOnly||error&&!retry?' readonly':'')+bodyAttrs+'>'+esc(body)+'</textarea><span class="limit">'+
   (error&&!retry?'Unsaved text is preserved here for copying. Open the latest revision and reconcile manually.':'Maximum 16 KiB UTF-8. Explicit save, no background writes.')+'</span></div>';
 const markup=error&&!retry?'<div class="editor">'+bodyFields+
   '<div class="action"><a href="/wiki/page/'+esc(page.path)+'">Open latest revision to reconcile</a></div></div>':
   '<form class="editor'+(acceptanceOnly?' acceptance-editor':'')+'" method="post" action="/wiki/edit/'+esc(page.path)+'" autocomplete="off">'+
   '<input type="hidden" name="expectedVersion" value="'+page.version+'">'+
   '<input type="hidden" name="csrf" value="'+esc(csrf)+'">'+bodyFields+
   '<div class="action"><button type="submit">'+(acceptanceOnly?'Save fictional revision 2':'Save new revision')+'</button><a href="/wiki/page/'+esc(page.path)+'">Cancel</a></div></form>';
 return template('Edit '+page.title,'<p class="crumb"><a href="/wiki">Library</a> / <a href="/wiki/page/'+esc(page.path)+'">'+esc(page.path)+'</a></p><h1>Edit draft</h1>'+notice+markup);
}

/** Owner-only creation form. Validation errors allow correction; conflicts are copy-only. */
export function renderOwnerNewDraft(csrf,{attempt=null,error=null,retry=false,invalidField=null,acceptanceOnly=false}={}) {
 if(typeof csrf!=='string'||!csrf)throw new Error('KNOWLEDGE_EDITOR_INVALID_DATA');
 const path=attempt?.path??'',title=attempt?.title??'',body=attempt?.body??'';
 const notice=error?'<p id="new-draft-error" role="alert" class="notice conflict">'+esc(error)+'</p>':
  acceptanceOnly?'<p class="sub">Fictional staging acceptance only. This form creates one predefined test record with fixed values. No personal, patient or business data is permitted.</p>':
  '<p class="sub">Create an owner-only nonclinical draft. Paths are permanent; saving creates revision 1.</p>';
 // Match PATH_PART and the 8-section limit enforced by the server. Escaped
 // hyphens are required by modern HTML pattern (RegExp v) engines.
 const pattern='[a-z0-9][a-z0-9\\-]{0,63}(/[a-z0-9][a-z0-9\\-]{0,63}){0,7}';
 const pathHelp='new-path-help'+(invalidField==='path'?' new-draft-error':'');
 const pathField='<div class="field"><label for="new-path">Wiki path</label><input id="new-path" name="path" required maxlength="240" pattern="'+pattern+'" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="notes/example-draft" aria-describedby="'+pathHelp+'"'+(invalidField==='path'?' aria-invalid="true"':'')+' value="'+esc(path)+'"'+(acceptanceOnly||error&&!retry?' readonly':'')+'><span class="limit" id="new-path-help">Example: notes/my-draft. Lowercase letters, digits, hyphens and up to eight /-separated sections. No spaces.</span></div>';
 const titleField='<div class="field"><label for="new-title">Title</label><input id="new-title" name="title" required maxlength="160" value="'+esc(title)+'"'+(invalidField==='title'?' aria-invalid="true" aria-describedby="new-draft-error"':'')+(acceptanceOnly||error&&!retry?' readonly':'')+'></div>';
 const bodyField='<div class="field"><label for="new-body">Markdown content</label><textarea id="new-body" name="body"'+(invalidField==='body'?' aria-invalid="true" aria-describedby="new-draft-error"':'')+(acceptanceOnly||error&&!retry?' readonly':'')+'>'+esc(body)+'</textarea><span class="limit">Maximum 16 KiB UTF-8. Private draft; no sharing or publication.</span></div>';
 const fields=pathField+titleField+bodyField;
 const form=error&&!retry?'<div class="editor">'+fields+'<div class="action"><a href="/wiki/new">Start another draft</a></div></div>':
  '<form class="editor'+(acceptanceOnly?' acceptance-editor':'')+'" method="post" action="/wiki/new" autocomplete="off">'+
  '<input type="hidden" name="csrf" value="'+esc(csrf)+'">'+fields+
  '<div class="action"><button type="submit">'+(acceptanceOnly?'Create fictional test record':'Create private draft')+'</button><a href="/wiki">Cancel</a></div></form>';
 return template('New draft','<p class="crumb"><a href="/wiki">Library</a> / New draft</p><h1>New draft</h1>'+notice+form);
}
