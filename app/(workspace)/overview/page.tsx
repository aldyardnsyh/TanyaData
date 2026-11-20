'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/ui/fetch-hooks';
import { Skeleton } from '@/components/ui/skeleton';
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

/** Ikon Material Symbols self-hosted; dekoratif → aria-hidden (blueprint §2). */
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

const num = (value: number | null | undefined) => (value == null ? 'n/a' : formatNumber(value));
const pct = (value: number | null | undefined) => (value == null ? 'n/a' : formatPercent(value));

function delta(kpi: Kpi | undefined): string {
  if (!kpi || kpi.changePct == null) return 'n/a';
  return `${kpi.direction === 'down' ? '' : '+'}${formatPercent(kpi.changePct)}`;
}

const PERIOD_PRESETS = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom' },
] as const;

const GRAINS = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
] as const;

const COMPARE = [
  { id: 'like_for_like', label: 'Like-for-like' },
  { id: 'previous', label: 'Previous period' },
  { id: 'none', label: 'None' },
] as const;

type Filters = {
  period: (typeof PERIOD_PRESETS)[number]['id'];
  grain: (typeof GRAINS)[number]['id'];
  compare: (typeof COMPARE)[number]['id'];
  start: string | null;
  end: string | null;
};

const DEFAULT_FILTERS: Filters = {
  period: 'this_month',
  grain: 'day',
  compare: 'like_for_like',
  start: null,
  end: null,
};

function readFilters(): Filters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const period = params.get('period');
  const grain = params.get('grain');
  const compare = params.get('compare');
  return {
    period: PERIOD_PRESETS.some((item) => item.id === period)
      ? (period as Filters['period'])
      : DEFAULT_FILTERS.period,
    grain: GRAINS.some((item) => item.id === grain) ? (grain as Filters['grain']) : DEFAULT_FILTERS.grain,
    compare: COMPARE.some((item) => item.id === compare)
      ? (compare as Filters['compare'])
      : DEFAULT_FILTERS.compare,
    start: params.get('start'),
    end: params.get('end'),
  };
}

function baseParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('period', filters.period);
  params.set('compare', filters.compare);
  if (filters.period === 'custom' && filters.start && filters.end) {
    params.set('start', filters.start);
    params.set('end', filters.end);
  }
  return params;
}

