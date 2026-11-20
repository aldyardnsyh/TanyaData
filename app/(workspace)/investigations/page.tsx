'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  AnomaliesResponse,
  CategoryPerformanceResponse,
  ContributionChannel,
  FailureCodeContribution,
  Investigation,
  InvestigationsListResponse,
  InvestigationsOverviewResponse,
  InvestigateResponse,
  MetaResponse,
  TemporalPoint,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatDateEn, formatNumber, formatPercent } from '@/lib/ui/format';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';

/** Material Symbols self-hosted; dekoratif → aria-hidden (blueprint §2). */
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

const num = (value: number | null | undefined) => (value == null ? 'n/a' : formatNumber(value));
const pct = (value: number | null | undefined) => (value == null ? 'n/a' : formatPercent(value));

const CLAIM_LABEL: Record<string, string> = {
  proven: 'Proven',
  measured: 'Measured',
  indication: 'Indication',
};

function axisLabel(bucket: string): string {
  if (!bucket) return '—';
  const parsed = new Date(`${bucket}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return bucket;
  return parsed
    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
    .toUpperCase();
}

function indexForDate(rows: { bucket: string }[], date: string | undefined): number {
  if (!date || rows.length === 0) return -1;
  let index = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].bucket <= date) index = i;
    else break;
  }
  return index;
}

function channelShare(channels: ContributionChannel[], index: number): number {
  const total = channels.reduce((sum, channel) => sum + channel.excessFailures, 0);
  if (total <= 0 || !channels[index]) return 0;
  return (channels[index].excessFailures / total) * 100;
}

export default function InvestigationsPage() {
  const overview = useApi<InvestigationsOverviewResponse>('/api/investigations/overview');
  const anomalies = useApi<AnomaliesResponse>('/api/investigations/anomalies');
  const saved = useApi<InvestigationsListResponse>('/api/investigations?limit=20');
  const meta = useApi<MetaResponse>('/api/meta');
  const categories = useApi<CategoryPerformanceResponse>('/api/dashboard/category-performance');

  const [question, setQuestion] = useState('Why did the transaction failure rate increase?');
  const [channel, setChannel] = useState('');
  const [category, setCategory] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const autoRan = useRef(false);
  const questionRef = useRef<HTMLInputElement>(null);

  const runAnalysis = useCallback(
    async (opts?: { question?: string; channel?: string; category?: string }) => {
      const q = (opts?.question ?? question).trim();
      if (q.length < 3) {
        toast({ status: 'error', message: 'Question must be at least 3 characters.' });
        return;
      }
      setAnalyzing(true);
      setAnalysis(null);
      setError(null);
      setSavedId(null);
      try {
        const period = overview.data?.period;
        const res = await fetch('/api/investigations/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q,
            ...(period ? { period: { start: period.start, end: period.end } } : {}),
            compare: 'like_for_like',
            focus: {
              channel: (opts?.channel ?? channel) || null,
              category: (opts?.category ?? category) || null,
            },
            persist: false,
            lang: 'en',
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        const json: InvestigateResponse = await res.json();
        setAnalysis(json.investigation);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Analysis failed.');
      } finally {
        setAnalyzing(false);
      }
    },
    [question, channel, category, overview.data?.period],
  );

  // Isi working area seperti Stitch: jalankan analisis sekali setelah ringkasan siap.
  useEffect(() => {
    if (autoRan.current || !overview.data) return;
    autoRan.current = true;
    void runAnalysis();
  }, [overview.data, runAnalysis]);

  const saveInvestigation = useCallback(async () => {
    if (!analysis || saving || savedId) return;
    setSaving(true);
    try {
      const period = overview.data?.period;
      const res = await fetch('/api/investigations/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: analysis.question,
          ...(period ? { period: { start: period.start, end: period.end } } : {}),
          compare: 'like_for_like',
          focus: { channel: channel || null, category: category || null },
          persist: true,
          lang: 'en',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: InvestigateResponse = await res.json();
      setSavedId(json.investigation.id);
      saved.retry();
      toast({
        status: 'success',
        message: 'Investigation saved.',
        action: 'Open dossier',
        onAction: () => { window.location.href = `/investigations/${json.investigation.id}`; },
      });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Could not save investigation.' });
    } finally {
      setSaving(false);
    }
  }, [analysis, saving, savedId, channel, category, overview.data?.period, saved]);

  const openHypothesis = () => {
    setFormOpen(true);
    document.getElementById('hypothesis-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => questionRef.current?.focus(), 250);
  };

  const shareSnapshot = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ status: 'success', message: 'Snapshot link copied to clipboard.' });
    } catch {
      toast({ status: 'error', message: 'Could not copy the link.' });
    }
  };

  const failureRate = overview.data?.failureRate;
  const topChannels = overview.data?.topChannels ?? [];
  const changePoints = overview.data?.changePoints ?? [];
  const contributionChannels = analysis?.contribution.channels ?? [];
  const failureCodes = analysis?.contribution.failureCodes ?? [];
  const documents = analysis?.documents ?? [];
  const caveats = analysis?.conclusion.caveats ?? [];
  const temporalPoints = analysis?.temporal.points ?? [];
  const series = analysis?.temporal.series ?? [];
  const primarySeries = series[0];
  const chartRows = primarySeries?.rows ?? [];
  const chartMax = Math.max(1, ...chartRows.map((row) => row.failureRate));
  const chartPath = chartRows
    .map((row, index) => {
      const x = chartRows.length > 1 ? (index / (chartRows.length - 1)) * 1000 : 0;
      const y = 180 - (row.failureRate / chartMax) * 150;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const peakIndex = chartRows.length
    ? chartRows.reduce((best, row, index) => (row.failureRate > chartRows[best].failureRate ? index : best), 0)
    : -1;
  const peak = peakIndex >= 0 ? chartRows[peakIndex] : null;
  const shadeStart = indexForDate(chartRows, temporalPoints[0]?.date);
  const shadeEnd = indexForDate(chartRows, temporalPoints[temporalPoints.length - 1]?.date);
  const shadeX1 = shadeStart >= 0 && chartRows.length > 1 ? (shadeStart / (chartRows.length - 1)) * 1000 : -1;
  const shadeX2 = shadeEnd >= 0 && chartRows.length > 1 ? (shadeEnd / (chartRows.length - 1)) * 1000 : -1;
  const upperLimit = failureRate?.previous ?? 0;
  const upperLimitY = 180 - (upperLimit / chartMax) * 150;
  const axis = [0, 0.14, 0.28, 0.43, 0.57, 0.71, 0.85, 1].map((fraction) => {
    const index = chartRows.length ? Math.min(chartRows.length - 1, Math.round(fraction * (chartRows.length - 1))) : -1;
    return index >= 0 ? axisLabel(chartRows[index].bucket) : '—';
  });
  const dominant = contributionChannels[0];
  const runnerUp = contributionChannels[1];
  const excessTotal = topChannels.reduce((sum, channel) => sum + channel.excessFailures, 0);
  const codeTotal = failureCodes.reduce((sum, code) => sum + code.per1000.nov, 0);
  const claimLevel = analysis?.conclusion.claimLevel ?? 'indication';
  const caseId = analysis?.id ?? saved.data?.items[0]?.id ?? 'n/a';
  const datasetName = meta.data?.data.activeDataset.name ?? 'n/a';
  const periodLabel = overview.data?.period.label ?? meta.data?.data.periodDefaults.label ?? 'n/a';
  const channelNames = [...new Set(topChannels.map((channel) => channel.channelName))];
  const categoryNames = categories.data?.items.map((item) => item.categoryName) ?? [];

  return (
    <div className="print-document">
      {/* Investigation Dossier Ambient Header / Control Bar */}
      <div className="px-space-md lg:px-margin pt-space-lg pb-space-md bg-surface-container-lowest">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
          <div className="flex flex-col">
            <div className="flex items-center gap-space-xs font-label-sm text-label-sm uppercase tracking-wider text-outline mb-1">
              <Icon name="biotech" className="text-[15px] text-primary" />
              <span>Root Cause &amp; Performance Anomaly Engine</span>
              <span>/</span>
              <span className="text-on-surface-variant font-bold">{caseId}</span>
            </div>
            <div className="flex items-baseline gap-space-sm">
              <h1 className="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">Investigations</h1>
              <span className="font-body-md text-body-md text-on-surface-variant">
                Understand performance changes and explore contributing factors.
              </span>
            </div>
          </div>
          {/* Quick Command Buttons */}
          <div className="flex items-center gap-space-xs flex-wrap">
            <button
              type="button"
              onClick={() => document.getElementById('timeline')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className="flex items-center gap-1.5 h-8 px-space-sm rounded bg-surface-container-high text-on-surface font-label-md text-label-md hover:bg-surface-variant transition-colors"
            >
              <Icon name="history" className="text-[16px] text-outline" />
              <span>Timeline View</span>
            </button>
            <button
              type="button"
              onClick={() => void shareSnapshot()}
              className="flex items-center gap-1.5 h-8 px-space-sm rounded bg-surface-container-high text-on-surface font-label-md text-label-md hover:bg-surface-variant transition-colors"
            >
              <Icon name="share" className="text-[16px] text-outline" />
              <span>Share Snapshot</span>
            </button>
            <button
              type="button"
              onClick={openHypothesis}
              className="flex items-center gap-1.5 h-8 px-space-sm rounded bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-all shadow-sm"
            >
              <Icon name="tune" className="text-[16px] text-primary-fixed" />
              <span>Adjust Hypothesis</span>
            </button>
          </div>
        </div>
        {/* Active Investigation Context Banner */}
        <div className="mt-space-md p-space-sm rounded-lg bg-surface-container-low flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
          <div className="flex items-center gap-space-sm min-w-0">
            <div className="w-8 h-8 rounded bg-primary text-on-primary flex items-center justify-center shrink-0">
              <Icon name="emergency" className="text-[18px]" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-space-xs">
                <span className="font-label-md text-label-md text-on-surface font-bold truncate">
                  {caseId}: {analysis?.question ?? 'Failure rate anomaly'}
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary" aria-hidden="true" />
                  {CLAIM_LABEL[claimLevel] ?? claimLevel}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                {failureRate
                  ? `Failure rate ${pct(failureRate.current)} vs ${pct(failureRate.previous)} baseline across ${topChannels.length} channels.`
                  : 'Loading investigation context…'}
              </p>
            </div>
          </div>
          {/* Telemetry Tags Matrix */}
          <div className="flex items-center gap-space-sm flex-wrap text-on-surface-variant shrink-0">
            <div className="flex items-center gap-1 px-space-xs py-1 rounded bg-surface-container-lowest">
              <Icon name="table_chart" className="text-[14px] text-outline" />
              <span className="font-label-sm text-label-sm text-outline">DATASET:</span>
              <span className="font-label-sm text-label-sm text-on-surface font-semibold font-mono">{datasetName}</span>
            </div>
            <div className="flex items-center gap-1 px-space-xs py-1 rounded bg-surface-container-lowest">
              <Icon name="calendar_month" className="text-[14px] text-outline" />
              <span className="font-label-sm text-label-sm text-outline">WINDOW:</span>
              <span className="font-label-sm text-label-sm text-on-surface font-semibold">{periodLabel}</span>
            </div>
            <div className="flex items-center gap-1 px-space-xs py-1 rounded bg-surface-container-lowest">
              <Icon name="query_stats" className="text-[14px] text-outline" />
              <span className="font-label-sm text-label-sm text-outline">METRIC:</span>
              <span className="font-label-sm text-label-sm text-tertiary-container font-semibold">Transaction Failure Rate</span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Working Area */}
      <div className="px-space-md lg:px-margin py-space-md space-y-space-md">
        {/* Adjust Hypothesis form (dibuka dari quick button) */}
        {formOpen && (
          <div id="hypothesis-form" className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm">
            <div className="flex items-center justify-between mb-space-sm">
              <div className="flex items-center gap-2">
                <Icon name="tune" className="text-[20px] text-primary" />
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Adjust Hypothesis</h3>
              </div>
              <button
                type="button"
                aria-label="Close hypothesis form"
                onClick={() => setFormOpen(false)}
                className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                <Icon name="close" className="text-[18px]" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-sm">
              <label className="flex flex-col gap-1">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Question</span>
                <input
                  ref={questionRef}
                  type="text"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  className="h-9 px-space-sm rounded bg-surface-container-low text-on-surface font-body-sm text-body-sm focus-ring"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Channel</span>
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  className="h-9 px-space-sm rounded bg-surface-container-low text-on-surface font-body-sm text-body-sm focus-ring"
                >
                  <option value="">All channels</option>
                  {channelNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Category</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-9 px-space-sm rounded bg-surface-container-low text-on-surface font-body-sm text-body-sm focus-ring"
                >
                  <option value="">All categories</option>
                  {categoryNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Period</span>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    aria-label="Start date"
                    value={start || overview.data?.period.start || ''}
                    onChange={(event) => setStart(event.target.value)}
                    className="h-9 w-full px-2 rounded bg-surface-container-low text-on-surface font-body-sm text-body-sm focus-ring"
                  />
                  <input
                    type="date"
                    aria-label="End date"
                    value={end || overview.data?.period.end || ''}
                    onChange={(event) => setEnd(event.target.value)}
                    className="h-9 w-full px-2 rounded bg-surface-container-low text-on-surface font-body-sm text-body-sm focus-ring"
                  />
                </div>
              </div>
            </div>
            <div className="mt-space-sm flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="h-9 px-space-md rounded bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={analyzing}
                onClick={() => void runAnalysis()}
                className="flex items-center gap-1.5 h-9 px-space-md rounded bg-primary text-on-primary hover:bg-primary-container transition-colors font-label-md text-label-md shadow-sm disabled:opacity-50"
              >
                <Icon name="query_stats" className="text-[16px]" />
                {analyzing ? 'Analyzing…' : 'Run Analysis'}
              </button>
            </div>
          </div>
        )}

        {/* KPI Matrix & Diagnostic Deltas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm">
          <div className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-outline">
              <span className="font-label-sm text-label-sm uppercase tracking-wider">Metric: Failure Rate (Baseline vs Incident)</span>
              <Icon name="warning" className="text-[18px] text-tertiary" />
            </div>
            <div className="mt-space-xs flex items-baseline gap-space-sm">
              <span className="font-metric-display text-metric-display font-bold text-on-surface tabular">
                {overview.loading ? <Skeleton className="h-8 w-20" /> : pct(failureRate?.current)}
              </span>
              <span className="font-body-md text-body-md text-outline">vs prev {pct(failureRate?.previous)}</span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low p-space-xs rounded flex items-center justify-between">
              <div className="flex items-center gap-1 text-tertiary-container">
                <Icon name="arrow_upward" className="text-[16px]" />
                <span className="font-label-md text-label-md font-bold">
                  {failureRate ? `${failureRate.deltaPctPoints >= 0 ? '+' : ''}${failureRate.deltaPctPoints.toFixed(2)} pp Anomaly Delta` : 'n/a'}
                </span>
              </div>
              <span className="font-label-sm text-label-sm bg-tertiary-fixed text-on-tertiary-fixed px-1.5 py-0.5 rounded font-bold uppercase">
                {(failureRate?.deltaPctPoints ?? 0) >= 2 ? 'Significant Shift' : 'Within Range'}
              </span>
            </div>
          </div>
          <div className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-outline">
              <span className="font-label-sm text-label-sm uppercase tracking-wider">Total Affected Volume</span>
              <Icon name="receipt_long" className="text-[18px] text-primary" />
            </div>
            <div className="mt-space-xs flex items-baseline gap-space-sm">
              <span className="font-metric-display text-metric-display font-bold text-on-surface tabular">
                {analyzing ? <Skeleton className="h-8 w-20" /> : num(analysis?.comparison.total.current)}
              </span>
              <span className="font-body-md text-body-md text-outline">transactions impacted</span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low p-space-xs rounded flex items-center justify-between">
              <div className="flex items-center gap-1 text-on-surface-variant">
                <Icon name="payments" className="text-[16px] text-tertiary" />
                <span className="font-label-md text-label-md font-semibold">Excess failures</span>
              </div>
              <span className="font-label-md text-label-md text-tertiary font-bold font-mono">{num(excessTotal)}</span>
            </div>
          </div>
          <div className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-outline">
              <span className="font-label-sm text-label-sm uppercase tracking-wider">Dominant Channel Attribution</span>
              <Icon name="account_balance" className="text-[18px] text-secondary" />
            </div>
            <div className="mt-space-xs flex items-baseline gap-space-sm">
              <span className="font-metric-display text-metric-display font-bold text-primary">
                {dominant?.channelName ?? 'n/a'}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant font-bold">
                {contributionChannels.length ? `${channelShare(contributionChannels, 0).toFixed(1)}% of total spike` : 'n/a'}
              </span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low p-space-xs rounded flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-secondary" aria-hidden="true" />
                <span className="font-label-md text-label-md text-on-surface-variant">
                  Second highest: {runnerUp?.channelName ?? 'n/a'}
                </span>
              </div>
              <span className="font-label-md text-label-md text-on-surface font-semibold font-mono">
                {contributionChannels.length > 1 ? `${channelShare(contributionChannels, 1).toFixed(1)}%` : 'n/a'}
              </span>
            </div>
          </div>
        </div>

        {/* Time-Series Anomaly Detection Section */}
        <div className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-sm pb-space-sm">
            <div>
              <div className="flex items-center gap-space-xs">
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Time-Series Failure Rate &amp; Anomaly Corridor
                </h2>
                <span className="font-label-sm text-label-sm bg-primary-fixed text-on-primary-fixed px-1.5 py-0.5 rounded font-mono">
                  {periodLabel.toUpperCase()}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Failure percentage with control limit and change-point markers.
              </p>
            </div>
            {/* Legend and Visual Filters */}
            <div className="flex items-center gap-space-sm flex-wrap text-label-sm font-label-sm">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-primary-container" aria-hidden="true" />
                <span className="text-on-surface">Observed Rate (%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-outline opacity-40" aria-hidden="true" />
                <span className="text-outline">Upper Control Limit ({pct(upperLimit)})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-tertiary-container opacity-20" aria-hidden="true" />
                <span className="text-tertiary">Incident Shading Zone</span>
              </div>
              {/* Tanpa parameter grain di kontrak analyze → label faktual, bukan kontrol mati. */}
              <span className="px-2 py-1 rounded bg-surface-container text-on-surface font-label-sm text-label-sm">
                Aggregate: {primarySeries?.grain ? primarySeries.grain.charAt(0).toUpperCase() + primarySeries.grain.slice(1) : 'n/a'}
              </span>
            </div>
          </div>
          {/* Anomaly Chart Visualization */}
          <div className="relative w-full pt-space-xs">
            <div className="w-full h-72 relative">
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 1000 240" role="img" aria-label="Failure rate over time">
                {[40, 90, 140, 190].map((y) => (
                  <line key={y} className="text-surface-variant" stroke="currentColor" strokeDasharray="2 2" x1="0" x2="1000" y1={y} y2={y} />
                ))}
                {shadeX1 >= 0 && shadeX2 > shadeX1 && (
                  <polygon
                    className="text-tertiary-container fill-current opacity-15"
                    points={`${shadeX1.toFixed(1)},20 ${shadeX2.toFixed(1)},20 ${shadeX2.toFixed(1)},220 ${shadeX1.toFixed(1)},220`}
                  />
                )}
                {upperLimit > 0 && (
                  <line
                    className="text-outline opacity-40"
                    stroke="currentColor"
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                    x1="0"
                    x2="1000"
                    y1={upperLimitY.toFixed(1)}
                    y2={upperLimitY.toFixed(1)}
                  />
                )}
                {chartPath && (
                  <path className="text-primary-container" d={chartPath} fill="none" stroke="currentColor" strokeWidth="2.5" />
                )}
                {peak && (
                  <>
                    <circle className="fill-tertiary animate-pulse" cx={peakIndex === 0 ? 0 : (peakIndex / Math.max(1, chartRows.length - 1)) * 1000} cy={180 - (peak.failureRate / chartMax) * 150} r="5" />
                    <circle
                      className="stroke-tertiary fill-none opacity-40"
                      cx={peakIndex === 0 ? 0 : (peakIndex / Math.max(1, chartRows.length - 1)) * 1000}
                      cy={180 - (peak.failureRate / chartMax) * 150}
                      r="9"
                      strokeWidth="2"
                    />
                  </>
                )}
              </svg>
              {analyzing && (
                <div className="absolute inset-0 flex items-center justify-center font-body-sm text-body-sm text-on-surface-variant">
                  Analyzing…
                </div>
              )}
              {!analyzing && !chartPath && (
                <div className="absolute inset-0 flex items-center justify-center font-body-sm text-body-sm text-on-surface-variant">
                  {error ?? 'No temporal series available.'}
                </div>
              )}
              {peak && !analyzing && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 lg:left-[51%] bg-surface-container-lowest p-space-sm rounded-lg shadow-md max-w-sm z-10 pointer-events-auto">
                  <div className="flex items-center gap-1 text-tertiary">
                    <Icon name="priority_high" className="text-[16px]" />
                    <span className="font-label-sm text-label-sm uppercase font-bold tracking-wider">Critical Peak Identified</span>
                  </div>
                  <p className="font-label-md text-label-md text-on-surface font-bold mt-0.5">
                    {axisLabel(peak.bucket)}: Peak {pct(peak.failureRate)} failure rate
                  </p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
                    {analysis?.temporal.notes.join(' ') ?? analysis?.conclusion.text ?? 'Observed peak in the selected series.'}
                  </p>
                </div>
              )}
            </div>
            {/* Axis Labels */}
            <div className="flex justify-between items-center text-outline font-label-sm text-label-sm pt-space-xs">
              {axis.map((label, index) => (
                <span key={index} className={index === 4 && peak ? 'text-tertiary font-bold' : ''}>{label}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Factor Contribution & Drill-down Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md">
          {/* Breakdown 1: By Payment Channel */}
          <div className="lg:col-span-6 p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-space-xs">
                <div className="flex items-center gap-space-xs">
                  <Icon name="account_tree" className="text-[20px] text-primary" />
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Contribution by Payment Channel</h3>
                </div>
                <span className="font-label-sm text-label-sm text-outline uppercase font-semibold">Volume &amp; Success Ratio</span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-md">
                Incremental failed volume versus baseline failure rate across rails.
              </p>
              <div className="space-y-space-md">
                {contributionChannels.map((item, index) => (
                  <div key={item.channelName} className={index === 0 ? 'p-space-xs rounded bg-surface-container-low' : ''}>
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-space-xs">
                        <span className="font-label-md text-label-md font-bold text-on-surface">{item.channelName}</span>
                        {index === 0 && (
                          <span className="font-label-sm text-label-sm px-1 rounded bg-tertiary-fixed text-on-tertiary-fixed font-bold uppercase">
                            Spike Anomaly
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-space-sm font-label-sm text-label-sm">
                        <span className="text-tertiary font-bold font-mono">+{num(item.excessFailures)} failed</span>
                        <span className="text-outline">{pct(item.failureRate)} failure</span>
                      </div>
                    </div>
                    <div className={`w-full rounded-full bg-surface-container-highest overflow-hidden flex ${index === 0 ? 'h-3' : 'h-2.5'}`}>
                      <div
                        className={`h-full rounded-full ${index === 0 ? 'bg-tertiary' : index === 1 ? 'bg-primary-container' : index === 2 ? 'bg-primary' : 'bg-secondary-fixed-dim'}`}
                        style={{ width: `${Math.max(2, channelShare(contributionChannels, index))}%` }}
                      />
                    </div>
                  </div>
                ))}
                {!analyzing && contributionChannels.length === 0 && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">{error ?? 'No contribution data available.'}</p>
                )}
              </div>
            </div>
            <div className="mt-space-md pt-space-xs text-on-surface-variant font-body-sm text-body-sm flex items-center gap-1.5">
              <Icon name="info" className="text-[16px] text-primary" />
              <span>Share of excess failures relative to the trailing baseline.</span>
            </div>
          </div>

          {/* Breakdown 2: By Failure Reason Code */}
          <div className="lg:col-span-6 p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-space-xs">
                <div className="flex items-center gap-space-xs">
                  <Icon name="data_object" className="text-[20px] text-primary" />
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Failure Reason Code Diagnostics</h3>
                </div>
                <span className="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container font-mono text-outline">RATE / 1k</span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-sm">
                Failure codes ranked by their rate per 1,000 transactions.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-surface-container-low font-label-sm text-label-sm text-outline uppercase tracking-wider">
                      <th className="py-2 px-space-sm rounded-l">Reason Descriptor</th>
                      <th className="py-2 px-space-sm text-right">Rate / 1k</th>
                      <th className="py-2 px-space-sm text-right">% Total</th>
                      <th className="py-2 px-space-sm rounded-r text-right">Variance Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-0">
                    {failureCodes.map((code: FailureCodeContribution, index) => {
                      const share = codeTotal > 0 ? (code.per1000.nov / codeTotal) * 100 : 0;
                      const spike = code.per1000.oct > 0 && code.per1000.nov >= code.per1000.oct * 2;
                      const rising = code.per1000.nov > code.per1000.oct;
                      return (
                        <tr key={code.failureCode} className="hover:bg-surface-container transition-colors">
                          <td className="py-2.5 px-space-sm">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${index === 0 ? 'bg-tertiary' : rising ? 'bg-secondary' : 'bg-outline'}`} aria-hidden="true" />
                              <div>
                                <span className="font-label-md text-label-md font-bold text-on-surface font-mono">
                                  {code.failureName} ({code.failureCode})
                                </span>
                                <div className="font-body-sm text-body-sm text-outline">
                                  sep {code.per1000.sep} · oct {code.per1000.oct} · nov {code.per1000.nov}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-space-sm text-right font-label-md text-label-md font-mono font-bold text-on-surface">
                            {code.per1000.nov}
                          </td>
                          <td className="py-2.5 px-space-sm text-right font-label-md text-label-md font-mono text-on-surface-variant">
                            {share.toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-space-sm text-right">
                            <span className={`font-label-sm text-label-sm px-1.5 py-0.5 rounded font-bold font-mono ${
                              spike
                                ? 'bg-tertiary-fixed text-on-tertiary-fixed'
                                : rising
                                  ? 'bg-secondary-fixed text-on-secondary-fixed'
                                  : 'bg-surface-container text-on-surface-variant font-medium'
                            }`}>
                              {spike ? `Spike +${(((code.per1000.nov - code.per1000.oct) / code.per1000.oct) * 100).toFixed(0)}%` : rising ? 'Rising' : 'Normal'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {!analyzing && failureCodes.length === 0 && (
                      <tr><td colSpan={4} className="py-3 px-space-sm font-body-sm text-body-sm text-on-surface-variant">No failure code data available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-space-md pt-space-xs text-on-surface-variant font-body-sm text-body-sm flex items-center justify-between">
              <span>{changePoints.length} change points detected</span>
              <a href="#view-raw-payloads" className="text-primary hover:underline font-semibold font-label-sm text-label-sm flex items-center gap-0.5">
                <span>Query payload trace</span>
                <Icon name="arrow_forward" className="text-[14px]" />
              </a>
            </div>
          </div>
        </div>

        {/* Structured Findings & Evidence Matrix */}
        <div className="bg-surface-container-lowest rounded-lg shadow-sm p-space-md">
          <div className="flex items-center justify-between mb-space-md">
            <div>
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Investigation Findings &amp; Evidence Matrix</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Synthesized facts, contributing dimensions, document evidence, and limitations.
              </p>
            </div>
            <span className="font-label-sm text-label-sm px-2 py-1 rounded bg-surface-container font-mono text-outline">4 AUDIT QUADRANTS</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
            {/* Quadrant 1: Observed Facts */}
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 pb-space-xs text-primary">
                  <Icon name="verified" className="text-[18px]" />
                  <h4 className="font-label-md text-label-md font-bold uppercase tracking-wider">Observed Facts</h4>
                </div>
                <ul className="space-y-space-sm pt-space-xs">
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" aria-hidden="true" />
                    <p className="font-body-sm text-body-sm text-on-surface">{analysis?.conclusion.text ?? 'No conclusion available yet.'}</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" aria-hidden="true" />
                    <p className="font-body-sm text-body-sm text-on-surface">
                      <strong className="font-semibold text-tertiary">{dominant?.channelName ?? 'n/a'}</strong> contributes{' '}
                      <strong className="font-semibold">{contributionChannels.length ? `${channelShare(contributionChannels, 0).toFixed(1)}%` : 'n/a'}</strong> of the excess failures.
                    </p>
                  </li>
                </ul>
              </div>
              <div className="pt-space-md font-label-sm text-label-sm text-outline">Claim: {CLAIM_LABEL[claimLevel] ?? claimLevel}</div>
            </div>
            {/* Quadrant 2: Contributing Factors */}
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 pb-space-xs text-tertiary">
                  <Icon name="alt_route" className="text-[18px]" />
                  <h4 className="font-label-md text-label-md font-bold uppercase tracking-wider">Contributing Factors</h4>
                </div>
                <ul className="space-y-space-sm pt-space-xs">
                  {(analysis?.concentration.byChannelCategory ?? []).slice(0, 2).map((item, index) => (
                    <li key={`${item.channelName}-${item.category}-${index}`} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-tertiary mt-1.5 shrink-0" aria-hidden="true" />
                      <p className="font-body-sm text-body-sm text-on-surface">
                        <strong className="font-mono">{item.channelName}</strong> · {item.category} at{' '}
                        <strong className="font-mono text-tertiary font-bold">{pct(item.failureRate)}</strong>.
                      </p>
                    </li>
                  ))}
                  {(analysis?.concentration.byChannelCategory ?? []).length === 0 && (
                    <li className="font-body-sm text-body-sm text-on-surface-variant">No concentration data available.</li>
                  )}
                </ul>
              </div>
              <div className="pt-space-md font-label-sm text-label-sm text-outline">
                By hour: {analysis?.concentration.byHour[0]?.bucket ?? 'n/a'}
              </div>
            </div>
            {/* Quadrant 3: Document Evidence */}
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 pb-space-xs text-secondary">
                  <Icon name="attachment" className="text-[18px]" />
                  <h4 className="font-label-md text-label-md font-bold uppercase tracking-wider">Document Evidence</h4>
                </div>
                <div className="space-y-space-sm pt-space-xs">
                  {documents.slice(0, 2).map((doc, index) => (
                    <div key={`${doc.sourceId}-${index}`} className="p-space-xs bg-surface-container-lowest rounded shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-label-sm text-label-sm font-bold text-on-surface truncate">{doc.docTitle ?? doc.sourceId}</span>
                        <span className="font-label-sm text-label-sm text-outline font-mono">p.{doc.page ?? '—'}</span>
                      </div>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{doc.quote ?? doc.section ?? 'n/a'}</p>
                    </div>
                  ))}
                  {documents.length === 0 && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">No document evidence cited.</p>
                  )}
                </div>
              </div>
              <div className="pt-space-md font-label-sm text-label-sm text-outline">{documents.length} attached artifacts</div>
            </div>
            {/* Quadrant 4: Data Limitations */}
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 pb-space-xs text-outline">
                  <Icon name="help_center" className="text-[18px]" />
                  <h4 className="font-label-md text-label-md font-bold uppercase tracking-wider">Data Limitations</h4>
                </div>
                <ul className="space-y-space-sm pt-space-xs">
                  {caveats.slice(0, 2).map((caveat, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-outline mt-1.5 shrink-0" aria-hidden="true" />
                      <p className="font-body-sm text-body-sm text-on-surface">{caveat}</p>
                    </li>
                  ))}
                  {caveats.length === 0 && (
                    <li className="font-body-sm text-body-sm text-on-surface-variant">No caveats recorded.</li>
                  )}
                </ul>
              </div>
              <div className="pt-space-md font-label-sm text-label-sm text-outline">Caveats: {caveats.length}</div>
            </div>
          </div>
          {/* SQL payload trace (target #view-raw-payloads) */}
          <div id="view-raw-payloads" className="mt-space-md pt-space-xs border-t border-border-structural">
            <div className="flex items-center gap-1.5 mb-space-xs">
              <Icon name="terminal" className="text-[16px] text-primary" />
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Query payload trace</span>
            </div>
            {(analysis?.evidence.sql ?? []).map((query, index) => (
              <pre key={index} className="mb-2 overflow-x-auto rounded-sm bg-inverse-surface p-3 font-mono text-[12.5px] leading-5 text-inverse-on-surface">
                {query}
              </pre>
            ))}
            {(analysis?.evidence.sql ?? []).length === 0 && (
              <p className="font-body-sm text-body-sm text-on-surface-variant">No SQL trace available.</p>
            )}
          </div>
        </div>

        {/* Timeline (target #timeline) */}
        <div id="timeline" className="bg-surface-container-lowest rounded-lg shadow-sm p-space-md">
          <div className="flex items-center gap-2 mb-space-sm">
            <Icon name="history" className="text-[20px] text-primary" />
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Change Timeline</h3>
          </div>
          {temporalPoints.length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">No change points recorded.</p>
          ) : (
            <ol className="space-y-2 border-l-2 border-outline-variant pl-4">
              {temporalPoints.map((point: TemporalPoint, index) => (
                <li key={`${point.channelName}-${point.date}-${index}`} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-tertiary" aria-hidden="true" />
                  <span className="font-body text-label-md font-semibold text-on-surface">{point.channelName}</span>
                  <span className="ml-2 font-body text-body-sm text-on-surface-variant">
                    {formatDateEn(point.date)} · {point.kind}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Saved investigations */}
        <div className="bg-surface-container-lowest rounded-lg shadow-sm p-space-md">
          <div className="flex items-center justify-between mb-space-sm">
            <div className="flex items-center gap-2">
              <Icon name="bookmark_add" className="text-[20px] text-primary" />
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Saved Investigations</h3>
            </div>
            <span className="font-label-sm text-label-sm text-outline">{num(saved.data?.total)} saved</span>
          </div>
          {saved.loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (saved.data?.items ?? []).length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">No saved investigations yet.</p>
          ) : (
            <ul className="space-y-2">
              {saved.data?.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/investigations/${item.id}`}
                    className="block rounded-lg bg-surface-container-low p-space-sm hover:bg-surface-container transition-colors focus-ring"
                  >
                    <span className="font-body text-label-md font-semibold text-on-surface">{item.question}</span>
                    <span className="block font-body-sm text-body-sm text-on-surface-variant">
                      {item.period} · {item.topChannel ?? 'n/a'} · {CLAIM_LABEL[item.claimLevel] ?? item.claimLevel}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bottom Operational Action Bar */}
        <div className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col md:flex-row items-center justify-between gap-space-sm sticky bottom-3 z-30">
          <div className="flex items-center gap-space-sm">
            <Icon name="verified_user" className="text-[20px] text-primary" />
            <div>
              <span className="font-label-md text-label-md text-on-surface font-bold">Investigation {caseId}</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant block">
                Claim level: {CLAIM_LABEL[claimLevel] ?? claimLevel}. Saved dossiers can be reopened from the list.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-space-xs w-full md:w-auto justify-end flex-wrap">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 h-9 px-space-md rounded bg-surface-container-high text-on-surface font-label-md text-label-md hover:bg-surface-variant transition-colors"
            >
              <Icon name="picture_as_pdf" className="text-[18px] text-outline" />
              <span>Export Investigation Dossier (PDF)</span>
            </button>
            {/* Save as Report & Create Jira Ticket dihapus: tidak ada endpoint (blueprint §4.5). */}
            <button
              type="button"
              disabled={!analysis || saving || !!savedId}
              onClick={() => void saveInvestigation()}
              className="flex items-center gap-1.5 h-9 px-space-md rounded bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-all shadow-sm disabled:opacity-50"
            >
              <Icon name="bookmark_add" className="text-[18px] text-primary-fixed" />
              <span>{savedId ? 'Saved' : saving ? 'Saving…' : 'Save Investigation'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
