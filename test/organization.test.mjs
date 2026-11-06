import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PORTALS,normalizeTitle,slugTitle,proposedPath} from '../src/wiki-taxonomy.mjs';
import {planOrganizedMigration} from '../src/organization.mjs';

const A='11111111111111111111111111111111';
const B='22222222222222222222222222222222';
const C='33333333333333333333333333333333';
const hash='a'.repeat(64);
function fixture(){
 const preflight={format:'knowledge-notion-preflight-v1',summary:{workspaceCoverageVerified:true},
  entries:[
   {originalNotionId:A,parentNotionId:null,type:'markdown',sha256:hash,bytes:120,missingLocalLinks:0,remoteNotionLinks:0},
   {originalNotionId:B,parentNotionId:A,type:'markdown',sha256:hash,bytes:80,missingLocalLinks:0,remoteNotionLinks:0},
   {originalNotionId:C,parentNotionId:null,type:'markdown',sha256:hash,bytes:200,missingLocalLinks:0,remoteNotionLinks:0}
  ]};
 const inventory={format:'knowledge-notion-inventory-v1',enumerationComplete:true,records:[
   {id:A,kind:'page',scope:'devonstation',accessible:true},
   {id:B,kind:'page',scope:'devonstation',accessible:true},
   {id:C,kind:'page',scope:'anevum',accessible:true}
  ]};
 const classifications=[
   {id:A,portal:'independent-software',recordType:'project',title:'Knowledge',
     sourceUrl:'https://example.org/knowledge',status:'active',links:[{targetId:B,type:'related'}]},
   {id:B,portal:'independent-software',recordType:'evidence',title:'Source evidence',
     parentId:A,sourceUrl:'https://example.org/evidence',status:'verified',links:[{targetId:A,type:'supports'}]},
   {id:C,portal:'transcosmic-canon',recordType:'canon',title:'First Crossing',
     sourceUrl:'https://example.org/canon',status:'locked',canonStatus:'source-locked',links:[]}
 ];
 return {preflight,inventory,classifications};
}
const codes=report=>report.findings.map(f=>f.code);

test('matches established seven portal colors, fixed record vocabulary and stable slugs',()=>{
 assert.deepEqual(PORTALS.map(p=>p.color),['green','blue','purple','orange','pink','brown','gray']);
 assert.equal(normalizeTitle('  FOO   Bar  '),'foo bar');
 assert.equal(slugTitle('First Crossing — Theory'),'first-crossing-theory');
 assert.equal(proposedPath('transcosmic-canon','canon','First Crossing'),
   'transcosmic-canon/canon/first-crossing');
 assert.equal(proposedPath('undefined','canon','First Crossing'),null);
 assert.equal(proposedPath('personal-family','invalid','First Crossing'),null);
 assert.equal(proposedPath('personal-family','project',''),null);
});

test('constructs a read-only migration preview with hierarchy, provenance and incoming backlinks',()=>{
 const report=planOrganizedMigration(fixture());
 assert.equal(report.format,'knowledge-organization-review-v1');
 assert.equal(report.mode,'METADATA_ONLY_PRIVATE_REVIEW');
 assert.equal(report.blockingFindings,0);
 assert.equal(report.imported,false);
 assert.equal(report.cutoverApproved,false);
 assert.equal(report.nodes.length,3);
 assert.equal(report.counts['independent-software'],2);
 assert.equal(report.counts['transcosmic-canon'],1);
 assert.equal(report.nodes.find(n=>n.id===C).color,'brown');
 assert.equal(report.nodes.find(n=>n.id===B).parentId,A);
 assert.ok(report.edges.some(x=>x.type==='contains'&&x.from===A&&x.to===B));
 assert.ok(report.nodes.find(n=>n.id===A).backlinks.some(x=>x.from===B&&x.type==='supports'));
 assert.ok(report.nodes.find(n=>n.id===B).backlinks.some(x=>x.from===A&&x.type==='contains'));
 assert.ok(report.findings.some(x=>x.code==='POSSIBLE_ORPHAN'&&x.id===C));
});

test('flags duplicate subjects and alias collisions without combining source IDs',()=>{
 const fx=fixture();fx.classifications[1].recordType='project';
 fx.classifications[1].title='Knowledge';
 fx.classifications[1].aliases=['Know-Ledge'];
 fx.classifications[0].aliases=['Know-Ledge'];
 const report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('POSSIBLE_DUPLICATE_SUBJECT'));
 assert.ok(codes(report).includes('CANONICAL_PATH_COLLISION'));
 assert.ok(codes(report).includes('ALIAS_COLLISION'));
 assert.equal(report.nodes.length,3,'No source ID is lost or merged');
 assert.ok(report.blockingFindings>0);
});

test('different registers for the same subject are linked for review, not falsely deduplicated',()=>{
 const fx=fixture();fx.classifications[1].title='Knowledge';
 const report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('RELATED_SUBJECT_DIFFERENT_REGISTER'));
 assert.ok(!codes(report).includes('POSSIBLE_DUPLICATE_SUBJECT'));
 assert.ok(!codes(report).includes('CANONICAL_PATH_COLLISION'));
});

test('requires explicit boundaries and never creates cross-scope backlinks',()=>{
 const fx=fixture();
 fx.classifications[0].links.push({targetId:C,type:'related'});
 fx.classifications[2].canonStatus='';fx.classifications[2].portal='personal-family';
 const report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('CROSS_SCOPE_LINK_FORBIDDEN'));
 assert.ok(codes(report).includes('PORTAL_SCOPE_MISMATCH'));
 assert.ok(!report.edges.some(e=>e.from===A&&e.to===C));
 assert.equal(report.nodes.find(n=>n.id===C).backlinks.length,0);
});

