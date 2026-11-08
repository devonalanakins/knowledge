-- Source-only capture integration inbox. Use a fresh isolated D1, NOT the
-- existing production Knowledge ciphertext database. No plaintext wiki fields.
CREATE TABLE IF NOT EXISTS knowledge_capture_inbox (
  delivery_key TEXT PRIMARY KEY CHECK (length(delivery_key) = 43),
  sealed TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','leased','saved','blocked','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  lease_id TEXT,
  lease_until TEXT,
  next_at TEXT NOT NULL,
  last_error TEXT CHECK (last_error IS NULL OR last_error IN ('READ_FAILED','WRITE_FAILED','READBACK_FAILED','RECORD_CONFLICT')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((state = 'leased' AND lease_id IS NOT NULL AND lease_until IS NOT NULL) OR
         (state <> 'leased' AND lease_id IS NULL AND lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS capture_inbox_due
  ON knowledge_capture_inbox(state,next_at,created_at);
