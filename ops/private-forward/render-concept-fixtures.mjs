/** Generate entirely synthetic static Knowledge HTML for browser layout review.
 * No credentials, provider requests, private records or external data.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {renderOwnerExplorer,renderOwnerLibrary} from '../../src/forward-private-browser.mjs';

const out=process.argv[2];
if(!out||out==='/'||out==='.')throw new Error('Expected an explicit output folder');
const folder=path.resolve(out);
await mkdir(folder,{recursive:true,mode:0o700});
const records=[
  {path:'projects/release-readiness',title:'Release readiness',version:3,updatedAt:'2026-11-11T16:15:00Z',
   body:'# Decision\n\n**Proceed to release with conditions.** This synthetic record tracks evidence, review and final authorization.\n\n## Acceptance checklist\n\n- Source and implementation complete\n- Test evidence linked to release\n- Accessibility and performance review pending\n- Owner release sign-off pending\n\n## Attached materials\n\nExample documentation links stay within the private workspace: [[projects/product-design-principles|Design principles]].'},
  {path:'projects/operating-decision',title:'Operating decision — priorities',version:2,updatedAt:'2026-11-10T12:30:00Z',body:'# Decision\n\nPrioritize secure completion and review.'},
  {path:'projects/product-design-principles',title:'Product design principles',version:1,updatedAt:'2026-11-09T16:45:00Z',body:'# Principles\n\nClarity, reliability, security and accessibility.'},
  {path:'projects/architecture-notes',title:'Architecture notes',version:4,updatedAt:'2026-11-08T09:15:00Z',body:'# Architecture\n\nIndependent scope, encrypted records, tested recovery.'},
  {path:'projects/project-assets',title:'Project assets',version:1,updatedAt:'2026-11-07T08:00:00Z',body:'# Assets\n\nReferenced files remain private.'},
  {path:'projects/operations-playbook',title:'Operations playbook',version:1,updatedAt:'2026-11-06T12:00:00Z',body:'# Operations\n\nInstructions with provenance.'}
];
const html={
  'desktop-selected.html':renderOwnerExplorer(records,{selected:records[0],editable:true,previewEnabled:false}),
  'mobile-browse.html':renderOwnerExplorer(records,{editable:false,previewEnabled:false}),
  'mobile-read.html':renderOwnerExplorer(records,{selected:records[0],editable:false,previewEnabled:false}),
  'library.html':renderOwnerLibrary(records,{editable:false})
};
for(const [name,document] of Object.entries(html)){
 if(/DEVONSTATION|Akins Works|Nona Neuropsychology/.test(document))throw new Error('Unapproved identity in fixture');
 if(/<script\b/i.test(document))throw new Error('Unexpected client script');
 await writeFile(path.join(folder,name),document,{mode:0o600});
}
process.stdout.write('Generated '+Object.keys(html).length+' synthetic private HTML pages in '+folder+'\n');
