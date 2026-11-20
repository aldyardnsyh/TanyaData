/**
 * AI-lane shared types (P3-CORE).
 *
 * These mirror the shapes agreed in docs/CORE_AI_SPEC.md §3–§6 and
 * docs/CORE_ARCHITECTURE.md §3. They live in the AI lane because
 * `lib/core/contracts.ts` (backend lane, parallel work) was not present when
 * this module was written. Reconcile by re-exporting from that file once it
 * lands; no runtime behaviour depends on where these types are declared.
 *
 * Deliberately domain-agnostic: no table names, channel names, failure codes
 * or intent ids appear here.
 */

export type DocType = 'legal' | 'technical_report' | 'financial' | 'general';

export type OutputType =
  | 'kpi'
  | 'kpi_quote'
  | 'table'
  | 'parameter_table'
  | 'line'
  | 'bar'
  | 'donut'
  | 'quote'
  | 'timeline'
  | 'text'
  | 'none';

export type QuestionKind =
  | 'definition'
  | 'single_number'
  | 'distribution'
  | 'comparison'
  | 'trend'
  | 'parameter'
  | 'sequence'
  | 'procedure'
  | 'hybrid'
  | 'no_evidence'
  | 'unknown';

export type DataType = 'structured' | 'document' | 'hybrid' | 'none';

export type SemanticRole = 'dimension' | 'measure' | 'time' | 'identifier' | 'text';

export interface SchemaColumn {
  name: string;
  type?: string;
  inferred_type?: string;
  semantic_role?: SemanticRole;
  pk?: boolean;
  fk?: string;
  enum?: string[];
  unit?: string;
  description?: string;
  sample_values?: unknown[];
  distinct_count?: number;
  nullable?: boolean;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  row_count?: number;
  date_column?: string;
}

export interface SchemaJson {
  tables: SchemaTable[];
  relations?: unknown[];
  enums?: Record<string, string[]>;
}

export interface Signal {
  source: 'keyword' | 'heading' | 'table' | 'metadata' | 'llm';
  name: string;
  weight: number;
  score: number;
}

export interface ClassificationResult {
  doc_type: DocType;
  confidence: number;
  scores: Record<DocType, number>;
  signals: Signal[];
  needs_confirmation: boolean;
  runner_up: DocType | null;
  margin: number;
}

export interface Block {
  kind: string;
  text: string;
  page?: number;
  order?: number;
  table?: unknown;
}

export interface ExtractedField {
  name: string;
  value: string | number | null;
  unit?: string | null;
  currency?: string | null;
  period?: string | null;
  page?: number | null;
  incomplete?: boolean;
  raw?: string;
}

export interface PasalAyat {
  no: number;
  teks: string;
  page?: number;
}

export interface Pasal {
  no: string;
  judul?: string;
  ayat: PasalAyat[];
  page?: number;
}

export interface ExtractedTable {
  judul: string;
  columns: string[];
  rows: unknown[][];
  page?: number;
}

export interface ExtractionResult {
  doc_type: DocType;
  bab: { no: string; judul: string }[];
  pasal: Pasal[];
  parameter: ExtractedField[];
  metrik: ExtractedField[];
  section: { judul: string; teks: string; page?: number }[];
  tables: ExtractedTable[];
  referensi: string[];
  narasi: string[];
  tanggal: string[];
  warnings: string[];
}

export interface Chunk {
  id: string;
  parent_id?: string;
  section_path: string;
  doc: string;
  text: string;
  page?: number;
  doc_type?: DocType;
  parse_ok?: boolean;
  token_count?: number;
}

export interface Citation {
  chunk_id: string;
  section_id?: string;
  section_path: string;
  doc: string;
  page?: number | null;
  quote: string;
  score?: number;
  ayat?: number[];
}

export interface RetrievalScore {
  chunk_id: string;
  bm25: number;
  embed?: number;
  metadata: number;
  final: number;
}

export interface RetrievalResult {
  evidence: Citation[];
  context_bundle: string;
  scores: RetrievalScore[];
  status: 'ok' | 'evidence_limited' | 'no_evidence';
  tried_terms: string[];
  budget_tokens: number;
  used_tokens: number;
  message?: string;
}

export interface SqlPlan {
  sql: string;
  explanation: string;
  confidence: number;
  referenced_tables: string[];
  referenced_columns: string[];
  params: Record<string, string | number>;
  bindings: unknown[];
  mode: 'generated' | 'limited';
  reason?: string;
  supported_patterns?: string[];
}

export interface SqlValidation {
  ok: boolean;
  errors: string[];
  failed_layer?: string;
}

export interface SqlExecution {
  columns: string[];
  rows: unknown[][];
  duration_ms: number;
  row_count: number;
}

export interface QueryPlan {
  mode: 'sql' | 'document' | 'hybrid' | 'guardrail';
  question_kind: QuestionKind;
  data_type: DataType;
  entities: Record<string, unknown>;
  period: string | null;
  needed_sources: string[];
  assumptions: string[];
}

export type GuardrailType =
  | 'destructive'
  | 'pii'
  | 'out_of_scope'
  | 'ambiguous'
  | 'unsupported'
  | 'not_in_sources';

export interface GuardrailResult {
  triggered: boolean;
  type: GuardrailType | null;
  message: string;
  explanation: string;
}

export interface OutputDecision {
  type: OutputType;
  reason: string;
  confidence: number;
  anti_patterns_checked: string[];
}

export interface LlmConfig {
  mode: 'off' | 'assist' | 'full';
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
}

export type LlmFallback =
  | 'llm_off'
  | 'llm_unconfigured'
  | 'llm_timeout'
  | 'llm_error'
  | 'llm_invalid'
  | 'llm_ungrounded';

export interface LlmOutcome<T> {
  ok: boolean;
  data: T | null;
  fallbackReason: LlmFallback | null;
}
