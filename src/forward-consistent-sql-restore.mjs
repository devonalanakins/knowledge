/**
 * Offline, owner-local D1 SQL export recovery. SQL exports are untrusted bytes.
 * NEVER execute exported SQL. Only parse three reviewed ciphertext tables.
 */
import {createHash} from 'node:crypto';
import {constants as flags,readFileSync} from 'node:fs';
import {open,lstat,mkdir,rm,chmod} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createForwardSearchRebuildReader} from './forward-ciphertext-restore.mjs';

export const MAX_SQL_EXPORT_BYTES = 512 * 1024 * 1024;
const MAX_STATEMENT_CHARS = 128 * 1024;
const MAX_PAGES = 100_000;
const MAX_REVISIONS = 1_000_000;
const HEX = /^[0-9a-f]{64}$/;
const expectedColumns = Object.freeze({
  knowledge_instance:['id','key_check'],
  knowledge_pages:['path_key','version','sealed','updated_at'],
  knowledge_revisions:['path_key','version','sealed','created_at'],
});
const ddlNames = Object.freeze({
  TABLE:new Set(Object.keys(expectedColumns)),
  INDEX:new Set(['knowledge_pages_updated']),
  TRIGGER:new Set(['knowledge_revisions_immutable_update','knowledge_revisions_immutable_delete']),
});
const canonicalSchema=readFileSync(new URL('../ops/private-forward/schema.sql',import.meta.url),'utf8');
const refused=()=>new Error('KNOWLEDGE_SQL_RECOVERY_REFUSED');
const owned=x=>typeof process.getuid==='function' && x.uid===process.getuid();

/** No symlinks, permissive directories, unknown owners or unverified Windows ACLs. */
export async function privateSqlRecoveryFile(input) {
  if(process.platform==='win32'||typeof process.getuid!=='function'||
     typeof input!=='string'||!input.trim()||input.includes('\0'))throw refused();
  const path=resolve(input), info=await lstat(path), parent=await lstat(dirname(path));
  if(!info.isFile()||info.isSymbolicLink()||!owned(info)||(info.mode&0o777)!==0o600||
     !parent.isDirectory()||parent.isSymbolicLink()||!owned(parent)||
     (parent.mode&0o777)!==0o700)throw refused();
  return {path,info};
}

/** SQL literals accepted by the encrypted v1 schema: quoted text or positive integers. */
function literalValues(text,columns) {
  let i=0;const values=[];
  const space=()=>{while(i<text.length&&/\s/.test(text[i]))i++;};
  while(i<text.length){
    space();let value;
    if(text[i]==="'"){
      i++;let raw='',terminated=false;
      while(i<text.length){
        const c=text[i++];
        if(c==="'"){
          if(text[i]==="'"){raw+="'";i++;continue;}
          terminated=true;break;
        }
        raw+=c;
        if(raw.length>35_000)throw refused();
      }
      if(!terminated)throw refused();
      value=raw;
    } else {
      const match=/^[0-9]+/.exec(text.slice(i));
      if(!match||match[0].length>10)throw refused();
      value=Number(match[0]);i+=match[0].length;
      if(!Number.isSafeInteger(value))throw refused();
    }
    values.push(value);space();
    if(i===text.length)break;
    if(text[i]!==',')throw refused();
    i++;space();
    if(i===text.length)throw refused();
  }
  if(values.length!==columns.length)throw refused();
  return values;
}

function dataRow(statement) {
  const pattern=/^INSERT\s+INTO\s+(?:"(knowledge_[a-z_]+)"|(knowledge_[a-z_]+))\s*(?:\(\s*([^)]*?)\s*\))?\s+VALUES\s*\(([\s\S]*)\)$/i;
  const match=pattern.exec(statement);
  if(!match)throw refused();
  const name=(match[1]||match[2]).toLowerCase();
  const canonical=expectedColumns[name];if(!canonical)throw refused();
  const supplied=match[3]===undefined?canonical:
    match[3].split(',').map(x=>x.trim().replace(/^"([^"]+)"$/,'$1').toLowerCase());
  if(supplied.length!==canonical.length||
     supplied.some(x=>!canonical.includes(x))||new Set(supplied).size!==canonical.length)
    throw refused();
  const raw=literalValues(match[4],supplied);
  const dictionary=Object.fromEntries(supplied.map((key,i)=>[key,raw[i]]));
  return {name,values:canonical.map(c=>dictionary[c])};
}

/**
 * Streaming semicolon scanner handles quoted literals, comments, and the inner
 * semicolons of CREATE TRIGGER BEGIN ... END. Never executes any statement.
 */
