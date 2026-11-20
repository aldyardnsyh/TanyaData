'use client';

import { useState } from 'react';
import { formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import { StatusDot } from './status-dot';
import { TimelineView, type TimelineNode } from './timeline-view';
import type { ShareOutput } from '@/lib/ui/share-contract';

/**
 * Renderer 9 tipe output adaptif (ADAPTIVE_OUTPUT_SPEC §2 / SHARE_PAGE_SPEC §2.4).
 * Purpose Gate: bentuk jawaban mengikuti datanya. Angka hanya dari `rows`/`value`
 * yang berasal dari result_json. `readOnly` mematikan aksi mutasi di share.
 * Motion: entrance 120ms opacity only; tanpa count-up, tanpa stagger per baris.
 */
export interface AdaptiveOutputViewProps {
  outputs: ShareOutput[];
  state?: 'default' | 'loading' | 'empty' | 'error';
  readOnly?: boolean;
  onOpenCitation?: (id: string) => void;
  errorTitle?: string;
  onRetry?: () => void;
  className?: string;
}

function formatValue(value: string | number | null, format: ShareOutput['format']): string {
  if (value === null || value === undefined || value === '') return 'Belum dihitung';
  const n = typeof value === 'number' ? value : Number(value.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return String(value);
  if (format === 'currency') return formatIdr(n);
  if (format === 'percent') return formatPercent(n);
  return formatNumber(n);
}

function Meta({ output }: { output: ShareOutput }) {
  if (!output.source && !output.period) return null;
  return <p className="mono-meta mt-s2">{[output.source, output.period].filter(Boolean).join(' · ')}</p>;
}

function KpiBlock({ output }: { output: ShareOutput }) {
  return (
    <div className="surface flex flex-col justify-between gap-s2 p-s4">
      <p className="font-display text-label font-semibold text-ink">{output.title ?? 'Metrik'}</p>
      <div>
        <p className="font-body text-metric tabular text-ink">{formatValue(output.value, output.format)}</p>
        <Meta output={output} />
      </div>
    </div>
  );
}

function TableBlock({ output }: { output: ShareOutput }) {
  return (
    <div className="surface overflow-hidden">
      {output.title && <p className="border-b border-[var(--border-hairline)] p-s3 font-display text-label font-semibold text-ink">{output.title}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{output.title ?? 'Tabel data'}</caption>
          <thead>
            <tr className="bg-forest-08">
              {output.columns.map((col) => (
                <th key={col.key} scope="col" className={`whitespace-nowrap px-s3 py-s2 font-body text-caption text-ink-72 ${col.align === 'right' ? 'text-right' : ''}`}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {output.rows.map((row, i) => (
              <tr key={i} className="border-t border-[var(--border-hairline)]">
                {output.columns.map((col, ci) => (
                  <td key={col.key} className={`min-h-11 px-s3 py-s2 font-body text-caption text-ink ${col.align === 'right' ? 'text-right tabular' : ''} ${ci === 0 ? 'font-semibold' : ''}`}>
                    {formatValue(row[col.key] as string | number | null, col.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--border-hairline)] px-s3 py-s2"><span className="mono-meta">{output.rows.length} BARIS</span></div>
      <Meta output={output} />
    </div>
  );
}

function BarBlock({ output }: { output: ShareOutput }) {
  const key = output.series[0]?.key ?? Object.keys(output.rows[0] ?? {})[1] ?? 'value';
  const rows = [...output.rows].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0));
  const max = Math.max(1, ...rows.map((r) => Number(r[key] ?? 0)));
  return (
    <div className="surface p-s4">
      <p className="font-display text-label font-semibold text-ink">{output.title ?? 'Perbandingan'}</p>
      <div className="mt-s3 space-y-s2">
        {rows.map((row, i) => (
          <div key={i}>
            <div className="mb-s1 flex items-center justify-between gap-s2 font-body text-caption">
              <span className="min-w-0 truncate text-ink">{String(row[output.xKey] ?? `Baris ${i + 1}`)}</span>
              <span className="tabular text-ink">{formatValue(row[key] as number, output.format)}</span>
            </div>
            <div className="h-s2 w-full overflow-hidden rounded-control bg-forest-08">
              <div className="h-full bg-forest" style={{ width: `${(Number(row[key] ?? 0) / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <table className="sr-only"><caption>{output.title ?? 'Perbandingan'}</caption><tbody>{rows.map((r, i) => <tr key={i}><td>{String(r[output.xKey] ?? '')}</td><td>{String(r[key] ?? '')}</td></tr>)}</tbody></table>
      <Meta output={output} />
    </div>
  );
}

function LineBlock({ output }: { output: ShareOutput }) {
  const key = output.series[0]?.key ?? Object.keys(output.rows[0] ?? {})[1] ?? 'value';
  const [active, setActive] = useState<number | null>(null);
  const rows = output.rows;
  const max = Math.max(1, ...rows.map((r) => Number(r[key] ?? 0)));
  const path = rows.map((r, i) => {
    const x = rows.length > 1 ? (i / (rows.length - 1)) * 1000 : 0;
    const y = 180 - (Number(r[key] ?? 0) / max) * 150;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="surface p-s4">
      <p className="font-display text-label font-semibold text-ink">{output.title ?? 'Tren'}</p>
      <div className="relative mt-s3 h-48">
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={output.title ?? 'Grafik tren'}>
          {[40, 90, 140].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="var(--border-hairline)" strokeWidth="1" strokeDasharray="2 2" />)}
          {path && <path d={path} fill="none" stroke="var(--color-forest)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
          {active !== null && rows[active] && (
            <circle cx={rows.length > 1 ? (active / (rows.length - 1)) * 1000 : 0} cy={180 - (Number(rows[active][key] ?? 0) / max) * 150} r="5" fill="var(--color-forest)" />
          )}
        </svg>
        {rows.map((r, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${String(r[output.xKey] ?? '')}: ${formatValue(r[key] as number, output.format)}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="absolute top-0 h-full w-px opacity-0 focus-ring"
            style={{ left: `${rows.length > 1 ? (i / (rows.length - 1)) * 100 : 0}%` }}
          />
        ))}
      </div>
      <div className="mt-s2 flex justify-between font-body text-caption text-ink-72">
        {[0, 0.5, 1].map((f) => { const i = rows.length ? Math.min(rows.length - 1, Math.round(f * (rows.length - 1))) : -1; return <span key={f}>{i >= 0 ? String(rows[i][output.xKey] ?? '') : '—'}</span>; })}
      </div>
      <table className="sr-only"><caption>{output.title ?? 'Tren'}</caption><thead><tr><th>Periode</th><th>Nilai</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td>{String(r[output.xKey] ?? '')}</td><td>{String(r[key] ?? '')}</td></tr>)}</tbody></table>
      <Meta output={output} />
    </div>
  );
}

function DonutBlock({ output }: { output: ShareOutput }) {
  const key = output.series[0]?.key ?? 'value';
  const rows = output.rows.filter((r) => Number(r[key] ?? 0) > 0);
  const total = rows.reduce((sum, r) => sum + Number(r[key] ?? 0), 0);
  const circumference = 2 * Math.PI * 38;
  let offset = 0;
  const colors = ['var(--color-forest)', 'var(--color-terracotta)', 'var(--color-forest-08)'];
  const arcs = rows.map((r, i) => {
    const value = Number(r[key] ?? 0);
    const length = total > 0 ? (value / total) * circumference : 0;
    const arc = { r, i, value, length, offset, color: colors[i % colors.length] };
    offset += length;
    return arc;
  });
  return (
    <div className="surface p-s4">
      <p className="font-display text-label font-semibold text-ink">{output.title ?? 'Distribusi'}</p>
      <div className="mt-s3 flex items-center gap-s3">
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={output.title ?? 'Distribusi'}>
            <circle cx="50" cy="50" r="38" fill="none" stroke="var(--border-hairline)" strokeWidth="12" />
            {arcs.map((arc) => <circle key={arc.i} cx="50" cy="50" r="38" fill="none" stroke={arc.color} strokeWidth="12" strokeDasharray={`${arc.length.toFixed(1)} ${circumference.toFixed(1)}`} strokeDashoffset={-arc.offset} />)}
          </svg>
        </div>
        <ul className="min-w-0 flex-1 space-y-s2">
          {arcs.map((arc) => (
            <li key={arc.i} className="flex items-center justify-between gap-s2 font-body text-caption">
              <span className="inline-flex min-w-0 items-center gap-s2 text-ink-72"><span className="state-dot shrink-0" style={{ backgroundColor: arc.color }} aria-hidden="true" /><span className="truncate">{String(arc.r[output.xKey] ?? `Bagian ${arc.i + 1}`)}</span></span>
              <span className="tabular text-ink">{total > 0 ? `${((arc.value / total) * 100).toFixed(1).replace('.', ',')}%` : '—'}</span>
            </li>
          ))}
        </ul>
      </div>
      <table className="sr-only"><caption>{output.title ?? 'Distribusi'}</caption><tbody>{arcs.map((arc) => <tr key={arc.i}><td>{String(arc.r[output.xKey] ?? '')}</td><td>{arc.value}</td></tr>)}</tbody></table>
      <Meta output={output} />
    </div>
  );
}

function QuoteBlock({ output }: { output: ShareOutput }) {
  return (
    <blockquote className="surface flex flex-col gap-s2 p-s4">
      {output.chapter && <span className="font-body text-caption text-ink-72">{output.chapter}</span>}
      {output.article && <cite className="font-display text-title font-semibold not-italic text-ink">{output.article}</cite>}
      <div className="rounded-control border border-[var(--border-hairline)] bg-forest-08 p-s3">
        {output.verses.map((verse, i) => <p key={i} className="font-body text-body text-ink">{verse}</p>)}
        {output.verses.length === 0 && <p className="font-body text-body text-ink-72">Ayat tidak tersedia pada sumber.</p>}
      </div>
      <Meta output={output} />
    </blockquote>
  );
}

function TimelineBlock({ output, onOpenCitation }: { output: ShareOutput; onOpenCitation?: (id: string) => void }) {
  const nodes: TimelineNode[] = output.events.map((event, i) => ({
    id: `node-${i}`,
    date: event.date,
    label: event.label,
    evidence: event.evidence ?? undefined,
    citation: event.citationId ? { id: event.citationId, label: event.citationId, href: `#cite-${event.citationId}` } : undefined,
  }));
  return (
    <div className="surface p-s4">
      <p className="mb-s3 font-display text-label font-semibold text-ink">{output.title ?? 'Linimasa bukti'}</p>
      {nodes.length === 0 ? (
        <div className="flex items-center gap-s2"><StatusDot tone="neutral" /><p className="font-body text-body text-ink-72">Tidak ada kejadian bertanggal pada sumber ini.</p></div>
      ) : (
        <TimelineView nodes={nodes} onRetry={onOpenCitation ? () => onOpenCitation(nodes[0]?.citation?.id ?? '') : undefined} />
      )}
      <Meta output={output} />
    </div>
  );
}

function ParameterBlock({ output }: { output: ShareOutput }) {
  return (
    <div className="surface overflow-hidden">
      {output.title && <p className="border-b border-[var(--border-hairline)] p-s3 font-display text-label font-semibold text-ink">{output.title}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{output.title ?? 'Parameter'}</caption>
          <thead><tr className="bg-forest-08">{['Parameter', 'Nilai', 'Satuan', 'Status', 'Halaman', 'Catatan'].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-s3 py-s2 font-body text-caption text-ink-72">{h}</th>)}</tr></thead>
          <tbody>
            {output.parameters.map((p, i) => (
              <tr key={i} className="border-t border-[var(--border-hairline)]">
                <td className="px-s3 py-s2 font-body text-caption font-semibold text-ink">{p.name}</td>
                <td className="px-s3 py-s2 font-body text-caption tabular text-ink">{formatValue(p.value, 'number')}</td>
                <td className="px-s3 py-s2 font-body text-caption text-ink-72">{p.unit ?? 'Satuan tidak tersedia'}</td>
                <td className="px-s3 py-s2"><span className="inline-flex items-center gap-s2 font-body text-caption text-ink"><StatusDot tone={p.status === 'alert' ? 'error' : 'active'} />{p.status === 'alert' ? 'Alert' : 'Normal'}</span></td>
                <td className="px-s3 py-s2 font-body text-caption text-ink-72">{p.page ?? '—'}</td>
                <td className="px-s3 py-s2 font-body text-caption text-ink-72">{p.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {output.notes.length > 0 && <p className="border-t border-[var(--border-hairline)] p-s3 font-body text-caption text-ink-72">{output.notes.join(' ')}</p>}
      <Meta output={output} />
    </div>
  );
}

function TextBlock({ output }: { output: ShareOutput }) {
  return (
    <div className="flex flex-col gap-s2">
      <p className="max-w-[68ch] font-body text-body leading-relaxed text-ink">{output.text ?? 'Informasi ini tidak ditemukan pada sumber.'}</p>
      {output.keywords.length > 0 && <p className="font-body text-caption text-ink-72">Kata kunci yang dicoba: {output.keywords.join(', ')}</p>}
      <Meta output={output} />
    </div>
  );
}

function OutputBlock({ output, readOnly, onOpenCitation }: { output: ShareOutput; readOnly: boolean; onOpenCitation?: (id: string) => void }) {
  switch (output.type) {
    case 'kpi': return <KpiBlock output={output} />;
    case 'table': return <TableBlock output={output} />;
    case 'bar': return <BarBlock output={output} />;
    case 'line': return <LineBlock output={output} />;
    case 'donut': return <DonutBlock output={output} />;
    case 'quote': return <QuoteBlock output={output} />;
    case 'timeline': return <TimelineBlock output={output} onOpenCitation={onOpenCitation} />;
    case 'parameter_report': return <ParameterBlock output={output} />;
    case 'none':
    default: return <TextBlock output={output} />;
  }
}

export function AdaptiveOutputView({
  outputs,
  state = 'default',
  readOnly = false,
  onOpenCitation,
  errorTitle = 'Hasil gagal dibuat.',
  onRetry,
  className = '',
}: AdaptiveOutputViewProps) {
  if (state === 'loading') {
    return <div className={`space-y-s2 ${className}`} aria-busy="true"><div className="skeleton h-s6 w-full" /><div className="skeleton h-s6 w-2/3" /></div>;
  }
  if (state === 'error') {
    return (
      <div className={`flex flex-col items-start gap-s2 ${className}`} role="alert">
        <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-body text-ink">{errorTitle}</span></span>
        {onRetry && <button type="button" onClick={onRetry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>}
      </div>
    );
  }
  if (state === 'empty' || outputs.length === 0) {
    return <div className={`flex items-center gap-s2 ${className}`}><StatusDot tone="neutral" /><p className="font-body text-body text-ink-72">Belum ada hasil yang dapat ditampilkan.</p></div>;
  }
  return (
    <div className={`animate-phrase-in space-y-s3 ${className}`}>
      {outputs.map((output, index) => <OutputBlock key={`${output.type}-${index}`} output={output} readOnly={readOnly} onOpenCitation={onOpenCitation} />)}
    </div>
  );
}
