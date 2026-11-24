/**
 * CORE ports — batas layanan untuk komponen AI (aiml).
 * Backend tidak mengimpor `lib/ai/**`; aiml mengimplementasikan port ini dan
 * backend memanggilnya lewat injeksi. Tanpa implementasi, jalur deterministik
 * di `lib/core/sql.ts` + `lib/core/answer.ts` dipakai (P-8 graceful degradation).
 */

import type {
  Lang,
  QueryContext,
  SchemaJson,
  SqlCandidate,
  VizSpec,
  Citation,
  DocType,
  CitationRegistryView,
  AttachmentScopeView,
  QueryMeta,
} from '@/lib/core/contracts';

export type SqlGenerateInput = {
  question: string;
  schema: SchemaJson;
  context: QueryContext | null;
  lang: Lang;
};

/** Generator SQL opsional. Return `null` → rule builder yang dipakai. */
export interface SqlGeneratorPort {
  generate(input: SqlGenerateInput): Promise<SqlCandidate | null>;
}

export type ComposeInput = {
  question: string;
  /** Pertanyaan yang dinormalisasi/standalone untuk retrieval & guardrail. */
  effectiveQuestion?: string;
  lang: Lang;
  docType: DocType;
  schema: SchemaJson;
  result: { columns: string[]; rows: Array<Record<string, unknown>>; rowCount: number };
  citations: Citation[];
  sqlExplanation: string | null;
  mode: 'sql' | 'document' | 'hybrid';
  /** Jenis sumber; dipakai untuk membedakan dokumen dari dataset tabular. */
  dataKind?: 'document' | 'tabular';
  /** CORE V2 — registry sitasi aktif untuk validasi deep-link fail-closed. */
  citationRegistry?: CitationRegistryView | null;
  /** CORE V2 — scope attachment aktif; menolak bukti lintas attachment. */
  scope?: AttachmentScopeView | null;
  /** Konteks percakapan asli (dipakai guardrail/readjustment AI). */
  context?: QueryContext | null;
  /** Dataset aktif — dipakai adapter untuk retrieval & pembangunan registry. */
  datasetId?: string;
  /** Kelompok dokumen percakapan (NotebookLM-style): retrieval terbatas ke daftar ini. */
  datasetIds?: string[] | null;
};

export type ComposeOutput = {
  answer: string;
  vizSpec: VizSpec;
  citations: Citation[];
  /** CORE V2 — aditif; ditempelkan orchestrator ke `Query.meta`. */
  meta?: QueryMeta;
};

/** Composer narasi opsional. Return `null` → template deterministik dipakai. */
export interface AnswerComposerPort {
  compose(input: ComposeInput): Promise<ComposeOutput | null>;
}

/**
 * Ringkasan dokumen untuk pertanyaan meta ("dokumen ini membahas apa?").
 * Input berasal dari profil struktur dokumen (judul, jumlah halaman, daftar
 * bagian + kalimat pembuka) — bukan retrieval — sehingga LLM hanya
 * merangkum bukti yang sudah ada. Return `null` → fallback deterministik.
 */
export type DocumentOverviewInput = {
  question: string;
  lang: Lang;
  title: string;
  pages: number;
  docType: DocType;
  sections: Array<{ title: string; page: number | null; excerpt: string }>;
};

export interface DocumentOverviewPort {
  overview(input: DocumentOverviewInput): Promise<string | null>;
}

export type CorePorts = {
  sqlGenerator?: SqlGeneratorPort;
  answerComposer?: AnswerComposerPort;
  documentOverview?: DocumentOverviewPort;
};
