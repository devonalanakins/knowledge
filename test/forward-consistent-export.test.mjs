import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CONSISTENT_EXPORT_ACK,CONSISTENT_EXPORT_FORMAT,CONSISTENT_EXPORT_LIMIT,
  runConsistentD1Export} from '../src/forward-consistent-export.mjs';

const account='a'.repeat(32);
const database='d942f8de-1f89-4942-adf7-e8ba00a72efa';
const bookmark='00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';
const signed='https://synthetic-export.r2.cloudflarestorage.com/private.sql?X-Amz-Signature=fictional';
const sql='BEGIN TRANSACTION;\nCREATE TABLE knowledge_instance(id INTEGER,key_check TEXT);\nCOMMIT;\n';
const bytes=new TextEncoder().encode(sql);
const digest=createHash('sha256').update(bytes).digest('hex');

function fixture({pending=0,signedUrl=signed,downloadBytes=bytes,bodyLength=bytes.length}={}){
  const operations=[];
  const saved=new Map();
  let started=false,polls=0,puts=0,gets=0,deletes=0;
  const bucket={
    async put(key,value,options){
      puts++;
      assert.equal(options.onlyIf.get('If-None-Match'),'*');
      assert.equal(options.httpMetadata.contentType,'application/sql');
      assert.equal(options.customMetadata.format,CONSISTENT_EXPORT_FORMAT);
      assert.equal(options.customMetadata.bookmark,bookmark);
      if(saved.has(key))return null;
      const raw=new Uint8Array(await new Response(value).arrayBuffer());
      saved.set(key,raw);
      return {size:raw.length};
    },
    async get(key){
      gets++;
      const result=saved.get(key);
      return result?{size:result.length,body:new Response(result).body}:null;
    },
    async delete(){deletes++;throw new Error('unexpected deletion');},
  };
  const step={
    async do(name,opts,fn){
      operations.push({kind:'do',name,opts});
      assert.equal(opts.retries.limit,0);
      return fn();
    },
    async sleep(name,delay){operations.push({kind:'sleep',name,delay});},
  };
  const env={
    CONSISTENT_EXPORT_ACK,EXPORT_ACCOUNT_ID:account,EXPORT_DATABASE_ID:database,
    EXPORT_SCOPE:'personal',EXPORT_KEY_ID:'owner-v1',
    EXPORT_D1_API_TOKEN:'FICTIONAL_REVIEW_ONLY_TOKEN',
    EXPORT_SIGNED_HOST:'synthetic-export.r2.cloudflarestorage.com',
    EXPORT_BUCKET:bucket,
  };
  const fetchImpl=async(url,options={})=>{
    operations.push({kind:'fetch',target:url===signed?'signed':url===signedUrl?'signed-custom':'api',options});
    if(url.startsWith('https://api.cloudflare.com/')){
      assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+database+'/export');
      assert.equal(options.method,'POST');
      assert.equal(options.redirect,'error');
      assert.equal(options.headers.Authorization,'Bearer '+env.EXPORT_D1_API_TOKEN);
      const req=JSON.parse(options.body);
      if (!started){
        started=true;
        assert.deepEqual(req,{output_format:'polling',dump_options:{
          compatibility:'d1',tables:['knowledge_instance','knowledge_pages','knowledge_revisions'],
        }});
        return Response.json({success:true,result:{at_bookmark:bookmark}});
      }
      assert.deepEqual(req,{current_bookmark:bookmark});
      polls++;
      return Response.json({success:true,result:polls<=pending?{}:{at_bookmark:bookmark,signed_url:signedUrl}});
    }
    assert.equal(url,signedUrl);
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    return new Response(downloadBytes,{headers:{'content-length':String(bodyLength)}});
  };
  return {env,step,fetchImpl,operations,saved,bucket,
    fixedLengthStreamFactory:()=>new TransformStream(),
    stats:()=>({polls,puts,gets,deletes})};
}

test('separate Workflow stores one bounded point-in-time SQL export and reads back SHA-256',async()=>{
  const f=fixture({pending:2});
  const report=await runConsistentD1Export(f);
  assert.equal(report.status,'STORED');
  assert.equal(report.format,CONSISTENT_EXPORT_FORMAT);
  assert.equal(report.bookmark,bookmark);
  assert.equal(report.scope,'personal');
  assert.equal(report.keyId,'owner-v1');
  assert.equal(report.bytes,bytes.length);
  assert.equal(report.sha256,digest);
  assert.match(report.objectKey,/^consistent\/personal\/owner-v1\/.+\.sql$/);
  assert.deepEqual(f.saved.get(report.objectKey),bytes);
  assert.deepEqual(f.stats(),{polls:3,puts:1,gets:1,deletes:0});
  assert.equal(f.operations.filter(x=>x.kind==='sleep').length,2);
  assert.ok(f.operations.every(x=>!JSON.stringify(x).includes('Fictional acceptance record')));
  assert.ok(!JSON.stringify(report).includes('X-Amz-Signature'));
  assert.ok(!JSON.stringify(report).includes(f.env.EXPORT_D1_API_TOKEN));
});