async function* sqlStatements(file,hash) {
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',quote='',lineComment=false,blockComment=false,carry='';
  function take(c,next){
    if(lineComment){if(c==='\n')lineComment=false;return {skip:0};}
    if(blockComment){
      if(c==='*'&&next==='/'){blockComment=false;return {skip:1};}
      return {skip:0};
    }
    if(quote){
      buffer+=c;
      if(c===quote){
        if(next===quote){buffer+=next;return {skip:1};}
        quote='';
      }
      if(buffer.length>MAX_STATEMENT_CHARS)throw refused();
      return {skip:0};
    }
    if(c==='-'&&next==='-'){lineComment=true;buffer+=' ';return {skip:1};}
    if(c==='/'&&next==='*'){blockComment=true;buffer+=' ';return {skip:1};}
    if(c==="'"||c==='"'||c.charCodeAt(0)===96){quote=c;buffer+=c;return {skip:0};}
    if(c===';'){
      const ready=buffer.trim();
      if(/^CREATE\s+TRIGGER\b/i.test(ready)&&!/\bEND$/i.test(ready)){
        buffer+=';';
        return {skip:0};
      }
      buffer='';
      return {skip:0,statement:ready};
    }
    buffer+=c;
    if(buffer.length>MAX_STATEMENT_CHARS)throw refused();
    return {skip:0};
  }
  for await(const chunk of file.createReadStream({autoClose:false,highWaterMark:64*1024})){
    hash.update(chunk);
    const text=carry+decoder.decode(chunk,{stream:true});
    let i=0;
    while(i<text.length-1){
      const result=take(text[i],text[i+1]);
      i+=result.skip+1;
      if(result.statement)yield result.statement;
    }
    carry=text.slice(i);
  }
  const tail=carry+decoder.decode();
  for(let i=0;i<tail.length;i++){
    const result=take(tail[i],tail[i+1]??'');
    i+=result.skip;
    if(result.statement)yield result.statement;
  }
  if(quote||blockComment||buffer.trim())throw refused();
}

