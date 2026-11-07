/**
 * Wiki taxonomy from the established Workspace Encyclopedia editorial handbook.
 * Colors identify navigation domains; they never authorize cross-workspace reads.
 * Record taxonomy and engineering lifecycle are separate from fiction canon.
 */
export const PORTALS=Object.freeze([
 {id:'personal-family',label:'Personal and family',color:'green',scopes:['personal','family']},
 {id:'cristy-professional',label:'Professional operations',color:'blue',scopes:['cristy']},
 {id:'independent-software',label:'Independent software',color:'purple',scopes:['devonstation','mizvo']},
 {id:'writing-publishing',label:'Writing and publishing',color:'orange',scopes:['personal','anevum']},
 {id:'anevum-works',label:'Anevum original works',color:'pink',scopes:['anevum']},
 {id:'transcosmic-canon',label:'Transcosmic canon',color:'brown',scopes:['anevum']},
 {id:'portfolio-infrastructure',label:'Portfolio and infrastructure',color:'gray',scopes:['devonstation','mizvo','anevum']}
]);
export const RECORD_TYPES=Object.freeze([
 'encyclopedia','project','product','venture','organization','creative-work',
 'canon','system','decision','chronology','original-document','historical',
 'index','source','evidence','asset','question','proposal'
]);
export const LIFECYCLE_STATUSES=Object.freeze([
 'proposed','locked','active','ready','blocked','parked','backlog',
 'superseded','obsolete','implemented','verified','live','retired','archived'
]);
export const CANON_STATUSES=Object.freeze([
 'source-locked','canonical','working-canon','unresolved','superseded'
]);
export const LINK_KINDS=Object.freeze(['related','supports','supersedes','depends','cites']);
const byId=new Map(PORTALS.map(portal=>[portal.id,portal]));
export const portalById=(id)=>byId.get(id)??null;
export function normalizeTitle(title){
 if(typeof title!=='string')return '';
 return title.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g,' ');
}
export function slugTitle(title){
 if(typeof title!=='string')return '';
 return title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
  .slice(0,60).replace(/-+$/g,'');
}
export function proposedPath(portal,kind,title){
 if(!byId.has(portal)||!RECORD_TYPES.includes(kind))return null;
 const slug=slugTitle(title);
 return slug ? portal+'/'+kind+'/'+slug : null;
}
