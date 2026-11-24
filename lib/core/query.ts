/**
 * Query orchestration — tahap 10..12 (CORE_ARCHITECTURE §4).
 * NL → SQL kandidat → validator → eksekusi → retrieval → viz → evaluasi.
 */

import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import type {
  AttachmentScopeView,
  Citation,
  CitationRegistryView,
  Guardrail,
  Query,
  QueryContext,
  QueryResultJson,
  SqlCandidate,
} from '@/lib/core/contracts';
import type { CorePorts } from '@/lib/core/ports';
import { getCachedQuery, queryCacheKey, setCachedQuery } from '@/lib/core/cache';
import { getDataset } from '@/lib/core/registry';
import { buildDocumentProfile, isDocumentMetaQuestion } from '@/lib/core/doc-profile';
import { buildRuleBasedCandidate, runCandidate } from '@/lib/core/sql';
import { searchChunks } from '@/lib/core/store';
import { correctQueryWithVocabulary, rrfFuse, standaloneQuestion } from '@/lib/core/query-rewrite';
import { rerankCitations, retrieveWithEntityBoost } from '@/lib/ai/retrieval';
import { understandQuery, retrievalQueries } from '@/lib/ai/query-understanding';
import {
  ambiguousGuardrail,
  buildVizSpec,
  composeDeterministicAnswer,
  detectGuardrail,
  evaluateGrounding,
  extractSnippetWindow,
  friendlySourceName,
  notInSourcesGuardrail,
} from '@/lib/core/answer';

/**
 * Persempit quote sitasi ke jendela kalimat paling relevan dengan pertanyaan
 * (bukan satu paragraf hasil chunking). Deterministik: extractSnippetWindow
 * memilih kalimat ber-skor term tertinggi ± tetangga. Dipakai di dua titik:
 * hasil reranker (sebelum composer) dan hasil composer (quote LLM bisa mentah).
 */
function narrowCitations(citations: Citation[], question: string): Citation[] {
  return citations.map((citation) => {
    const narrowed = extractSnippetWindow(citation.quote ?? '', question);
    return narrowed ? { ...citation, quote: narrowed } : citation;
  });
}

export type AnswerQuestionInput = {
  datasetId: string;
  question: string;
  lang: 'id' | 'en';
  context?: QueryContext | null;
  evaluate?: boolean;
  /** CORE V2 — opsional; tanpa ini jalur deterministik identik dengan baseline. */
  citationRegistry?: CitationRegistryView | null;
  scope?: AttachmentScopeView | null;
  conversationId?: string | null;
  /** Kelompok dokumen percakapan (NotebookLM-style): retrieval terbatas ke daftar ini. */
  retrievalDatasetIds?: string[] | null;
};

const EMPTY_RESULT: QueryResultJson = { columns: [], rows: [], rowCount: 0, truncated: false };

/** Verba permintaan rincian + penanda anafora ("laporan ini", "hasil tadi"). */
const FOLLOWUP_VERB_RE = /\b(jabarkan|rinci|uraikan|perinci|breakdown)\b/i;
const FOLLOWUP_ANAPHORA_RE = /\b(ini|itu|tersebut|tadi|di atas)\b/i;
const FOLLOWUP_LIMIT = 200;

function expandLimit(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (/\bLIMIT\s+\d+/i.test(trimmed)) {
    return trimmed.replace(/\bLIMIT\s+\d+/i, `LIMIT ${limit}`);
  }
  return `${trimmed} LIMIT ${limit}`;
}

/**
 * Resolusi follow-up anafora: "Tolong jabarkan laporan ini" merujuk hasil
 * sebelumnya, bukan pertanyaan baru. Tanpa ini pertanyaan lanjutan ditolak
 * out_of_scope padahal konteksnya jelas. Hanya aktif bila turn sebelumnya
 * menghasilkan SQL; pertanyaan baru tidak pernah dibajak.
 */
function resolveFollowUpSql(input: AnswerQuestionInput): string | null {
  const question = String(input.question ?? '');
  if (!FOLLOWUP_VERB_RE.test(question) || !FOLLOWUP_ANAPHORA_RE.test(question)) return null;
  const lastSql = input.context?.lastResult?.sql;
  if (!lastSql) return null;
  return expandLimit(lastSql, FOLLOWUP_LIMIT);
}

