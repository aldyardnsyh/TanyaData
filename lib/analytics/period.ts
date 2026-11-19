import type { Lang, Period, PeriodCompareStrategy } from '@/lib/contracts/http';
import {
  addDays,
  diffDays,
  formatDateLabel,
  formatMonthLabel,
  fromIso,
  isIsoDate,
  monthEnd,
  monthStart,
  quarterStart,
  toIso,
} from '@/lib/date';
import { validationError } from '@/lib/errors';

export type PeriodBounds = { minDate: string; maxDate: string };

export type PeriodQuery = {
  period?: string | null;
  start?: string | null;
  end?: string | null;
  compare?: string | null;
};

export const PERIOD_PRESETS = [
  'this_month',
  'last_month',
  'last_7_days',
  'last_30_days',
  'this_quarter',
  'all',
  'custom',
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

function clamp(iso: string, bounds: PeriodBounds): string {
  if (iso < bounds.minDate) return bounds.minDate;
  if (iso > bounds.maxDate) return bounds.maxDate;
  return iso;
}

function shiftMonthClamped(iso: string, delta: number): string {
  const d = fromIso(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + delta;
  const day = d.getUTCDate();
  const first = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay))));
}

function parseStrategy(value: string | null | undefined): PeriodCompareStrategy {
  if (!value) return 'like_for_like';
  if (value === 'like_for_like' || value === 'previous' || value === 'none') return value;
  throw validationError(`Nilai compare tidak dikenal: ${value}`);
}

function windowForPreset(preset: PeriodPreset, bounds: PeriodBounds): { start: string; end: string } {
  const refEnd = bounds.maxDate;
  switch (preset) {
    case 'this_month':
      return { start: monthStart(refEnd), end: refEnd };
    case 'last_month': {
      const prevEnd = addDays(monthStart(refEnd), -1);
      return { start: monthStart(prevEnd), end: prevEnd };
    }
    case 'last_7_days':
      return { start: addDays(refEnd, -6), end: refEnd };
    case 'last_30_days':
      return { start: addDays(refEnd, -29), end: refEnd };
    case 'this_quarter':
      return { start: quarterStart(refEnd), end: refEnd };
    case 'all':
      return { start: bounds.minDate, end: bounds.maxDate };
    case 'custom':
      return { start: monthStart(refEnd), end: refEnd };
    default:
      return { start: monthStart(refEnd), end: refEnd };
  }
}

function buildLabel(start: string, end: string, lang: Lang): string {
  if (start.endsWith('-01') && end === monthEnd(end) && start.slice(0, 7) === end.slice(0, 7)) {
    return formatMonthLabel(start, lang);
  }
  return formatDateLabel(start, end, lang);
}

function compareWindow(
  start: string,
  end: string,
  strategy: PeriodCompareStrategy,
  bounds: PeriodBounds,
): Period['compare'] {
  if (strategy === 'none') return null;

  let cStart: string;
  let cEnd: string;
  if (strategy === 'like_for_like') {
    cStart = shiftMonthClamped(start, -1);
    cEnd = shiftMonthClamped(end, -1);
  } else {
    const length = diffDays(start, end) + 1;
    cEnd = addDays(start, -1);
    cStart = addDays(cEnd, -(length - 1));
  }

  if (cEnd < bounds.minDate) return null;
  if (cStart < bounds.minDate) cStart = bounds.minDate;
  if (cStart > cEnd) return null;

  return {
    start: cStart,
    end: cEnd,
    label: `${cStart} .. ${cEnd}`,
    strategy,
  };
}

export function resolvePeriod(input: PeriodQuery, bounds: PeriodBounds, lang: Lang = 'id'): Period {
  const preset = (input.period ?? 'this_month') as PeriodPreset;
  const known = (PERIOD_PRESETS as readonly string[]).includes(preset);
  if (!known) throw validationError(`Preset periode tidak dikenal: ${input.period}`);

  let start: string;
  let end: string;

  if (preset === 'custom') {
    if (!input.start || !input.end) throw validationError('start dan end wajib untuk periode custom');
    if (!isIsoDate(input.start) || !isIsoDate(input.end)) {
      throw validationError('Format tanggal harus YYYY-MM-DD');
    }
    start = input.start;
    end = input.end;
  } else {
    const window = windowForPreset(preset, bounds);
    start = window.start;
    end = window.end;
  }

  if (start > end) throw validationError('start tidak boleh setelah end');
  if (end < bounds.minDate || start > bounds.maxDate) {
    throw validationError(
      `Periode di luar rentang data (${bounds.minDate} s/d ${bounds.maxDate})`,
      { minDate: bounds.minDate, maxDate: bounds.maxDate },
    );
  }

  start = clamp(start, bounds);
  end = clamp(end, bounds);

  const strategy = parseStrategy(input.compare);
  const compare = compareWindow(start, end, strategy, bounds);
  const dayCount = diffDays(start, end) + 1;
  const isPartial = end >= bounds.maxDate && end < monthEnd(end);

  return {
    start,
    end,
    label: buildLabel(start, end, lang),
    isPartial,
    dayCount,
    compare,
  };
}

export function periodOf(start: string, end: string, lang: Lang = 'id'): Period {
  return {
    start,
    end,
    label: formatDateLabel(start, end, lang),
    isPartial: false,
    dayCount: diffDays(start, end) + 1,
    compare: null,
  };
}
