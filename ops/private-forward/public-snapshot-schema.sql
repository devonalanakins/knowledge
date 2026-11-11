-- SOURCE-ONLY schema for a separate, dedicated publicly releasable snapshot D1.
-- NEVER apply to owner private Knowledge D1 or migrate owner records into this DB.
-- Only a future authorized, reviewed release process may insert/revoke rows.
-- No raw share tokens, owner paths, patient IDs, workspace names, or private links.
CREATE TABLE IF NOT EXISTS knowledge_public_snapshots (
  token_hash TEXT PRIMARY KEY NOT NULL
    CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  review_proof_hash TEXT NOT NULL UNIQUE
    CHECK(length(review_proof_hash) = 64 AND review_proof_hash NOT GLOB '*[^0-9a-f]*'),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) <= 16384),
  shared_version INTEGER NOT NULL CHECK(shared_version BETWEEN 1 AND 128),
  approval_status TEXT NOT NULL CHECK(approval_status = 'approved'),
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK(expires_at > approved_at)
) STRICT;
-- Explicit owner-controlled revocation updates the same row; never overwrite
-- the immutable approved content. A future publisher must enforce this.
CREATE TRIGGER IF NOT EXISTS prevent_public_snapshot_delete
BEFORE DELETE ON knowledge_public_snapshots
BEGIN SELECT RAISE(ABORT,'public snapshots may only be revoked'); END;
CREATE TRIGGER IF NOT EXISTS prevent_public_snapshot_change
BEFORE UPDATE OF token_hash,review_proof_hash,title,body,shared_version,approval_status,approved_at,expires_at
ON knowledge_public_snapshots
BEGIN SELECT RAISE(ABORT,'approved snapshots are immutable'); END;
