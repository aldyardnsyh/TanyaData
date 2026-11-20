'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import type { ReportDetailResponse, ReportMetric } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatDateId, formatDateTimeId, formatIdr, formatPercent } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { VisualizationView } from '@/components/chat/visualization-view';

function fmtMetric(m: ReportMetric): string {
  if (m.value === null) return '—';
  if (m.format === 'currency') return formatIdr(m.value);
  if (m.format === 'percent') return formatPercent(m.value);
  if (m.format === 'number') return formatNumber(m.value);
  return String(m.value);
}

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useApi<ReportDetailResponse>(`/api/reports/${id}`);

  const backLink = (
    <Link href="/reports" className="inline-flex items-center gap-1.5 font-body text-label-md text-on-surface-variant hover:text-on-surface focus-ring">
      <ArrowLeft className="h-4 w-4" /> Kembali ke Laporan
    </Link>
  );

  if (data.loading) {
    return (
      <div className="mx-auto max-w-[760px] px-6 py-8">
        {backLink}
        <div className="mt-6 space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (data.error || !data.data) {
    return (
      <div className="mx-auto max-w-[760px] px-6 py-8">
        {backLink}
        <div className="mt-6">
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="Laporan tidak ditemukan"
            description={data.error ?? undefined}
            action={<Button variant="secondary" onClick={data.retry}>Coba lagi</Button>}
          />
        </div>
      </div>
    );
  }

  const report = data.data.report;
  const table = report.supportingTable;
  const columns: DataTableColumn<Record<string, string | number | null>>[] = table
    ? table.columns.map((c) => ({
        key: c.key,
        label: c.label,
        align: c.align,
        format: (v) => {
          if (v === null || v === undefined) return '—';
          if (c.format === 'currency') return formatIdr(v as number);
          if (c.format === 'percent') return formatPercent(v as number);
          if (c.format === 'number') return formatNumber(v as number);
          return String(v);
        },
      }))
    : [];

  return (
    <div className="px-6 py-8">
      <div className="mx-auto mb-4 max-w-[760px] print-no-print">{backLink}</div>

      {/* Toolbar */}
      <div className="sticky top-14 z-sticky mx-auto mb-6 flex max-w-[760px] flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3 print-no-print">
        <span className="truncate font-body text-label-md font-semibold text-on-surface">{report.title}</span>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/reports/${id}/export?format=csv`} download>
            <Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5" /> Ekspor CSV</Button>
          </a>
          <a href={`/api/reports/${id}/export?format=pdf`} download>
            <Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5" /> Ekspor PDF</Button>
          </a>
        </div>
      </div>

      {/* Dokumen */}
      <article className="mx-auto max-w-[760px] rounded-xl border border-outline-variant bg-surface-container-lowest p-10 print-document">
        <p className="font-body text-label-sm uppercase tracking-widest text-primary">Laporan</p>
        <h1 className="mt-1 font-display text-headline-lg font-bold tracking-tight text-on-surface">{report.title}</h1>
        <div className="mt-3 flex flex-wrap gap-4 font-body text-body-sm text-on-surface-variant">
          <span><strong>Periode:</strong> {report.period ? formatDateId(report.period.start) + ' – ' + formatDateId(report.period.end) : '—'}</span>
          <span><strong>Dibuat:</strong> {formatDateTimeId(report.createdAt)}</span>
          <span><strong>Sumber:</strong> {report.dataset.name}</span>
        </div>

        <section className="mt-8">
          <h2 className="font-display text-headline-sm font-semibold text-on-surface">Ringkasan Eksekutif</h2>
          <p className="mt-2 font-body text-body-lg leading-relaxed text-on-surface">{report.summary}</p>
        </section>

        {report.metrics.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">01 · Metrik utama</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {report.metrics.map((m) => (
                <div key={m.key} className="rounded-lg bg-surface-container-low p-3">
                  <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">{m.label}</p>
                  <p className="mt-1 font-display text-metric-md font-bold tabular text-on-surface">{fmtMetric(m)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {table && table.rows.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">02 · Data pendukung</h2>
            <div className="mt-3">
              <DataTable columns={columns} rows={table.rows} />
            </div>
          </section>
        )}

        {report.keyFindings.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">03 · Temuan utama</h2>
            <ul className="mt-3 space-y-2">
              {report.keyFindings.map((k, i) => (
                <li key={i} className="flex items-start gap-2 font-body text-body-md text-on-surface">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> {k.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.visualizations.length > 0 && (
          <section className="mt-8 space-y-4">
            {report.visualizations.map((v) => <VisualizationView key={v.id} viz={v} />)}
          </section>
        )}

        {report.sources.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">Bukti</h2>
            <ul className="mt-3 space-y-2">
              {report.sources.map((s, i) => (
                <li key={`${s.sourceId}-${i}`} className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">
                  <span className="font-semibold text-on-surface">{s.kind === 'document' ? (s.docTitle ?? s.sourceId) : (s.table ?? s.sourceId)}</span>
                  {s.section && ` · ${s.section}`}
                  {s.page && ` · hlm ${s.page}`}
                  {s.quote && <p className="mt-1 italic">“{s.quote}”</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.sql.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">Query SQL</h2>
            {report.sql.map((q, i) => (
              <pre key={i} className="mt-2 overflow-x-auto rounded-md bg-inverse-surface p-3 font-mono text-[12.5px] leading-5 text-inverse-on-surface" aria-label="Query SQL">{q.query}</pre>
            ))}
          </section>
        )}

        <footer className="mt-10 border-t border-outline-variant pt-4 font-body text-body-sm text-on-surface-variant">
          Dibuat oleh TanyaData · {formatDateId(report.createdAt.slice(0, 10))}
        </footer>
      </article>

      <p className="mx-auto mt-4 max-w-[760px] font-body text-body-sm text-on-surface-variant print-no-print">
        Ekspor memakai snapshot laporan; angka tidak dihitung ulang.
      </p>
    </div>
  );
}
