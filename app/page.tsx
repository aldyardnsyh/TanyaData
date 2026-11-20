'use client';

import Link from 'next/link';
import { useApi } from '@/lib/ui/fetch-hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatPercent } from '@/lib/ui/format';
import type {
  Kpi,
  MetaResponse,
  DashboardSummaryResponse,
  TrendsResponse,
  ChannelPerformanceResponse,
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

/** null → n/a (blueprint §5.5). */
const num = (value: number | null | undefined) => (value == null ? 'n/a' : formatNumber(value));
const pct = (value: number | null | undefined) => (value == null ? 'n/a' : formatPercent(value));

function delta(kpi: Kpi | undefined): string {
  if (!kpi || kpi.changePct == null) return 'n/a';
  return `${kpi.direction === 'down' ? '' : '+'}${formatPercent(kpi.changePct)}`;
}

/** Path SVG dari data tren nyata; mengganti path statis fiktif Stitch. */
function seriesPath(values: number[], max: number, width = 600, top = 20, bottom = 150): string {
  if (values.length === 0) return '';
  if (values.length === 1) return `M 0 ${(bottom - (values[0] / max) * (bottom - top)).toFixed(1)}`;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = bottom - (value / max) * (bottom - top);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function LandingPage() {
  const meta = useApi<MetaResponse>('/api/meta');
  const summary = useApi<DashboardSummaryResponse>('/api/dashboard/summary');
  const trends = useApi<TrendsResponse>('/api/dashboard/trends?grain=day');
  const channels = useApi<ChannelPerformanceResponse>(
    '/api/dashboard/channel-performance?metric=failure_rate&limit=3',
  );
  const insights = useApi<InsightsResponse>('/api/dashboard/insights?limit=2');

  const loading = meta.loading || summary.loading || trends.loading || channels.loading || insights.loading;
  const version = meta.data?.app.version ?? null;
  const dataset = summary.data?.dataset ?? meta.data?.data.activeDataset ?? null;
  const period = summary.data?.period ?? null;
  const docs = meta.data?.data.documents ?? null;
  const capabilities = meta.data?.capabilities ?? null;
  const kpis = summary.data?.kpis ?? [];
  const kpi = (key: Kpi['key']) => kpis.find((item) => item.key === key);

  const total = kpi('total');
  const successRate = kpi('successRate');
  const failed = kpi('failed');

  const points = trends.data?.points ?? [];
  const successValues = points.map((point) => point.successful);
  const failedValues = points.map((point) => point.failed);
  const chartMax = Math.max(1, ...successValues, ...failedValues);
  const successLine = seriesPath(successValues, chartMax);
  const failedLine = seriesPath(failedValues, chartMax);
  const peakIndex = failedValues.length
    ? failedValues.indexOf(Math.max(...failedValues))
    : -1;
  const peakPoint = peakIndex >= 0 ? points[peakIndex] : null;
  const peakX = points.length > 1 ? (peakIndex / (points.length - 1)) * 600 : 0;
  const peakY = peakPoint ? 150 - (peakPoint.failed / chartMax) * 130 : 0;
  const axis = [0, 0.2, 0.4, 0.6, 0.8, 1].map((fraction) => {
    const index = points.length
      ? Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))
      : -1;
    return { label: index >= 0 ? points[index].label : '—', peak: index === peakIndex };
  });

  const channelItems = channels.data?.items ?? [];
  const insightItems = insights.data?.items ?? [];

  return (
    <>
      <main>
        {/* HERO SECTION */}
        <section className="relative w-full px-space-margin py-space-xl overflow-hidden">
          <div className="max-w-7xl mx-auto flex flex-col items-center text-center">
            {/* Pill jujur: workspace lokal + versi aplikasi dari /api/meta.
                Tidak ada klaim "live"/"available" untuk data statis. */}
            <div className="animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:0ms] inline-flex items-center gap-space-xs bg-surface-container-high px-space-md py-1 rounded-full mb-space-md shadow-sm">
              <span className="w-2 h-2 rounded-full bg-secondary-fixed" aria-hidden="true" />
              <span className="font-label-sm text-label-sm text-primary uppercase tracking-wider">
                Local workspace · App v{version ?? 'n/a'}
              </span>
            </div>
            {/* Main Headline */}
            <h1 className="animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:30ms] font-headline-xl text-headline-xl text-on-surface max-w-4xl tracking-tight leading-tight mb-space-md">
              Turn Business Data Into <span className="text-primary italic">Clear Decisions.</span>
            </h1>
            {/* Subtitle */}
            <p className="animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:60ms] font-body-lg text-body-lg text-on-surface-variant max-w-2xl mb-space-xl">
              Explore your business performance, investigate operational issues, and get evidence-backed answers from your data using natural language.
            </p>
            {/* Action Cluster */}
            <div className="animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:90ms] flex flex-wrap items-center justify-center gap-space-md mb-space-xl">
              <a
                className="group relative flex items-center gap-space-sm bg-primary-container text-on-primary px-6 py-3 rounded-lg font-label-md text-label-md shadow-md hover:bg-primary transition-all duration-200"
                href="#demo"
              >
                <span>Explore TanyaData</span>
                <span className="bg-secondary-fixed text-on-secondary-fixed text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                  v{version ?? 'n/a'}
                </span>
                <Icon name="arrow_forward" className="text-sm transition-transform group-hover:translate-x-0.5" />
              </a>
              <a
                className="flex items-center gap-space-xs bg-surface-container-lowest text-on-surface px-6 py-3 rounded-lg font-label-md text-label-md shadow-sm hover:bg-surface-container-high transition-colors"
                href="#how-it-works"
              >
                <Icon name="play_circle" className="text-sm" />
                <span>See How It Works</span>
              </a>
            </div>
            {/* Trust Indicator Strip — klaim fiktif diganti kapabilitas nyata /api/meta. */}
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-outline font-label-sm text-label-sm uppercase mb-space-xl tracking-wider">
              <span className="flex items-center gap-1.5">
                <Icon name="verified_user" className="text-sm text-primary" /> Read-only analytics
              </span>
              <span className="hidden sm:inline opacity-30">•</span>
              <span className="flex items-center gap-1.5">
                <Icon name="database" className="text-sm text-primary" /> SQL: {capabilities?.sql ?? 'n/a'}
              </span>
              <span className="hidden sm:inline opacity-30">•</span>
              <span className="flex items-center gap-1.5">
                <Icon name="terminal" className="text-sm text-primary" /> Search: {capabilities?.rag ?? 'n/a'}
              </span>
            </div>
            {/* PRODUCT PREVIEW MOCKUP */}
            <div
              id="demo"
              className="animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:120ms] w-full bg-surface-container-lowest rounded-xl shadow-xl p-space-md sm:p-space-lg text-left relative"
            >
              {/* Mockup Top Bar / Terminal Header */}
              <div className="flex flex-wrap items-center justify-between gap-space-sm pb-space-md mb-space-md bg-surface-container-low p-space-sm rounded-lg">
                <div className="flex items-center gap-space-sm">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-outline-variant inline-block" aria-hidden="true" />
                    <span className="w-2.5 h-2.5 rounded-full bg-outline-variant inline-block" aria-hidden="true" />
                    <span className="w-2.5 h-2.5 rounded-full bg-outline-variant inline-block" aria-hidden="true" />
                  </div>
                  <div className="h-4 w-px bg-outline-variant mx-1" aria-hidden="true" />
                  <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">
                    {dataset?.name ?? 'Workspace Preview'}
                  </span>
                </div>
                <div className="flex items-center gap-space-xs">
                  <span className="bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm px-2 py-0.5 rounded font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" aria-hidden="true" /> READ ONLY
                  </span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant px-2 py-0.5 bg-surface-container rounded">
                    {period?.label ?? 'n/a'}
                  </span>
                </div>
              </div>
              {/* Telemetry KPI Array — angka fiktif diganti kpis[] + documents /api/meta. */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-space-md mb-space-lg">
                <div className="bg-surface-container-low p-space-md rounded-lg">
                  <span className="font-label-sm text-label-sm text-outline uppercase">Aggregated Volume</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="font-metric-display text-metric-display text-on-surface tracking-tight tabular">
                      {loading ? <Skeleton className="h-8 w-24" /> : num(total?.value)}
                    </span>
                    <span className="font-label-sm text-label-sm text-primary flex items-center bg-primary-fixed/40 px-1 rounded">
                      {delta(total)}
                    </span>
                  </div>
                  <span className="font-body-sm text-body-sm text-on-surface-variant block mt-1">
                    {num(dataset?.rowCount)} rows in dataset
                  </span>
                </div>
                <div className="bg-surface-container-low p-space-md rounded-lg">
                  <span className="font-label-sm text-label-sm text-outline uppercase">Gateway Success Ratio</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="font-metric-display text-metric-display text-on-surface tracking-tight tabular">
                      {loading ? <Skeleton className="h-8 w-20" /> : pct(successRate?.value)}
                    </span>
                    <span className="font-label-sm text-label-sm text-tertiary flex items-center bg-tertiary-fixed/40 px-1 rounded">
                      {delta(successRate)}
                    </span>
                  </div>
                  <span className="font-body-sm text-body-sm text-on-surface-variant block mt-1">
                    {period?.label ?? 'n/a'}
                  </span>
                </div>
                <div className="bg-surface-container-low p-space-md rounded-lg">
                  <span className="font-label-sm text-label-sm text-outline uppercase">Failed Transactions</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="font-metric-display text-metric-display text-on-surface tracking-tight tabular">
                      {loading ? <Skeleton className="h-8 w-20" /> : num(failed?.value)}
                    </span>
                    <span className="font-label-sm text-label-sm text-primary flex items-center bg-primary-fixed/40 px-1 rounded">
                      {delta(failed)}
                    </span>
                  </div>
                  <span className="font-body-sm text-body-sm text-on-surface-variant block mt-1">
                    {num(failed?.compareValue)} in comparison
                  </span>
                </div>
                <div className="bg-surface-container-low p-space-md rounded-lg">
                  <span className="font-label-sm text-label-sm text-outline uppercase">Grounded Documents</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="font-metric-display text-metric-display text-on-surface tracking-tight tabular">
                      {loading ? <Skeleton className="h-8 w-20" /> : num(docs?.total)}
                    </span>
                    <span className="font-label-sm text-label-sm text-primary flex items-center bg-primary-fixed/40 px-1 rounded">
                      {num(docs?.indexed)} indexed
                    </span>
                  </div>
                  <span className="font-body-sm text-body-sm text-on-surface-variant block mt-1">
                    {num(docs?.chunks)} indexed chunks
                  </span>
                </div>
              </div>
              {/* Telemetry Multi-Series Visualizer & Investigation Console Split */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
                {/* Main Chart Panel (7 cols) — path SVG dari /api/dashboard/trends. */}
                <div className="lg:col-span-7 bg-surface-container-low p-space-md rounded-lg flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-space-sm">
                    <div>
                      <h3 className="font-headline-sm text-headline-sm text-on-surface">Transaction Volume Trend</h3>
                      <span className="font-body-sm text-body-sm text-outline">
                        {period?.label ?? 'n/a'} · daily breakdown
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
                        <span className="w-2 h-2 rounded-full bg-primary inline-block" aria-hidden="true" /> Successful
                      </span>
                      <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
                        <span className="w-2 h-2 rounded-full bg-tertiary inline-block" aria-hidden="true" /> Failed
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-48 py-2">
                    <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 600 160">
                      <line stroke="#dee4df" strokeDasharray="3,3" strokeWidth="1" x1="0" x2="600" y1="30" y2="30" />
                      <line stroke="#dee4df" strokeDasharray="3,3" strokeWidth="1" x1="0" x2="600" y1="75" y2="75" />
                      <line stroke="#dee4df" strokeDasharray="3,3" strokeWidth="1" x1="0" x2="600" y1="120" y2="120" />
                      {successLine && (
                        <>
                          <path d={`${successLine} L 600 150 L 0 150 Z`} fill="#b7eed5" fillOpacity="0.3" />
                          <path d={successLine} fill="none" stroke="#0b4433" strokeWidth="2.5" />
                        </>
                      )}
                      {failedLine && (
                        <path d={failedLine} fill="none" stroke="#863d22" strokeDasharray="4,2" strokeWidth="2" />
                      )}
                      {peakPoint && (
                        <>
                          <circle cx={peakX} cy={peakY} fill="#863d22" r="5" />
                          <circle className="animate-ping" cx={peakX} cy={peakY} fill="#863d22" fillOpacity="0.2" r="10" />
                        </>
                      )}
                    </svg>
                  </div>
                  <div className="flex justify-between font-label-sm text-label-sm text-outline pt-2">
                    {axis.map((item, index) => (
                      <span key={index} className={item.peak ? 'text-tertiary font-bold' : ''}>
                        {item.label}
                        {item.peak ? ' (Peak)' : ''}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Conversational Intelligence Widget (5 cols) */}
                <div className="lg:col-span-5 bg-surface p-space-md rounded-lg flex flex-col justify-between shadow-sm">
                  <div className="flex items-center justify-between pb-space-sm mb-space-sm bg-surface-container px-3 py-2 rounded">
                    <div className="flex items-center gap-space-xs">
                      <Icon name="forum" className="text-primary text-base" />
                      <span className="font-label-md text-label-md text-primary font-bold">TanyaData Natural Query</span>
                    </div>
                    <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface px-2 py-0.5 rounded">
                      SQL + FTS5
                    </span>
                  </div>
                  <div className="space-y-3 my-auto">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 rounded bg-primary-container text-on-primary flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                        Q
                      </div>
                      <div className="bg-surface-container-high p-space-sm rounded-lg text-on-surface font-body-md text-body-md w-full">
                        What is the total number of transactions this month?
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 rounded bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                        <Icon name="auto_awesome" className="text-xs" />
                      </div>
                      <div className="bg-surface-container-lowest p-space-sm rounded-lg shadow-sm w-full space-y-2">
                        <div className="font-body-sm text-body-sm text-on-surface leading-relaxed">
                          A total of{' '}
                          <strong className="text-primary font-semibold">{num(total?.value)}</strong> transactions was
                          recorded in {period?.label ?? 'n/a'}, with a success rate of {pct(successRate?.value)}.
                        </div>
                        {/* Sitasi fiktif Stitch → tautan nyata ke sumber data / asisten. */}
                        <div className="pt-2 bg-surface-container-low p-2 rounded flex flex-col gap-1">
                          <span className="font-label-sm text-label-sm text-outline uppercase">Direct Source Evidence:</span>
                          <Link
                            className="flex items-center justify-between text-primary font-label-sm text-label-sm hover:underline"
                            href="/data-sources"
                          >
                            <span className="truncate flex items-center gap-1">
                              <Icon name="description" className="text-xs" /> Browse documents
                            </span>
                            <span className="shrink-0 bg-primary-fixed text-on-primary-fixed-variant px-1 rounded text-[10px]">
                              Docs
                            </span>
                          </Link>
                          <Link
                            className="flex items-center justify-between text-primary font-label-sm text-label-sm hover:underline"
                            href="/assistant"
                          >
                            <span className="truncate flex items-center gap-1">
                              <Icon name="table_view" className="text-xs" /> Ask a question
                            </span>
                            <span className="shrink-0 bg-primary-fixed text-on-primary-fixed-variant px-1 rounded text-[10px]">
                              Open
                            </span>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Input disabled Stitch → link nyata ke /assistant (blueprint §4.1). */}
                  <Link
                    href="/assistant"
                    className="mt-space-sm pt-space-xs flex items-center gap-space-xs bg-surface-container-lowest p-2 rounded-md shadow-inner"
                  >
                    <Icon name="search" className="text-outline text-sm" />
                    <span className="w-full bg-transparent font-body-sm text-body-sm text-outline cursor-pointer">
                      Ask a follow-up question
                    </span>
                    <span className="bg-primary text-on-primary font-label-sm text-label-sm px-2.5 py-1 rounded">
                      Send
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* VALUE PROPOSITION (THREE CORE CAPABILITIES) */}
        <section className="w-full py-space-xl px-space-margin bg-surface-container-low" id="features">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-2xl mb-space-xl">
              <span className="font-label-sm text-label-sm text-primary uppercase tracking-widest font-bold block mb-space-xs">
                Core Intelligence Architecture
              </span>
              <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
                Structured telemetry meets conversational investigation.
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-lg">
              {/* Capability 1 */}
              <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <div className="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center text-primary mb-space-md">
                    <Icon name="analytics" className="text-2xl" />
                  </div>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface mb-space-xs">1. Understand Your Data</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant mb-space-md">
                    Monitor operational business health in real time through interactive metric surfaces, multi-tier anomaly detection, and automated performance baselines.
                  </p>
                </div>
                <div className="bg-surface-container-low p-space-sm rounded-lg">
                  <div className="flex justify-between items-center text-on-surface font-label-sm text-label-sm mb-1">
                    <span>SQL Engine</span>
                    <span className="text-primary font-bold">{capabilities?.sql ?? 'n/a'}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div className="bg-primary h-full rounded-full" style={{ width: '100%' }} />
                  </div>
                </div>
              </div>
              {/* Capability 2 */}
              <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <div className="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center text-primary mb-space-md">
                    <Icon name="chat_bubble" className="text-2xl" />
                  </div>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface mb-space-xs">2. Ask Questions Naturally</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant mb-space-md">
                    Type queries in Plain Indonesian or English. TanyaData transforms conversational language into deterministic, high-performance analytical queries instantly.
                  </p>
                </div>
                <div className="bg-surface-container-low p-space-sm rounded-lg">
                  <div className="flex justify-between items-center text-on-surface font-label-sm text-label-sm mb-1">
                    <span>Success Rate</span>
                    <span className="text-primary font-bold">{pct(successRate?.value)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className="bg-secondary-fixed h-full rounded-full"
                      style={{ width: `${successRate?.value ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>
              {/* Capability 3 */}
              <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <div className="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center text-tertiary mb-space-md">
                    <Icon name="fact_check" className="text-2xl" />
                  </div>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface mb-space-xs">3. Investigate With Evidence</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant mb-space-md">
                    Never accept black-box output. Correlate transactional anomalies directly with operational procedures, vendor SLAs, and PDF post-mortem incident documentation.
                  </p>
                </div>
                <div className="bg-surface-container-low p-space-sm rounded-lg">
                  <div className="flex justify-between items-center text-on-surface font-label-sm text-label-sm mb-1">
                    <span>Indexed Documents</span>
                    <span className="text-tertiary font-bold">
                      {num(docs?.indexed)}/{num(docs?.total)}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div
                      className="bg-tertiary-container h-full rounded-full"
                      style={{ width: `${docs?.total ? (docs.indexed / docs.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS (THREE-STEP PROCESS) */}
        <section className="w-full py-space-xl px-space-margin bg-surface" id="how-it-works">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-space-xl">
              <span className="font-label-sm text-label-sm text-primary uppercase tracking-widest font-bold block mb-space-xs">
                Operational Workflow
              </span>
              <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
                From Unstructured Logs to Board-Level Clarity in Three Steps
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-lg relative">
              {/* Step 1 */}
              <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm relative">
                <div className="text-metric-display font-metric-display text-outline-variant font-bold mb-space-xs">01</div>
                <h4 className="font-headline-sm text-headline-sm text-on-surface mb-space-xs">Connect Your Repositories</h4>
                <p className="font-body-md text-body-md text-on-surface-variant mb-space-md">
                  Upload CSV or XLSX files, or use the bundled SQLite dataset. Add PDF, DOCX, TXT, or MD documents as evidence sources.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="bg-surface-container px-2 py-0.5 rounded font-label-sm text-label-sm text-on-surface-variant">CSV</span>
                  <span className="bg-surface-container px-2 py-0.5 rounded font-label-sm text-label-sm text-on-surface-variant">XLSX</span>
                  <span className="bg-surface-container px-2 py-0.5 rounded font-label-sm text-label-sm text-on-surface-variant">PDF</span>
                  <span className="bg-surface-container px-2 py-0.5 rounded font-label-sm text-label-sm text-on-surface-variant">SQLite</span>
                </div>
              </div>
              {/* Step 2 */}
              <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm relative">
                <div className="text-metric-display font-metric-display text-outline-variant font-bold mb-space-xs">02</div>
                <h4 className="font-headline-sm text-headline-sm text-on-surface mb-space-xs">Inquire Conversationally</h4>
                <p className="font-body-md text-body-md text-on-surface-variant mb-space-md">
                  State your operational question directly. TanyaData parses schema relationships, builds the query pipeline, and filters the active dataset.
                </p>
                <div className="bg-surface-container-low p-space-sm rounded font-body-sm text-body-sm text-primary">
                  What is the total number of transactions this month?
                </div>
              </div>
              {/* Step 3 */}
              <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm relative">
                <div className="text-metric-display font-metric-display text-secondary font-bold mb-space-xs">03</div>
                <h4 className="font-headline-sm text-headline-sm text-on-surface mb-space-xs">Extract Grounded Evidence</h4>
                <p className="font-body-md text-body-md text-on-surface-variant mb-space-md">
                  Review visual summaries backed by query results and highlighted clauses in your indexed documents.
                </p>
                <div className="flex items-center gap-2 text-primary font-label-sm text-label-sm">
                  <Icon name="verified" className="text-sm" />
                  <span>Every answer includes SQL and source citations</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PRODUCT PREVIEW SHOWCASE: DUAL PANE COMPARISON */}
        <section className="w-full py-space-xl px-space-margin bg-surface-container-high" id="evidence">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-space-lg gap-space-md">
              <div>
                <span className="font-label-sm text-label-sm text-primary uppercase tracking-widest font-bold block mb-space-xs">
                  Deep Diagnostics
                </span>
                <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
                  Side-by-Side: Dashboard Telemetry vs Grounded Evidence
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-label-sm text-label-sm text-outline">Read-only view</span>
                <span className="w-2 h-2 rounded-full bg-primary inline-block" aria-hidden="true" />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md">
              {/* Left Pane: Tabular Telemetry Breakdown (7 cols) — data /api/dashboard/channel-performance. */}
              <div className="lg:col-span-7 bg-surface-container-lowest rounded-xl p-space-md shadow-md overflow-hidden flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-space-sm mb-space-sm bg-surface-container-low p-space-xs rounded">
                    <span className="font-label-md text-label-md text-on-surface font-semibold flex items-center gap-1.5">
                      <Icon name="table_chart" className="text-sm text-primary" /> Channel Exception Breakdown
                    </span>
                    <span className="font-label-sm text-label-sm text-outline">Sorted by Delta Failure</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-body-sm text-body-sm">
                      <thead>
                        <tr className="bg-surface-container text-outline font-label-sm text-label-sm uppercase">
                          <th className="py-2 px-3">Gateway / Rail</th>
                          <th className="py-2 px-3 text-right">Transactions</th>
                          <th className="py-2 px-3 text-right">Failure Rate</th>
                          <th className="py-2 px-3 text-right">Share</th>
                          <th className="py-2 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-container">
                        {channelItems.map((channel, index) => (
                          <tr key={channel.channelId} className="hover:bg-surface-container-low transition-colors">
                            <td className="py-2 px-3 font-semibold text-on-surface flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full ${index === 0 ? 'bg-tertiary' : 'bg-secondary'}`}
                                aria-hidden="true"
                              />
                              {channel.channelName}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular">{num(channel.total)}</td>
                            <td className="py-2 px-3 text-right text-tertiary font-bold">
                              {pct(channel.failureRate)}{' '}
                              <span className="text-[10px]">{channel.changePct != null && channel.changePct >= 0 ? '▲' : '▼'}</span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-[11px] text-on-surface-variant tabular">
                              {pct(channel.share)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <Link
                                className="text-primary font-label-sm text-label-sm hover:underline"
                                href={`/assistant?question=${encodeURIComponent(`Why is the failure rate for ${channel.channelName} elevated?`)}`}
                              >
                                Query
                              </Link>
                            </td>
                          </tr>
                        ))}
                        {channelItems.length === 0 && !channels.loading && (
                          <tr>
                            <td colSpan={5} className="py-4 px-3 text-center text-on-surface-variant">
                              {channels.error ?? 'No channel data available.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="mt-space-md pt-space-xs bg-surface-container p-space-xs rounded flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm">
                  <span>Displaying {channelItems.length} channels</span>
                  <span>{period?.label ?? 'n/a'}</span>
                </div>
              </div>
              {/* Right Pane: Evidence & Citations Drawer (5 cols) — data /api/dashboard/insights. */}
              <div className="lg:col-span-5 bg-surface-container-lowest rounded-xl p-space-md shadow-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-space-sm mb-space-sm bg-surface-container-low p-space-xs rounded">
                    <span className="font-label-md text-label-md text-tertiary font-bold flex items-center gap-1.5">
                      <Icon name="menu_book" className="text-sm" /> Grounded Citation Audit
                    </span>
                    <span className="bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm px-2 py-0.5 rounded font-bold uppercase">
                      {insightItems[0]?.severity ?? 'n/a'}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {insightItems.map((insight) => (
                      <div key={insight.id} className="p-space-sm bg-surface-container-low rounded-lg">
                        <span className="font-label-sm text-label-sm text-outline uppercase block mb-1">{insight.title}</span>
                        <p className="font-body-sm text-body-sm text-on-surface">{insight.detail}</p>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-primary">
                          <span className="font-semibold">{insight.channel ?? insight.metric}</span>
                          <span>{insight.period}</span>
                        </div>
                      </div>
                    ))}
                    {insightItems.length === 0 && !insights.loading && (
                      <div className="p-space-sm bg-surface-container-low rounded-lg font-body-sm text-body-sm text-on-surface-variant">
                        {insights.error ?? 'No insights available.'}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-space-md bg-primary-fixed/20 p-space-sm rounded-lg flex items-center gap-space-sm">
                  <Icon name="security" className="text-primary text-xl" />
                  <p className="font-body-sm text-body-sm text-on-surface">
                    Every insight links back to its source query and document references.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CALL TO ACTION SECTION */}
        <section className="w-full py-space-xl px-space-margin bg-primary text-on-primary relative overflow-hidden" id="get-started">
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <span className="bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm px-3 py-1 rounded font-bold uppercase tracking-wider mb-space-sm inline-block">
              Ready to explore
            </span>
            <h2 className="font-headline-xl text-headline-xl text-on-primary tracking-tight mb-space-sm">
              Your Data Has Answers. Start Exploring.
            </h2>
            <p className="font-body-lg text-body-lg text-primary-fixed mb-space-lg max-w-xl mx-auto">
              Explore pre-loaded transaction datasets and ask questions in plain language.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-space-md mb-space-md">
              <Link
                className="w-full sm:w-auto bg-secondary-fixed text-on-secondary-fixed hover:bg-secondary-container px-8 py-3.5 rounded-lg font-headline-sm text-headline-sm font-bold shadow-lg transition-transform hover:scale-[1.02] flex items-center justify-center gap-2"
                href="/overview"
              >
                <span>Get Started Free</span>
                <Icon name="arrow_forward" className="text-sm" />
              </Link>
              <Link
                className="w-full sm:w-auto bg-primary-container text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed px-8 py-3.5 rounded-lg font-label-md text-label-md transition-colors flex items-center justify-center gap-2"
                href="/assistant"
              >
                <span>Open AI Assistant</span>
              </Link>
            </div>
            {/* Trust Badges Under CTA — klaim tak terbukti diganti fakta kontrak. */}
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-primary-fixed font-label-sm text-label-sm">
              <span className="flex items-center gap-1">
                <Icon name="check_circle" className="text-xs" /> No sign-in required
              </span>
              <span className="flex items-center gap-1">
                <Icon name="check_circle" className="text-xs" /> Pre-loaded transaction dataset
              </span>
              <span className="flex items-center gap-1">
                <Icon name="check_circle" className="text-xs" /> Read-only analytics engine
              </span>
            </div>
          </div>
        </section>

        {/* DETAILED LANDING PAGE FOOTER NAVIGATION */}
        <div className="w-full bg-surface-container-lowest px-space-margin py-space-xl">
          <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-space-lg">
            <div className="col-span-2">
              <div className="flex items-center gap-space-xs mb-space-sm">
                <Icon name="dataset" className="h-8 w-8 text-primary" />
                <span className="font-headline-sm text-headline-sm text-primary tracking-tight font-bold">TanyaData</span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-sm mb-space-md">
                AI-Powered Business Analytics Platform.
                <br />
                <em className="text-primary font-semibold">Tanyakan Datanya. Temukan Wawasannya.</em>
              </p>
              <div className="flex gap-3 text-outline">
                <Link className="hover:text-primary transition-colors" href="/" aria-label="Home">
                  <Icon name="public" className="text-lg" />
                </Link>
                <Link className="hover:text-primary transition-colors" href="/assistant" aria-label="AI Assistant">
                  <Icon name="terminal" className="text-lg" />
                </Link>
                <Link className="hover:text-primary transition-colors" href="/data-sources" aria-label="Data Sources">
                  <Icon name="dataset" className="text-lg" />
                </Link>
              </div>
            </div>
            <div>
              <h5 className="font-label-sm text-label-sm text-on-surface uppercase tracking-wider font-bold mb-space-sm">Product</h5>
              <ul className="space-y-2 font-body-sm text-body-sm text-on-surface-variant">
                <li><Link className="hover:text-primary" href="/overview">Executive Telemetry</Link></li>
                <li><Link className="hover:text-primary" href="/assistant">Conversational NLQ</Link></li>
                <li><Link className="hover:text-primary" href="/investigations">Automated Anomaly Trace</Link></li>
                <li><Link className="hover:text-primary" href="/assistant">Evidence Verification Engine</Link></li>
                <li><Link className="hover:text-primary" href="/data-sources">Data Connectors</Link></li>
              </ul>
            </div>
            <div>
              <h5 className="font-label-sm text-label-sm text-on-surface uppercase tracking-wider font-bold mb-space-sm">Capabilities</h5>
              <ul className="space-y-2 font-body-sm text-body-sm text-on-surface-variant">
                <li><Link className="hover:text-primary" href="/assistant">SQL Generation</Link></li>
                <li><Link className="hover:text-primary" href="/assistant">Multi-Tabular Joins</Link></li>
                <li><Link className="hover:text-primary" href="/data-sources">Document Grounding (PDF)</Link></li>
                <li><Link className="hover:text-primary" href="/reports">Audit Log Signatures</Link></li>
                <li><Link className="hover:text-primary" href="/settings">Workspace Preferences</Link></li>
              </ul>
            </div>
            {/* Kolom "Company" fiktif → "Workspace" berisi rute nyata (R-24/R-26). */}
            <div>
              <h5 className="font-label-sm text-label-sm text-on-surface uppercase tracking-wider font-bold mb-space-sm">Workspace</h5>
              <ul className="space-y-2 font-body-sm text-body-sm text-on-surface-variant">
                <li><Link className="hover:text-primary" href="/overview">Overview</Link></li>
                <li><Link className="hover:text-primary" href="/assistant">AI Assistant</Link></li>
                <li><Link className="hover:text-primary" href="/data-sources">Data Sources</Link></li>
                <li><Link className="hover:text-primary" href="/investigations">Investigations</Link></li>
                <li><Link className="hover:text-primary" href="/settings">Settings</Link></li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Footer legal — klaim entitas/lokasi/halaman fiktif dihapus. */}
      <footer className="w-full bg-surface-container-lowest border-t border-[#E1E5DE] py-space-xl">
        <div className="max-w-7xl mx-auto px-space-margin flex flex-col md:flex-row items-center justify-between gap-space-md text-outline font-label-sm text-label-sm">
          <div className="flex items-center gap-space-xs">
            <Icon name="dataset" className="h-5 w-5 text-primary" />
            <span className="font-bold text-on-surface">{meta.data?.app.name ?? 'TanyaData'}</span>
            <span>© {new Date().getFullYear()} TanyaData</span>
          </div>
          <div className="flex items-center gap-space-md">
            <Link className="hover:text-on-surface transition-colors" href="/overview">Overview</Link>
            <Link className="hover:text-on-surface transition-colors" href="/settings">Settings</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
