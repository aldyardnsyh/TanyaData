/**
 * Domain profile — dimensi POV untuk decision table output (arah user:
 * output chatbot menyesuaikan sudut pandang: finance → chart-first,
 * engineering → analisis, HR → KPI). Deterministik: disimpulkan dari kata
 * kunci pertanyaan, nama sumber, dan kolom skema — tanpa jaringan.
 *
 * Aturan main (P-1/P-2 ADAPTIVE_OUTPUT_SPEC): profil hanya MENYUSUN ULANG
 * preferensi tipe output saat pilihan memang ambigu; semua guard ketersediaan
 * data di decideOutput tetap berlaku — profil tidak pernah memaksa chart
 * tanpa data.
 */

export type OutputDomain = 'finance' | 'engineering' | 'hr' | 'general';

export interface DomainProfile {
  domain: OutputDomain;
  confidence: number;
  signals: string[];
}

export interface DomainProfileInput {
  question: string;
  sourceName?: string | null;
  columns?: string[] | null;
  docType?: string | null;
}

const FINANCE_SIGNALS = [
  'transaksi', 'transaction', 'channel', 'kanal', 'payment', 'pembayaran', 'qris',
  'ewallet', 'e-wallet', 'merchant', 'amount', 'nominal', 'fee', 'biaya', 'saldo',
  'revenue', 'pendapatan', 'invoice', 'tagihan', 'gagal', 'success rate', 'refund',
  'settlement', 'deposit', 'top-up', 'dana',
];
const ENGINEERING_SIGNALS = [
  'incident', 'insiden', 'failure', 'kegagalan', 'error code', 'kode kegagalan',
  'uptime', 'latency', 'latensi', 'root cause', 'post-mortem', 'rollback',
  'deployment', 'bug', 'sev ', 'sop', 'diagnosis', 'troubleshoot', 'log',
];
const HR_SIGNALS = [
  'karyawan', 'employee', 'headcount', 'departemen', 'department', 'absensi',
  'cuti', 'leave', 'rekrutmen', 'recruitment', 'onboarding', 'payroll', 'gaji karyawan',
  'performa karyawan', 'kpi karyawan', 'attrition', 'turnover', 'pelatihan',
];

const DOMAIN_WORDS: Record<Exclude<OutputDomain, 'general'>, string[]> = {
  finance: FINANCE_SIGNALS,
  engineering: ENGINEERING_SIGNALS,
  hr: HR_SIGNALS,
};

function countHits(haystack: string, words: string[]): { hits: number; matched: string[] } {
  const matched: string[] = [];
  let hits = 0;
  for (const w of words) {
    if (haystack.includes(w)) {
      hits += 1;
      matched.push(w);
    }
  }
  return { hits, matched };
}

/**
 * Simpulkan domain dari sinyal yang tersedia. Nilai confidence proporsional
 * terhadap jumlah sinyal; tanpa sinyal kuat → general (fallback jujur).
 */
export function inferDomainProfile(input: DomainProfileInput): DomainProfile {
  const signals: string[] = [];
  const scores: Record<OutputDomain, number> = { finance: 0, engineering: 0, hr: 0, general: 0 };

  const question = (input.question ?? '').toLowerCase();
  const sourceName = (input.sourceName ?? '').toLowerCase();
  const columns = (input.columns ?? []).map((c) => c.toLowerCase()).join(' ');

  for (const domain of ['finance', 'engineering', 'hr'] as const) {
    const fromQuestion = countHits(question, DOMAIN_WORDS[domain]);
    const fromSource = countHits(sourceName, DOMAIN_WORDS[domain]);
    const fromColumns = countHits(columns, DOMAIN_WORDS[domain]);
    scores[domain] = fromQuestion.hits * 2 + fromSource.hits * 3 + fromColumns.hits * 2;
    if (fromQuestion.hits) signals.push(`pertanyaan: ${fromQuestion.matched.slice(0, 3).join(', ')}`);
    if (fromSource.hits) signals.push(`sumber: ${fromSource.matched.slice(0, 3).join(', ')}`);
    if (fromColumns.hits) signals.push(`kolom: ${fromColumns.matched.slice(0, 3).join(', ')}`);
  }

  const ranked = (Object.entries(scores) as [OutputDomain, number][])
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0 || ranked[0][1] < 2) {
    return { domain: 'general', confidence: 0.3, signals: signals.slice(0, 3) };
  }
  const [domain, score] = ranked[0];
  const confidence = Math.min(0.95, 0.4 + score * 0.08);
  return { domain, confidence, signals: signals.slice(0, 4) };
}

/**
 * Preferensi komposisi per domain: urutan tipe output kandidat saat keputusan
 * ambigu. Table/KPI tetap sah untuk semua domain — ini urutan selera yang
 * bisa dijelaskan, bukan paksaan (P-1: output tetap mengikuti data).
 */
export function domainPreference(
  domain: OutputDomain,
  kind: string,
): string[] {
  switch (domain) {
    case 'finance':
      // Finance membaca angka: chart dulu saat komposisi/kategori, KPI untuk satu angka.
      return {
        distribution: ['bar', 'donut', 'table'],
        comparison: ['bar', 'table'],
        trend: ['line', 'table'],
        single_number: ['kpi', 'table'],
      }[kind] ?? [];
    case 'engineering':
      // Engineering membaca sebab-akibat: tabel/linimasa lebih informatif.
      return {
        distribution: ['table', 'bar'],
        comparison: ['table', 'bar'],
        sequence: ['timeline', 'table'],
        problem: ['table', 'timeline'],
        parameter: ['parameter_report', 'table'],
      }[kind] ?? [];
    case 'hr':
      // HR membaca KPI orang: angka utama dulu, distribusi sebagai pendamping.
      return {
        distribution: ['kpi', 'table', 'donut'],
        comparison: ['kpi', 'table'],
        single_number: ['kpi', 'table'],
      }[kind] ?? [];
    default:
      return [];
  }
}
