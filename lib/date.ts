import type { Lang } from '@/lib/contracts/http';

const MONTHS_SHORT: Record<Lang, string[]> = {
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const DAY_MS = 86_400_000;

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = fromIso(value);
  return toIso(d) === value;
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toIso(new Date(fromIso(iso).getTime() + days * DAY_MS));
}

export function diffDays(start: string, end: string): number {
  return Math.round((fromIso(end).getTime() - fromIso(start).getTime()) / DAY_MS);
}

export function monthStart(iso: string): string {
  const d = fromIso(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

export function monthEnd(iso: string): string {
  const d = fromIso(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function shiftMonth(iso: string, delta: number): string {
  const d = fromIso(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)));
}

export function yearOf(iso: string): number {
  return fromIso(iso).getUTCFullYear();
}

export function monthOf(iso: string): number {
  return fromIso(iso).getUTCMonth();
}

export function dayOf(iso: string): number {
  return fromIso(iso).getUTCDate();
}

/** Senin sebagai awal minggu (konsisten dengan SQLite `weekday 0, -6 days`). */
export function weekStart(iso: string): string {
  const d = fromIso(iso);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Senin
  return addDays(iso, -dow);
}

export function quarterStart(iso: string): string {
  const m = monthOf(iso);
  const q = Math.floor(m / 3) * 3;
  const d = fromIso(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), q, 1)));
}

export function formatDayMonth(iso: string, lang: Lang): string {
  return `${dayOf(iso)} ${MONTHS_SHORT[lang][monthOf(iso)]}`;
}

export function formatDateLabel(start: string, end: string, lang: Lang = 'id'): string {
  const m1 = MONTHS_SHORT[lang][monthOf(start)];
  const m2 = MONTHS_SHORT[lang][monthOf(end)];
  const y1 = yearOf(start);
  const y2 = yearOf(end);
  if (start === end) return `${dayOf(start)} ${m1} ${y1}`;
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${dayOf(start)}–${dayOf(end)} ${m1} ${y1}`;
  }
  if (y1 === y2) {
    return `${dayOf(start)} ${m1} – ${dayOf(end)} ${m2} ${y1}`;
  }
  return `${dayOf(start)} ${m1} ${y1} – ${dayOf(end)} ${m2} ${y2}`;
}

export function formatMonthLabel(iso: string, lang: Lang = 'id'): string {
  return `${MONTHS_SHORT[lang][monthOf(iso)]} ${yearOf(iso)}`;
}

/** ISO-8601 dengan offset +07:00 (Asia/Jakarta), tanpa milidetik. */
export function nowJakartaIso(at: number = Date.now()): string {
  const shifted = new Date(at + 7 * 3_600_000);
  return `${shifted.toISOString().slice(0, 19)}+07:00`;
}

export function formatNumber(value: number, lang: Lang = 'id'): string {
  return new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US').format(value);
}

export function formatPercent(value: number, lang: Lang = 'id', digits = 2): string {
  const text = value.toFixed(digits).replace('.', lang === 'id' ? ',' : '.');
  return `${text}%`;
}

export function formatCurrency(value: number, lang: Lang = 'id'): string {
  return `IDR ${new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US').format(value)}`;
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** Angka 1 desimal; dipakai untuk excessFailures. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function safeRatio(numerator: number, denominator: number, digits = 2): number {
  if (!denominator) return 0;
  return digits === 1 ? round1((numerator / denominator) * 100) : round2((numerator / denominator) * 100);
}

export function changePct(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}
