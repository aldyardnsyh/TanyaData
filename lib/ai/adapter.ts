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
import { composeDeterministicAnswer } from '@/lib/core/answer';
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
import { checkGuardrails } from '@/lib/ai/guardrails';
import { classifyEvidenceConfidence, decideOutput } from '@/lib/ai/output';
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
export function buildCitationRegistry(db: DB, datasetId: string): CitationRegistryView {
  const registry: CitationRegistryView = { documents: {}, chunks: {} };
  try {
    const dataset = getDataset(db, datasetId);
    const datasetRev = contentHash(`${dataset.id}|${dataset.name}|${dataset.sha256 ?? ''}`);
    const docs = db
      .prepare('SELECT id, pages FROM core_documents WHERE dataset_id = ?')
      .all(datasetId) as Array<{ id: string; pages: number }>;
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
      .all(datasetId) as ChunkRow[];
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
  input: { datasetId: string; conversationId?: string | null; attachmentId?: string | null },
): { citationRegistry: CitationRegistryView; scope: AttachmentScopeView | null } {
  const citationRegistry = buildCitationRegistry(db, input.datasetId);
  let scope: AttachmentScopeView | null = null;
  try {
    const attachment = input.attachmentId
      ? getAttachment(db, input.attachmentId)
      : input.conversationId
        ? activeAttachmentForConversation(db, input.conversationId)
        : null;
    if (attachment) {
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

  // FR-C.1: scope gate sebelum retrieval/sitasi dipakai.
  const guard = checkGuardrails({
    question: input.question,
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
    return {
      answer: guard.message,
      vizSpec: {
        type: 'none',
        reason: guard.explanation,
        x_key: null,
        y_keys: [],
        data: [],
        confidence: 0.95,
      },
      citations: [],
      meta: { aiActive: true, confidenceLevel: 'refused', fallbackReason: 'guardrail' },
    };
  }

  const knownChannels = input.schema.tables
    .flatMap((t) => t.columns ?? [])
    .filter((c) => c.semantic_role === 'dimension')
    .flatMap((c) => (c.sample_values ?? []).map(String))
    .filter((v) => v.length >= 3 && v.length <= 40)
    .slice(0, 24);

  const candidates = retrieveWithEntityBoost(
    db,
    input.datasetId ?? '',
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

  const confidence = classifyEvidenceConfidence({
    question: input.question,
    citations: aiCitations,
    citationRegistry: registry,
  });

  const decision = decideOutput({
    question: input.question,
    docType: (input.docType === 'unknown' ? 'general' : input.docType) as AiDocType,
    dataType: aiCitations.length ? 'document' : input.result.rowCount ? 'structured' : 'none',
    rowCount: input.result.rowCount,
    categoryCount: input.result.rowCount > 1 ? input.result.rowCount : 0,
    entityCount: input.result.rowCount > 1 ? input.result.rowCount : 0,
    evidenceCount: aiCitations.length + (input.result.rowCount ? 1 : 0),
    hasPasalNumber: /\bpasal\s*\d+/i.test(input.question),
  });

  const vizType: VizSpec['type'] =
    decision.type === 'quote' || decision.type === 'kpi_quote'
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
    citations: validated,
    sqlExplanation: input.sqlExplanation,
    mode: input.mode,
  });
  const answer =
    validated.length || input.result.rowCount
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
  return { answer, vizSpec, citations: validated, meta };
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