function importStatement(statement,state,insert) {
  if(state.committed)throw refused();
  if(/^PRAGMA\s+(?:foreign_keys\s*=\s*OFF|defer_foreign_keys\s*=\s*ON)$/i.test(statement)&&!state.started)
    return;
  if(/^BEGIN(?:\s+TRANSACTION)?$/i.test(statement)){
    if(state.started)throw refused();
    state.started=true;return;
  }
  if(!state.started)throw refused();
  if(/^COMMIT$/i.test(statement)){
    if(state.committed||ddlNames.TABLE.size!==state.tables.size||
       [...ddlNames.TABLE].some(x=>!state.tables.has(x)))throw refused();
    state.committed=true;return;
  }
  const create=/^CREATE\s+(TABLE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))(?=\s|\()/i.exec(statement);
  if(create){
    const kind=create[1].toUpperCase(),name=(create[2]||create[3]).toLowerCase();
    if(!ddlNames[kind]?.has(name)||state.declarations.has(kind+':'+name))
      throw refused();
    if(kind==='TABLE'){
      if(!/^\s*\(/.test(statement.slice(create[0].length))||
         !statement.trimEnd().endsWith(')'))throw refused();
      state.tables.add(name);
    }
    state.declarations.add(kind+':'+name);
    return; // Regenerate reviewed schema instead of running any exported DDL.
  }
  if(/^INSERT\b/i.test(statement)){
    const {name,values}=dataRow(statement);
    if(!state.tables.has(name))throw refused();
    if(name==='knowledge_instance'){
      if(++state.instances!==1)throw refused();
    } else if(name==='knowledge_pages'){
      if(++state.pages>MAX_PAGES)throw refused();
    }else if(++state.revisions>MAX_REVISIONS)throw refused();
    insert[name].run(...values);return;
  }
  throw refused();
}

async function verifyFullHistory(database,{kit,passphrase}){
  database.exec('PRAGMA foreign_keys=ON;PRAGMA trusted_schema=OFF;');
  if(database.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||
     database.prepare('PRAGMA foreign_key_check').all().length)throw refused();
  const reader=await createForwardSearchRebuildReader({kit,passphrase});
  await reader.verifyInstance({prepare:query=>({
    first:async()=>database.prepare(query).get()??null,
  })});
  const storedPages=database.prepare('SELECT COUNT(*) AS n FROM knowledge_pages').get().n;
  const storedRevisions=database.prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get().n;
  const storedInstances=database.prepare('SELECT COUNT(*) AS n FROM knowledge_instance').get().n;
  if(storedInstances!==1||storedPages>MAX_PAGES||storedRevisions>MAX_REVISIONS)throw refused();
  const historyQuery=database.prepare(
    'SELECT path_key,version,sealed,created_at FROM knowledge_revisions WHERE path_key=? ORDER BY version'
  );
  let pages=0,revisions=0;
  for(const row of database.prepare(
    'SELECT path_key,version,sealed,updated_at FROM knowledge_pages ORDER BY path_key'
  ).iterate()){
    const latest=await reader.authenticatePage(row);
    pages++;let next=1,atHead=false;
    for(const revision of historyQuery.iterate(row.path_key)){
      if(revision.version!==next||revision.path_key!==row.path_key)throw refused();
      const old=await reader.authenticatePage(revision);
      if(old.path!==latest.path)throw refused();
      if(next===row.version){
        if(revision.sealed!==row.sealed||revision.created_at!==row.updated_at)
          throw refused();
        atHead=true;
      }
      next++;revisions++;
    }
    if(!atHead||next!==row.version+1)throw refused();
  }
  if(pages!==storedPages||revisions!==storedRevisions)throw refused();
  return {scope:reader.scope,keyId:reader.keyId,
    counts:{pages,revisions,instances:storedInstances}};
}

/** Verify-only uses memory SQLite; restore uses a brand-new owner-private folder. */
export async function verifyOrRestoreForwardD1Sql({
  sourceFile,expectedSha256,kit,passphrase,targetDir,
}={}){
  if(!HEX.test(expectedSha256)||!kit||typeof passphrase!=='string')throw refused();
  const source=await privateSqlRecoveryFile(sourceFile);
  if(source.info.size<1||source.info.size>MAX_SQL_EXPORT_BYTES)throw refused();
  let destination,created=false,database,file;
  try{
    if(targetDir!==undefined){
      if(typeof targetDir!=='string'||!targetDir.trim()||targetDir.includes('\0'))
        throw refused();
      destination=resolve(targetDir);
      const parent=await lstat(dirname(destination));
      if(!parent.isDirectory()||parent.isSymbolicLink()||!owned(parent)||
         (parent.mode&0o777)!==0o700||destination===source.path)throw refused();
      await mkdir(destination,{mode:0o700});created=true;
    }
    database=new DatabaseSync(destination?join(destination,'knowledge-restore.sqlite'):':memory:');
    database.exec('PRAGMA foreign_keys=OFF;PRAGMA trusted_schema=OFF;');
    database.exec(canonicalSchema);
    const insert={
      knowledge_instance:database.prepare('INSERT INTO knowledge_instance(id,key_check) VALUES(?,?)'),
      knowledge_pages:database.prepare('INSERT INTO knowledge_pages(path_key,version,sealed,updated_at) VALUES(?,?,?,?)'),
      knowledge_revisions:database.prepare('INSERT INTO knowledge_revisions(path_key,version,sealed,created_at) VALUES(?,?,?,?)'),
    };
    const state={started:false,committed:false,instances:0,pages:0,revisions:0,
      tables:new Set(),declarations:new Set()};
    file=await open(source.path,flags.O_RDONLY|(flags.O_NOFOLLOW||0));
    const opened=await file.stat();
    if(!opened.isFile()||opened.size!==source.info.size||
       opened.dev!==source.info.dev||opened.ino!==source.info.ino)throw refused();
    const hash=createHash('sha256');
    database.exec('BEGIN IMMEDIATE');
    for await(const statement of sqlStatements(file,hash)){
      importStatement(statement,state,insert);
    }
    const end=await file.stat();
    if(end.size!==opened.size||end.mtimeMs!==opened.mtimeMs||end.ino!==opened.ino||
       !state.started||!state.committed||state.instances!==1)throw refused();
    const observedSha256=hash.digest('hex');
    if(observedSha256!==expectedSha256)throw refused();
    database.exec('COMMIT');
    const verified=await verifyFullHistory(database,{kit,passphrase});
    if(verified.counts.pages!==state.pages||verified.counts.revisions!==state.revisions)
      throw refused();
    database.close();database=undefined;
    if(destination&&process.platform!=='win32')
      await chmod(join(destination,'knowledge-restore.sqlite'),0o600);
    return {status:'SQL_EXPORT_VERIFIED',...verified,
      sha256:observedSha256,bytes:source.info.size,
      ...(destination?{restored:true,sqliteFile:join(destination,'knowledge-restore.sqlite')}:
        {restored:false})};
  }catch{
    try{database?.close();}catch{}
    if(created)try{await rm(destination,{recursive:true,force:true});}catch{}
    throw refused();
  }finally{await file?.close();}
}
