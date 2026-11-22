/**
 * Analytics per dokumen (lib/core/doc-analytics.ts).
 * Dashboard analitik deterministik dari chunk terindeks — tanpa LLM, tanpa
 * jaringan (konsisten filosofi kutipan deterministik). Dipakai oleh
 * /api/sources/[id]/analytics; tersedia otomatis begitu dokumen terindeks.
 *
 * Tipe dokumen menentukan report: laporan keuangan → metrik nominal/persen/
 * periode; SOP insiden → kode kegagalan, kanal, SLA, kontak eskalasi.
 * Dokumen lain → statistik struktur + entitas umum.
 */

export type DocType = 'financial-report' | 'incident-report' | 'general';

export interface DocAnalyticsChunk {
  section: string | null;
  page: number | null;
  content: string;
}

export interface EntityHit {
  label: string;
  count: number;
  /** Bagian dokumen dengan frekuensi tertinggi untuk entitas ini. */
  topSection: string | null;
  topPage: number | null;
}

export interface DocAnalytics {
  docType: DocType;
  docTypeLabel: string;
  confidence: number;
  signals: string[];
  totals: {
    chunks: number;
    sections: number;
    pages: number | null;
    words: number;
  };
  entities: {
    failureCodes: EntityHit[];
    channels: EntityHit[];
    durations: EntityHit[];
    amounts: EntityHit[];
    percentages: EntityHit[];
    contacts: string[];
  };
  insights: string[];
}

const DOC_TYPE_LABEL: Record<DocType, string> = {
  'financial-report': 'Laporan keuangan',
  'incident-report': 'SOP / laporan insiden',
  general: 'Dokumen umum',
};

/** Sinyal tipe: skor kata kunci + kepadatan pola numerik. */
const TYPE_SIGNALS: Record<Exclude<DocType, 'general'>, string[]> = {
  'financial-report': [
    'laporan keuangan', 'pendapatan', 'laba', 'rugi', 'neraca', 'revenue', 'profit',
    'arus kas', 'cash flow', 'neraca', 'ekuitas', 'aset', 'liabilitas', 'beban',
    'margin', 'ebitda', 'bruto', 'nett', 'fiskal', 'auditan',
  ],
  'incident-report': [
    'kegagalan', 'gagal', 'insiden', 'incident', 'eskalasi', 'sla', 'sla ',
    'kode kegagalan', 'failure', 'penanganan', 'prosedur', 'troubleshoot',
    'root cause', 'pemulihan', 'rollback', 'komplain', 'pengiriman',
  ],
};

const KNOWN_CHANNELS = [
  'VA Mandiri', 'Virtual Account', 'BCA', 'BNI', 'BRI', 'GoPay', 'OVO', 'DANA',
  'ShopeePay', 'QRIS', 'Kartu Kredit', 'LinkAja', 'Jenius', 'CIMB',
];

/** Kata umum yang tak boleh dihitung sebagai "kode". */
const STOP_TOKENS = new Set([
  'THE', 'AND', 'FOR', 'WITH', 'FROM', 'THIS', 'THAT', 'NOT', 'ALL', 'ANY',
  'SOP', 'PDF', 'CSV', 'SQL', 'API', 'HTTP', 'HTTPS', 'WIB', 'ID', 'RP',
  'STATUS', 'FAILED', 'SUCCESS', 'PENDING', 'EXPIRED', 'REFUNDED', 'TRANSAKSI',
]);

