import {readFileSync} from 'node:fs';
import {readBoundDisabledCapture} from '../../src/forward-capture-bound-guard.mjs';
const prefix='./wrangler.capture-';
function manifest(part){
 const url=new URL(prefix+part+(part==='processor'?'.bound.json':'.staged.json'),import.meta.url);
 return JSON.parse(readFileSync(url,'utf8'));
}
const expectedVersions={
 'knowledge-capture-ingress-private':process.env.KNOWLEDGE_CAPTURE_INGRESS_ACTIVE_VERSION,
 'knowledge-capture-processor-private':process.env.KNOWLEDGE_CAPTURE_PROCESSOR_ACTIVE_VERSION,
 'knowledge-forward-private':process.env.KNOWLEDGE_OWNER_ACTIVE_VERSION,
};
async function main(){
 if(process.argv.length!==2||
  process.env.KNOWLEDGE_CAPTURE_BOUND_GUARD_ACK!=='READ_ONLY_BOUND_DISABLED_V1')
  throw Error('KNOWLEDGE_CAPTURE_BOUND_GUARD_UNAVAILABLE');
 const report=await readBoundDisabledCapture({
  account:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,
  expectedVersions,
  manifests:{
   'knowledge-capture-ingress-private':manifest('ingress'),
   'knowledge-capture-processor-private':manifest('processor'),
  },
 });
 console.log(JSON.stringify(report));
 if(report.status!=='BOUND_DISABLED_MATCH')process.exitCode=2;
}
main().catch(()=>{
 console.error('KNOWLEDGE_CAPTURE_BOUND_GUARD_UNAVAILABLE');
 process.exitCode=1;
});
