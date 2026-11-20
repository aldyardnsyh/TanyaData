'use client';

import { use } from 'react';
import Link from 'next/link';
import type {
  ContributionChannel,
  FailureCodeContribution,
  InvestigationDetailResponse,
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

function channelShare(channels: ContributionChannel[], index: number): number {
  const total = channels.reduce((sum, channel) => sum + channel.excessFailures, 0);
  if (total <= 0 || !channels[index]) return 0;
  return (channels[index].excessFailures / total) * 100;
}

export default function InvestigationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useApi<InvestigationDetailResponse>(`/api/investigations/${id}`);
  const meta = useApi<MetaResponse>('/api/meta');

  const shareSnapshot = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ status: 'success', message: 'Snapshot link copied to clipboard.' });
    } catch {
      toast({ status: 'error', message: 'Could not copy the link.' });
    }
  };

  if (data.loading) {
    return (
      <div className="px-space-md lg:px-margin pt-space-lg pb-space-md">
        <Skeleton className="h-8 w-64" />
        <div className="mt-space-md space-y-space-md">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (data.error || !data.data) {
    return (
      <div className="px-space-md lg:px-margin pt-space-lg pb-space-md">
        <div className="p-space-md rounded-lg bg-error-container text-center">
          <Icon name="error" className="text-[26px] text-on-error-container" />
          <p className="mt-2 font-body-md text-body-md text-on-error-container">
            {data.error ?? 'Investigation not found.'}
          </p>
          <Link
            href="/investigations"
            className="mt-3 inline-block px-space-md py-1.5 rounded bg-primary text-on-primary font-label-md text-label-md"
          >
            Back to Investigations
          </Link>
        </div>
      </div>
    );
  }

  const investigation = data.data.investigation;
  const {
    question,
    period,
    comparison,
    contribution,
    concentration,
    temporal,
    documents,
    conclusion,
    evidence,
  } = investigation;
  const channels = contribution.channels;
  const failureCodes = contribution.failureCodes;
  const codeTotal = failureCodes.reduce((sum, code) => sum + code.per1000.nov, 0);
  const claimLevel = conclusion.claimLevel;
  const datasetName = investigation.dataset?.name ?? meta.data?.data.activeDataset.name ?? 'n/a';

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
              <span className="text-on-surface-variant font-bold">{investigation.id}</span>
            </div>
            <div className="flex items-baseline gap-space-sm">
              <h1 className="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">Investigation Dossier</h1>
              <span className="font-body-md text-body-md text-on-surface-variant">{question}</span>
            </div>
          </div>
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
            <Link
              href="/investigations"
              className="flex items-center gap-1.5 h-8 px-space-sm rounded bg-primary-container text-on-primary font-label-md text-label-md hover:bg-primary transition-all shadow-sm"
            >
              <Icon name="arrow_back" className="text-[16px] text-primary-fixed" />
              <span>Back to Investigations</span>
            </Link>
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
                <span className="font-label-md text-label-md text-on-surface font-bold truncate">{investigation.id}: {question}</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary" aria-hidden="true" />
                  {CLAIM_LABEL[claimLevel] ?? claimLevel}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant truncate">{conclusion.text}</p>
            </div>
          </div>
          <div className="flex items-center gap-space-sm flex-wrap text-on-surface-variant shrink-0">
            <div className="flex items-center gap-1 px-space-xs py-1 rounded bg-surface-container-lowest">
              <Icon name="table_chart" className="text-[14px] text-outline" />
              <span className="font-label-sm text-label-sm text-outline">DATASET:</span>
              <span className="font-label-sm text-label-sm text-on-surface font-semibold font-mono">{datasetName}</span>
            </div>
            <div className="flex items-center gap-1 px-space-xs py-1 rounded bg-surface-container-lowest">
              <Icon name="calendar_month" className="text-[14px] text-outline" />
              <span className="font-label-sm text-label-sm text-outline">WINDOW:</span>
              <span className="font-label-sm text-label-sm text-on-surface font-semibold">{period.label}</span>
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
        {/* KPI Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm">
          <div className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-outline">
              <span className="font-label-sm text-label-sm uppercase tracking-wider">Metric: Failure Rate (Baseline vs Incident)</span>
              <Icon name="warning" className="text-[18px] text-tertiary" />
            </div>
            <div className="mt-space-xs flex items-baseline gap-space-sm">
              <span className="font-metric-display text-metric-display font-bold text-on-surface tabular">
                {pct(comparison.failureRate.current)}
              </span>
              <span className="font-body-md text-body-md text-outline">vs prev {pct(comparison.failureRate.previous)}</span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low p-space-xs rounded flex items-center justify-between">
              <div className="flex items-center gap-1 text-tertiary-container">
                <Icon name="arrow_upward" className="text-[16px]" />
                <span className="font-label-md text-label-md font-bold">
                  {comparison.failureRate.deltaPctPoints >= 0 ? '+' : ''}{comparison.failureRate.deltaPctPoints.toFixed(2)} pp Anomaly Delta
                </span>
              </div>
              <span className="font-label-sm text-label-sm bg-tertiary-fixed text-on-tertiary-fixed px-1.5 py-0.5 rounded font-bold uppercase">
                {comparison.failureRate.deltaPctPoints >= 2 ? 'Significant Shift' : 'Within Range'}
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
                {num(comparison.total.current)}
              </span>
              <span className="font-body-md text-body-md text-outline">transactions impacted</span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low p-space-xs rounded flex items-center justify-between">
              <div className="flex items-center gap-1 text-on-surface-variant">
                <Icon name="payments" className="text-[16px] text-tertiary" />
                <span className="font-label-md text-label-md font-semibold">Period change</span>
              </div>
              <span className="font-label-md text-label-md text-tertiary font-bold font-mono">
                {comparison.total.changePct == null ? 'n/a' : `${comparison.total.changePct >= 0 ? '+' : ''}${comparison.total.changePct.toFixed(2)}%`}
              </span>
            </div>
          </div>
          <div className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between text-outline">
              <span className="font-label-sm text-label-sm uppercase tracking-wider">Dominant Channel Attribution</span>
              <Icon name="account_balance" className="text-[18px] text-secondary" />
            </div>
            <div className="mt-space-xs flex items-baseline gap-space-sm">
              <span className="font-metric-display text-metric-display font-bold text-primary">{channels[0]?.channelName ?? 'n/a'}</span>
              <span className="font-label-md text-label-md text-on-surface-variant font-bold">
                {channels.length ? `${channelShare(channels, 0).toFixed(1)}% of total spike` : 'n/a'}
              </span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low p-space-xs rounded flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-secondary" aria-hidden="true" />
                <span className="font-label-md text-label-md text-on-surface-variant">Second highest: {channels[1]?.channelName ?? 'n/a'}</span>
              </div>
              <span className="font-label-md text-label-md text-on-surface font-semibold font-mono">
                {channels.length > 1 ? `${channelShare(channels, 1).toFixed(1)}%` : 'n/a'}
              </span>
            </div>
          </div>
        </div>

        {/* Factor Contribution & Drill-down Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md">
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
                {channels.map((item, index) => (
                  <div key={item.channelName} className={index === 0 ? 'p-space-xs rounded bg-surface-container-low' : ''}>
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-space-xs">
                        <span className="font-label-md text-label-md font-bold text-on-surface">{item.channelName}</span>
                        {index === 0 && (
                          <span className="font-label-sm text-label-sm px-1 rounded bg-tertiary-fixed text-on-tertiary-fixed font-bold uppercase">Spike Anomaly</span>
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
                        style={{ width: `${Math.max(2, channelShare(channels, index))}%` }}
                      />
                    </div>
                  </div>
                ))}
                {channels.length === 0 && <p className="font-body-sm text-body-sm text-on-surface-variant">No contribution data available.</p>}
              </div>
            </div>
            <div className="mt-space-md pt-space-xs text-on-surface-variant font-body-sm text-body-sm flex items-center gap-1.5">
              <Icon name="info" className="text-[16px] text-primary" />
              <span>Share of excess failures relative to the trailing baseline.</span>
            </div>
          </div>

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
                          <td className="py-2.5 px-space-sm text-right font-label-md text-label-md font-mono font-bold text-on-surface">{code.per1000.nov}</td>
                          <td className="py-2.5 px-space-sm text-right font-label-md text-label-md font-mono text-on-surface-variant">{share.toFixed(1)}%</td>
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
                    {failureCodes.length === 0 && (
                      <tr><td colSpan={4} className="py-3 px-space-sm font-body-sm text-body-sm text-on-surface-variant">No failure code data available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-space-md pt-space-xs text-on-surface-variant font-body-sm text-body-sm flex items-center justify-between">
              <span>{temporal.points.length} change points detected</span>
              <a href="#view-raw-payloads" className="text-primary hover:underline font-semibold font-label-sm text-label-sm flex items-center gap-0.5">
                <span>Query payload trace</span>
                <Icon name="arrow_forward" className="text-[14px]" />
              </a>
            </div>
          </div>
        </div>

        {/* Evidence Matrix */}
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
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 pb-space-xs text-primary">
                  <Icon name="verified" className="text-[18px]" />
                  <h4 className="font-label-md text-label-md font-bold uppercase tracking-wider">Observed Facts</h4>
                </div>
                <ul className="space-y-space-sm pt-space-xs">
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" aria-hidden="true" />
                    <p className="font-body-sm text-body-sm text-on-surface">{conclusion.text}</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" aria-hidden="true" />
                    <p className="font-body-sm text-body-sm text-on-surface">
                      <strong className="font-semibold text-tertiary">{channels[0]?.channelName ?? 'n/a'}</strong> contributes{' '}
                      <strong className="font-semibold">{channels.length ? `${channelShare(channels, 0).toFixed(1)}%` : 'n/a'}</strong> of the excess failures.
                    </p>
                  </li>
                </ul>
              </div>
              <div className="pt-space-md font-label-sm text-label-sm text-outline">Claim: {CLAIM_LABEL[claimLevel] ?? claimLevel}</div>
            </div>
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 pb-space-xs text-tertiary">
                  <Icon name="alt_route" className="text-[18px]" />
                  <h4 className="font-label-md text-label-md font-bold uppercase tracking-wider">Contributing Factors</h4>
                </div>
                <ul className="space-y-space-sm pt-space-xs">
                  {concentration.byChannelCategory.slice(0, 2).map((item, index) => (
                    <li key={`${item.channelName}-${item.category}-${index}`} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-tertiary mt-1.5 shrink-0" aria-hidden="true" />
                      <p className="font-body-sm text-body-sm text-on-surface">
                        <strong className="font-mono">{item.channelName}</strong> · {item.category} at{' '}
                        <strong className="font-mono text-tertiary font-bold">{pct(item.failureRate)}</strong>.
                      </p>
                    </li>
                  ))}
                  {concentration.byChannelCategory.length === 0 && (
                    <li className="font-body-sm text-body-sm text-on-surface-variant">No concentration data available.</li>
                  )}
                </ul>
              </div>
              <div className="pt-space-md font-label-sm text-label-sm text-outline">By hour: {concentration.byHour[0]?.bucket ?? 'n/a'}</div>
            </div>
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
                  {documents.length === 0 && <p className="font-body-sm text-body-sm text-on-surface-variant">No document evidence cited.</p>}
                </div>
              </div>
              <div className="pt-space-md font-label-sm text-label-sm text-outline">{documents.length} attached artifacts</div>
            </div>
            <div className="p-space-sm rounded-lg bg-surface-container-low flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 pb-space-xs text-outline">
                  <Icon name="help_center" className="text-[18px]" />
                  <h4 className="font-label-md text-label-md font-bold uppercase tracking-wider">Data Limitations</h4>
                </div>
                <ul className="space-y-space-sm pt-space-xs">
                  {conclusion.caveats.slice(0, 2).map((caveat, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-outline mt-1.5 shrink-0" aria-hidden="true" />
                      <p className="font-body-sm text-body-sm text-on-surface">{caveat}</p>
                    </li>
                  ))}
                  {conclusion.caveats.length === 0 && (
                    <li className="font-body-sm text-body-sm text-on-surface-variant">No caveats recorded.</li>
                  )}
                </ul>
              </div>
              <div className="pt-space-md font-label-sm text-label-sm text-outline">Caveats: {conclusion.caveats.length}</div>
            </div>
          </div>
          <div id="view-raw-payloads" className="mt-space-md pt-space-xs border-t border-border-structural">
            <div className="flex items-center gap-1.5 mb-space-xs">
              <Icon name="terminal" className="text-[16px] text-primary" />
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Query payload trace</span>
            </div>
            {evidence.sql.map((query, index) => (
              <pre key={index} className="mb-2 overflow-x-auto rounded-sm bg-inverse-surface p-3 font-mono text-[12.5px] leading-5 text-inverse-on-surface">
                {query}
              </pre>
            ))}
            {evidence.sql.length === 0 && <p className="font-body-sm text-body-sm text-on-surface-variant">No SQL trace available.</p>}
          </div>
        </div>

        {/* Timeline */}
        <div id="timeline" className="bg-surface-container-lowest rounded-lg shadow-sm p-space-md">
          <div className="flex items-center gap-2 mb-space-sm">
            <Icon name="history" className="text-[20px] text-primary" />
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Change Timeline</h3>
          </div>
          {temporal.points.length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">No change points recorded.</p>
          ) : (
            <ol className="space-y-2 border-l-2 border-outline-variant pl-4">
              {temporal.points.map((point: TemporalPoint, index) => (
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
          {temporal.notes.length > 0 && (
            <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">{temporal.notes.join(' ')}</p>
          )}
        </div>

        {/* Bottom Operational Action Bar */}
        <div className="p-space-md bg-surface-container-lowest rounded-lg shadow-sm flex flex-col md:flex-row items-center justify-between gap-space-sm sticky bottom-3 z-30">
          <div className="flex items-center gap-space-sm">
            <Icon name="verified_user" className="text-[20px] text-primary" />
            <div>
              <span className="font-label-md text-label-md text-on-surface font-bold">Investigation {investigation.id}</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant block">
                Created {formatDateEn(investigation.createdAt)} · Claim level: {CLAIM_LABEL[claimLevel] ?? claimLevel}
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
          </div>
        </div>
      </div>
    </div>
  );
}
