/*
 * The database's numbered, forward-only migrations.
 *
 * Two rules the runner depends on.
 *
 * A migration is a number and the SQL that takes the database from the previous
 * number to this one. Nothing here reads `PRAGMA user_version` or diffs a live
 * schema: the list is the truth, the table records which entries have run, and a
 * database that is ahead of this list is refused rather than guessed at.
 *
 * Every statement that holds personal data names its encrypted column `*_enc`.
 * That is not decoration. The schema is what a future reader checks against when
 * they ask "could this column hold a sentence someone typed", and a column that
 * says `_enc` answers it without reading the repository.
 *
 * `scope_id` appears on every table, and `business_id` on everything that belongs
 * to one business, exactly as the plan requires (section 14). The indexes lead
 * with `scope_id` so the filter every repository is required to apply is also the
 * one the query planner uses.
 */

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

/**
 * Version 1: businesses, threads, messages, memory, summaries, proposals, audit.
 *
 * Foreign keys cascade so deleting a business takes its threads, and deleting a
 * thread takes its messages. That is a convenience, not the isolation boundary:
 * isolation comes from every repository putting `scope_id` in the WHERE clause,
 * because a cascade only helps if the delete was already scoped.
 */
const VERSION_1 = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business (
  id                  TEXT PRIMARY KEY,
  scope_id            TEXT NOT NULL,
  remote_workspace_id INTEGER NOT NULL,
  name_enc            TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  archived_at         TEXT,
  UNIQUE (scope_id, remote_workspace_id)
);
CREATE INDEX IF NOT EXISTS business_scope ON business (scope_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS thread (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  title_enc   TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  closed_at   TEXT,
  FOREIGN KEY (business_id) REFERENCES business (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS thread_scope_business
  ON thread (scope_id, business_id, pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS message (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  thread_id   TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL,
  content_enc TEXT NOT NULL,
  provider    TEXT,
  model       TEXT,
  cloud       INTEGER,
  created_at  TEXT NOT NULL,
  UNIQUE (thread_id, seq),
  FOREIGN KEY (thread_id) REFERENCES thread (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS message_scope_thread ON message (scope_id, thread_id, seq);

CREATE TABLE IF NOT EXISTS memory_item (
  id                TEXT PRIMARY KEY,
  scope_id          TEXT NOT NULL,
  business_id       TEXT NOT NULL,
  kind              TEXT NOT NULL,
  text_enc          TEXT NOT NULL,
  source_message_id TEXT,
  origin            TEXT NOT NULL,
  locked            INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  FOREIGN KEY (business_id) REFERENCES business (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_scope_business
  ON memory_item (scope_id, business_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_summary (
  thread_id          TEXT PRIMARY KEY,
  scope_id           TEXT NOT NULL,
  business_id        TEXT NOT NULL,
  text_enc           TEXT NOT NULL,
  covers_through_seq INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES thread (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS summary_scope_business ON memory_summary (scope_id, business_id);

CREATE TABLE IF NOT EXISTS proposal (
  id              TEXT PRIMARY KEY,
  scope_id        TEXT NOT NULL,
  business_id     TEXT NOT NULL,
  thread_id       TEXT,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL,
  title_enc       TEXT NOT NULL,
  payload_enc     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  expires_at      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (scope_id, idempotency_key),
  FOREIGN KEY (business_id) REFERENCES business (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS proposal_scope_business
  ON proposal (scope_id, business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_entry (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT,
  action      TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  detail_enc  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_scope ON audit_entry (scope_id, created_at DESC);
`

/**
 * Version 2: documents, chunks, the keyword and vector indexes, ingestion jobs,
 * Business DNA and its evidence and proposals.
 *
 * Two things about this migration are deliberate and worth stating, because both
 * look odd next to the plan's section 8 sketch of the same tables.
 *
 * There is no `chunk_fts` virtual table. FTS5 stores the words it indexes in the
 * clear, in the database file and in the journal, so a full-text index over document
 * text would put the whole library back on disk unencrypted - exactly what section
 * 7.2 forbids. `chunk_term` replaces it: one row per distinct word per chunk, holding
 * a keyed digest instead of the word. Search still works (digest the query the same
 * way, look for equal digests) and the index holds no readable text. The trade is
 * that the index reveals which chunks share a word, not what the word is.
 *
 * `chunk_vector.vec_enc` is a BLOB of sealed bytes rather than a `sqlite-vec`
 * virtual table, for the same reason: a vec0 table stores raw float arrays, which
 * are a reversible encoding of the document's meaning. The retrieval work in the
 * next step reads these rows and ranks them; the extension is still loaded at open
 * time and its status is recorded, so nothing here forecloses using it for indexes
 * that hold no personal data.
 *
 * `document.replaced_by` points forward at the new row rather than deleting the old
 * one, so a citation written before a replace can still name the document it came
 * from. The chunks, vectors, terms and DNA evidence of the replaced document are
 * removed; only the row itself is kept, and it is marked so nothing treats it as
 * current.
 */
const VERSION_2 = `
CREATE TABLE IF NOT EXISTS document (
  id           TEXT PRIMARY KEY,
  scope_id     TEXT NOT NULL,
  business_id  TEXT NOT NULL,
  name_enc     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  source       TEXT NOT NULL,
  status       TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  byte_size    INTEGER NOT NULL,
  page_count   INTEGER,
  failure      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  ready_at     TEXT,
  replaced_by  TEXT,
  FOREIGN KEY (business_id) REFERENCES business (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS document_scope_business
  ON document (scope_id, business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_scope_digest
  ON document (scope_id, business_id, content_digest);

CREATE TABLE IF NOT EXISTS document_blob (
  document_id TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  data_enc    BLOB NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES document (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_job (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  status      TEXT NOT NULL,
  stage       TEXT NOT NULL,
  progress    INTEGER NOT NULL DEFAULT 0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  failure     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  FOREIGN KEY (document_id) REFERENCES document (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS document_job_scope_business
  ON document_job (scope_id, business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS chunk (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  text_enc    TEXT NOT NULL,
  page        INTEGER,
  section_enc TEXT,
  tokens      INTEGER NOT NULL,
  embed_model TEXT,
  embed_state TEXT NOT NULL DEFAULT 'current',
  created_at  TEXT NOT NULL,
  UNIQUE (document_id, ordinal),
  FOREIGN KEY (document_id) REFERENCES document (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chunk_scope_document
  ON chunk (scope_id, business_id, document_id, ordinal);

CREATE TABLE IF NOT EXISTS chunk_term (
  chunk_id    TEXT NOT NULL,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  term        TEXT NOT NULL,
  occurrences INTEGER NOT NULL,
  PRIMARY KEY (chunk_id, term),
  FOREIGN KEY (chunk_id) REFERENCES chunk (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chunk_term_lookup ON chunk_term (scope_id, business_id, term);

CREATE TABLE IF NOT EXISTS chunk_vector (
  chunk_id    TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  model       TEXT NOT NULL,
  dims        INTEGER NOT NULL,
  vec_enc     BLOB NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunk (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chunk_vector_scope_document
  ON chunk_vector (scope_id, business_id, document_id);

CREATE TABLE IF NOT EXISTS dna (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  version     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (scope_id, business_id, version),
  FOREIGN KEY (business_id) REFERENCES business (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dna_scope_business ON dna (scope_id, business_id, version DESC);

CREATE TABLE IF NOT EXISTS dna_field (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  dna_id      TEXT NOT NULL,
  key         TEXT NOT NULL,
  value_enc   TEXT NOT NULL,
  source      TEXT NOT NULL,
  locked      INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  UNIQUE (dna_id, key),
  FOREIGN KEY (dna_id) REFERENCES dna (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dna_field_scope_business ON dna_field (scope_id, business_id, key);

CREATE TABLE IF NOT EXISTS dna_evidence (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL,
  business_id TEXT NOT NULL,
  field_id    TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chunk_id    TEXT,
  page        INTEGER,
  quote_enc   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (field_id) REFERENCES dna_field (id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES document (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dna_evidence_scope_document
  ON dna_evidence (scope_id, business_id, document_id);

CREATE TABLE IF NOT EXISTS dna_proposal (
  id           TEXT PRIMARY KEY,
  scope_id     TEXT NOT NULL,
  business_id  TEXT NOT NULL,
  document_id  TEXT,
  status       TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (business_id) REFERENCES business (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dna_proposal_scope_business
  ON dna_proposal (scope_id, business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS dna_proposal_change (
  id           TEXT PRIMARY KEY,
  scope_id     TEXT NOT NULL,
  business_id  TEXT NOT NULL,
  proposal_id  TEXT NOT NULL,
  key          TEXT NOT NULL,
  change       TEXT NOT NULL,
  proposed_enc TEXT NOT NULL,
  previous_enc TEXT,
  decision     TEXT NOT NULL DEFAULT 'pending',
  decided_at   TEXT,
  UNIQUE (proposal_id, key),
  FOREIGN KEY (proposal_id) REFERENCES dna_proposal (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dna_proposal_change_scope
  ON dna_proposal_change (scope_id, business_id, proposal_id);
`

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ version: 1, name: 'business-thread-message-memory', sql: VERSION_1 }),
  Object.freeze({ version: 2, name: 'documents-chunks-knowledge', sql: VERSION_2 }),
])

/** The newest version this build knows about. */
export const LATEST_MIGRATION_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
)
