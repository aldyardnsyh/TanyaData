/**
 * AI → CORE port adapter (P3-TUNING).
 *
 * Satu-satunya jembatan produksi dari `lib/core/**` ke kemampuan aiml.
 * Backend tidak mengimpor modul AI secara langsung: route memanggil
 * `createCorePorts()` dan menyuntikkannya ke `answerQuestion`.
 *
 * Dua sifat yang tidak bisa ditawar:
 *  1. Fail-closed untuk bukti — sitasi tanpa deep-link tervalidasi dibuang,
 *     scope attachment aktif diperiksa sebelum retrieval dipakai.
 *  2. Fail-open untuk jawaban — setiap kegagalan/timeout AI mengembalikan
 *     `null`, sehingga `lib/core/query.ts` memakai jalur deterministik dan
 *     HTTP tetap 200.
 */
import { z } from 'zod';
import type { DB } from '@/lib/db/client';
import { getWorkspaceDb } from '@/lib/db/client';
import type {
  AttachmentScopeView,
  Citation as CoreCitation,
  CitationRegistryView,
  QueryMeta,
  SqlCandidate,
  VizSpec,
} from '@/lib/core/contracts';
import type { CorePorts, SqlGenerateInput, ComposeInput, ComposeOutput } from '@/lib/core/ports';
import { composeDeterministicAnswer, friendlySourceName } from '@/lib/core/answer';
import { getDataset } from '@/lib/core/registry';
import { activeAttachmentForConversation, getAttachment } from '@/lib/core/attachment-scope';
import { generateSql } from '@/lib/ai/text2sql';
import {
  buildCitationDeepLink,
  contentHash,
  retrieveWithEntityBoost,
  validateCitationDeepLink,
  type CitationRegistry,
} from '@/lib/ai/retrieval';
import { checkGuardrails, codeEntities, topicsFromRegistry } from '@/lib/ai/guardrails';
import { classifyEvidenceConfidence, decideOutput } from '@/lib/ai/output';
import { inferDomainProfile } from '@/lib/ai/domain-profile';
import { callLlmStructured } from '@/lib/ai/llm';
import type { DocType as AiDocType, SchemaJson as AiSchemaJson } from '@/lib/ai/types';

const SQL_GENERATOR_TIMEOUT_MS = 5000;
const ANSWER_COMPOSER_TIMEOUT_MS = 8000;

const SqlCandidateSchema = z.object({
  sql: z.string().min(1),
  explanation: z.string().default(''),
  confidence: z.number().min(0).max(1),
});

/* ------------------------------------------------------------------ helpers */

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

type ChunkRow = {
  id: number;
  document_id: string;
  section_path: string;
  page: number | null;
  text: string;
  content_hash: string | null;
  page_span: string | null;
  ocr_status: string | null;
};

/**
 * Bangun registry sitasi dari data aktif. `rev` berasal dari content_hash chunk
 * (atau hash deterministik teks) sehingga deep-link tidak pernah menunjuk ke
 * revisi yang sudah berubah. Registry kosong = semua deep-link ditolak.
 */
