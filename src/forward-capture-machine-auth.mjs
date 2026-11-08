/**
 * Separate, narrow, time-bounded machine identity for a non-public
 * Cloudflare service-binding RPC. NOT the owner Access identity or data key.
 */
const encoder=new TextEncoder();
const FORMAT='knowledge-signed-merge-rpc-v1';
const MAX_SKEW_MS=300_000;
const PROOF=/^[A-Za-z0-9_-]{43}$/;
function bytes(hex){
 if(typeof hex!=='string'||!/^[0-9a-f]{64}$/.test(hex))
  throw Error('MACHINE_KEY_UNAVAILABLE');
 return Uint8Array.from(hex.match(/.{2}/g),p=>parseInt(p,16));
}
function base64url(raw){
 let s='';for(const b of raw)s+=String.fromCharCode(b);
 return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function decode(value){
 if(typeof value!=='string'||!PROOF.test(value))return null;
 try{
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='),
   x=>x.charCodeAt(0));
 }catch{return null;}
}
async function hmacKey(keyHex){
 const raw=bytes(keyHex);
 try{return await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
 finally{raw.fill(0);}
}
function message(candidate,issuedAt){
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
    !Number.isSafeInteger(issuedAt)||issuedAt<0)throw Error('INVALID_MACHINE_REQUEST');
 const json=JSON.stringify({format:FORMAT,issuedAt,candidate});
 if(encoder.encode(json).byteLength>16384)throw Error('INVALID_MACHINE_REQUEST');
 return encoder.encode(json);
}
/** Only the separately bound processor should call this. */
export async function signCaptureReceipt(candidate,secretHex,issuedAt=Date.now()){
 const key=await hmacKey(secretHex);
 const payload=message(candidate,issuedAt);
 return {issuedAt,proof:base64url(new Uint8Array(
  await crypto.subtle.sign('HMAC',key,payload)))};
}
/** Verification is constant-time over the signed message bytes. */
export async function verifyCaptureReceiptProof({candidate,issuedAt,proof,secretHex,now=Date.now()}){
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(issuedAt)||
    Math.abs(now-issuedAt)>MAX_SKEW_MS)return false;
 const given=decode(proof);
 if(!given||given.length!==32)return false;
 try{
  const key=await hmacKey(secretHex);
  return await crypto.subtle.verify('HMAC',key,given,message(candidate,issuedAt));
 }catch{return false;}
}
