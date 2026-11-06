/**
 * Offline, independently trusted Ed25519 approval for ONE Notion parent change.
 * This is not an importer, a durable audit ledger, or cutover authorization.
 */
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';

export const HIERARCHY_RECEIPT_FORMAT='knowledge-hierarchy-approval-v1';
const HEX_ID=/^[a-f0-9]{32}$/;
const SHA=/^[a-f0-9]{64}$/;
const KEY_ID=/^[a-z0-9][a-z0-9-]{2,63}$/;
const SEGMENT=/^[a-z0-9][a-z0-9-]{0,63}$/;
const SCOPES=new Set(['personal','family','devonstation','anevum','cristy','mizvo','external']);
const FIELDS=['format','approvalId','signerId','issuedAt','expiresAt','sourceId','scope','sourceSha256','fromParentId','toParentId','toPath','reason'];
const MAX_AGE_MS=30*24*60*60*1000;
const MAX_CLOCK_SKEW_MS=5*60*1000;
function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function exactIso(x){
 return typeof x==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
  Number.isFinite(Date.parse(x)) && new Date(x).toISOString()===x;
}
function validPath(path){
 return typeof path==='string' && path.length>=1 && path.length<=240 &&
   path.split('/').length<=8 && path.split('/').every(part=>SEGMENT.test(part));
}
function canonical(input){
 if(!plain(input))throw new TypeError('Hierarchy statement must be an object');
 const result={format:HIERARCHY_RECEIPT_FORMAT};
 for(const key of FIELDS.slice(1))result[key]=input[key];
 const start=Date.parse(result.issuedAt),end=Date.parse(result.expiresAt);
 if(!HEX_ID.test(result.approvalId||'')||!KEY_ID.test(result.signerId||'')||
    !SCOPES.has(result.scope)||!HEX_ID.test(result.sourceId||'')||
    !SHA.test(result.sourceSha256||'')||
    !(result.fromParentId===null||HEX_ID.test(result.fromParentId||''))||
    !(result.toParentId===null||HEX_ID.test(result.toParentId||''))||
    result.fromParentId===result.toParentId||result.toParentId===result.sourceId||
    !validPath(result.toPath)||
    typeof result.reason!=='string'||result.reason.trim()!==result.reason||
    result.reason.length<12||result.reason.length>500||
    !exactIso(result.issuedAt)||!exactIso(result.expiresAt)||
    end<=start||end-start>MAX_AGE_MS)
    throw new TypeError('Invalid hierarchy approval statement');
 return result;
}
function payload(r){return Buffer.from('Knowledge/Notion/hierarchy-approval/v1\n'+JSON.stringify(r),'utf8');}

/** Called only in a protected offline approval process; private keys never belong in Git. */
export function signHierarchyApproval(input,privateKeyPem){
 const statement=canonical(input),key=createPrivateKey(privateKeyPem);
 if(key.asymmetricKeyType!=='ed25519')throw new TypeError('Only Ed25519 signing keys are allowed');
 return {...statement,signature:sign(null,payload(statement),key).toString('base64url')};
}
/**
 * trustedReviewers is independently provisioned owner-only metadata, never
 * supplied by the receipt or its classification. A consumed/revoked ID set
 * must come from a durable owner-controlled ledger when importing real data.
 */
export function verifyHierarchyApproval(receipt,expected,trustedReviewers,options={}){
 try{
  if(!plain(receipt)||!plain(expected)||!plain(trustedReviewers)||!plain(options)||
     Object.keys(receipt).length!==FIELDS.length+1||
     ![...FIELDS,'signature'].every(key=>Object.hasOwn(receipt,key))||
     typeof receipt.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(receipt.signature))
    return false;
  const {now=Date.now(),consumedIds=new Set(),revokedIds=new Set()}=options;
  if(!Number.isFinite(now)||!(consumedIds instanceof Set)||!(revokedIds instanceof Set))
    return false;
  const statement=canonical(receipt);
  if(consumedIds.has(statement.approvalId)||revokedIds.has(statement.approvalId))return false;
  if(Date.parse(statement.issuedAt)>now+MAX_CLOCK_SKEW_MS||
     Date.parse(statement.expiresAt)<=now)return false;
  for(const key of ['sourceId','scope','sourceSha256','fromParentId','toParentId','toPath','reason']){
    if(statement[key]!==expected[key])return false;
  }
  if(!Object.hasOwn(trustedReviewers,statement.signerId))return false;
  const authority=trustedReviewers[statement.signerId];
  if(!plain(authority)||authority.enabled!==true||
     !Array.isArray(authority.scopes)||!authority.scopes.includes(statement.scope)||
     typeof authority.publicKeyPem!=='string')return false;
  const publicKey=createPublicKey(authority.publicKeyPem);
  if(publicKey.asymmetricKeyType!=='ed25519')return false;
  const signature=Buffer.from(receipt.signature,'base64url');
  if(signature.length!==64||signature.toString('base64url')!==receipt.signature)return false;
  return verify(null,payload(statement),publicKey,signature);
 }catch{return false;}
}
