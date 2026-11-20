'use client';

/**
 * Dokumen laporan A4 dari data nyata `ReportDetail` (API_CONTRACT §7.2).
 * Tanpa "Final Draft", "Internal Restricted", sign-off, inisial, atau klaim
 * verifikasi rekaan. Angka berasal dari snapshot laporan, bukan query ulang.
 * Token baru UI_REFACTOR_DESIGN: forest/ink/porcelain, text-metric, mono-meta.
 */
import type { ReportDetail, ReportMetric } from '@/lib/contracts/http';
import { formatDateEn, formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import { SectionRule } from '@/components/signal/section-rule';

function fmtMetric(metric: ReportMetric): string {
  if (metric.value === null) return 'Belum dihitung';
  if (metric.format === 'currency') return formatIdr(metric.value);
  if (metric.format === 'percent') return formatPercent(metric.value);
  if (metric.format === 'number') return formatNumber(metric.value);
  return String(metric.value);
}

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
    <article className="print-document mx-auto flex w-full max-w-[1020px] flex-col gap-s5 rounded-surface border border-[var(--border-hairline)] bg-porcelain p-s4 sm:p-s5">
      <header className="flex flex-col gap-s3 border-b border-[var(--border-hairline)] pb-s4">
        <div className="flex flex-wrap items-center justify-between gap-s2">
          <div className="flex items-center gap-s3">
            <span className="font-display text-label font-bold text-ink">TanyaData</span>
            <span className="text-[var(--border-hairline)]">|</span>
            <span className="mono-meta">DOKUMEN ANALITIK</span>
          </div>
          <span className="mono-meta">ID · {report.id}</span>
        </div>
        <div className="mt-s2 flex flex-col gap-s2">
          <h2 className="font-display text-title text-ink">{report.title}</h2>
          <div className="flex flex-wrap items-center gap-x-s4 gap-y-s1 font-body text-caption text-ink-72">
            <span>Periode: {periodLabel}</span>
            <span>Dibuat: {createdLabel}</span>
            <span>Dataset: {report.dataset.name}</span>
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-s3">
        <span className="mono-meta">01 · RINGKASAN</span>
        <SectionRule />
        <p className="max-w-[68ch] font-body text-body leading-relaxed text-ink">{report.summary || 'Belum ada ringkasan pada snapshot ini.'}</p>
      </section>

      <section className="flex flex-col gap-s3">
        <div className="flex flex-wrap items-center justify-between gap-s2"><span className="mono-meta">02 · METRIK</span><span className="mono-meta">MATA UANG · IDR</span></div>
        <SectionRule />
        <div className="grid grid-cols-2 gap-s2 lg:grid-cols-4">
          {report.metrics.map((metric, index) => (
            <div key={metric.key} className="flex min-h-32 flex-col rounded-control border border-[var(--border-hairline)] bg-forest-08 p-s3">
              <p className="font-body text-caption text-ink-72">{metric.label}</p>
              <p className={`mt-s2 font-body text-metric tabular ${index === 1 ? 'text-forest' : index === 2 ? 'text-ink' : 'text-ink'}`}>{fmtMetric(metric)}</p>
              <div className="mt-auto pt-s2"><span className="mono-meta">{metric.key} · {metric.format}</span></div>
            </div>
          ))}
          {report.metrics.length === 0 && <p className="col-span-2 font-body text-body text-ink-72 lg:col-span-4">Tidak ada metrik pada snapshot laporan ini.</p>}
        </div>
      </section>

      <section className="flex flex-col gap-s3">
        <div className="flex flex-wrap items-center justify-between gap-s2"><span className="mono-meta">03 · KINERJA KANAL</span><span className="mono-meta">{channelViz?.title ?? 'KANAL'}</span></div>
        <SectionRule />
        <div className="flex flex-col gap-s3 rounded-control border border-[var(--border-hairline)] bg-forest-08 p-s4">
          {channelRows.map((row, index) => {
            const raw = Number(row[valueKey]);
            const value = Number.isFinite(raw) ? raw : 0;
            return (
              <div key={String(row[labelKey] ?? index)} className="flex flex-col gap-s1">
                <div className="flex items-center justify-between gap-s2 font-body text-caption">
                  <span className="inline-flex items-center gap-s2 font-semibold text-ink"><span className="state-dot" aria-hidden="true" />{String(row[labelKey] ?? '—')}</span>
                  <span className="tabular text-ink">{value}{seriesUnit} <span className="text-ink-72">{seriesLabel}</span></span>
                </div>
                <div className="h-s2 w-full overflow-hidden rounded-control bg-porcelain"><div className="h-full bg-forest" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
              </div>
            );
          })}
          {channelRows.length === 0 && <p className="font-body text-body text-ink-72">Tidak ada data kanal pada snapshot ini.</p>}
          {sparkPath && (
            <div className="mt-s2 flex flex-col gap-s2 border-t border-[var(--border-hairline)] pt-s3">
              <div className="flex items-center justify-between font-body text-caption text-ink-72"><span>{lineViz?.title ?? 'Tren'}</span><span className="mono-meta">{lineViz?.series[0]?.unit ?? ''}</span></div>
              <svg viewBox="0 0 700 70" className="h-14 w-full" fill="none" role="img" aria-label={lineViz?.title ?? 'Tren'}>
                <line x1="0" x2="700" y1="35" y2="35" stroke="var(--border-hairline)" strokeDasharray="4 4" strokeWidth="1" />
                <path d={sparkPath} stroke="var(--color-forest)" strokeLinecap="round" strokeWidth="2.5" />
              </svg>
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-s3">
        <span className="mono-meta">04 · TEMUAN UTAMA</span>
        <SectionRule />
        <div className="grid grid-cols-1 gap-s2 md:grid-cols-3">
          {report.keyFindings.map((finding, index) => (
            <div key={`${finding.ref ?? 'finding'}-${index}`} className="flex flex-col gap-s2 rounded-control border border-[var(--border-hairline)] bg-forest-08 p-s3">
              <div className="flex items-center gap-s2"><span className="flex h-5 w-5 items-center justify-center rounded-control bg-forest font-body text-caption font-semibold text-porcelain">{index + 1}</span><span className="mono-meta">TEMUAN {index + 1}</span></div>
              <p className="font-body text-caption leading-relaxed text-ink">{finding.text}</p>
              {finding.ref && <div className="mt-auto pt-s2"><span className="mono-meta">{finding.ref}</span></div>}
            </div>
          ))}
          {report.keyFindings.length === 0 && <p className="col-span-1 font-body text-body text-ink-72 md:col-span-3">Tidak ada temuan utama pada snapshot ini.</p>}
        </div>
      </section>

      <footer className="flex flex-col gap-s2 border-t border-[var(--border-hairline)] pt-s3 sm:flex-row sm:items-center sm:justify-between">
        <span className="mono-meta">DIBUAT OLEH TANYADATA · {createdLabel}</span>
        <span className="mono-meta">SQLITE · SQL + FTS5 · READ ONLY</span>
      </footer>
    </article>
  );
}
