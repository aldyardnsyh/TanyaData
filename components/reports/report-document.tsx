'use client';

/**
 * A4 document canvas dari `reports/code.html` (blueprint §4.6).
 * Struktur & kelas Tailwind di-port verbatim. Data fiktif (DOC ID statis,
 * SHA256, Engine Verification, TANYADATA-OFFICIAL, rekomendasi karangan,
 * status "Approved") dihapus; angka berasal dari payload laporan nyata.
 */
import type { ReportDetail, ReportMetric } from '@/lib/contracts/http';
import { formatDateEn, formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';

/** Material Symbols self-hosted; dekoratif → aria-hidden (blueprint §2). */
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

function fmtMetric(metric: ReportMetric): string {
  if (metric.value === null) return 'n/a';
  if (metric.format === 'currency') return formatIdr(metric.value);
  if (metric.format === 'percent') return formatPercent(metric.value);
  if (metric.format === 'number') return formatNumber(metric.value);
  return String(metric.value);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TD';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const BAR_COLORS = [
  'bg-primary',
  'bg-primary-container',
  'bg-outline',
  'bg-tertiary-fixed-dim',
  'bg-tertiary-container',
];

export function ReportDocument({
  report,
  profileName,
  profileRole,
}: {
  report: ReportDetail;
  profileName: string;
  profileRole: string;
}) {
  const periodLabel = report.period
    ? `${formatDateEn(report.period.start)} - ${formatDateEn(report.period.end)}`
    : 'n/a';
  const createdLabel = formatDateEn(report.createdAt);

  const channelViz = report.visualizations.find((viz) => viz.type === 'bar');
  const channelRows = channelViz?.rows ?? [];
  const valueKey = channelViz?.dataKey ?? 'value';
  const labelKey = channelViz?.xKey ?? 'label';
  const seriesLabel = channelViz?.series[0]?.label ?? 'Success rate';
  const seriesUnit = channelViz?.series[0]?.unit ?? '';

  const lineViz = report.visualizations.find((viz) => viz.type === 'line');
  const sparkKey = lineViz?.dataKey ?? 'value';
  const sparkValues = (lineViz?.rows ?? []).map((row) => Number(row[sparkKey]) || 0);
  const sparkMax = Math.max(1, ...sparkValues);
  const sparkMin = Math.min(0, ...sparkValues);
  const sparkPath = sparkValues
    .map((value, index) => {
      const x = sparkValues.length > 1 ? (index / (sparkValues.length - 1)) * 700 : 0;
      const y = 70 - ((value - sparkMin) / (sparkMax - sparkMin || 1)) * 60;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-md p-6 sm:p-10 flex flex-col gap-8 max-w-[1020px] mx-auto w-full relative print-document">
      {/* Document Formal Header */}
      <div className="flex flex-col gap-4 pb-6 border-b border-surface-container-high">
        <div className="flex flex-wrap items-center justify-between gap-y-2">
          <div className="flex items-center gap-2">
            <span className="font-headline-sm text-headline-sm font-bold text-primary tracking-tight">TanyaData</span>
            <span className="text-surface-variant">|</span>
            <span className="font-label-sm text-label-sm tracking-wider uppercase text-on-surface-variant font-bold">Formal Analytical Memorandum</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded font-label-sm text-label-sm bg-surface-container-high text-on-surface-variant font-mono">DOC ID: {report.id}</span>
            <span className="px-2 py-0.5 rounded font-label-sm text-label-sm bg-tertiary-container/15 text-tertiary-container font-bold uppercase tracking-wider">Internal Restricted</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 mt-2">
          <div className="font-label-sm text-label-sm uppercase tracking-widest text-outline">Executive Report Briefing • Final Draft</div>
          <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-bold">{report.title}</h2>
          <div className="flex flex-wrap items-center gap-4 text-outline font-label-sm text-label-sm mt-1">
            <span><strong>Reporting Period:</strong> {periodLabel}</span>
            <span>•</span>
            <span><strong>Generated:</strong> {createdLabel}</span>
            <span>•</span>
            <span><strong>Dataset:</strong> {report.dataset.name}</span>
          </div>
        </div>
      </div>

      {/* 01. Executive Summary */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-bold">01. Executive Summary</span>
          <div className="h-px flex-1 bg-surface-container" />
        </div>
        <div className="p-4 rounded-lg bg-surface-container-low text-on-surface font-body-lg text-body-lg leading-relaxed">
          <p>{report.summary || 'n/a'}</p>
        </div>
      </div>

      {/* 02. Settlement & Volume Performance Matrix */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-bold">02. Settlement &amp; Volume Performance Matrix</span>
          <span className="font-label-sm text-label-sm text-outline font-mono">Currency: IDR (Rupiah)</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {report.metrics.map((metric, index) => (
            <div key={metric.key} className="p-4 rounded-lg bg-surface-container-low flex flex-col justify-between">
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{metric.label}</span>
              <div className="mt-2">
                <div className={`font-metric-display text-metric-display font-semibold tracking-tight tabular ${
                  index === 1 ? 'text-primary' : index === 2 ? 'text-tertiary-container' : 'text-on-surface'
                }`}>
                  {fmtMetric(metric)}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-body-sm text-body-sm text-outline font-mono">{metric.key}</span>
                  <span className="font-label-sm text-label-sm text-primary font-bold">{metric.format}</span>
                </div>
              </div>
            </div>
          ))}
          {report.metrics.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant col-span-2 lg:col-span-4">No metrics in this report snapshot.</p>
          )}
        </div>
      </div>

      {/* 03. High-Density Channel Reliability Benchmark */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-bold">03. High-Density Channel Reliability Benchmark</span>
          <span className="font-label-sm text-label-sm text-outline">{channelViz?.title ?? 'Channel benchmark'}</span>
        </div>
        <div className="p-5 rounded-lg bg-surface-container-low flex flex-col gap-4">
          {channelRows.map((row, index) => {
            const raw = Number(row[valueKey]);
            const value = Number.isFinite(raw) ? raw : 0;
            const width = Math.max(0, Math.min(100, value));
            return (
              <div key={String(row[labelKey] ?? index)} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between font-label-md text-label-md">
                  <div className="flex items-center gap-2">
                    <Icon name="bar_chart" className="text-[16px] text-primary" />
                    <span className="font-semibold text-on-surface">{String(row[labelKey] ?? 'n/a')}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container px-1.5 py-0.2 rounded font-semibold">{seriesLabel}</span>
                    <span className="font-mono text-on-surface font-bold text-body-md tabular">{value}{seriesUnit}</span>
                  </div>
                </div>
                <div className="w-full bg-surface-container h-2.5 rounded-full overflow-hidden flex">
                  <div className={`${BAR_COLORS[index % BAR_COLORS.length]} h-full rounded-full transition-all duration-500`} style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
          {channelRows.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">No channel benchmark in this report snapshot.</p>
          )}

          {/* Sparkline: hanya bila ada visualisasi garis nyata (gradient SVG diizinkan blueprint §5.2). */}
          {sparkPath && (
            <div className="pt-3 mt-1 flex flex-col gap-2">
              <div className="flex items-center justify-between text-outline font-label-sm text-label-sm">
                <span>{lineViz?.title ?? 'TREND PROFILE'}</span>
                <span className="font-mono">{lineViz?.series[0]?.unit ?? ''}</span>
              </div>
              <svg className="w-full h-14 overflow-visible" fill="none" viewBox="0 0 700 70" role="img" aria-label={lineViz?.title ?? 'Trend'}>
                <defs>
                  <linearGradient id="latencyGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line stroke="var(--color-outline-variant)" strokeDasharray="4 4" strokeWidth="1" x1="0" x2="700" y1="35" y2="35" />
                <path d={`${sparkPath} L700,70 L0,70 Z`} fill="url(#latencyGrad)" />
                <path d={sparkPath} stroke="var(--color-primary)" strokeLinecap="round" strokeWidth="2.5" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* 04. Strategic Action Items (dari keyFindings — tanpa rekomendasi karangan) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-bold">04. Strategic Action Items &amp; Policy Directives</span>
          <div className="h-px flex-1 bg-surface-container" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {report.keyFindings.map((finding, index) => (
            <div key={`${finding.ref ?? 'finding'}-${index}`} className="p-3.5 rounded-lg bg-surface-container-low flex flex-col justify-between">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="h-5 w-5 rounded bg-primary text-on-primary font-label-sm text-label-sm flex items-center justify-center font-bold">{index + 1}</span>
                  <span className="font-label-md text-label-md font-semibold text-on-surface">Finding {index + 1}</span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant leading-normal">{finding.text}</p>
              </div>
              {finding.ref && <span className="font-label-sm text-label-sm text-primary font-bold mt-2">{finding.ref}</span>}
            </div>
          ))}
          {report.keyFindings.length === 0 && (
            <p className="font-body-sm text-body-sm text-on-surface-variant col-span-1 md:col-span-3">No key findings in this report snapshot.</p>
          )}
        </div>
      </div>

      {/* 05. Document Verification & Sign-off Footprint */}
      <div className="pt-4 border-t border-surface-container-high flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold text-body-md">
            {initialsOf(profileName)}
          </div>
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Algorithmic Provenance</span>
            <span className="font-label-md text-label-md text-on-surface font-semibold">TanyaData Autonomous Intelligence Core</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col text-left sm:text-right">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Report Author</span>
            <span className="font-label-md text-label-md text-on-surface font-semibold">{profileName || 'n/a'}</span>
            <span className="font-body-sm text-body-sm text-primary font-medium">{profileRole || 'n/a'}</span>
          </div>
          <div className="h-9 w-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant">
            <Icon name="draw" className="text-[20px] text-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}
