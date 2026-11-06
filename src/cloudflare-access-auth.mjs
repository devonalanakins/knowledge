/**
 * G9f: Cloudflare Access Managed OAuth origin assertion verification.
 * Access issues an opaque OAuth token to the MCP client and forwards a signed
 * Cf-Access-Jwt-Assertion to the origin. This verifier never trusts the client
 * bearer, raw header text, email or self-asserted scopes as authorization.
 * Cloudflare preview is intentionally read-only.
 */
import { createPublicKey, verify } from 'node:crypto';

const MAX_JWT = 8192;
const ID = /^[A-Za-z0-9_.:@/-]{1,256}$/;
const KID = /^[A-Za-z0-9_.-]{1,128}$/;
const fail = () => { const err = new Error('Cloudflare Access assertion rejected'); err.code='UNAUTHORIZED'; throw err; };
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function b64(value) {
  if(typeof value!=='string'||value.length<2||value.length>MAX_JWT||!/^[A-Za-z0-9_-]+$/.test(value))fail();
  const b=Buffer.from(value,'base64url');
  if(b.toString('base64url')!==value)fail();
  return b;
}
function jsonSegment(value) {
  try {
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b64(value)));
    if(!obj(result)) fail();
    return result;
  } catch { fail(); }
}
function trustedRsa(jwk) {
  if(!obj(jwk)||jwk.kty!=='RSA'||!KID.test(jwk.kid||'')||
     typeof jwk.n!=='string'||typeof jwk.e!=='string'||jwk.d!==undefined||
     jwk.alg!==undefined&&jwk.alg!=='RS256'||
     jwk.use!==undefined&&jwk.use!=='sig')fail();
  let key;
  try{key=createPublicKey({key:jwk,format:'jwk'});}catch{fail();}
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048)fail();
  return key;
}
export function createCloudflareAccessReadVerifier({teamIssuer,appAudience,publicKeys,allowedSubjects,now=()=>Date.now()}={}){
  if(typeof teamIssuer!=='string'||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamIssuer)||
     typeof appAudience!=='string'||!ID.test(appAudience)||
     !Array.isArray(publicKeys)||publicKeys.length<1||publicKeys.length>8||
     !Array.isArray(allowedSubjects)||allowedSubjects.length<1||allowedSubjects.length>100||
     allowedSubjects.some(s=>typeof s!=='string'||!ID.test(s))||
     new Set(allowedSubjects).size!==allowedSubjects.length||typeof now!=='function')fail();
  const keys=new Map();
  for(const jwk of publicKeys){ if(keys.has(jwk?.kid))fail();keys.set(jwk.kid,trustedRsa(jwk)); }
  const subjects=new Set(allowedSubjects);
  return function verifyCloudflareRequest(_opaqueBearerToken,req){
    const token=req?.headers?.['cf-access-jwt-assertion'];
    if(typeof token!=='string'||Buffer.byteLength(token,'utf8')>MAX_JWT)fail();
    const pieces=token.split('.');if(pieces.length!==3)fail();
    const [head,body,signature]=pieces;
    const h=jsonSegment(head),c=jsonSegment(body);
    if(h.alg!=='RS256'||(h.typ!==undefined&&h.typ!=='JWT')||!KID.test(h.kid||'')||
       Object.keys(h).some(k=>!['alg','kid','typ'].includes(k)))fail();
    const key=keys.get(h.kid);if(!key)fail();
    let valid=false;
    try{valid=verify('RSA-SHA256',Buffer.from(head+'.'+body,'ascii'),key,b64(signature));}catch{fail();}
    if(!valid)fail();
    let sec;try{sec=Math.floor(now()/1000);}catch{fail();}
    if(!Number.isSafeInteger(sec)||c.iss!==teamIssuer||
       !(c.aud===appAudience||Array.isArray(c.aud)&&c.aud.includes(appAudience))||
       !subjects.has(c.sub)||!Number.isSafeInteger(c.exp)||!Number.isSafeInteger(c.iat)||
       c.iat>sec+30||c.exp<=sec-30||c.exp<=c.iat||c.exp-c.iat>86400||
       c.nbf!==undefined&&(!Number.isSafeInteger(c.nbf)||c.nbf>sec+30))fail();
    // Identity and app-policy verification cannot imply a Knowledge write grant.
    return Object.freeze({principal:c.sub,role:'owner'});
  };
}