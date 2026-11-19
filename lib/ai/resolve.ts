/**
 * TanyaData AI — resolve periode & konteks follow-up (lib/ai/resolve.ts).
 *
 * - Periode default: Nov 2026 MTD (2026-11-01..2026-11-18) via resolvePeriod.
 * - Override eksplisit dari input.period.
 * - Deteksi periode dari teks pertanyaan (Desember 2026 → out_of_range).
 * - Konteks follow-up: mewarisi channel/kategory/failureCode/period dari
 *   `input.context` (AssistantContext) sesuai ARCHITECTURE §5.5.
 */
import type {
  AssistantContext,
  Lang,
  Period,
} from '@/lib/contracts/http';
import type { Scope } from '@/lib/analytics/scope';
import { resolvePeriod } from '@/lib/analytics/period';
import { addDays } from '@/lib/date';
import type { Normalized } from '@/lib/ai/normalize';

export type PeriodResolution =
  | { ok: true; period: Period; detected: 'explicit' | 'question' | 'default' }
  | { ok: false; outOfRange: true };

function periodForMonth(month: string, bounds: { minDate: string; maxDate: string }, lang: Lang): Period {
  const start = `${month}-01`;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  return resolvePeriod({ period: 'custom', start, end }, bounds, lang);
}

export function resolvePeriodFor(
  input: { period: { start: string; end: string } | null },
  norm: Normalized,
  scope: Scope,
  lang: Lang,
): PeriodResolution {
  const bounds = { minDate: scope.ref.minDate, maxDate: scope.ref.maxDate };

  // 1) override eksplisit
  if (input.period) {
    try {
      return {
        ok: true,
        period: resolvePeriod({ period: 'custom', start: input.period.start, end: input.period.end }, bounds, lang),
        detected: 'explicit',
      };
    } catch {
      return { ok: false, outOfRange: true };
    }
  }

  // 2) deteksi periode dari teks pertanyaan
  if (norm.monthPhrase) {
    try {
      return { ok: true, period: periodForMonth(norm.monthPhrase.month, bounds, lang), detected: 'question' };
    } catch {
      return { ok: false, outOfRange: true };
    }
  }
  if (norm.periodPhrase) {
    try {
      return { ok: true, period: resolvePeriod({ period: norm.periodPhrase }, bounds, lang), detected: 'question' };
    } catch {
      return { ok: false, outOfRange: true };
    }
  }

  // 3) default: bulan ini
  return { ok: true, period: resolvePeriod({ period: 'this_month' }, bounds, lang), detected: 'default' };
}

/**
 * Merge konteks follow-up (ARCHITECTURE §5.5). Pertama menang:
 * entity eksplisit → warisi dari konteks assistant terakhir → reset domain baru.
 */
export function mergeContext(
  input: { context: AssistantContext | null },
  intentId: string,
  intentDomain: AssistantContext['lastDomain'],
  period: Period,
  norm: Normalized,
): AssistantContext {
  const prev = input.context;
  const turn = (prev?.turn ?? 0) + 1;

  // entity eksplisit dari pertanyaan (override)
  const explicitChannel = norm.channel;
  const explicitCategory = norm.category;
  const explicitFailureCode = norm.failureCode;

  // warisan dari konteks sebelumnya
  const inheritedChannel = prev?.channel ?? null;
  const inheritedCategory = prev?.category ?? null;
  const inheritedFailureCode = prev?.failureCode ?? null;

  // domain berubah → reset channel/category/failureCode, pertahankan period
  const domainChanged = Boolean(prev && prev.lastDomain !== intentDomain && prev.lastDomain !== null);
  // turn > 6 tanpa penyebutan entity → reset channel/category, period tetap
  const turnReset = turn > 6 && !explicitChannel && !explicitCategory && !explicitFailureCode;
  const resetEntities = domainChanged || turnReset;

  return {
    period,
    metric: prev?.metric ?? null,
    channel: explicitChannel ?? (resetEntities ? null : inheritedChannel),
    category: explicitCategory ?? (resetEntities ? null : inheritedCategory),
    failureCode: explicitFailureCode ?? (resetEntities ? null : inheritedFailureCode),
    docRefs: prev?.docRefs ?? [],
    lastIntentId: intentId,
    lastDomain: intentDomain,
    turn,
    updatedAt: new Date().toISOString(),
  };
}
