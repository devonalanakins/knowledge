import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPageCursor,readPageCursor} from '../src/forward-page-cursor.mjs';
const scope='personal',keyId='owner-v1',after='A'.repeat(43),now=1_800_000_000_000;
const makeKey=()=>crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
test('cursor is opaque, randomized and bound to workspace, key and expiry',async()=>{
 const key=await makeKey();
 const base={key,scope,keyId,after,now};
 const cursor=await createPageCursor(base);
 assert.notEqual(cursor,await createPageCursor(base));
 assert.ok(!Buffer.from(cursor,'base64url').includes(Buffer.from(after)));
 assert.equal(await readPageCursor({...base,cursor}),after);
 for(const changed of [{scope:'anevum'},{keyId:'v2'},{key:await makeKey()},
   {now:now+86_400_000},{now:now-1},{cursor:cursor.slice(0,-4)+'AAAA'},
   {cursor:''},{cursor:'x'.repeat(513)},{cursor:'../bad'}]){
   await assert.rejects(readPageCursor({...base,cursor,...changed}),{code:'INVALID_INPUT'});
 }
});
