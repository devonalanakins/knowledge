/** Offline, explicitly trusted Ed25519 hierarchy-change receipts.
 * A receipt authenticates ONE proposed parent move, not a Notion migration or
 * the classification of unrelated records.
 */
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';

export const HIERARCHY_RECEIPT_FORMAT='knowledge-hierarchy-approval-v1';
const HEX_ID=/^[a-f0-9]{32}$/;
const SHA=/^[a-f0-9]{64}$/;
const KEY_ID=/^[a-z0-9][a-z0-9-]{2,63}$/;
const SCOPES=new Set(['personal','family','devonstation','anevum','cristy','mizvo','external']);
const FIELDS=['format','signerId','issuedAt','sourceId','scope','sourceSha256','fromParentId','toParentId','toPath','reason'];
function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function clean(x){return typeof x==='string'?x.toLowerCase().replaceAll('-',''):null;}
function parent(x){return x===null?null:clean(x);}
function validParent(x){return x===null||HEX_ID.test(x);}
function canonical(values){
 const r={format:HIERARCHY_RECEIPT_FORMAT};
 for(const key of FIELDS.slice(1))r[key]=values[key];
 if(!KEY_ID.test(r.signerId||'')||!SCOPES.has(r.scope)||!HEX_ID.test(r.sourceId||'')||
    !SHA.test(r.sourceSha256||'')||!validParent(r.fromParentId)||!validParent(r.toParentId)||
    r.fromParentId===r.toParentId||!r.toPath||typeof r.toPath!=='string'||
    r.toPath.length>240||r.toPath.startsWith('/')||
    typeof r.reason!=='string'||r.reason.length<12||r.reason.length>500||
    r.reason.trim()!==r.reason||typeof r.issuedAt!=='string'||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.issuedAt)||
    !Number.isFinite(Date.parse(r.issuedAt))||
    new Date(r.issuedAt).toISOString()!==r.issuedAt)
   throw new TypeError('Invalid hierarchy approval statement');
 return r;
}
function payload(r){return Buffer.from('Knowledge/Notion/hierarchy-approval/v1\n'+JSON.stringify(r),'utf8');}
/** Run only in a protected offline owner workflow; never bundle the private key. */
export function signHierarchyApproval(values,privateKeyPem){
 const statement=canonical(values);
 const key=createPrivateKey(privateKeyPem);
 if(key.asymmetricKeyType!=='ed25519')throw new TypeError('Only Ed25519 signing keys are allowed');
 return {...statement,signature:sign(null,payload(statement),key).toString('base64url')};
}
/**
 * trustedReviewers must be independently provisioned, never provided inside the
 * classification record/receipt. Key rotation and revocation remain operator gates.
 */
export function verifyHierarchyApproval(receipt,expected,trustedReviewers,now=Date.now()){
 try{
  if(!plain(receipt)||!plain(expected)||!plain(trustedReviewers)||
     Object.keys(receipt).length!==FIELDS.length+1||
     ![...FIELDS,'signature'].every(k=>Object.hasOwn(receipt,k))||
     typeof receipt.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)||
     !Number.isFinite(now))return false;
  const statement=canonical(receipt);
  for(const key of ['sourceId','scope','sourceSha256','fromParentId','toParentId','toPath','reason']){
   if(statement[key]!==expected[key])return false;
  }
  if(Date.parse(statement.issuedAt)>now+5*60*1000)return false;
  if(!Object.hasOwn(trustedReviewers,statement.signerId))return false;
  const authority=trustedReviewers[statement.signerId];
  if(!plain(authority)||!Array.isArray(authority.scopes)||
     !authority.scopes.includes(statement.scope)||
     typeof authority.publicKeyPem!=='string')return false;
  const publicKey=createPublicKey(authority.publicKeyPem);
  if(publicKey.asymmetricKeyType!=='ed25519')return false;
  const raw=Buffer.from(receipt.signature,'base64url');
  if(raw.length!==64||raw.toString('base64url')!==receipt.signature)return false;
  return verify(null,payload(statement),publicKey,raw);
 }catch{return false;}
}
