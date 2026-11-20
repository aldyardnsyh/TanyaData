/**
 * TanyaData AI — orkestrasi utama (lib/ai/index.ts).
 *
 * Kontrak: AnswerQuestionInput -> AnswerQuestionResult (lib/contracts/http.ts).
 * Pipeline deterministik (SQL/RAG) + LLM opsional sebagai enhancement narasi.
 * Signature `answerQuestion` tidak berubah (dipakai lib/chat/messages.ts).
 */
import type {
  AnswerQuestionInput,
  AnswerQuestionResult,
  AssistantContext,
  ChatMode,
  SourceCitation,
} from '@/lib/contracts/http';
import type { AnswerQuestionResultWithEvidence } from '@/lib/core/contracts';
import { getWorkspaceDb } from '@/lib/db/client';
import { resolveScope } from '@/lib/analytics/scope';
import type { Scope } from '@/lib/analytics/scope';
import type { AnalyticsFilters } from '@/lib/analytics/filters';
import type { Period } from '@/lib/contracts/http';
import { normalizeQuestion, type Normalized } from '@/lib/ai/normalize';
import { resolvePeriodFor, mergeContext } from '@/lib/ai/resolve';
import { retrieveDocuments } from '@/lib/ai/retrieval';
import { decideIntent, intentById, scoreIntent, INTENTS, type IntentDef } from '@/lib/ai/intents';
import {
  composeResult, emptyDraft, freshContext,
  type DraftResult, type HandlerCtx,
} from '@/lib/ai/compose';
import { classifyEvidenceConfidence } from '@/lib/ai/output';
import {
  buildGuardrail, detectEarlyGuardrail, isSqlInjectionLike,
  type EarlyGuardrail,
} from '@/lib/ai/guardrails';
import {
  buildAllowNums, llmAvailable, llmMode, llmRefine,
  type LlmFallbackReason,
} from '@/lib/ai/llm';
import { nowJakartaIso } from '@/lib/date';

/**
 * Titik masuk tunggal. HTTP tetap 200; kegagalan LLM tidak pernah merusak jawaban.
 *
 * Evidence confidence ditempelkan di sini (bukan di compose.ts milik backend)
 * supaya seluruh jalur — RAG, guardrail `not_in_sources`, dan fallback —
 * mendapatkan perlakuan yang sama tanpa mengubah handler mana pun.
 */
export async function answerQuestion(
  input: AnswerQuestionInput,
): Promise<AnswerQuestionResultWithEvidence> {
  const result = await answerQuestionCore(input);
  return withEvidenceConfidence(result, input.question);
}

/** Pipeline deterministik apa adanya, sebelum label evidence ditempelkan. */
async function answerQuestionCore(input: AnswerQuestionInput): Promise<AnswerQuestionResult> {
  const started = performance.now();
  const db = getWorkspaceDb();
  const lang = input.lang;
  const question = (input.question ?? '').trim();

  let scope: Scope;
  try {
    scope = resolveScope(input.datasetId, db);
  } catch {
    return buildGuardrail(input, 'unsupported', lang, null, started);
  }

  /* 1) Guardrail awal (destructive/pii/ambiguous/off-topic/smalltalk). */
  const early: EarlyGuardrail = detectEarlyGuardrail(db, question);
  if (early && early !== 'smalltalk') {
    return buildGuardrail(input, early, lang, scope, started);
  }
  if (isSqlInjectionLike(question)) {
    return buildGuardrail(input, 'destructive', lang, scope, started);
  }

  /* 2) Normalisasi + resolusi periode. */
  const norm = normalizeQuestion(db, question || ' ');
  const resolution = resolvePeriodFor(input, norm, scope, lang);
  if (!resolution.ok) {
    return buildGuardrail(input, 'out_of_range', lang, scope, started);
  }
  const period = resolution.period;

  /* 3) Smalltalk (dideteksi lebih dulu). */
  if (early === 'smalltalk') {
    const intent = intentById('SMALLTALK')!;
    const ctx = makeCtx(scope, lang, question, norm, period, input, [], false);
    const draft = intent.handler(ctx);
    const context = mergeContext({ context: input.context ?? null }, 'SMALLTALK', 'meta', period, norm);
    return composeResult(ctx, draft, context, started, undefined);
  }

  /* 4) Keputusan intent + konteks follow-up. */
  const decision = decideIntent(norm);
  if (decision.kind === 'guardrail') {
    return buildGuardrail(input, decision.type, lang, scope, started);
  }
  const intent: IntentDef = decision.intent;
  const contextApplied: HandlerCtx['contextApplied'] = ['period'];
  if (norm.channel) contextApplied.push('channel');
  if (norm.category) contextApplied.push('category');
  if (norm.failureCode) contextApplied.push('failureCode');

  const domain = ctxDomain(intent);
  const context = mergeContext({ context: input.context ?? null }, intent.id, domain, period, norm);
  const ctx = makeCtx(scope, lang, question, norm, period, input, contextApplied, decision.assumed);
  ctx.context = context;

  // Entity yang diwarisi dari konteks → filter & contextApplied.
  const filters: AnalyticsFilters = {
    channel: norm.channel ?? context.channel,
    category: norm.category ?? context.category,
    failureCode: norm.failureCode ?? context.failureCode,
  };
  ctx.filters = filters;
  if (filters.channel && !contextApplied.includes('channel')) contextApplied.push('channel');
  if (filters.category && !contextApplied.includes('category')) contextApplied.push('category');
  if (filters.failureCode && !contextApplied.includes('failureCode')) contextApplied.push('failureCode');

  /* 5) Eksekusi handler (SQL/RAG/hybrid). */
  let draft: DraftResult;
  try {
    draft = intent.handler(ctx);
  } catch {
    const fallback = emptyDraft('sql');
    fallback.answer = lang === 'id'
      ? 'Data tidak dapat diambil saat ini. Silakan coba lagi dengan pertanyaan yang lebih spesifik.'
      : 'Data could not be retrieved right now. Please retry with a more specific question.';
    fallback.followUps = ['Berapa total transaksi bulan ini?', 'Bagaimana distribusi statusnya?'];
    return composeResult(ctx, fallback, context, started, 'llm_error');
  }

  /* 6) RAG wajib punya sitasi dokumen; tanpa itu jujur. */
  if (intent.domain === 'rag' && draft.sources.filter((s) => s.kind === 'document').length === 0) {
    return buildGuardrail(input, 'not_in_sources', lang, scope, started);
  }

  /* 7) Optional LLM refine — narasi saja; angka tidak diubah. */
  const mode = llmMode();
  const hasNumbers = draft.supportingTable !== null || draft.visualizations.length > 0 || draft.sql !== null;
  let fallbackReason: LlmFallbackReason | undefined;
  if (mode !== 'off' && llmAvailable() && hasNumbers) {
    const allowed = buildAllowNums(draft);
    const outcome = await llmRefine(mode, draft, lang, allowed);
    if (outcome.draft) draft = outcome.draft;
    else fallbackReason = outcome.reason;
  }

  /* 8) Finalisasi konteks: handler boleh menimpa entity yang ditemukannya. */
  const finalContext: AssistantContext = {
    ...context,
    metric: draft.contextUpdates.metric ?? context.metric,
    channel: draft.contextUpdates.channel !== undefined ? draft.contextUpdates.channel : context.channel,
    category: draft.contextUpdates.category !== undefined ? draft.contextUpdates.category : context.category,
    failureCode: draft.contextUpdates.failureCode !== undefined ? draft.contextUpdates.failureCode : context.failureCode,
    docRefs: draft.contextUpdates.docRefs ?? context.docRefs,
    updatedAt: nowJakartaIso(),
  };
  return composeResult(ctx, draft, finalContext, started, fallbackReason);
}