test('enforces distinct fictional canon authority independently of engineering lifecycle',()=>{
 const fx=fixture();
 delete fx.classifications[2].canonStatus;
 const report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('CANON_AUTHORITY_REVIEW_REQUIRED'));
 assert.equal(report.nodes.find(n=>n.id===C).status,'locked');
 assert.notEqual(report.nodes.find(n=>n.id===C).canonStatus,'source-locked');
});

test('broken parent references, cyclic hierarchy, unreviewed structure and missing classifications block',()=>{
 const fx=fixture();
 fx.classifications[0].parentId=B;fx.classifications[1].parentId=A;
 fx.classifications[1].links.push({targetId:'44444444444444444444444444444444',type:'depends'});
 fx.classifications.pop();
 const report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('HIERARCHY_CYCLE'));
 assert.ok(codes(report).includes('UNRESOLVED_REFERENCE'));
 assert.ok(codes(report).includes('UNCLASSIFIED_SOURCE'));
 assert.ok(report.blockingFindings>=3);
});

test('incomplete export coverage, wrong source IDs, inaccessible records and unsupported formats block',()=>{
 const fx=fixture();
 fx.preflight.summary.workspaceCoverageVerified=false;
 fx.preflight.entries[0].type='html';
 fx.preflight.entries[1].missingLocalLinks=2;
 fx.preflight.entries[2].sha256='corrupt';
 fx.inventory.records[2].accessible=false;
 fx.inventory.enumerationComplete=false;
 const report=planOrganizedMigration(fx);
 for(const code of ['UNCERTIFIED_EXPORT_COVERAGE','NON_MARKDOWN_FIDELITY_REVIEW',
   'BROKEN_OR_UNRESOLVED_SOURCE_LINKS','INVALID_EXPORT_FINGERPRINT',
   'UNVERIFIED_SOURCE_ACCESS_OR_SCOPE','INCOMPLETE_INVENTORY']){
   assert.ok(codes(report).includes(code),code);
 }
 assert.equal(report.cutoverApproved,false);
});

test('identical Notion IDs in separate exports or inventories are never silently collapsed',()=>{
 const fx=fixture();
 fx.preflight.entries.push({...fx.preflight.entries[0]});
 fx.inventory.records.push({...fx.inventory.records[0]});
 fx.classifications.push({...fx.classifications[0]});
 const report=planOrganizedMigration(fx);
 for(const code of ['DUPLICATE_EXPORTED_ID','DUPLICATE_INVENTORY_ID','DUPLICATE_CLASSIFICATION_ID'])
   assert.ok(codes(report).includes(code));
});

test('notebook or patient text in malicious manifest is never copied into organizational preview',()=>{
 const fx=fixture();const secret='PRIVATE_SYNTHETIC_BODY_EXCLUDED';
 fx.preflight.entries[0].sourceText=secret;
 fx.inventory.records[0].notes=secret;
 fx.classifications[0].body=secret;
 const report=planOrganizedMigration(fx);
 assert.equal(JSON.stringify(report).includes(secret),false);
 assert.equal(report.imported,false);
});

test('rejects malformed or overlarge schema input before processing',()=>{
 for(const input of [{}, {preflight:{},inventory:{}},{
  preflight:{format:'knowledge-notion-preflight-v1',entries:[],summary:{}},
  inventory:{format:'knowledge-notion-inventory-v1',records:[]},
  classifications:null
 }])assert.throws(()=>planOrganizedMigration(input),TypeError);
});

test('malformed classifications fail closed as review findings instead of crashing or inventing paths',()=>{
 const fx=fixture();fx.classifications[0].title=null;
 fx.classifications[0].recordType='unrecognized';
 fx.classifications[0].aliases=['a'.repeat(250)];
 const result=planOrganizedMigration(fx);
 for(const code of ['UNKNOWN_RECORD_TYPE','INVALID_TITLE','INVALID_PROPOSED_PATH','INVALID_ALIAS'])
   assert.ok(codes(result).includes(code),code);
 assert.equal(result.nodes.find(n=>n.id===A).path,null);
 assert.equal(result.cutoverApproved,false);
});

test('a formerly root Notion page cannot be silently reparented under a new article',()=>{
 const fx=fixture();fx.classifications[2].parentId=A;
 const report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('UNREVIEWED_SOURCE_HIERARCHY'));
 assert.ok(codes(report).includes('CROSS_SCOPE_LINK_FORBIDDEN'));
 assert.ok(report.blockingFindings>0);
});
test('an existing Notion parent cannot be silently removed',()=>{
 const fx=fixture();delete fx.classifications[1].parentId;
 const report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('UNREVIEWED_SOURCE_HIERARCHY'));
});
test('an explicitly reviewed reparent requires a substantive reason',()=>{
 const fx=fixture();delete fx.classifications[1].parentId;
 fx.classifications[1].parentChangeApproved=true;
 let report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('UNJUSTIFIED_HIERARCHY_CHANGE'));
 fx.classifications[1].parentChangeReason='Owner-approved move from old evidence folder into canonical evidence register';
 report=planOrganizedMigration(fx);
 assert.ok(!codes(report).includes('UNREVIEWED_SOURCE_HIERARCHY'));
 assert.ok(!codes(report).includes('UNJUSTIFIED_HIERARCHY_CHANGE'));
});
test('invalid original parent identity is a blocking migration finding',()=>{
 const fx=fixture();fx.preflight.entries[1].parentNotionId='not-a-notion-id';
 const report=planOrganizedMigration(fx);
 assert.ok(codes(report).includes('INVALID_SOURCE_PARENT_ID'));
 assert.ok(codes(report).includes('UNREVIEWED_SOURCE_HIERARCHY'));
});
