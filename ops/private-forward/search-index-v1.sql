-- OPTIONAL derived blind index. Apply only under a separately approved release.
-- Original encrypted pages and revisions remain the recovery authority.
CREATE TABLE IF NOT EXISTS knowledge_search_terms (
  token_key TEXT NOT NULL,
  path_key TEXT NOT NULL REFERENCES knowledge_pages(path_key) ON DELETE RESTRICT,
  PRIMARY KEY(token_key,path_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS knowledge_search_terms_path ON knowledge_search_terms(path_key);
CREATE TABLE IF NOT EXISTS knowledge_search_versions (
  path_key TEXT PRIMARY KEY REFERENCES knowledge_pages(path_key) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 128)
);
