/**
 * TanyaData CORE — universal, dataset-agnostic data contracts.
 * Source of truth: docs/CORE_ARCHITECTURE.md §3, docs/CORE_AI_SPEC.md §4.
 *
 * ATURAN: tidak ada nama tabel, kolom, status, atau satuan domain di file ini.
 * Semua pengetahuan domain berasal dari `SchemaJson` yang dibangun dari data
 * yang diunggah. File ini adalah titik koordinasi dengan lane aiml.
 */

import type { AnswerQuestionResult, Lang } from '@/lib/contracts/http';

export type { Lang };

/* ------------------------------------------------------------------ dataset */

export type DatasetKind = 'tabular' | 'document' | 'mixed';
export type SourceType = 'csv' | 'xlsx' | 'sqlite' | 'pdf' | 'docx' | 'txt' | 'md';
export type DatasetStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
export type DocType = 'legal' | 'technical_report' | 'financial' | 'general' | 'unknown';

export type OcrPageStatus = {
  page: number;
  status: 'ok' | 'ocr_skipped' | 'ocr_review' | 'not_attempted';
  confidence: number;
  latencyMs: number;
  reason?: string;
  width?: number;
  height?: number;
};

export type QualityReport = {
  parsedPages: number;
  tablesFound: number;
  ocrUsed: boolean;
  issues: string[];
  rowsParsed: number;
  rowsRejected: number;
  duplicateRows: number;
  missingByColumn: Record<string, number>;
  /** CORE V2 — aditif; aman untuk DB/eval lama. */
  ocrPages?: number[];
  ocrStatuses?: OcrPageStatus[];
  peakRssBytes?: number;
  pageLabels?: Array<{ page: number; label: string; needsOcr: boolean }>;
  cleaningLog?: Array<{ kind: string; before: string; after: string; reason: string }>;
  cleanFlags?: string[];
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
  /** CORE V2 — aditif. */
  content_hash?: string | null;
  page_span?: [number, number] | null;
  clean_version?: number;
  clean_flags?: string[];
  ocr_status?: string;
  confidence?: number;
  /** Fase 2A — unit bukti, offset, idempotensi per bagian, urutan baca. */
  char_start?: number | null;
  char_end?: number | null;
  unit_id?: string | null;
  section_id?: string | null;
  section_hash?: string | null;
  units_json?: string;
  reading_order?: string | null;
  layout_json?: string | null;
  embed_text?: string | null;
};

export type Citation = {
  chunk_id: number | null;
  document_id: string | null;
  section_path: string;
  page: number | null;
  quote: string | null;
  score: number | null;
  /** CORE V2 — aditif; deep-link tervalidasi fail-closed oleh AI adapter. */
  deep_link?: string | null;
  deep_link_status?: 'valid' | 'invalid' | 'unchecked';
  rev?: string | null;
};

/**
 * Structural mirrors of the AI-lane CORE V2 contracts. Declared here so
 * `lib/core/**` never imports `lib/ai/**`; the adapter passes structurally
 * compatible values across the port boundary.
 */
export type CitationRegistryView = {
  documents: Record<string, { status?: string; pageCount?: number; rev?: string }>;
  chunks: Record<string, {
    document_id: string;
    section_path: string;
    page: number | null;
    page_end?: number | null;
    text: string;
    parse_ok?: boolean;
    ocr_status?: string | null;
    rev?: string | null;
  }>;
};

export type AttachmentScopeView = {
  id: string;
  dataset_id: string;
  source_id?: string | null;
  name: string;
  doc_type?: string | null;
  status: DatasetStatus;
  active_in_conversation?: boolean;
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
  /** Pesan utama yang tampil sebagai jawaban. Boleh berbeda dari `explanation`. */
  answer?: string;
  /** Penjelasan ringkas; tidak boleh mengulang `answer` kata demi kata. */
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

/**
 * Additive observability metadata. Absent when no AI port ran, so the
 * deterministic baseline (and the 8/8 eval) is byte-for-byte unaffected.
 */
export type QueryMeta = {
  aiActive?: boolean;
  confidenceLevel?: EvidenceConfidenceLevel;
  alternativeKeywords?: string[];
  fallbackReason?: string;
  guardrailType?: string;
  /** FASE 2H — structured, ID-bound citation payload (additive; UI footer is
   * derived from this, inline markers are the primary mechanism). */
  structuredAnswer?: StructuredAnswerView | null;
  /** FASE 2H — verifier outcome for the generated claims. */
  citationVerification?: { ok: boolean; failures: string[]; degraded: boolean } | null;
};

/** Structural mirrors of the FASE 2H AI-lane contract (no lib/ai import). */
export type StructuredSegmentKind =
  | 'framing' | 'claim' | 'inference' | 'caveat' | 'absence' | 'clarification';

export type StructuredSegmentView = {
  text: string;
  kind: StructuredSegmentKind;
  cite: string[];
};

export type StructuredCitationView = {
  doc: string;
  page: number | null;
  section_id: string;
  section_title: string;
  unit_ids: string[];
  char_start: number;
  char_end: number;
  quote: string;
};

export type StructuredAnswerView = {
  segments: StructuredSegmentView[];
  citations: Record<string, StructuredCitationView>;
  retrieval_trace?: {
    checked_sections: string[];
    unit_ids: string[];
    diversified: boolean;
  };
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
  /** CORE V2 — opsional; diisi hanya bila AI port benar-benar dipakai. */
  meta?: QueryMeta;
};

export type QueryContext = {
  period?: { start: string; end: string } | null;
  entities?: Record<string, string | number>;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * SQL dari jawaban asisten sebelumnya — dipakai resolusi follow-up
   * anafora ("jabarkan laporan ini") supaya pertanyaan lanjutan memakai
   * hasil sebelumnya, bukan dianggap pertanyaan baru di luar cakupan.
   */
  lastResult?: { sql: string; rowCount: number } | null;
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

/* ------------------------------------------------------- evidence confidence */

/**
 * Three-level evidence confidence (rag-ids adaptation, CORE_AI_SPEC §5.4).
 *
 * - `strong`: high FTS5 score AND a citation that matches the asked entity.
 * - `limited`: evidence exists but is weak or does not match the entity.
 * - `refused`: no evidence; refuse and offer alternative keywords instead of
 *   filling the gap with model knowledge.
 */
export type EvidenceConfidenceLevel = 'strong' | 'limited' | 'refused';

/**
 * Optional extension of the frozen HTTP contract. The backend does not edit
 * `lib/contracts/http.ts`; aiml declares the two additive fields here and
 * merges them at the AI boundary. Structurally assignable to
 * `AnswerQuestionResult`, so existing callers need no change.
 */
export type AnswerQuestionResultWithEvidence = AnswerQuestionResult & {
  confidenceLevel?: EvidenceConfidenceLevel;
  alternativeKeywords?: string[];
};
