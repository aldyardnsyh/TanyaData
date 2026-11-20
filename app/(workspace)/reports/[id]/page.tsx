'use client';

import { use } from 'react';
import Link from 'next/link';
import type { ReportDetailResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { ReportDocument } from '@/components/reports/report-document';
import { Skeleton } from '@/components/ui/skeleton';

/** Material Symbols self-hosted; dekoratif → aria-hidden (blueprint §2). */
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useApi<ReportDetailResponse>(`/api/reports/${id}`);
  const settings = useApi<SettingsResponse>('/api/settings');

  return (
    <div className="p-space-lg max-w-[1520px] mx-auto w-full flex flex-col gap-space-lg">
      {/* Top Executive Action Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
        <div className="flex flex-col">
          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline">Intelligence Operations</span>
            <span className="text-outline">/</span>
            <span className="font-label-sm text-label-sm text-primary font-bold uppercase tracking-wider">Report Detail</span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight mt-0.5">Report Preview</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Printable analytical memorandum.</p>
        </div>
        <div className="flex items-center gap-space-sm self-start lg:self-center flex-wrap">
          <Link
            href="/reports"
            className="h-9 px-space-md rounded bg-surface-container-lowest text-on-surface hover:bg-surface-container font-label-md text-label-md flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Icon name="arrow_back" className="text-[18px]" />
            <span>Back to Reports</span>
          </Link>
          <a
            href={`/api/reports/${id}/export?format=csv`}
            download
            className="h-9 px-space-md rounded bg-surface-container-high text-on-surface hover:bg-surface-container font-label-md text-label-md flex items-center gap-1.5 transition-colors"
          >
            <Icon name="csv" className="text-[18px] text-outline" />
            <span>Export CSV</span>
          </a>
          <a
            href={`/api/reports/${id}/export?format=pdf`}
            download
            className="h-9 px-space-md rounded bg-primary-container text-on-primary hover:bg-primary font-label-md text-label-md flex items-center gap-2 transition-all shadow-sm"
          >
            <Icon name="picture_as_pdf" className="text-[18px]" />
            <span>Download PDF</span>
          </a>
        </div>
      </div>

      {data.loading ? (
        <div className="bg-surface-container-lowest rounded-xl shadow-md p-6 sm:p-10 flex flex-col gap-8 max-w-[1020px] mx-auto w-full">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : data.error || !data.data ? (
        <div className="bg-surface-container-lowest rounded-xl shadow-md p-6 sm:p-10 flex flex-col gap-3 max-w-[1020px] mx-auto w-full">
          <p className="font-headline-sm text-headline-sm text-on-surface">Report not found</p>
          <p className="font-body-md text-body-md text-on-surface-variant">{data.error ?? 'The requested report is unavailable.'}</p>
          <Link href="/reports" className="text-primary font-label-md text-label-md font-semibold hover:underline">Back to Reports</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-space-sm relative">
          {/* Section Meta & Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Document Stage</span>
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="font-label-md text-label-md font-semibold text-on-surface">Formal Printable Preview</span>
            </div>
            <div className="flex items-center gap-space-sm">
              <span className="font-label-sm text-label-sm text-outline font-mono">A4 Canvas • 100% Scale</span>
              <button
                type="button"
                onClick={() => window.print()}
                className="h-7 px-2.5 rounded bg-surface-container-lowest text-on-surface hover:bg-surface-container font-label-sm text-label-sm flex items-center gap-1 shadow-xs"
              >
                <Icon name="print" className="text-[15px]" />
                <span>Print Sheet</span>
              </button>
            </div>
          </div>

          <ReportDocument
            report={data.data.report}
            profileName={settings.data?.profile.name ?? ''}
            profileRole={settings.data?.profile.role ?? ''}
          />
        </div>
      )}
    </div>
  );
}
