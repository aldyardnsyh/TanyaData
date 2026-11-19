import { handleRoute, jsonResponse } from '@/lib/api/respond';
import { ensureWorkspaceReady } from '@/lib/db/migrate';
import { resolveScope } from '@/lib/analytics/scope';
import { resolvePeriod } from '@/lib/analytics/period';
import { analyzeInvestigation } from '@/lib/investigation/engine';
import { settingsOrDefault, parseLang } from '@/lib/api/dashboard';
import { investigateSchema } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleRoute(async () => {
    const db = ensureWorkspaceReady();
    const body = await parseJsonBody(request, investigateSchema);
    const settings = settingsOrDefault(db);
    const lang = body.lang ?? parseLang(null, settings?.lang ?? 'id');
    const scope = resolveScope(body.dataset ?? settings?.activeDatasetId ?? 'seed', db);

    const bounds = { minDate: scope.ref.minDate, maxDate: scope.ref.maxDate };
    const rawStart = settings?.dateRange.start ?? bounds.minDate;
    const rawEnd = settings?.dateRange.end ?? bounds.maxDate;
    const safeStart = rawStart < bounds.minDate ? bounds.minDate : rawStart > bounds.maxDate ? bounds.maxDate : rawStart;
    const safeEnd = rawEnd < bounds.minDate ? bounds.minDate : rawEnd > bounds.maxDate ? bounds.maxDate : rawEnd;
    const period = body.period
      ? resolvePeriod(
          { period: 'custom', start: body.period.start, end: body.period.end, compare: body.compare ?? 'like_for_like' },
          bounds,
          lang,
        )
      : resolvePeriod(
          {
            period: 'custom',
            start: safeStart <= safeEnd ? safeStart : safeEnd,
            end: safeStart <= safeEnd ? safeEnd : safeStart,
            compare: body.compare ?? 'like_for_like',
          },
          bounds,
          lang,
        );

    const persist = body.persist ?? true;
    const investigation = analyzeInvestigation({
      db,
      scope,
      period,
      filters: { channel: body.focus?.channel ?? null, category: body.focus?.category ?? null },
      question: body.question,
      persist,
      lang,
    });

    return jsonResponse({ investigation }, persist ? 201 : 200);
  });
}
