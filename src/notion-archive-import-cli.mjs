#!/usr/bin/env node
/**
 * Build a NEW offline Knowledge wiki from an owner-controlled extracted
 * Notion Markdown+CSV export. Real content stays in private filesystem.
 * This never writes to Notion, GitHub, or an existing Knowledge database.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateJson} from './organization-review-cli.mjs';
import {importExtractedNotionExport} from './notion-archive-import.mjs';

function reject(code,message){const e=new Error(message);e.code=code;throw e;}
export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==3)reject('INVALID_ARGS',
  'Usage: notion:import:private EXTRACTED_EXPORT PRIVATE_SCOPE_MAP.json NEW_KNOWLEDGE_FOLDER');
 if(env.KNOWLEDGE_PRIVATE_EXPORT_IMPORT!=='I_APPROVE')
  reject('PRIVATE_IMPORT_NOT_AUTHORIZED',
    'Owner-reviewed private import opt-in required');
 if(env.KNOWLEDGE_PRIVATE_STORAGE_REVIEWED!=='ENCRYPTED_AND_PRIVATE')
  reject('PRIVATE_STORAGE_REVIEW_REQUIRED',
    'Owner-reviewed encrypted, owner-only destination storage required');
 // This is an operator attestation, not a technical disk-encryption proof.
 process.umask(0o077);
 const config=await privateJson(args[1]);
 if(config?.format!=='knowledge-notion-scope-map-v1')
  reject('INVALID_SCOPE_RULES','Expected protected Knowledge scope map');
 const result=await importExtractedNotionExport({
  sourceDir:args[0],rules:config.rules,targetDir:args[2],
  allowPrivateImport:true,
 });
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
  const code=typeof error.code==='string'&&/^[A-Z_]{3,70}$/.test(error.code)?
   error.code:'NOTION_IMPORT_FAILED';
  process.stderr.write(code+
   ': Private Notion export import failed; original workspace remains unchanged\n');
  process.exitCode=1;
 });
}
