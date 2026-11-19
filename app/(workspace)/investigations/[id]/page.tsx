'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, FileText, Info } from 'lucide-react';
import type { InvestigationDetailResponse, TemporalPoint } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatPercent, formatDateId, formatDateTimeId } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

function TimelineNode({ p }: { p: TemporalPoint }) {
  return (
    <li className="relative">
      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-tertiary" aria-hidden="true" />
      <span className="font-body text-label-md font-semibold text-on-surface">{p.channelName}</span>
      <span className="ml-2 font-body text-body-sm text-on-surface-variant">{formatDateId(p.date)} · {p.kind}</span>
    </li>
  );
}

export default function InvestigationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useApi<InvestigationDetailResponse>(`/api/investigations/${id}`);

  const backLink = (
    <Link href="/investigations" className="inline-flex items-center gap-1.5 font-body text-label-md text-on-surface-variant hover:text-on-surface focus-ring focus-visible:outline-none">
      <ArrowLeft className="h-4 w-4" /> Kembali ke Investigasi
    </Link>
  );

  if (data.loading) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-8">
        {backLink}
        <div className="mt-6 space-y-3">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-8">
        {backLink}
        <div className="mt-6">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title="Investigasi tidak ditemukan"
            description={data.error}
            action={<Button variant="secondary" onClick={data.retry}>Coba lagi</Button>}
          />
        </div>
      </div>
    );
  }

  const investigation = data.data?.investigation;
  if (!investigation) return null;

  const { question, period, comparison, contribution, temporal, documents, conclusion } = investigation;
  const columns: DataTableColumn<Record<string, string | number | null>>[] = [
    { key: 'channelName', label: 'Kanal' },
    { key: 'failureRate', label: 'Failure rate', align: 'right', format: (v) => formatPercent(v as number) },
    { key: 'baselineFailureRate', label: 'Baseline', align: 'right', format: (v) => formatPercent(v as number) },
    { key: 'excessFailures', label: 'Kelebihan gagal', align: 'right', format: (v) => formatNumber(v as number) },
    { key: 'shareOfExcess', label: 'Pangsa', align: 'right', format: (v) => formatPercent(v as number) },
  ];

  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8">
      {backLink}

      <div>
        <h1 className="font-display text-headline-xl font-bold tracking-tight text-on-surface">{question}</h1>
        <p className="mt-0.5 font-body text-body-md text-on-surface-variant">
          {period.label} · {formatDateTimeId(investigation.createdAt)}
        </p>
      </div>

      {/* Kesimpulan */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Kesimpulan</p>
        <p className="mt-1 font-body text-body-lg leading-relaxed text-on-surface">{conclusion.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-container-low px-1.5 py-0.5 font-body text-body-sm text-on-surface-variant">
            <Info className="h-3 w-3" /> Klasifikasi: {conclusion.claimLevel}
          </span>
          {conclusion.caveats.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-sm bg-surface-container-low px-1.5 py-0.5 font-body text-body-sm text-on-surface-variant">
              <AlertTriangle className="h-3 w-3 text-tertiary" /> {c}
            </span>
          ))}
        </div>
      </div>

      {/* Metrik pendukung */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Failure rate</p>
          <p className="mt-1 font-display text-metric-lg font-bold tabular text-on-surface">{formatPercent(comparison.failureRate.current)}</p>
          <p className="font-body text-body-sm text-on-surface-variant">vs {formatPercent(comparison.failureRate.previous)} · {formatPercent(comparison.failureRate.deltaPctPoints)} poin</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Total transaksi</p>
          <p className="mt-1 font-display text-metric-lg font-bold tabular text-on-surface">{formatNumber(comparison.total.current)}</p>
          <p className="font-body text-body-sm text-on-surface-variant">
            vs {formatNumber(comparison.total.previous)} · {comparison.total.changePct != null ? `${comparison.total.changePct > 0 ? '+' : ''}${comparison.total.changePct.toFixed(1)}%` : 'n/a'}
          </p>
        </div>
      </div>

      {/* Kontribusi kanal */}
      <div>
        <h2 className="mb-2 font-display text-headline-sm font-semibold text-on-surface">Kontribusi kanal</h2>
        <DataTable columns={columns} rows={contribution.channels as unknown as Record<string, any>[]} />
      </div>

      {/* Timeline */}
      <div>
        <h2 className="mb-2 font-display text-headline-sm font-semibold text-on-surface">Timeline</h2>
        {temporal.points.length === 0 ? (
          <p className="font-body text-body-md text-on-surface-variant">Tidak ada titik temporal.</p>
        ) : (
          <ol className="space-y-2 border-l-2 border-outline-variant pl-4">
            {temporal.points.map((p, i) => <TimelineNode key={`${p.channelName}-${p.date}-${i}`} p={p} />)}
          </ol>
        )}
        {temporal.notes.length > 0 && (
          <p className="mt-2 font-body text-body-sm text-on-surface-variant">{temporal.notes.join(' ')}</p>
        )}
      </div>

      {/* Dokumen */}
      {documents.length > 0 && (
        <div>
          <h2 className="mb-2 font-display text-headline-sm font-semibold text-on-surface">Kutipan dokumen</h2>
          <div className="space-y-2">
            {documents.map((d, i) => (
              <div key={`${d.sourceId}-${i}`} className="rounded-lg bg-surface-container-low p-3">
                <p className="flex items-center gap-2 font-body text-label-md font-semibold text-on-surface">
                  <FileText className="h-3.5 w-3.5 text-tertiary" /> {d.docTitle ?? d.sourceId}
                  {d.section && <span className="text-on-surface-variant">· {d.section}</span>}
                </p>
                {d.quote && <p className="mt-1 font-body text-body-sm italic text-on-surface-variant">“{d.quote}”</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SQL */}
      {investigation.evidence.sql.length > 0 && (
        <div>
          <h2 className="mb-2 font-display text-headline-sm font-semibold text-on-surface">Query SQL</h2>
          {investigation.evidence.sql.map((q, i) => (
            <pre key={i} className="mb-2 overflow-x-auto rounded-md bg-inverse-surface p-3 font-mono text-[12.5px] leading-5 text-inverse-on-surface" aria-label="Query SQL">{q}</pre>
          ))}
        </div>
      )}

      {/* Langkah berikutnya */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="mb-2 font-display text-headline-sm font-semibold text-on-surface">Langkah berikutnya</h2>
        <ul className="space-y-1.5">
          {[
            'Eskalasi titik perubahan ke kepala operasi terkait.',
            'Cek apakah threshold eskalasi SOP terlampau pada kanal terdampak.',
            'Simpan investigasi untuk audit.',
          ].map((text) => (
            <li key={text} className="flex items-start gap-2 font-body text-body-md text-on-surface">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
