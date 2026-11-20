/**
 * Query orchestration — tahap 10..12 (CORE_ARCHITECTURE §4).
 * NL → SQL kandidat → validator → eksekusi → retrieval → viz → evaluasi.
 */

import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/db/client';
import { nowJakartaIso } from '@/lib/date';
import type {
  Citation,
  Guardrail,
  Query,
  QueryContext,
  QueryResultJson,
  SqlCandidate,
} from '@/lib/core/contracts';
import type { CorePorts } from '@/lib/core/ports';
import { getDataset } from '@/lib/core/registry';
import { buildRuleBasedCandidate, runCandidate } from '@/lib/core/sql';
import { searchChunks } from '@/lib/core/store';
import {
  buildVizSpec,
  composeDeterministicAnswer,
  detectGuardrail,
  evaluateGrounding,
  notInSourcesGuardrail,
} from '@/lib/core/answer';

export type AnswerQuestionInput = {
  datasetId: string;
  question: string;
  lang: 'id' | 'en';
  context?: QueryContext | null;
  evaluate?: boolean;
};

const EMPTY_RESULT: QueryResultJson = { columns: [], rows: [], rowCount: 0, truncated: false };

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
    query.guardrail = {
      type: 'unsupported',
      explanation: `Dataset "${dataset.name}" belum siap digunakan (status ${dataset.status}).`,
    };
    query.answer = query.guardrail.explanation;
    query.duration_ms = Math.round(performance.now() - started);
    return query;
  }

  const guardrail = detectGuardrail({ question: input.question, dataset, context: input.context ?? null });
  if (guardrail) {
    query.guardrail = guardrail;
    query.answer = guardrail.explanation;
    query.duration_ms = Math.round(performance.now() - started);
    return query;
  }

  let candidate: SqlCandidate | null = null;
  let rejection: string | null = null;
  if (ports.sqlGenerator) {
    try {
      candidate = await ports.sqlGenerator.generate({
        question: input.question,
        schema: dataset.schema_json,
        context: input.context ?? null,
        lang: input.lang,
      });
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
  try {
    citations = searchChunks(db, { datasetId: dataset.id, question: input.question, limit: 5 });
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
      query.mode = citations.length ? 'hybrid' : 'sql';
    } catch (error) {
      rejection = error instanceof Error ? error.message : String(error);
    }
  }

  if (!query.generated_sql && !citations.length) {
    const g: Guardrail = rejection
      ? { type: 'sql_rejected', explanation: `SQL tidak dapat dibuat atau divalidasi: ${rejection}` }
      : notInSourcesGuardrail(dataset);
    query.guardrail = g;
    query.answer = g.explanation;
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
        lang: input.lang,
        docType: dataset.doc_type,
        schema: dataset.schema_json,
        result: query.result_json,
        citations,
        sqlExplanation: query.sql_explanation,
        mode: query.mode === 'guardrail' ? 'document' : query.mode,
      });
      answer = composed?.answer ?? null;
      if (composed) {
        query.viz_spec = composed.vizSpec;
        query.citations = composed.citations;
      }
    } catch {
      answer = null;
    }
  }
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
  return query;
}
