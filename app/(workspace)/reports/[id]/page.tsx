'use client';

import { use } from 'react';
import Link from 'next/link';
import type { ReportDetailResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { apiUrl } from '@/lib/ui/api-base';
import { Icon } from '@/components/ui/icons';
import { PageHeading } from '@/components/signal/page-heading';
import { StatusBadge } from '@/components/signal/status-badge';
import { ReportDocument } from '@/components/reports/report-document';

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useApi<ReportDetailResponse>(`/api/reports/${id}`);

  return (
    <div className="page-container py-s5">
      <div className="print-no-print">
        <PageHeading
          title="Pratinjau laporan"
          caption="Dokumen analitik yang dapat dicetak dari snapshot."
          meta={data.data?.report ? `ID · ${data.data.report.id}` : undefined}
          actions={
            <>
              <Link href="/reports" className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="arrow_back" className="text-[16px]" /> Kembali</Link>
              <a href={apiUrl(`/api/reports/${id}/export?format=csv`)} download className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="download" className="text-[16px]" /> Ekspor CSV</a>
              <a href={apiUrl(`/api/reports/${id}/export?format=xlsx`)} download className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="table_chart" className="text-[16px]" /> Ekspor XLSX</a>
              <a href={apiUrl(`/api/reports/${id}/export?format=pdf`)} download className="touch-44 inline-flex items-center gap-s2 rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring"><Icon name="picture_as_pdf" className="text-[16px]" /> Unduh PDF</a>
            </>
          }
        />
      </div>

      {data.loading ? (
        <div className="mx-auto flex w-full max-w-[1020px] flex-col gap-s5 rounded-surface border border-[var(--border-hairline)] bg-porcelain p-s5" aria-busy="true"><div className="skeleton h-s6 w-2/3" /><div className="skeleton h-24 w-full" /><div className="skeleton h-48 w-full" /></div>
      ) : data.error || !data.data ? (
        <div className="surface flex flex-col items-start gap-s2 p-s4">
          <StatusBadge label="Tidak ditemukan" tone="error" />
          <p className="font-body text-body text-ink">{data.error ?? 'Laporan yang diminta tidak tersedia.'}</p>
          <Link href="/reports" className="touch-44 inline-flex items-center rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring">Kembali ke Laporan</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-s3">
          <div className="print-no-print flex flex-wrap items-center justify-between gap-s2">
            <div className="flex items-center gap-s2"><span className="mono-meta">PRATINJAU DOKUMEN</span><span className="state-dot" aria-hidden="true" /><span className="font-body text-body font-semibold text-ink">Pratinjau cetak</span></div>
            <div className="flex items-center gap-s2"><span className="mono-meta">A4 · 100%</span><button type="button" onClick={() => window.print()} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="print" className="text-[16px]" /> Cetak</button></div>
          </div>
          <ReportDocument report={data.data.report} profileName="" profileRole="" />
        </div>
      )}
    </div>
  );
}
