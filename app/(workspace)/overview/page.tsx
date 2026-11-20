'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { STATUS_KEYS } from '@/lib/i18n/dictionary';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';
import { StatusDot } from '@/components/ui/status-dot';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/filter-chips';
import { formatIdr, formatNumber, formatPercent } from '@/lib/ui/format';
import type {
  Kpi,
  MetaResponse,
  DashboardSummaryResponse,
  TrendsResponse,
  StatusDistributionResponse,
  ChannelPerformanceResponse,
  CategoryPerformanceResponse,
  InsightsResponse,
} from '@/lib/contracts/http';

const num = (value: number | null | undefined) => (value == null ? '—' : formatNumber(value));
const pct = (value: number | null | undefined) => (value == null ? '—' : formatPercent(value));

const PERIOD_PRESETS = [
  { id: 'this_month', label: 'Bulan ini' },
  { id: 'last_7_days', label: '7 hari' },
  { id: 'last_30_days', label: '30 hari' },
  { id: 'custom', label: 'Kustom' },
] as const;
const GRAINS = [
  { id: 'day', label: 'Hari' },
  { id: 'week', label: 'Minggu' },
  { id: 'month', label: 'Bulan' },
] as const;
const COMPARE = [
  { id: 'like_for_like', label: 'Setara' },
  { id: 'previous', label: 'Sebelumnya' },
  { id: 'none', label: 'Tanpa' },
] as const;

type Filters = {
  period: (typeof PERIOD_PRESETS)[number]['id'];
  grain: (typeof GRAINS)[number]['id'];
  compare: (typeof COMPARE)[number]['id'];
  start: string | null;
  end: string | null;
};
const DEFAULT_FILTERS: Filters = { period: 'this_month', grain: 'day', compare: 'like_for_like', start: null, end: null };

function readFilters(): Filters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const period = params.get('period');
  const grain = params.get('grain');
  const compare = params.get('compare');
  return {
    period: PERIOD_PRESETS.some((i) => i.id === period) ? (period as Filters['period']) : DEFAULT_FILTERS.period,
    grain: GRAINS.some((i) => i.id === grain) ? (grain as Filters['grain']) : DEFAULT_FILTERS.grain,
    compare: COMPARE.some((i) => i.id === compare) ? (compare as Filters['compare']) : DEFAULT_FILTERS.compare,
    start: params.get('start'),
    end: params.get('end'),
  };
}

