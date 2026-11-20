'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/ui/fetch-hooks';
import { KpiCard } from '@/components/ui/kpi-card';
import { ChartCard } from '@/components/ui/chart-card';
import { LineChart } from '@/components/charts/line-chart';
import { PieChart } from '@/components/charts/pie-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { Card } from '@/components/ui/card';
import { FilterChips } from '@/components/ui/filter-chips';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatPercent } from '@/lib/ui/format';
import { IconArrowRight } from '@/components/ui/icons';
import type {
  DashboardSummaryResponse,
  TrendsResponse,
  StatusDistributionResponse,
  ChannelPerformanceResponse,
  CategoryPerformanceResponse,
  InsightsResponse,
  Period,
} from '@/lib/contracts/http';

const PERIOD_PRESETS = [
  { id: 'this_month', label: 'Bulan ini' },
  { id: 'last_7_days', label: '7 hari' },
  { id: 'last_30_days', label: '30 hari' },
  { id: 'custom', label: 'Kustom' },
] as const;

type PresetId = (typeof PERIOD_PRESETS)[number]['id'];

const GRAINS = [
  { id: 'day', label: 'Harian' },
  { id: 'week', label: 'Mingguan' },
  { id: 'month', label: 'Bulanan' },
] as const;

type GrainId = (typeof GRAINS)[number]['id'];

const SELECTED_KPI_KEYS = ['total', 'successful', 'failed', 'successRate', 'failureRate'] as const;

/**
 * C-05: teruskan filter periode ke semua endpoint /api/dashboard/*.
 * Backend (dashboardContext) menerima ?period=...&start=...&end=...
 * Grain hanya relevan untuk /trends.
 */
