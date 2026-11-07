-- Owner-only forward Knowledge lane, separate from historical Notion staging.
-- Contents, titles and wiki paths are encrypted/HMAC-indexed by the Worker.
-- Apply to a fresh, dedicated D1 instance only after private Access review.
CREATE TABLE IF NOT EXISTS knowledge_instance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  key_check TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_pages (
  path_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 128),
  sealed TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_pages_updated ON knowledge_pages(updated_at DESC);
CREATE TABLE IF NOT EXISTS knowledge_revisions (
  path_key TEXT NOT NULL REFERENCES knowledge_pages(path_key) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 128),
  sealed TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(path_key,version)
);
CREATE TRIGGER IF NOT EXISTS knowledge_revisions_immutable_update
  BEFORE UPDATE ON knowledge_revisions
  BEGIN SELECT RAISE(ABORT, 'knowledge history immutable'); END;
CREATE TRIGGER IF NOT EXISTS knowledge_revisions_immutable_delete
  BEFORE DELETE ON knowledge_revisions
  BEGIN SELECT RAISE(ABORT, 'knowledge history immutable'); END;