export function buildCitationRegistry(db: DB, datasets: string | string[]): CitationRegistryView {
  const registry: CitationRegistryView = { documents: {}, chunks: {} };
  try {
    // '*' = registry lintas dokumen (chip "Semua dokumen"): sitasi dari
    // dokumen mana pun tetap tervalidasi, bukan ditolak fail-closed.
    // Array = kelompok dokumen percakapan (NotebookLM-style).
    const allDocs = datasets === '*' || (Array.isArray(datasets) && datasets.includes('*'));
    const datasetList = Array.isArray(datasets) ? datasets : [datasets];
    const inClause = allDocs ? '' : `WHERE dataset_id IN (${datasetList.map(() => '?').join(',')})`;
    const datasetArgs = allDocs ? [] : datasetList;

    if (allDocs || Array.isArray(datasets)) {
      const docs = db
        .prepare(`SELECT id, dataset_id, pages FROM core_documents ${inClause}`)
        .all(...datasetArgs) as Array<{ id: string; dataset_id: string; pages: number }>;
      const statusCache = new Map<string, string>();
      for (const doc of docs) {
        let status = statusCache.get(doc.dataset_id);
        if (status == null) {
          try { status = getDataset(db, doc.dataset_id).status; } catch { status = 'READY'; }
          statusCache.set(doc.dataset_id, status);
        }
        registry.documents[doc.id] = {
          status: status as CitationRegistryView['documents'][string]['status'],
          ...(doc.pages > 0 ? { pageCount: doc.pages } : {}),
          rev: contentHash(`${doc.dataset_id}|${doc.id}|${doc.pages}`),
        };
      }
      const chunks = db
        .prepare(
          `SELECT id, document_id, section_path, page, text, content_hash, page_span, ocr_status
             FROM core_chunks ${inClause}`,
        )
        .all(...datasetArgs) as unknown as ChunkRow[];
      for (const chunk of chunks) {
        let pageEnd: number | null = null;
        try {
          const span = JSON.parse(chunk.page_span ?? 'null') as unknown;
          if (Array.isArray(span) && span.length > 1) pageEnd = Number(span[1]);
        } catch {
          pageEnd = null;
        }
        const rev = (chunk.content_hash || contentHash(chunk.text)).slice(0, 8);
        registry.chunks[String(chunk.id)] = {
          document_id: chunk.document_id,
          section_path: chunk.section_path,
          page: chunk.page ?? null,
          ...(Number.isInteger(pageEnd) && (pageEnd ?? 0) > 0 ? { page_end: pageEnd } : {}),
          text: chunk.text,
          parse_ok: chunk.ocr_status !== 'ocr_skipped' && chunk.ocr_status !== 'unreadable',
          ocr_status: chunk.ocr_status ?? 'ok',
          rev,
        };
      }
      return registry;
    }

    const dataset = getDataset(db, datasetList[0]);
    const datasetRev = contentHash(`${dataset.id}|${dataset.name}|${dataset.sha256 ?? ''}`);
    const docs = db
      .prepare('SELECT id, pages FROM core_documents WHERE dataset_id = ?')
      .all(datasetList[0]) as Array<{ id: string; pages: number }>;
    for (const doc of docs) {
      registry.documents[doc.id] = {
        status: dataset.status,
        ...(doc.pages > 0 ? { pageCount: doc.pages } : {}),
        rev: datasetRev,
      };
    }

    const chunks = db
      .prepare(
        `SELECT id, document_id, section_path, page, text, content_hash, page_span, ocr_status
           FROM core_chunks WHERE dataset_id = ?`,
      )
      .all(datasetList[0]) as ChunkRow[];
    for (const chunk of chunks) {
      let pageEnd: number | null = null;
      try {
        const span = JSON.parse(chunk.page_span ?? 'null') as unknown;
        if (Array.isArray(span) && span.length > 1) pageEnd = Number(span[1]);
      } catch {
        pageEnd = null;
      }
      const rev = (chunk.content_hash || contentHash(chunk.text)).slice(0, 8);
      registry.chunks[String(chunk.id)] = {
        document_id: chunk.document_id,
        section_path: chunk.section_path,
        page: chunk.page ?? null,
        ...(Number.isInteger(pageEnd) && (pageEnd ?? 0) > 0 ? { page_end: pageEnd } : {}),
        text: chunk.text,
        parse_ok: chunk.ocr_status !== 'ocr_skipped' && chunk.ocr_status !== 'unreadable',
        ocr_status: chunk.ocr_status ?? 'ok',
        rev,
      };
      if (!registry.documents[chunk.document_id]) {
        registry.documents[chunk.document_id] = { status: dataset.status, rev: datasetRev };
      }
    }
  } catch {
    // Registry tidak tersedia → fail-closed di validateCitationDeepLink.
  }
  return registry;
}

/**
 * Kumpulkan konteks AI per permintaan. Scope diambil HANYA dari attachment
 * aktif conversation/attachmentId yang diminta — tidak pernah dari global
 * state — sehingga pergantian attachment tidak bisa membocorkan bukti lama.
 */
