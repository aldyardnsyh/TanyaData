-- TanyaData workspace schema (ARCHITECTURE §4.2). Idempotent.
-- Dijalankan oleh scripts/init-workspace-db.mjs dan lib/db/client.ts.

CREATE TABLE IF NOT EXISTS app_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dataset_id TEXT NOT NULL DEFAULT 'seed',
  lang TEXT NOT NULL DEFAULT 'id',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  payload_json TEXT,
  context_json TEXT,
  mode TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_seq ON messages(conversation_id, seq);
CREATE INDEX IF NOT EXISTS ix_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  message_id TEXT,
  dataset_id TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_reports_created ON reports(created_at);

CREATE TABLE IF NOT EXISTS investigations(
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  compare_start TEXT,
  compare_end TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_investigations_created ON investigations(created_at);

CREATE TABLE IF NOT EXISTS data_sources(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('dataset','document')),
  name TEXT NOT NULL,
  original_name TEXT,
  format TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('UPLOADED','PROCESSING','READY','FAILED')),
  row_count INTEGER,
  chunk_count INTEGER,
  error TEXT,
  storage_path TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sources_kind ON data_sources(kind, status);

CREATE TABLE IF NOT EXISTS dataset_columns(
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  sql_type TEXT NOT NULL,
  nullable INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(source_id, table_name, ordinal)
);

CREATE TABLE IF NOT EXISTS dataset_samples(
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  row_no INTEGER NOT NULL,
  row_json TEXT NOT NULL,
  PRIMARY KEY(source_id, table_name, row_no)
);

CREATE TABLE IF NOT EXISTS document_chunks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  doc_title TEXT NOT NULL,
  section_no INTEGER,
  section TEXT,
  page INTEGER,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  char_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chunks_source ON document_chunks(source_id);

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  content,
  doc_title,
  section,
  content='document_chunks',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS document_chunks_ai AFTER INSERT ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(rowid, content, doc_title, section)
  VALUES (new.id, new.content, new.doc_title, new.section);
END;

CREATE TRIGGER IF NOT EXISTS document_chunks_ad AFTER DELETE ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content, doc_title, section)
  VALUES ('delete', old.id, old.content, old.doc_title, old.section);
END;

CREATE TRIGGER IF NOT EXISTS document_chunks_au AFTER UPDATE ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content, doc_title, section)
  VALUES ('delete', old.id, old.content, old.doc_title, old.section);
  INSERT INTO document_chunks_fts(rowid, content, doc_title, section)
  VALUES (new.id, new.content, new.doc_title, new.section);
END;

CREATE TABLE IF NOT EXISTS ingestion_jobs(
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES data_sources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','DONE','FAILED')),
  step TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_jobs_source ON ingestion_jobs(source_id, status);

CREATE TABLE IF NOT EXISTS query_log(
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  message_id TEXT,
  sql TEXT NOT NULL,
  params_json TEXT,
  row_count INTEGER,
  duration_ms INTEGER,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
