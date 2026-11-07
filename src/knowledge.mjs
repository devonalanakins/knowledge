/**
 * Knowledge's portable single-process storage foundation.
 * Local trusted-operator API only: not an authenticated network service.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { lstatSync, existsSync, chmodSync } from 'node:fs';
import { KnowledgeError } from './errors.mjs';
export { KnowledgeError } from './errors.mjs';

const KINDS = new Set(['article', 'note', 'source', 'decision', 'proposal', 'evidence']);
const STATUSES = new Set(['draft', 'recorded', 'proposed', 'parked', 'superseded']);
const LINK_KINDS = new Set(['relates', 'supports', 'supersedes', 'depends']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SPACE_RE = /^[a-z][a-z0-9-]{0,63}$/;
const WIKI_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BODY = 100_000;
// Short GPT-written wiki summaries; source documents remain in their owning systems.
export const MAX_CAPTURE_BODY_BYTES = 16 * 1024;
export const MAX_CAPTURE_PAGES_PER_SPACE = 5000;
export const MAX_CAPTURE_REVISIONS = 128;
export const DEFAULT_SPACE_TEXT_BUDGET_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT = 25_000_000;

function requireValid(value, message) {
  if (!value) throw new KnowledgeError('INVALID_INPUT', message);
}

function spaceId(id) {
  requireValid(typeof id === 'string' && SPACE_RE.test(id), 'Invalid workspace identifier');
  return id;
}
export function wikiPath(path) {
  requireValid(typeof path === 'string' && path.length >= 1 && path.length <= 240 &&
    path.split('/').length <= 8 && path.split('/').every((part) => WIKI_SEGMENT.test(part)),
  'Wiki path must be 1-8 lowercase slug segments');
  return path;
}
function recordId(id) {
  requireValid(typeof id === 'string' && UUID_RE.test(id), 'Invalid record identifier');
  return id;
}
function label(value) {
  requireValid(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160, 'Title/label must be 1-160 characters');
  return value.trim();
}
function bodyText(value) {
  requireValid(typeof value === 'string' && value.length <= MAX_BODY, `Body must be text of at most ${MAX_BODY} characters`);
  return value;
}
function sourceUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  requireValid(typeof value === 'string' && value.length <= 2048, 'Invalid source URL');
  try {
    const url = new URL(value);
    requireValid(url.protocol === 'https:' && !!url.hostname && !url.username && !url.password, 'Source URL must be HTTPS without embedded credentials');
    return value;
  } catch (error) {
    if (error instanceof KnowledgeError) throw error;
    throw new KnowledgeError('INVALID_INPUT', 'Invalid source URL');
  }
}
function oneOf(value, options, type) {
  requireValid(options.has(value), `Invalid ${type}`);
  return value;
}
function iso(value) {
  requireValid(typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value, 'Invalid ISO timestamp');
  return value;
}
function fields(input, defaults = false) {
  requireValid(input && typeof input === 'object' && !Array.isArray(input), 'Record input must be an object');
  const keys = Object.keys(input);
  requireValid(keys.every((key) => ['kind', 'title', 'body', 'status', 'sourceUrl'].includes(key)), 'Unknown record property');
  const result = {};
  if ('kind' in input || defaults) result.kind = oneOf(input.kind ?? 'article', KINDS, 'record kind');
  if ('title' in input || defaults) result.title = label(input.title);
  if ('body' in input || defaults) result.body = bodyText(input.body ?? '');
  if ('status' in input || defaults) result.status = oneOf(input.status ?? 'draft', STATUSES, 'record status');
  if ('sourceUrl' in input || defaults) result.sourceUrl = sourceUrl(input.sourceUrl);
  requireValid(Object.keys(result).length > 0, 'No record changes supplied');
  return result;
}
function mapRecord(row) {
  if (!row) return null;
  return {
    id: row.id, spaceId: row.space_id, kind: row.kind, title: row.title,
    body: row.body, status: row.status, sourceUrl: row.source_url,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function mapRevision(row) {
  return {
    recordId: row.record_id, version: row.version, kind: row.kind,
    title: row.title, body: row.body, status: row.status,
    sourceUrl: row.source_url, changedAt: row.changed_at,
  };
}
function mapLink(row) {
  return { spaceId: row.space_id, fromId: row.from_id, toId: row.to_id, kind: row.kind, createdAt: row.created_at };
}
function checksum(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export class KnowledgeStore {
  constructor(filename = ':memory:', { maxSpaceTextBytes = DEFAULT_SPACE_TEXT_BUDGET_BYTES } = {}) {
    requireValid(Number.isSafeInteger(maxSpaceTextBytes) && maxSpaceTextBytes >= 1024 && maxSpaceTextBytes <= 1024 * 1024 * 1024, 'Invalid storage budget');
    this.maxSpaceTextBytes = maxSpaceTextBytes;
    requireValid(typeof filename === 'string' && filename.length > 0, 'Database path is required');
    if (filename !== ':memory:' && existsSync(filename)) {
      requireValid(!lstatSync(filename).isSymbolicLink(), 'Database cannot be a symbolic link');
    }
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      -- Checkpoint more frequently to reduce ordinary WAL growth.
      -- These are maintenance targets, not hard physical disk quotas.
      PRAGMA wal_autocheckpoint = 64;
      PRAGMA journal_size_limit = 1048576;
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY, label TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL CHECK(kind IN ('article','note','source','decision','proposal','evidence')),
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
        body TEXT NOT NULL CHECK(length(body) <= 100000),
        status TEXT NOT NULL CHECK(status IN ('draft','recorded','proposed','parked','superseded')),
        source_url TEXT, version INTEGER NOT NULL CHECK(version >= 1),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(space_id, id)
      );
      CREATE INDEX IF NOT EXISTS records_by_space ON records(space_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS wiki_pages (
        space_id TEXT NOT NULL, path TEXT NOT NULL, record_id TEXT NOT NULL,
        PRIMARY KEY(space_id, path), UNIQUE(record_id),
        FOREIGN KEY(space_id, record_id) REFERENCES records(space_id, id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS shared_pages (
        token_hash TEXT PRIMARY KEY, space_id TEXT NOT NULL, record_id TEXT NOT NULL,
        shared_version INTEGER NOT NULL CHECK(shared_version >= 1),
        created_at TEXT NOT NULL, revoked_at TEXT,
        FOREIGN KEY(space_id, record_id) REFERENCES records(space_id, id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS revisions (
        space_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL,
        kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
        source_url TEXT, changed_at TEXT NOT NULL,
        PRIMARY KEY(record_id, version),
        FOREIGN KEY(space_id, record_id) REFERENCES records(space_id, id) ON DELETE RESTRICT
      );
      CREATE TRIGGER IF NOT EXISTS revisions_no_update BEFORE UPDATE ON revisions
        BEGIN SELECT RAISE(ABORT, 'revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS revisions_no_delete BEFORE DELETE ON revisions
        BEGIN SELECT RAISE(ABORT, 'revisions are immutable'); END;
      CREATE TABLE IF NOT EXISTS links (
        space_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('relates','supports','supersedes','depends')),
        created_at TEXT NOT NULL,
        PRIMARY KEY(space_id, from_id, to_id, kind),
        FOREIGN KEY(space_id, from_id) REFERENCES records(space_id,id) ON DELETE RESTRICT,
        FOREIGN KEY(space_id, to_id) REFERENCES records(space_id,id) ON DELETE RESTRICT,
        CHECK(from_id <> to_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(title, body, content='records', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
        INSERT INTO records_fts(rowid, title, body) VALUES(new.rowid, new.title, new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
        INSERT INTO records_fts(records_fts, rowid, title, body) VALUES('delete',old.rowid,old.title,old.body);
      END;
      CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
        INSERT INTO records_fts(records_fts, rowid, title, body) VALUES('delete',old.rowid,old.title,old.body);
        INSERT INTO records_fts(rowid, title, body) VALUES(new.rowid,new.title,new.body);
      END;
      -- The original source is separate from GPT-editable wiki records.
      CREATE TABLE IF NOT EXISTS notion_originals (
        space_id TEXT NOT NULL,
        record_id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL,
        notion_id TEXT,
        original_path TEXT NOT NULL,
        parent_notion_id TEXT,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('markdown','csv','html')),
        source_sha256 TEXT NOT NULL,
        source_bytes INTEGER NOT NULL CHECK(source_bytes >= 0),
        original_text TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        FOREIGN KEY(space_id,record_id) REFERENCES records(space_id,id) ON DELETE RESTRICT,
        UNIQUE(space_id,source_key)
      );
      CREATE INDEX IF NOT EXISTS notion_original_by_id ON notion_originals(space_id,notion_id);
      CREATE TRIGGER IF NOT EXISTS notion_originals_no_update BEFORE UPDATE ON notion_originals
        BEGIN SELECT RAISE(ABORT,'imported originals are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS notion_originals_no_delete BEFORE DELETE ON notion_originals
        BEGIN SELECT RAISE(ABORT,'imported originals are immutable'); END;
      CREATE VIRTUAL TABLE IF NOT EXISTS notion_originals_fts USING fts5(record_id UNINDEXED, original_text);
      CREATE TABLE IF NOT EXISTS notion_import_assets (
        original_path TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL CHECK(bytes >= 0),
        stored_name TEXT NOT NULL,
        FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS notion_import_references (
        from_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
        target_notion_id TEXT NOT NULL,
        target_record_id TEXT REFERENCES records(id) ON DELETE RESTRICT,
        relation_kind TEXT NOT NULL CHECK(relation_kind IN ('parent','link')),
        PRIMARY KEY(from_record_id,target_notion_id,relation_kind)
      );
    `);
  }
  close() { this.db.close(); }
  // Logical UTF-8 text budget includes the active copy and every retained revision.
  // SQLite file, FTS indexes, metadata and WAL overhead are additional.
  storageStats(space) {
    spaceId(space);
    if (!this.getSpace(space)) throw new KnowledgeError('NOT_FOUND', 'Workspace does not exist');
    const bodyBytes = this.db.prepare('SELECT COALESCE(SUM(LENGTH(CAST(body AS BLOB))),0) AS bytes FROM records WHERE space_id=?').get(space).bytes;
    const revisionBytes = this.db.prepare('SELECT COALESCE(SUM(LENGTH(CAST(body AS BLOB))),0) AS bytes, COUNT(*) AS count FROM revisions WHERE space_id=?').get(space);
    const pages = this.db.prepare('SELECT COUNT(*) AS count FROM wiki_pages WHERE space_id=?').get(space).count;
    const usedBytes = bodyBytes + revisionBytes.bytes;
    return { spaceId: space, pages, revisions: revisionBytes.count, usedTextBytes: usedBytes, maxTextBytes: this.maxSpaceTextBytes, remainingTextBytes: Math.max(0, this.maxSpaceTextBytes - usedBytes) };
  }
  assertTextBudget(space, oldBody, newBody) {
    const stats = this.storageStats(space);
    const extraBytes = 2 * Buffer.byteLength(newBody, 'utf8') - Buffer.byteLength(oldBody, 'utf8');
    if (stats.usedTextBytes + extraBytes > this.maxSpaceTextBytes) {
      throw new KnowledgeError('QUOTA_EXCEEDED', 'Knowledge text budget reached; no content was discarded');
    }
  }
  createSpace(id, name) {
    id = spaceId(id);
    name = label(name);
    this.db.prepare('INSERT INTO spaces(id,label,created_at) VALUES (?,?,?)').run(id, name, new Date().toISOString());
    return this.getSpace(id);
  }
  getSpace(id) {
    spaceId(id);
    const row = this.db.prepare('SELECT id,label,created_at FROM spaces WHERE id=?').get(id);
    return row ? { id: row.id, label: row.label, createdAt: row.created_at } : null;
  }
  createRecord(space, input) {
    spaceId(space);
    const record = fields(input, true);
    requireValid(this.getSpace(space), 'Workspace does not exist');
    const id = randomUUID();
    const now = new Date().toISOString();
    return transaction(this.db, () => {
      this.assertTextBudget(space, '', record.body);
      this.db.prepare(`INSERT INTO records(id,space_id,kind,title,body,status,source_url,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,1,?,?)`).run(id, space, record.kind, record.title, record.body, record.status, record.sourceUrl, now, now);
      this.db.prepare(`INSERT INTO revisions(space_id,record_id,version,kind,title,body,status,source_url,changed_at)
        VALUES (?,?,1,?,?,?,?,?,?)`).run(space, id, record.kind, record.title, record.body, record.status, record.sourceUrl, now);
      return this.getRecord(space, id);
    });
  }
  // AI write surface: creates and revises wiki pages, never promotes them to approved decisions.
  // An automatic write remains a draft, regardless of text claiming that an action was approved.
  capturePage(space, input) {
    spaceId(space);
    requireValid(input && typeof input === 'object' && !Array.isArray(input), 'Page input is required');
    requireValid(Object.keys(input).every((key) => ['path','title','body','sourceUrl'].includes(key)), 'Unknown page field');
    const path = wikiPath(input.path);
    const title = label(input.title);
    const body = bodyText(input.body);
    if (Buffer.byteLength(body, 'utf8') > MAX_CAPTURE_BODY_BYTES) {
      throw new KnowledgeError('QUOTA_EXCEEDED', 'Draft exceeds 16 KiB; summarize and link the source instead');
    }
    // A missing sourceUrl is not an instruction to delete existing provenance.
    // Explicit null may clear it only while the page is still a draft.
    const suppliedProvenance = Object.hasOwn(input, 'sourceUrl');
    const provenance = suppliedProvenance ? sourceUrl(input.sourceUrl) : null;
    if (!this.getSpace(space)) throw new KnowledgeError('NOT_FOUND', 'Workspace does not exist');
    const page = this.getPage(space, path);
    if (page) {
      const nextProvenance = suppliedProvenance ? provenance : page.sourceUrl;
      if (page.title === title && page.body === body && page.sourceUrl === nextProvenance) return { ...page, action: 'unchanged' };
      // A capture agent cannot revise/demote a record already reviewed by a human.
      if (page.status !== 'draft') throw new KnowledgeError('REVIEW_REQUIRED', 'Reviewed page cannot be replaced by an automatic capture');
      const changed = this.updateRecord(space, page.id, page.version, {
        title, body, sourceUrl: nextProvenance, status: 'draft', kind: 'article',
      }, { captureQuota: true });
      return { ...changed, path, action: 'updated' };
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    return transaction(this.db, () => {
      const stats = this.storageStats(space);
      if (stats.pages >= MAX_CAPTURE_PAGES_PER_SPACE) throw new KnowledgeError('QUOTA_EXCEEDED', 'Page count limit reached');
      this.assertTextBudget(space, '', body);
      this.db.prepare(`INSERT INTO records(id,space_id,kind,title,body,status,source_url,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,1,?,?)`).run(id,space,'article',title,body,'draft',provenance,now,now);
      this.db.prepare(`INSERT INTO revisions(space_id,record_id,version,kind,title,body,status,source_url,changed_at)
        VALUES (?,?,1,?,?,?,?,?,?)`).run(space,id,'article',title,body,'draft',provenance,now);
      this.db.prepare('INSERT INTO wiki_pages(space_id,path,record_id) VALUES (?,?,?)').run(space,path,id);
      return { ...this.getRecord(space,id), path, action: 'created' };
    });
  }
  getPage(space, path) {
    spaceId(space); wikiPath(path);
    const row = this.db.prepare(`SELECT r.* FROM wiki_pages w JOIN records r ON r.id=w.record_id
      WHERE w.space_id=? AND w.path=?`).get(space,path);
    if(!row)return null;
    const record={...mapRecord(row),path};
    const original=this.db.prepare('SELECT original_text FROM notion_originals WHERE space_id=? AND record_id=?')
      .get(space,record.id);
    return original ? {...record,
      body:record.version===1?original.original_text:record.body,
      hasOriginal:true} : record;
  }
  getNotionOriginal(space, path) {
    const page=this.getPage(space,path);
    if(!page)return null;
    const row=this.db.prepare('SELECT source_key,notion_id,original_path,parent_notion_id,source_kind,source_sha256,source_bytes,original_text,imported_at FROM notion_originals WHERE space_id=? AND record_id=?')
      .get(space,page.id);
    return row ? {...row,spaceId:space,recordId:page.id,title:page.title,path} : null;
  }
  listPages(space, limit = 500) {
    spaceId(space);
    requireValid(Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'Page list limit must be 1-1000');
    return this.db.prepare(`SELECT w.path,r.* FROM wiki_pages w JOIN records r ON r.id=w.record_id
      WHERE w.space_id=? ORDER BY w.path LIMIT ?`).all(space,limit).map((row) => ({ ...mapRecord(row), path: row.path }));
  }
  /** Resolve explicit wiki relationships in both directions without changing data. */
  getLinkedPages(space, path) {
    const page=this.getPage(space,path);
    if(!page)throw new KnowledgeError('NOT_FOUND','Page does not exist');
    // Join exclusively within the authenticated workspace. Non-wiki source
    // records remain in the evidence register and are not exposed here.
    return this.db.prepare(`SELECT l.kind,l.from_id,
      w.path AS linked_path,r.title AS linked_title
      FROM links l
      JOIN wiki_pages w ON w.space_id=l.space_id
        AND w.record_id=CASE WHEN l.from_id=? THEN l.to_id ELSE l.from_id END
      JOIN records r ON r.id=w.record_id AND r.space_id=l.space_id
      WHERE l.space_id=? AND (l.from_id=? OR l.to_id=?)
      ORDER BY w.path,l.kind LIMIT 300`).all(page.id,space,page.id,page.id)
      .map(row=>({
        direction:row.from_id===page.id?'outgoing':'incoming',
        kind:row.kind,path:row.linked_path,title:row.linked_title
      }));
  }
  searchPages(space, query) {
    const found = new Set(this.search(space,query,100).map(record=>record.id));
    const terms=typeof query==='string'?query.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu)?.slice(0,12):null;
    if(terms?.length){
      const expr=terms.map(term=>`"${term.replaceAll('"','""')}"`).join(' AND ');
      const originals=this.db.prepare(`SELECT o.record_id FROM notion_originals_fts f
        JOIN notion_originals o ON o.record_id=f.record_id
        WHERE notion_originals_fts MATCH ? AND o.space_id=? LIMIT 200`).all(expr,space);
      for(const item of originals)found.add(item.record_id);
    }
    return this.listPages(space,1000).filter(page=>found.has(page.id));
  }
  // A share is intentionally created out-of-band by the local owner CLI, never by the AI capture API.
  createShare(space, path) {
    const page = this.getPage(space,path);
    if (!page) throw new KnowledgeError('NOT_FOUND', 'Page does not exist');
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    this.db.prepare('INSERT INTO shared_pages(token_hash,space_id,record_id,shared_version,created_at) VALUES (?,?,?,?,?)')
      .run(hash,space,page.id,page.version,new Date().toISOString());
    return { token, path: page.path, recordId: page.id, version: page.version };
  }
  getSharedPage(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = createHash('sha256').update(token).digest('hex');
    const row = this.db.prepare(`SELECT s.record_id, s.space_id, s.shared_version,
      v.kind,v.title,v.body,v.status,v.source_url,v.changed_at
      FROM shared_pages s JOIN revisions v ON v.record_id=s.record_id AND v.space_id=s.space_id AND v.version=s.shared_version
      WHERE s.token_hash=? AND s.revoked_at IS NULL`).get(hash);
    return row ? { id:row.record_id,spaceId:row.space_id,version:row.shared_version,kind:row.kind,
      title:row.title,body:row.body,status:row.status,sourceUrl:row.source_url,updatedAt:row.changed_at } : null;
  }
  revokeShare(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new KnowledgeError('INVALID_INPUT', 'Invalid share token');
    const hash = createHash('sha256').update(token).digest('hex');
    const result = this.db.prepare('UPDATE shared_pages SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL')
      .run(new Date().toISOString(),hash);
    return { revoked: result.changes===1 };
  }
  getRecord(space, id) {
    spaceId(space); recordId(id);
    return mapRecord(this.db.prepare('SELECT * FROM records WHERE space_id=? AND id=?').get(space, id));
  }
  listRecords(space, limit = 100) {
    spaceId(space);
    requireValid(Number.isInteger(limit) && limit >= 1 && limit <= 500, 'List limit must be 1-500');
    return this.db.prepare('SELECT * FROM records WHERE space_id=? ORDER BY updated_at DESC, id LIMIT ?')
      .all(space, limit).map(mapRecord);
  }
  updateRecord(space, id, expectedVersion, changes, { captureQuota = false } = {}) {
    spaceId(space); recordId(id);
    requireValid(Number.isInteger(expectedVersion) && expectedVersion > 0, 'Expected revision is required');
    const update = fields(changes);
    return transaction(this.db, () => {
      const before = this.getRecord(space, id);
      if (!before) throw new KnowledgeError('NOT_FOUND', 'Record does not exist in this workspace');
      if (before.version !== expectedVersion) throw new KnowledgeError('VERSION_CONFLICT', 'Record has changed since the expected revision');
      const after = { ...before, ...update, version: before.version + 1, updatedAt: new Date().toISOString() };
      if (captureQuota && before.version >= MAX_CAPTURE_REVISIONS) {
        throw new KnowledgeError('QUOTA_EXCEEDED', 'Draft revision limit reached; an owner must reorganize this page');
      }
      this.assertTextBudget(space, before.body, after.body);
      const result = this.db.prepare(`UPDATE records SET kind=?, title=?, body=?, status=?, source_url=?, version=?, updated_at=?
        WHERE space_id=? AND id=? AND version=?`).run(after.kind, after.title, after.body, after.status, after.sourceUrl,
          after.version, after.updatedAt, space, id, expectedVersion);
      if (result.changes !== 1) throw new KnowledgeError('VERSION_CONFLICT', 'Concurrent update conflict');
      this.db.prepare(`INSERT INTO revisions(space_id,record_id,version,kind,title,body,status,source_url,changed_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(space, id, after.version, after.kind, after.title, after.body,
          after.status, after.sourceUrl, after.updatedAt);
      return this.getRecord(space, id);
    });
  }
  history(space, id) {
    spaceId(space); recordId(id);
    if (!this.getRecord(space, id)) return [];
    return this.db.prepare('SELECT * FROM revisions WHERE space_id=? AND record_id=? ORDER BY version ASC')
      .all(space, id).map(mapRevision);
  }
  link(space, fromId, toId, kind = 'relates') {
    spaceId(space); recordId(fromId); recordId(toId);
    oneOf(kind, LINK_KINDS, 'link kind');
    requireValid(fromId !== toId, 'Self-links are not allowed');
    if (!this.getRecord(space, fromId) || !this.getRecord(space, toId)) {
      throw new KnowledgeError('NOT_FOUND', 'Both linked records must exist in the same workspace');
    }
    const createdAt = new Date().toISOString();
    this.db.prepare('INSERT INTO links(space_id,from_id,to_id,kind,created_at) VALUES (?,?,?,?,?)')
      .run(space, fromId, toId, kind, createdAt);
    return { spaceId: space, fromId, toId, kind, createdAt };
  }
  relations(space, id) {
    spaceId(space); recordId(id);
    return this.db.prepare('SELECT * FROM links WHERE space_id=? AND (from_id=? OR to_id=?) ORDER BY kind,from_id,to_id')
      .all(space, id, id).map(mapLink);
  }
  search(space, query, limit = 30) {
    spaceId(space);
    requireValid(typeof query === 'string' && query.length <= 200, 'Search query must be text of at most 200 characters');
    requireValid(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'Search limit must be 1-100');
    const terms = query.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) || [];
    if (!terms.length) return [];
    const expression = terms.map((term) => `"${term.replaceAll('"','""')}"`).join(' AND ');
    return this.db.prepare(`SELECT r.* FROM records_fts
      JOIN records r ON r.rowid=records_fts.rowid
      WHERE records_fts MATCH ? AND r.space_id=?
      ORDER BY bm25(records_fts), r.id LIMIT ?`).all(expression, space, limit).map(mapRecord);
  }
  exportSpace(space) {
    const workspace = this.getSpace(space);
    if (!workspace) throw new KnowledgeError('NOT_FOUND', 'Workspace does not exist');
    // Legacy per-space JSON snapshots omit the new immutable original and
    // attachment vault. Never issue a misleading "successful" incomplete backup.
    const originals=this.db.prepare('SELECT COUNT(*) AS count FROM notion_originals WHERE space_id=?').get(space).count;
    if(originals>0)throw new KnowledgeError('SOURCE_ARCHIVE_BACKUP_REQUIRED',
      'Imported Notion pages require a complete private Knowledge database and asset-vault backup');
    const payload = {
      workspace,
      records: this.db.prepare('SELECT * FROM records WHERE space_id=? ORDER BY id').all(space).map(mapRecord),
      revisions: this.db.prepare('SELECT * FROM revisions WHERE space_id=? ORDER BY record_id,version').all(space).map(mapRevision),
      links: this.db.prepare('SELECT * FROM links WHERE space_id=? ORDER BY from_id,to_id,kind').all(space).map(mapLink),
      pages: this.db.prepare('SELECT path,record_id FROM wiki_pages WHERE space_id=? ORDER BY path').all(space).map(r=>({path:r.path,recordId:r.record_id})),
    };
    return { format: 'knowledge-snapshot-v1', payload, sha256: checksum(payload) };
  }
  restoreSpace(snapshot) {
    requireValid(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'Snapshot must be an object');
    requireValid(snapshot.format === 'knowledge-snapshot-v1' && snapshot.payload && typeof snapshot.sha256 === 'string', 'Unsupported snapshot format');
    requireValid(JSON.stringify(snapshot).length <= MAX_EXPORT, 'Snapshot exceeds 25MB safety limit');
    requireValid(checksum(snapshot.payload) === snapshot.sha256, 'Snapshot checksum does not match');
    const { workspace, records, revisions, links, pages = [] } = snapshot.payload;
    requireValid(workspace && Array.isArray(records) && Array.isArray(revisions) && Array.isArray(links) && Array.isArray(pages), 'Malformed snapshot');
    spaceId(workspace.id); label(workspace.label); iso(workspace.createdAt);
    requireValid(records.length <= 10000 && revisions.length <= 100000 && links.length <= 100000 && pages.length <= 10000, 'Snapshot entry limit exceeded');
    const byId = new Map();
    for (const record of records) {
      recordId(record.id);
      requireValid(record.spaceId === workspace.id && Number.isInteger(record.version) && record.version >= 1, 'Invalid record workspace or version');
    }
    // Validate the exported public shape without allowing accidental extra private metadata.
    for (const record of records) {
      const { id, spaceId: owner, version, createdAt, updatedAt, ...data } = record;
      requireValid(Object.keys(data).every((key) => ['kind', 'title', 'body', 'status', 'sourceUrl'].includes(key)), 'Unexpected record export field');
      const valid = fields(data, true);
      requireValid(Object.keys(valid).length === 5, 'Incomplete record export');
      iso(createdAt); iso(updatedAt);
      requireValid(!byId.has(id), 'Duplicate record identifier');
      byId.set(id, record);
    }
    const byRevision = new Map();
    for (const revision of revisions) {
      recordId(revision.recordId);
      const parent = byId.get(revision.recordId);
      requireValid(parent && Number.isInteger(revision.version) && revision.version >= 1 && revision.version <= parent.version, 'Invalid revision ancestry');
      const { recordId: _id, version: _v, changedAt, ...data } = revision;
      const valid = fields(data, true);
      requireValid(Object.keys(data).length === 5 && Object.keys(valid).length === 5, 'Incomplete revision');
      iso(changedAt);
      const revs = byRevision.get(revision.recordId) || [];
      revs.push(revision);
      byRevision.set(revision.recordId, revs);
    }
    const restoredTextBytes = [...records, ...revisions].reduce((sum, r) => sum + Buffer.byteLength(r.body, 'utf8'), 0);
    if (restoredTextBytes > this.maxSpaceTextBytes) throw new KnowledgeError('QUOTA_EXCEEDED', 'Snapshot exceeds configured text budget');
    for (const record of records) {
      const revs = byRevision.get(record.id) || [];
      revs.sort((a, b) => a.version - b.version);
      requireValid(revs.length === record.version && revs.every((r, i) => r.version === i + 1), 'Revision sequence incomplete');
      const latest = revs.at(-1);
      requireValid(['kind','title','body','status','sourceUrl'].every((key) => latest[key] === record[key]) && latest.changedAt === record.updatedAt, 'Latest revision differs from current record');
      requireValid(revs[0].changedAt === record.createdAt, 'Creation revision date mismatch');
    }
    const linkKeys = new Set();
    for (const link of links) {
      requireValid(link.spaceId === workspace.id && byId.has(link.fromId) && byId.has(link.toId) && link.fromId !== link.toId, 'Invalid or cross-workspace relation');
      oneOf(link.kind, LINK_KINDS, 'link kind'); iso(link.createdAt);
      const key = `${link.fromId}:${link.toId}:${link.kind}`;
      requireValid(!linkKeys.has(key), 'Duplicate relation');
      linkKeys.add(key);
    }
    const paths = new Set(); const mappedRecords = new Set();
    for (const page of pages) {
      requireValid(page && Object.keys(page).length === 2 && byId.has(page.recordId), 'Invalid wiki page record');
      wikiPath(page.path);
      requireValid(!paths.has(page.path) && !mappedRecords.has(page.recordId), 'Duplicate wiki path or record');
      paths.add(page.path); mappedRecords.add(page.recordId);
    }
    return transaction(this.db, () => {
      if (this.getSpace(workspace.id)) throw new KnowledgeError('ALREADY_EXISTS', 'Target workspace exists; restore requires an empty target');
      this.db.prepare('INSERT INTO spaces(id,label,created_at) VALUES (?,?,?)')
        .run(workspace.id, workspace.label, workspace.createdAt);
      const saveRecord = this.db.prepare(`INSERT INTO records(id,space_id,kind,title,body,status,source_url,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const r of records) saveRecord.run(r.id, r.spaceId, r.kind, r.title, r.body, r.status, r.sourceUrl, r.version, r.createdAt, r.updatedAt);
      const saveRevision = this.db.prepare(`INSERT INTO revisions(space_id,record_id,version,kind,title,body,status,source_url,changed_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const r of revisions) saveRevision.run(workspace.id, r.recordId, r.version, r.kind, r.title, r.body, r.status, r.sourceUrl, r.changedAt);
      const saveLink = this.db.prepare('INSERT INTO links(space_id,from_id,to_id,kind,created_at) VALUES (?,?,?,?,?)');
      for (const l of links) saveLink.run(l.spaceId, l.fromId, l.toId, l.kind, l.createdAt);
      const savePage = this.db.prepare('INSERT INTO wiki_pages(space_id,path,record_id) VALUES (?,?,?)');
      for (const p of pages) savePage.run(workspace.id,p.path,p.recordId);
      return { spaceId: workspace.id, records: records.length, revisions: revisions.length, links: links.length, sha256: snapshot.sha256 };
    });
  }
}
