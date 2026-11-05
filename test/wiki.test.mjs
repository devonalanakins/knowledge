import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeStore, KnowledgeError } from '../src/knowledge.mjs';
import { createKnowledgeServer } from '../src/server.mjs';

const ownerToken='o'.repeat(36), agentToken='a'.repeat(36);
function withStore(fn){
  const s=new KnowledgeStore();s.createSpace('personal','Personal');s.createSpace('other','Other');
  try{return fn(s);}finally{s.close();}
}
function page(overrides={}){return {path:'projects/devonstation/decisions',title:'DevonStation decisions',body:'## Source\nPrivate synthetic research',sourceUrl:'https://example.com/authority',...overrides};}

test('wiki capture uses stable paths, idempotent updates, and immutable version history',()=>withStore(s=>{
  const a=s.capturePage('personal',page());assert.equal(a.action,'created');assert.equal(a.status,'draft');assert.equal(a.version,1);
  const b=s.capturePage('personal',page());assert.equal(b.action,'unchanged');assert.equal(b.id,a.id);assert.equal(s.history('personal',a.id).length,1);
  const c=s.capturePage('personal',page({body:'Updated from agent'}));assert.equal(c.action,'updated');assert.equal(c.version,2);
  assert.equal(s.getPage('personal',page().path).body,'Updated from agent');
  assert.equal(s.history('personal',a.id).length,2);
  assert.equal(s.listPages('personal')[0].path,page().path);
  assert.equal(s.searchPages('personal','Updated')[0].id,a.id);
  assert.deepEqual(s.searchPages('other','Updated'),[]);
}));

test('agent captures preserve old provenance unless intentionally replaced',()=>withStore(s=>{
  const original=s.capturePage('personal',page());
  const revised=s.capturePage('personal',{path:original.path,title:original.title,body:'Updated text without new source'});
  assert.equal(revised.sourceUrl,original.sourceUrl);
  assert.equal(revised.version,2);
  assert.equal(s.capturePage('personal',{path:original.path,title:original.title,body:'Updated text without new source'}).action,'unchanged');
  const cleared=s.capturePage('personal',{path:original.path,title:original.title,body:'Updated text without new source',sourceUrl:null});
  assert.equal(cleared.sourceUrl,null);
  assert.equal(cleared.version,3);
}));

test('agent cannot silently revise a human-recorded wiki entry',()=>withStore(s=>{
  const original=s.capturePage('personal',page());
  const reviewed=s.updateRecord('personal',original.id,original.version,{status:'recorded'});
  assert.equal(reviewed.status,'recorded');
  assert.throws(()=>s.capturePage('personal',page({body:'Surreptitious replacement'})),{code:'REVIEW_REQUIRED'});
  assert.equal(s.getPage('personal',original.path).body,original.body);
  assert.equal(s.getPage('personal',original.path).status,'recorded');
  assert.equal(s.history('personal',original.id).length,2);
}));

test('capture fails closed on invalid paths and attempts to promote approvals',()=>withStore(s=>{
  for(const bad of ['../admin','../../secret','UPPER','a//b','hello?x=1','foo/./bar','a'.repeat(241)]){
    assert.throws(()=>s.capturePage('personal',page({path:bad})),{code:'INVALID_INPUT'});
  }
  assert.throws(()=>s.capturePage('personal',{...page(),status:'approved'}),{code:'INVALID_INPUT'});
  assert.throws(()=>s.capturePage('personal',{...page(),kind:'decision'}),{code:'INVALID_INPUT'});
  assert.equal(s.listPages('personal').length,0);
}));

test('owner-generated share tokens grant only a page, can be revoked, and do not appear in exports',()=>withStore(s=>{
  const a=s.capturePage('personal',page());const b=s.capturePage('other',page({path:'other/secret',title:'Other secret'}));
  const link=s.createShare('personal',a.path);
  assert.equal(s.getSharedPage(link.token).id,a.id);
  s.capturePage('personal',page({body:'NEW SECRET AFTER SHARE'}));
  assert.equal(s.getSharedPage(link.token).body,a.body,'Shared link stays pinned to its original revision');
  assert.notEqual(s.getSharedPage(link.token).id,b.id);
  const archive=s.exportSpace('personal');assert.equal(JSON.stringify(archive).includes(link.token),false);
  assert.equal(s.revokeShare(link.token).revoked,true);
  assert.equal(s.getSharedPage(link.token),null);
  assert.equal(s.revokeShare(link.token).revoked,false);
}));

test('backup preserves wiki paths and source revisions in independent empty target',()=>withStore(s=>{
  s.capturePage('personal',page());s.capturePage('personal',page({body:'Current revision'}));
  const snapshot=s.exportSpace('personal');const target=new KnowledgeStore();
  try{target.restoreSpace(snapshot);assert.equal(target.getPage('personal',page().path).version,2);assert.deepEqual(target.exportSpace('personal'),snapshot);}
  finally{target.close();}
}));

