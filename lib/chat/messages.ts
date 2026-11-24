import { randomUUID } from 'node:crypto';
import { redactForLog } from '@/lib/api/sanitize';
import type { DB } from '@/lib/db/client';
import type {
  AnswerQuestionResult,
  AssistantContext,
  ChatMessage,
  ChatMeta,
  ChatMode,
  DatasetRef,
  GuardrailType as ChatGuardrailType,
  Lang,
  Period,
  SendMessageResponse,
  SourceCitation,
  SupportingTable,
  Visualization,
} from '@/lib/contracts/http';
import { answerQuestion } from '@/lib/core/query';
import { buildAiPortContext, createCorePorts } from '@/lib/ai/adapter';
import { activeAttachmentForConversation, activeAttachmentsForConversation } from '@/lib/core/attachment-scope';
import { findDataset } from '@/lib/core/registry';
import type {
  Citation,
  GuardrailType as CoreGuardrailType,
  Query,
  QueryContext,
  QueryMode,
  QueryResultJson,
  VizSpec,
} from '@/lib/core/contracts';
import { resolveScope } from '@/lib/analytics/scope';
import { nowJakartaIso, truncateText } from '@/lib/date';
import { periodOf, resolvePeriod } from '@/lib/analytics/period';
import {
  DEFAULT_TITLE,
  countMessages,
  getConversationRow,
  touchConversation,
  type MessageRow,
} from '@/lib/chat/conversations';

const MAX_HISTORY = 12;

export type SendMessageInput = {
  content: string;
  lang?: Lang | null;
  period?: { start: string; end: string } | null;
  dataset?: string | null;
};

/* ------------------------------------------------------------ id & mapping */

/**
 * Legacy `seed` adalah id scope lama; core registry mendaftarkannya sebagai
 * `demo-qris-v1` (DECISION-014). Tanpa pemetaan ini chat seed selalu jatuh ke
 * fallback walaupun dataset demo sudah READY di registry.
 */
function resolveCoreDatasetId(db: DB, datasetId: string): string {
  if (datasetId !== 'seed') return datasetId;
  return findDataset(db, 'demo-qris-v1') ? 'demo-qris-v1' : datasetId;
}

function toCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function coreModeToChatMode(mode: QueryMode): ChatMode {
  if (mode === 'document') return 'rag';
  if (mode === 'guardrail') return 'guardrail';
  return mode; // 'sql' | 'hybrid'
}

function coreModeToDomain(mode: QueryMode): AssistantContext['lastDomain'] {
  if (mode === 'document') return 'rag';
  if (mode === 'guardrail') return 'guardrail';
  return mode;
}

function coreGuardrailTypeToChat(type: CoreGuardrailType): ChatGuardrailType {
  // `sql_rejected` bukan bagian kontrak chat yang dibekukan; pesannya tetap
  // disampaikan lewat `explanation`, tipenya diturunkan ke `unsupported`.
  return type === 'sql_rejected' ? 'unsupported' : type;
}

function toFallbackReason(reason: string | undefined): ChatMeta['fallbackReason'] {
  if (
    reason === 'llm_timeout' ||
    reason === 'llm_error' ||
    reason === 'llm_invalid' ||
    reason === 'sql_rejected'
  ) {
    return reason;
  }
  return undefined;
}

/* ------------------------------------------------------- core → chat shape */

function vizSpecToVisualizations(viz: VizSpec, queryId: string): Visualization[] {
  const mapped =
    viz.type === 'donut' ? 'pie' : viz.type === 'timeline' ? 'line' : viz.type;
  if (mapped !== 'bar' && mapped !== 'line' && mapped !== 'pie' && mapped !== 'kpi') return [];

  const rows = viz.data.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toCell(value)])),
  );
  if (!rows.length) return [];

  const xKey = viz.x_key ?? Object.keys(rows[0])[0] ?? '';
  const yKeys = viz.y_keys.length
    ? viz.y_keys
    : Object.keys(rows[0]).filter((key) => typeof rows[0][key] === 'number');

  return [
    {
      id: `viz_${queryId}`,
      type: mapped,
      title: viz.reason || 'Visualisasi',
      dataKey: yKeys[0] ?? xKey,
      xKey,
      series: yKeys.map((key) => ({ key, label: key })),
      rows,
    },
  ];
}

function citationsToSources(citations: Citation[]): SourceCitation[] {
  return citations.map((c) => ({
    kind: 'document',
    sourceId: c.document_id ?? '',
    ...(c.document_id ? { docId: c.document_id, docTitle: c.document_id } : {}),
    sectionNo: null,
    section: c.section_path || null,
    page: c.page,
    ...(c.quote ? { quote: c.quote } : {}),
    ...(c.chunk_id != null ? { chunkId: c.chunk_id } : {}),
    ...(c.score != null ? { score: c.score } : {}),
    ...(c.deep_link ? { deep_link: c.deep_link } : {}),
    ...(c.deep_link_status ? { deep_link_status: c.deep_link_status } : {}),
  }));
}

