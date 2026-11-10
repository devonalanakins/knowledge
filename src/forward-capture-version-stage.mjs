/**
 * Narrow, version-only Cloudflare capture upload gate.
 * This does not deploy, change triggers, configure credentials, or enable capture.
 *
 * A separate read-only provider guard must attest both existing disabled
 * Workers before and after any upload. Require an owner-selected rollback
 * version, so a concurrent deployment cannot silently change the baseline.
 */
import {attestCaptureUploadedVersion} from './forward-capture-version-attestation.mjs';
export const VERSION_STAGE_ACK='OWNER_APPROVED_NONPUBLIC_CAPTURE_VERSION_UPLOAD_V1';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARTS=Object.freeze({
  ingress:{
    name:'knowledge-capture-ingress-private',
    main:'../../src/worker-cloudflare-capture-ingress.mjs',
    config:'ops/private-forward/wrangler.capture-ingress.staged.json',
  },
  processor:{
    name:'knowledge-capture-processor-private',
    main:'../../src/worker-cloudflare-capture-processor.mjs',
    config:'ops/private-forward/wrangler.capture-processor.staged.json',
  },
});
const EXPECTED_NAMES=Object.values(PARTS).map(x=>x.name).sort().join(',');
function reject(code='NOT_READY'){throw Error('KNOWLEDGE_CAPTURE_VERSION_STAGE_'+code);}
const own=x=>x&&typeof x==='object'&&!Array.isArray(x);

function validateInventory(inventory){
  if(!own(inventory)||inventory.status!=='STAGING_METADATA_MATCH'||
    inventory.deploymentAuthorized!==false||inventory.liveCaptureVerified!==false||
    !Array.isArray(inventory.findings)||inventory.findings.length!==0||
    !own(inventory.rollbackVersions)||
    Object.keys(inventory.rollbackVersions).sort().join(',')!==EXPECTED_NAMES)
    reject();
  for(const [name,version] of Object.entries(inventory.rollbackVersions))
    if(typeof name!=='string'||!ID.test(version))reject();
  return inventory.rollbackVersions;
}

export function planCaptureVersionUpload({
  component,ack,expectedActiveVersion,manifests,inventory,
}={}){
  if(ack!==VERSION_STAGE_ACK||!Object.hasOwn(PARTS,component??'')||
    typeof expectedActiveVersion!=='string'||!ID.test(expectedActiveVersion)||
    !own(manifests)||Object.keys(manifests).sort().join(',')!==EXPECTED_NAMES)
    reject();
  const part=PARTS[component];
  const config=manifests[part.name];
  if(!own(config)||config.name!==part.name||config.main!==part.main||
    config.workers_dev!==false||config.preview_urls!==false||
    Object.keys(config).sort().join(',')!==
      ['$schema','compatibility_date','d1_databases','main','name',
       'preview_urls','workers_dev'].sort().join(','))
    reject('MANIFEST_DRIFT');
  // The staging guard verifies remote state; the planned manifest itself
  // must also be pinned before an upload can even be considered.
  const db=config.d1_databases;
  if(config.compatibility_date!=='2026-11-07'||
    !Array.isArray(db)||db.length!==1||
    Object.keys(db[0]).sort().join(',')!=='binding,database_id,database_name'||
    db[0].binding!=='CAPTURE_INBOX_DB'||
    db[0].database_name!=='knowledge-capture-inbox-private'||
    db[0].database_id!=='147ab931-7675-43b2-a8fc-eba2a2b72545')
    reject('MANIFEST_DRIFT');
  const versions=validateInventory(inventory);
  if(versions[part.name]!==expectedActiveVersion)
    reject('BASELINE_CHANGED');
  return Object.freeze({
    component,
    name:part.name,
    expectedActiveVersion,
    command:'npm',
    args:Object.freeze(['exec','--yes','--package=wrangler@4.68.0','--',
      'wrangler','versions','upload','--keep-vars','--strict','--config',part.config]),
    deploymentAuthorized:false,
    liveCaptureVerified:false,
  });
}

/**
 * Dependencies are injected to permit synthetic verification without
 * credentials or network access in public CI.
 */
export async function stageCaptureVersion({
  component,ack,expectedActiveVersion,manifests,inspect,upload,
  captureVersionIds,inspectVersion,
}={}){
  if(typeof inspect!=='function'||typeof upload!=='function'||
     typeof captureVersionIds!=='function'||typeof inspectVersion!=='function')reject();
  const before=await inspect();
  const plan=planCaptureVersionUpload({
    component,ack,expectedActiveVersion,manifests,inventory:before,
  });
  const versions=before.rollbackVersions;
  // Fail before any write if provider version inventory is unavailable.
  let beforeIds;
  try{beforeIds=await captureVersionIds(component);}catch{reject('VERSION_INVENTORY_UNAVAILABLE');}
  let completed;
  try{completed=await upload(plan);}
  catch{reject('UPLOAD_FAILED');}
  if(completed?.status!==0)reject('UPLOAD_FAILED');

  // A staged version is not an active deployment. Verify that no active
  // route, cron, binding or rollback version changed while we uploaded.
  let after;
  try{after=await inspect();validateInventory(after);}
  catch{reject('POSTUPLOAD_UNVERIFIED');}
  if(Object.entries(versions).some(([name,id])=>after.rollbackVersions[name]!==id))
    reject('ACTIVE_DEPLOYMENT_CHANGED');
  let attested;
  try{
    const afterIds=await captureVersionIds(component);
    const old=new Set(beforeIds);
    const fresh=afterIds.filter(id=>!old.has(id));
    // Do not inspect or report a non-unique, ambiguous candidate.
    if(fresh.length!==1)reject('PROVIDER_VERSION_UNVERIFIED');
    const metadata=await inspectVersion(component,fresh[0]);
    attested=attestCaptureUploadedVersion({
      component,beforeIds,afterIds,metadata,
    });
  }catch{reject('PROVIDER_VERSION_UNVERIFIED');}
  return {
    status:'VERSION_STAGED_PROVIDER_ATTESTED_ACTIVE_UNCHANGED',
    name:plan.name,
    stagedVersionId:attested.versionId,
    activeVersionUnchanged:expectedActiveVersion,
    deploymentAuthorized:false,
    liveCaptureVerified:false,
  };
}
