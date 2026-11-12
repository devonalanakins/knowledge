/** Owner-only home-screen identity. No service worker, offline cache or public page
 * is enabled here. All assets are routed through the SAME Cloudflare Access gate
 * as private Knowledge pages, and contain NO private record metadata.
 */
import {KNOWLEDGE_NEURAL_K_LOCKED_PATH} from './forward-neural-k.mjs';
import {knowledgeTouchPng} from './forward-apple-touch-icon.mjs';

const TILE='#0b2126';
const NAME='Knowledge';
export function knowledgeAppManifest(){
 return {
   id:'/wiki',name:NAME,short_name:NAME,
   description:'A protected workspace for records, documents and files.',
   start_url:'/wiki/explore',scope:'/wiki',display:'standalone',
   background_color:'#081418',theme_color:TILE,lang:'en',
   categories:['productivity'],
   icons:[{src:'/wiki/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}],
   shortcuts:[
     {name:'Browse records',short_name:'Browse',url:'/wiki/explore'},
     {name:'Search records',short_name:'Search',url:'/wiki-find'},
   ],
 };
}
/** Transparent, scriptless vector using the exact locked primary brand geometry. */
export function knowledgeAppIconSvg(){
 return '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title">'+
   '<title id="title">Knowledge</title>'+
   '<rect width="512" height="512" rx="104" fill="'+TILE+'"/>'+
   '<defs><linearGradient id="knowledge-icon-gradient" x1="4%" y1="4%" x2="85%" y2="100%">'+
   '<stop offset="0" stop-color="#a4ffd8"/><stop offset=".38" stop-color="#81f4ca"/>'+
   '<stop offset=".67" stop-color="#57d7b4"/><stop offset="1" stop-color="#26aca2"/></linearGradient></defs>'+
   '<g transform="translate(112 82) scale(.65) translate(-162 -119)">'+
   '<path d="'+KNOWLEDGE_NEURAL_K_LOCKED_PATH+'" fill="url(#knowledge-icon-gradient)"/></g></svg>';
}
const ASSET_HEADERS={
 'Cache-Control':'private, no-store, max-age=0',
 'Content-Security-Policy':"default-src 'none'; script-src 'none'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'",
 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',
 'X-Robots-Tag':'noindex, nofollow, noarchive',
 'Cross-Origin-Resource-Policy':'same-origin',
};
export function knowledgeAppAssetResponse(asset){
 if(asset==='manifest')return new Response(JSON.stringify(knowledgeAppManifest()),{
    status:200,headers:{...ASSET_HEADERS,'Content-Type':'application/manifest+json; charset=utf-8'}
 });
 if(asset==='icon')return new Response(knowledgeAppIconSvg(),{
    status:200,headers:{...ASSET_HEADERS,'Content-Type':'image/svg+xml; charset=utf-8'}
 });
 if(asset==='apple-icon')return new Response(knowledgeTouchPng(),{
    status:200,headers:{...ASSET_HEADERS,'Content-Type':'image/png'}
 });
 return new Response('Not found',{status:404,headers:{...ASSET_HEADERS,'Content-Type':'text/plain; charset=utf-8'}});
}
