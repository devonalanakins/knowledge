/**
 * G14 synthetic-only, owner-local SQLite ledger for used/revoked hierarchy receipts.
 * Stores SHA-256 identifiers and receipt digests, never source text or keys.
 * The hash chain is tamper-evident only if its head is independently anchored.
 * NOT a production trust service or a Notion importer.
 */
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {constants,closeSync,existsSync,lstatSync,openSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {verifyHierarchyApproval} from './hierarchy-approval.mjs';

const ID=/^[a-f0-9]{32}$/;
const SHA=/^[a-f0-9]{64}$/;
const ZERO='0'.repeat(64);
const MAX_EVENTS=10000;
const ACK='SYNTHETIC_ONLY_NO_PRIVATE_DATA';
const hash=input=>createHash('sha256').update(input).digest('hex');
const idHash=id=>hash('Knowledge/approval-id/v1\n'+id);
const eventHash=event=>hash('Knowledge/approval-ledger-event/v1\n'+JSON.stringify(event));

export class ApprovalLedgerError extends Error {
 constructor(code,message){super(message);this.name='ApprovalLedgerError';this.code=code;}
}
function fail(code,message){throw new ApprovalLedgerError(code,message)}
function requireId(value){
 if(typeof value!=='string'||!ID.test(value))fail('INVALID_APPROVAL_ID','Expected canonical 32-hex approval ID');
 return value;
}
function privatePath(filename,readOnly){
 const full=resolve(filename),parent=dirname(full),dir=lstatSync(parent);
 if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0||
    realpathSync(parent)!==parent ||
    (typeof process.getuid==='function'&&dir.uid!==process.getuid()))
   fail('UNSAFE_LEDGER_PATH','Ledger requires an owner-only real directory');
 if(existsSync(full)){
  const stat=lstatSync(full);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
     realpathSync(full)!==full||
     (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
    fail('UNSAFE_LEDGER_PATH','Ledger must be a regular owner-only file');
 }else{
  if(readOnly)fail('LEDGER_MISSING','Review requires an existing protected ledger');
  const fd=openSync(full,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  closeSync(fd);
 }
 return full;
}
function validTime(now){
 if(!Number.isSafeInteger(now)||Math.abs(now)>8.64e15)fail('INVALID_TIME','Expected valid epoch milliseconds');
 return new Date(now).toISOString();
}
export class ApprovalLedger {
 constructor(filename=':memory:',{syntheticOnly=false,readOnly=false}={}){
  if(filename!==':memory:' && (typeof filename!=='string'||!filename.trim()))
   fail('UNSAFE_LEDGER_PATH','Explicit ledger path required');
  if(!readOnly && syntheticOnly!==true)
   fail('SYNTHETIC_ONLY','Live approval storage is not enabled');
  if(readOnly && filename===':memory:')
   fail('LEDGER_MISSING','Read-only ledger requires a preexisting file');
  this.readOnly=readOnly;
  const location=filename===':memory:'?filename:privatePath(filename,readOnly);
  this.db=new DatabaseSync(location,{readOnly});
  try{
   if(!readOnly){
    this.db.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS approval_events(
        seq INTEGER PRIMARY KEY,
        id_hash TEXT NOT NULL UNIQUE CHECK(length(id_hash)=64),
        receipt_hash TEXT NOT NULL CHECK(length(receipt_hash)=64),
        action TEXT NOT NULL CHECK(action IN ('consumed','revoked')),
        recorded_at TEXT NOT NULL,
        previous_hash TEXT NOT NULL CHECK(length(previous_hash)=64),
        event_hash TEXT NOT NULL CHECK(length(event_hash)=64)
      );
      CREATE TRIGGER IF NOT EXISTS approval_events_no_update BEFORE UPDATE ON approval_events
      BEGIN SELECT RAISE(ABORT, 'approval events are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS approval_events_no_delete BEFORE DELETE ON approval_events
      BEGIN SELECT RAISE(ABORT, 'approval events are immutable'); END;
    `);
   }
   if(!this.audit().valid)fail('LEDGER_INTEGRITY','Approval ledger integrity check failed');
  }catch(e){this.db.close();throw e;}
 }
 close(){this.db.close()}
 audit({expectedHead=null}={}){
  const rows=this.db.prepare('SELECT * FROM approval_events ORDER BY seq').all();
  let previous=ZERO;
  let valid=rows.length<=MAX_EVENTS;
  for(let i=0;i<rows.length;i++){
   const row=rows[i];
   const event={seq:row.seq,idHash:row.id_hash,receiptHash:row.receipt_hash,
     action:row.action,recordedAt:row.recorded_at,previousHash:row.previous_hash};
   if(row.seq!==i+1||!SHA.test(row.id_hash)||!SHA.test(row.receipt_hash)||
      !['consumed','revoked'].includes(row.action)||
      typeof row.recorded_at!=='string'||!Number.isFinite(Date.parse(row.recorded_at))||
      new Date(row.recorded_at).toISOString()!==row.recorded_at||
      row.previous_hash!==previous||row.event_hash!==eventHash(event))valid=false;
   previous=row.event_hash;
  }
  if(expectedHead!==null&&expectedHead!==previous)valid=false;
  return {valid,count:rows.length,headHash:previous};
 }
 status(approvalId){
  const id=idHash(requireId(approvalId));
  const row=this.db.prepare('SELECT action FROM approval_events WHERE id_hash=?').get(id);
  return row?.action??null;
 }
 isFinalized(approvalId){return this.status(approvalId)!==null}
 #append(approvalId,action,receiptHash,now){
  if(this.readOnly)fail('READ_ONLY','Cannot modify a review-only ledger');
  const recordTime=validTime(now);
  const id=idHash(requireId(approvalId));
  if(!SHA.test(receiptHash))fail('INVALID_RECEIPT','Invalid receipt digest');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const audit=this.audit();
   if(!audit.valid)fail('LEDGER_INTEGRITY','Approval ledger integrity check failed');
   if(audit.count>=MAX_EVENTS)fail('LEDGER_FULL','Approval ledger is full');
   if(this.db.prepare('SELECT 1 FROM approval_events WHERE id_hash=?').get(id))
    fail('ALREADY_FINALIZED','Approval has already been consumed or revoked');
   const event={seq:audit.count+1,idHash:id,receiptHash,action,
     recordedAt:recordTime,previousHash:audit.headHash};
   const digest=eventHash(event);
   this.db.prepare(`INSERT INTO approval_events
      (seq,id_hash,receipt_hash,action,recorded_at,previous_hash,event_hash)
      VALUES (?,?,?,?,?,?,?)`).run(event.seq,id,receiptHash,action,recordTime,event.previousHash,digest);
   this.db.exec('COMMIT');
   return {recorded:true,action,headHash:digest,count:event.seq};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 /**
  * Only a future, independently authorized importer may consume a real receipt
  * at commit time. This local synthetic API records no Notion content.
  */
 consume(receipt,expected,trustedReviewers,{now=Date.now()}={}){
  if(!verifyHierarchyApproval(receipt,expected,trustedReviewers,{now})||
     this.isFinalized(receipt?.approvalId))
   fail('UNVERIFIED_APPROVAL','Signed approval is invalid or already finalized');
  return this.#append(receipt.approvalId,'consumed',hash(JSON.stringify(receipt)),now);
 }
 /** Local owner-restricted revocation, not a network permission endpoint. */
 revoke(approvalId,{now=Date.now()}={}){
  return this.#append(approvalId,'revoked',ZERO,now);
 }
}