function clean(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Kelompokkan entitas per bagian: hitung frekuensi + bagian teratas. */
function countBySection(
  chunks: DocAnalyticsChunk[],
  matcher: (text: string) => string[],
): EntityHit[] {
  const perEntity = new Map<string, { count: number; sections: Map<string, { count: number; page: number | null }> }>();
  for (const chunk of chunks) {
    const section = (chunk.section ?? '').trim() || 'Tanpa judul bagian';
    const page = chunk.page ?? null;
    for (const label of matcher(chunk.content)) {
      const entry = perEntity.get(label) ?? { count: 0, sections: new Map() };
      entry.count += 1;
      const sec = entry.sections.get(section) ?? { count: 0, page };
      sec.count += 1;
      if (sec.page === null && page !== null) sec.page = page;
      entry.sections.set(section, sec);
      perEntity.set(label, entry);
    }
  }
  return Array.from(perEntity.entries())
    .map(([label, entry]) => {
      const top = Array.from(entry.sections.entries()).sort((a, b) => b[1].count - a[1].count)[0];
      return { label, count: entry.count, topSection: top?.[0] ?? null, topPage: top?.[1].page ?? null };
    })
    .sort((a, b) => b.count - a.count);
}

function regexMatches(text: string, re: RegExp): string[] {
  return text.match(re) ?? [];
}

export function buildDocumentAnalytics(chunks: DocAnalyticsChunk[], sourceName: string): DocAnalytics {
  const corpus = clean(chunks.map((c) => c.content).join(' '));
  const lower = corpus.toLowerCase();
  const pages = chunks.map((c) => c.page).filter((p): p is number => p !== null);
  const sections = new Set(chunks.map((c) => (c.section ?? '').trim() || 'Tanpa judul bagian'));

  // 1. Klasifikasi tipe dokumen: skor kata kunci per tipe (nama sumber ikut dihitung).
  const signals: string[] = [];
  const scores: Record<Exclude<DocType, 'general'>, number> = { 'financial-report': 0, 'incident-report': 0 };
  for (const [type, words] of Object.entries(TYPE_SIGNALS) as Array<[Exclude<DocType, 'general'>, string[]]>) {
    for (const w of words) {
      const hits = lower.split(w).length - 1;
      if (hits > 0) {
        scores[type] += hits;
        if (signals.length < 8) signals.push(w);
      }
    }
  }
  const nameLower = sourceName.toLowerCase();
  if (/laporan|report|keuangan|financial/.test(nameLower)) scores['financial-report'] += 5;
  if (/sop|insiden|incident|kegagalan|failure/.test(nameLower)) scores['incident-report'] += 5;
  // Kepadatan nominal Rp menandai laporan keuangan.
  const rpCount = (corpus.match(/Rp\s?[\d.,]+/gi) ?? []).length;
  scores['financial-report'] += Math.min(10, rpCount);

  const maxScore = Math.max(scores['financial-report'], scores['incident-report']);
  const docType: DocType = maxScore < 4 ? 'general' : scores['financial-report'] >= scores['incident-report'] ? 'financial-report' : 'incident-report';
  const confidence = docType === 'general' ? 0.4 : Math.min(0.95, 0.5 + maxScore / 40);

  // 2. Entitas — ekstraksi regex deterministik.
  const failureCodes = countBySection(chunks, (text) =>
    (text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []).filter((t) => !STOP_TOKENS.has(t)));
  const channels = countBySection(chunks, (text) =>
    KNOWN_CHANNELS.filter((ch) => text.includes(ch)));
  const durations = countBySection(chunks, (text) =>
    regexMatches(text, /\b\d+\s*(?:menit|jam|hari|detik)\b/gi).map((d) => d.toLowerCase()));
  const amounts = countBySection(chunks, (text) =>
    regexMatches(text, /Rp\s?[\d.,]+/gi));
  const percentages = countBySection(chunks, (text) =>
    regexMatches(text, /\b\d+(?:[.,]\d+)?\s?%/g));
  const contacts = Array.from(new Set([
    ...(corpus.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []),
    ...(corpus.match(/\b\d{3,4}[-\s]?\d{4}[-\s]?\d{4}\b/g) ?? []),
  ])).slice(0, 6);

  // 3. Insight deterministik: pernyataan dari angka yang benar-benar dihitung.
  const insights: string[] = [];
  if (docType !== 'general') {
    insights.push(`Dokumen terklasifikasi sebagai ${DOC_TYPE_LABEL[docType].toLowerCase()} (sinyal: ${signals.slice(0, 3).join(', ') || 'nama sumber'}).`);
  }
  if (docType === 'incident-report') {
    if (failureCodes[0]) insights.push(`Istilah "${failureCodes[0].label}" paling sering muncul (${failureCodes[0].count}×), terbanyak di bagian "${failureCodes[0].topSection}"${failureCodes[0].topPage != null ? ` (hlm ${failureCodes[0].topPage})` : ''}.`);
    if (channels[0]) insights.push(`Kanal ${channels[0].label} paling banyak disebut (${channels[0].count}×) — fokus penanganan kemungkinan di kanal ini.`);
    if (durations.length > 0) insights.push(`Terdapat ${durations.length} penyebutan batas waktu (SLA) — contoh: ${durations.slice(0, 3).map((d) => d.label).join(', ')}.`);
    if (contacts.length > 0) insights.push(`Kontak eskalasi teridentifikasi: ${contacts.slice(0, 2).join(', ')}.`);
  }
  if (docType === 'financial-report') {
    if (amounts.length > 0) insights.push(`${amounts.length} penyebutan nominal rupiah — contoh: ${amounts.slice(0, 3).map((a) => a.label).join(', ')}.`);
    if (percentages.length > 0) insights.push(`${percentages.length} penyebutan persentase — contoh: ${percentages.slice(0, 3).map((p) => p.label).join(', ')}.`);
    if (amounts[0]) insights.push(`Nominal "${amounts[0].label}" paling sering muncul (${amounts[0].count}×), terbanyak di bagian "${amounts[0].topSection}".`);
  }
  if (docType === 'general') {
    if (failureCodes[0]) insights.push(`Istilah dominan "${failureCodes[0].label}" muncul ${failureCodes[0].count}×.`);
    if (percentages[0]) insights.push(`Persentase disebut ${percentages.length}× — contoh: ${percentages.slice(0, 3).map((p) => p.label).join(', ')}.`);
  }
  insights.push(`Struktur: ${sections.size} bagian, ${chunks.length} chunk${pages.length > 0 ? `, halaman ${Math.min(...pages)}–${Math.max(...pages)}` : ''}.`);

  return {
    docType,
    docTypeLabel: DOC_TYPE_LABEL[docType],
    confidence,
    signals: signals.slice(0, 6),
    totals: {
      chunks: chunks.length,
      sections: sections.size,
      pages: pages.length > 0 ? Math.max(...pages) : null,
      words: corpus.split(' ').filter(Boolean).length,
    },
    entities: { failureCodes, channels, durations, amounts, percentages, contacts },
    insights,
  };
}
