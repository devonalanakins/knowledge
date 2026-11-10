/**
 * FICTIONAL only. A process-local fetch shim for executing the checked-in
 * GitHub Actions sender against real Knowledge cryptography and SQLite D1.
 * Never import in production or expose a route.
 */
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {handleGitHubCaptureIngress} from '../../src/worker-cloudflare-capture-ingress.mjs';
import {drainCaptureInbox} from '../../src/worker-cloudflare-capture-processor.mjs';
import {handlePrivateMergeCapture,handlePrivateKnowledgeWorker}
  from '../../src/worker-cloudflare-private.mjs';

class D1 {
  constructor(ddl){this.db=new DatabaseSync(':memory:');this.db.exec(ddl);}
  prepare(sql){return {
    bind:(...params)=>({
      first:async()=>this.db.prepare(sql).get(...params)??null,
      all:async()=>({results:this.db.prepare(sql).all(...params)}),
      run:async()=>({meta:{changes:Number(this.db.prepare(sql).run(...params).changes)}}),
    }),
    first:async()=>this.db.prepare(sql).get()??null,
    all:async()=>({results:this.db.prepare(sql).all()}),
    run:async()=>({meta:{changes:Number(this.db.prepare(sql).run().changes)}}),
  };}
  async batch(statements){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const results=[];for(const statement of statements)results.push(await statement.run());
      this.db.exec('COMMIT');return results;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
}
const inbox=new D1(readFileSync('./ops/private-forward/capture-inbox-v1.sql','utf8'));
const owner=new D1(readFileSync('./ops/private-forward/schema.sql','utf8'));
const host=process.env.KNOWLEDGE_CAPTURE_INGRESS_URL;
const oidcMode=process.env.TEST_OIDC_MODE==='1';
const signing=generateKeyPairSync('rsa',{modulusLength:2048,publicExponent:0x10001});
const jwk={...signing.publicKey.export({format:'jwk'}),kid:'fictional-workflow-oidc-key',
 kty:'RSA',use:'sig',alg:'RS256'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function makeOidcToken(audience){
 const stamp=Math.floor(Date.now()/1000);
 const claims={iss:'https://token.actions.githubusercontent.com',
  aud:audience,sub:'repo:devonalanakins/knowledge:ref:refs/heads/main',
  repository:'devonalanakins/knowledge',repository_id:'1446728034',
  ref:'refs/heads/main',ref_type:'branch',event_name:'push',
  workflow_ref:'devonalanakins/knowledge/.github/workflows/knowledge-merge-delivery.yml@refs/heads/main',
  sha:process.env.GITHUB_SHA,workflow_sha:process.env.GITHUB_SHA,
  repository_visibility:'public',runner_environment:'github-hosted',
  run_id:'1234567',run_attempt:'1',
  iat:stamp-1,nbf:stamp-1,exp:stamp+300};
 const value=b64({alg:'RS256',typ:'JWT',kid:jwk.kid})+'.'+b64(claims);
 return value+'.'+createSign('RSA-SHA256').update(value).sign(signing.privateKey).toString('base64url');
}
const repo='devonalanakins/knowledge',id=1446728034;
const ownerEnv={
  KNOWLEDGE_PRIVATE_WORKER_ACK:'OWNER_ONLY_DRAFTS_NO_IMPORT',
  KNOWLEDGE_PRIVATE_WRITE_ACK:'DRAFT_CAPTURE_ALLOWED',
  KNOWLEDGE_WORKER_RESOURCE:'https://knowledge-contract.example.test/mcp',
  KNOWLEDGE_ACCESS_AUD:'synthetic-access-aud',
  KNOWLEDGE_ACCESS_EMAIL:'synthetic-owner@example.test',
  KNOWLEDGE_SPACE:'personal',KNOWLEDGE_KEY_ID:'owner-v1',
  KNOWLEDGE_DATA_KEY:process.env.TEST_OWNER_KEY,KNOWLEDGE_DB:owner,
  KNOWLEDGE_MACHINE_CAPTURE_ACK:'APPROVED_PERSONAL_GITHUB_MERGE_V1',
  KNOWLEDGE_MACHINE_CAPTURE_KEY_HEX:process.env.TEST_MACHINE_KEY,
  KNOWLEDGE_MACHINE_CAPTURE_REPO_NAME:repo,
  KNOWLEDGE_MACHINE_CAPTURE_REPO_ID:String(id),
  KNOWLEDGE_MACHINE_CAPTURE_PREFIX:'engineering/knowledge',
};
const ingressEnv={
  CAPTURE_INGRESS_ACK:'SIGNED_GITHUB_CAPTURE_INBOX_V1',
  CAPTURE_AUTH_METHOD:oidcMode?'github_oidc_v1':'hmac_v1',
  CAPTURE_INGRESS_URL:host,
  ...(oidcMode?{}:{CAPTURE_WEBHOOK_SECRET:process.env.KNOWLEDGE_CAPTURE_SIGNING_SECRET}),
  CAPTURE_INBOX_ROOT_HEX:process.env.TEST_INBOX_KEY,
  CAPTURE_INBOX_KEY_ID:'inbox-v1',
  CAPTURE_INBOX_DB:inbox,
  CAPTURE_REPOSITORIES_JSON:JSON.stringify({
    [repo]:{repoId:id,scope:'personal',pathPrefix:'engineering/knowledge'},
  }),
};
const processorEnv={
  CAPTURE_PROCESSOR_ACK:'OWNER_ONLY_SIGNED_MERGE_PROCESSOR_V1',
  CAPTURE_INBOX_ROOT_HEX:process.env.TEST_INBOX_KEY,
  CAPTURE_INBOX_KEY_ID:'inbox-v1',
  CAPTURE_MACHINE_AUTH_KEY_HEX:process.env.TEST_MACHINE_KEY,
  CAPTURE_INBOX_DB:inbox,
  KNOWLEDGE_CAPTURE_WRITER:{
    saveMergeReceipt:async payload=>handlePrivateMergeCapture(ownerEnv,payload,payload.issuedAt),
  },
};
let receipt={status:'NOT_DISPATCHED'};
globalThis.fetch=async(url,options)=>{
  if(url.startsWith('https://pipelines.actions.githubusercontent.com/oidc')){
    const audience=new URL(url).searchParams.get('audience');
    if(!audience)throw Error('Synthetic OIDC request has no audience');
    return new Response(JSON.stringify({value:makeOidcToken(audience)}),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(url==='https://token.actions.githubusercontent.com/.well-known/jwks'){
    return new Response(JSON.stringify({keys:[jwk]}),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(url==='https://api.github.com/repos/devonalanakins/knowledge/pulls/45'){
    const pr=JSON.parse(process.env.TEST_ASSOCIATED_PRS||'[]')[0];
    return new Response(JSON.stringify({...pr,
      merged:process.env.TEST_AUTHORITY_MERGED!=='false'}),
      {status:200,headers:{'Content-Type':'application/json'}});
  }
  if(url.startsWith('https://api.github.com/repos/')){
    return {status:Number(process.env.TEST_API_STATUS||200),
      json:async()=>JSON.parse(process.env.TEST_ASSOCIATED_PRS||'[]')};
  }
  const send=()=>handleGitHubCaptureIngress(new Request(url,{
    method:options.method,headers:options.headers,body:options.body,
  }),ingressEnv);
  const first=await send();
  if(first.status===202){
    const duplicate=await send();
    const modified=JSON.stringify({...JSON.parse(options.body),number:999});
    const tampered=await handleGitHubCaptureIngress(new Request(url,{
      method:options.method,headers:options.headers,body:modified,
    }),ingressEnv);
    const processed=await drainCaptureInbox(processorEnv,{now:Date.now()+1000});
    const saved=inbox.db.prepare('SELECT state,attempts,sealed FROM knowledge_capture_inbox').all();
    const pages=owner.db.prepare('SELECT path_key,version,sealed FROM knowledge_pages').all();
    const revisions=owner.db.prepare('SELECT path_key,version,sealed FROM knowledge_revisions').all();
    const response=await handlePrivateKnowledgeWorker(new Request(
      'https://knowledge-contract.example.test/mcp',{
        method:'POST',headers:{
          'Content-Type':'application/json',
          'Accept':'application/json, text/event-stream',
          'MCP-Protocol-Version':'2025-11-25',
        },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
          params:{name:'knowledge_read',arguments:{path:'engineering/knowledge/pr-45'}}}),
      }),ownerEnv,{
        access:{aud:'synthetic-access-aud',
          getIdentity:async()=>({email:'synthetic-owner@example.test'})},
      });
    const readback=(await response.json())?.result?.structuredContent?.page??null;
    receipt={
      status:'SYNTHETIC_CAPTURE_COMPLETED',ingress:first.status,
      duplicate:duplicate.status,tampered:tampered.status,
      processed,queueSize:saved.length,queueState:saved[0]?.state,
      queueAttempts:saved[0]?.attempts,
      encryptedQueueHasPrivateText:/UNTRUSTED|PRIVATE BODY|engineering\/knowledge|devonalanakins/.test(
        JSON.stringify(saved)),
      ownerPages:pages.length,ownerRevisions:revisions.length,
      encryptedOwnerHasPrivateText:/UNTRUSTED|PRIVATE BODY|engineering\/knowledge|devonalanakins/.test(
        JSON.stringify(pages)),
      headMatchesRevision:pages.length===1&&revisions.length===1&&
        pages[0].path_key===revisions[0].path_key&&
        pages[0].sealed===revisions[0].sealed,
      readback:{path:readback?.path,version:readback?.version,
        status:readback?.status,bodyHasUntrusted:/UNTRUSTED|PRIVATE BODY/.test(readback?.body||''),
        sourceUrl:readback?.sourceUrl},
    };
  }else receipt={status:'REJECTED',httpStatus:first.status};
  return first;
};
process.on('beforeExit',()=>{
  console.log('KNOWLEDGE_WIRE_CONTRACT:'+JSON.stringify(receipt));
  inbox.db.close();owner.db.close();
});
