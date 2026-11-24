/**
 * TanyaData HTTP contracts — FROZEN after scaffold.
 * Source of truth: docs/API_CONTRACT.md §3–§10. Read-only for aiml & frontend.
 * Numbers are JSON numbers, dates are `YYYY-MM-DD`, timestamps are ISO-8601 with +07:00.
 */

export type Lang = 'id' | 'en';

export type PeriodCompareStrategy = 'like_for_like' | 'previous' | 'none';

export type Period = {
  start: string;
  end: string;
  label: string;
  isPartial: boolean;
  dayCount: number;
  compare: null | {
    start: string;
    end: string;
    label: string;
    strategy: PeriodCompareStrategy;
  };
};

export type DatasetRef = {
  id: string;
  name: string;
  kind: 'seed' | 'upload';
  rowCount: number;
  minDate: string;
  maxDate: string;
};

export type KpiKey =
  | 'total'
  | 'successful'
  | 'failed'
  | 'successRate'
  | 'failureRate'
  | 'successValue';

export type Kpi = {
  key: KpiKey;
  label: string;
  value: number | null;
  format: 'number' | 'percent' | 'currency';
  changePct: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  compareValue: number | null;
};

export type SourceCitation = {
  kind: 'document' | 'dataset';
  sourceId: string;
  docId?: string;
  docTitle?: string;
  sectionNo?: number | null;
  section?: string | null;
  page?: number | null;
  quote?: string;
  chunkId?: number;
  score?: number;
  table?: string;
  period?: string;
  sql?: string;
  /** CORE V2 — deep-link tervalidasi fail-closed oleh AI adapter. */
  deep_link?: string | null;
  deep_link_status?: 'valid' | 'invalid' | 'unchecked';
};

export type SupportingTableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right';
  format?: 'number' | 'percent' | 'currency' | 'text';
};

export type SupportingTable = {
  columns: SupportingTableColumn[];
  rows: Record<string, string | number | null>[];
  totalRows: number;
  truncated: boolean;
};

export type Visualization = {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'kpi';
  title: string;
  dataKey: string;
  xKey: string;
  series: { key: string; label: string; unit?: '%' | 'IDR' | 'tx'; colorToken?: string }[];
  rows: Record<string, string | number | null>[];
  orientation?: 'vertical' | 'horizontal';
  stacked?: boolean;
  format?: 'number' | 'percent' | 'currency';
};

/* ------------------------------------------------------------------ errors */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNPROCESSABLE_SOURCE'
  | 'INTERNAL_ERROR'
  /** P6-FIX / B2 — kuota permintaan terlampaui (HTTP 429). */
  | 'RATE_LIMITED'
  /** P6-FIX / SEC-001 — mode publik tanpa auth ditolak (HTTP 503). */
  | 'PUBLIC_DEPLOY_BLOCKED';

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; details?: unknown };
};

/* --------------------------------------------------------------- dashboard */

export type DashboardSummaryResponse = {
  period: Period;
  dataset: DatasetRef;
  kpis: Kpi[];
  empty: boolean;
  notes: string[];
};

export type TrendGrain = 'day' | 'week' | 'month';

export type TrendPoint = {
  bucket: string;
  label: string;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  failureRate: number;
};

export type TrendsResponse = {
  grain: TrendGrain;
  points: TrendPoint[];
  totals: { total: number; successful: number; failed: number };
  truncated: boolean;
  period: Period;
  dataset: DatasetRef;
  notes?: string[];
};

export type StatusDistributionItem = {
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'EXPIRED' | 'REFUNDED';
  count: number;
  percent: number;
};

export type StatusDistributionResponse = {
  items: StatusDistributionItem[];
  total: number;
  period: Period;
  dataset: DatasetRef;
};

export type ChannelPerformanceItem = {
  channelId: string;
  channelName: string;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  failureRate: number;
  share: number;
  changePct: number | null;
};

export type ChannelPerformanceResponse = {
  metric: 'volume' | 'failure_rate';
  items: ChannelPerformanceItem[];
  total: number;
  truncated: boolean;
  period: Period;
  dataset: DatasetRef;
};

export type CategoryPerformanceItem = {
  categoryName: string;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  failureRate: number;
  share: number;
  avgTicket: number | null;
  changePct: number | null;
};