function withParams(endpoint: string, params: URLSearchParams): string {
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${params.toString()}`;
}

function dashboardUrl(endpoint: string, filters: Filters): string {
  return withParams(endpoint, baseParams(filters));
}

function trendsUrl(filters: Filters): string {
  const params = baseParams(filters);
  params.set('grain', filters.grain);
  return withParams('/api/dashboard/trends', params);
}

/** Path garis pembanding pada SVG viewBox 0 0 1000 300. */
function trendPath(values: number[], max: number): string {
  if (values.length === 0) return '';
  if (values.length === 1) return `M 0,${(300 - (values[0] / max) * 260).toFixed(1)}`;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 1000;
      const y = 300 - (value / max) * 260;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function downloadCsv(filename: string, rows: (string | number | null)[][]): void {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n');
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
  const [mounted, setMounted] = useState(false);
  const [openMenu, setOpenMenu] = useState<'dataset' | 'period' | 'compare' | 'tune' | null>(null);
  const [hidden, setHidden] = useState({ success: false, failed: false, trend: false });
  const [activeBar, setActiveBar] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');

  useEffect(() => {
    setFilters(readFilters());
    setHydrated(true);
    setMounted(true);
  }, []);

  // Filter periode & grain tercermin di query string (blueprint §4.2).
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
  const trends = useApi<TrendsResponse>(trendsUrl(filters));
  const statusDist = useApi<StatusDistributionResponse>(
    dashboardUrl('/api/dashboard/status-distribution', filters),
  );
  const channels = useApi<ChannelPerformanceResponse>(
    dashboardUrl('/api/dashboard/channel-performance?metric=volume&limit=10', filters),
  );
  const categories = useApi<CategoryPerformanceResponse>(
    dashboardUrl('/api/dashboard/category-performance', filters),
  );
  const insights = useApi<InsightsResponse>(dashboardUrl('/api/dashboard/insights?limit=3', filters));

  const refresh = () => {
    meta.retry();
    summary.retry();
    trends.retry();
    statusDist.retry();
    channels.retry();
    categories.retry();
    insights.retry();
  };

  const selectDataset = (id: string) => {
    setOpenMenu(null);
    void fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeDatasetId: id }),
    })
      .then(() => refresh())
      .catch(() => {
        /* state lokal tetap; pengguna dapat mencoba lagi */
      });
  };

  const kpis = summary.data?.kpis ?? [];
  const kpi = (key: Kpi['key']) => kpis.find((item) => item.key === key);
  const total = kpi('total');
  const successful = kpi('successful');
  const failed = kpi('failed');
  const successRate = kpi('successRate');
  const failureRate = kpi('failureRate');
  const successValue = kpi('successValue');

  const period = summary.data?.period ?? null;
  const datasetName =
    summary.data?.dataset.name ?? meta.data?.data.activeDataset.name ?? 'n/a';
  const periodLabel = period?.label ?? meta.data?.data.periodDefaults.label ?? 'n/a';
  const compareLabel = period?.compare?.label ?? 'None';
  const grainLabel = GRAINS.find((item) => item.id === filters.grain)?.label ?? 'Daily';

  const statusItems = statusDist.data?.items ?? [];
  const status = (name: string) => statusItems.find((item) => item.status === name);
  const pending = status('PENDING');
  const statusTotal = statusDist.data?.total ?? null;

  const points = trends.data?.points ?? [];
  const chartMax = Math.max(1, ...points.map((point) => point.total));
  const guideLabels = [1, 0.75, 0.5, 0.25, 0].map((fraction) => num(Math.round(chartMax * fraction)));
  const successTrendPath = trendPath(points.map((point) => point.successful), chartMax);
  const peakIndex = points.length
    ? points.reduce((best, point, index) => (point.failed > points[best].failed ? index : best), 0)
    : -1;
  const peakPoint = peakIndex >= 0 ? points[peakIndex] : null;
  const shownIndex = activeBar ?? peakIndex;
  const shownPoint = shownIndex >= 0 ? points[shownIndex] : null;
  const axis = [0, 0.2, 0.4, 0.6, 0.8, 1].map((fraction) => {
    const index = points.length
      ? Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))
      : -1;
    return { label: index >= 0 ? points[index].label : '—', peak: index === peakIndex };
  });

  const channelItems = channels.data?.items ?? [];
  const lowestFailure = channelItems.length
    ? Math.min(...channelItems.map((item) => item.failureRate))
    : null;
  const highestFailure = channelItems.length
    ? Math.max(...channelItems.map((item) => item.failureRate))
    : null;

  const categoryItems = categories.data?.items ?? [];
  const visibleCategories = categoryItems.filter((item) =>
    item.categoryName.toLowerCase().includes(categoryFilter.toLowerCase()),
  );
  const overallFailure = failureRate?.value ?? 0;
  const diagnostic = (rate: number) => {
    if (overallFailure > 0 && rate > overallFailure * 2) return 'Critical';
    if (overallFailure > 0 && rate > overallFailure * 1.3) return 'Investigate';
    return 'Normal';
  };

  const insightItems = insights.data?.items ?? [];
  const circumference = 2 * Math.PI * 38;
  const donut = [
    { item: status('SUCCESS'), color: '#0B4433' },
    { item: status('FAILED'), color: '#CF7656' },
    { item: status('PENDING'), color: '#707974' },
  ];
  let donutOffset = 0;
  const donutArcs = donut.map(({ item, color }) => {
    const length = item ? (item.percent / 100) * circumference : 0;
    const offset = donutOffset;
    donutOffset += length;
    return { color, length, offset, item };
  });

  const menuButton =
    'flex items-center gap-1.5 px-space-sm py-1.5 rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container transition-colors';
  const menuPanel =
    'absolute z-dropdown mt-1 min-w-[220px] rounded-lg border border-outline-variant bg-surface-container-lowest p-1 shadow-lg';
  const menuOption =
    'block w-full rounded px-space-sm py-1.5 text-left font-label-md text-label-md text-on-surface hover:bg-surface-container transition-colors';

  return (
    <div
      className={`p-space-lg flex flex-col gap-space-lg max-w-[1720px] mx-auto w-full transition-opacity duration-150 ease-out ${
        mounted ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Sub-Header / Operational Controls Strip */}
      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-space-md">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-space-xs mb-1">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Executive Console</span>
            <span className="inline-block w-1 h-1 rounded-full bg-outline" aria-hidden="true" />
            <span className="font-label-sm text-label-sm text-primary font-bold uppercase tracking-wider">
              Telemetry Live
            </span>
          </div>
          <div className="flex items-baseline gap-space-sm">
            <h1 className="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">Overview</h1>
            <p className="font-body-md text-body-md text-on-surface-variant truncate">
              Monitor performance and identify meaningful changes across your business data.
            </p>
          </div>
        </div>
        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center gap-space-xs">
          {/* Dataset chip → PUT /api/settings */}
          <div className="relative">
            <button
              type="button"
              className={menuButton}
              aria-haspopup="listbox"
              aria-expanded={openMenu === 'dataset'}
              onClick={() => setOpenMenu(openMenu === 'dataset' ? null : 'dataset')}
            >
              <Icon name="dataset" className="text-[16px] text-primary" />
              <span className="font-label-md text-label-md font-semibold truncate max-w-[150px]">{datasetName}</span>
              <Icon name="arrow_drop_down" className="text-[16px] text-outline" />
            </button>
            {openMenu === 'dataset' && (
              <div className={menuPanel} role="listbox" aria-label="Select dataset">
                {(meta.data?.data.datasetChoices ?? []).map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    role="option"
                    aria-selected={choice.id === (summary.data?.dataset.id ?? meta.data?.data.activeDataset.id)}
                    className={menuOption}
                    onClick={() => selectDataset(choice.id)}
                  >
                    {choice.name}
                  </button>
                ))}
                {(meta.data?.data.datasetChoices ?? []).length === 0 && (
                  <span className="block px-space-sm py-1.5 font-label-md text-label-md text-on-surface-variant">
                    No datasets available
                  </span>
                )}
              </div>
            )}
          </div>
          {/* Date range + grain chip → ?period=&grain= */}
          <div className="relative">
            <button
              type="button"
              className={menuButton}
              aria-haspopup="group"
              aria-expanded={openMenu === 'period'}
              onClick={() => setOpenMenu(openMenu === 'period' ? null : 'period')}
            >
              <Icon name="calendar_today" className="text-[16px] text-outline" />
              <span className="font-label-md text-label-md font-medium">{periodLabel}</span>
              <span className="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-bold">
                {grainLabel}
              </span>
            </button>
            {openMenu === 'period' && (
              <div className={`${menuPanel} min-w-[240px]`} role="group" aria-label="Date range and grain">
                <span className="block px-space-sm py-1 font-label-sm text-label-sm uppercase tracking-wider text-outline">
                  Period
                </span>
                {PERIOD_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={filters.period === preset.id}
                    className={`${menuOption} ${filters.period === preset.id ? 'bg-primary-container text-on-primary' : ''}`}
                    onClick={() => setFilters((current) => ({ ...current, period: preset.id }))}
                  >
                    {preset.label}
                  </button>
                ))}
                {filters.period === 'custom' && (
                  <div className="flex flex-col gap-1 px-space-sm py-1">
                    <input
                      type="date"
                      aria-label="Start date"
                      className="rounded bg-surface-container-low px-2 py-1 font-body-sm text-body-sm text-on-surface"
                      value={filters.start ?? ''}
                      onChange={(event) =>
                        setFilters((current) => ({ ...current, start: event.target.value }))
                      }
                    />
                    <input
                      type="date"
                      aria-label="End date"
                      className="rounded bg-surface-container-low px-2 py-1 font-body-sm text-body-sm text-on-surface"
                      value={filters.end ?? ''}
                      onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))}
                    />
                  </div>
                )}
                <span className="mt-1 block px-space-sm py-1 font-label-sm text-label-sm uppercase tracking-wider text-outline">
                  Grain
                </span>
                {GRAINS.map((grain) => (
                  <button
                    key={grain.id}
                    type="button"
                    aria-pressed={filters.grain === grain.id}
                    className={`${menuOption} ${filters.grain === grain.id ? 'bg-primary-container text-on-primary' : ''}`}
                    onClick={() => setFilters((current) => ({ ...current, grain: grain.id }))}
                  >
                    {grain.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Compare chip → ?compare= */}
          <div className="relative hidden md:block">
            <button
              type="button"
              className={menuButton}
              aria-haspopup="listbox"
              aria-expanded={openMenu === 'compare'}
              onClick={() => setOpenMenu(openMenu === 'compare' ? null : 'compare')}
            >
              <Icon name="compare_arrows" className="text-[16px] text-outline" />
              <span className="font-label-md text-label-md text-on-surface-variant">
                vs. <span className="text-on-surface font-medium">{compareLabel}</span>
              </span>
            </button>
            {openMenu === 'compare' && (
              <div className={menuPanel} role="listbox" aria-label="Comparison">
                {COMPARE.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={filters.compare === option.id}
                    className={menuOption}
                    onClick={() => {
                      setFilters((current) => ({ ...current, compare: option.id }));
                      setOpenMenu(null);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            aria-label="Refresh Dataset"
            type="button"
            onClick={refresh}
            className="p-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant transition-colors flex items-center justify-center"
          >
            <Icon name="refresh" className="text-[18px]" />
          </button>
          <Link
            href="/assistant"
            className="flex items-center gap-1.5 px-space-md py-1.5 rounded-lg bg-primary-container hover:bg-primary text-on-primary font-label-md text-label-md shadow-sm transition-all"
          >
            <Icon name="bolt" className="text-[16px] text-secondary-fixed" />
            <span>Ask TanyaData</span>
          </Link>
        </div>
      </div>

      {/* KPI Metric Blocks (4-column responsive grid) — 4 kartu sesuai Stitch. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Total Transactions</span>
            <Icon name="bar_chart" className="text-[16px] text-outline" />
          </div>
          <div className="my-space-xs flex items-baseline justify-between">
            <span className="font-metric-display text-metric-display text-on-surface font-bold tracking-tight tabular">
              {summary.loading ? <Skeleton className="h-8 w-24" /> : num(total?.value)}
            </span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#C5D94B]/20 text-on-surface font-label-sm text-label-sm font-bold">
              <Icon name="trending_up" className="text-[12px] text-primary font-bold" />
              {delta(total)}
            </span>
          </div>
          <div className="flex items-center justify-between text-on-surface-variant font-body-sm text-body-sm pt-space-xs bg-surface-container-low/50 -mx-space-md -mb-space-md px-space-md py-1">
            <span>Comparison</span>
            <span className="font-label-md text-label-md text-on-surface font-semibold tabular">
              {num(total?.compareValue)} txns
            </span>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Successful Transactions</span>
            <Icon name="check_circle" className="text-[16px] text-primary" />
          </div>
          <div className="my-space-xs flex items-baseline justify-between">
            <span className="font-metric-display text-metric-display text-on-surface font-bold tracking-tight tabular">
              {summary.loading ? <Skeleton className="h-8 w-24" /> : num(successful?.value)}
            </span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary-fixed/60 text-primary font-label-sm text-label-sm font-bold">
              {pct(successRate?.value)} rate
            </span>
          </div>
          <div className="flex items-center justify-between text-on-surface-variant font-body-sm text-body-sm pt-space-xs bg-surface-container-low/50 -mx-space-md -mb-space-md px-space-md py-1">
            <span>Success Value</span>
            <span className="font-label-md text-label-md text-on-surface font-semibold tabular">
              {formatIdr(successValue?.value)}
            </span>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Failed Transactions</span>
            <Icon name="error_med" className="text-[16px] text-[#CF7656]" />
          </div>
          <div className="my-space-xs flex items-baseline justify-between">
            <span className="font-metric-display text-metric-display text-on-surface font-bold tracking-tight tabular">
              {summary.loading ? <Skeleton className="h-8 w-20" /> : num(failed?.value)}
            </span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#CF7656]/15 text-[#CF7656] font-label-sm text-label-sm font-bold">
              <Icon name="arrow_upward" className="text-[12px] text-[#CF7656] font-bold" />
              {pct(failureRate?.value)} ({delta(failed)})
            </span>
          </div>
          <div className="flex items-center justify-between text-on-surface-variant font-body-sm text-body-sm pt-space-xs bg-surface-container-low/50 -mx-space-md -mb-space-md px-space-md py-1">
            <span>Comparison</span>
            <span className="font-label-md text-label-md text-[#CF7656] font-semibold tabular">
              {num(failed?.compareValue)} txns
            </span>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Pending Settlement</span>
            <Icon name="hourglass_empty" className="text-[16px] text-outline" />
          </div>
          <div className="my-space-xs flex items-baseline justify-between">
            <span className="font-metric-display text-metric-display text-on-surface font-bold tracking-tight tabular">
              {statusDist.loading ? <Skeleton className="h-8 w-20" /> : num(pending?.count)}
            </span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm font-semibold">
              {pct(pending?.percent)} pending
            </span>
          </div>
          <div className="flex items-center justify-between text-on-surface-variant font-body-sm text-body-sm pt-space-xs bg-surface-container-low/50 -mx-space-md -mb-space-md px-space-md py-1">
            <span>Status Total</span>
            <span className="font-label-md text-label-md text-on-surface font-semibold tabular">{num(statusTotal)} txns</span>
          </div>
        </div>
      </div>

      {/* Main Visualizations Bento: 2/3 Time Series + 1/3 Channel Donut/Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        {/* Left: Dual Stacked Time Series Chart (8 cols) */}
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-xs">
            <div>
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider block">Telemetry Sequence</span>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                Transaction Performance ({grainLabel})
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-space-sm text-on-surface-variant font-label-sm text-label-sm">
              <button
                type="button"
                aria-pressed={!hidden.success}
                onClick={() => setHidden((current) => ({ ...current, success: !current.success }))}
                className={`flex items-center gap-1.5 ${hidden.success ? 'opacity-40' : ''}`}
              >
                <span className="w-3 h-3 rounded bg-primary" aria-hidden="true" />
                <span>Successful</span>
              </button>
              <button
                type="button"
                aria-pressed={!hidden.failed}
                onClick={() => setHidden((current) => ({ ...current, failed: !current.failed }))}
                className={`flex items-center gap-1.5 ${hidden.failed ? 'opacity-40' : ''}`}
              >
                <span className="w-3 h-3 rounded bg-[#CF7656]" aria-hidden="true" />
                <span>Failed</span>
              </button>
              <button
                type="button"
                aria-pressed={!hidden.trend}
                onClick={() => setHidden((current) => ({ ...current, trend: !current.trend }))}
                className={`flex items-center gap-1.5 ${hidden.trend ? 'opacity-40' : ''}`}
              >
                <span className="w-4 h-0.5 border-t-2 border-dashed border-outline" aria-hidden="true" />
                <span>Success Trend</span>
              </button>
              <div className="h-3 w-px bg-surface-variant" aria-hidden="true" />
              <div className="relative">
                <button
                  type="button"
                  aria-label="Chart settings"
                  aria-expanded={openMenu === 'tune'}
                  onClick={() => setOpenMenu(openMenu === 'tune' ? null : 'tune')}
                  className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface"
                >
                  <Icon name="tune" className="text-[16px]" />
                </button>
                {openMenu === 'tune' && (
                  <div className={`${menuPanel} right-0`} role="group" aria-label="Chart grain">
                    {GRAINS.map((grain) => (
                      <button
                        key={grain.id}
                        type="button"
                        aria-pressed={filters.grain === grain.id}
                        className={`${menuOption} ${filters.grain === grain.id ? 'bg-primary-container text-on-primary' : ''}`}
                        onClick={() => {
                          setFilters((current) => ({ ...current, grain: grain.id }));
                          setOpenMenu(null);
                        }}
                      >
                        {grain.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* High-Precision Telemetry Chart Area */}
          <div className="relative w-full h-[320px] select-none bg-surface-container-low/30 rounded-lg p-2 flex flex-col justify-end">
            <div className="absolute inset-0 p-4 flex flex-col justify-between pointer-events-none opacity-40">
              {guideLabels.map((label, index) => (
                <div
                  key={index}
                  className="w-full flex justify-between items-center text-outline font-label-sm text-label-sm border-b border-[#E1E5DE] pb-0.5"
                >
                  <span className="tabular">{label}</span>
                  <span className="h-px flex-1 mx-2 bg-surface-variant" aria-hidden="true" />
                </div>
              ))}
            </div>
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none p-4"
              preserveAspectRatio="none"
              viewBox="0 0 1000 300"
            >
              {!hidden.trend && successTrendPath && (
                <path d={successTrendPath} fill="none" opacity="0.65" stroke="#707974" strokeDasharray="4,4" strokeWidth="2" />
              )}
              {peakPoint && (
                <line
                  opacity="0.8"
                  stroke="#CF7656"
                  strokeDasharray="2,2"
                  strokeWidth="1.5"
                  x1={(peakIndex / Math.max(1, points.length - 1)) * 1000}
                  x2={(peakIndex / Math.max(1, points.length - 1)) * 1000}
                  y1="40"
                  y2="280"
                />
              )}
            </svg>
            <div className="relative z-10 w-full h-[230px] flex items-end justify-between gap-1 px-4">
              {points.map((point, index) => {
                const successHeight = (point.successful / chartMax) * 230;
                const failedHeight = (point.failed / chartMax) * 230;
                const isPeak = index === peakIndex;
                const isShown = index === shownIndex;
                return (
                  <div
                    key={point.bucket}
                    className="flex-1 flex flex-col items-center justify-end h-full relative cursor-pointer group/bar"
                    onMouseEnter={() => setActiveBar(index)}
                    onFocus={() => setActiveBar(index)}
                    tabIndex={0}
                    role="img"
                    aria-label={`${point.label}: ${num(point.total)} transactions, ${num(point.failed)} failed`}
                  >
                    {isShown && shownPoint && (
                      <div className="absolute -top-24 left-1/2 -translate-x-1/2 z-tooltip bg-surface-container-lowest border border-outline-variant shadow-lg rounded-lg p-2.5 w-56 flex flex-col gap-1 pointer-events-none">
                        <div className="flex items-center justify-between pb-1 border-b border-surface-variant">
                          <span className="font-label-sm text-label-sm text-on-surface font-bold">{shownPoint.label}</span>
                          <span
                            className={`font-label-sm text-label-sm px-1 rounded font-bold ${
                              isPeak ? 'bg-[#CF7656]/20 text-[#CF7656]' : 'bg-surface-container text-on-surface-variant'
                            }`}
                          >
                            {isPeak ? 'Peak' : 'Normal'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between font-body-sm text-body-sm">
                          <span className="text-outline">Total Vol:</span>
                          <span className="font-label-md text-label-md text-on-surface font-bold tabular">
                            {num(shownPoint.total)} txns
                          </span>
                        </div>
                        <div className="flex items-center justify-between font-body-sm text-body-sm">
                          <span className="text-primary flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" /> Success:
                          </span>
                          <span className="text-on-surface font-medium tabular">
                            {num(shownPoint.successful)} ({pct(shownPoint.successRate)})
                          </span>
                        </div>
                        <div className="flex items-center justify-between font-body-sm text-body-sm">
                          <span className="text-[#CF7656] flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#CF7656]" aria-hidden="true" /> Failed:
                          </span>
                          <span className="text-[#CF7656] font-bold tabular">
                            {num(shownPoint.failed)} ({pct(shownPoint.failureRate)})
                          </span>
                        </div>
                      </div>
                    )}
                    {isPeak && (
                      <span
                        className="h-2 w-2 rounded-full bg-[#CF7656] ring-4 ring-[#CF7656]/20 mb-1"
                        aria-hidden="true"
                      />
                    )}
                    {!hidden.failed && (
                      <div
                        className={`w-full ${isPeak ? 'max-w-[16px] ring-1 ring-white' : 'max-w-[14px]'} bg-[#CF7656] rounded-t-sm`}
                        style={{ height: `${failedHeight}px` }}
                      />
                    )}
                    {!hidden.success && (
                      <div
                        className={`w-full ${isPeak ? 'max-w-[16px]' : 'max-w-[14px]'} bg-primary`}
                        style={{ height: `${successHeight}px` }}
                      />
                    )}
                  </div>
                );
              })}
              {points.length === 0 && !trends.loading && (
                <div className="w-full text-center font-body-sm text-body-sm text-on-surface-variant py-16">
                  {trends.error ?? 'No trend data for this filter.'}
                </div>
              )}
            </div>
            <div className="w-full flex justify-between items-center text-outline font-label-sm text-label-sm pt-2 px-2 border-t border-[#E1E5DE]">
              {axis.map((item, index) => (
                <span key={index} className={item.peak ? 'text-[#CF7656] font-bold' : ''}>
                  {item.label}
                  {item.peak ? ' (Peak)' : ''}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-on-surface-variant font-body-sm text-body-sm pt-1">
            <span className="flex items-center gap-1">
              <Icon name="info" className="text-[14px] text-primary" />
              Aggregated from {num(points.length)} buckets. Peak volume reached {num(peakPoint?.total)} txns on{' '}
              {peakPoint?.label ?? 'n/a'}.
            </span>
            <button
              type="button"
              onClick={() =>
                downloadCsv('tanyadata-time-series.csv', [
                  ['Bucket', 'Total', 'Successful', 'Failed', 'Success Rate', 'Failure Rate'],
                  ...points.map((point) => [
                    point.label,
                    point.total,
                    point.successful,
                    point.failed,
                    point.successRate,
                    point.failureRate,
                  ]),
                ])
              }
              className="text-primary font-label-md text-label-md font-semibold hover:underline flex items-center gap-0.5"
            >
              Export Time Series CSV
              <Icon name="download" className="text-[14px]" />
            </button>
          </div>
        </div>

        {/* Right: Status Distribution Donut & Channel Breakdown (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-space-md">
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-space-sm">
              <div>
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider block">Telemetry Ratio</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Status Allocation</h3>
              </div>
              <span className="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface font-mono font-bold tabular">
                {num(statusTotal)} TOTAL
              </span>
            </div>
            <div className="flex items-center justify-center gap-space-md py-space-xs">
              <div className="relative w-36 h-36 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" fill="none" r="38" stroke="#E1E5DE" strokeWidth="12" />
                  {donutArcs.map((arc, index) =>
                    arc.length > 0 ? (
                      <circle
                        key={index}
                        cx="50"
                        cy="50"
                        fill="none"
                        r="38"
                        stroke={arc.color}
                        strokeDasharray={`${arc.length.toFixed(1)} ${circumference.toFixed(1)}`}
                        strokeDashoffset={-arc.offset}
                        strokeLinecap="round"
                        strokeWidth="12"
                      />
                    ) : null,
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-label-sm text-label-sm text-outline uppercase">Health Index</span>
                  <span className="font-metric-display text-metric-display text-primary font-bold leading-none tabular">
                    {pct(successRate?.value)}
                  </span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant font-medium">Clearance</span>
                </div>
              </div>
              <div className="flex flex-col gap-space-xs flex-1">
                {donutArcs.map((arc, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-1 rounded hover:bg-surface-container-low transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: arc.color }}
                        aria-hidden="true"
                      />
                      <span className="font-label-md text-label-md text-on-surface">
                        {arc.item
                          ? arc.item.status.charAt(0) + arc.item.status.slice(1).toLowerCase()
                          : 'n/a'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-label-md text-label-md text-on-surface font-bold block tabular">
                        {num(arc.item?.count)}
                      </span>
                      <span className="font-label-sm text-label-sm text-outline tabular">{pct(arc.item?.percent)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Channel Performance Horizontal Bar Chart */}
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-space-sm flex-1" id="channel">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider block">Routing Split</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Channel Breakdown</h3>
              </div>
              <Icon name="hub" className="text-[18px] text-outline" />
            </div>
            <div className="flex flex-col gap-space-sm mt-1">
              {channelItems.map((channel) => (
                <div
                  key={channel.channelId}
                  className="flex flex-col gap-1 p-2 rounded-lg bg-surface-container-low/60 hover:bg-surface-container transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-label-md text-label-md text-on-surface font-semibold">{channel.channelName}</span>
                      {channel.failureRate === lowestFailure && (
                        <span className="font-label-sm text-label-sm px-1 rounded bg-[#CF7656]/20 text-[#CF7656] font-bold">
                          Lowest
                        </span>
                      )}
                      {channel.failureRate === highestFailure && (
                        <span className="font-label-sm text-label-sm px-1 rounded bg-[#C5D94B] text-on-surface font-bold">
                          Highest
                        </span>
                      )}
                    </div>
                    <span className="font-label-md text-label-md text-on-surface font-bold tabular">
                      {num(channel.total)} txns
                    </span>
                  </div>
                  <div className="w-full bg-[#E1E5DE] h-2 rounded-full overflow-hidden flex">
                    <div className="bg-primary h-full" style={{ width: `${channel.successRate}%` }} />
                    <div className="bg-[#CF7656] h-full" style={{ width: `${channel.failureRate}%` }} />
                  </div>
                  <div className="flex justify-between font-label-sm text-label-sm text-outline">
                    <span>
                      Success: <strong className="text-on-surface tabular">{pct(channel.successRate)}</strong>
                    </span>
                    <span>
                      Fail: <strong className="text-[#CF7656] tabular">{pct(channel.failureRate)}</strong>
                    </span>
                  </div>
                </div>
              ))}
              {channelItems.length === 0 && !channels.loading && (
                <div className="p-2 font-body-sm text-body-sm text-on-surface-variant">
                  {channels.error ?? 'No channel data available.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Category Performance Precision Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="p-space-md flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm bg-surface-container-lowest">
          <div>
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider block">Matrix Categorization</span>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Category Performance Matrix</h3>
          </div>
          <div className="flex items-center gap-space-xs">
            <div className="relative">
              <Icon name="filter_list" className="absolute left-2 top-2 text-[16px] text-outline" />
              <input
                type="text"
                aria-label="Filter category"
                placeholder="Filter category..."
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-8 pl-7 pr-3 rounded bg-surface-container-low text-on-surface font-body-sm text-body-sm focus:outline-none focus:bg-surface-container"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCsv('tanyadata-categories.csv', [
                  ['Category', 'Total Txns', 'Avg Ticket (IDR)', 'Success Rate', 'Failure Rate', 'Period Change'],
                  ...visibleCategories.map((item) => [
                    item.categoryName,
                    item.total,
                    item.avgTicket,
                    item.successRate,
                    item.failureRate,
                    item.changePct,
                  ]),
                ])
              }
              className="flex items-center gap-1 h-8 px-space-sm rounded bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md"
            >
              <Icon name="file_download" className="text-[16px]" />
              <span>Export Table</span>
            </button>
          </div>
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low font-label-sm text-label-sm text-outline uppercase tracking-wider border-b border-[#E1E5DE]">
                <th className="py-2.5 px-space-md font-bold">Category</th>
                <th className="py-2.5 px-space-md text-right font-bold">Total Txns</th>
                <th className="py-2.5 px-space-md text-right font-bold">Avg Ticket (IDR)</th>
                <th className="py-2.5 px-space-md text-right font-bold">Success Rate</th>
                <th className="py-2.5 px-space-md text-right font-bold">Failure Rate</th>
                <th className="py-2.5 px-space-md text-right font-bold">Period Change</th>
                <th className="py-2.5 px-space-md text-center font-bold">Diagnostic Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5DE] font-body-md text-body-md text-on-surface">
              {visibleCategories.map((item) => {
                const statusLabel = diagnostic(item.failureRate);
                return (
                  <tr key={item.categoryName} className="hover:bg-surface-container-low transition-colors group">
                    <td className="py-3 px-space-md font-semibold flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          statusLabel === 'Normal' ? 'bg-primary' : 'bg-[#CF7656]'
                        }`}
                        aria-hidden="true"
                      />
                      <span>{item.categoryName}</span>
                    </td>
                    <td className="py-3 px-space-md text-right font-mono font-medium tabular">{num(item.total)}</td>
                    <td className="py-3 px-space-md text-right font-mono font-semibold text-on-surface tabular">
                      {formatIdr(item.avgTicket)}
                    </td>
                    <td className="py-3 px-space-md text-right font-mono text-primary font-bold tabular">
                      {pct(item.successRate)}
                    </td>
                    <td className="py-3 px-space-md text-right font-mono text-on-surface-variant tabular">
                      {pct(item.failureRate)}
                    </td>
                    <td className="py-3 px-space-md text-right font-mono font-bold text-primary tabular">
                      {item.changePct == null ? 'n/a' : `${item.changePct >= 0 ? '+' : ''}${formatPercent(item.changePct)}`}
                    </td>
                    <td className="py-3 px-space-md text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-sm text-label-sm font-semibold ${
                          statusLabel === 'Critical'
                            ? 'bg-error-container text-on-error-container font-bold'
                            : statusLabel === 'Investigate'
                              ? 'bg-[#CF7656]/20 text-[#CF7656] font-bold'
                              : 'bg-surface-container text-on-surface-variant'
                        }`}
                      >
                        {statusLabel === 'Critical' && <Icon name="warning" className="text-[12px]" />}
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visibleCategories.length === 0 && !categories.loading && (
                <tr>
                  <td colSpan={7} className="py-4 px-space-md text-center font-body-md text-body-md text-on-surface-variant">
                    {categories.error ?? 'No categories match this filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-space-md py-2 bg-surface-container-low/40 flex items-center justify-between text-outline font-label-sm text-label-sm">
          <span>Showing {visibleCategories.length} categories</span>
          <span className="font-mono tabular">{periodLabel}</span>
        </div>
      </div>

      {/* Operational Insights Panel (Actionable Cards) */}
      <div className="flex flex-col gap-space-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <Icon name="lightbulb" className="text-primary text-[20px]" />
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">TanyaData Autonomous Inferences</h3>
          </div>
          <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">
            {insightItems.length} Automated Flags Triggered
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
          {insightItems.map((insight) => {
            const badge =
              insight.severity === 'high'
                ? { label: 'Anomaly Detected', className: 'bg-[#CF7656]/20 text-[#CF7656]', icon: 'show_chart', iconClass: 'text-[#CF7656] text-[18px]', buttonClass: 'text-[#CF7656]' }
                : insight.severity === 'medium'
                  ? { label: 'Channel Exposure', className: 'bg-surface-container-high text-on-surface-variant', icon: 'account_balance', iconClass: 'text-outline text-[18px]', buttonClass: 'text-on-surface' }
                  : { label: 'Optimal Efficiency', className: 'bg-[#C5D94B]/20 text-on-surface', icon: 'qr_code_2', iconClass: 'text-primary text-[18px]', buttonClass: 'text-primary' };
            return (
              <div
                key={insight.id}
                className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col justify-between gap-space-md relative overflow-hidden"
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-label-sm text-label-sm px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <Icon name={badge.icon} className={badge.iconClass} />
                  </div>
                  <p className="font-body-md text-body-md text-on-surface font-medium leading-relaxed">{insight.detail}</p>
                </div>
                <Link
                  href={insight.links[0]?.href ?? '/investigations'}
                  className={`w-full flex items-center justify-between px-space-sm py-2 rounded-lg bg-surface-container-low hover:bg-surface-container font-label-md text-label-md font-bold transition-colors ${badge.buttonClass}`}
                >
                  <span>{insight.links[0]?.label ?? 'Investigate'}</span>
                  <Icon name="arrow_forward" className="text-[16px]" />
                </Link>
              </div>
            );
          })}
          {insightItems.length === 0 && !insights.loading && (
            <div className="md:col-span-3 rounded-xl bg-surface-container-lowest p-space-md shadow-sm font-body-md text-body-md text-on-surface-variant">
              {insights.error ?? 'No insights available for this filter.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
