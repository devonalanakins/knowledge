#!/usr/bin/env node
/** G21: no-network, aggregate-only private Notion capture preflight. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preflightNotionCapture} from './notion-capture-preflight.mjs';

function fail(code){const e=new Error(code);e.code=code;throw e;}
export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==3)fail('INVALID_ARGS');
 process.umask(0o077);
 const report=await preflightNotionCapture({
   inventoryFile:args[0],selectionFile:args[1],outputFile:args[2],
   passphrase:env.KNOWLEDGE_BACKUP_PASSPHRASE,
   token:env.NOTION_API_TOKEN,
 });
 process.stdout.write(JSON.stringify(report)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
   const code=typeof error.code==='string'&&/^[A-Z_]{3,50}$/.test(error.code)?
     error.code:'CAPTURE_PREFLIGHT_FAILED';
   process.stderr.write(code+
     ': Private offline capture preflight failed; no Notion request or output was made\n');
   process.exitCode=1;
 });
}
