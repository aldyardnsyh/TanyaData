'use client';

/**
 * Dokumen laporan A4 dari data nyata `ReportDetail` (API_CONTRACT §7.2).
 * Tanpa "Final Draft", "Internal Restricted", sign-off, inisial, atau klaim
 * verifikasi rekaan (U-09 / R-36 / R-38). Angka berasal dari snapshot laporan.
 */
import type { ReportDetail, ReportMetric } from '@/lib/contracts/http';
import { formatDateEn, formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';

function fmtMetric(metric: ReportMetric): string {
  if (metric.value === null) return '—';
  if (metric.format === 'currency') return formatIdr(metric.value);
  if (metric.format === 'percent') return formatPercent(metric.value);
  if (metric.format === 'number') return formatNumber(metric.value);
  return String(metric.value);
}

const BAR_COLORS = ['bg-primary', 'bg-primary-dim', 'bg-border-control', 'bg-signal-lime', 'bg-signal-terracotta'];

export function ReportDocument({
  report,
  profileName: _profileName,
  profileRole: _profileRole,
}: {
  report: ReportDetail;
  profileName: string;
  profileRole: string;
}) {
  const periodLabel = report.period ? `${formatDateEn(report.period.start)} – ${formatDateEn(report.period.end)}` : '—';
  const createdLabel = formatDateEn(report.createdAt);

  const channelViz = report.visualizations.find((viz) => viz.type === 'bar');
  const channelRows = channelViz?.rows ?? [];
  const valueKey = channelViz?.dataKey ?? 'value';
  const labelKey = channelViz?.xKey ?? 'label';
  const seriesLabel = channelViz?.series[0]?.label ?? 'Nilai';
  const seriesUnit = channelViz?.series[0]?.unit ?? '';

  const lineViz = report.visualizations.find((viz) => viz.type === 'line');
  const sparkKey = lineViz?.dataKey ?? 'value';
  const sparkValues = (lineViz?.rows ?? []).map((row) => Number(row[sparkKey]) || 0);
  const sparkMax = Math.max(1, ...sparkValues);
  const sparkMin = Math.min(0, ...sparkValues);
  const sparkPath = sparkValues.map((value, index) => {
    const x = sparkValues.length > 1 ? (index / (sparkValues.length - 1)) * 700 : 0;
    const y = 70 - ((value - sparkMin) / (sparkMax - sparkMin || 1)) * 60;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <article className="mx-auto flex w-full max-w-[1020px] flex-col gap-8 rounded-card border border-border-hairline bg-surface p-6 print-document sm:p-10">
      <header className="flex flex-col gap-4 border-b border-border-hairline pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="font-display text-headline-sm font-bold tracking-tight text-ink">TanyaData</span>
            <span className="text-border-hairline">|</span>
            <MonoMeta>DOKUMEN ANALITIK</MonoMeta>
          </div>
          <MonoMeta>ID · {report.id}</MonoMeta>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <h2 className="font-display text-headline-lg text-ink">{report.title}</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-body-sm text-ink-muted-strong">
            <span>Periode: {periodLabel}</span>
            <span>Dibuat: {createdLabel}</span>
            <span>Dataset: {report.dataset.name}</span>
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <MonoMeta>01 · RINGKASAN</MonoMeta>
        <MeasurementRule />
        <p className="font-body text-body-lg leading-relaxed text-ink">{report.summary || '—'}</p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><MonoMeta>02 · METRIK</MonoMeta><MonoMeta>MATA UANG · IDR</MonoMeta></div>
        <MeasurementRule />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {report.metrics.map((metric, index) => (
            <div key={metric.key} className="flex min-h-32 flex-col rounded-card border border-border-hairline bg-canvas p-4">
              <p className="font-body text-label-sm uppercase text-ink-muted-strong">{metric.label}</p>
              <p className={`mt-2 font-body text-metric-display tabular ${index === 1 ? 'text-primary' : index === 2 ? 'text-error-text' : 'text-ink'}`}>{fmtMetric(metric)}</p>
              <div className="mt-auto pt-2"><MonoMeta>{metric.key} · {metric.format}</MonoMeta></div>
            </div>
          ))}
          {report.metrics.length === 0 && <p className="col-span-2 font-body text-body-md text-ink-muted-strong lg:col-span-4">Tidak ada metrik pada snapshot laporan ini.</p>}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><MonoMeta>03 · KINERJA KANAL</MonoMeta><MonoMeta>{channelViz?.title ?? 'KANAL'}</MonoMeta></div>
        <MeasurementRule />
        <div className="flex flex-col gap-4 rounded-card border border-border-hairline bg-canvas p-5">
          {channelRows.map((row, index) => {
            const raw = Number(row[valueKey]);
            const value = Number.isFinite(raw) ? raw : 0;
            return (
              <div key={String(row[labelKey] ?? index)} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 font-body text-body-sm">
                  <span className="inline-flex items-center gap-2 font-semibold text-ink"><span className={`state-dot ${BAR_COLORS[index % BAR_COLORS.length]}`} aria-hidden="true" />{String(row[labelKey] ?? '—')}</span>
                  <span className="tabular text-ink">{value}{seriesUnit} <span className="text-ink-muted-strong">{seriesLabel}</span></span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-control bg-row-hover"><div className={`h-full ${BAR_COLORS[index % BAR_COLORS.length]}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
              </div>
            );
          })}
          {channelRows.length === 0 && <p className="font-body text-body-md text-ink-muted-strong">Tidak ada data kanal pada snapshot ini.</p>}
          {sparkPath && (
            <div className="mt-2 flex flex-col gap-2 border-t border-border-hairline pt-3">
              <div className="flex items-center justify-between font-body text-body-sm text-ink-muted-strong"><span>{lineViz?.title ?? 'Tren'}</span><MonoMeta>{lineViz?.series[0]?.unit ?? ''}</MonoMeta></div>
              <svg viewBox="0 0 700 70" className="h-14 w-full" fill="none" role="img" aria-label={lineViz?.title ?? 'Tren'}>
                <line x1="0" x2="700" y1="35" y2="35" stroke="var(--color-border-hairline)" strokeDasharray="4 4" strokeWidth="1" />
                <path d={sparkPath} stroke="var(--color-primary)" strokeLinecap="round" strokeWidth="2.5" />
              </svg>
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <MonoMeta>04 · TEMUAN UTAMA</MonoMeta>
        <MeasurementRule />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {report.keyFindings.map((finding, index) => (
            <div key={`${finding.ref ?? 'finding'}-${index}`} className="flex flex-col gap-2 rounded-card border border-border-hairline bg-canvas p-4">
              <div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-control bg-primary font-body text-body-sm font-semibold text-on-primary">{index + 1}</span><MonoMeta>TEMUAN {index + 1}</MonoMeta></div>
              <p className="font-body text-body-sm leading-relaxed text-ink">{finding.text}</p>
              {finding.ref && <div className="mt-auto pt-2"><MonoMeta>{finding.ref}</MonoMeta></div>}
            </div>
          ))}
          {report.keyFindings.length === 0 && <p className="col-span-1 font-body text-body-md text-ink-muted-strong md:col-span-3">Tidak ada temuan utama pada snapshot ini.</p>}
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-border-hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
        <MonoMeta>DIBUAT OLEH TANYADATA · {createdLabel}</MonoMeta>
        <MonoMeta>SQLITE · SQL + FTS5 · READ ONLY</MonoMeta>
      </footer>
    </article>
  );
}
