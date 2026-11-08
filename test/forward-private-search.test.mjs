import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchTerms,keyedSearchTerms} from '../src/forward-private-search.mjs';
test('search normalizes Unicode words, deduplicates and refuses excess terms without truncation',()=>{
 assert.deepEqual(searchTerms(['ＰＨＯＴＯＮ photon','Transport, café; transport']),['café','photon','transport']);
 assert.deepEqual(searchTerms(['  !!! ']),[]);
 assert.throws(()=>searchTerms(['one two three'],{maximum:2}),{code:'QUOTA_EXCEEDED'});
 assert.throws(()=>searchTerms([null]),{code:'INVALID_INPUT'});
});
test('search indexes bind words to workspace and an independently derived secret key',async()=>{
 const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const other=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const base={key,space:'personal',terms:['photon','transport']};
 const tokens=await keyedSearchTerms(base);
 assert.ok(tokens.every(t=>/^[A-Za-z0-9_-]{43}$/.test(t)));
 assert.deepEqual(await keyedSearchTerms(base),tokens);
 assert.notDeepEqual(await keyedSearchTerms({...base,space:'anevum'}),tokens);
 assert.notDeepEqual(await keyedSearchTerms({...base,key:other}),tokens);
 assert.doesNotMatch(JSON.stringify(tokens),/photon|transport/);
});
