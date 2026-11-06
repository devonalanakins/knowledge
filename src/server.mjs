#!/usr/bin/env node
/** Private, read-only wiki with separate machine capture; synthetic/self-hosted preview only. */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { KnowledgeStore, KnowledgeError } from './knowledge.mjs';
import { dispatchMcp, MCP_PROTOCOL_VERSION } from './mcp.mjs';
import { createMcpResourceMetadata, MCP_RESOURCE_METADATA_PATH } from './mcp-resource.mjs';

const CSS = `
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#080b10;color:#eaf0f3}
*{box-sizing:border-box}body{margin:0;line-height:1.55}a{color:#8ee8ec;text-decoration:none}a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #60e0e3;outline-offset:3px}
.shell{max-width:1280px;margin:auto;padding:24px;display:grid;grid-template-columns:minmax(200px,260px) minmax(0,1fr);gap:32px}
.sidebar{border-right:1px solid #243544;padding-right:24px}.brand{letter-spacing:.22em;font-size:11px;color:#60e0e3;font-weight:700}
.panel{padding:26px 32px;background:#101821;border:1px solid #253746;border-radius:20px;min-height:70vh}
small,.muted{color:#a0b1c2}h1{font-size:clamp(2rem,4vw,3rem);line-height:1.15;margin:.4em 0}h2{font-size:1.4rem;margin-top:1.8em}
nav a{display:block;padding:10px 8px;border-radius:8px;overflow-wrap:anywhere}nav a:hover{background:#1a2936}
.pill{border:1px solid #385164;padding:4px 10px;border-radius:50px;display:inline-block;color:#b4c3d1;font-size:12px}
.search{display:flex;gap:8px;margin:22px 0;flex-wrap:wrap}input{font:inherit;color:#eaf0f3;background:#16222e;border:1px solid #435465;border-radius:10px;padding:12px;max-width:100%;flex:1}button{font:inherit;background:#62dce0;color:#071017;border:0;border-radius:10px;padding:12px 18px;font-weight:700;cursor:pointer}
.article{max-width:760px}.article p,.article li{overflow-wrap:anywhere;white-space:pre-wrap}.article ul{padding-left:22px}
.kicker{font-size:11px;letter-spacing:.14em;color:#8ca5bb;text-transform:uppercase}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-top:22px}
.item{display:block;padding:20px;border:1px solid #2d4456;border-radius:12px;background:#15212c}.item strong{display:block;color:#eaf0f3}.item small{display:block;margin-top:8px}
footer{margin-top:50px;font-size:12px;color:#8296a7}hr{border:0;border-top:1px solid #2d4355;margin:24px 0}
@media(max-width:720px){.shell{grid-template-columns:1fr;padding:16px;gap:12px}.sidebar{border:0;border-bottom:1px solid #253746;padding:0 0 12px}.panel{min-height:0;padding:20px;border-radius:16px}nav{display:flex;overflow-x:auto}nav a{white-space:nowrap}h1{font-size:2.1rem}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation:none!important;transition:none!important}}`;

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function stylePage(title, content, {navigation='', shared=false}={}) {
  const main = shared?`<main class="panel article">${content}</main>`:`<aside class="sidebar"><p class="brand">KNOWLEDGE</p><small>GPT-MAINTAINED WIKI</small><nav>${navigation}</nav></aside><main class="panel">${content}</main>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} · Knowledge</title><style>${CSS}</style></head><body><div class="shell"${shared?' style="display:block;max-width:840px"':''}>${main}</div></body></html>`;
}
function formatBody(text) {
  const out=[];let inList=false;
  for(const line of text.split(/\r?\n/)){
    if(/^\s*[-*] /.test(line)){if(!inList){out.push('<ul>');inList=true;}out.push(`<li>${escapeHtml(line.replace(/^\s*[-*] /,''))}</li>`);continue;}
    if(inList){out.push('</ul>');inList=false;}
    if(/^##? /.test(line)){const level=line.startsWith('## ')?2:2;out.push(`<h${level}>${escapeHtml(line.slice(line.indexOf(' ')+1))}</h${level}>`);}
    else if(line.trim())out.push(`<p>${escapeHtml(line)}</p>`);
  }
  if(inList)out.push('</ul>');
  return out.join('\n');
}
function navHtml(space){return `<a href="/">All pages</a><a href="/?q=">Search</a><span class="muted">Workspace: ${escapeHtml(space)}</span>`;}
function pageContent(page, shared=false){
  return `<span class="kicker">${shared?'SELECTIVELY SHARED':'AI-CAPTURED · WORKING KNOWLEDGE'}</span><h1>${escapeHtml(page.title)}</h1>`+
    `<p class="muted">${shared?'Shared view':escapeHtml(page.path||page.kind)} · Revision ${page.version}</p><hr><article class="article">${formatBody(page.body)}</article>`+
    (!shared&&page.sourceUrl?`<hr><p class="muted">Source: <a rel="noreferrer noopener" target="_blank" href="${escapeHtml(page.sourceUrl)}">Original reference</a></p>`:'')+
    `<footer>${shared?'This page was explicitly shared.':'AI captures are not equivalent to owner approval.'} · Knowledge</footer>`;
}
function respond(res,status,body,contentType='text/html; charset=utf-8',headers={}){
  res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow',...headers});res.end(body);
}
function json(res,status,body){respond(res,status,JSON.stringify(body),'application/json; charset=utf-8');}
function text(res,status,message){respond(res,status,stylePage('Notice',`<h1>${escapeHtml(message)}</h1>`,{shared:true}));}
function readLimited(req,limit){return new Promise((resolve,reject)=>{let size=0;let parts=[];let failed=false;req.on('data',c=>{size+=c.length;if(size>limit){if(!failed){failed=true;reject(new KnowledgeError('INVALID_INPUT','Request too large'));}parts=[];}else if(!failed)parts.push(c);});req.on('end',()=>{if(!failed)resolve(Buffer.concat(parts).toString('utf8'));});req.on('error',reject);});}
function cookieValue(req,name){const c=(req.headers.cookie||'').split(';').map(x=>x.trim());const v=c.find(x=>x.startsWith(name+'='));return v?.slice(name.length+1)||'';}

export function createKnowledgeServer(store,{ownerToken,agentToken,space='personal',secureCookies=false,mcpTokenVerifier=null,mcpResource=null}={}){
  if(!(store instanceof KnowledgeStore))throw new Error('KnowledgeStore required');
  if(![ownerToken,agentToken].every(t=>typeof t==='string'&&Buffer.byteLength(t)>=32)||ownerToken===agentToken)throw new Error('Provide distinct owner and agent tokens of at least 32 bytes');
  if(mcpTokenVerifier !== null && typeof mcpTokenVerifier !== 'function') throw new Error('mcpTokenVerifier must be a trusted function');
  if(mcpResource !== null && !mcpTokenVerifier) throw new Error('MCP resource metadata requires a signed-token verifier');
  const discovery = mcpResource === null ? null : createMcpResourceMetadata(mcpResource);
  if(!store.getSpace(space))throw new Error('Knowledge workspace must exist before server startup');
  const session=randomBytes(32).toString('base64url');
  const ownerCookie=req=>safeEqual(cookieValue(req,'knowledge_session'),session);
  const bearer=req=>{const value=req.headers.authorization||'';return value.startsWith('Bearer ')?value.slice(7):'';};
  return createServer(async(req,res)=>{
    try{
      const u=new URL(req.url||'/',`http://127.0.0.1`);
      const path=u.pathname;
      // Public discovery contains ONLY the explicitly configured resource and
      // authorization-server URLs; never reflect a request Host or token claim.
      if(discovery && req.method==='GET' &&
        (path===MCP_RESOURCE_METADATA_PATH || path==='/.well-known/oauth-protected-resource')){
        respond(res,200,JSON.stringify(discovery.metadata),'application/json; charset=utf-8');
        return;
      }
      if(req.method==='GET'&&path==='/health'){json(res,200,{status:'ok',service:'knowledge',version:'0.1.0',mode:'local-preview'});return;}
      // Locally bound tool interface; never expose directly to the internet.
      if(path==='/mcp'){
        if(req.method!=='POST'){respond(res,405,'','text/plain; charset=utf-8',{'Allow':'POST'});return;}
        const port=req.socket.localPort;
        const allowedHosts=['127.0.0.1:'+port,'localhost:'+port];
        if(!allowedHosts.includes(req.headers.host)){json(res,403,{error:'INVALID_HOST'});return;}
        if(req.headers.origin){
          let originAllowed=false;
          try{
            const origin=new URL(req.headers.origin);
            originAllowed=origin.protocol==='http:'&&allowedHosts.includes(origin.host)&&origin.pathname==='/'&&!origin.username&&!origin.password;
          }catch{}
          if(!originAllowed){json(res,403,{error:'INVALID_ORIGIN'});return;}
        }
        const token=bearer(req);
        // OAuth-style signed token verification is isolated from the legacy local tokens.
        // A verifier is never allowed to fall back to shared static credentials.
        let role = null;
        if(mcpTokenVerifier){
          try { const identity = mcpTokenVerifier(token); if(identity?.role==='owner'||identity?.role==='agent') role=identity.role; }
          catch { role=null; }
        } else {
          role=safeEqual(token,agentToken)?'agent':safeEqual(token,ownerToken)?'owner':null;
        }
        if(!role){
          if(discovery){
            respond(res,401,JSON.stringify({error:'UNAUTHORIZED'}),'application/json; charset=utf-8',
              {'WWW-Authenticate':discovery.readChallenge});
          } else json(res,401,{error:'UNAUTHORIZED'});
          return;
        }
        if(!(req.headers['content-type']||'').startsWith('application/json')){json(res,415,{error:'JSON_REQUIRED'});return;}
        const accept=req.headers.accept||'';
        if(!accept.includes('application/json')||!accept.includes('text/event-stream')){json(res,406,{error:'MCP_ACCEPT_REQUIRED'});return;}
        const raw=await readLimited(req,32_768);let message;
        try{message=JSON.parse(raw)}catch{json(res,400,{error:'INVALID_JSON'});return;}
        if(message?.method!=='initialize'&&req.headers['mcp-protocol-version']!==MCP_PROTOCOL_VERSION){
          json(res,400,{jsonrpc:'2.0',id:message?.id??null,error:{code:-32001,message:'Unsupported MCP protocol version',data:{supported:[MCP_PROTOCOL_VERSION]}}});return;
        }
        // Tool-level OAuth error metadata informs ChatGPT's linking UI about
        // missing write permission. Permission enforcement remains in dispatch.
        const result=dispatchMcp(store,{space,role,oauth:!!discovery,
          writeChallenge:discovery?.writeChallenge??null},message);
        if(result===null){res.writeHead(202,{'Cache-Control':'no-store'});res.end();return;}
        json(res,200,result);return;
      }

      // In signed-token MCP mode, do NOT leave owner-token login,
      // browser reader, legacy APIs or bearer share URLs exposed as fallbacks.
      // The separately authenticated browser/share implementation must be built
      // and verified before any public hosting.
      if(mcpTokenVerifier) { json(res,404,{error:'NOT_FOUND'});return; }

      if(req.method==='GET'&&/^\/s\/[A-Za-z0-9_-]{43}$/.test(path)){
        const page=store.getSharedPage(path.slice(3));if(!page){text(res,404,'Link unavailable');return;}
        respond(res,200,stylePage(page.title,pageContent(page,true),{shared:true}));return;
      }
      // Avoid an alternate shared-token API write path in token-verifier test mode.
      if(mcpTokenVerifier && path.startsWith('/api/v1/')) { json(res,404,{error:'NOT_FOUND'});return; }
      if(req.method==='POST'&&path==='/api/v1/capture'){
        if(!safeEqual(bearer(req),agentToken)){json(res,401,{error:'UNAUTHORIZED'});return;}
        if(!(req.headers['content-type']||'').startsWith('application/json')){json(res,415,{error:'JSON_REQUIRED'});return;}
        const raw=await readLimited(req,32_768);let payload;
        try{payload=JSON.parse(raw);}catch{json(res,400,{error:'INVALID_JSON'});return;}
        const item=store.capturePage(space,payload);
        json(res,item.action==='created'?201:200,{action:item.action,id:item.id,path:item.path,version:item.version,url:`/w/${space}/${item.path}`,status:'draft'});return;
      }
      if(req.method==='GET'&&path==='/api/v1/pages'){
        if(!(safeEqual(bearer(req),ownerToken)||safeEqual(bearer(req),agentToken))){json(res,401,{error:'UNAUTHORIZED'});return;}
        json(res,200,{space,pages:store.listPages(space).map(p=>({path:p.path,title:p.title,updatedAt:p.updatedAt,version:p.version}))});return;
      }
      if(req.method==='GET'&&path==='/api/v1/search'){
        if(!(safeEqual(bearer(req),ownerToken)||safeEqual(bearer(req),agentToken))){json(res,401,{error:'UNAUTHORIZED'});return;}
        json(res,200,{space,results:store.searchPages(space,u.searchParams.get('q')||'').map(p=>({path:p.path,title:p.title,version:p.version}))});return;
      }
      if(req.method==='GET'&&path.startsWith('/api/v1/page/')){
        if(!(safeEqual(bearer(req),ownerToken)||safeEqual(bearer(req),agentToken))){json(res,401,{error:'UNAUTHORIZED'});return;}
        const page=store.getPage(space,decodeURIComponent(path.slice('/api/v1/page/'.length)));
        if(!page){json(res,404,{error:'NOT_FOUND'});return;}
        json(res,200,{space,page});return;
      }
      if(req.method==='GET'&&path==='/login'){
        respond(res,200,stylePage('Sign in',`<h1>Knowledge</h1><p class="muted">Owner-only preview</p><form method="post" action="/login"><label for="token">Owner token</label><div class="search"><input id="token" name="token" type="password" required autocomplete="off"><button type="submit">Open wiki</button></div></form>`,{shared:true}));return;
      }
      if(req.method==='POST'&&path==='/login'){
        if(!(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded')){text(res,415,'Invalid form');return;}
        const params=new URLSearchParams(await readLimited(req,4096));
        if(!safeEqual(params.get('token'),ownerToken)){text(res,401,'Invalid credentials');return;}
        const cookie=`knowledge_session=${session}; HttpOnly; SameSite=Strict; Path=/`+(secureCookies?'; Secure':'');
        res.writeHead(303,{'Location':'/','Set-Cookie':cookie,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return;
      }
      if(!ownerCookie(req)){if(req.method==='GET'){res.writeHead(303,{Location:'/login','Cache-Control':'no-store'});res.end();return;}json(res,403,{error:'FORBIDDEN'});return;}
      if(req.method==='GET'&&path==='/'){
        const q=u.searchParams.get('q')||'';const pages=q?store.searchPages(space,q):store.listPages(space);
        const cards=pages.map(page=>`<a class="item" href="/w/${space}/${page.path}"><span class="kicker">${escapeHtml(page.path)}</span><strong>${escapeHtml(page.title)}</strong><small>Revision ${page.version} · ${escapeHtml(page.updatedAt.slice(0,10))}</small></a>`).join('');
        const content=`<span class="kicker">PERSONAL KNOWLEDGE</span><h1>Your wiki.</h1><p class="muted">GPT organizes and updates pages. You read, search, and share individual pages by explicit approval.</p><form class="search" action="/" method="get"><label for="q" class="muted">Search pages</label><input id="q" name="q" value="${escapeHtml(q)}" placeholder="Topics, projects, decisions"><button type="submit">Search</button></form><div class="grid">${cards||'<p class="muted">No pages match. An authorized agent can capture the first entry.</p>'}</div><footer>Private by default. This installation is a local preview.</footer>`;
        respond(res,200,stylePage('Your wiki',content,{navigation:navHtml(space)}));return;
      }
      if(req.method==='GET'&&path.startsWith(`/w/${space}/`)){
        const slug=decodeURIComponent(path.slice(`/w/${space}/`.length));
        const page=store.getPage(space,slug);if(!page){text(res,404,'Page not found');return;}
        respond(res,200,stylePage(page.title,pageContent(page),{navigation:navHtml(space)}));return;
      }
      text(res,404,'Not found');
    }catch(error){
      if(error instanceof KnowledgeError){const status=error.code==='NOT_FOUND'?404:['REVIEW_REQUIRED','VERSION_CONFLICT'].includes(error.code)?409:error.code==='QUOTA_EXCEEDED'?413:400;json(res,status,{error:error.code,message:error.message});return;}
      console.error('Knowledge request failed:',error?.message||String(error));
      json(res,500,{error:'SERVER_ERROR'});
    }
  });
}

if(process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href){
  process.umask(0o077);
  const {KNOWLEDGE_DB,KNOWLEDGE_OWNER_TOKEN,KNOWLEDGE_AGENT_TOKEN,KNOWLEDGE_SPACE='personal',KNOWLEDGE_PORT='3189'}=process.env;
  if(!KNOWLEDGE_DB){console.error('KNOWLEDGE_DB is required');process.exit(1);}
  const store=new KnowledgeStore(KNOWLEDGE_DB);
  const server=createKnowledgeServer(store,{ownerToken:KNOWLEDGE_OWNER_TOKEN,agentToken:KNOWLEDGE_AGENT_TOKEN,space:KNOWLEDGE_SPACE});
  server.listen(Number(KNOWLEDGE_PORT),'127.0.0.1',()=>console.log(`Knowledge local preview on http://127.0.0.1:${KNOWLEDGE_PORT}`));
  process.on('SIGTERM',()=>server.close(()=>{store.close();process.exit(0);}));
}
