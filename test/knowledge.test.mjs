import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { KnowledgeStore } from '../src/knowledge.mjs';

function useStore(fn) {
  const path = mkdtempSync(join(tmpdir(), 'knowledge-test-'));
  const filename = join(path, 'knowledge.sqlite');
  const store = new KnowledgeStore(filename);
  try { return fn(store, path, filename); }
  finally { store.close(); rmSync(path, { recursive: true, force: true }); }
}
function record(overrides = {}) {
  return { kind: 'article', title: 'Decision brief', body: 'An evidence-backed example', ...overrides };
}
function sha(payload) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }

// Every fixture is synthetic and completely unrelated to a real client or family record.
test('creates a workspace and a version-1 record with its original revision', () => useStore((store) => {
  const space = store.createSpace('personal', 'Personal');
  assert.equal(space.id, 'personal');
  const r = store.createRecord('personal', record());
  assert.equal(r.kind, 'article');
  assert.equal(r.status, 'draft');
  assert.equal(r.version, 1);
  assert.equal(store.history('personal', r.id).length, 1);
  assert.equal(store.getRecord('personal', r.id).title, 'Decision brief');
}));

test('workspace reads and searches never expose a different workspace', () => useStore((store) => {
  store.createSpace('personal', 'Personal');
  store.createSpace('client', 'Fictional client');
  const privateRecord = store.createRecord('personal', record({ title: 'Aurora confidential', body: 'gentle violet note' }));
  const clientRecord = store.createRecord('client', record({ title: 'Delta meeting', body: 'synthetic unrelated' }));
  assert.equal(store.getRecord('client', privateRecord.id), null);
  assert.equal(store.getRecord('personal', clientRecord.id), null);
  assert.deepEqual(store.search('client', 'Aurora'), []);
  assert.deepEqual(store.listRecords('client').map((r) => r.id), [clientRecord.id]);
  assert.deepEqual(store.history('client', privateRecord.id), []);
}));

test('revisions require exact expected version and preserve original fields', () => useStore((store) => {
  store.createSpace('owner', 'Owner');
  const r = store.createRecord('owner', record());
  const next = store.updateRecord('owner', r.id, 1, { title: 'Corrected decision', status: 'recorded' });
  assert.equal(next.version, 2);
  assert.equal(next.status, 'recorded');
  assert.throws(() => store.updateRecord('owner', r.id, 1, { body: 'Stale overwrite' }), { code: 'VERSION_CONFLICT' });
  assert.equal(store.getRecord('owner', r.id).body, 'An evidence-backed example');
  assert.deepEqual(store.history('owner', r.id).map((h) => h.title), ['Decision brief', 'Corrected decision']);
  assert.throws(() => store.db.prepare('UPDATE revisions SET title=? WHERE record_id=?').run('Tampered', r.id), /immutable/);
  assert.throws(() => store.db.prepare('DELETE FROM revisions WHERE record_id=?').run(r.id), /immutable/);
}));

test('source provenance validation rejects credentials and non-HTTPS URLs', () => useStore((store) => {
  store.createSpace('owner', 'Owner');
  for (const uri of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@site.example']) {
    assert.throws(() => store.createRecord('owner', record({ sourceUrl: uri })), { code: 'INVALID_INPUT' });
  }
  const r = store.createRecord('owner', record({ sourceUrl: 'https://example.com/article#section' }));
  assert.equal(r.sourceUrl, 'https://example.com/article#section');
}));

test('rejects invalid titles, kinds, statuses, oversized body, unknown properties', () => useStore((store) => {
  store.createSpace('owner', 'Owner');
  for (const payload of [
    { title: ' ' }, { kind: 'clinical-record' }, { status: 'approved' },
    { body: 'x'.repeat(100_001) }, { arbitrary: 'field' },
  ]) {
    assert.throws(() => store.createRecord('owner', record(payload)), { code: 'INVALID_INPUT' });
  }
}));

test('links enforce same-workspace ownership and have visible backlinks', () => useStore((store) => {
  store.createSpace('owner', 'Owner');
  store.createSpace('external', 'Other');
  const a = store.createRecord('owner', record({ title: 'A' }));
  const b = store.createRecord('owner', record({ title: 'B' }));
  const c = store.createRecord('external', record({ title: 'C' }));
  store.link('owner', a.id, b.id, 'supports');
  assert.equal(store.relations('owner', a.id).length, 1);
  assert.equal(store.relations('owner', b.id)[0].fromId, a.id);
  assert.deepEqual(store.relations('external', c.id), []);
  assert.throws(() => store.link('owner', a.id, c.id, 'supports'), { code: 'NOT_FOUND' });
  assert.throws(() => store.link('owner', a.id, a.id), { code: 'INVALID_INPUT' });
}));

