import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerMarkdownDownloadResponse} from '../src/forward-private-download.mjs';
import {renderOwnerPage,renderOwnerExplorer} from '../src/forward-private-browser.mjs';

const sample={
 path:'projects/secure/meeting-notes',title:'Not included in file header',
 version:3,status:'draft',
 body:'# Exact original Markdown\n\n**One** source of truth.\n\n<script>alert(1)</script>\n',
 updatedAt:'2026-11-11T18:00:00.000Z'
};

test('explicit owner download preserves Markdown bytes with safe reversible filename',async()=>{
 const response=ownerMarkdownDownloadResponse(sample);
 assert.equal(response.status,200);
 assert.equal(await response.text(),sample.body);
 assert.match(response.headers.get('content-type'),/text\/markdown; charset=utf-8/);
 assert.equal(response.headers.get('content-disposition'),'attachment; filename="projects__secure__meeting-notes.md"');
 assert.match(response.headers.get('cache-control'),/private, no-store/);
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
 assert.match(response.headers.get('content-security-policy'),/sandbox/);
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
 assert.doesNotMatch(response.headers.get('content-disposition'),/Not included in file header|\r|\n/);
});

test('plaintext export refuses invalid or unbounded records rather than supplying unsafe headers',()=>{
 for(const patch of [
  {path:'../../etc/passwd'},{path:'Projects/Capitalized'},
  {path:'notes/\"evil'},{path:'projects/bad\r\nContent-Type: text/html'},
  {path:'projects/'.concat('x'.repeat(65))},
  {path:'a/'.repeat(9)+'entry'},{path:'a'.repeat(241)},
  {body:'x'.repeat(16385)},{body:null},{version:-1},{version:129},
 ]){
  assert.throws(()=>ownerMarkdownDownloadResponse({...sample,...patch}),/KNOWLEDGE_EXPORT_INVALID_RECORD/);
 }
 assert.equal(ownerMarkdownDownloadResponse({...sample,body:''}).status,200);
});

test('only current records have explicit download navigation; historic copies are not mislabeled',()=>{
 const current=renderOwnerPage(sample,{editable:false});
 assert.match(current,/href="\/wiki\/download\/projects\/secure\/meeting-notes" download>Download \.md<\/a>/);
 assert.match(current,/Downloaded Markdown leaves Knowledge encryption/);
 assert.doesNotMatch(current,/href="\/s\//);
 const historic=renderOwnerPage(sample,{historical:true});
 assert.doesNotMatch(historic,/href="\/wiki\/download\//);
 const explorer=renderOwnerExplorer([sample],{selected:sample,editable:false});
 assert.match(explorer,/href="\/wiki\/download\/projects\/secure\/meeting-notes" download>/);
 assert.match(explorer,/Downloaded Markdown is plaintext on your device/);
});