function baseQuery(input: AnswerQuestionInput): Query {
  return {
    id: `q_${randomUUID()}`,
    dataset_id: input.datasetId,
    nl_question: input.question,
    lang: input.lang,
    generated_sql: null,
    sql_explanation: null,
    result_json: EMPTY_RESULT,
    viz_spec: { type: 'none', reason: 'belum ada bukti', x_key: null, y_keys: [], data: [], confidence: 0 },
    citations: [],
    guardrail: null,
    evaluation: null,
    mode: 'guardrail',
    answer: '',
    duration_ms: 0,
    created_at: nowJakartaIso(),
  };
}

export async function answerQuestion(
  db: DB,
  input: AnswerQuestionInput,
  ports: CorePorts = {},
): Promise<Query> {
  const started = performance.now();
  const query = baseQuery(input);
  const dataset = getDataset(db, input.datasetId);
  if (dataset.status !== 'READY') {
    const message = `Dataset "${friendlySourceName(dataset)}" belum siap digunakan (status ${dataset.status}).`;
    query.guardrail = {
      type: 'unsupported',
      answer: message,
      explanation: 'Dataset belum READY; tidak ada chunk atau SQL yang dipakai.',
    };
    query.answer = message;
    query.duration_ms = Math.round(performance.now() - started);
    return query;
  }

  // Pertanyaan meta-dokumen ("ini dokumen terkait apa?", "apa isi dokumen ini?")
  // dijawab dari STRUKTUR dokumen (judul + daftar bagian + kalimat pembuka).
  // Bila port ringkasan tersedia, LLM menarasikan profil itu (grounded ke
  // bukti struktur); tanpa port / gagal → fallback deterministik.
  if (dataset.kind === 'document' && isDocumentMetaQuestion(input.question)) {
    const profile = buildDocumentProfile(db, dataset);
    if (profile.sections.length) {
      const overview = ports.documentOverview
        ? await ports.documentOverview
            .overview({
              question: input.question,
              lang: input.lang,
              title: profile.title,
              pages: profile.pages,
              docType: dataset.doc_type,
              sections: profile.sections.map((s) => ({
                title: s.title,
                page: s.page,
                excerpt: s.excerpt,
              })),
            })
            .catch(() => null)
        : null;

      if (overview) {
        query.mode = 'document';
        query.answer = overview;
        query.meta = { aiActive: true };
      } else {
        const titles = profile.sections.slice(0, 3).map((s) => s.title);
        const joined = titles.join('; ');
        query.mode = 'document';
        query.answer =
          input.lang === 'id'
            ? `Dokumen "${profile.title}" (${profile.pages} halaman) terdiri dari ${profile.sections.length} bagian, di antaranya: ${joined}.`
            : `"${profile.title}" (${profile.pages} pages) has ${profile.sections.length} sections, including: ${joined}.`;
        query.meta = { aiActive: false, fallbackReason: 'document_overview_unavailable' };
      }

      query.citations = profile.sections.slice(0, 5).map((s) => ({
        chunk_id: s.chunkId,
        document_id: s.documentId,
        section_path: s.title,
        page: s.page,
        quote: s.excerpt,
        score: 1,
      }));
      query.duration_ms = Math.round(performance.now() - started);
      return query;
    }
  }

  // Domain retrieval menentukan guardrail: dokumen ('*'/'document') menjawab
  // dari kutipan yang di-ground, jadi guardrail PII tabular tidak berlaku.
  const retrievalDomain: 'all' | 'document' | 'tabular' =
    input.retrievalDatasetIds?.length
      ? 'document'
      : dataset.kind === 'document'
        ? 'document'
        : 'all';
  const guardrail = detectGuardrail({
    question: input.question,
    dataset,
    context: input.context ?? null,
    domain: retrievalDomain,
  });
  if (guardrail) {
    query.guardrail = guardrail;
    query.answer = guardrail.answer ?? guardrail.explanation;
    query.duration_ms = Math.round(performance.now() - started);
    return query;
  }

  // Cache dicek SETELAH guardrail murah, tetapi SEBELUM generator LLM / FTS —
  // di situlah biaya CPU dan LLM call dihemat. DB readonly (eval) → auto-disable.
  const cacheKey = queryCacheKey({
    datasetId: input.datasetId,
    question: input.question,
    lang: input.lang,
    period: input.context?.period ?? null,
  });
  const cached = getCachedQuery(db, cacheKey);
  if (cached) {
    const duration = Math.round(performance.now() - started);
    const hit: Query = {
      ...cached,
      id: `q_${randomUUID()}`,
      dataset_id: input.datasetId,
      nl_question: input.question,
      lang: input.lang,
      created_at: nowJakartaIso(),
      duration_ms: duration,
      evaluation: input.evaluate
        ? evaluateGrounding({
            answer: cached.answer,
            result: cached.result_json,
            citations: cached.citations,
            viz: cached.viz_spec,
            latencyMs: duration,
          })
        : null,
    };
    return hit;
  }

  let candidate: SqlCandidate | null = null;
  let rejection: string | null = null;
  let aiActive = false;
  const followUpSql = resolveFollowUpSql(input);
  if (followUpSql) {
    // Follow-up anafora: langsung pakai SQL turn sebelumnya (lebih banyak
    // baris) — generator LLM tidak dipanggil supaya konteks tidak hilang.
    candidate = {
      sql: followUpSql,
      explanation: 'Rincian dari hasil pertanyaan sebelumnya',
      confidence: 0.9,
      referenced_tables: [],
      referenced_columns: [],
      params: {},
      mode: 'generated',
    };
  } else if (ports.sqlGenerator && dataset.schema_json.tables.length > 0) {
    // Dataset dokumen (tanpa tabel) TIDAK memanggil generator SQL: tanpa FROM
    // yang sah, LLM bisa membuat `SELECT '<teks karangan>'` dan lolos validator
    // — jawaban dokumen wajib datang dari sitasi, bukan literal SQL.
    try {
      candidate = await ports.sqlGenerator.generate({
        question: input.question,
        schema: dataset.schema_json,
        context: input.context ?? null,
        lang: input.lang,
      });
      if (candidate?.mode === 'generated') aiActive = true;
    } catch {
      candidate = null;
    }
  }
  if (candidate) {
    try {
      runCandidate(candidate, dataset.schema_json);
    } catch (error) {
      rejection = error instanceof Error ? error.message : String(error);
      candidate = null;
    }
  }
  if (!candidate) candidate = buildRuleBasedCandidate(input.question, dataset.schema_json, input.context ?? null);

  let citations: Citation[] = [];
  let docCitations: Citation[] = [];
  let effectiveQuestion = input.question;
  try {
    // Kandidat LEBAR (20) + entity boost, lalu rerank deterministik → top 5.
    // searchChunks mentah (limit 5) membuat BM25 OR mengisi top-k dengan chunk
    // generik padahal reranker + boostSection sudah tersedia.
    // Domain retrieval: kelompok dokumen percakapan > dokumen tunggal >
    // seluruh dokumen ('*' — dataset tabular tidak punya core_chunks).
    const retrievalDatasetId: string | string[] = input.retrievalDatasetIds?.length
      ? input.retrievalDatasetIds
      : dataset.kind === 'document'
        ? dataset.id
        : '*';
    const knownChannels = dataset.schema_json.tables
      .flatMap((t) => t.columns ?? [])
      .filter((c) => c.semantic_role === 'dimension')
      .flatMap((c) => (c.sample_values ?? []).map(String))
      .filter((v) => v.length >= 3 && v.length <= 40)
      .slice(0, 24);
    const scopeIds = Array.isArray(retrievalDatasetId)
      ? retrievalDatasetId
      : retrievalDatasetId === '*'
        ? []
        : [retrievalDatasetId];
    const corrected = correctQueryWithVocabulary(db, scopeIds, input.question);
    effectiveQuestion = standaloneQuestion(corrected, input.context?.history, dataset.name);
    // SEMANTIC QUERY V1 — pahami maksud (intent/parafrasa/entitas) SEBELUM
    // retrieval. Fallback deterministik aktif bila LLM gagal/429 — tidak
    // pernah mengembalikan error ke user. Hasil di-cache per query ternormalisasi.
    const understanding = await understandQuery(input.question, input.lang);
    const semanticVariants = retrievalQueries(input.question, understanding)
      .filter((v) => v !== input.question && v !== effectiveQuestion)
      .slice(0, 3);
    const candidates = retrieveWithEntityBoost(db, retrievalDatasetId, input.question, 20, knownChannels);
    const rewritten = effectiveQuestion === input.question
      ? []
      : retrieveWithEntityBoost(db, retrievalDatasetId, effectiveQuestion, 20, knownChannels);
    const semanticLists = semanticVariants.map((v) =>
      retrieveWithEntityBoost(db, retrievalDatasetId, v, 20, knownChannels));
    const fused = rrfFuse([candidates, rewritten, ...semanticLists].filter((list) => list.length));
    citations = narrowCitations(rerankCitations(input.question, fused).slice(0, 8), input.question);
  } catch {
    citations = [];
  }

  if (candidate) {
    try {
      const execution = runCandidate(candidate, dataset.schema_json);
      query.generated_sql = execution.sql;
      query.sql_explanation = candidate.explanation;
      query.result_json = {
        columns: execution.columns,
        rows: execution.rows,
        rowCount: execution.rowCount,
        truncated: execution.truncated,
      };
      // Pertanyaan SQL yang SUKSES tidak butuh sitasi dokumen — sitasi hasil
      // pencarian '*' hanya konteks; kalau ikut tampil jadi derau (S1..S11).
      // Sitasi dokumen TETAP dipakai sebagai input composer (line di bawah):
      // tanpa itu guardrail composer menilai pertanyaan "tanpa bukti" dan
      // menolak padahal retrieval dokumen menemukan jawabannya.
      docCitations = citations;
      if (execution.rowCount > 0 && dataset.kind !== 'document') citations = [];
      query.mode = citations.length ? 'hybrid' : 'sql';
    } catch (error) {
      rejection = error instanceof Error ? error.message : String(error);
    }
  }

  if (!query.generated_sql && !citations.length) {
    // BUG-GR-07: klarifikasi metrik didahulukan sebelum not_in_sources.
    // "Kanal terbaik?" bukan pertanyaan di luar sumber — ukurannya yang belum
    // ditentukan. SQL yang benar-benar ditolak tetap lebih spesifik.
    const g: Guardrail = rejection
      ? {
          type: 'sql_rejected',
          answer: 'SQL tidak dapat dibuat atau divalidasi dari sumber yang tersedia.',
          explanation: `SQL ditolak: ${rejection}`,
        }
      : (dataset.kind === 'document' ? null : ambiguousGuardrail(effectiveQuestion)) ?? notInSourcesGuardrail(dataset);
    query.guardrail = g;
    query.answer = g.answer ?? g.explanation;
    query.duration_ms = Math.round(performance.now() - started);
    return query;
  }

  query.citations = citations;
  if (!query.generated_sql) query.mode = 'document';

  const viz = buildVizSpec({
    result: query.result_json,
    schema: dataset.schema_json,
    docType: dataset.doc_type,
    citations,
    question: input.question,
  });
  query.viz_spec = viz;

  let answer: string | null = null;
  if (ports.answerComposer && (citations.length || query.result_json.rowCount)) {
    try {
      const composed = await ports.answerComposer.compose({
        question: input.question,
        effectiveQuestion,
        lang: input.lang,
        docType: dataset.doc_type,
        schema: dataset.schema_json,
        result: query.result_json,
        citations: citations.length ? citations : docCitations,
        sqlExplanation: query.sql_explanation,
        mode: query.mode === 'guardrail' ? 'document' : query.mode,
        dataKind: dataset.kind === 'document' ? 'document' : 'tabular',
        citationRegistry: input.citationRegistry ?? null,
        scope: input.scope ?? null,
        context: input.context ?? null,
        // Registry/komposer mengikuti domain retrieval: dokumen tunggal,
        // kelompok dokumen, atau seluruh dokumen ('*').
        datasetId: dataset.kind === 'document' ? input.datasetId : '*',
        datasetIds: input.retrievalDatasetIds ?? null,
      });
      answer = composed?.answer ?? null;
      if (composed) {
        query.viz_spec = composed.vizSpec;
        query.citations = narrowCitations(composed.citations, input.question);
        if (composed.meta) query.meta = { ...(query.meta ?? {}), ...composed.meta };
        aiActive = true;
      }
    } catch {
      answer = null;
    }
  }
  if (aiActive) query.meta = { ...(query.meta ?? {}), aiActive: true };
  query.answer = answer ?? composeDeterministicAnswer({
    question: input.question,
    lang: input.lang,
    result: query.result_json,
    viz: query.viz_spec,
    citations: query.citations,
    sqlExplanation: query.sql_explanation,
    mode: query.mode === 'guardrail' ? 'document' : query.mode,
  });

  query.duration_ms = Math.round(performance.now() - started);
  if (input.evaluate) {
    query.evaluation = evaluateGrounding({
      answer: query.answer,
      result: query.result_json,
      citations: query.citations,
      viz: query.viz_spec,
      latencyMs: query.duration_ms,
    });
  }
  // Simpan tanpa evaluation: hasil eval tidak boleh membocorkan latency lama
  // ke pemanggil berikutnya (di-hitung ulang pada cache hit bila diminta).
  setCachedQuery(db, cacheKey, input.datasetId, { ...query, evaluation: null });
  return query;
}