export function buildAiPortContext(
  db: DB,
  input: { datasetId?: string; datasetIds?: string[] | null; conversationId?: string | null; attachmentId?: string | null },
): { citationRegistry: CitationRegistryView; scope: AttachmentScopeView | null } {
  // Registry mengikuti domain: kelompok dokumen > dataset tunggal > semua ('*').
  const registryDatasets = input.datasetIds?.length
    ? input.datasetIds
    : input.datasetId ?? '*';
  const citationRegistry = buildCitationRegistry(db, registryDatasets);
  let scope: AttachmentScopeView | null = null;
  try {
    // Scope FR-C hanya untuk SATU attachment aktif; kelompok dokumen
    // dibatasi secara struktural oleh retrieval (IN-clause), jadi tanpa scope.
    const attachment = input.attachmentId
      ? getAttachment(db, input.attachmentId)
      : input.conversationId
        ? activeAttachmentForConversation(db, input.conversationId)
        : null;
    if (attachment && !(input.datasetIds && input.datasetIds.length > 1)) {
      scope = {
        id: attachment.id,
        dataset_id: attachment.datasetId,
        source_id: attachment.sourceId,
        name: attachment.name,
        doc_type: attachment.docType,
        status: attachment.status,
        ...(attachment.activeInConversation ? { active_in_conversation: true } : {}),
      };
    }
  } catch {
    scope = null;
  }
  return { citationRegistry, scope };
}

/* ------------------------------------------------------------ sql generator */

async function generateCandidate(db: DB, input: SqlGenerateInput): Promise<SqlCandidate | null> {
  const dryRunDb = db as unknown as {
    prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] };
  };
  const plan = await generateSql({
    question: input.question,
    schema: input.schema as unknown as AiSchemaJson,
    context: (input.context ?? undefined) as Record<string, unknown> | undefined,
    db: dryRunDb,
    llm: {
      async generate(prompt: string) {
        const outcome = await callLlmStructured({
          system:
            'Write exactly one read-only SQLite SELECT statement from the supplied schema. ' +
            'Return JSON only with keys sql, explanation, confidence. No DDL, DML or comments.',
          user: prompt,
          schema: SqlCandidateSchema,
        });
        if (!outcome.ok || !outcome.data) return null;
        return {
          sql: outcome.data.sql,
          explanation: outcome.data.explanation,
          confidence: outcome.data.confidence,
        };
      },
    },
  });
  if (!plan || plan.mode !== 'generated' || !plan.sql) return null;
  return {
    sql: plan.sql,
    explanation: plan.explanation,
    confidence: plan.confidence,
    referenced_tables: plan.referenced_tables,
    referenced_columns: plan.referenced_columns,
    params: plan.params,
    mode: 'generated',
    ...(plan.reason ? { reason: plan.reason } : {}),
  };
}

/* ----------------------------------------------------------- answer composer */

/**
 * Pesan penolakan sadar-dataset: tanpa attachment aktif, menyarankan
 * "pilih attachment" menyesatkan karena sumber aktif adalah dataset itu
 * sendiri. Sebutkan namanya dan arahkan ke metrik yang tersedia.
 */
function outOfScopeDatasetMessage(db: DB, datasetId: string | null | undefined): string {
  let name = 'sumber aktif';
  if (datasetId) {
    try {
      name = friendlySourceName(getDataset(db, datasetId));
    } catch {
      // fallback ke nama generik
    }
  }
  return (
    `Pertanyaan ini di luar cakupan dataset "${name}". ` +
    'Coba metrik yang tersedia (mis. distribusi status, tren harian, atau peringkat kanal/kategori), ' +
    'atau lampirkan dokumen yang relevan dari panel sumber.'
  );
}

type ValidatedAiCitation = {
  chunk_id: string;
  section_path: string;
  doc: string;
  page: number | null;
  quote: string;
  score?: number;
  deep_link?: string | null;
  deep_link_status?: 'valid' | 'invalid' | 'unchecked';
  rev?: string | null;
};

