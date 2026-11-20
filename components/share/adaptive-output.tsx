'use client';

import { KpiCard } from '@/components/ui/kpi-card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { MonoMeta } from '@/components/ui/mono-meta';
import { toast } from '@/components/ui/toaster';
import { formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import type { ShareCitation, ShareOutput } from '@/lib/ui/share-contract';
import { AnnotatedText, CitationMarker } from './share-citations';

type Row = Record<string, string | number | null>;

function formatCell(value: string | number | null, format?: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (format === 'currency') return formatIdr(value);
  if (format === 'percent') return formatPercent(value);
  if (format === 'number') return formatNumber(value);
  return String(value);
}

function OutputFrame({ title, meta, children }: { title: string | null; meta: string | null; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-card border border-border-hairline bg-surface p-4 sm:p-5">
      {title && <h3 className="mb-3 font-body text-headline-sm text-ink">{title}</h3>}
      {children}
      {meta && <div className="mt-4"><MonoMeta>{meta}</MonoMeta></div>}
    </div>
  );
}

function EmptyOutput({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-border-hairline bg-surface p-5">
      <p className="font-body text-body-md text-ink-muted-strong">{message}</p>
    </div>
  );
}

/**
 * Section 4: sembilan tipe output adaptif (ADAPTIVE_OUTPUT_SPEC §2).
 * Angka hanya dari `output.rows` / `output.value` (result_json). Count-up kpi
 * dimatikan di share karena snapshot tidak berubah (SHARE_PAGE_SPEC §2.4).
 */
export function ShareOutputView({
  output,
  citations,
  includeCitations,
}: {
  output: ShareOutput;
  citations: ShareCitation[];
  includeCitations: boolean;
}) {
  const meta = [output.source, output.period].filter(Boolean).join(' · ') || null;
  const columns = output.columns.length > 0
    ? output.columns
    : Object.keys(output.rows[0] ?? {}).map((key) => ({ key, label: key, align: 'left' as const, format: 'text' as const }));

  if (output.type === 'kpi') {
    return (
      <KpiCard
        label={output.title ?? 'Metrik'}
        value={output.value}
        format={output.format}
        meta={meta ?? undefined}
        note={output.notes[0]}
        animateCount={false}
      />
    );
  }

  if (output.type === 'table') {
    if (output.rows.length === 0) return <EmptyOutput message="Tidak ada baris pada snapshot ini." />;
    const tableColumns: DataTableColumn<Row>[] = columns.map((column) => ({
      key: column.key,
      label: column.label,
      align: column.align,
      format: (value) => formatCell(value as string | number | null, column.format),
    }));
    return (
      <OutputFrame title={output.title} meta={meta}>
        <DataTable columns={tableColumns} rows={output.rows} stickyHeader emptyTitle="Tidak ada baris pada snapshot ini." />
      </OutputFrame>
    );
  }

  if (output.type === 'line' || output.type === 'bar' || output.type === 'donut') {
    if (output.rows.length === 0) return <EmptyOutput message="Tidak ada data pada periode snapshot ini." />;
    // Chart lama diserap ke BentoGrid/TimelineView (UI_REFACTOR_DESIGN §7.3).
    // Sampai renderer adaptif Batch 2, angka tetap tampil penuh sebagai tabel
    // dari result_json. Tidak ada angka yang dihitung ulang di komponen ini.
    const tableColumns: DataTableColumn<Row>[] = columns.map((column) => ({
      key: column.key,
      label: column.label,
      align: column.align,
      format: (value) => formatCell(value as string | number | null, column.format),
    }));
    return (
      <OutputFrame title={output.title} meta={meta}>
        <DataTable columns={tableColumns} rows={output.rows} stickyHeader emptyTitle="Tidak ada data pada snapshot ini." />
      </OutputFrame>
    );
  }

  if (output.type === 'quote') {
    const copy = async () => {
      const text = [output.chapter, output.article, ...output.verses].filter(Boolean).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        toast({ status: 'success', message: 'Kutipan disalin.' });
      } catch {
        toast({ status: 'error', message: 'Kutipan gagal disalin.' });
      }
    };
    return (
      <blockquote className="min-w-0 rounded-card border border-border-hairline bg-surface p-4 sm:p-5">
        {output.chapter && <p className="font-body text-label-sm uppercase text-ink-muted-strong">{output.chapter}</p>}
        {output.article && <h3 className="mt-1 font-display text-headline-sm text-ink">{output.article}</h3>}
        <div className="mt-3 space-y-3 rounded-card border border-border-hairline bg-canvas p-4">
          {output.verses.length > 0 ? output.verses.map((verse, index) => (
            <p key={index} className="font-body text-body-lg leading-relaxed text-ink">
              <AnnotatedText text={verse} citations={citations} includeCitations={includeCitations} />
            </p>
          )) : (
            <p className="font-body text-body-md text-ink-muted-strong">Ayat tidak tersedia pada snapshot ini.</p>
          )}
        </div>
        <div className="measurement-rule-share mt-4" aria-hidden="true" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <MonoMeta>{meta ?? 'SUMBER DOKUMEN'}</MonoMeta>
          <button type="button" onClick={() => void copy()} className="inline-flex min-h-11 items-center rounded-control border border-border-control px-3 font-body text-label-md font-semibold text-ink transition-colors hover:border-primary focus-ring">
            Salin kutipan
          </button>
        </div>
      </blockquote>
    );
  }

  if (output.type === 'timeline') {
    if (output.events.length === 0) return <EmptyOutput message="Tidak ada kejadian bertanggal pada snapshot ini." />;
    return (
      <OutputFrame title={output.title} meta={meta}>
        <ol className="relative ml-2 border-l border-border-hairline pl-6">
          {output.events.map((event, index) => {
            const citation = citations.find((item) => item.id === event.citationId);
            return (
              <li key={`${event.date}-${index}`} className="relative pb-6 last:pb-0">
                <span className="absolute -left-[31px] top-1 state-dot" aria-hidden="true" />
                <time dateTime={event.date} className="mono-meta block">{event.date}</time>
                <p className="mt-1 font-body text-headline-sm text-ink">{event.label}</p>
                {event.evidence && <p className="mt-1 font-body text-body-md text-ink-muted-strong">{event.evidence}</p>}
                {citation && includeCitations && <div className="mt-1"><CitationMarker citation={citation} /></div>}
              </li>
            );
          })}
        </ol>
      </OutputFrame>
    );
  }

  if (output.type === 'parameter_report') {
    if (output.parameters.length === 0) return <EmptyOutput message="Parameter tidak terbaca dari sumber pada snapshot ini." />;
    return (
      <OutputFrame title={output.title} meta={meta}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-canvas">
                {['Parameter', 'Nilai', 'Satuan', 'Status', 'Halaman', 'Catatan'].map((header) => (
                  <th key={header} scope="col" className="whitespace-nowrap px-3 py-3 font-body text-label-sm uppercase text-ink-muted-strong">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {output.parameters.map((parameter, index) => (
                <tr key={`${parameter.name}-${index}`} className="border-b border-border-hairline last:border-b-0">
                  <th scope="row" className="px-3 py-3 font-body text-body-md font-semibold text-ink">{parameter.name}</th>
                  <td className="px-3 py-3 font-body text-body-md tabular text-ink">{formatCell(parameter.value)}</td>
                  <td className="px-3 py-3 font-body text-body-md text-ink">{parameter.unit ?? 'Satuan tidak tersedia'}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex min-h-11 items-center gap-2">
                      <span className={`state-dot ${parameter.status === 'alert' ? 'state-dot-error' : ''}`} aria-hidden="true" />
                      <span className={`font-body text-body-sm ${parameter.status === 'alert' ? 'text-error-text' : 'text-ink-muted-strong'}`}>
                        {parameter.status === 'alert' ? 'Alert' : 'Normal'}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3"><MonoMeta>{parameter.page != null ? `halaman ${parameter.page}` : '—'}</MonoMeta></td>
                  <td className="px-3 py-3 font-body text-body-sm text-ink-muted-strong">{parameter.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {output.notes.length > 0 && (
          <div className="mt-3 space-y-1">
            {output.notes.map((note, index) => <p key={index} className="font-body text-body-sm text-ink-muted-strong">Catatan: {note}</p>)}
          </div>
        )}
      </OutputFrame>
    );
  }

  // none: paragraf naratif + sitasi inline. Tanpa kartu kosong atau skeleton.
  const text = output.text ?? 'Informasi ini tidak ditemukan pada sumber yang tersedia.';
  return (
    <div className="min-w-0 rounded-card border border-border-hairline bg-surface p-4 sm:p-5">
      <p className="max-w-[72ch] font-body text-body-lg leading-relaxed text-ink">
        <AnnotatedText text={text} citations={citations} includeCitations={includeCitations} />
      </p>
      {output.keywords.length > 0 && (
        <p className="mt-3 font-body text-body-sm text-ink-muted-strong">
          Kata kunci yang dicoba: {output.keywords.join(', ')}
        </p>
      )}
    </div>
  );
}
