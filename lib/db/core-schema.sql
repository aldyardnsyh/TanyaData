-- TanyaData CORE schema (DECISION-014, CORE_ARCHITECTURE §3). Idempotent.
-- Dipakai oleh lib/db/client.ts dan scripts/init-workspace-db.mjs.
-- Tidak ada nama tabel/kolom domain di sini; semua nama objek berasal dari schema_json.

CREATE TABLE IF NOT EXISTS core_datasets(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tabular','document','mixed')),
  source_type TEXT NOT NULL CHECK(source_type IN ('csv','xlsx','sqlite','pdf','docx','txt','md')),
  doc_type TEXT NOT NULL DEFAULT 'unknown',
  -- WS-A / ADAPT-1: grup dokumen turunan doc_type (finance/sop/technical/identity/general).
  -- Nullable agar DB lama bisa di-ALTER tanpa backfill destruktif; nilai diisi
  -- oleh kode ingest dan dibackfill sekali oleh ensureDocTaxonomyColumns().
  doc_group TEXT,
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
  -- WS-A / ADAPT-1: grup dokumen (lihat core_datasets.doc_group).
  doc_group TEXT,
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
  embedding_json TEXT,
  content_hash TEXT,
  page_span TEXT,
  clean_version INTEGER NOT NULL DEFAULT 0,
  clean_flags TEXT NOT NULL DEFAULT '[]',
  ocr_status TEXT NOT NULL DEFAULT 'ok',
  confidence REAL NOT NULL DEFAULT 1,
  -- Fase 2A: unit bukti + offset + idempotensi per bagian + urutan baca.
  char_start INTEGER,
  char_end INTEGER,
  unit_id TEXT,
  section_id TEXT,
  section_hash TEXT,
  units_json TEXT NOT NULL DEFAULT '[]',
  reading_order TEXT,
  layout_json TEXT,
  embed_text TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_chunks_dataset ON core_chunks(dataset_id, level);
CREATE INDEX IF NOT EXISTS ix_core_chunks_doc ON core_chunks(document_id);
CREATE INDEX IF NOT EXISTS ix_core_chunks_section ON core_chunks(document_id, section_id);

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
  score REAL,
  page_end INTEGER,
  rev TEXT,
  deep_link TEXT,
  status TEXT NOT NULL DEFAULT 'valid',
  reject_reason TEXT
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

-- CORE V2 (DECISION-016) — tabel aditif. Semua idempoten via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS core_attachments(
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES core_datasets(id) ON DELETE CASCADE,
  source_id TEXT,
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'UPLOADED',
  active_in_conversation TEXT,
  quality_report_ref TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(dataset_id, source_id)
);
CREATE INDEX IF NOT EXISTS ix_core_attachments_dataset ON core_attachments(dataset_id, status);

CREATE TABLE IF NOT EXISTS core_readjustment_ops(
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  query_id TEXT,
  seq INTEGER NOT NULL,
  op_type TEXT NOT NULL CHECK(op_type IN ('filter','group_by','classify','report')),
  input_fragment TEXT NOT NULL,
  resolved_filters TEXT NOT NULL DEFAULT '{}',
  resolved_columns TEXT NOT NULL DEFAULT '[]',
  before_json TEXT,
  after_json TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_core_readjustment_conv ON core_readjustment_ops(conversation_id, seq);

CREATE TABLE IF NOT EXISTS core_report_jobs(
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL,
  conversation_id TEXT,
  doc_type TEXT NOT NULL DEFAULT 'general',
  format TEXT NOT NULL CHECK(format IN ('pdf','xlsx')),
  status TEXT NOT NULL CHECK(status IN ('QUEUED','DONE','FAILED')),
  result_json_ref TEXT NOT NULL,
  chart_spec TEXT NOT NULL DEFAULT '{}',
  identity_json TEXT NOT NULL DEFAULT '{}',
  row_cap INTEGER NOT NULL DEFAULT 500,
  artifact_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_core_report_jobs_query ON core_report_jobs(query_id);

CREATE TABLE IF NOT EXISTS core_share_snapshots(
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '{}',
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  -- P6-FIX / SEC-002: expiry + revoke (nullable → aman untuk DB lama).
  expires_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_share_created ON core_share_snapshots(created_at);
CREATE INDEX IF NOT EXISTS ix_core_share_expiry ON core_share_snapshots(expires_at);

CREATE TABLE IF NOT EXISTS core_citation_deeplinks(
  id TEXT PRIMARY KEY,
  query_id TEXT,
  chunk_id INTEGER,
  document_id TEXT,
  page INTEGER,
  page_end INTEGER,
  section_path TEXT,
  quote TEXT,
  rev TEXT,
  deep_link TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('valid','rejected')),
  reject_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_core_deeplinks_query ON core_citation_deeplinks(query_id);

-- Qdrant sync outbox (DECISION-032 / ADR-QD-04). SQLite tetap source of truth;
-- Qdrant adalah derived index. Baris ditulis dalam transaksi yang sama dengan
-- core_chunks, lalu dikuras worker dengan wait=true. Reversible: DROP TABLE.
CREATE TABLE IF NOT EXISTS qdrant_outbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL,
  dataset_id TEXT NOT NULL,
  source_id TEXT,
  op TEXT NOT NULL CHECK(op IN ('upsert','delete_source')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chunk_id, op)
);
CREATE INDEX IF NOT EXISTS ix_qdrant_outbox_pending ON qdrant_outbox(status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS ix_qdrant_outbox_source ON qdrant_outbox(source_id);

-- Tombstone penghapusan sumber bila Qdrant sedang mati. removeSource TIDAK
-- boleh diblokir oleh Qdrant; penghapusan point menyusul saat Qdrant kembali.
CREATE TABLE IF NOT EXISTS qdrant_pending_deletes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
