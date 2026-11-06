#!/usr/bin/env node
/**
 * G18 — explicit, read-only Notion API metadata inventory.
 * Output: encrypted owner-local snapshot. No Notion writes or page bodies.
 */
import {lstat,realpath,readFile,writeFile,mkdtemp,chmod,link,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateJson} from './organization-review-cli.mjs';
import {createReadOnlyNotionClient,enumerateNotionSourceMetadata} from './notion-api-source.mjs';
import {encryptSnapshot,decryptSnapshot} from './backup.mjs';

const CONFIG_FORMAT='knowledge-notion-api-source-config-v1';
function fail(code,message){const e=new Error(message);e.code=code;throw e}
export async function writeEncryptedNotionApiInventory({
 configFile,outputFile,token,passphrase,client=null,
}={}){
 if(typeof configFile!=='string'||!configFile.trim()||
   typeof outputFile!=='string'||!outputFile.endsWith('.enc'))
   fail('INVALID_ARGS','Explicit config JSON and .enc output paths required');
 const input=resolve(configFile),dest=resolve(outputFile),parent=dirname(dest);
 if(input===dest)fail('UNSAFE_OUTPUT','Config and output cannot be the same file');
 const st=await lstat(parent);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
   (typeof process.getuid==='function'&&st.uid!==process.getuid())||
   await realpath(parent)!==parent)
   fail('UNSAFE_OUTPUT','Output must be inside a private real directory');
 try{await lstat(dest);fail('ALREADY_EXISTS','Encrypted inventory already exists')}
 catch(error){if(error.code!=='ENOENT')throw error}
 const config=await privateJson(input);
 if(config?.format!==CONFIG_FORMAT||!Array.isArray(config.registers)||
   Object.keys(config).some(key=>!['format','registers'].includes(key)))
   fail('INVALID_CONFIG','Unsupported owner-controlled data source configuration');
 // Token is separate from the source-config JSON; do not persist or log it.
 const sourceClient=client??createReadOnlyNotionClient({token});
 const inventory=await enumerateNotionSourceMetadata({
   client:sourceClient,registers:config.registers,allowMetadataOnly:true});
 const envelope=encryptSnapshot(inventory,passphrase);
 const temp=await mkdtemp(join(parent,'.knowledge-notion-api-'));
 try{
   await chmod(temp,0o700);
   const draft=join(temp,'inventory.enc');
   await writeFile(draft,JSON.stringify(envelope)+'\n',{flag:'wx',mode:0o600});
   const saved=JSON.parse(await readFile(draft,'utf8'));
   const checked=decryptSnapshot(saved,passphrase);
   if(checked.format!==inventory.format||
     checked.identityFingerprint!==inventory.identityFingerprint||
     checked.records.length!==inventory.records.length)
     fail('ARCHIVE_MISMATCH','Encrypted inventory restoration failed');
   await link(draft,dest); // create-only, no replacement
 }finally{await rm(temp,{recursive:true,force:true})}
 return {format:inventory.format,encryptedInventoryWritten:true,
   registerCounts:inventory.counts,uniqueSourceRecords:inventory.uniqueSourceRecords,
   warningCount:inventory.warnings.length,
   sourceCoverageCertified:false,sourcePermissionsCertified:false,
   realDataImported:false,cutoverApproved:false};
}
export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==2)fail('INVALID_ARGS',
   'Usage: notion:api:inventory PRIVATE_SOURCE_CONFIG.json OUTPUT.enc');
 process.umask(0o077);
 const report=await writeEncryptedNotionApiInventory({
   configFile:args[0],outputFile:args[1],token:env.NOTION_API_TOKEN,
   passphrase:env.KNOWLEDGE_BACKUP_PASSPHRASE});
 process.stdout.write(JSON.stringify(report)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(e=>{
   // Never serialize Notion tokens, source content, or IDs in CLI errors.
   process.stderr.write((typeof e.code==='string'?e.code:'INVENTORY_FAILED')+
     ': Read-only Notion metadata inventory failed; verify private configuration and permissions\n');
   process.exitCode=1;
 });
}
