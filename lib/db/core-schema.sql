-- TanyaData CORE schema (DECISION-014, CORE_ARCHITECTURE §3). Idempotent.
-- Dipakai oleh lib/db/client.ts dan scripts/init-workspace-db.mjs.
-- Tidak ada nama tabel/kolom domain di sini; semua nama objek berasal dari schema_json.

CREATE TABLE IF NOT EXISTS core_datasets(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tabular','document','mixed')),
  source_type TEXT NOT NULL CHECK(source_type IN ('csv','xlsx','sqlite','pdf','docx','txt','md')),
  doc_type TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL CHECK(status IN ('UPLOADED','PROCESSING','READY','FAILED')),
  schema_json TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  period_start TEXT,
  period_end TEXT,
  quality_report TEXT NOT NULL,
  storage_path TEXT,
  sha256 TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_core_datasets_status ON core_datasets(status, kind);

CREATE TABLE IF NOT EXISTS core_schema_columns(
  dataset_id TEXT NOT NULL REFERENCES core_datasets(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  inferred_type TEXT NOT NULL,
  semantic_role TEXT NOT NULL,
  nullable INTEGER NOT NULL DEFAULT 1,
  distinct_count INTEGER NOT NULL DEFAULT 0,
  sample_values TEXT NOT NULL DEFAULT '[]',
  unit TEXT,
  description TEXT,
  PRIMARY KEY(dataset_id, table_name, ordinal)
);

CREATE TABLE IF NOT EXISTS core_documents(
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES core_datasets(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  mime TEXT,
  pages INTEGER NOT NULL DEFAULT 0,
  sections_json TEXT NOT NULL DEFAULT '[]',
  source_path TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_core_documents_dataset ON core_documents(dataset_id);

CREATE TABLE IF NOT EXISTS core_chunks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES core_documents(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES core_datasets(id) ON DELETE CASCADE,
  section_path TEXT NOT NULL,
  page INTEGER,
  text TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL CHECK(level IN ('child','parent')),
  parent_id INTEGER,
  embedding_json TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_chunks_dataset ON core_chunks(dataset_id, level);
CREATE INDEX IF NOT EXISTS ix_core_chunks_doc ON core_chunks(document_id);

CREATE VIRTUAL TABLE IF NOT EXISTS core_chunks_fts USING fts5(
  text,
  section_path,
  content='core_chunks',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS core_chunks_ai AFTER INSERT ON core_chunks BEGIN
  INSERT INTO core_chunks_fts(rowid, text, section_path)
  VALUES (new.id, new.text, new.section_path);
END;
CREATE TRIGGER IF NOT EXISTS core_chunks_ad AFTER DELETE ON core_chunks BEGIN
  INSERT INTO core_chunks_fts(core_chunks_fts, rowid, text, section_path)
  VALUES ('delete', old.id, old.text, old.section_path);
END;
CREATE TRIGGER IF NOT EXISTS core_chunks_au AFTER UPDATE ON core_chunks BEGIN
  INSERT INTO core_chunks_fts(core_chunks_fts, rowid, text, section_path)
  VALUES ('delete', old.id, old.text, old.section_path);
  INSERT INTO core_chunks_fts(rowid, text, section_path)
  VALUES (new.id, new.text, new.section_path);
END;

CREATE TABLE IF NOT EXISTS core_queries(
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES core_datasets(id) ON DELETE CASCADE,
  nl_question TEXT NOT NULL,
  lang TEXT NOT NULL,
  generated_sql TEXT,
  sql_explanation TEXT,
  result_json TEXT NOT NULL,
  viz_spec TEXT NOT NULL,
  guardrail TEXT,
  evaluation TEXT,
  mode TEXT NOT NULL,
  answer TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_core_queries_dataset ON core_queries(dataset_id, created_at);

CREATE TABLE IF NOT EXISTS core_citations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL REFERENCES core_queries(id) ON DELETE CASCADE,
  chunk_id INTEGER,
  document_id TEXT,
  section_path TEXT NOT NULL,
  page INTEGER,
  quote TEXT,
  score REAL
);
CREATE INDEX IF NOT EXISTS ix_core_citations_query ON core_citations(query_id);

CREATE TABLE IF NOT EXISTS core_evaluations(
  id TEXT PRIMARY KEY,
  query_id TEXT REFERENCES core_queries(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  failed_checks TEXT NOT NULL DEFAULT '[]',
  metrics TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS core_ingestion_steps(
  dataset_id TEXT NOT NULL REFERENCES core_datasets(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','DONE','FAILED','SKIPPED')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(dataset_id, step)
);
