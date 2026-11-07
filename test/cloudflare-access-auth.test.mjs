import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign,randomBytes } from 'node:crypto';
import { createCloudflareAccessReadVerifier } from '../src/cloudflare-access-auth.mjs';
const kp=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...kp.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256'};
const issuer='https://demo.cloudflareaccess.com',audience='test-application-uid',subject='fictional-user';
const opts={teamIssuer:issuer,appAudience:audience,publicKeys:[key],allowedSubjects:[subject]};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(claims={},header={}){
 const now=Math.floor(Date.now()/1000);
 const h=enc({alg:'RS256',kid:'test-key',...header});
 const payload=enc({iss:issuer,aud:[audience],sub:subject,iat:now-10,exp:now+300,...claims});
 const data=h+'.'+payload;
 return data+'.'+sign('RSA-SHA256',Buffer.from(data),kp.privateKey).toString('base64url');
}
const req=token=>({headers:{'cf-access-jwt-assertion':token}});
test('G9f authentic signed Access assertions grant read only',()=>{
 const verify=createCloudflareAccessReadVerifier(opts);
 assert.deepEqual(verify('opaque-client-bearer',req(jwt())),{principal:subject,role:'owner'});
 assert.equal(verify(null,req(jwt({scope:'knowledge.read knowledge.write',role:'admin'}))).role,'owner');
 assert.equal(verify(null,req(jwt({groups:['editor']},{typ:'JWT'}))).role,'owner');
});
test('G9f malformed, expired or wrong-tenant assertions fail closed',()=>{
 const verify=createCloudflareAccessReadVerifier(opts);
 for(const claims of [{iss:'https://other.cloudflareaccess.com'},{aud:['other']},{sub:'unauthorized'},
   {exp:1},{iat:Math.floor(Date.now()/1000)+200},{nbf:Math.floor(Date.now()/1000)+200},
   {exp:Math.floor(Date.now()/1000)+200000}])
   assert.throws(()=>verify('',req(jwt(claims))),{code:'UNAUTHORIZED'});
 assert.throws(()=>verify(null,{headers:{}}),{code:'UNAUTHORIZED'});
 assert.throws(()=>verify(null,req('bogus')),{code:'UNAUTHORIZED'});
});
test('G9f rejects unknown signing key, forged signature and JOSE header injection',()=>{
 const verify=createCloudflareAccessReadVerifier(opts);
 const token=jwt();
 assert.throws(()=>verify('',req(token.slice(0,-3)+'abc')),{code:'UNAUTHORIZED'});
 for(const h of [{alg:'none'},{typ:'at+jwt'},{jku:'https://malicious.example/jwks'},{kid:'unknown'}])
   assert.throws(()=>verify('',req(jwt({},h))),{code:'UNAUTHORIZED'});
});
test('G9f rejects private keys, duplicate KIDs, invalid issuers and principal configuration',()=>{
 for(const config of [
   {...opts,publicKeys:[{...kp.privateKey.export({format:'jwk'}),kid:'private'}]},
   {...opts,publicKeys:[key,key]},
   {...opts,teamIssuer:'https://malicious.example'},
   {...opts,allowedSubjects:[]},
 ]) assert.throws(()=>createCloudflareAccessReadVerifier(config),{code:'UNAUTHORIZED'});
});