export type CategoryPerformanceResponse = {
  items: CategoryPerformanceItem[];
  total: number;
  truncated: boolean;
  period: Period;
  dataset: DatasetRef;
};

export type Insight = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  metric: string;
  channel?: string | null;
  period: string;
  evidence: { sql: string; refs: string[] };
  links: { label: string; href: string }[];
};

export type InsightsResponse = {
  items: Insight[];
  generatedAt: string;
  period: Period;
  dataset: DatasetRef;
};

/* -------------------------------------------------------------------- chat */

export type ChatRole = 'user' | 'assistant' | 'system';
export type ChatMode = 'sql' | 'rag' | 'hybrid' | 'guardrail' | 'smalltalk';

export type GuardrailType =
  | 'out_of_range'
  | 'not_in_sources'
  | 'destructive'
  | 'pii'
  | 'ambiguous'
  | 'unsupported';

export type ChatMeta = {
  period: Period | null;
  dataset: DatasetRef;
  partial: boolean;
  rowCount: number;
  mode: ChatMode;
  latencyMs: number;
  contextApplied?: ('period' | 'channel' | 'category' | 'failureCode')[];
  assumed?: boolean;
  fallbackReason?: 'llm_timeout' | 'llm_error' | 'llm_invalid' | 'sql_rejected';
  /** CORE V2 — observability aditif dari Query.meta; tidak mengubah mode UI. */
  aiActive?: boolean;
  confidenceLevel?: 'strong' | 'limited' | 'refused';
  alternativeKeywords?: string[];
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  createdAt: string;
  content: string;
  answer?: string;
  keyFindings?: { text: string; ref?: string }[];
  supportingTable?: SupportingTable | null;
  visualizations?: Visualization[];
  sql?: { query: string; durationMs: number; rowCount: number; error?: string } | null;
  sources?: SourceCitation[];
  followUps?: string[];
  meta?: ChatMeta;
  guardrail?: { type: GuardrailType; explanation: string };
  /** State follow-up untuk turn berikutnya (cermin AssistantContext). */
  context?: AssistantContext | null;
};

export type ConversationSummary = {
  id: string;
  title: string;
  lang: Lang;
  dataset: { id: string; name: string };
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  preview?: string;
  updatedAt?: string;
  /** Grup topik percakapan (NotebookLM-style sidebar). */
  groupName?: string | null;
  pinned?: boolean;
};

export type ConversationListResponse = {
  items: ConversationSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type ConversationCreateResponse = { conversation: ConversationSummary };
export type ConversationDetailResponse = {
  conversation: ConversationSummary;
  /** FR-C: attachment yang aktif untuk percakapan ini (konteks chat). */
  activeAttachment: { id: string; name: string; docType: string } | null;
  /** Kelompok dokumen percakapan (NotebookLM-style): basis pengetahuan sesi. */
  activeAttachments: Array<{ id: string; name: string; docType: string }>;
  messages: ChatMessage[];
};
export type SendMessageResponse = {
  message: ChatMessage;
  conversation: { id: string; title: string; updatedAt: string; messageCount: number };
};

/* ----------------------------------------------------------- investigations */

export type RateComparison = {
  current: number;
  previous: number;
  deltaPctPoints: number;
};

export type InvestigationComparison = {
  failureRate: RateComparison;
  total: { current: number; previous: number; changePct: number | null };
};

export type ContributionChannel = {
  channelName: string;
  failureRate: number;
  baselineFailureRate: number;
  excessFailures: number;
  shareOfExcess: number;
};

export type FailureCodeContribution = {
  failureCode: string;
  failureName: string;
  per1000: { sep: number; oct: number; nov: number };
};

export type InvestigationConcentration = {
  byChannelCategory: { channelName: string; category: string; failureRate: number }[];
  byHour: { channelName: string; bucket: string; failureRate: number }[];
};

export type TemporalPoint = {
  channelName: string;
  date: string;
  kind: 'start' | 'worsened' | 'resolved';
};

export type TemporalSeries = {
  channelName: string;
  grain: 'day' | 'week' | 'month';
  rows: { bucket: string; failureRate: number }[];
};

export type InvestigationTemporal = {
  points: TemporalPoint[];
  series: TemporalSeries[];
  notes: string[];
};

export type InvestigationConclusion = {
  text: string;
  claimLevel: 'measured' | 'indication' | 'proven';
  caveats: string[];
};

export type Investigation = {
  id: string;
  question: string;
  createdAt: string;
  period: Period;
  dataset: DatasetRef;
  comparison: InvestigationComparison;
  contribution: { channels: ContributionChannel[]; failureCodes: FailureCodeContribution[] };
  concentration: InvestigationConcentration;
  temporal: InvestigationTemporal;
  documents: SourceCitation[];
  conclusion: InvestigationConclusion;
  evidence: { sql: string[]; sourceIds: string[] };
};

export type InvestigationsOverviewResponse = {
  period: Period;
  failureRate: RateComparison;
  topChannels: {
    channelName: string;
    failureRate: number;
    previousFailureRate: number;
    excessFailures: number;
    severity: 'high' | 'medium' | 'low';
  }[];
  changePoints: { channelName: string; date: string }[];
  saved: number;
};

export type AnomalyItem = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  kind: 'channel_failure_spike' | 'failure_code_spike' | 'category_volume_change';
  channelName?: string;
  metric: string;
  baseline: number;
  current: number;
  deltaPctPoints: number;
  detectedAt: string;
  window: string;
  evidence: { sql: string };
};

