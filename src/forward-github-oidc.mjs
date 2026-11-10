/**
 * Verify a short-lived GitHub Actions OIDC identity assertion.
 *
 * No static Actions-to-Cloudflare shared secret is required. The JWT's
 * RS256 signature, exact audience, immutable repository ID, main ref and
 * trusted workflow path are verified BEFORE any event is trusted.
 * All GitHub merge facts are separately confirmed by GitHub's REST API.
 */
const ISSUER='https://token.actions.githubusercontent.com';
const JWKS=ISSUER+'/.well-known/jwks';
const MAX_JWT=8192;
const MAX_JWKS=65536;
const SKEW=60;
const MAX_TTL=900;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA=/^[0-9a-f]{40}$/;
const BASE64URL=/^[A-Za-z0-9_-]+$/;
const decoder=new TextDecoder('utf-8',{fatal:true});
const fail=code=>{const e=new Error('KNOWLEDGE_GITHUB_OIDC_'+code);e.code=code;throw e;};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function decode(part,maxBytes){
 if(typeof part!=='string'||!part||part.length>maxBytes*2||!BASE64URL.test(part))fail('INVALID');
 try{
  const bytes=Uint8Array.from(atob(part.replaceAll('-','+').replaceAll('_','/')+
   '='.repeat((4-part.length%4)%4)),c=>c.charCodeAt(0));
  if(bytes.length>maxBytes)fail('INVALID');
  return bytes;
 }catch{fail('INVALID');}
}
function json(part,maxBytes){
 try{
  const value=JSON.parse(decoder.decode(decode(part,maxBytes)));
  if(!obj(value))fail('INVALID');
  return value;
 }catch{fail('INVALID');}
}
async function readJwks(fetchImpl){
 let response;
 try{
  response=await fetchImpl(JWKS,{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
   headers:{Accept:'application/json','Cache-Control':'no-store'},
  });
 }catch{fail('UNAVAILABLE');}
 if(response?.status!==200||
    !/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||''))
  fail('UNAVAILABLE');
 const size=response.headers.get('content-length');
 if(size&&/^\d+$/.test(size)&&Number(size)>MAX_JWKS)fail('UNAVAILABLE');
 if(!response.body?.getReader)fail('UNAVAILABLE');
 let length=0;const chunks=[];
 try{
  const reader=response.body.getReader();
  for(;;){
   const {value,done}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))fail('UNAVAILABLE');
   length+=value.length;
   if(length>MAX_JWKS){await reader.cancel().catch(()=>{});fail('UNAVAILABLE');}
   chunks.push(value);
  }
 }catch{fail('UNAVAILABLE');}
 if(!length)fail('UNAVAILABLE');
 const bytes=new Uint8Array(length);
 let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.length;}
 try{
  const value=JSON.parse(decoder.decode(bytes));
  if(!obj(value)||!Array.isArray(value.keys)||
     value.keys.length===0||value.keys.length>40)fail('UNAVAILABLE');
  return value.keys;
 }catch{fail('UNAVAILABLE');}
}
function claimsAllowed(c,{audience,repositories,now}){
 if(c.iss!==ISSUER||c.aud!==audience||
    c.sub!=='repo:'+c.repository+':ref:refs/heads/main'||
    typeof c.repository!=='string'||!REPO.test(c.repository)||
    !obj(repositories)||!Object.hasOwn(repositories,c.repository)||
    String(repositories[c.repository]?.repoId)!==c.repository_id||
    repositories[c.repository]?.scope!=='personal'||
    c.ref!=='refs/heads/main'||c.ref_type!=='branch'||
    c.event_name!=='push'||
    c.workflow_ref!==
      c.repository+'/.github/workflows/knowledge-merge-delivery.yml@refs/heads/main'||
    !SHA.test(c.sha??'')||!SHA.test(c.workflow_sha??'')||
    c.repository_visibility!=='public'||
    !/^[1-9]\d{0,19}$/.test(c.run_id??'')||
    !/^[1-9]\d{0,8}$/.test(c.run_attempt??'')||
    c.runner_environment!=='github-hosted'||
    !Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||
    !Number.isSafeInteger(c.nbf)||
    c.exp<=c.iat||c.exp-c.iat>MAX_TTL||
    c.nbf>now+SKEW||c.iat>now+SKEW||c.exp<=now-SKEW||
    now-c.iat>MAX_TTL+SKEW)fail('CLAIMS_REJECTED');
}
export async function verifyGithubActionsOidcToken({
 token,audience,repositories,fetchImpl=fetch,now=Math.floor(Date.now()/1000),
}={}){
 if(typeof token!=='string'||token.length<128||token.length>MAX_JWT||
    typeof audience!=='string'||audience.length>512||
    !/^https:\/\/[^\s]+\/github#sha256=[0-9a-f]{64}$/.test(audience)||!obj(repositories)||
    !Number.isSafeInteger(now)||typeof fetchImpl!=='function')fail('INVALID');
 const parts=token.split('.');
 if(parts.length!==3)fail('INVALID');
 const [headerPart,payloadPart,sigPart]=parts;
 const header=json(headerPart,1024),claims=json(payloadPart,4096);
 if(header.alg!=='RS256'||header.typ!=='JWT'||
    typeof header.kid!=='string'||!header.kid||header.kid.length>256)
  fail('INVALID');
 // Cheap reject before JWKS network request; never trust claims until signed.
 claimsAllowed(claims,{audience,repositories,now});
 const publicKeys=await readJwks(fetchImpl);
 const matching=publicKeys.filter(k=>obj(k)&&k.kid===header.kid&&
  k.kty==='RSA'&&(k.use===undefined||k.use==='sig')&&
  (k.alg===undefined||k.alg==='RS256')&&
  typeof k.n==='string'&&k.n.length>=300&&k.n.length<1000&&
  typeof k.e==='string'&&k.e.length<=12);
 if(matching.length!==1)fail('SIGNATURE_REJECTED');
 let verified=false;
 try{
  const key=await crypto.subtle.importKey('jwk',{
   kty:'RSA',n:matching[0].n,e:matching[0].e,alg:'RS256',ext:true,
   key_ops:['verify'],
  },{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
   key,decode(sigPart,1024),new TextEncoder().encode(headerPart+'.'+payloadPart));
 }catch{fail('SIGNATURE_REJECTED');}
 if(!verified)fail('SIGNATURE_REJECTED');
 return Object.freeze({repository:claims.repository,repositoryId:Number(claims.repository_id),
  pushSha:claims.sha,workflowRef:claims.workflow_ref});
}
