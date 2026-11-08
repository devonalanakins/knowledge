# Optional private word index

Implemented source and synthetic tests; **disabled in production**. This extends
the existing encrypted forward Worker. It does not authorize normal writing,
historical import, more than 500 writable pages or external access.

## Behavior

An explicitly approved deployment can apply the additive
`ops/private-forward/search-index-v1.sql` and set
`KNOWLEDGE_SEARCH_INDEX_ACK=PRIVATE_TOKEN_SEARCH_V1`. Without that acknowledgment,
existing search behavior and storage remain unchanged. No schema change runs
automatically on startup, merge, or request handling.

The optional mode matches **all normalized words in any order**, not arbitrary
substrings or exact phrases. Unicode NFKC normalization and lowercase are applied
before extracting letter/number words. Queries allow up to eight distinct words;
documents allow 1,024 distinct indexed words. Oversized inputs are rejected before
page writes; no terms are silently truncated. Queries return at most 50
authenticated page summaries plus an explicit `truncated` flag. The existing
browser uses the same search and explains matching/truncation to the reader.

A separate HKDF-derived HMAC key indexes normalized words. Index hashes include
the workspace identifier; page titles, paths, bodies and search words are not
stored as plaintext in the index. Search uses the token-key primary index and
decrypts only its result candidates. The result's content and path HMAC are
authenticated, then independently checked against every requested word before
any summary is returned. A forged positive index entry fails closed.

Page CAS, immutable revision insertion, old-term removal, new-term insertion and
index-version update share the same D1 batch transaction. Derived writes also
require the exact new version **and exact ciphertext** to remain current; a stale
writer cannot replace the winner's index even after two intervening revisions.
The existing Access owner/audience gate still runs before every search request.

## Integrity and privacy limits

This is a **blind index, not a zero-leakage search system**. Someone with database
access can observe term equality, term/document frequency, document membership,
row counts and update patterns. The index has no positional data or plaintext
words. A party with both the root key and index can compute word guesses. Root
key compromise already compromises page decryption; this does not remove that
threat or provide a qualified independent security sign-off.

The derived index is not independently authenticated as a complete set. A
storage attacker can delete term rows and cause false negatives. Version
coverage catches missing/stale per-page index state, but cannot prove every
term row remains present. Candidate authentication catches fabricated positives;
it is not proof of exhaustive results under malicious index deletion. A source
rebuild/coverage audit is still required for migration and recovery acceptance.

The coverage check reads opaque page/version metadata via SQL; it does not
decrypt every page, but its cost grows with page count. Synthetic scale evidence
is not Cloudflare CPU/latency/cost acceptance. No production quota is raised.

## Migration, recovery and release gates

Existing pages must be rebuilt from authenticated original ciphertext in a
reviewed owner-controlled job before enabling indexed search. Missing version
coverage returns `SEARCH_INDEX_INCOMPLETE`, rather than silently omitting older
records. The large test performs this rebuilding only in memory on fictional
data; **no real-data reindex command or live migration has run**.

The original page/revision/instance backup remains the recovery authority. This
index is derived and is not in v1 snapshots. After a restore, do not enable this
mode until its optional schema and a complete independently verified rebuild
exist. A missing schema fails storage operations and atomic writes roll back.
Mixed old/new writers, rebuilding under concurrent writes, missed coverage,
schema rollback and provider resource limits need a reviewed release procedure.

Do not enable on a production database merely because synthetic tests pass.
Required next gates include an executable verified rebuild, real provider
integration, leakage/authorization review, owner-key/off-provider recovery,
workspace permissions and explicit production release approval.

Synthetic evidence covers a unique match among 3,312 encrypted records without
reading unrelated corrupted ciphertext, Unicode normalization, no plaintext
terms, workspace/key separation, bounded results, incomplete indexes, forged
positive matches, write rollback, two intervening revisions and browser result
semantics. Search remains owner-only; no collaborator or public sharing is added.
