import {readFileSync} from 'node:fs';
import {readCaptureStagingGuard} from '../../src/forward-capture-staging-guard.mjs';
const names=['ingress','processor'];
async function main(){
 if(process.argv.length!==2||process.env.KNOWLEDGE_CAPTURE_STAGING_GUARD_ACK!=='READ_ONLY_STAGING_REVIEW_V1')
  throw Error('KNOWLEDGE_CAPTURE_STAGING_GUARD_UNAVAILABLE');
 const manifests={};
 for(const part of names){
  const file=new URL('./wrangler.capture-'+part+'.staged.json',import.meta.url);
  const doc=JSON.parse(readFileSync(file,'utf8'));
  manifests[doc.name]=doc;
 }
 const report=await readCaptureStagingGuard({
  account:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN,manifests,
 });
 console.log(JSON.stringify(report));
 if(report.status!=='STAGING_METADATA_MATCH')process.exitCode=2;
}
main().catch(()=>{
 console.error('KNOWLEDGE_CAPTURE_STAGING_GUARD_UNAVAILABLE');
 process.exitCode=1;
});
