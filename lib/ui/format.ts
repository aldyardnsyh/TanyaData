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
