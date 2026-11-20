'use client';

import { use } from 'react';
import Link from 'next/link';
import type { ReportDetailResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ReportDocument } from '@/components/reports/report-document';

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useApi<ReportDetailResponse>(`/api/reports/${id}`);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Pratinjau laporan"
        subtitle="Dokumen analitik yang dapat dicetak."
        meta={data.data?.report ? `ID · ${data.data.report.id}` : undefined}
        actions={
          <>
            <Link href="/reports" className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-control bg-surface px-3 font-body text-label-md font-semibold text-ink transition-colors hover:border-primary focus-ring"><Icon name="arrow_back" className="text-[16px]" aria-hidden="true" /> Kembali</Link>
            <a href={`/api/reports/${id}/export?format=csv`} download className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-control bg-surface px-3 font-body text-label-md font-semibold text-ink transition-colors hover:border-primary focus-ring"><Icon name="download" className="text-[16px]" aria-hidden="true" /> Ekspor CSV</a>
            <a href={`/api/reports/${id}/export?format=pdf`} download className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary transition-colors hover:bg-[#0A3A2C] focus-ring-forest"><Icon name="picture_as_pdf" className="text-[16px]" aria-hidden="true" /> Unduh PDF</a>
          </>
        }
      />

      {data.loading ? (
        <div className="mx-auto flex w-full max-w-[1020px] flex-col gap-8 rounded-card border border-border-hairline bg-surface p-6 sm:p-10"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>
      ) : data.error || !data.data ? (
        <EmptyState title="Laporan tidak ditemukan" description={data.error ?? 'Laporan yang diminta tidak tersedia.'} action={<Link href="/reports" className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary focus-ring-forest">Kembali ke Laporan</Link>} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><MonoMeta>PRATINJAU DOKUMEN</MonoMeta><span className="state-dot" aria-hidden="true" /><span className="font-body text-body-md font-semibold text-ink">Pratinjau cetak</span></div>
            <div className="flex items-center gap-2"><MonoMeta>A4 · 100%</MonoMeta><button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-control px-3 font-body text-label-md text-ink transition-colors hover:border-primary focus-ring"><Icon name="print" className="text-[16px]" aria-hidden="true" /> Cetak</button></div>
          </div>
          <ReportDocument report={data.data.report} profileName="" profileRole="" />
        </div>
      )}
    </div>
  );
}
