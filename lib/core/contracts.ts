/**
 * TanyaData CORE — universal, dataset-agnostic data contracts.
 * Source of truth: docs/CORE_ARCHITECTURE.md §3, docs/CORE_AI_SPEC.md §4.
 *
 * ATURAN: tidak ada nama tabel, kolom, status, atau satuan domain di file ini.
 * Semua pengetahuan domain berasal dari `SchemaJson` yang dibangun dari data
 * yang diunggah. File ini adalah titik koordinasi dengan lane aiml.
 */

import type { Lang } from '@/lib/contracts/http';

export type { Lang };

/* ------------------------------------------------------------------ dataset */

export type DatasetKind = 'tabular' | 'document' | 'mixed';
export type SourceType = 'csv' | 'xlsx' | 'sqlite' | 'pdf' | 'docx' | 'txt' | 'md';
export type DatasetStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
export type DocType = 'legal' | 'technical_report' | 'financial' | 'general' | 'unknown';

export type QualityReport = {
  parsedPages: number;
  tablesFound: number;
  ocrUsed: boolean;
  issues: string[];
  rowsParsed: number;
  rowsRejected: number;
  duplicateRows: number;
  missingByColumn: Record<string, number>;
};

export type Dataset = {
  id: string;
  name: string;
  kind: DatasetKind;
  source_type: SourceType;
  doc_type: DocType;
  status: DatasetStatus;
  schema_json: SchemaJson;
  row_count: number;
  period_start: string | null;
  period_end: string | null;
  quality_report: QualityReport;
  storage_path: string | null;
  sha256: string | null;
  size_bytes: number;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
};

/* ------------------------------------------------------------------- schema */

export type InferredType = 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'text';
export type SemanticRole = 'dimension' | 'measure' | 'time' | 'identifier' | 'text';

/** Satu kolom hasil profiler. Dipakai SQL builder DAN viz engine. */
export type SchemaColumn = {
  /** Nama identifier yang dipakai di SQL (sudah aman, tanpa spasi). */
  name: string;
  /** Nama asli dari sumber (boleh mengandung spasi / karakter lain). */
  sourceName: string;
  inferred_type: InferredType;
  semantic_role: SemanticRole;
  nullable: boolean;
  distinct_count: number;
  sample_values: Array<string | number | boolean | null>;
  unit: string | null;
  description: string | null;
};

export type SchemaTable = {
  /** Nama objek yang di-whitelist untuk SQL (mis. `core_data_ab12` atau `seed.transactions`). */
  name: string;
  /** Nama tabel/sheet asli di sumber. */
  sourceName: string;
  rowCount: number;
  columns: SchemaColumn[];
  /** Kolom bertipe time yang dipilih sebagai sumbu waktu utama, bila ada. */
  dateColumn: string | null;
};

export type SchemaRelation = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};

export type SchemaJson = {
  version: 1;
  /** SHA-256 dari ringkasan skema; dipakai cache kandidat SQL. */
  hash: string;
  tables: SchemaTable[];
  relations: SchemaRelation[];
  enums: Record<string, Array<string | number>>;
};

/* --------------------------------------------------------- document / chunk */

export type DocumentSection = {
  section_path: string;
  page: number | null;
  char_count: number;
};

export type Document = {
  id: string;
  dataset_id: string;
  doc_type: DocType;
  mime: string | null;
  pages: number;
  sections: DocumentSection[];
  source_path: string | null;
  created_at: string;
};

export type ChunkLevel = 'child' | 'parent';

export type Chunk = {
  id?: number;
  document_id: string;
  dataset_id: string;
  section_path: string;
  page: number | null;
  text: string;
  token_count: number;
  char_count: number;
  level: ChunkLevel;
  parent_id: number | null;
  embedding: number[] | null;
};

export type Citation = {
  chunk_id: number | null;
  document_id: string | null;
  section_path: string;
  page: number | null;
  quote: string | null;
  score: number | null;
};

/* -------------------------------------------------------------------- query */

export type VizType = 'line' | 'bar' | 'donut' | 'kpi' | 'table' | 'quote' | 'timeline' | 'none';

export type VizSpec = {
  type: VizType;
  /** Wajib. VizSpec tanpa reason dianggap cacat (CORE_ARCHITECTURE §6). */
  reason: string;
  x_key: string | null;
  y_keys: string[];
  data: Array<Record<string, string | number | boolean | null>>;
  confidence: number;
};

export type GuardrailType =
  | 'out_of_range'
  | 'not_in_sources'
  | 'destructive'
  | 'pii'
  | 'ambiguous'
  | 'unsupported'
  | 'sql_rejected';

export type Guardrail = {
  type: GuardrailType;
  explanation: string;
};

export type EvaluationResult = {
  passed: boolean;
  failed_checks: string[];
  metrics: {
    numeric_grounding: number;
    citation_valid: number;
    output_type_ok: boolean;
    row_count: number;
    latency_ms: number;
  };
};

export type QueryMode = 'sql' | 'document' | 'hybrid' | 'guardrail';

export type QueryResultJson = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
};

export type Query = {
  id: string;
  dataset_id: string;
  nl_question: string;
  lang: Lang;
  generated_sql: string | null;
  sql_explanation: string | null;
  result_json: QueryResultJson;
  viz_spec: VizSpec;
  citations: Citation[];
  guardrail: Guardrail | null;
  evaluation: EvaluationResult | null;
  mode: QueryMode;
  answer: string;
  duration_ms: number;
  created_at: string;
};

export type QueryContext = {
  period?: { start: string; end: string } | null;
  entities?: Record<string, string | number>;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

/* ----------------------------------------------------------------- ingestion */

export type IngestionStepStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

export type IngestionStep = {
  dataset_id: string;
  step: string;
  status: IngestionStepStatus;
  duration_ms: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/* ------------------------------------------------------------ sql candidate */

export type SqlCandidate = {
  sql: string;
  explanation: string;
  confidence: number;
  referenced_tables: string[];
  referenced_columns: string[];
  params: Record<string, string | number | null>;
  /** `generated` = dari generator (LLM/aiml); `limited` = rule-based jujur. */
  mode: 'generated' | 'limited';
  reason?: string;
};

export type SqlExecution = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  sql: string;
};

export type ValidationOutcome =
  | { ok: true; sql: string; params: Record<string, string | number | null> }
  | { ok: false; code: 'SQL_REJECTED' | 'SQL_TIMEOUT'; reason: string; layer: string };
