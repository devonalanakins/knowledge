/** Authenticated, opaque, short-lived positions for the private forward reader. */
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const SCOPE=/^[a-z][a-z0-9-]{0,63}$/,ID=/^[a-z0-9-]{1,32}$/;
const KEY=/^[A-Za-z0-9_-]{43}$/;
const TTL=24*60*60*1000;
const invalid=()=>Object.assign(new Error('Invalid or expired page cursor; restart from the library'),{code:'INVALID_INPUT'});
function context(scope,keyId){
  if(!SCOPE.test(scope)||!ID.test(keyId))throw invalid();
  return enc.encode('knowledge-page-cursor-v1\0'+scope+'\0'+keyId);
}
function encode(bytes){return btoa(Array.from(bytes,x=>String.fromCharCode(x)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decode(text){
  if(typeof text!=='string'||text.length<40||text.length>512||!/^[A-Za-z0-9_-]+$/.test(text))throw invalid();
  try{
    const out=Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
    if(encode(out)!==text)throw invalid();
    return out;
  }catch{throw invalid();}
}
export async function createPageCursor({key,scope,keyId,after,now=Date.now()}){
  if(!KEY.test(after)||!Number.isSafeInteger(now)||now<0)throw invalid();
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=enc.encode(JSON.stringify({after,expires:now+TTL}));
  const sealed=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context(scope,keyId)},key,bytes));
  const out=new Uint8Array(iv.length+sealed.length);out.set(iv);out.set(sealed,iv.length);
  return encode(out);
}
export async function readPageCursor({key,scope,keyId,cursor,now=Date.now()}){
  try{
    if(!Number.isSafeInteger(now)||now<0)throw invalid();
    const bytes=decode(cursor);
    const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12),additionalData:context(scope,keyId)},key,bytes.subarray(12));
    const p=JSON.parse(dec.decode(raw));
    if(!p||Object.keys(p).length!==2||!KEY.test(p.after)||!Number.isSafeInteger(p.expires)||p.expires<=now||p.expires>now+TTL)throw invalid();
    return p.after;
  }catch{throw invalid();}
}