function resultToSupportingTable(result: QueryResultJson): SupportingTable | null {
  if (!result.columns.length || !result.rows.length) return null;
  return {
    columns: result.columns.map((key) => ({
      key,
      label: key,
      align: 'left' as const,
      format: 'text' as const,
    })),
    rows: result.rows.map((row) =>
      Object.fromEntries(result.columns.map((key) => [key, toCell(row[key])])),
    ),
    totalRows: result.rowCount,
    truncated: result.truncated,
  };
}

function buildAssistantContext(input: {
  query: Query;
  resolvedPeriod: Period | null;
  previous: AssistantContext | null;
}): AssistantContext {
  const { query, resolvedPeriod, previous } = input;
  const docRefs = [
    ...new Set(query.citations.map((c) => c.document_id).filter((v): v is string => Boolean(v))),
  ];
  return {
    period: resolvedPeriod
      ? {
          start: resolvedPeriod.start,
          end: resolvedPeriod.end,
          label: resolvedPeriod.label,
          isPartial: resolvedPeriod.isPartial,
        }
      : previous?.period ?? null,
    metric: previous?.metric ?? null,
    channel: previous?.channel ?? null,
    category: previous?.category ?? null,
    failureCode: previous?.failureCode ?? null,
    docRefs: docRefs.length ? docRefs : previous?.docRefs ?? [],
    lastIntentId: null,
    lastDomain: coreModeToDomain(query.mode),
    turn: (previous?.turn ?? 0) + 1,
    updatedAt: nowJakartaIso(),
  };
}