/**
 * Tempel `confidenceLevel` + `alternativeKeywords` hanya pada jawaban yang
 * memang bertumpu pada bukti dokumen. Jawaban SQL murni tidak diberi label
 * evidence (tidak relevan), sedangkan guardrail `not_in_sources` adalah
 * bentuk `refused` yang disyaratkan CORE_AI_SPEC §5.4.
 */
function withEvidenceConfidence(
  result: AnswerQuestionResult,
  question: string,
): AnswerQuestionResultWithEvidence {
  const docSources = result.sources.filter((s) => s.kind === 'document');
  const isEvidenceRefusal = result.guardrail?.type === 'not_in_sources';
  if (!docSources.length && !isEvidenceRefusal) return result;

  const { confidenceLevel, alternativeKeywords } = classifyEvidenceConfidence({
    question,
    citations: docSources.map((s) => ({
      score: s.score ?? null,
      section_path: s.section ?? (s.sectionNo === null || s.sectionNo === undefined ? null : String(s.sectionNo)),
      quote: s.quote ?? null,
    })),
  });
  return { ...result, confidenceLevel, alternativeKeywords };
}

/* ---------------------------------------------------------------- helpers */

function ctxDomain(intent: IntentDef): AssistantContext['lastDomain'] {
  if (intent.id === 'SMALLTALK' || intent.id === 'META_help') return 'meta';
  if (intent.domain === 'hybrid') return 'hybrid';
  if (intent.domain === 'rag') return 'rag';
  return intent.domain === 'meta' ? 'meta' : 'sql';
}

function makeCtx(
  scope: Scope,
  lang: AnswerQuestionInput['lang'],
  question: string,
  norm: Normalized,
  period: Period,
  input: AnswerQuestionInput,
  contextApplied: HandlerCtx['contextApplied'],
  assumed: boolean,
): HandlerCtx {
  const prev = input.context;
  return {
    db: getWorkspaceDb(),
    scope,
    lang,
    question,
    norm,
    period,
    filters: {},
    context: prev ?? freshContext(1),
    contextApplied,
    assumed,
  };
}

/** Diekspor untuk keperluan diagnostik/internal (bukan bagian kontrak chat). */
export function debugIntents(db: ReturnType<typeof getWorkspaceDb>, question: string) {
  const norm = normalizeQuestion(db, question);
  return INTENTS.map((i) => ({ id: i.id, score: scoreIntent(i, norm) })).sort((a, b) => b.score - a.score);
}

export function debugRetrieve(db: ReturnType<typeof getWorkspaceDb>, question: string): SourceCitation[] {
  return retrieveDocuments(db, question, 'id');
}
