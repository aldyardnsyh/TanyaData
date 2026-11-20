import { z } from 'zod';
import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { parseJsonBody } from '@/lib/api/validate';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { answerQuestion } from '@/lib/core/query';
import { saveEvaluation, saveQuery } from '@/lib/core/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  datasetId: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(2000),
  lang: z.enum(['id', 'en']).default('id'),
  evaluate: z.boolean().optional(),
  context: z
    .object({
      period: z.object({ start: z.string().max(10), end: z.string().max(10) }).nullable().optional(),
      entities: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      history: z
        .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
        .max(20)
        .optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const body = await parseJsonBody(request, querySchema);
    const result = await answerQuestion(db, {
      datasetId: body.datasetId,
      question: body.question,
      lang: body.lang,
      context: body.context ?? null,
      evaluate: body.evaluate ?? false,
    });
    saveQuery(db, result);
    if (result.evaluation) {
      saveEvaluation(db, { queryId: result.id, datasetId: result.dataset_id, evaluation: result.evaluation });
    }
    return jsonResponse({ query: result });
  });
}