test('all privileged access fails closed until separately acknowledged',async()=>{
  const invalid=[
    {CONSISTENT_EXPORT_ACK:undefined},
    {KNOWLEDGE_DATA_KEY:'should-not-be-bound'},
    {KNOWLEDGE_PRIVATE_WRITE_ACK:'DRAFT_CAPTURE_ALLOWED'},
    {EXPORT_ACCOUNT_ID:'not-an-account'},
    {EXPORT_DATABASE_ID:'not-a-database'},
    {EXPORT_SCOPE:'invalid/name'},
    {EXPORT_KEY_ID:'Key ID'},
    {EXPORT_SIGNED_HOST:'localhost'},
    {EXPORT_D1_API_TOKEN:''},
    {EXPORT_BUCKET:null},
  ];
  for(const patch of invalid){
    const f=fixture();
    await assert.rejects(runConsistentD1Export({...f,env:{...f.env,...patch}}),
      /CONSISTENT_EXPORT_REFUSED/);
    assert.equal(f.operations.length,0);
  }
});

test('unexpected or redirected download URLs never reach the network or R2',async()=>{
  for(const untrusted of [
    'http://synthetic-export.r2.cloudflarestorage.com/private.sql',
    'https://127.0.0.1/private.sql',
    'https://synthetic-export.r2.cloudflarestorage.com.evil.test/unsafe.sql',
    'https://user:password@synthetic-export.r2.cloudflarestorage.com/private.sql',
    'https://synthetic-export.r2.cloudflarestorage.com:8443/private.sql',
    'https://synthetic-export.r2.cloudflarestorage.com/private.sql#fragment',
  ]){
    const f=fixture({signedUrl:untrusted});
    await assert.rejects(runConsistentD1Export(f),/CONSISTENT_EXPORT_REFUSED/);
    assert.equal(f.stats().puts,0);
    assert.equal(f.operations.filter(x=>x.kind==='fetch').length,2);
  }
});

test('missing Content-Length, oversized and truncated export are never accepted',async()=>{
  const f=fixture({bodyLength:CONSISTENT_EXPORT_LIMIT+1});
  await assert.rejects(runConsistentD1Export(f),/CONSISTENT_EXPORT_REFUSED/);
  assert.equal(f.stats().puts,0);
  const truncated=fixture({bodyLength:bytes.length+1});
  await assert.rejects(runConsistentD1Export(truncated),/CONSISTENT_EXPORT_REFUSED/);
  assert.equal(truncated.stats().puts,1);
  assert.equal(truncated.stats().gets,0);
});

test('independent R2 readback detects tampering and never deletes the stored export',async()=>{
  const f=fixture();
  const originalGet=f.bucket.get;
  f.bucket.get=async key=>{
    const object=await originalGet(key);
    const changed=Uint8Array.from(bytes);changed[0]^=1;
    return {...object,body:new Response(changed).body};
  };
  await assert.rejects(runConsistentD1Export(f),/CONSISTENT_EXPORT_REFUSED/);
  assert.equal(f.stats().puts,1);
  assert.equal(f.stats().deletes,0);
});

test('immutable object collision refuses overwrite and no extra copies are created',async()=>{
  const f=fixture();
  f.bucket.put=async(_key,stream)=>{
    await new Response(stream).arrayBuffer();
    return null;
  };
  await assert.rejects(runConsistentD1Export(f),/CONSISTENT_EXPORT_REFUSED/);
  assert.equal(f.saved.size,0);
});

test('unready export stops after bounded polling; no stored partial backup',async()=>{
  const f=fixture({pending:30});
  await assert.rejects(runConsistentD1Export(f),/CONSISTENT_EXPORT_NOT_READY/);
  assert.equal(f.stats().polls,20);
  assert.equal(f.stats().puts,0);
  assert.equal(f.operations.filter(x=>x.kind==='sleep').length,19);
});

test('provider download without Content-Length is refused before uploading',async()=>{
  const f=fixture(),original=f.fetchImpl;
  f.fetchImpl=async(url,options)=>url===signed?new Response(bytes):original(url,options);
  await assert.rejects(runConsistentD1Export(f),/CONSISTENT_EXPORT_REFUSED/);
  assert.equal(f.stats().puts,0);
});

test('signed download network errors are sanitized without credential URLs',async()=>{
  const f=fixture(),original=f.fetchImpl;
  f.fetchImpl=async(url,options)=>{
    if(url===signed)throw new Error('dangerously includes '+signed);
    return original(url,options);
  };
  await assert.rejects(runConsistentD1Export(f),e=>
    e.message==='KNOWLEDGE_CONSISTENT_EXPORT_REFUSED');
  assert.equal(f.stats().puts,0);
});

test('Cloudflare API failure, missing identity and changed bookmark are refused',async()=>{
  const f=fixture();
  const original=f.fetchImpl;
  let called=0;
  f.fetchImpl=async(url,opts)=>{
    called++;
    if(called===1)return Response.json({success:false,errors:[{message:'fictional'}],result:null});
    return original(url,opts);
  };
  await assert.rejects(runConsistentD1Export(f),/CONSISTENT_EXPORT_REFUSED/);
  assert.equal(f.stats().puts,0);

  const g=fixture();
  const originalG=g.fetchImpl;let count=0;
  g.fetchImpl=async(url,opts)=>{
    count++;
    if(count===2)return Response.json({success:true,result:{at_bookmark:'ffffffff-ffffffff-ffffffff-ffffffffffffffff'}});
    return originalG(url,opts);
  };
  await assert.rejects(runConsistentD1Export(g),/CONSISTENT_EXPORT_REFUSED/);
  assert.equal(g.stats().puts,0);
});
