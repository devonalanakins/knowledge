#!/usr/bin/env node
/**
 * G23 — explicitly gated, private read-only Notion source metadata probe.
 * Requires a separately scoped Notion token and an owner-reviewed nonclinical
 * sample. No file is published or modified, including the reserved output.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateJson} from './organization-review-cli.mjs';
import {readProtectedEnvelope} from './notion-content-cli.mjs';
import {decryptSnapshot} from './backup.mjs';
import {createReadOnlyNotionClient} from './notion-api-source.mjs';
import {preflightNotionCapture} from './notion-capture-preflight.mjs';
import {probeSelectedNotionSource} from './notion-live-source-probe.mjs';

function reject(code,message){const e=new Error(message);e.code=code;throw e;}
function check(ok,code,message){if(!ok)reject(code,message);}

/**
 * The two opt-ins are operator assertions, not independently verified access
 * control or clinical/third-party content screening. A real private runner
 * still needs external DNS/egress restrictions and owner permission review.
 */
export async function runProtectedNotionSourceProbe({
 inventoryFile,selectionFile,outputFile,passphrase,token,
 allowLiveRead=false,operatorReviewedNonclinicalSample=false,client=null,
}={}){
 check(allowLiveRead===true,'SOURCE_PROBE_NOT_AUTHORIZED',
   'A live source-read opt-in is required');
 check(operatorReviewedNonclinicalSample===true,'NONCLINICAL_REVIEW_REQUIRED',
   'A separately reviewed nonclinical sample is required');
 const preflight=await preflightNotionCapture({
   inventoryFile,selectionFile,outputFile,passphrase,token,
 });
 check(preflight.localPreflightPassed===true,'NOTION_TOKEN_REQUIRED',
   'A separately scoped private Notion token is required');
 const [envelope,selection]=await Promise.all([
   readProtectedEnvelope(resolve(inventoryFile)),
   privateJson(resolve(selectionFile)),
 ]);
 const inventory=decryptSnapshot(envelope,passphrase);
 const readOnlyClient=client??createReadOnlyNotionClient({token});
 const result=await probeSelectedNotionSource({
   inventory,selection,client:readOnlyClient,allowRead:true,
 });
 return {
   ...result,
   protectedOfflinePreflightPassed:true,
   protectedInputsVerified:true,
   outputReservationChecked:true,
   operatorNonclinicalReviewAsserted:true,
   operatorReadOnlyProbeOptInReceived:true,
   // This code does not independently verify the operator assertions.
   independentSensitivityReviewCertified:false,
   independentNetworkControlsCertified:false,
   realSourceCaptureAuthorized:false,
   contentArchivePublished:false,productionReady:false,cutoverApproved:false,
 };
}
export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==3)reject('INVALID_ARGS',
   'Usage: notion:api:probe-source INVENTORY.enc SELECTION.json RESERVED_OUTPUT.enc');
 process.umask(0o077);
 const report=await runProtectedNotionSourceProbe({
   inventoryFile:args[0],selectionFile:args[1],outputFile:args[2],
   passphrase:env.KNOWLEDGE_BACKUP_PASSPHRASE,
   token:env.NOTION_API_TOKEN,
   allowLiveRead:env.KNOWLEDGE_LIVE_NOTION_METADATA_PROBE==='I_APPROVE',
   operatorReviewedNonclinicalSample:
     env.KNOWLEDGE_NONCLINICAL_SAMPLE_REVIEWED==='YES',
 });
 process.stdout.write(JSON.stringify(report)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
   const code=typeof error.code==='string'&&/^[A-Z_]{3,50}$/.test(error.code)?
     error.code:'SOURCE_PROBE_FAILED';
   process.stderr.write(code+
    ': Protected read-only source probe failed; no source was modified\n');
   process.exitCode=1;
 });
}
