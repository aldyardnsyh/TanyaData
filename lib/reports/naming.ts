import type { ReportDetail } from '@/lib/contracts/http';

export type ReportExportFormat = 'csv' | 'pdf' | 'xlsx';

export function slugifyReportTitle(title: string): string {
  return String(title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export function reportFileName(
  report: Pick<ReportDetail, 'id' | 'title' | 'period' | 'createdAt'>,
  format: ReportExportFormat,
): string {
  const slug = slugifyReportTitle(report.title) || 'laporan';
  const period = report.period
    ? `${report.period.start}_${report.period.end}`
    : String(report.createdAt ?? '').slice(0, 10);
  const suffix = String(report.id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || '0';
  return `tanyadata_${slug}_${period || 'tanpa-tanggal'}_${suffix}.${format}`;
}
