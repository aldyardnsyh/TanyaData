import type { DB } from '@/lib/db/client';
import type { Lang } from '@/lib/contracts/http';
import { resolveScope, type Scope } from '@/lib/analytics/scope';
import { resolvePeriod } from '@/lib/analytics/period';
import { parseFilters, type AnalyticsFilters } from '@/lib/analytics/filters';
import { readSettingsState } from '@/lib/settings';
import { validationError } from '@/lib/errors';

export function parseLang(value: string | null, fallback: Lang = 'id'): Lang {
  if (!value) return fallback;
  if (value === 'id' || value === 'en') return value;
  throw validationError('lang harus "id" atau "en"');
}

export function settingsOrDefault(db: DB) {
  try {
    return readSettingsState(db);
  } catch {
    return null;
  }
}

export type DashboardContext = {
  lang: Lang;
  scope: Scope;
  period: ReturnType<typeof resolvePeriod>;
  filters: AnalyticsFilters;
};

export function dashboardContext(db: DB, searchParams: URLSearchParams): DashboardContext {
  const settings = settingsOrDefault(db);
  const lang = parseLang(searchParams.get('lang'), settings?.lang ?? 'id');
  const datasetParam = searchParams.get('dataset') ?? settings?.activeDatasetId ?? 'seed';
  const scope = resolveScope(datasetParam, db);

  const explicitRange = Boolean(searchParams.get('start') || searchParams.get('end'));
  const requestedPreset = searchParams.get('period');

  // SET-01 / DECISION-036 keputusan 3: bila URL tidak menentukan periode,
  // dashboard memakai `settings.dateRange` — sumber yang sama dengan Asisten.
  // `this_month` hanya fallback bila settings tidak tersedia, atau rentangnya
  // tidak valid untuk scope dataset yang sedang dilihat (mis. override
  // `?dataset=` ke dataset dengan batas tanggal berbeda).
  const settingsRange = settings?.dateRange ?? null;
  const useSettingsRange =
    !requestedPreset &&
    !explicitRange &&
    settingsRange !== null &&
    settingsRange.start <= settingsRange.end &&
    settingsRange.start >= scope.ref.minDate &&
    settingsRange.end <= scope.ref.maxDate;
  const rangeStart = useSettingsRange && settingsRange ? settingsRange.start : null;
  const rangeEnd = useSettingsRange && settingsRange ? settingsRange.end : null;

  const period = resolvePeriod(
    {
      period: requestedPreset ?? (explicitRange || useSettingsRange ? 'custom' : 'this_month'),
      start: searchParams.get('start') ?? rangeStart,
      end: searchParams.get('end') ?? rangeEnd,
      compare: searchParams.get('compare'),
    },
    { minDate: scope.ref.minDate, maxDate: scope.ref.maxDate },
    lang,
  );

  return { lang, scope, period, filters: parseFilters(searchParams) };
}
