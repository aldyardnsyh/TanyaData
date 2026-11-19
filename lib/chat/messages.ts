import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import type {
  AnswerQuestionInput,
  AnswerQuestionResult,
  AssistantContext,
  ChatMessage,
  Lang,
  SendMessageResponse,
  SourceCitation,
} from '@/lib/contracts/http';
import { answerQuestion } from '@/lib/ai';
import { resolveScope } from '@/lib/analytics/scope';
import { nowJakartaIso, truncateText } from '@/lib/date';
import { resolvePeriod } from '@/lib/analytics/period';
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
  datasetRef: ReturnType<typeof resolveScope>['ref'],
  previous: AssistantContext | null,
  latencyMs: number,
): AnswerQuestionResult {
  void error;
  const now = nowJakartaIso();
  const content =
    lang === 'id'
      ? 'Maaf, jawaban tidak dapat disusun saat ini. Pesan Anda tersimpan; silakan coba lagi.'
      : 'Sorry, the answer could not be produced right now. Your message is saved; please retry.';
  const sources: SourceCitation[] = [];
  return {
    content,
    answer: content,
    keyFindings: [],
    supportingTable: null,
    visualizations: [],
    sql: null,
    sources,
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

export async function sendMessage(db: DB, conversationId: string, input: SendMessageInput): Promise<SendMessageResponse> {
  const conversation = getConversationRow(db, conversationId);
  const lang: Lang = input.lang ?? (conversation.lang === 'en' ? 'en' : 'id');
  const datasetId = input.dataset ?? conversation.dataset_id;
  const scope = resolveScope(datasetId, db);

  if (input.period) {
    resolvePeriod(
      { period: 'custom', start: input.period.start, end: input.period.end },
      { minDate: scope.ref.minDate, maxDate: scope.ref.maxDate },
      lang,
    );
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

  const answerInput: AnswerQuestionInput = {
    question: input.content,
    lang,
    conversationId,
    datasetId: scope.id,
    period: input.period ?? null,
    history,
    context: previousContext,
  };

  const started = Date.now();
  let result: AnswerQuestionResult;
  try {
    result = await answerQuestion(answerInput);
  } catch (error) {
    console.error('[chat] answerQuestion failed:', error instanceof Error ? error.message : error);
    result = fallbackResult(error, lang, scope.ref, previousContext, Date.now() - started);
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
