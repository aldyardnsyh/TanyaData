import { z } from 'zod';
import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rate-limit';
import { parseJsonBody } from '@/lib/api/validate';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { answerQuestion } from '@/lib/core/query';
import { saveEvaluation, saveQuery } from '@/lib/core/store';
import { buildAiPortContext, createCorePorts } from '@/lib/ai/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  datasetId: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(2000),
  lang: z.enum(['id', 'en']).default('id'),
  evaluate: z.boolean().optional(),
  /** Attachment aktif — dipakai AI adapter untuk scope gate (opsional). */
  conversationId: z.string().trim().max(120).optional(),
  attachmentId: z.string().trim().max(120).optional(),
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
  const limited = rateLimit(request, 'query');
  if (limited) return limited;
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const body = await parseJsonBody(request, querySchema);
    // Registry & scope dibangun per permintaan dari DB, bukan dari state global:
    // tidak ada kebocoran bukti antar attachment. Kegagalan di sini tidak
    // menggagalkan jawaban — adapter/core tetap fallback deterministik.
    const aiContext = buildAiPortContext(db, {
      datasetId: body.datasetId,
      conversationId: body.conversationId ?? null,
      attachmentId: body.attachmentId ?? null,
    });
    const result = await answerQuestion(
      db,
      {
        datasetId: body.datasetId,
        question: body.question,
        lang: body.lang,
        context: body.context ?? null,
        evaluate: body.evaluate ?? false,
        ...aiContext,
      },
      createCorePorts(db),
    );
    saveQuery(db, result);
    if (result.evaluation) {
      saveEvaluation(db, { queryId: result.id, datasetId: result.dataset_id, evaluation: result.evaluation });
    }
    return jsonResponse({ query: result, meta: result.meta ?? null });
  });
}
