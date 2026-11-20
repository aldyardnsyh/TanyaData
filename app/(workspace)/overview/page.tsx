'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatCompareLabel, formatNumber, formatPercent } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { PageHeading } from '@/components/signal/page-heading';
import { SectionRule } from '@/components/signal/section-rule';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { AnimatedTabs } from '@/components/signal/animated-tabs';
import { StatusDot } from '@/components/signal/status-dot';
import type {
  DashboardSummaryResponse,
  InsightsResponse,
  Kpi,
  StatusDistributionResponse,
  TrendsResponse,
} from '@/lib/contracts/http';

const PERIODS = [
  { id: 'this_month', label: 'Bulan ini' },
  { id: 'last_7_days', label: '7 hari' },
  { id: 'last_30_days', label: '30 hari' },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];

const num = (v: number | null | undefined) => (v == null ? 'Belum dihitung' : formatNumber(v));
const pct = (v: number | null | undefined) => (v == null ? 'Belum dihitung' : formatPercent(v));

function withPeriod(endpoint: string, period: PeriodId): string {
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${sep}period=${period}&compare=like_for_like`;
}

export default function OverviewPage() {
  const [period, setPeriod] = useState<PeriodId>('this_month');
  const [activeBar, setActiveBar] = useState<number | null>(null);

  const summary = useApi<DashboardSummaryResponse>(withPeriod('/api/dashboard/summary', period));
  const trends = useApi<TrendsResponse>(withPeriod('/api/dashboard/trends', period));
  const status = useApi<StatusDistributionResponse>(withPeriod('/api/dashboard/status-distribution', period));
  const insights = useApi<InsightsResponse>(withPeriod('/api/dashboard/insights?limit=3', period));

  useEffect(() => setActiveBar(null), [period]);

  const retryAll = () => {
    summary.retry();
    trends.retry();
    status.retry();
    insights.retry();
  };

  const kpis = summary.data?.kpis ?? [];
  const kpi = (key: Kpi['key']) => kpis.find((item) => item.key === key);
  const periodLabel = summary.data?.period.label ?? 'Periode belum tersedia';
  const compareLabel = formatCompareLabel(summary.data?.period.compare);
  const datasetName = summary.data?.dataset.name;

  const bentoItems: BentoItem[] = [
    { id: 'total', label: kpi('total')?.label ?? 'Total Transaksi', value: num(kpi('total')?.value), source: 'SQL · SUMMARY', span: 'hero', active: true },
    { id: 'successful', label: kpi('successful')?.label ?? 'Transaksi Sukses', value: num(kpi('successful')?.value), source: 'SQL · SUMMARY' },
    { id: 'successRate', label: kpi('successRate')?.label ?? 'Success Rate', value: pct(kpi('successRate')?.value), source: 'SQL · SUMMARY' },
    { id: 'failed', label: kpi('failed')?.label ?? 'Transaksi Gagal', value: num(kpi('failed')?.value), source: 'SQL · SUMMARY' },
    { id: 'failureRate', label: kpi('failureRate')?.label ?? 'Failure Rate', value: pct(kpi('failureRate')?.value), source: 'SQL · SUMMARY' },
  ];

  const summaryState = summary.loading ? 'loading' : summary.error ? 'error' : summary.data?.empty ? 'empty' : 'default';
  const points = trends.data?.points ?? [];
  const chartMax = Math.max(1, ...points.map((p) => p.total));
  const shown = activeBar !== null ? points[activeBar] : null;

  const statusItems = status.data?.items ?? [];
  const circumference = 2 * Math.PI * 38;
  let offset = 0;
  const arcs = statusItems.slice(0, 3).map((item, i) => {
    const color = i === 0 ? 'var(--color-forest)' : i === 1 ? 'var(--color-terracotta)' : 'var(--color-forest-08)';
    const length = (item.percent / 100) * circumference;
    const arc = { item, color, length, offset };
    offset += length;
    return arc;
  });

  const insightItems = insights.data?.items ?? [];

  return (
    <div className="page-container py-s5">
      <PageHeading
        title="Ringkasan"
        caption="Pantau metrik transaksi dan temukan perubahan yang bermakna antarperiode."
        meta={`PERIODE · ${periodLabel}${compareLabel ? ` · ${compareLabel.toUpperCase()}` : ''}${datasetName ? ` · ${datasetName.toUpperCase()}` : ''}`}
      />

      {/* C-04 Context Tabs: filter periode. */}
      <div className="mb-s4">
        <AnimatedTabs
          tabs={PERIODS.map((p) => ({ id: p.id, label: p.label }))}
          activeId={period}
          onChange={(id) => setPeriod(id as PeriodId)}
          state={summary.loading ? 'loading' : 'default'}
        />
      </div>

      {/* C-01 Signal Bento: satu metrik utama + empat pendukung. */}
      <section aria-label="Metrik utama" className="mb-s5">
        <BentoGrid
          items={bentoItems}
          state={summaryState}
          emptyTitle="Belum ada metrik untuk periode ini."
          emptyAction={{ label: 'Ubah periode', onClick: () => setPeriod('last_30_days') }}
          errorTitle="Metrik gagal dimuat."
          onRetry={summary.retry}
        />
      </section>

      {/* Tren + distribusi: 8/4 di desktop, stack di mobile. */}
      <div className="grid-dashboard mb-s5">
        <section className="surface col-span-4 p-s4 md:col-span-8 xl:col-span-8" aria-labelledby="tren-heading">
          <div className="mb-s3 flex flex-wrap items-start justify-between gap-s2">
            <div>
              <h2 id="tren-heading" className="font-display text-title text-ink">Transaksi per periode</h2>
              <p className="mt-s1 font-body text-caption text-ink-72">Sukses dan gagal, agregat dari dataset aktif.</p>
            </div>
            <span className="mono-meta">SQL · TRENDS · {periodLabel.toUpperCase()}</span>
          </div>
          <SectionRule className="mb-s4" />

          {trends.loading ? (
            <div className="skeleton h-64 w-full" aria-busy="true" />
          ) : trends.error ? (
            <div className="flex flex-col items-start gap-s2" role="alert">
              <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-body text-ink">Tren gagal dimuat.</span></span>
              <button type="button" onClick={trends.retry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
            </div>
          ) : points.length === 0 ? (
            <div className="flex flex-col items-start gap-s2 py-s5">
              <StatusDot tone="neutral" />
              <p className="font-body text-body text-ink">Tidak ada transaksi pada periode ini.</p>
              <button type="button" onClick={() => setPeriod('last_30_days')} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Periode sebelumnya</button>
            </div>
          ) : (
            <>
              <div className="mb-s3 flex flex-wrap items-center gap-s3">
                <span className="inline-flex items-center gap-s2 font-body text-caption text-ink-72"><StatusDot tone="active" /> Sukses</span>
                <span className="inline-flex items-center gap-s2 font-body text-caption text-ink-72"><StatusDot tone="error" /> Gagal</span>
              </div>
              <div className="relative h-64 border-b border-[var(--border-hairline)]">
                <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
                  {[1, 0.75, 0.5, 0.25, 0].map((f) => (
                    <div key={f} className="flex items-center gap-s2 border-b border-[var(--border-hairline)]">
                      <span className="w-12 text-right font-body text-caption tabular text-ink-72">{num(Math.round(chartMax * f))}</span>
                      <span className="h-px flex-1 bg-[var(--border-hairline)]" />
                    </div>
                  ))}
                </div>
                <div className="absolute inset-0 ml-14 flex items-end justify-between gap-s1 pb-s1">
                  {points.map((point, index) => {
                    const isShown = index === activeBar;
                    return (
                      <div
                        key={point.bucket}
                        tabIndex={0}
                        role="img"
                        aria-label={`${point.label}: ${num(point.total)} transaksi, ${num(point.failed)} gagal`}
                        onMouseEnter={() => setActiveBar(index)}
                        onMouseLeave={() => setActiveBar(null)}
                        onFocus={() => setActiveBar(index)}
                        onBlur={() => setActiveBar(null)}
                        className="relative flex h-full flex-1 cursor-default flex-col items-center justify-end focus-ring"
                      >
                        {isShown && shown && (
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-tooltip mb-s2 w-52 -translate-x-1/2 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s2 elevated">
                            <p className="font-body text-caption font-semibold text-ink">{shown.label}</p>
                            <div className="mt-s2 space-y-s1 font-body text-caption">
                              <div className="flex justify-between"><span className="text-ink-72">Total</span><span className="tabular text-ink">{num(shown.total)}</span></div>
                              <div className="flex justify-between"><span className="text-ink-72">Sukses</span><span className="tabular text-forest">{num(shown.successful)}</span></div>
                              <div className="flex justify-between"><span className="text-ink-72">Gagal</span><span className="tabular text-ink">{num(shown.failed)}</span></div>
                            </div>
                          </div>
                        )}
                        <div className="w-full max-w-3.5 bg-terracotta transition-opacity duration-[var(--motion-fast)]" style={{ height: `${(point.failed / chartMax) * 230}px`, opacity: activeBar !== null && !isShown ? 0.4 : 1 }} />
                        <div className="w-full max-w-3.5 bg-forest transition-opacity duration-[var(--motion-fast)]" style={{ height: `${(point.successful / chartMax) * 230}px`, opacity: activeBar !== null && !isShown ? 0.4 : 1 }} />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-s2 flex justify-between pl-14 font-body text-caption text-ink-72">
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => {
                  const i = points.length ? Math.min(points.length - 1, Math.round(f * (points.length - 1))) : -1;
                  return <span key={f}>{i >= 0 ? points[i].label : '—'}</span>;
                })}
              </div>
              <table className="sr-only">
                <caption>Transaksi per periode</caption>
                <thead><tr><th>Periode</th><th>Total</th><th>Sukses</th><th>Gagal</th></tr></thead>
                <tbody>{points.map((p) => <tr key={p.bucket}><td>{p.label}</td><td>{p.total}</td><td>{p.successful}</td><td>{p.failed}</td></tr>)}</tbody>
              </table>
            </>
          )}
        </section>

        <section className="surface col-span-4 p-s4 md:col-span-4 xl:col-span-4" aria-labelledby="distribusi-heading">
          <h2 id="distribusi-heading" className="font-display text-title text-ink">Distribusi status</h2>
          <SectionRule className="mb-s4 mt-s2" />
          {status.loading ? (
            <div className="skeleton h-40 w-full" aria-busy="true" />
          ) : status.error ? (
            <div className="flex flex-col items-start gap-s2" role="alert">
              <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-body text-ink">Distribusi gagal dimuat.</span></span>
              <button type="button" onClick={status.retry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
            </div>
          ) : arcs.length === 0 ? (
            <p className="font-body text-body text-ink-72">Belum ada status pada periode ini.</p>
          ) : (
            <div className="flex items-center gap-s3">
              <div className="relative h-32 w-32 shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Distribusi status transaksi">
                  <circle cx="50" cy="50" r="38" fill="none" stroke="var(--border-hairline)" strokeWidth="12" />
                  {arcs.map((arc, i) => arc.length > 0 && (
                    <circle key={i} cx="50" cy="50" r="38" fill="none" stroke={arc.color} strokeWidth="12" strokeDasharray={`${arc.length.toFixed(1)} ${circumference.toFixed(1)}`} strokeDashoffset={-arc.offset} />
                  ))}
                </svg>
              </div>
              <ul className="min-w-0 flex-1 space-y-s2">
                {arcs.map((arc, i) => (
                  <li key={arc.item.status} className="flex items-center justify-between gap-s2">
                    <span className="inline-flex min-w-0 items-center gap-s2 font-body text-caption text-ink-72">
                      <span className="state-dot shrink-0" style={{ backgroundColor: arc.color }} aria-hidden="true" />
                      <span className="truncate">{arc.item.status}</span>
                    </span>
                    <span className="font-body text-caption tabular text-ink">{num(arc.item.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* Insight terbaru dari API. */}
      <section aria-labelledby="insight-heading">
        <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
          <h2 id="insight-heading" className="font-display text-title text-ink">Insight terbaru</h2>
          <span className="mono-meta">{insightItems.length} TEMUAN · {periodLabel.toUpperCase()}</span>
        </div>
        <SectionRule className="mb-s4" />
        {insights.loading ? (
          <div className="grid-dashboard">{[0, 1, 2].map((i) => <div key={i} className="surface col-span-4 p-s3"><div className="skeleton h-s3 w-2/3" /><div className="skeleton mt-s3 h-s5 w-full" /></div>)}</div>
        ) : insights.error ? (
          <div className="flex flex-col items-start gap-s2" role="alert">
            <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-body text-ink">Insight gagal dimuat.</span></span>
            <button type="button" onClick={insights.retry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
          </div>
        ) : insightItems.length === 0 ? (
          <div className="surface flex flex-col items-start gap-s2 p-s4">
            <StatusDot tone="neutral" />
            <p className="font-body text-body text-ink">Belum ada temuan pada periode ini.</p>
            <Link href="/investigations" className="touch-44 inline-flex items-center font-display text-label font-semibold text-forest focus-ring">Buka investigasi</Link>
          </div>
        ) : (
          <div className="grid-dashboard">
            {insightItems.map((insight) => (
              <article key={insight.id} className="surface col-span-4 flex flex-col justify-between gap-s3 p-s4 xl:col-span-4">
                <div>
                  <span className="inline-flex items-center gap-s2">
                    <StatusDot tone={insight.severity === 'high' ? 'error' : 'neutral'} />
                    <span className="font-body text-caption text-ink-72">{insight.severity === 'high' ? 'Prioritas tinggi' : insight.severity === 'medium' ? 'Perlu diperiksa' : 'Informasi'}</span>
                  </span>
                  <h3 className="mt-s3 font-display text-label font-semibold text-ink">{insight.title}</h3>
                  <p className="mt-s2 font-body text-caption text-ink-72">{insight.detail}</p>
                </div>
                <Link href={insight.links[0]?.href ?? '/investigations'} className="touch-44 inline-flex items-center justify-between rounded-control px-s2 font-display text-label font-semibold text-forest transition-colors hover:bg-forest-08 focus-ring">
                  {insight.links[0]?.label ?? 'Investigasi'}
                  <Icon name="arrow_forward" className="text-[16px]" />
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