/** Satu-satunya tempat Core Query diterjemahkan ke kontrak chat yang dikonsumsi UI. */
function coreQueryToResult(
  query: Query,
  ctx: { datasetRef: DatasetRef; resolvedPeriod: Period | null; previous: AssistantContext | null },
): AnswerQuestionResult {
  const sources = citationsToSources(query.citations);
  const guardrail = query.guardrail
    ? {
        type: coreGuardrailTypeToChat(query.guardrail.type),
        explanation: query.guardrail.explanation,
      }
    : undefined;
  const fallbackReason =
    query.guardrail?.type === 'sql_rejected'
      ? 'sql_rejected'
      : toFallbackReason(query.meta?.fallbackReason);

  const meta: ChatMeta = {
    period: ctx.resolvedPeriod,
    dataset: ctx.datasetRef,
    partial: query.result_json.truncated,
    rowCount: query.result_json.rowCount,
    mode: coreModeToChatMode(query.mode),
    latencyMs: query.duration_ms,
    ...(query.meta?.aiActive ? { aiActive: true } : {}),
    ...(query.meta?.confidenceLevel ? { confidenceLevel: query.meta.confidenceLevel } : {}),
    ...(query.meta?.alternativeKeywords ? { alternativeKeywords: query.meta.alternativeKeywords } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
  };

  return {
    content: query.answer,
    answer: query.answer,
    keyFindings: sources
      .slice(0, 4)
      .map((s) => ({
        text: (s.quote ?? s.section ?? '').slice(0, 200),
        ...(s.section ? { ref: s.section } : {}),
      }))
      .filter((k) => k.text.length > 0),
    supportingTable: resultToSupportingTable(query.result_json),
    visualizations: vizSpecToVisualizations(query.viz_spec, query.id),
    sql: query.generated_sql
      ? {
          query: query.generated_sql,
          durationMs: query.duration_ms,
          rowCount: query.result_json.rowCount,
        }
      : null,
    sources,
    followUps: query.meta?.alternativeKeywords?.slice(0, 4) ?? [],
    meta,
    ...(guardrail ? { guardrail } : {}),
    context: buildAssistantContext({
      query,
      resolvedPeriod: ctx.resolvedPeriod,
      previous: ctx.previous,
    }),
    mode: coreModeToChatMode(query.mode),
    latencyMs: query.duration_ms,
  };
}

/* ---------------------------------------------------------------- fallback */

function fallbackContext(previous: AssistantContext | null, now: string): AssistantContext {
  return {
    period: previous?.period ?? null,
    metric: previous?.metric ?? null,
    channel: previous?.channel ?? null,
    category: previous?.category ?? null,
    failureCode: previous?.failureCode ?? null,
    docRefs: previous?.docRefs ?? [],
    lastIntentId: previous?.lastIntentId ?? null,
    lastDomain: previous?.lastDomain ?? 'guardrail',
    turn: (previous?.turn ?? 0) + 1,
    updatedAt: now,
  };
}

function fallbackResult(
  error: unknown,
  lang: Lang,
  datasetRef: DatasetRef,
  previous: AssistantContext | null,
  latencyMs: number,
): AnswerQuestionResult {
  void error;
  const now = nowJakartaIso();
  const content =
    lang === 'id'
      ? 'Maaf, jawaban tidak dapat disusun saat ini. Pesan Anda tersimpan; silakan coba lagi.'
      : 'Sorry, the answer could not be produced right now. Your message is saved; please retry.';
  return {
    content,
    answer: content,
    keyFindings: [],
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources: [],
    followUps: [],
    meta: {
      period: null,
      dataset: datasetRef,
      partial: false,
      rowCount: 0,
      mode: 'guardrail',
      latencyMs,
      fallbackReason: 'llm_error',
    },
    guardrail: { type: 'unsupported', explanation: content },
    context: fallbackContext(previous, now),
    mode: 'guardrail',
    latencyMs,
  };
}

/* ------------------------------------------------------------------- entry */

export async function sendMessage(
  db: DB,
  conversationId: string,
  input: SendMessageInput,
): Promise<SendMessageResponse> {
  const conversation = getConversationRow(db, conversationId);
  const lang: Lang = input.lang ?? (conversation.lang === 'en' ? 'en' : 'id');
  const datasetId = input.dataset ?? conversation.dataset_id;
  const coreDatasetId = resolveCoreDatasetId(db, datasetId);
  const coreDataset = findDataset(db, coreDatasetId);

  // Core registry adalah source of truth untuk scope. Dataset lama yang belum
  // terdaftar di registry tetap memakai resolveScope agar tidak regressi.
  let datasetRef: DatasetRef;
  let bounds: { minDate: string; maxDate: string } | null = null;
  if (coreDataset) {
    datasetRef = {
      id: coreDataset.id,
      name: coreDataset.name,
      kind: coreDataset.is_demo ? 'seed' : 'upload',
      rowCount: coreDataset.row_count,
      minDate: coreDataset.period_start ?? '',
      maxDate: coreDataset.period_end ?? '',
    };
    if (coreDataset.period_start && coreDataset.period_end) {
      bounds = { minDate: coreDataset.period_start, maxDate: coreDataset.period_end };
    }
  } else {
    const scope = resolveScope(datasetId, db);
    datasetRef = scope.ref;
    bounds = { minDate: scope.ref.minDate, maxDate: scope.ref.maxDate };
  }

  let resolvedPeriod: Period | null = null;
  if (input.period) {
    resolvedPeriod = bounds
      ? resolvePeriod(
          { period: 'custom', start: input.period.start, end: input.period.end },
          bounds,
          lang,
        )
      : periodOf(input.period.start, input.period.end, lang);
  }

  const historyRows = db
    .prepare(
      "SELECT role, content FROM messages WHERE conversation_id = ? AND role IN ('user','assistant') ORDER BY seq DESC LIMIT ?",
    )
    .all(conversationId, MAX_HISTORY) as { role: 'user' | 'assistant'; content: string }[];
  const history = historyRows.reverse();

  const contextRow = db
    .prepare(
      "SELECT context_json FROM messages WHERE conversation_id = ? AND role = 'assistant' AND context_json IS NOT NULL ORDER BY seq DESC LIMIT 1",
    )
    .get(conversationId) as { context_json: string } | undefined;
  let previousContext: AssistantContext | null = null;
  if (contextRow?.context_json) {
    try {
      previousContext = JSON.parse(contextRow.context_json) as AssistantContext;
    } catch {
      previousContext = null;
    }
  }

  // SQL jawaban asisten terakhir — bahan resolusi follow-up anafora
  // ("jabarkan laporan ini") di core, supaya pertanyaan lanjutan memakai
  // hasil sebelumnya alih-alih ditolak sebagai pertanyaan baru.
  let lastAssistantSql: string | null = null;
  let lastAssistantRowCount = 0;
  const lastAssistantRow = db
    .prepare(
      "SELECT payload_json FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1",
    )
    .get(conversationId) as { payload_json: string } | undefined;
  if (lastAssistantRow?.payload_json) {
    try {
      const payload = JSON.parse(lastAssistantRow.payload_json) as {
        sql?: { query?: string; rowCount?: number; error?: string } | null;
      };
      if (payload.sql?.query && !payload.sql.error) {
        lastAssistantSql = payload.sql.query;
        lastAssistantRowCount = payload.sql.rowCount ?? 0;
      }
    } catch {
      lastAssistantSql = null;
    }
  }

  const now = nowJakartaIso();
  const userMessageId = randomUUID();

  const insertUser = db.transaction(() => {
    const seqRow = db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { next: number };
    db.prepare(
      `INSERT INTO messages(id, conversation_id, seq, role, content, payload_json, context_json, mode, latency_ms, created_at)
       VALUES (?, ?, ?, 'user', ?, NULL, NULL, NULL, NULL, ?)`,
    ).run(userMessageId, conversationId, seqRow.next, input.content, now);

    if (conversation.title === DEFAULT_TITLE || !conversation.title.trim()) {
      const title = truncateText(input.content, 60);
      db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now, conversationId);
    } else {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
    }
    return seqRow.next;
  });
  const userSeq = insertUser();

  // Riwayat dan entitas dari turn sebelumnya diteruskan ke core sebagai
  // QueryContext. Core tidak menyimpan state; state tetap di context_json.
  const entities: Record<string, string | number> = {};
  if (previousContext?.channel) entities.channel = previousContext.channel;
  if (previousContext?.category) entities.category = previousContext.category;
  if (previousContext?.failureCode) entities.failureCode = previousContext.failureCode;
  if (previousContext?.metric) entities.metric = previousContext.metric;

  const queryContext: QueryContext = {
    ...(resolvedPeriod
      ? { period: { start: resolvedPeriod.start, end: resolvedPeriod.end } }
      : previousContext?.period
        ? { period: { start: previousContext.period.start, end: previousContext.period.end } }
        : {}),
    ...(Object.keys(entities).length ? { entities } : {}),
    history: history.map((h) => ({ role: h.role, content: h.content })),
    ...(lastAssistantSql
      ? { lastResult: { sql: lastAssistantSql, rowCount: lastAssistantRowCount } }
      : {}),
  };

  // Registry & scope dibangun per permintaan — dan sesuai FR-C, kelompok
  // dokumen percakapan menentukan domain konteks chat: SATU dokumen (scope
  // ketat), KELOMPOK dokumen (NotebookLM-style, dibatasi struktural oleh
  // retrieval IN-clause), atau seluruh dokumen ('*') bila tanpa attachment.
  const activeAttachments = activeAttachmentsForConversation(db, conversationId);
  const activeAttachment = activeAttachments[0] ?? null;
  const contextDatasetId = activeAttachment ? activeAttachment.datasetId : coreDatasetId;
  const retrievalDatasetIds = activeAttachments.length > 1
    ? activeAttachments.map((a) => a.datasetId)
    : null;
  const aiContext = buildAiPortContext(db, {
    datasetId: activeAttachment ? activeAttachment.datasetId : '*',
    datasetIds: retrievalDatasetIds,
    conversationId,
    attachmentId: activeAttachment?.id ?? null,
  });

  const started = Date.now();
  let result: AnswerQuestionResult;
  try {
    const query = await answerQuestion(
      db,
      {
        datasetId: contextDatasetId,
        question: input.content,
        lang,
        context: queryContext,
        conversationId,
        retrievalDatasetIds,
        ...aiContext,
      },
      createCorePorts(db),
    );
    result = coreQueryToResult(query, {
      datasetRef,
      resolvedPeriod,
      previous: previousContext,
    });
  } catch (error) {
    console.error('[chat] core answerQuestion failed:', redactForLog(error instanceof Error ? error.message : error));
    result = fallbackResult(error, lang, datasetRef, previousContext, Date.now() - started);
  }

  const assistantId = randomUUID();
  const createdAt = nowJakartaIso();
  const payload: ChatMessage = {
    id: assistantId,
    role: 'assistant',
    createdAt,
    content: result.content,
    answer: result.answer,
    keyFindings: result.keyFindings,
    supportingTable: result.supportingTable,
    visualizations: result.visualizations,
    sql: result.sql,
    sources: result.sources,
    followUps: result.followUps,
    meta: result.meta,
    ...(result.guardrail ? { guardrail: result.guardrail } : {}),
    ...(result.context ? { context: result.context } : {}),
  };

  const persist = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages(id, conversation_id, seq, role, content, payload_json, context_json, mode, latency_ms, created_at)
       VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`,
    ).run(
      assistantId,
      conversationId,
      userSeq + 1,
      result.content,
      JSON.stringify(payload),
      JSON.stringify(result.context),
      result.mode,
      result.latencyMs,
      createdAt,
    );
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(createdAt, conversationId);
  });
  persist();

  const updated = touchConversation(db, conversationId);
  return {
    message: payload,
    conversation: {
      id: conversationId,
      title: updated.title,
      updatedAt: updated.updated_at,
      messageCount: countMessages(db, conversationId),
    },
  };
}

export function readHistory(db: DB, conversationId: string): MessageRow[] {
  return db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC')
    .all(conversationId) as MessageRow[];
}
