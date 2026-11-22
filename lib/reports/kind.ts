import type { ReportDetail } from '@/lib/contracts/http';

/**
 * Jenis laporan — menentukan template cetak/PDF. Klasifikasi deterministik
 * dari isi snapshot: ada sitasi dokumen → riset dokumen (bukti-forward);
 * selainnya → analitik data (metrik-forward). Laporan hybrid (ada keduanya)
 * mengikuti sumber dominan: sitasi dokumen lebih spesifik, jadi menang.
 */
export type ReportKind = 'data-analytics' | 'document-research';

export function reportKind(report: ReportDetail): ReportKind {
  return report.sources.some((source) => source.kind === 'document')
    ? 'document-research'
    : 'data-analytics';
}

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  'data-analytics': 'LAPORAN ANALITIK DATA',
  'document-research': 'LAPORAN RISET DOKUMEN',
};

export const REPORT_KIND_DESC: Record<ReportKind, string> = {
  'data-analytics': 'Dihitung dari data transaksi melalui SQL terverifikasi.',
  'document-research': 'Ditarik dari isi dokumen terindeks dengan kutipan asli.',
};

/**
 * Insight deterministik dari angka yang ADA di snapshot — bukan karangan
 * model. Dipakai di dokumen cetak dan PDF agar laporan lebih insightful.
 */
export function reportInsights(report: ReportDetail): string[] {
  const insights: string[] = [];

  // Konsentrasi kontributor teratas dari visualisasi bar (mis. kanal).
  const barViz = report.visualizations.find((viz) => viz.type === 'bar');
  if (barViz?.rows.length) {
    const key = barViz.dataKey ?? 'value';
    const labelKey = barViz.xKey ?? 'label';
    const values = barViz.rows.map((row) => Number(row[key]) || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    const maxIndex = values.indexOf(Math.max(...values));
    if (total > 0 && maxIndex >= 0) {
      const share = Math.round((values[maxIndex] / total) * 100);
      const label = String(barViz.rows[maxIndex][labelKey] ?? 'kontributor teratas');
      insights.push(
        `${label} adalah kontributor terbesar dengan pangsa ${share}% dari total keseluruhan.`,
      );
    }
  }

  // Cakupan bukti untuk laporan riset dokumen.
  const docSources = report.sources.filter((source) => source.kind === 'document' && source.quote);
  if (docSources.length) {
    const sections = new Set(docSources.map((source) => source.section).filter(Boolean));
    const pages = docSources.map((source) => source.page).filter((page): page is number => page != null);
    const pageSpan = pages.length ? `hlm ${Math.min(...pages)}–${Math.max(...pages)}` : 'rentang halaman tidak tercatat';
    insights.push(
      `Ringkasan didukung ${docSources.length} kutipan asli dari ${sections.size || 'beberapa'} bagian dokumen (${pageSpan}).`,
    );
  }

  if (report.keyFindings.length) {
    insights.push(`${report.keyFindings.length} temuan utama teridentifikasi pada snapshot ini.`);
  }

  return insights.slice(0, 3);
}
