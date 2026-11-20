import { format, parseISO } from 'date-fns';
import { id as idLocale, enUS } from 'date-fns/locale';

/** Format mata uang IDR: `Rp 1.284.500.000` (tanpa desimal). Null/undefined → `—`. */
export function formatIdr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `Rp ${value.toLocaleString('id-ID', { useGrouping: true, maximumFractionDigits: 0 })}`;
}

/** Format angka id-ID dengan pemisah ribuan. Null/undefined → `—`. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('id-ID', { useGrouping: true, maximumFractionDigits: 0 });
}

/** Format persen id-ID: 1 digit desimal, koma. Null/undefined → `—`. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1).replace('.', ',')}%`;
}

/** Format tanggal ID: `d MMM yyyy` (mis. `18 Nov 2026`). */
export function formatDateId(date: string | null | undefined): string {
  if (!date) return '—';
  return format(parseISO(date), 'd MMM yyyy', { locale: idLocale });
}

/** Format tanggal EN: `d MMM yyyy`. */
export function formatDateEn(date: string | null | undefined): string {
  if (!date) return '—';
  return format(parseISO(date), 'd MMM yyyy', { locale: enUS });
}

/** Format tanggal+jam ID: `d MMM yyyy · HH.mm`. */
export function formatDateTimeId(date: string | null | undefined): string {
  if (!date) return '—';
  return format(parseISO(date), 'd MMM yyyy · HH.mm', { locale: idLocale });
}

/** Format rentang tanggal ID: `1–18 Nov 2026` (en dash). */
export function formatDateRangeId(start: string, end: string): string {
  return `${formatDateId(start)} – ${formatDateId(end)}`;
}

/**
 * Label ringkas untuk data statis: `1–18 Nov 2026` bila satu bulan,
 * `1 Nov 2026 – 1 Des 2026` bila lintas bulan. Dipakai untuk menggantikan
 * klaim "live" pada periode yang sebenarnya tetap.
 */
export function formatSnapshotRange(
  start: string | null | undefined,
  end: string | null | undefined,
  lang: 'id' | 'en' = 'en',
): string {
  if (!start || !end) return 'n/a';
  const locale = lang === 'id' ? idLocale : enUS;
  const d1 = format(parseISO(start), 'd', { locale });
  const d2 = format(parseISO(end), 'd', { locale });
  const m1 = format(parseISO(start), 'MMM yyyy', { locale });
  const m2 = format(parseISO(end), 'MMM yyyy', { locale });
  return start.slice(0, 7) === end.slice(0, 7) ? `${d1}–${d2} ${m2}` : `${d1} ${m1} – ${d2} ${m2}`;
}
