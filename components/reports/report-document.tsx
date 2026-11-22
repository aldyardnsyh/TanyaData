'use client';

/**
 * Dokumen laporan A4 dari data nyata `ReportDetail` (API_CONTRACT §7.2).
 * Template brand TanyaData (band header forest, aksen lime, footer copyright)
 * dengan layout terpisah per jenis laporan (lib/reports/kind.ts):
 *  - data-analytics  → metrik + chart + tabel pendukung + temuan;
 *  - document-research → ringkasan + temuan + kutipan bukti per bagian.
 * Tanpa klaim rekaan; angka berasal dari snapshot laporan, bukan query ulang.
 */
import type { ReportDetail, ReportMetric } from '@/lib/contracts/http';
import { formatDateEn, formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import { REPORT_KIND_DESC, REPORT_KIND_LABEL, reportInsights, reportKind } from '@/lib/reports/kind';

function fmtMetric(metric: ReportMetric): string {
  if (metric.value === null) return 'Belum dihitung';
  if (metric.format === 'currency') return formatIdr(metric.value);
  if (metric.format === 'percent') return formatPercent(metric.value);
  if (metric.format === 'number') return formatNumber(metric.value);
  return String(metric.value);
}

function SectionLabel({ index, title, note }: { index: string; title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-s2">
      <span className="mono-meta font-semibold text-forest">{index} · {title}</span>
      {note && <span className="mono-meta">{note}</span>}
    </div>
  );
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
  const kind = reportKind(report);
  const isDocResearch = kind === 'document-research';
  const insights = reportInsights(report);

  const channelViz = report.visualizations.find((viz) => viz.type === 'bar');
  const channelRows = channelViz?.rows ?? [];
  const valueKey = channelViz?.dataKey ?? 'value';
  const labelKey = channelViz?.xKey ?? 'label';
  const seriesLabel = channelViz?.series[0]?.label ?? 'Nilai';
  const seriesUnit = channelViz?.series[0]?.unit ?? '';
  const channelMax = Math.max(1, ...channelRows.map((row) => Number(row[valueKey]) || 0));

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

  const docSources = report.sources.filter((source) => source.kind === 'document');

  return (
    <article className="print-document mx-auto flex w-full max-w-[1020px] flex-col overflow-hidden rounded-surface border border-[var(--border-hairline)] bg-porcelain">
      {/* Band header brand: identitas + jenis laporan + judul + meta. */}
      <header className="print-band relative flex flex-col gap-s3 bg-forest p-s5 text-porcelain">
        <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0 opacity-60" />
        <div className="relative flex flex-wrap items-center justify-between gap-s2">
          <div className="flex items-center gap-s2">
            <span className="font-display text-label font-bold text-porcelain">TanyaData</span>
            <span className="h-s2 w-px bg-porcelain/30" aria-hidden="true" />
            <span className="mono-meta rounded-chip bg-lime px-s2 py-0.5 font-semibold text-ink">{REPORT_KIND_LABEL[kind]}</span>
          </div>
          <span className="mono-meta text-porcelain/70">ID · {report.id.slice(0, 8)}</span>
        </div>
        <div className="relative mt-s1 flex flex-col gap-s2">
          <h2 className="max-w-[26ch] font-display text-title text-porcelain">{report.title}</h2>
          {report.question && (
            <p className="max-w-[64ch] font-body text-caption text-porcelain/75">Pertanyaan penelitian: “{report.question}”</p>
          )}
          <p className="max-w-[64ch] font-body text-caption text-porcelain/75">{REPORT_KIND_DESC[kind]}</p>
        </div>
        <div className="relative mt-s1 flex flex-wrap gap-x-s4 gap-y-s1 font-body text-caption text-porcelain/70">
          <span>Periode: {periodLabel}</span>
          <span>Dataset: {report.dataset.name}</span>
          <span>Dibuat: {createdLabel}</span>
        </div>
      </header>

      <div className="flex flex-col gap-s5 p-s4 sm:p-s5">
        {/* Insight otomatis dari angka snapshot — deterministic, bukan karangan. */}
        {insights.length > 0 && (
          <section className="print-section flex flex-col gap-s2 rounded-card-lg bg-forest-08 p-s4">
            <SectionLabel index="00" title="SOROTAN" note="Dihitung dari data snapshot" />
            <ul className="flex flex-col gap-s1">
              {insights.map((insight) => (
                <li key={insight} className="flex items-start gap-s2 font-body text-caption leading-relaxed text-ink">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" aria-hidden="true" />
                  {insight}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="print-section flex flex-col gap-s3">
          <SectionLabel index="01" title="RINGKASAN" />
          <p className="max-w-[68ch] font-body text-body leading-relaxed text-ink">{report.summary || 'Belum ada ringkasan pada snapshot ini.'}</p>
        </section>

        {!isDocResearch && report.metrics.length > 0 && (
          <section className="print-section flex flex-col gap-s3">
            <SectionLabel index="02" title="METRIK UTAMA" note="MATA UANG · IDR" />
            <div className="grid grid-cols-2 gap-s2 lg:grid-cols-4">
              {report.metrics.map((metric, index) => (
                <div key={metric.key} className={`flex min-h-32 flex-col rounded-control border p-s3 ${index === 0 ? 'border-forest bg-forest text-porcelain' : 'border-[var(--border-hairline)] bg-forest-08'}`}>
                  <p className={`font-body text-caption ${index === 0 ? 'text-porcelain/70' : 'text-ink-72'}`}>{metric.label}</p>
                  <p className={`mt-s2 font-body text-metric tabular ${index === 0 ? 'text-lime' : 'text-ink'}`}>{fmtMetric(metric)}</p>
                  <div className="mt-auto pt-s2"><span className={`mono-meta ${index === 0 ? 'text-porcelain/60' : ''}`}>{metric.key}</span></div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!isDocResearch && (channelRows.length > 0 || sparkPath) && (
          <section className="print-section flex flex-col gap-s3">
            <SectionLabel index="03" title="KINERJA KANAL" note={channelViz?.title ?? 'KANAL'} />
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
                    <div className="h-s2 w-full overflow-hidden rounded-control bg-porcelain"><div className="h-full rounded-control bg-forest" style={{ width: `${Math.max(0, Math.min(100, (value / channelMax) * 100))}%` }} /></div>
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
        )}

        {!isDocResearch && report.supportingTable && report.supportingTable.rows.length > 0 && (
          <section className="print-section flex flex-col gap-s3">
            <SectionLabel index="04" title="TABEL PENDUKUNG" note={`${report.supportingTable.rows.length} BARIS`} />
            <div className="overflow-x-auto rounded-control border border-[var(--border-hairline)]">
              <table className="w-full border-collapse text-left font-body text-caption">
                <thead>
                  <tr className="bg-forest text-porcelain">
                    {report.supportingTable.columns.map((column) => (
                      <th key={column.key} className="px-s2 py-s1 font-display text-label font-semibold">{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.supportingTable.rows.slice(0, 12).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-[var(--border-hairline)] odd:bg-forest-08">
                      {report.supportingTable!.columns.map((column) => (
                        <td key={column.key} className="px-s2 py-s1 tabular text-ink">{String(row[column.key] ?? '—')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="print-section flex flex-col gap-s3">
          <SectionLabel index={isDocResearch ? '02' : '05'} title="TEMUAN UTAMA" />
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

        {isDocResearch && docSources.length > 0 && (
          <section className="print-section flex flex-col gap-s3">
            <SectionLabel index="03" title="BUKTI & SITASI" note={`${docSources.length} KUTIPAN ASLI`} />
            <div className="flex flex-col gap-s2">
              {docSources.slice(0, 6).map((source, index) => (
                <figure key={source.chunkId ?? index} className="flex flex-col gap-s1 rounded-control border-l-2 border-lime bg-forest-08 p-s3">
                  <blockquote className="font-body text-caption leading-relaxed text-ink">“{source.quote}”</blockquote>
                  <figcaption className="mono-meta">
                    {[source.docTitle ?? source.sourceId, source.section, source.page != null ? `hlm ${source.page}` : null].filter(Boolean).join(' · ')}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Footer copyright — identitas template di setiap cetakan. */}
      <footer className="print-band mt-auto flex flex-col gap-s1 border-t border-[var(--border-hairline)] bg-forest-08 p-s3 sm:flex-row sm:items-center sm:justify-between">
        <span className="mono-meta">© {new Date(report.createdAt).getFullYear()} TanyaData · Dihasilkan otomatis dari sumber terverifikasi</span>
        <span className="mono-meta">{report.id.slice(0, 8)} · {createdLabel}</span>
      </footer>
    </article>
  );
}
