#!/usr/bin/env node
/**
 * Owner-local Notion retirement recovery, one new output directory only.
 * Requires a separately scoped read-only API token. Never runs in public CI
 * with live user content, never modifies Notion or an existing Knowledge DB.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,realpath,readFile,writeFile,chmod,mkdir,mkdtemp,rename,rm} from 'node:fs/promises';
import {resolve,dirname,join,basename,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureRecoveryHierarchy,validateRecoveryRoots} from './notion-hierarchy-export.mjs';
import {createReadOnlyNotionClient} from './notion-api-source.mjs';
import {privateJson} from './organization-review-cli.mjs';
import {PORTALS} from './wiki-taxonomy.mjs';

const allowedPortals=new Map(PORTALS.map(p=>[p.id,p.scopes]));
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function check(ok,code,message){if(!ok)fail(code,message);}
function canonical=id=>String(id).replaceAll('-','').toLowerCase();
function titleOf(page){
 const fields=Object.values(page.properties??{});
 const field=fields.find(v=>v?.type==='title');
 const rich=field?.title??page.title??[];
 const result=Array.isArray(rich)?rich.map(x=>x.plain_text??x.text?.content??'').join(''):'';
 return (result||'Untitled page').trim().slice(0,180);
}
function fileStem(title,id){
 const clean=String(title||'Untitled').normalize('NFKC')
  .replace(/[\\/:*?"<>|\x00-\x1f]/g,' ')
  .replace(/\s+/g,' ').replace(/^\.+/,'').trim().slice(0,64);
 return (clean||'Untitled')+' '+canonical(id);
}
function richText(items){
 if(!Array.isArray(items))return '';
 return items.map(x=>x.plain_text??x.text?.content??'').join('');
}
function sourceText(page,blocks,relations=[]){
 const lines=['# '+titleOf(page),'','## Original Notion properties',''];
 for(const [name,val] of Object.entries(page.properties??{})){
  const key=String(name).replace(/\r|\n/g,' ').replaceAll('*','\\*');
  let desc;
  if(val?.type==='title'||val?.type==='rich_text')
   desc=richText(val[val.type]);
  else desc=JSON.stringify(val?.[val.type]??val).slice(0,30000);
  lines.push('- **'+key+':** '+desc);
 }
 for(const rel of relations)
  lines.push('- **Full relation '+rel.propertyName+':** '+rel.relatedPageIds.join(', '));
 lines.push('','## Original page body','');
 function render(items,depth){
  for(const block of items){
   const kind=block.type,body=block[kind]??{},value=richText(body.rich_text);
   const indent='  '.repeat(Math.min(depth,12));
   if(kind==='paragraph')lines.push(indent+value,'');
   else if(/^heading_[123]$/.test(kind))lines.push(
     '#'.repeat(Number(kind.at(-1))+1)+' '+value,'');
   else if(kind==='bulleted_list_item')lines.push(indent+'- '+value);
   else if(kind==='numbered_list_item')lines.push(indent+'1. '+value);
   else if(kind==='to_do')lines.push(indent+'- ['+(body.checked?'x':' ')+'] '+value);
   else if(kind==='quote')lines.push('> '+value,'');
   else if(kind==='code')lines.push('    '+value.replace(/\n/g,'\n    '),'');
   else if(kind==='divider')lines.push('---','');
   else if(kind==='child_page'||kind==='child_database')
    lines.push('- ['+(body.title||kind)+'](https://www.notion.so/'+canonical(block.id)+')');
   else if(kind==='table_row')lines.push('| '+(body.cells??[]).map(richText).join(' | ')+' |');
   else if(['image','video','file','audio','pdf'].includes(kind))
    lines.push('> [Embedded '+kind+': referenced in private source JSON, bytes not captured]');
   else if(value)lines.push(value,'');
   else if(!['column_list','column','table','toggle','synced_block'].includes(kind))
    lines.push('> [Original '+kind+' block retained in private JSON]');
   if(Array.isArray(block.child_blocks))render(block.child_blocks,depth+1);
  }
 }
 render(blocks,0);
 return lines.join('\n').trim()+'\n';
}
async function privateDir(path){
 const st=await lstat(path);
 check(st.isDirectory()&&!st.isSymbolicLink()&&
  (st.mode&0o077)===0&&
  (typeof process.getuid!=='function'||st.uid===process.getuid())&&
  await realpath(path)===path,
  'UNSAFE_PRIVATE_STORAGE','Private directory must be owner-only and not a symlink');
}
async function saveFile(path,content){
 await writeFile(path,content,{flag:'wx',mode:0o600});
 const b=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
 const saved=await readFile(path);
 try{
  check(saved.length===b.length&&
   createHash('sha256').update(saved).digest('hex')===
   createHash('sha256').update(b).digest('hex'),
   'PRIVATE_OUTPUT_MISMATCH','Saved source evidence failed checksum');
 }finally{saved.fill(0)}
}
export async function exportPrivateNotionHierarchy({
 configFile,targetDir,token,client=null,allowPrivateRecovery=false,
 encryptedHostStorageReviewed=false,
}={}){
 check(allowPrivateRecovery===true,'RECOVERY_NOT_AUTHORIZED',
  'Explicit private read-only migration authorization required');
 check(encryptedHostStorageReviewed===true,'PRIVATE_STORAGE_REVIEW_REQUIRED',
  'Operator-reviewed encrypted private destination required');
 check(typeof configFile==='string'&&typeof targetDir==='string'&&
  configFile.trim()&&targetDir.trim(),
  'INVALID_ARGS','Private root manifest and new destination required');
 const config=await privateJson(resolve(configFile));
 check(config?.format==='knowledge-notion-recovery-roots-v1'&&
  Array.isArray(config.roots),'INVALID_ROOT_SELECTION',
  'Expected protected Notion source root selection');
 const roots=validateRecoveryRoots(config.roots);
 for(const root of roots){
  const scopes=allowedPortals.get(root.portal);
  check(scopes?.includes(root.scope)||root.scope==='migration-quarantine',
   'INVALID_ROOT_SELECTION','Private source and portal classification disagree');
 }
 const dest=resolve(targetDir);
 const parent=dirname(dest);
 await privateDir(parent);
 check(dest!==resolve(configFile)&&dest!==parent,
  'UNSAFE_DESTINATION','Existing source and destination must be separate');
 try{await lstat(dest);fail('ALREADY_EXISTS','Cannot overwrite existing Knowledge source')}
 catch(error){if(error.code!=='ENOENT')throw error}
 const stage=await mkdtemp(join(parent,'.knowledge-readonly-recovery-'));
 await chmod(stage,0o700);
 const folders=new Map();
 const expected=[],written=[];
 async function folderFor(info,title){
  // The synthetic root container must not resemble a source page parent ID.
  // Child folders do carry canonical Notion IDs for hierarchy recovery.
  const rootFolder=join(info.scope,info.portal+'-'+info.rootId+'-source');
  const base=info.parentId?folders.get(info.parentId):rootFolder;
  check(base!==undefined,'INVALID_NOTION_HIERARCHY','Parent page/database was not captured');
  const stem=fileStem(title,info.id);
  const dir=join(stage,base);
  await mkdir(dir,{recursive:true,mode:0o700});
  const sourceRel=join(base,stem);
  folders.set(info.id,sourceRel);
  return {stem,dir,sourceRel};
 }
 const sink={
  async page(info){
   const title=titleOf(info.page),location=await folderFor(info,title);
   const md=sourceText(info.page,info.blocks,info.relations);
   const raw=JSON.stringify({
    format:'knowledge-notion-original-page-v1',
    originalId:info.id,rootId:info.rootId,scope:info.scope,
    portal:info.portal,parentId:info.parentId,
    page:info.page,blocks:info.blocks,relations:info.relations,
   });
   await saveFile(join(location.dir,location.stem+'.md'),md);
   await saveFile(join(location.dir,location.stem+'.notion.json'),raw);
   written.push({id:info.id,kind:'page',bytes:Buffer.byteLength(md,'utf8')});
  },
  async database(info){
   const title=richText(info.database.title)||'Untitled database';
   const location=await folderFor(info,title);
   const md='# '+title+'\n\n> Original Notion database. The complete data-source schema and original metadata are preserved in its private JSON. Database rows are exported as child pages.\n';
   await saveFile(join(location.dir,location.stem+'.md'),md);
   await saveFile(join(location.dir,location.stem+'.notion.json'),
    JSON.stringify({format:'knowledge-notion-original-database-v1',
      rootId:info.rootId,parentId:info.parentId,
      database:info.database,scope:info.scope,portal:info.portal}));
   written.push({id:info.id,kind:'database',bytes:Buffer.byteLength(md,'utf8')});
  },
 };
 let published=false;
 try{
  const sourceClient=client??createReadOnlyNotionClient({token});
  const result=await captureRecoveryHierarchy({
   client:sourceClient,roots,sink,approved:true,
  });
  check(written.length===result.pages+result.databases,
   'RECOVERY_MISMATCH','Source records and saved files mismatch');
  // A private scope map is included for the existing Knowledge file importer.
  // Do not use a catch-all rule that could mix multiple access scopes.
  // The existing importer intentionally reserves migration-quarantine as a
  // fallback. Never create a scope rule that bypasses that isolation gate.
  const rules=roots.filter(root=>root.scope!=='migration-quarantine').map(root=>({
   prefix:root.scope+'/'+root.portal+'-'+root.id+'-source',
   spaceId:root.scope,portal:root.portal,
  }));
  await saveFile(join(stage,'scope-map.json'),
   JSON.stringify({format:'knowledge-notion-scope-map-v1',rules}));
  const publicSafeReport={
   ...result,sourceDocumentsWritten:written.length,
   originalRawJsonFilesWritten:written.length,
   sourceSchemaFilesWritten:true,
   scopeMapWritten:true,privateDestinationEncryptedIndependentlyVerified:false,
   sourceCompletenessVerified:false,liveKnowledgeVerified:false,
   cutoverApproved:false,
  };
  await saveFile(join(stage,'recovery-report.json'),
   JSON.stringify(publicSafeReport,null,2)+'\n');
  try{await lstat(dest);fail('ALREADY_EXISTS','Destination was created during capture')}
  catch(error){if(error.code!=='ENOENT')throw error}
  await rename(stage,dest);
  published=true;
  return publicSafeReport;
 }finally{
  if(!published)await rm(stage,{recursive:true,force:true});
 }
}
export async function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==2)fail('INVALID_ARGS',
  'Usage: notion:recover:private OWNER_ROOTS.json NEW_PRIVATE_FOLDER');
 process.umask(0o077);
 const result=await exportPrivateNotionHierarchy({
  configFile:args[0],targetDir:args[1],
  token:env.NOTION_API_TOKEN,
  allowPrivateRecovery:env.KNOWLEDGE_PRIVATE_NOTION_RECOVERY==='I_APPROVE',
  encryptedHostStorageReviewed:
   env.KNOWLEDGE_PRIVATE_STORAGE_REVIEWED==='ENCRYPTED_AND_PRIVATE',
 });
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 main().catch(error=>{
  const code=typeof error.code==='string'&&/^[A-Z_]{3,70}$/.test(error.code)?
   error.code:'NOTION_RECOVERY_FAILED';
  process.stderr.write(code+
   ': Private read-only Notion recovery failed; original workspace unchanged\n');
  process.exitCode=1;
 });
}