function dashboardUrl(endpoint: string, filters: Filters): string {
  const params = new URLSearchParams();
  params.set('period', filters.period);
  params.set('compare', filters.compare);
  if (filters.period === 'custom' && filters.start && filters.end) {
    params.set('start', filters.start);
    params.set('end', filters.end);
  }
  // Endpoint bisa sudah punya query (mis. channel-performance?metric=volume&limit=10).
  // Pakai '&' agar `limit` tidak jadi "10?period=..." dan `period` tidak hilang.
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}${params.toString()}`;
}

function downloadCsv(filename: string, rows: (string | number | null)[][]): void {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function OverviewPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [activeBar, setActiveBar] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [hidden, setHidden] = useState({ success: false, failed: false });
  const { t } = useI18n();
  const statusLabel = (code: string) => (STATUS_KEYS[code] ? t(STATUS_KEYS[code]) : code);

  useEffect(() => {
    setFilters(readFilters());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams();
    params.set('period', filters.period);
    params.set('grain', filters.grain);
    params.set('compare', filters.compare);
    if (filters.period === 'custom' && filters.start && filters.end) {
      params.set('start', filters.start);
      params.set('end', filters.end);
    }
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [filters, hydrated]);

  const meta = useApi<MetaResponse>('/api/meta');
  const summary = useApi<DashboardSummaryResponse>(dashboardUrl('/api/dashboard/summary', filters));
  const trends = useApi<TrendsResponse>(`${dashboardUrl('/api/dashboard/trends', filters)}&grain=${filters.grain}`);
  const statusDist = useApi<StatusDistributionResponse>(dashboardUrl('/api/dashboard/status-distribution', filters));
  const channels = useApi<ChannelPerformanceResponse>(dashboardUrl('/api/dashboard/channel-performance?metric=volume&limit=10', filters));
  const categories = useApi<CategoryPerformanceResponse>(dashboardUrl('/api/dashboard/category-performance', filters));
  const insights = useApi<InsightsResponse>(dashboardUrl('/api/dashboard/insights?limit=3', filters));

  const refresh = () => {
    [meta, summary, trends, statusDist, channels, categories, insights].forEach((api) => api.retry());
  };

  const kpis = summary.data?.kpis ?? [];
  const kpi = (key: Kpi['key']) => kpis.find((item) => item.key === key);
  const total = kpi('total');
  const successful = kpi('successful');
  const failed = kpi('failed');
  const successRate = kpi('successRate');
  const failureRate = kpi('failureRate');

  const period = summary.data?.period ?? null;
  const periodLabel = period?.label ?? meta.data?.data.periodDefaults.label ?? '—';
  const compareLabel = period?.compare?.label ?? 'Tanpa pembanding';
  const dataset = summary.data?.dataset ?? meta.data?.data.activeDataset ?? null;

  const delta = (item: Kpi | undefined) =>
    item?.changePct == null ? null : { pct: item.changePct, direction: item.direction, compareValue: item.compareValue };

  const points = trends.data?.points ?? [];
  const chartMax = Math.max(1, ...points.map((p) => p.total));
  const shownPoint = activeBar !== null ? points[activeBar] : null;
  const peakIndex = points.length ? points.reduce((best, p, i) => (p.failed > points[best].failed ? i : best), 0) : -1;

  const statusItems = statusDist.data?.items ?? [];
  const status = (name: string) => statusItems.find((item) => item.status === name);
  const statusTotal = statusDist.data?.total ?? null;
  const circumference = 2 * Math.PI * 38;
  let donutOffset = 0;
  const donutArcs = [
    { item: status('SUCCESS'), color: 'var(--color-primary)' },
    { item: status('FAILED'), color: 'var(--color-signal-terracotta)' },
    { item: status('PENDING'), color: 'var(--color-primary-dim)' },
  ].map(({ item, color }) => {
    const length = item ? (item.percent / 100) * circumference : 0;
    const offset = donutOffset;
    donutOffset += length;
    return { item, color, length, offset };
  });

  const channelItems = channels.data?.items ?? [];
  const highestFailure = channelItems.length ? Math.max(...channelItems.map((i) => i.failureRate)) : null;
  const lowestFailure = channelItems.length ? Math.min(...channelItems.map((i) => i.failureRate)) : null;

  const categoryItems = categories.data?.items ?? [];
  const visibleCategories = categoryItems.filter((item) => item.categoryName.toLowerCase().includes(categoryFilter.toLowerCase()));
  const overallFailure = failureRate?.value ?? 0;
  const diagnostic = (rate: number) =>
    overallFailure > 0 && rate > overallFailure * 2 ? 'Kritis' : overallFailure > 0 && rate > overallFailure * 1.3 ? 'Periksa' : 'Normal';

  const insightItems = insights.data?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Ringkasan"
        subtitle="Pantau metrik transaksi dan temukan perubahan yang bermakna antarperiode."
        meta={dataset ? `SQL · FTS5 · ${formatNumber(dataset.rowCount)} ROWS` : undefined}
        metaShort="SQL · FTS5"
        actions={
          <Button variant="secondary" size="sm" onClick={refresh} aria-label="Muat ulang data">
            <Icon name="refresh" className="text-[18px]" aria-hidden="true" />
            Muat ulang
          </Button>
        }
      />

      {/* Header hanya periode + refresh (L-04). Grain pindah ke panel chart. */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <FilterChips chips={PERIOD_PRESETS.map((p) => ({ id: p.id, label: p.label }))} value={filters.period} onChange={(id) => setFilters((c) => ({ ...c, period: id as Filters['period'] }))} label="Filter periode" />
        {filters.period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" aria-label="Tanggal mulai" value={filters.start ?? ''} onChange={(e) => setFilters((c) => ({ ...c, start: e.target.value }))} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring" />
            <input type="date" aria-label="Tanggal akhir" value={filters.end ?? ''} onChange={(e) => setFilters((c) => ({ ...c, end: e.target.value }))} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring" />
          </div>
        )}
        <MonoMeta>{periodLabel} · vs {compareLabel}</MonoMeta>
      </div>

      {/* Asymmetric bento: hero 6, tiga regular 2 dari 12 (S-04 / §3.3). */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <KpiCard hero label={t('kpi.total')} value={total?.value ?? null} format="number" delta={delta(total)} goodDirection="up" note={`vs ${compareLabel}`} meta="SQL · SUMMARY" loading={summary.loading} error={summary.error} onRetry={summary.retry} sparkline={points.map((p) => p.successful)} />
        </div>
        <div className="lg:col-span-2">
          <KpiCard label={t('kpi.successful')} value={successful?.value ?? null} format="number" delta={delta(successful)} goodDirection="up" loading={summary.loading} />
        </div>
        <div className="lg:col-span-2">
          <KpiCard label={t('kpi.successRate')} value={successRate?.value ?? null} format="percent" delta={delta(successRate)} goodDirection="up" loading={summary.loading} />
        </div>
        <div className="lg:col-span-2">
          <KpiCard label={t('kpi.failed')} value={failed?.value ?? null} format="number" delta={delta(failed)} goodDirection="down" loading={summary.loading} />
        </div>
      </div>

      {/* Chart + distribusi: split 8/4 (L-05 KEEP). */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-card border border-border-hairline bg-surface lg:col-span-8">
          <header className="px-5 pb-3 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-body text-headline-sm text-ink">Transaksi per {GRAINS.find((g) => g.id === filters.grain)?.label.toLowerCase()}, {periodLabel}</h2>
                <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Sukses dan gagal, agregat dari dataset aktif.</p>
              </div>
              <MonoMeta>SQL · TRENDS</MonoMeta>
            </div>
          </header>
          <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-3">
                <button type="button" aria-pressed={!hidden.success} onClick={() => setHidden((c) => ({ ...c, success: !c.success }))} className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 font-body text-body-sm text-ink-muted-strong transition-colors hover:bg-row-hover focus-ring">
                  <span className="state-dot" aria-hidden="true" /> Sukses
                </button>
                <button type="button" aria-pressed={!hidden.failed} onClick={() => setHidden((c) => ({ ...c, failed: !c.failed }))} className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 font-body text-body-sm text-ink-muted-strong transition-colors hover:bg-row-hover focus-ring">
                  <span className="state-dot state-dot-error" aria-hidden="true" /> Gagal
                </button>
              </div>
              <FilterChips chips={GRAINS.map((g) => ({ id: g.id, label: g.label }))} value={filters.grain} onChange={(id) => setFilters((c) => ({ ...c, grain: id as Filters['grain'] }))} label="Granularitas" />
            </div>

            {trends.loading ? (
              <div className="h-64 animate-skeleton rounded-control bg-row-hover" />
            ) : trends.error ? (
              <div className="rounded-card border border-signal-terracotta p-4">
                <p className="font-body text-body-md text-error-text">{trends.error}</p>
                <Button size="sm" onClick={trends.retry} className="mt-2">Coba lagi</Button>
              </div>
            ) : points.length === 0 ? (
              <div className="py-12 text-center">
                <p className="font-body text-body-md text-ink">Tidak ada transaksi pada periode ini.</p>
                <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Pilih periode lain untuk melihat data.</p>
                <Button size="sm" onClick={() => setFilters((c) => ({ ...c, period: 'last_30_days' }))} className="mt-4">Periode sebelumnya</Button>
              </div>
            ) : (
              <div key={`${filters.period}-${filters.grain}`} className="animate-crossfade">
                <div className="relative h-64 border-b border-border-hairline">
                  <div className="absolute inset-0 flex flex-col justify-between">
                    {[1, 0.75, 0.5, 0.25, 0].map((f) => (
                      <div key={f} className="flex items-center gap-2 border-b border-border-hairline pb-0.5">
                        <span className="w-12 text-right font-body text-body-sm tabular text-ink-muted-strong">{num(Math.round(chartMax * f))}</span>
                        <span className="h-px flex-1 bg-border-hairline" aria-hidden="true" />
                      </div>
                    ))}
                  </div>
                  <div className="absolute inset-0 ml-14 flex items-end justify-between gap-1 pb-1">
                    {points.map((point, index) => {
                      const shown = index === activeBar;
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
                          className="relative flex h-full flex-1 cursor-default flex-col items-center justify-end focus:outline-none"
                        >
                          {shown && shownPoint && (
                            <div className="animate-crossfade pointer-events-none absolute bottom-full left-1/2 z-tooltip mb-2 w-52 -translate-x-1/2 rounded-card border border-border-hairline bg-surface p-3 shadow-overlay">
                              <p className="font-body text-body-sm font-semibold text-ink">{shownPoint.label}</p>
                              <div className="mt-2 space-y-1 font-body text-body-sm">
                                <div className="flex justify-between"><span className="text-ink-muted-strong">Total</span><span className="tabular text-ink">{num(shownPoint.total)}</span></div>
                                <div className="flex justify-between"><span className="text-ink-muted-strong">Sukses</span><span className="tabular text-primary">{num(shownPoint.successful)}</span></div>
                                <div className="flex justify-between"><span className="text-ink-muted-strong">Gagal</span><span className="tabular text-error-text">{num(shownPoint.failed)}</span></div>
                              </div>
                            </div>
                          )}
                          {!hidden.failed && (
                            <div className={`w-full max-w-3.5 rounded-t-sm bg-signal-terracotta transition-opacity duration-[var(--motion-fast)] ${activeBar !== null && !shown ? 'opacity-40' : 'opacity-100'}`} style={{ height: `${(point.failed / chartMax) * 230}px` }} />
                          )}
                          {!hidden.success && (
                            <div className={`w-full max-w-3.5 bg-primary transition-opacity duration-[var(--motion-fast)] ${activeBar !== null && !shown ? 'opacity-40' : 'opacity-100'} ${index === peakIndex ? 'ring-1 ring-white' : ''}`} style={{ height: `${(point.successful / chartMax) * 230}px` }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-2 flex justify-between pl-14 font-body text-body-sm text-ink-muted-strong">
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
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border-hairline pt-3">
              <MonoMeta>{points.length} BUCKET · {num(statusTotal)} TOTAL</MonoMeta>
              <Button variant="ghost" size="sm" onClick={() => downloadCsv('tanyadata-tren.csv', [['Periode', 'Total', 'Sukses', 'Gagal'], ...points.map((p) => [p.label, p.total, p.successful, p.failed])])}>
                <Icon name="download" className="text-[16px]" aria-hidden="true" /> Ekspor CSV
              </Button>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-6 lg:col-span-4">
          <section className="rounded-card border border-border-hairline bg-surface">
            <header className="px-5 pb-3 pt-4">
              <h2 className="font-body text-headline-sm text-ink">Distribusi status</h2>
            </header>
            <div className="flex items-center gap-4 p-5">
              <div className="relative h-32 w-32 shrink-0">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Distribusi status transaksi">
                  <circle cx="50" cy="50" r="38" fill="none" stroke="var(--color-border-hairline)" strokeWidth="12" />
                  {donutArcs.map((arc, i) => arc.length > 0 && (
                    <circle key={i} cx="50" cy="50" r="38" fill="none" stroke={arc.color} strokeWidth="12" strokeDasharray={`${arc.length.toFixed(1)} ${circumference.toFixed(1)}`} strokeDashoffset={-arc.offset} />
                  ))}
                </svg>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {donutArcs.map((arc, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-2 font-body text-body-sm text-ink-muted-strong">
                      <span className="state-dot shrink-0" style={{ backgroundColor: arc.color }} aria-hidden="true" />
                      <span className="truncate">{arc.item ? statusLabel(arc.item.status) : '—'}</span>
                    </span>
                    <span className="font-body text-body-sm tabular text-ink">{num(arc.item?.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-card border border-border-hairline bg-surface">
            <header className="px-5 pb-3 pt-4">
              <h2 className="font-body text-headline-sm text-ink">Kanal berdasarkan volume</h2>
            </header>
            <div className="space-y-3 p-5">
              {channelItems.map((channel) => (
                <div key={channel.channelId} className="rounded-control border border-border-hairline p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-2 font-body text-body-md font-semibold text-ink">
                      <span className={`state-dot shrink-0 ${channel.failureRate === highestFailure ? 'state-dot-error' : channel.failureRate === lowestFailure ? 'state-dot-active' : ''}`} aria-hidden="true" />
                      <span className="truncate">{channel.channelName}</span>
                    </span>
                    <span className="font-body text-body-sm tabular text-ink">{num(channel.total)}</span>
                  </div>
                  <div className="mt-2 flex h-2 w-full overflow-hidden rounded-control bg-row-hover">
                    <div className="h-full bg-primary" style={{ width: `${channel.successRate}%` }} />
                    <div className="h-full bg-signal-terracotta" style={{ width: `${channel.failureRate}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between font-body text-body-sm">
                    <span className="text-primary tabular">Sukses {pct(channel.successRate)}</span>
                    <span className="text-error-text tabular">Gagal {pct(channel.failureRate)}</span>
                  </div>
                  {channel.failureRate === highestFailure && <p className="mt-1 font-body text-body-sm font-semibold text-error-text">Tertinggi</p>}
                  {channel.failureRate === lowestFailure && <p className="mt-1 font-body text-body-sm font-semibold text-primary">Terendah</p>}
                </div>
              ))}
              {channelItems.length === 0 && !channels.loading && <p className="font-body text-body-md text-ink-muted-strong">Belum ada data kanal pada periode ini.</p>}
            </div>
          </section>
        </div>
      </div>

      {/* Tabel kategori. */}
      <section className="mb-6 overflow-hidden rounded-card border border-border-hairline bg-surface">
        <header className="px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-body text-headline-sm text-ink">Kinerja kategori</h2>
              <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Diurutkan sesuai data dari API.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="text" aria-label="Filter kategori" placeholder="Filter kategori…" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink placeholder:text-ink-muted-strong focus-ring" />
              <Button variant="secondary" size="sm" onClick={() => downloadCsv('tanyadata-kategori.csv', [['Kategori', 'Total', 'Rata-rata', 'Sukses', 'Gagal'], ...visibleCategories.map((i) => [i.categoryName, i.total, i.avgTicket, i.successRate, i.failureRate])])}>
                <Icon name="download" className="text-[16px]" aria-hidden="true" /> Ekspor CSV
              </Button>
            </div>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-canvas">
              <tr>
                {['Kategori', 'Total', 'Rata-rata', 'Sukses', 'Gagal', 'Perubahan', 'Status'].map((h, i) => (
                  <th key={h} className={`whitespace-nowrap px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong ${i > 0 && i < 6 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="animate-crossfade">
              {visibleCategories.map((item) => {
                const statusLabel = diagnostic(item.failureRate);
                return (
                  <tr key={item.categoryName} className="border-t border-border-hairline hover:bg-row-hover">
                    <td className="px-4 py-3 font-body text-body-md text-ink">
                      <span className="inline-flex items-center gap-2">
                        <span className={`state-dot ${statusLabel === 'Normal' ? '' : 'state-dot-error'}`} aria-hidden="true" />
                        {item.categoryName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-body text-body-md tabular text-ink">{num(item.total)}</td>
                    <td className="px-4 py-3 text-right font-body text-body-md tabular text-ink">{formatIdr(item.avgTicket)}</td>
                    <td className="px-4 py-3 text-right font-body text-body-md tabular text-primary">{pct(item.successRate)}</td>
                    <td className="px-4 py-3 text-right font-body text-body-md tabular text-error-text">{pct(item.failureRate)}</td>
                    <td className="px-4 py-3 text-right font-body text-body-md tabular text-ink">{item.changePct == null ? '—' : `${item.changePct >= 0 ? '+' : ''}${formatPercent(item.changePct)}`}</td>
                    <td className="px-4 py-3 text-right font-body text-body-sm font-semibold text-ink-muted-strong">{statusLabel}</td>
                  </tr>
                );
              })}
              {visibleCategories.length === 0 && !categories.loading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center font-body text-body-md text-ink-muted-strong">Tidak ada kategori yang cocok. Hapus filter untuk melihat semua.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border-hairline px-4 py-2"><MonoMeta>{visibleCategories.length} KATEGORI · {periodLabel}</MonoMeta></div>
      </section>

      {/* Temuan dari API, bukan "Autonomous Inferences". */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-headline-lg text-ink">Temuan</h2>
          <MonoMeta>{insightItems.length} TEMUAN · {periodLabel}</MonoMeta>
        </div>
        <MeasurementRule className="mb-6" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {insightItems.map((insight) => (
            <div key={insight.id} className="flex flex-col justify-between rounded-card border border-border-hairline bg-surface p-5">
              <div>
                <StatusDot state={insight.severity === 'high' ? 'error' : 'neutral'} label={insight.severity === 'high' ? 'Prioritas tinggi' : 'Perlu diperiksa'} />
                <p className="mt-3 font-body text-body-md font-semibold text-ink">{insight.title}</p>
                <p className="mt-2 font-body text-body-sm text-ink-muted-strong">{insight.detail}</p>
              </div>
              <Link href={insight.links[0]?.href ?? '/investigations'} className="mt-4 inline-flex min-h-11 items-center justify-between rounded-control px-2 font-body text-label-md font-semibold text-primary transition-colors hover:bg-row-hover focus-ring">
                {insight.links[0]?.label ?? 'Investigasi'}
                <Icon name="arrow_forward" className="text-[16px]" aria-hidden="true" />
              </Link>
            </div>
          ))}
          {insightItems.length === 0 && !insights.loading && (
            <div className="md:col-span-3 rounded-card border border-border-hairline bg-surface p-5">
              <p className="font-body text-body-md text-ink">Belum ada temuan pada periode ini.</p>
              <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Ubah periode atau buka Investigasi untuk analisis lebih lanjut.</p>
              <Link href="/investigations" className="mt-3 inline-flex min-h-11 items-center font-body text-label-md font-semibold text-primary focus-ring">Buka Investigasi</Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