function appendParams(url: string, params: Record<string, string>): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${new URLSearchParams(params).toString()}`;
}

function buildDashboardUrl(
  endpoint: string,
  preset: PresetId,
  start: string | null,
  end: string | null,
): string {
  if (preset === 'custom' && start && end) {
    return appendParams(endpoint, { period: 'custom', start, end });
  }
  if (preset === 'custom') {
    return endpoint;
  }
  return appendParams(endpoint, { period: preset });
}

function trendsUrl(
  endpoint: string,
  preset: PresetId,
  grain: GrainId,
  start: string | null,
  end: string | null,
): string {
  const base = buildDashboardUrl(endpoint, preset, start, end);
  return appendParams(base, { grain: grain });
}

type TableData = { header: string[]; rows: string[][] };

function lineTable(points: { label: string; total: number }[]): TableData {
  return {
    header: ['Periode', 'Total'],
    rows: points.map((p) => [p.label, p.total.toLocaleString('id-ID')]),
  };
}

function pieTable(items: { status: string; count: number; percent: number }[]): TableData {
  return {
    header: ['Status', 'Jumlah', 'Persentase'],
    rows: items.map((i) => [i.status, i.count.toLocaleString('id-ID'), `${i.percent.toFixed(1).replace('.', ',')}%`]),
  };
}

function barTable(items: { channelName?: string; categoryName?: string; total: number }[]): TableData {
  return {
    header: ['Kategori', 'Total'],
    rows: items.map((i) => [
      i.channelName ?? i.categoryName ?? '',
      i.total.toLocaleString('id-ID'),
    ]),
  };
}

export default function OverviewPage() {
  const [preset, setPreset] = useState<PresetId>('this_month');
  const [grain, setGrain] = useState<GrainId>('day');
  const [period, setPeriod] = useState<Period | null>(null);
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  // C-07: count-up hanya sekali saat muat awal; perubahan filter cukup crossfade.
  const [filterChanged, setFilterChanged] = useState(false);
  // C-08/C-33: entrance sekali saat mount, bukan scroll-driven.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const summary = useApi<DashboardSummaryResponse>(buildDashboardUrl('/api/dashboard/summary', preset, customStart, customEnd));
  const trends = useApi<TrendsResponse>(trendsUrl('/api/dashboard/trends', preset, grain, customStart, customEnd));
  const statusDist = useApi<StatusDistributionResponse>(
    buildDashboardUrl('/api/dashboard/status-distribution', preset, customStart, customEnd),
  );
  const channelPerf = useApi<ChannelPerformanceResponse>(
    buildDashboardUrl('/api/dashboard/channel-performance?metric=volume&limit=10', preset, customStart, customEnd),
  );
  const categoryPerf = useApi<CategoryPerformanceResponse>(
    buildDashboardUrl('/api/dashboard/category-performance', preset, customStart, customEnd),
  );
  const insights = useApi<InsightsResponse>(
    buildDashboardUrl('/api/dashboard/insights?limit=3', preset, customStart, customEnd),
  );

  useEffect(() => {
    if (summary.data?.period) setPeriod(summary.data.period);
  }, [summary.data?.period]);

  const loading =
    summary.loading || trends.loading || statusDist.loading || channelPerf.loading || categoryPerf.loading || insights.loading;
  const error =
    summary.error || trends.error || statusDist.error || channelPerf.error || categoryPerf.error || insights.error;

  const kpis = summary.data?.kpis ?? [];
  const empty = summary.data?.empty ?? false;

  // C-07: crossfade 150ms saat filter berubah; kunci unik memicu ulang animasi CSS.
  const filterKey = `${preset}|${grain}|${customStart ?? ''}|${customEnd ?? ''}`;

  const selectPreset = (id: string) => {
    const next = id as PresetId;
    setPreset(next);
    setFilterChanged(true);
    if (next === 'custom') {
      setCustomStart(summary.data?.period?.start ?? customStart);
      setCustomEnd(summary.data?.period?.end ?? customEnd);
    }
  };

  const selectGrain = (id: string) => {
    setGrain(id as GrainId);
    setFilterChanged(true);
  };

  return (
    <div
      className={`mx-auto max-w-[1240px] px-6 py-8 transition-opacity duration-150 ease-out ${
        mounted ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Page header */}
      <div>
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-headline-xl font-bold text-on-surface tracking-tight">Ringkasan</h1>
            <p className="font-body text-body-md text-on-surface-variant mt-0.5">
              {period ? `Periode: ${period.label}` : 'Memuat periode…'}
              {summary.data?.dataset.rowCount != null && ` · ${formatNumber(summary.data.dataset.rowCount)} transaksi`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* A-14/C-18: filter periode & grain = FilterChips (group + aria-pressed), bukan tab. */}
            <FilterChips
              chips={PERIOD_PRESETS.map((p) => ({ id: p.id, label: p.label }))}
              value={preset}
              onChange={(id) => selectPreset(id)}
              label="Filter periode"
            />
            <FilterChips
              chips={GRAINS.map((g) => ({ id: g.id, label: g.label }))}
              value={grain}
              onChange={(id) => selectGrain(id)}
              label="Granularitas tren"
            />
            {/* Muat ulang */}
            <button
              type="button"
              onClick={() => {
                summary.retry();
                trends.retry();
                statusDist.retry();
                channelPerf.retry();
                categoryPerf.retry();
                insights.retry();
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-surface-container-lowest border border-outline-variant px-3 py-1.5 font-body text-label-md text-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
            >
              Muat ulang
            </button>
          </div>
        </div>
      </div>

      {/* Indikator periode parsial + sumber data */}
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-4 text-body-sm text-on-surface-variant">
          {summary.data?.period.isPartial && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary-container" aria-hidden="true" />
              {summary.data.period.label}, bulan berjalan belum lengkap.
            </span>
          )}
          {summary.data?.dataset && <span>Sumber: {summary.data.dataset.name}</span>}
        </div>
      </div>

      {/* Empty banner */}
      {empty && !loading && (
        <div>
          <div className="mb-6 rounded-md bg-surface-container-low px-4 py-3 font-body text-body-md text-on-surface-variant">
            Tidak ada transaksi pada periode ini. Pilih bulan lain untuk melihat data.
          </div>
        </div>
      )}

      {/* 5 KPI */}
      <div key={`kpi-${filterKey}`} className="animate-[crossfade_150ms_ease-out_both]">
        {/* §2.4: 2 kolom mobile (item ke-5 full), 3 tablet, 5 desktop. */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {SELECTED_KPI_KEYS.map((key, index) => {
            const kpi = kpis.find((k) => k.key === key);
            if (!kpi) return null;
            return (
              <KpiCard
                key={key}
                label={kpi.label}
                value={kpi.value}
                format={kpi.format}
                delta={kpi.changePct !== null ? { pct: kpi.changePct, direction: kpi.direction, compareValue: kpi.compareValue } : null}
                tooltip={
                  kpi.key === 'successRate'
                    ? 'Tingkat Keberhasilan = SUCCESS ÷ total'
                    : kpi.key === 'failureRate'
                      ? 'Tingkat Kegagalan = FAILED ÷ total'
                      : undefined
                }
                loading={summary.loading}
                animateCount={!filterChanged}
                className={index === 4 ? 'col-span-2 md:col-span-1' : undefined}
              />
            );
          })}
        </div>
      </div>

      {/* Baris chart: Tren Volume + Distribusi Status */}
      <div key={`chart-${filterKey}`} className="animate-[crossfade_150ms_ease-out_both] mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8">
          <ChartCard
            title="Tren Volume Transaksi"
            subtitle={trends.data ? `${trends.data.points.length} titik data` : undefined}
            loading={trends.loading}
            error={trends.error}
            empty={trends.data?.points.length === 0}
            onRetry={trends.retry}
          >
            <LineChart
              data={trends.data?.points ?? []}
              xKey="label"
              series={[{ key: 'total', label: 'Total' }]}
              title="Tren Volume Transaksi"
              summary={`Volume transaksi per ${grain === 'day' ? 'hari' : grain === 'week' ? 'minggu' : 'bulan'}, ${period?.label ?? ''}`}
              tableData={lineTable(trends.data?.points ?? [])}
            />
          </ChartCard>
          </div>
          <div className="lg:col-span-4">
          <ChartCard
            title="Distribusi Status"
            loading={statusDist.loading}
            error={statusDist.error}
            empty={statusDist.data?.items.length === 0}
            onRetry={statusDist.retry}
          >
            <PieChart
              data={(statusDist.data?.items ?? []).map((item) => ({
                name: item.status,
                value: item.count,
                percent: item.percent,
              }))}
              title="Distribusi Status"
              summary={`Status transaksi: ${statusDist.data?.items.map((i) => `${i.status} ${formatNumber(i.count)} (${formatPercent(i.percent)})`).join(', ') ?? ''}`}
              tableData={pieTable(statusDist.data?.items ?? [])}
            />
          </ChartCard>
          </div>
        </div>

      {/* Performa Kanal + Insight Otomatis */}
      <div key={`perf-${filterKey}`} className="animate-[crossfade_150ms_ease-out_both] mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
          <ChartCard
            title="Performa Kanal"
            loading={channelPerf.loading}
            error={channelPerf.error}
            empty={channelPerf.data?.items.length === 0}
            onRetry={channelPerf.retry}
          >
            <BarChart
              data={channelPerf.data?.items ?? []}
              xKey="channelName"
              series={[{ key: 'total', label: 'Volume' }]}
              title="Performa Kanal"
              summary="Volume transaksi per kanal, urut menurun"
              tableData={barTable(channelPerf.data?.items ?? [])}
            />
          </ChartCard>
          </div>
          <div className="lg:col-span-5">
          <Card title="Insight Otomatis" subtitle={`${insights.data?.items.length ?? 0} temuan`}>
            {insights.loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : insights.error ? (
              <p className="font-body text-body-md text-error">{insights.error}</p>
            ) : insights.data && insights.data.items.length > 0 ? (
              <div className="space-y-3">
                {insights.data.items.map((insight) => (
                  <div key={insight.id} className="rounded-md bg-surface-container-low p-3">
                    <p className="font-body text-label-sm font-semibold text-on-surface">{insight.title}</p>
                    <p className="mt-1 font-body text-body-sm text-on-surface-variant">{insight.detail}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {insight.links.map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          className="inline-flex items-center gap-1 font-body text-label-sm font-semibold text-primary transition-colors duration-[var(--motion-fast)] hover:underline focus-ring"
                        >
                          {link.label}
                          <IconArrowRight className="h-4 w-4" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-body text-body-md text-on-surface-variant">Tidak ada temuan.</p>
            )}
          </Card>
          </div>
        </div>

      {/* Performa Kategori */}
      <div key={`cat-${filterKey}`} className="animate-[crossfade_150ms_ease-out_both]">
        <ChartCard
          title="Performa Kategori"
          loading={categoryPerf.loading}
          error={categoryPerf.error}
          empty={categoryPerf.data?.items.length === 0}
          onRetry={categoryPerf.retry}
        >
          <BarChart
            data={categoryPerf.data?.items ?? []}
            xKey="categoryName"
            series={[{ key: 'total', label: 'Volume' }]}
            title="Performa Kategori"
            summary="Volume transaksi per kategori"
            tableData={barTable(categoryPerf.data?.items ?? [])}
          />
        </ChartCard>
      </div>
    </div>
  );
}
