-- Owner-local progress only. Not part of production schema or backup authority.
CREATE TABLE IF NOT EXISTS knowledge_search_rebuild_progress (
  id INTEGER PRIMARY KEY CHECK(id=1),
  format_version INTEGER NOT NULL CHECK(format_version=1),
  instance_check TEXT NOT NULL,
  after_key TEXT NOT NULL,
  processed INTEGER NOT NULL CHECK(processed>=0),
  state TEXT NOT NULL CHECK(state IN ('building','built','verified'))
);
