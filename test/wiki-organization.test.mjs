import {test} from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeStore} from '../src/knowledge.mjs';
import {createKnowledgeServer} from '../src/server.mjs';

const ownerToken='o'.repeat(36),agentToken='a'.repeat(36);
async function fixture(fn) {
 const store=new KnowledgeStore();
 store.createSpace('devonstation','Fictional engineering');
 store.createSpace('other','Other identity boundary');
 const source=store.capturePage('devonstation',{
   path:'independent-software/project/knowledge',
   title:'Knowledge project',body:'## Overview\nA synthetic wiki project.',sourceUrl:'https://example.org/project'
 });
 const evidence=store.capturePage('devonstation',{
   path:'independent-software/evidence/build-result',
   title:'<script>other source</script>',body:'A synthetic test receipt.'
 });
 const infrastructure=store.capturePage('devonstation',{
   path:'portfolio-infrastructure/system/hosting',
   title:'Hosting system',body:'A separate fictional domain.'
 });
 const isolated=store.capturePage('other',{
   path:'personal-family/index/protected',
   title:'OTHER WORKSPACE SECRET',body:'OTHER WORKSPACE BODY'
 });
 store.link('devonstation',evidence.id,source.id,'supports');
 store.link('devonstation',source.id,infrastructure.id,'depends');
 const server=createKnowledgeServer(store,{ownerToken,agentToken,space:'devonstation'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 try{return await fn({store,url,source,evidence,infrastructure,isolated});}
 finally{await new Promise(resolve=>server.close(resolve));store.close();}
}
async function ownerCookie(url){
 const response=await fetch(url+'/login',{method:'POST',redirect:'manual',
   headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({token:ownerToken})});
 assert.equal(response.status,303);
 return response.headers.get('set-cookie').split(';')[0];
}
test('private reader renders portal colors, subject filters and same-scope reciprocal backlinks',()=>fixture(async({store,url,source,evidence,infrastructure,isolated})=>{
 assert.equal(store.getLinkedPages('devonstation',source.path).length,2);
 assert.ok(store.getLinkedPages('devonstation',source.path).some(x=>x.direction==='incoming'&&x.path===evidence.path));
 assert.ok(store.getLinkedPages('devonstation',evidence.path).some(x=>x.direction==='outgoing'&&x.path===source.path));
 assert.throws(()=>store.link('devonstation',source.id,isolated.id,'supports'),{code:'NOT_FOUND'});
 const noCookie=await fetch(url+'/w/devonstation/'+source.path,{redirect:'manual'});
 assert.equal(noCookie.status,303);
 const cookie=await ownerCookie(url);
 let response=await fetch(url+'/?portal=independent-software',{headers:{Cookie:cookie}});
 assert.equal(response.status,200);
 let html=await response.text();
 assert.match(html,/portal-purple/);
 assert.match(html,/Knowledge project/);
 assert.doesNotMatch(html,/Hosting system/);
 assert.doesNotMatch(html,/OTHER WORKSPACE SECRET/);
 response=await fetch(url+'/w/devonstation/'+source.path,{headers:{Cookie:cookie}});
 assert.equal(response.status,200);
 html=await response.text();
 assert.match(html,/Related subjects and backlinks/);
 assert.match(html,/Linked from/);
 assert.match(html,/Links to/);
 assert.match(html,/&lt;script&gt;other source&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script>other source<\/script>/);
 assert.doesNotMatch(html,/OTHER WORKSPACE BODY/);
 response=await fetch(url+'/?portal=portfolio-infrastructure',{headers:{Cookie:cookie}});
 html=await response.text();
 assert.match(html,/Hosting system/);
 assert.doesNotMatch(html,/Knowledge project/);
}));
test('shared revision never reveals owner-only backlink graphs or other wiki subjects',()=>fixture(async({store,url,source})=>{
 const shared=store.createShare('devonstation',source.path);
 const response=await fetch(url+'/s/'+shared.token);
 assert.equal(response.status,200);
 const html=await response.text();
 assert.match(html,/A synthetic wiki project/);
 assert.doesNotMatch(html,/Related subjects and backlinks/);
 assert.doesNotMatch(html,/other source/);
 assert.doesNotMatch(html,/Hosting system/);
 assert.doesNotMatch(html,/OTHER WORKSPACE SECRET/);
 assert.doesNotMatch(html,/Original reference/);
}));
