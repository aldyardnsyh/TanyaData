'use client';

import { useEffect, useState } from 'react';
import { Reveal } from '@/lib/ui/reveal';
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
  { id: 'bulan_ini', label: 'Bulan ini' },
  { id: '7_hari', label: '7 hari' },
  { id: '30_hari', label: '30 hari' },
  { id: 'kustom', label: 'Kustom' },
] as const;

type PresetId = (typeof PERIOD_PRESETS)[number]['id'];

const GRAINS = [
  { id: 'day', label: 'Harian' },
  { id: 'week', label: 'Mingguan' },
  { id: 'month', label: 'Bulanan' },
] as const;

type GrainId = (typeof GRAINS)[number]['id'];

const SELECTED_KPI_KEYS = ['total', 'successful', 'failed', 'successRate', 'failureRate'] as const;

export default function OverviewPage() {
  const [preset, setPreset] = useState<PresetId>('bulan_ini');
  const [grain, setGrain] = useState<GrainId>('day');
  const [period, setPeriod] = useState<Period | null>(null);

  const summary = useApi<DashboardSummaryResponse>('/api/dashboard/summary');
  const trends = useApi<TrendsResponse>(`/api/dashboard/trends?grain=${grain}`);
  const statusDist = useApi<StatusDistributionResponse>('/api/dashboard/status-distribution');
  const channelPerf = useApi<ChannelPerformanceResponse>('/api/dashboard/channel-performance?metric=volume&limit=10');
  const categoryPerf = useApi<CategoryPerformanceResponse>('/api/dashboard/category-performance');
  const insights = useApi<InsightsResponse>('/api/dashboard/insights?limit=3');

  useEffect(() => {
    if (summary.data?.period) setPeriod(summary.data.period);
  }, [summary.data?.period]);

  const loading =
    summary.loading || trends.loading || statusDist.loading || channelPerf.loading || categoryPerf.loading || insights.loading;
  const error =
    summary.error || trends.error || statusDist.error || channelPerf.error || categoryPerf.error || insights.error;

  const kpis = summary.data?.kpis ?? [];
  const empty = summary.data?.empty ?? false;

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      {/* Page header */}
      <Reveal>
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
              onChange={(id) => setPreset(id as PresetId)}
              label="Filter periode"
            />
            <FilterChips
              chips={GRAINS.map((g) => ({ id: g.id, label: g.label }))}
              value={grain}
              onChange={(id) => setGrain(id as GrainId)}
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
      </Reveal>

      {/* Indikator periode parsial + sumber data */}
      <Reveal delay={80}>
        <div className="mb-6 flex flex-wrap items-center gap-4 text-body-sm text-on-surface-variant">
          {summary.data?.period.isPartial && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary-container" aria-hidden="true" />
              {summary.data.period.label}, bulan berjalan belum lengkap.
            </span>
          )}
          {summary.data?.dataset && <span>Sumber: {summary.data.dataset.name}</span>}
        </div>
      </Reveal>

      {/* Empty banner */}
      {empty && !loading && (
        <Reveal delay={120}>
          <div className="mb-6 rounded-md bg-surface-container-low px-4 py-3 font-body text-body-md text-on-surface-variant">
            Tidak ada transaksi pada periode ini. Pilih bulan lain untuk melihat data.
          </div>
        </Reveal>
      )}

      {/* 5 KPI */}
      <Reveal delay={160}>
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {SELECTED_KPI_KEYS.map((key) => {
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
              />
            );
          })}
        </div>
      </Reveal>

      {/* Baris chart: Tren Volume + Distribusi Status */}
      <Reveal delay={240}>
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
            />
          </ChartCard>
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
            />
          </ChartCard>
        </div>
      </Reveal>

      {/* Performa Kanal + Insight Otomatis */}
      <Reveal delay={320}>
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
            />
          </ChartCard>
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
                          className="font-body text-label-sm font-semibold text-primary transition-colors duration-[var(--motion-fast)] hover:underline focus-ring"
                        >
                          {link.label} →
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
      </Reveal>

      {/* Performa Kategori */}
      <Reveal delay={400}>
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
          />
        </ChartCard>
      </Reveal>
    </div>
  );
}
