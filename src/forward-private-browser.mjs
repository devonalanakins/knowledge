/** Read-only owner-only HTML rendering of forward Knowledge drafts. No script or state. */
const STYLE=`:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0c1017;color:#edf1f5}*{box-sizing:border-box}body{margin:0;line-height:1.55}a{color:#87dce5;text-decoration:none}a:hover{text-decoration:underline}a:focus-visible,input:focus-visible,button:focus-visible{outline:3px solid #87dce5;outline-offset:3px}.shell{max-width:1280px;min-height:100vh;margin:auto;display:grid;grid-template-columns:236px minmax(0,1fr);gap:28px;padding:28px}.rail{border-right:1px solid #2d3744;padding-right:22px}.rail nav{display:grid;gap:12px}.mark{font-size:12px;letter-spacing:.16em;font-weight:700;color:#87dce5}.sub,.meta{color:#a4b5c3;font-size:13px}main{min-width:0}.surface{border-radius:20px;background:#151d29;border:1px solid #2c3b4a;padding:28px 32px;min-height:65vh}.search{display:flex;gap:12px;max-width:680px;margin:18px 0 30px}.search input{flex:1;min-width:0;background:#101823;border:1px solid #566476;color:inherit;border-radius:10px;padding:11px 13px;font:inherit}.search button{background:#86e0e5;color:#081218;border:0;border-radius:10px;font-weight:700;padding:10px 16px;cursor:pointer}h1{font-size:clamp(1.65rem,3vw,2.6rem);line-height:1.17;overflow-wrap:anywhere}h2{font-size:1.1rem;margin:26px 0 12px}.list{list-style:none;margin:16px 0;padding:0;display:grid;gap:10px}.list a{display:block;border:1px solid #314357;border-radius:13px;padding:14px 16px;background:#1b2937}.list a span{display:block;font-weight:650;color:#edf1f5}.list a small{display:block;overflow-wrap:anywhere;color:#a4b5c3}.content{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-width:75ch;margin:24px 0 40px}.crumb{font-size:13px;color:#a4b5c3;overflow-wrap:anywhere}.meta{border-top:1px solid #334250;padding-top:16px;margin-top:20px}.empty{border:1px dashed #435363;border-radius:12px;padding:18px;color:#a4b5c3}@media(max-width:740px){.shell{display:block;padding:12px}.rail{border:0;border-bottom:1px solid #2d3744;padding:8px 10px 15px;margin-bottom:14px}.rail nav{display:flex;gap:16px;flex-wrap:wrap}.surface{min-height:65vh;padding:21px 17px;border-radius:16px}.search{flex-wrap:wrap}.search button{min-height:44px}.search input{min-height:44px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}`;
const EDIT_STYLE='.editor{display:grid;gap:18px;max-width:76ch}.field{display:grid;gap:7px}.field label{font-weight:650}.field input,.field textarea{width:100%;background:#101823;color:#edf1f5;border:1px solid #617384;border-radius:11px;padding:12px 14px;font:inherit}.field textarea{min-height:34vh;resize:vertical;line-height:1.6}.field input:focus-visible,.field textarea:focus-visible{outline:3px solid #87dce5;outline-offset:2px}.action{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.action button{background:#86e0e5;color:#081218;border:0;border-radius:10px;font:inherit;font-weight:700;padding:12px 18px;cursor:pointer;min-height:44px}.notice{padding:13px 16px;border:1px solid #688b91;border-radius:11px;background:#17303d;color:#e8f9fb}.conflict{border-color:#b99b6d;background:#30271e;color:#fff1de}.limit{color:#a4b5c3;font-size:13px}@media(max-width:740px){.field textarea{min-height:45vh}.action button{width:100%}}';
const esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const link=path=>'/wiki/page/'+path;
const titleText=x=>x===undefined?'Knowledge':x;
function template(title,inside){
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+esc(titleText(title))+' · Knowledge</title><style>'+STYLE+EDIT_STYLE+'</style></head><body><div class="shell"><aside class="rail"><p class="mark">DEVONSTATION / KNOWLEDGE</p><p class="sub">Private records · Owner view</p><nav aria-label="Knowledge navigation"><a href="/wiki">Library</a><a href="/wiki-find">Search</a></nav></aside><main id="main"><div class="surface">'+inside+'</div></main></div></body></html>';
}
export function htmlResponse(markup,status=200){
 return new Response(markup,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
}
export function renderOwnerLibrary(pages,{query=null,paginated=false,nextCursor=null,indexed=false,truncated=false}={}){
 if(!Array.isArray(pages)||pages.some(x=>typeof x?.path!=='string'||typeof x?.title!=='string'))throw new Error('KNOWLEDGE_BROWSER_INVALID_DATA');
 const sorted=[...pages].sort((a,b)=>a.path.localeCompare(b.path));
 const filtered=!indexed&&typeof query==='string'&&query.trim()?sorted.filter(p=>[p.path,p.title,p.body].some(x=>typeof x==='string'&&x.normalize('NFKC').toLowerCase().includes(query.trim().normalize('NFKC').toLowerCase()))):sorted;
 const show=filtered.slice(0,100);
 const list=show.length?'<ul class="list">'+show.map(p=>'<li><a href="'+link(esc(p.path))+'"><span>'+esc(p.title)+'</span><small>'+esc(p.path)+' · revision '+Number(p.version)+'</small></a></li>').join('')+'</ul>':'<p class="empty">No matching pages in this private workspace.</p>';
 const search='<form class="search" role="search" action="/wiki-find" method="get"><label for="q" class="sub">Search Knowledge</label><input id="q" name="q" type="search" maxlength="160" value="'+esc(query??'')+'" autocomplete="off"><button type="submit">Find</button></form>';
 const next=paginated&&nextCursor?'<nav aria-label="Page navigation"><a rel="next" href="/wiki?cursor='+esc(encodeURIComponent(nextCursor))+'">Next pages →</a></nav>':'';
 return template(query?'Search':'Library','<p class="sub">PRIVATE WORKSPACE</p><h1>'+esc(query?'Search':'Your Knowledge library')+'</h1>'+search+(indexed?'<p class="sub">Matches every search word, in any order.</p>':'')+'<p class="meta">'+filtered.length+(paginated?' page'+(filtered.length===1?'':'s')+' in this batch':' matching page'+(filtered.length===1?'':'s'))+(truncated?' · More matches exist; add search words to narrow results':filtered.length>100?' · Showing first 100':'')+'</p>'+list+next);
}
export function renderOwnerPage(page,{historical=false,editable=false,saved=false}={}){
 if(!page||typeof page.title!=='string'||typeof page.path!=='string'||typeof page.body!=='string')throw new Error('KNOWLEDGE_BROWSER_INVALID_DATA');
 const source=page.sourceUrl&&/^https:\/\//.test(page.sourceUrl)?'<p><a rel="noreferrer noopener" href="'+esc(page.sourceUrl)+'">Original source</a></p>':'';
 const main='<p class="crumb"><a href="/wiki">Library</a> / '+esc(page.path)+'</p><h1>'+esc(page.title)+'</h1><p class="sub">'+(historical?'Historical revision':'Draft')+' · revision '+Number(page.version)+' · '+esc(page.updatedAt??'')+' · <a href="/wiki/history/'+esc(page.path)+'">Version history</a>'+(editable&&!historical?' · <a href="/wiki/edit/'+esc(page.path)+'">Edit draft</a>':'')+'</p>'+(saved?'<p role="status" class="notice">Saved and verified · revision '+Number(page.version)+'</p>':'')+'<article aria-label="Page content" class="content">'+esc(page.body)+'</article><div class="meta">'+source+'<p>Private owner view. No sharing or publication enabled.</p></div>';
 return template(page.title,main);
}
export function renderOwnerNotFound(){return template('Not found','<h1>Page not found</h1><p>This page is not available in your Knowledge workspace.</p><a href="/wiki">Return to library</a>');}

/** Owner-only immutable-history index. Each row must already be authenticated. */
export function renderOwnerHistory(page,versions){
 if(!page||typeof page.path!=='string'||typeof page.title!=='string'||
    !Array.isArray(versions)||versions.some(v=>!Number.isInteger(v?.version)||
      typeof v?.updatedAt!=='string'||typeof v?.title!=='string'))
   throw new Error('KNOWLEDGE_BROWSER_INVALID_DATA');
 const items=versions.map(v=>'<li><a href="/wiki/revision/'+esc(page.path)+'/'+v.version+'"><span>Revision '+v.version+(v.version===page.version?' · Current':'')+'</span><small>'+esc(v.title)+' · '+esc(v.updatedAt)+'</small></a></li>').join('');
 return template('Version history','<p class="crumb"><a href="/wiki">Library</a> / <a href="/wiki/page/'+esc(page.path)+'">'+esc(page.path)+'</a></p><h1>Version history</h1><p class="sub">'+esc(page.title)+' · Immutable revisions · Owner only</p><ul class="list">'+items+'</ul>');
}

/** Signed-token, no-JavaScript editor. The Worker handles authentication and CAS. */
export function renderOwnerEditor(page,csrf,{attempt=null,error=null}={}){
 if(!page||typeof page.path!=='string'||typeof page.title!=='string'||
    typeof page.body!=='string'||!Number.isInteger(page.version)||page.version<1||
    typeof csrf!=='string')throw new Error('KNOWLEDGE_EDITOR_INVALID_DATA');
 const title=attempt?.title??page.title,body=attempt?.body??page.body;
 const notice=error?'<p role="alert" class="notice conflict">'+esc(error)+'</p>':
   '<p class="sub">Owner-only draft editor. Saving creates a verified immutable revision.</p>';
 const markup='<form class="editor" method="post" action="/wiki/edit/'+esc(page.path)+'" autocomplete="off">'+
   '<input type="hidden" name="expectedVersion" value="'+page.version+'">'+
   '<input type="hidden" name="csrf" value="'+esc(csrf)+'">'+
   '<div class="field"><label for="edit-title">Title</label><input id="edit-title" name="title" required maxlength="160" value="'+esc(title)+'"></div>'+
   '<div class="field"><label for="edit-body">Markdown content</label><textarea id="edit-body" name="body">'+esc(body)+'</textarea><span class="limit">Maximum 16 KiB UTF-8. Explicit save, no background writes.</span></div>'+
   '<div class="action"><button type="submit">Save new revision</button><a href="/wiki/page/'+esc(page.path)+'">Cancel</a></div></form>';
 return template('Edit '+page.title,'<p class="crumb"><a href="/wiki">Library</a> / <a href="/wiki/page/'+esc(page.path)+'">'+esc(page.path)+'</a></p><h1>Edit draft</h1>'+notice+markup);
}