export type AnomaliesResponse = { items: AnomalyItem[]; total: number };

export type InvestigationListItem = {
  id: string;
  question: string;
  period: string;
  /** Sumber tempat investigasi dijalankan (paralel ringkasan per dokumen). */
  datasetId: string | null;
  datasetName: string | null;
  topChannel: string | null;
  claimLevel: 'measured' | 'indication' | 'proven';
  createdAt: string;
};

export type InvestigationsListResponse = {
  items: InvestigationListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type InvestigationDetailResponse = { investigation: Investigation };
export type InvestigateResponse = { investigation: Investigation };

/* ----------------------------------------------------------------- reports */

export type ReportListItem = {
  id: string;
  title: string;
  period: string;
  dataset: { id: string; name: string };
  createdAt: string;
};

export type ReportMetric = {
  key: string;
  label: string;
  value: number | null;
  format: 'number' | 'percent' | 'currency' | 'text';
};

export type ReportDetail = {
  id: string;
  title: string;
  createdAt: string;
  dataset: DatasetRef;
  period: Period | null;
  question: string;
  summary: string;
  keyFindings: { text: string; ref?: string }[];
  metrics: ReportMetric[];
  supportingTable: SupportingTable | null;
  visualizations: Visualization[];
  sources: SourceCitation[];
  sql: { query: string }[];
};

export type ReportListResponse = {
  items: ReportListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type ReportCreateResponse = {
  report: {
    id: string;
    title: string;
    messageId: string;
    conversationId: string;
    createdAt: string;
  };
};

export type ReportDetailResponse = { report: ReportDetail };

/* ----------------------------------------------------------------- sources */

export type SourceStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
export type SourceKind = 'dataset' | 'document';

export type IngestionJob = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  step: string | null;
  progress: number;
  message?: string | null;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
};

export type SourceListItem = {
  id: string;
  kind: SourceKind;
  name: string;
  originalName?: string | null;
  format: string;
  mime?: string | null;
  sizeBytes: number;
  status: SourceStatus;
  rowCount: number | null;
  tableCount?: number | null;
  chunkCount: number | null;
  pageCount?: number | null;
  createdAt: string;
  updatedAt?: string;
  error?: string | null;
  meta?: { minDate?: string; maxDate?: string; tables?: number } | null;
};

export type SourcesListResponse = {
  items: SourceListItem[];
  total: number;
  counts: { dataset: number; document: number; processing: number; failed: number };
};

export type SourceSchemaColumn = { name: string; type: string; nullable: boolean };

/** D2: ringkasan deterministik per dokumen (dari chunk terindeks, tanpa LLM). */
export type SourceSummaryResponse = {
  source: { id: string; name: string; format: string; pageCount: number | null };
  totals: { chunks: number; sections: number; ocrSkipped: number };
  sections: { title: string; page: number | null; chunkCount: number; excerpt: string }[];
  generatedAt: string;
  note: string;
};

/** Analytics per dokumen — deterministik dari chunk (tipe + metrik + insight). */
export type SourceAnalyticsEntity = { label: string; count: number; topSection: string | null; topPage: number | null };
export type SourceAnalyticsResponse = {
  source: { id: string; name: string; format: string };
  docType: 'financial-report' | 'incident-report' | 'general';
  docTypeLabel: string;
  confidence: number;
  signals: string[];
  totals: { chunks: number; sections: number; pages: number | null; words: number };
  entities: {
    failureCodes: SourceAnalyticsEntity[];
    channels: SourceAnalyticsEntity[];
    durations: SourceAnalyticsEntity[];
    amounts: SourceAnalyticsEntity[];
    percentages: SourceAnalyticsEntity[];
    contacts: string[];
  };
  insights: string[];
  generatedAt: string;
  note: string;
};

/** Bukti sitasi — satu chunk dokumen yang dirujuk dari chat (deep-link). */
export type CitationChunkResponse = {
  source: { id: string };
  chunk: {
    id: number;
    sectionNo: number | null;
    section: string | null;
    page: number | null;
    content: string;
    charCount: number;
  };
};

export type DatasetSourceDetail = {
  source: SourceListItem;
  schema: { tableName: string; columns: SourceSchemaColumn[] } | null;
  quality: {
    missingByColumn: Record<string, number>;
    duplicateRows: number;
    rowsParsed: number;
    rowsRejected: number;
  } | null;
  bounds: { minDate: string; maxDate: string } | null;
  active: boolean;
  job: IngestionJob | null;
};

export type DocumentSourceDetail = {
  source: SourceListItem;
  sections: { no: number | null; title: string; page: number | null; chunkCount: number }[];
  index: { indexed: boolean; indexedAt: string | null; engine: string };
  job: IngestionJob | null;
};

export type SourceDetailResponse = DatasetSourceDetail | DocumentSourceDetail;

export type PreviewResponse = {
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, string | number | null>[];
  rowCount: number;
  limit: number;
  truncated: boolean;
};

export type SourceCreateResponse = { source: SourceListItem; job: IngestionJob };
export type ReindexResponse = { job: IngestionJob };

/* ---------------------------------------------------------------- settings */

export type SettingsResponse = {
  profile: { name: string; role: string };
  lang: Lang;
  dateRange: { start: string; end: string; preset: string };
  activeDatasetId: string;
  /**
   * @deprecated DECISION-036 (P6-UI-HONESTY): tidak ada konsumen perilaku.
   * `chartDefault`/`denseTables` hanya disimpan lalu dibaca ulang oleh form
   * pengaturan; tidak ada pembaca di `lib/core`, `lib/ai`, dashboard, chart,
   * maupun tabel (lihat `docs/SYSTEM_OVERVIEW.md` §7). UI berhenti mengirim
   * field ini; backend mempertahankannya agar payload lama tetap valid.
   * Pembersihan menyeluruh (termasuk skema + seed) dilacak di tiket SET-03.
   */
  preferences: { chartDefault: string; denseTables: boolean };
  datasets: { id: string; name: string; rowCount: number }[];
  updatedAt: string;
};

/* -------------------------------------------------------------------- meta */

/* -------------------------------------------- meta: payload `system` (aditif) */

/** Satu baris tabel teknologi. `version` WAJIB dari `package.json`, bukan hafalan. */
export type SystemStackItem = {
  name: string;
  version: string;
  role: string;
  stage: 'platform' | 'ingest' | 'retrieval' | 'compose' | 'output';
  required: boolean;
  /** Provenance untuk chip di tab Tentang (DESIGN_SYSTEM §J.3). */
  source?: string;
};

/** Satu tahap pipeline. Teks berasal dari `docs/SYSTEM_OVERVIEW.md` §2. */
export type SystemPipelineStage = {
  id: 'ingest' | 'retrieval' | 'compose' | 'output';
  label: string;
  summary: string;
  inputs: string[];
  outputs: string[];
  fallback?: string;
  source?: string;
};

/** Status runtime yang diturunkan dari env + helper jalur query (API_CONTRACT §9.3.1). */
export type SystemRuntime = {
  /** TERKONFIGURASI — `getRetrievalMode()`; nilai mentah env yang sah. */
  retrievalMode: 'fts5' | 'qdrant' | 'hybrid';
  /** EFEKTIF — backend yang benar-benar dipakai (config + circuit + keterjangkauan). */
  effectiveRetrieval: 'fts5' | 'qdrant' | 'hybrid';
  qdrantMode: 'off' | 'on' | 'local' | 'required';
  /** `false` bila `QDRANT_URL` kosong — beda kondisi dari `qdrantMode: 'off'`. */
  qdrantConfigured: boolean;
  /** `null` = tidak relevan (off/tak dikonfigurasi) atau belum diprobe. */
  qdrantReachable: boolean | null;
  embeddingProvider: 'off' | 'local';
  llm: { enabled: boolean; mode: 'off' | 'assist' | 'full' };
  ocrEnabled: boolean;
  seedProfile: 'none' | 'demo';
  /** Alasan fallback/circuit terakhir yang jujur; `null` bila tidak ada. */
  fallbackReason: string | null;
};

/** Batasan yang terbukti (rujuk `docs/STATE.json`), bukan karangan. */
export type SystemLimit = {
  id: string;
  label: string;
  detail: string;
  source?: string;
};

export type MetaSystemPayload = {
  /** Satu paragraf ringkas (SYSTEM_OVERVIEW §1); opsional agar UI punya fallback faktual. */
  summary?: string;
  stack: SystemStackItem[];
  pipeline: SystemPipelineStage[];
  runtime: SystemRuntime;
  limits: SystemLimit[];
};

export type MetaResponse = {
  app: { name: string; version: string; build: string };
  data: {
    activeDataset: DatasetRef & { tables: number };
    periodDefaults: { start: string; end: string; label: string; isPartial: boolean };
    documents: { total: number; indexed: number; chunks: number };
    datasetChoices: { id: string; name: string; rowCount: number }[];
  };
  capabilities: { llm: boolean; llmMode: 'off' | 'assist' | 'full'; rag: string; sql: string };
  generatedAt: string;
  /** Aditif (P6-UI-HONESTY / DECISION-035). Field lama tidak berubah. */
  system?: MetaSystemPayload;
};

/* ------------------------------------------------- assistant service boundary */

/**
 * State konteks follow-up (ARCHITECTURE §5.5). Disimpan di messages.context_json.
 * `lib/ai` (aiml) memakai bentuk ini; backend hanya menyimpan/mengembalikan.
 */
export type AssistantContext = {
  period: { start: string; end: string; label: string; isPartial: boolean } | null;
  metric: 'total' | 'successRate' | 'failureRate' | 'volume' | 'value' | null;
  channel: string | null;
  category: string | null;
  failureCode: string | null;
  docRefs: string[];
  lastIntentId: string | null;
  lastDomain: 'sql' | 'rag' | 'hybrid' | 'guardrail' | 'meta' | null;
  turn: number;
  updatedAt: string;
};

export type AnswerQuestionInput = {
  question: string;
  lang: Lang;
  conversationId: string;
  datasetId: string;
  /** Override periode eksplisit dari body request (opsional). */
  period: { start: string; end: string } | null;
  /** Riwayat percakapan sebelum pesan ini, urut lama → baru. */
  history: { role: ChatRole; content: string }[];
  /** State konteks dari pesan assistant terakhir (null pada turn pertama). */
  context: AssistantContext | null;
};

/**
 * Hasil `answerQuestion` — payload siap dipersist oleh `lib/chat/messages.ts`.
 * id/role/createdAt ditambahkan backend saat menyimpan pesan.
 */
export type AnswerQuestionResult = {
  content: string;
  answer: string;
  keyFindings: { text: string; ref?: string }[];
  supportingTable: SupportingTable | null;
  visualizations: Visualization[];
  sql: { query: string; durationMs: number; rowCount: number; error?: string } | null;
  sources: SourceCitation[];
  followUps: string[];
  meta: ChatMeta;
  guardrail?: { type: GuardrailType; explanation: string };
  context: AssistantContext;
  mode: ChatMode;
  latencyMs: number;
};