function composeWithAi(db: DB, input: ComposeInput): ComposeOutput {
  const registry = (input.citationRegistry ?? { documents: {}, chunks: {} }) as CitationRegistry;
  const scope = input.scope ?? null;

  // ADR-OF-12: topik berasal dari registry chunk aktif, BUKAN daftar hard-code.
  // Guardrail dievaluasi di sini — setelah retrieval, SEBELUM compose — sehingga
  // sinyal out_of_scope tidak lagi dibuang saat FTS5 menemukan term yang cocok.
  const registryChunks = Object.values(registry.chunks ?? {});
  const registryTopics = topicsFromRegistry(
    registryChunks.map((c) => ({ section_path: c.section_path, text: c.text })),
  );
  // answerability dihitung terhadap BUKTI YANG TER-RETRIEVE untuk pertanyaan
  // ini (kutipan sitasi), bukan seluruh korpus — support terhadap seluruh
  // korpus membuat pertanyaan off-topic yang kebetulan share-token lolos.
  const evidenceText = input.citations.length
    ? input.citations.map((c) => c.quote ?? '').join(' ')
    : registryChunks.map((c) => c.text).join(' ');

  // FR-C.1: scope gate sebelum retrieval/sitasi dipakai.
  const guard = checkGuardrails({
    question: input.question,
    availableTopics: registryTopics,
    evidenceText,
    // ADR-OF-12: skor kandidat retrieval dibaca SEBELUM guardrail membuang
    // sitasi. Dipakai hanya untuk pengecualian lookup kode/insiden.
    citationScores: input.citations
      .map((c) => c.score)
      .filter((s): s is number => typeof s === 'number' && Number.isFinite(s)),
    ...(scope
      ? {
          scope: {
            question: input.question,
            active: {
              id: scope.id,
              dataset_id: scope.dataset_id,
              source_id: scope.source_id ?? null,
              name: scope.name,
              doc_type: scope.doc_type ?? null,
              status: scope.status,
              active_in_conversation: scope.active_in_conversation,
            },
            evidence: input.citations.map((c) => ({
              kind: 'chunk' as const,
              dataset_id: input.datasetId ?? null,
              source_id: c.document_id ?? null,
              doc_id: c.document_id ?? null,
            })),
          },
        }
      : {}),
    noEvidence: input.citations.length === 0 && input.result.rowCount === 0,
  });

  if (guard.triggered) {
    // Refusal out_of_scope TANPA scope (bukan pelanggaran attachment) tetapi
    // retrieval sudah menemukan sitasi = false positive answerability —
    // pertanyaan valid seperti "Berapa SLA penyelesaian transaksi gagal?"
    // bisa punya support kalimat rendah padahal buktinya ada. Jawab dari
    // bukti terbaik, jangan tolak. Scope refusal (FR-C) tetap mutlak.
    const answerabilityFalsePositive =
      !input.scope && guard.type === 'out_of_scope' && input.citations.length > 0;
    if (!answerabilityFalsePositive) {
    // Jangan pernah memakai string yang sama untuk dua tempat: UI merender
    // `answer` sebagai jawaban dan `reason` sebagai penjelasan. Kalau keduanya
    // identik, user melihat kalimat yang sama dua kali.
    const reason =
      guard.explanation && guard.explanation !== guard.message
        ? guard.explanation
        : 'Jawaban ditolak demi kejujuran sumber; tidak ada angka atau kutipan yang dipakai.';
    // Tanpa attachment aktif, "pilih attachment" menyesatkan — sumber aktif
    // adalah dataset. Sebutkan dataset-nya dan arahkan ke metrik yang ada.
    const message =
      !scope && (guard.type === 'out_of_scope' || guard.type === 'not_in_sources')
        ? outOfScopeDatasetMessage(db, input.datasetId)
        : guard.message;
    return {
      answer: message,
      vizSpec: {
        type: 'none',
        reason,
        x_key: null,
        y_keys: [],
        data: [],
        confidence: 0.95,
      },
      citations: [],
      meta: { aiActive: true, confidenceLevel: 'refused', fallbackReason: 'guardrail' },
    };
    }
  }

  const knownChannels = input.schema.tables
    .flatMap((t) => t.columns ?? [])
    .filter((c) => c.semantic_role === 'dimension')
    .flatMap((c) => (c.sample_values ?? []).map(String))
    .filter((v) => v.length >= 3 && v.length <= 40)
    .slice(0, 24);

  // Domain retrieval: kelompok dokumen > dataset tunggal > seluruh dokumen.
  const retrievalTargets: string | string[] = input.datasetIds?.length
    ? input.datasetIds
    : input.datasetId ?? '*';

  const candidates = retrieveWithEntityBoost(
    db,
    retrievalTargets,
    input.question,
    20,
    knownChannels,
  );

  const validated: CoreCitation[] = [];
  const aiCitations: ValidatedAiCitation[] = [];
  for (const c of candidates) {
    const chunkId = c.chunk_id == null ? null : String(c.chunk_id);
    const docId = c.document_id ?? '';
    // Tanpa halaman tidak ada deep-link yang bisa divalidasi → buang.
    if (!chunkId || !docId || c.page == null) continue;
    const rev = registry.chunks[chunkId]?.rev ?? registry.documents[docId]?.rev ?? null;
    const link = rev
      ? buildCitationDeepLink({
          docId,
          page: c.page,
          section: c.section_path,
          chunk: chunkId,
          rev,
        })
      : null;
    const verdict = link
      ? validateCitationDeepLink(link, registry, c.quote ?? null)
      : { valid: false, reason: 'MISSING_CHUNK' };
    if (!verdict.valid || !link) continue;

    validated.push({
      ...c,
      deep_link: link,
      deep_link_status: 'valid',
      rev,
    });
    aiCitations.push({
      chunk_id: chunkId,
      section_path: c.section_path,
      doc: docId,
      page: c.page,
      quote: c.quote ?? '',
      ...(typeof c.score === 'number' ? { score: c.score } : {}),
      deep_link: link,
      deep_link_status: 'valid',
      rev,
    });
  }

  // ADR-OF-12 (lanjutan): untuk lookup kode kegagalan (F01–F12), FTS5 OR-match
  // sering menaikkan chunk "pola kenaikan" di atas baris katalog yang memuat
  // tindakan standar. Prioritaskan sitasi yang memuat kode DAN kata kunci
  // penanganan agar composer mengambil bukti yang tepat. Hanya Fxx yang
  // terpengaruh — hotfix/INC/versi tidak diurutkan ulang (menjaga RD-TXT-02).
  const lookupCodes = codeEntities(input.question).filter((e) => /^f\d{2}$/i.test(e));
  if (lookupCodes.length) {
    const HANDLING_RE = /\b(status inquiry|tindakan standar|lakukan status|retry otomatis|rekonsiliasi)\b/i;
    const priority = (c: CoreCitation): number => {
      const text = `${c.section_path ?? ''} ${c.quote ?? ''}`.toLowerCase();
      const codeHit = lookupCodes.some((code) => text.includes(code.toLowerCase())) ? 2 : 0;
      return codeHit + (HANDLING_RE.test(text) ? 2 : 0);
    };
    validated.sort((a, b) => priority(b) - priority(a));
  }

  // Dedupe per (dokumen, bagian): parent+child dari bagian yang sama membuat
  // jawaban mengulang paragraf yang sama dan sitasi S1..S11 penuh ganda.
  // Simpan skor tertinggi (urutan sudah ranked), lalu batasi top-5.
  const seenSection = new Set<string>();
  const topValidated: CoreCitation[] = [];
  for (const c of validated) {
    const key = `${c.document_id ?? ''}::${c.section_path ?? ''}`;
    if (seenSection.has(key)) continue;
    seenSection.add(key);
    topValidated.push(c);
    if (topValidated.length >= 5) break;
  }
  const topAiCitations = topValidated.map((c) => ({
    chunk_id: String(c.chunk_id),
    section_path: c.section_path,
    doc: c.document_id ?? '',
    page: c.page,
    quote: c.quote ?? '',
    ...(typeof c.score === 'number' ? { score: c.score } : {}),
    deep_link: c.deep_link,
    deep_link_status: c.deep_link_status,
    rev: c.rev,
  }));

  const confidence = classifyEvidenceConfidence({
    question: input.question,
    citations: topAiCitations,
    citationRegistry: registry,
  });

  const decision = decideOutput({
    question: input.question,
    domain: inferDomainProfile({ question: input.question, docType: input.docType }).domain,
    docType: (input.docType === 'unknown' ? 'general' : input.docType) as AiDocType,
    dataType: topAiCitations.length ? 'document' : input.result.rowCount ? 'structured' : 'none',
    rowCount: input.result.rowCount,
    categoryCount: input.result.rowCount > 1 ? input.result.rowCount : 0,
    entityCount: input.result.rowCount > 1 ? input.result.rowCount : 0,
    evidenceCount: topAiCitations.length + (input.result.rowCount ? 1 : 0),
    hasPasalNumber: /\bpasal\s*\d+/i.test(input.question),
  });

  // Pertanyaan ber-domain dokumen (tanpa attachment / kelompok dokumen) yang
  // retrieval-nya menemukan bukti kuat TIDAK boleh dijawab dari SQL baris
  // tabular — kandidat SQL rule-based untuk pertanyaan dokumen hanyalah
  // "hitung baris" yang bukan jawaban. Paksa jalur kutipan dokumen.
  const documentPreferred =
    (input.datasetId === '*' || (input.datasetIds?.length ?? 0) > 0) &&
    topAiCitations.length >= 3;

  const vizType: VizSpec['type'] =
    documentPreferred || decision.type === 'quote' || decision.type === 'kpi_quote'
      ? 'quote'
      : decision.type === 'kpi'
        ? 'kpi'
        : decision.type === 'line'
          ? 'line'
          : decision.type === 'bar'
            ? 'bar'
            : decision.type === 'donut'
              ? 'donut'
              : decision.type === 'timeline'
                ? 'timeline'
                : decision.type === 'table' || decision.type === 'parameter_table'
                  ? 'table'
                  : 'none';

  const vizSpec: VizSpec = {
    type: vizType,
    reason: decision.reason,
    x_key: null,
    y_keys: [],
    data: input.result.rows.slice(0, 500) as VizSpec['data'],
    confidence: decision.confidence,
  };

  const deterministic = composeDeterministicAnswer({
    question: input.question,
    lang: input.lang,
    result: { ...input.result, truncated: false },
    viz: vizSpec,
    citations: topValidated,
    sqlExplanation: input.sqlExplanation,
    mode: input.mode,
  });
  const answer =
    topValidated.length || input.result.rowCount
      ? deterministic
      : input.lang === 'id'
        ? 'Informasi ini tidak ditemukan pada sumber yang tersedia. Saya tidak akan mengarang jawaban.'
        : 'This information was not found in the available sources. I will not fabricate an answer.';

  const meta: QueryMeta = {
    aiActive: true,
    confidenceLevel: confidence.confidenceLevel,
    ...(confidence.alternativeKeywords.length
      ? { alternativeKeywords: confidence.alternativeKeywords }
      : {}),
  };
  return { answer, vizSpec, citations: topValidated, meta };
}

/* ------------------------------------------------------------------- factory */

/** Port produksi. Tidak pernah melempar; kegagalan → null → fallback core. */
export function createCorePorts(db: DB = getWorkspaceDb()): CorePorts {
  return {
    sqlGenerator: {
      async generate(input: SqlGenerateInput) {
        try {
          return await withTimeout(generateCandidate(db, input), SQL_GENERATOR_TIMEOUT_MS, 'sql_generator');
        } catch {
          return null;
        }
      },
    },
    answerComposer: {
      async compose(input: ComposeInput) {
        try {
          return await withTimeout(
            Promise.resolve().then(() => composeWithAi(db, input)),
            ANSWER_COMPOSER_TIMEOUT_MS,
            'answer_composer',
          );
        } catch {
          return null;
        }
      },
    },
  };
}
