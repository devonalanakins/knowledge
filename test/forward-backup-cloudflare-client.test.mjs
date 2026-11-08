import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyR2Client} from '../src/forward-backup-cloudflare-client.mjs';
const account='a'.repeat(32),bucket='knowledge-forward-backups-private',token='dummy-fixture-token';
const client=fetchImpl=>createReadOnlyR2Client({account,bucket,token,fetchImpl});
const entry={key:'automated/personal/owner-v1/2026-11-08T08-00-00-000Z-11111111-1111-4111-8111-111111111111.json',etag:'0'.repeat(32),size:4};

test('uses Cloudflare API array result and result_info cursor without leaking token',async()=>{
  const urls=[];
  const c=client(async(url,opts)=>{
    urls.push(url);
    assert.equal(opts.headers.Authorization,'Bearer '+token);
    assert.equal(opts.redirect,'error');
    return Response.json(urls.length===1?{success:true,result:[entry],result_info:{is_truncated:true,cursor:'cursor'}}:
      {success:true,result:[{...entry,key:entry.key+'2'}],result_info:{is_truncated:false}});
  });
  assert.equal((await c.listObjects('automated/personal/owner-v1/')).length,2);
  assert.match(urls[1],/cursor=cursor/);
  assert.ok(urls.every(x=>!x.includes(token)));
});
test('supports wrapped Cloudflare list and full binary object read with literal slashes',async()=>{
  const paths=[];
  const c=client(async url=>{
    paths.push(url);
    if(url.includes('?'))return Response.json({success:true,result:{objects:[entry],truncated:false}});
    return new Response(Buffer.from('test'),{status:200,headers:{'content-length':'4'}});
  });
  assert.equal((await c.listObjects('automated/personal/owner-v1/')).length,1);
  assert.equal(Buffer.from(await c.readObject(entry.key)).toString(),'test');
  assert.match(paths[1],/objects\/automated\/personal\/owner-v1\//);
  assert.ok(!paths[1].includes('%2F'));
});
test('refuses repeated cursors, API failure and invalid object paths',async()=>{
  const c=client(async()=>Response.json({success:true,result:[],result_info:{is_truncated:true,cursor:'same'}}));
  await assert.rejects(c.listObjects('automated/personal/owner-v1/'),/CURSOR/);
  await assert.rejects(client(async()=>new Response('',{status:403})).listObjects('automated/personal/owner-v1/'),/API_STATUS_403/);
  await assert.rejects(c.readObject('../secrets'),/INVALID_KEY/);
  assert.throws(()=>createReadOnlyR2Client({account,bucket,token:''}),/CONFIGURATION_REQUIRED/);
});
