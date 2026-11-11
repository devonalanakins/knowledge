/**
 * Explicit owner-only plaintext Markdown export for a single decrypted record.
 *
 * The calling Worker must check direct Cloudflare Access owner identity before
 * invoking this helper. No background exports, public links or server copies.
 * Downloads are intentionally plaintext on the recipient's own device.
 */
const VALID_PATH=/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,7}$/;
const VALID_NAME=/^[a-z0-9][a-z0-9-]{0,63}$/;
const ENCODER=new TextEncoder();
export function ownerMarkdownDownloadResponse(page){
 if(!page || typeof page.path!=='string' || page.path.length>240 ||
   !VALID_PATH.test(page.path) ||
   !page.path.split('/').every(x=>VALID_NAME.test(x)) ||
   typeof page.body!=='string' || ENCODER.encode(page.body).length>16384 ||
   !Number.isInteger(page.version) || page.version<1 || page.version>128)
   throw new Error('KNOWLEDGE_EXPORT_INVALID_RECORD');
 // Double underscore cannot occur in valid Knowledge paths. The resulting
 // basename is reversible to the original path without exposing it in logs.
 const fileName=page.path.split('/').join('__')+'.md';
 return new Response(page.body,{
   status:200,
   headers:{
     'Content-Type':'text/markdown; charset=utf-8',
     'Content-Disposition':'attachment; filename="'+fileName+'"',
     'Cache-Control':'private, no-store, max-age=0',
     'Content-Security-Policy':"default-src 'none'; script-src 'none'; sandbox",
     'Referrer-Policy':'no-referrer',
     'X-Content-Type-Options':'nosniff',
     'X-Robots-Tag':'noindex, nofollow, noarchive',
     'Cross-Origin-Resource-Policy':'same-origin'
   }
 });
}