test('full-text search finds Unicode and treats special syntax as words, not FTS commands', () => useStore((store) => {
  store.createSpace('owner', 'Owner');
  const a = store.createRecord('owner', record({ title: 'Aurora physics', body: 'étude quantum research' }));
  store.createRecord('owner', record({ title: 'Other', body: 'Calendar source' }));
  assert.equal(store.search('owner', 'Aurora').at(0).id, a.id);
  assert.equal(store.search('owner', 'étude')[0].id, a.id);
  assert.deepEqual(store.search('owner', '((((" OR ********'), []);
  assert.deepEqual(store.search('owner', '!!!'), []);
  store.updateRecord('owner', a.id, 1, { title: 'Revised title' });
  assert.deepEqual(store.search('owner', 'Aurora'), []);
  assert.equal(store.search('owner', 'Revised')[0].id, a.id);
}));

test('JSON snapshot restore keeps revision histories and relationship graph exactly', () => useStore((store) => {
  store.createSpace('personal', 'Personal');
  const a = store.createRecord('personal', record({ sourceUrl: 'https://example.org/evidence' }));
  const b = store.createRecord('personal', record({ kind: 'source', title: 'Evidence', body: 'Original quotation' }));
  store.updateRecord('personal', a.id, 1, { body: 'Revised with linked citation', status: 'recorded' });
  store.link('personal', b.id, a.id, 'supports');
  const snapshot = store.exportSpace('personal');
  const restored = new KnowledgeStore();
  try {
    assert.deepEqual(restored.restoreSpace(snapshot), {
      spaceId: 'personal', records: 2, revisions: 3, links: 1, sha256: snapshot.sha256,
    });
    assert.deepEqual(restored.exportSpace('personal'), snapshot);
    assert.equal(restored.search('personal', 'quotation').length, 1);
  } finally { restored.close(); }
}));

test('tampered snapshot is rejected and leaves target untouched', () => useStore((store) => {
  store.createSpace('owner', 'Owner');
  const a = store.createRecord('owner', record());
  const snapshot = store.exportSpace('owner');
  const broken = structuredClone(snapshot);
  broken.payload.records[0].body = 'Silently modified';
  const target = new KnowledgeStore();
  try {
    assert.throws(() => target.restoreSpace(broken), { code: 'INVALID_INPUT' });
    assert.equal(target.getSpace('owner'), null);
    broken.sha256 = sha(broken.payload); // Attacker recomputed a non-keyed checksum.
    assert.throws(() => target.restoreSpace(broken), { code: 'INVALID_INPUT' });
    assert.equal(target.getSpace('owner'), null);
    assert.deepEqual(store.getRecord('owner', a.id).body, 'An evidence-backed example');
  } finally { target.close(); }
}));

test('restore refuses replay to nonempty workspace without changing records', () => useStore((store) => {
  store.createSpace('owner', 'Owner');
  store.createRecord('owner', record());
  const snapshot = store.exportSpace('owner');
  assert.throws(() => store.restoreSpace(snapshot), { code: 'ALREADY_EXISTS' });
  assert.deepEqual(store.exportSpace('owner'), snapshot);
}));

test('invalid cross-scope relation in recomputed snapshot cannot be restored', () => useStore((store) => {
  store.createSpace('owner', 'Owner');
  const a = store.createRecord('owner', record());
  const b = store.createRecord('owner', record({ title: 'Second' }));
  store.link('owner', a.id, b.id);
  const snapshot = store.exportSpace('owner');
  snapshot.payload.links[0].toId = '00000000-0000-0000-0000-000000000000';
  snapshot.sha256 = sha(snapshot.payload);
  const target = new KnowledgeStore();
  try {
    assert.throws(() => target.restoreSpace(snapshot), { code: 'INVALID_INPUT' });
    assert.equal(target.getSpace('owner'), null);
  } finally { target.close(); }
}));

test('database stays persistent across fresh connections; file is owner-private', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-persist-'));
  const filename = join(dir, 'knowledge.sqlite');
  let id;
  try {
    const first = new KnowledgeStore(filename);
    first.createSpace('owner', 'Owner');
    id = first.createRecord('owner', record()).id;
    first.close();
    const second = new KnowledgeStore(filename);
    try {
      assert.equal(second.getRecord('owner', id).title, 'Decision brief');
      assert.equal(statSync(filename).mode & 0o777, 0o600);
    } finally { second.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI creates, exports, restores and reads synthetic records from separate databases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-cli-'));
  const cli = resolve('src/cli.mjs');
  const first = join(dir, 'first.sqlite');
  const second = join(dir, 'second.sqlite');
  const source = join(dir, 'new-record.json');
  const archive = join(dir, 'export.json');
  const run = (db, ...args) => {
    const p = spawnSync(process.execPath, [cli, '--db', db, ...args], { cwd: resolve('.'), encoding: 'utf8' });
    assert.equal(p.status, 0, `${p.stderr}\n${p.stdout}`);
    return JSON.parse(p.stdout);
  };
  try {
    writeFileSync(source, JSON.stringify(record({ title: 'CLI example' })));
    run(first, 'init', 'owner', 'Owner');
    const added = run(first, 'add', 'owner', source);
    const exported = run(first, 'export', 'owner', archive);
    assert.equal(exported.records, 1);
    assert.equal(statSync(archive).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(archive, 'utf8')).format, 'knowledge-snapshot-v1');
    run(second, 'restore', archive);
    assert.equal(run(second, 'read', 'owner', added.id).title, 'CLI example');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
