import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, access, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectNotionExport } from '../src/notion-export.mjs';
import { stageSyntheticOriginalCapsules, readSyntheticOriginalCapsule } from '../src/original-capsules.mjs';

const A='a'.repeat(32), B='b'.repeat(32);
const secret='synthetic high entropy archival passphrase 0123456789 9876543210';
async function seed(){
  const outer=await mkdtemp(join(tmpdir(),'knowledge-g7-'));
  const root=join(outer,'export'); await mkdir(root);
  const parent=join(outer,'protected'); await mkdir(parent,{mode:0o700});
  const docs=[
    {id:A,path:'Notion '+A+'.md',text:'# SYNTHETIC FIXTURE\nOriginal one; not for the active wiki.'},
    {id:B,path:'Notion '+B+'.md',text:'# SYNTHETIC FIXTURE\nOriginal two in a separate scope.'}
  ];
  for(const d of docs)await writeFile(join(root,d.path),d.text,{mode:0o600});
  const preflight=await inspectNotionExport(root);
  const inventory={format:'knowledge-notion-inventory-v1',enumerationComplete:true,records:[
    {id:A,scope:'devonstation',kind:'page',accessible:true},
    {id:B,scope:'family',kind:'page',accessible:true}
  ]};
  const outputDir=join(parent,'capsules');
  return {outer,root,parent,docs,preflight,inventory,outputDir};
}
function stage(fx,overrides={}){
  return {root:fx.root,preflight:fx.preflight,inventory:fx.inventory,scope:'devonstation',selectedIds:[A],outputDir:fx.outputDir,passphrase:secret,syntheticOnly:true,...overrides};
}
function read(fx,overrides={}){
  return {file:join(fx.outputDir,A+'.source.enc'),passphrase:secret,expectedScope:'devonstation',expectedNotionId:A,expectedSha256:createHash('sha256').update(fx.docs[0].text).digest('hex'),...overrides};
}

test('G7 encrypted original can be recovered after plaintext source export disappears',async()=>{
  const fx=await seed();
  const data=await stageSyntheticOriginalCapsules(stage(fx));
  assert.equal(data.encryptedOriginals,1); assert.equal(data.privateDataImported,false);
  assert.deepEqual(await readdir(fx.outputDir),[A+'.source.enc']);
  const file=join(fx.outputDir,A+'.source.enc');
  assert.equal((await stat(file)).mode&0o777,0o600);
  assert.equal((await stat(fx.outputDir)).mode&0o777,0o700);
  assert.equal((await readFile(file,'utf8')).includes(fx.docs[0].text),false);
  await rm(fx.root,{recursive:true,force:true});
  const restored=await readSyntheticOriginalCapsule(read(fx));
  assert.equal(restored.text,fx.docs[0].text); assert.equal(restored.scope,'devonstation');
  assert.equal(restored.originalNotionId,A);
});

test('G7 rejects incorrect scope, ID, source hash, key, altered ciphertext and symlink',async()=>{
  const fx=await seed(); await stageSyntheticOriginalCapsules(stage(fx));
  await assert.rejects(()=>readSyntheticOriginalCapsule(read(fx,{expectedScope:'family'})),{code:'INVALID_CAPSULE'});
  await assert.rejects(()=>readSyntheticOriginalCapsule(read(fx,{expectedNotionId:B})),{code:'INVALID_CAPSULE'});
  await assert.rejects(()=>readSyntheticOriginalCapsule(read(fx,{expectedSha256:'e'.repeat(64)})),{code:'INVALID_CAPSULE'});
  await assert.rejects(()=>readSyntheticOriginalCapsule(read(fx,{passphrase:'incorrect but long and independent passphrase'})),{code:'INVALID_CAPSULE'});
  const path=join(fx.outputDir,A+'.source.enc'); const data=JSON.parse(await readFile(path,'utf8'));
  data.cipher.tag='A'.repeat(data.cipher.tag.length);
  await writeFile(path,JSON.stringify(data));
  await assert.rejects(()=>readSyntheticOriginalCapsule(read(fx)),{code:'INVALID_CAPSULE'});
  const link=join(fx.outputDir,'shortcut.enc'); await symlink(path,link);
  await assert.rejects(()=>readSyntheticOriginalCapsule(read(fx,{file:link})),{code:'UNSAFE_SOURCE'});
});

test('G7 fails closed on real data, cross-scope attempts, unsafe target and no-clobber',async()=>{
  const fx=await seed();
  await assert.rejects(()=>stageSyntheticOriginalCapsules(stage(fx,{syntheticOnly:false})),{code:'PRIVATE_DATA_BLOCKED'});
  await assert.rejects(()=>stageSyntheticOriginalCapsules(stage(fx,{selectedIds:[B]})),{code:'SCOPE_DENIED'});
  await assert.rejects(()=>stageSyntheticOriginalCapsules(stage(fx,{outputDir:join(fx.root,'capsules')})),{code:'UNSAFE_DESTINATION'});
  const before=await readFile(join(fx.root,fx.docs[0].path));
  await stageSyntheticOriginalCapsules(stage(fx));
  await assert.rejects(()=>stageSyntheticOriginalCapsules(stage(fx)),{code:'EEXIST'});
  assert.deepEqual(await readFile(join(fx.root,fx.docs[0].path)),before);
  const sibling=join(fx.parent,'existing'); await mkdir(sibling);
  await assert.rejects(()=>stageSyntheticOriginalCapsules(stage(fx,{outputDir:sibling})),{code:'EEXIST'});
  assert.deepEqual(await readdir(sibling),[]);
});

test('G7 rejects modified originals before creating a capsule directory',async()=>{
  const fx=await seed(); await writeFile(join(fx.root,fx.docs[0].path),'# SYNTHETIC FIXTURE\nChanged after inspection');
  await assert.rejects(()=>stageSyntheticOriginalCapsules(stage(fx)),{code:'SOURCE_CHANGED'});
  await assert.rejects(()=>access(fx.outputDir));
});

test('G7 supports separate scope without revealing it under another scope',async()=>{
  const fx=await seed(), familyDir=join(fx.parent,'family');
  await stageSyntheticOriginalCapsules(stage(fx,{scope:'family',selectedIds:[B],outputDir:familyDir}));
  const digest=createHash('sha256').update(fx.docs[1].text).digest('hex');
  const family={file:join(familyDir,B+'.source.enc'),passphrase:secret,expectedScope:'family',expectedNotionId:B,expectedSha256:digest};
  const original=await readSyntheticOriginalCapsule(family); assert.equal(original.text,fx.docs[1].text);
  await assert.rejects(()=>readSyntheticOriginalCapsule({...family,expectedScope:'devonstation'}),{code:'INVALID_CAPSULE'});
});