test('rejects duplicate wiki paths in checksummed manipulated backup and preserves empty target',()=>withStore(s=>{
  const x=s.capturePage('personal',page());
  const snap=s.exportSpace('personal');snap.payload.pages.push({...snap.payload.pages[0]});
  const target=new KnowledgeStore();
  try{assert.throws(()=>target.restoreSpace(snap),{code:'INVALID_INPUT'});assert.equal(target.getSpace('personal'),null);}
  finally{target.close();}
}));

async function withServer(fn){
  const store=new KnowledgeStore();store.createSpace('personal','Personal');store.createSpace('other','Other');
  const server=createKnowledgeServer(store,{ownerToken,agentToken,space:'personal'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try{return await fn({store,url});}
  finally{await new Promise(resolve=>server.close(resolve));store.close();}
}

test('capture API authenticates agents and exposes only owner-scoped read routes',()=>withServer(async({store,url})=>{
  const payload=page({title:'<img src=x onerror=alert(1)>',body:'<script>alert(1)</script>\n## Safe section'});
  let r=await fetch(url+'/api/v1/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(r.status,401);
  r=await fetch(url+'/api/v1/capture',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+ownerToken},body:JSON.stringify(payload)});
  assert.equal(r.status,401,'Owner read token must not write');
  r=await fetch(url+'/api/v1/capture',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+agentToken},body:JSON.stringify(payload)});
  assert.equal(r.status,201);const created=await r.json();assert.equal(created.status,'draft');assert.equal(created.path,payload.path);
  r=await fetch(url+'/api/v1/capture',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+agentToken},body:JSON.stringify(payload)});
  assert.equal((await r.json()).action,'unchanged');
  assert.equal(store.getPage('personal',payload.path).version,1);
  r=await fetch(url+'/api/v1/pages');assert.equal(r.status,401);
  r=await fetch(url+'/api/v1/pages',{headers:{Authorization:'Bearer '+agentToken}});assert.equal(r.status,200);
  assert.deepEqual((await r.json()).pages.map(x=>x.path),[payload.path]);
  r=await fetch(url+'/api/v1/page/'+payload.path,{headers:{Authorization:'Bearer '+ownerToken}});assert.equal((await r.json()).page.body,payload.body);
  store.capturePage('other',page({path:'other/secret',title:'Top secret'}));
  r=await fetch(url+'/api/v1/search?q=secret',{headers:{Authorization:'Bearer '+agentToken}});
  assert.deepEqual((await r.json()).results,[]);
}));

test('private web reader requires login; HTML is escaped; explicit shares are public and revocable',()=>withServer(async({store,url})=>{
  const p=store.capturePage('personal',page({body:'<script>alert(1)</script>'}));
  let r=await fetch(url+'/',{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');
  r=await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'token=wrong',redirect:'manual'});assert.equal(r.status,401);
  r=await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'token='+ownerToken,redirect:'manual'});
  assert.equal(r.status,303);const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);
  r=await fetch(url+`/w/personal/${p.path}`,{headers:{Cookie:cookie}});let html=await r.text();
  assert.equal(r.status,200);assert.match(html,/&lt;script&gt;alert/);assert.doesNotMatch(html,/<script>alert/);
  const share=store.createShare('personal',p.path);r=await fetch(url+'/s/'+share.token);
  assert.equal(r.status,200);html=await r.text();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/Original reference/);
  assert.match(r.headers.get('referrer-policy'),/no-referrer/);
  store.revokeShare(share.token);r=await fetch(url+'/s/'+share.token);assert.equal(r.status,404);
}));

test('API reports a conflict rather than overwriting an owner-reviewed page',()=>withServer(async({store,url})=>{
  const original=store.capturePage('personal',page());
  store.updateRecord('personal',original.id,1,{status:'recorded'});
  const r=await fetch(url+'/api/v1/capture',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+agentToken},body:JSON.stringify(page({body:'Not authorized'}))});
  assert.equal(r.status,409);
  assert.deepEqual((await r.json()).error,'REVIEW_REQUIRED');
  assert.equal(store.getPage('personal',original.path).body,original.body);
}));

test('API cannot share, mutate other workspaces or create forged approval status',()=>withServer(async({store,url})=>{
  const capture=async payload=>fetch(url+'/api/v1/capture',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+agentToken},body:JSON.stringify(payload)});
  let r=await capture({...page(),space:'other'});assert.equal(r.status,400);
  r=await capture({...page(),status:'approved'});assert.equal(r.status,400);
  r=await fetch(url+'/api/v1/share',{method:'POST',headers:{Authorization:'Bearer '+agentToken}});
  assert.notEqual(r.status,200);
  assert.equal(store.listPages('personal').length,0);
}));
