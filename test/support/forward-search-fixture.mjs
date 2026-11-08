/** Entirely fictional owner-local encrypted database for rebuild/recovery tests. */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {encryptSnapshot} from '../../src/backup.mjs';
import {createForwardSearchRebuildReader} from '../../src/forward-ciphertext-restore.mjs';
import {createSearchRebuildSqliteAdapter} from '../../src/forward-search-rebuild-sqlite.mjs';
export const syntheticPassphrase='fictional-owner-local-search-rebuild-passphrase';
export async function searchFixture({pages=17,scope='personal',keyId='owner-v1',path=':memory:'}={}){
 const database=new DatabaseSync(path);database.exec(readFileSync(new URL('../../ops/private-forward/schema.sql',import.meta.url),'utf8'));
 const enc=new TextEncoder(),rootKeyHex='0123456789abcdef'.repeat(4);
 const root=await crypto.subtle.importKey('raw',Buffer.from(rootKeyHex,'hex'),'HKDF',false,['deriveKey']);
 const context={name:'HKDF',hash:'SHA-256',salt:enc.encode('Knowledge forward-only v1')};
 const aes=await crypto.subtle.deriveKey({...context,info:enc.encode('content-encryption')},root,{name:'AES-GCM',length:256},false,['encrypt']);
 const mac=await crypto.subtle.deriveKey({...context,info:enc.encode('path-indexing')},root,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const sign=async value=>Buffer.from(await crypto.subtle.sign('HMAC',mac,enc.encode(value))).toString('base64url');
 const marker=await sign('knowledge-instance-v1\0'+scope+'\0'+keyId);
 database.prepare('INSERT INTO knowledge_instance(id,key_check) VALUES(1,?)').run(marker);
 const insert=database.prepare('INSERT INTO knowledge_pages(path_key,version,sealed,updated_at) VALUES(?,?,?,?)');
 const history=database.prepare('INSERT INTO knowledge_revisions(path_key,version,sealed,created_at) VALUES(?,?,?,?)');
 for(let i=0;i<pages;i++){
   const pagePath='fictional/rebuild-'+i,pk=await sign('path-v1\0'+scope+'\0'+pagePath);
   const page={path:pagePath,title:'Fictional indexed document '+i,body:'Synthetic photon transport '+(i===7?'uniqueneedle':'common'),status:'draft',sourceUrl:null,version:1,updatedAt:'2026-11-07T00:00:00.000Z'};
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('knowledge-record-v1\0'+scope+'\0'+pk+'\0'+1)},aes,enc.encode(JSON.stringify(page)));
   const sealed=JSON.stringify({format:'knowledge-sealed-v1',keyId,nonce:Buffer.from(iv).toString('base64url'),data:Buffer.from(data).toString('base64url')});
   insert.run(pk,1,sealed,page.updatedAt);history.run(pk,1,sealed,page.updatedAt);
 }
 const kit={format:'knowledge-forward-key-recovery-v1',scope,keyId,sealed:encryptSnapshot({format:'knowledge-forward-root-key-v1',scope,keyId,rootKeyHex},syntheticPassphrase)};
 const reader=await createForwardSearchRebuildReader({kit,passphrase:syntheticPassphrase});
 const db=createSearchRebuildSqliteAdapter(database);
 function install(){
   database.exec(readFileSync(new URL('../../ops/private-forward/search-index-v1.sql',import.meta.url),'utf8'));
   database.exec(readFileSync(new URL('../../ops/private-forward/search-rebuild-v1.sql',import.meta.url),'utf8'));
 }
 return {database,db,reader,kit,install,close:()=>database.close()};
}
