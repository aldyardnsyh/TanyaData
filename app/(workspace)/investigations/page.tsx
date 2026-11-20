'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  AnomaliesResponse,
  CategoryPerformanceResponse,
  ContributionChannel,
  Investigation,
  InvestigationsListResponse,
  InvestigationsOverviewResponse,
  InvestigateResponse,
  MetaResponse,
  TemporalPoint,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatPercent } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';
import { StatusDot } from '@/components/ui/status-dot';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';

const num = (value: number | null | undefined) => (value == null ? '—' : formatNumber(value));
const pct = (value: number | null | undefined) => (value == null ? '—' : formatPercent(value));
const CLAIM_LABEL: Record<string, string> = { proven: 'Terbukti', measured: 'Terukur', indication: 'Indikasi' };

function axisLabel(bucket: string): string {
  if (!bucket) return '—';
  const parsed = new Date(`${bucket}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return bucket;
  return parsed.toLocaleDateString('id-ID', { month: 'short', day: '2-digit', timeZone: 'UTC' }).toUpperCase();
}
function indexForDate(rows: { bucket: string }[], date: string | undefined): number {
  if (!date || rows.length === 0) return -1;
  let index = 0;
  for (let i = 0; i < rows.length; i += 1) { if (rows[i].bucket <= date) index = i; else break; }
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

  const [question, setQuestion] = useState('Mengapa tingkat kegagalan transaksi meningkat?');
  const [channel, setChannel] = useState('');
  const [category, setCategory] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Investigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const autoRan = useRef(false);
  const questionRef = useRef<HTMLInputElement>(null);

  const runAnalysis = useCallback(async (opts?: { question?: string; channel?: string; category?: string }) => {
    const q = (opts?.question ?? question).trim();
    if (q.length < 3) { toast({ status: 'error', message: 'Pertanyaan minimal 3 karakter.' }); return; }
    setAnalyzing(true); setAnalysis(null); setError(null); setSavedId(null);
    try {
      const period = overview.data?.period;
      const res = await fetch('/api/investigations/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          ...(period ? { period: { start: period.start, end: period.end } } : {}),
          compare: 'like_for_like',
          focus: { channel: (opts?.channel ?? channel) || null, category: (opts?.category ?? category) || null },
          persist: false, lang: 'id',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      setAnalysis(((await res.json()) as InvestigateResponse).investigation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analisis gagal.');
    } finally { setAnalyzing(false); }
  }, [question, channel, category, overview.data?.period]);

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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: analysis.question,
          ...(period ? { period: { start: period.start, end: period.end } } : {}),
          compare: 'like_for_like', focus: { channel: channel || null, category: category || null }, persist: true, lang: 'id',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: InvestigateResponse = await res.json();
      setSavedId(json.investigation.id);
      saved.retry();
      toast({ status: 'success', message: 'Investigasi disimpan.', action: 'Buka', onAction: () => { window.location.href = `/investigations/${json.investigation.id}`; } });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Investigasi gagal disimpan.' });
    } finally { setSaving(false); }
  }, [analysis, saving, savedId, channel, category, overview.data?.period, saved]);

  const openHypothesis = () => {
    setFormOpen(true);
    document.getElementById('hypothesis-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => questionRef.current?.focus(), 250);
  };
  const shareSnapshot = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast({ status: 'success', message: 'Tautan disalin.' }); }
    catch { toast({ status: 'error', message: 'Tautan gagal disalin.' }); }
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
  const chartPath = chartRows.map((row, index) => {
    const x = chartRows.length > 1 ? (index / (chartRows.length - 1)) * 1000 : 0;
    const y = 180 - (row.failureRate / chartMax) * 150;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const peakIndex = chartRows.length ? chartRows.reduce((best, row, index) => (row.failureRate > chartRows[best].failureRate ? index : best), 0) : -1;
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
  const caseId = analysis?.id ?? saved.data?.items[0]?.id ?? '—';
  const datasetName = meta.data?.data.activeDataset.name ?? '—';
  const periodLabel = overview.data?.period.label ?? meta.data?.data.periodDefaults.label ?? '—';
  const channelNames = [...new Set(topChannels.map((channel) => channel.channelName))];
  const categoryNames = categories.data?.items.map((item) => item.categoryName) ?? [];

  return (
    <div className="print-document mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Investigasi"
        subtitle="Pahami perubahan kinerja dan telusuri faktor yang berkontribusi."
        meta={`${caseId} · ${periodLabel}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => document.getElementById('timeline')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Linimasa</Button>
            <Button variant="secondary" size="sm" onClick={() => void shareSnapshot()}>Salin tautan</Button>
            <Button variant="primary" size="sm" onClick={openHypothesis}>Ubah hipotesis</Button>
          </>
        }
      />

      {/* Konteks investigasi aktif. */}
      <div className="mb-6 rounded-card border border-border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <StatusDot state={claimLevel === 'proven' ? 'active' : 'neutral'} label={CLAIM_LABEL[claimLevel] ?? claimLevel} />
              <MonoMeta>{caseId}</MonoMeta>
            </div>
            <p className="mt-2 font-body text-body-md font-semibold text-ink">{analysis?.question ?? 'Analisis belum dijalankan.'}</p>
            <p className="mt-1 font-body text-body-sm text-ink-muted-strong">
              {failureRate ? `Failure rate ${pct(failureRate.current)} vs ${pct(failureRate.previous)} baseline pada ${topChannels.length} kanal.` : 'Memuat konteks investigasi…'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <MonoMeta>DATASET · {datasetName}</MonoMeta>
            <MonoMeta>PERIODE · {periodLabel}</MonoMeta>
            <MonoMeta>METRIK · FAILURE RATE</MonoMeta>
          </div>
        </div>
      </div>

      {/* Form hipotesis. */}
      {formOpen && (
        <section id="hypothesis-form" className="mb-6 rounded-card border border-border-hairline bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-body text-headline-sm text-ink">Ubah hipotesis</h2>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)} aria-label="Tutup formulir"><Icon name="close" className="text-[18px]" aria-hidden="true" /></Button>
          </div>
          <MeasurementRule className="mb-4" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1"><span className="font-body text-body-sm text-ink-muted-strong">Pertanyaan</span><input ref={questionRef} type="text" value={question} onChange={(e) => setQuestion(e.target.value)} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring" /></label>
            <label className="flex flex-col gap-1"><span className="font-body text-body-sm text-ink-muted-strong">Kanal</span><select value={channel} onChange={(e) => setChannel(e.target.value)} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring"><option value="">Semua kanal</option>{channelNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="font-body text-body-sm text-ink-muted-strong">Kategori</span><select value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink focus-ring"><option value="">Semua kategori</option>{categoryNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <div className="flex flex-col gap-1"><span className="font-body text-body-sm text-ink-muted-strong">Periode</span><div className="flex items-center gap-2"><input type="date" aria-label="Tanggal mulai" value={overview.data?.period.start ?? ''} readOnly className="min-h-11 w-full rounded-control border border-border-hairline bg-canvas px-2 font-body text-body-sm text-ink-muted-strong" /><input type="date" aria-label="Tanggal akhir" value={overview.data?.period.end ?? ''} readOnly className="min-h-11 w-full rounded-control border border-border-hairline bg-canvas px-2 font-body text-body-sm text-ink-muted-strong" /></div></div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Batal</Button>
            <Button variant="primary" disabled={analyzing} onClick={() => void runAnalysis()}>{analyzing ? 'Menganalisis…' : 'Jalankan analisis'}</Button>
          </div>
        </section>
      )}

      {/* KPI investigasi. */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: 'Failure rate', value: overview.loading ? null : pct(failureRate?.current), meta: `BASELINE ${pct(failureRate?.previous)}`, note: failureRate ? `${failureRate.deltaPctPoints >= 0 ? '+' : ''}${failureRate.deltaPctPoints.toFixed(2)} PP` : '—' },
          { label: 'Volume terdampak', value: analyzing ? null : num(analysis?.comparison.total.current), meta: `KELEBIHAN ${num(excessTotal)}`, note: 'TRANSAKSI' },
          { label: 'Kanal dominan', value: dominant?.channelName ?? '—', meta: contributionChannels.length ? `${channelShare(contributionChannels, 0).toFixed(1)}% DARI LONJAKAN` : '—', note: runnerUp ? `KE-2: ${runnerUp.channelName}` : '—' },
        ].map((card) => (
          <div key={card.label} className="flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5">
            <p className="font-body text-label-sm uppercase text-ink-muted-strong">{card.label}</p>
            <p className="mt-3 font-body text-metric-display tabular text-ink">{card.value ?? <Skeleton className="h-8 w-24" />}</p>
            <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{card.note}</p>
            <div className="mt-auto pt-3"><MonoMeta>{card.meta}</MonoMeta></div>
          </div>
        ))}
      </div>

      {/* Grafik deret waktu. Tooltip hanya saat hover/fokus, tanpa callout permanen. */}
      <section className="mb-6 rounded-card border border-border-hairline bg-surface p-5">
        <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-body text-headline-sm text-ink">Failure rate dari waktu ke waktu</h2>
              <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Dengan batas kontrol dan penanda titik perubahan.</p>
            </div>
            <MonoMeta>{periodLabel.toUpperCase()}</MonoMeta>
          </div>
        </header>
        <div className="mb-4 flex flex-wrap gap-4">
          <span className="inline-flex items-center gap-2 font-body text-body-sm text-ink-muted-strong"><span className="state-dot" aria-hidden="true" /> Failure rate</span>
          <span className="inline-flex items-center gap-2 font-body text-body-sm text-ink-muted-strong"><span className="state-dot state-dot-empty" aria-hidden="true" /> Batas atas {pct(upperLimit)}</span>
          <MonoMeta>AGREGAT · {primarySeries?.grain ?? '—'}</MonoMeta>
        </div>
        <div className="relative h-64">
          <svg viewBox="0 0 1000 240" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Failure rate dari waktu ke waktu">
            {[40, 90, 140, 190].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="var(--color-border-hairline)" strokeWidth="1" strokeDasharray="2 2" />)}
            {shadeX1 >= 0 && shadeX2 > shadeX1 && <polygon points={`${shadeX1.toFixed(1)},20 ${shadeX2.toFixed(1)},20 ${shadeX2.toFixed(1)},220 ${shadeX1.toFixed(1)},220`} fill="var(--color-signal-terracotta)" opacity="0.12" />}
            {upperLimit > 0 && <line x1="0" x2="1000" y1={upperLimitY.toFixed(1)} y2={upperLimitY.toFixed(1)} stroke="var(--color-border-control)" strokeWidth="1.5" strokeDasharray="4 4" />}
            {chartPath && <path d={chartPath} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
            {peak && <circle cx={peakIndex === 0 ? 0 : (peakIndex / Math.max(1, chartRows.length - 1)) * 1000} cy={180 - (peak.failureRate / chartMax) * 150} r="5" fill="var(--color-signal-terracotta)" />}
          </svg>
          {analyzing && <div className="absolute inset-0 flex items-center justify-center font-body text-body-md text-ink-muted-strong">Menganalisis…</div>}
          {!analyzing && !chartPath && <div className="absolute inset-0 flex items-center justify-center font-body text-body-md text-ink-muted-strong">{error ?? 'Tidak ada deret waktu.'}</div>}
        </div>
        <div className="mt-2 flex justify-between font-body text-body-sm text-ink-muted-strong">{axis.map((label, i) => <span key={i}>{label}</span>)}</div>
        <table className="sr-only"><caption>Failure rate dari waktu ke waktu</caption><thead><tr><th>Periode</th><th>Failure rate</th></tr></thead><tbody>{chartRows.map((row) => <tr key={row.bucket}><td>{row.bucket}</td><td>{row.failureRate}</td></tr>)}</tbody></table>
      </section>

      {/* Kontribusi kanal & kode gagal. */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-card border border-border-hairline bg-surface p-5">
          <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Kontribusi per kanal</h2></header>
          <div className="space-y-4">
            {contributionChannels.map((item, index) => (
              <div key={item.channelName}>
                <div className="mb-1 flex items-center justify-between gap-2 font-body text-body-sm">
                  <span className="inline-flex min-w-0 items-center gap-2 text-ink"><span className={`state-dot shrink-0 ${index === 0 ? 'state-dot-error' : ''}`} aria-hidden="true" /><span className="truncate font-semibold">{item.channelName}</span></span>
                  <span className="shrink-0 tabular text-error-text">+{num(item.excessFailures)} gagal</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-control bg-row-hover"><div className={`h-full ${index === 0 ? 'bg-signal-terracotta' : 'bg-primary'}`} style={{ width: `${Math.max(2, channelShare(contributionChannels, index))}%` }} /></div>
                <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{pct(item.failureRate)} failure · {channelShare(contributionChannels, index).toFixed(1)}% dari kelebihan</p>
              </div>
            ))}
            {!analyzing && contributionChannels.length === 0 && <p className="font-body text-body-md text-ink-muted-strong">{error ?? 'Belum ada data kontribusi.'}</p>}
          </div>
        </section>

        <section className="rounded-card border border-border-hairline bg-surface p-5">
          <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Kode kegagalan</h2></header>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-canvas"><tr>{['Kode', 'Per 1k', '% Total', 'Tren'].map((h, i) => <th key={h} className={`px-3 py-3 font-body text-label-sm uppercase text-ink-muted-strong ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {failureCodes.map((code) => {
                  const share = codeTotal > 0 ? (code.per1000.nov / codeTotal) * 100 : 0;
                  const rising = code.per1000.nov > code.per1000.oct;
                  return (
                    <tr key={code.failureCode} className="border-t border-border-hairline hover:bg-row-hover">
                      <td className="px-3 py-3 font-body text-body-sm text-ink"><span className="inline-flex items-center gap-2"><span className={`state-dot ${rising ? 'state-dot-error' : ''}`} aria-hidden="true" />{code.failureName} ({code.failureCode})</span></td>
                      <td className="px-3 py-3 text-right font-body text-body-sm tabular text-ink">{code.per1000.nov}</td>
                      <td className="px-3 py-3 text-right font-body text-body-sm tabular text-ink-muted-strong">{share.toFixed(1)}%</td>
                      <td className="px-3 py-3 text-right font-body text-body-sm text-ink-muted-strong">{rising ? 'Naik' : 'Stabil'}</td>
                    </tr>
                  );
                })}
                {!analyzing && failureCodes.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center font-body text-body-md text-ink-muted-strong">Belum ada data kode kegagalan.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-4 border-t border-border-hairline pt-3"><MonoMeta>{changePoints.length} TITIK PERUBAHAN</MonoMeta></div>
        </section>
      </div>

      {/* Temuan & bukti. */}
      <section className="mb-6 rounded-card border border-border-hairline bg-surface p-5">
        <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Temuan dan bukti</h2></header>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { title: 'Fakta teramati', items: [analysis?.conclusion.text ?? 'Belum ada kesimpulan.', dominant ? `${dominant.channelName} menyumbang ${channelShare(contributionChannels, 0).toFixed(1)}% dari kelebihan kegagalan.` : ''] },
            { title: 'Faktor pendukung', items: (analysis?.concentration.byChannelCategory ?? []).slice(0, 2).map((i) => `${i.channelName} · ${i.category} pada ${pct(i.failureRate)}`) },
            { title: 'Bukti dokumen', items: documents.slice(0, 2).map((d) => `${d.docTitle ?? d.sourceId}${d.page != null ? ` · hlm ${d.page}` : ''}: ${d.quote ?? d.section ?? ''}`) },
            { title: 'Keterbatasan', items: caveats.slice(0, 2) },
          ].map((quadrant) => (
            <div key={quadrant.title} className="rounded-control border border-border-hairline bg-canvas p-4">
              <MonoMeta className="mb-3 block">{quadrant.title.toUpperCase()}</MonoMeta>
              <ul className="space-y-2">
                {quadrant.items.filter(Boolean).map((item, i) => <li key={i} className="flex items-start gap-2 font-body text-body-sm text-ink"><span className="state-dot mt-1.5 shrink-0" aria-hidden="true" />{item}</li>)}
                {quadrant.items.filter(Boolean).length === 0 && <li className="font-body text-body-sm text-ink-muted-strong">Tidak ada data.</li>}
              </ul>
            </div>
          ))}
        </div>
        <div id="view-raw-payloads" className="mt-6 border-t border-border-hairline pt-4">
          <MonoMeta className="mb-2 block">JEKAK SQL</MonoMeta>
          {(analysis?.evidence.sql ?? []).map((query, i) => <pre key={i} className="mb-2 overflow-x-auto rounded-control border border-border-hairline bg-canvas p-3 font-mono text-body-sm leading-relaxed text-ink"><code>{query}</code></pre>)}
          {(analysis?.evidence.sql ?? []).length === 0 && <p className="font-body text-body-sm text-ink-muted-strong">Tidak ada jekak SQL.</p>}
        </div>
      </section>

      {/* Linimasa. */}
      <section id="timeline" className="mb-6 rounded-card border border-border-hairline bg-surface p-5">
        <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Linimasa perubahan</h2></header>
        {temporalPoints.length === 0 ? <p className="font-body text-body-md text-ink-muted-strong">Belum ada titik perubahan.</p> : (
          <ol className="space-y-3 border-l-2 border-border-hairline pl-4">
            {temporalPoints.map((point: TemporalPoint, i) => <li key={`${point.channelName}-${point.date}-${i}`} className="relative"><span className="absolute -left-[21px] top-1.5 state-dot state-dot-error" aria-hidden="true" /><span className="font-body text-body-md font-semibold text-ink">{point.channelName}</span><span className="ml-2 font-body text-body-sm text-ink-muted-strong">{point.date} · {point.kind}</span></li>)}
          </ol>
        )}
      </section>

      {/* Investigasi tersimpan. */}
      <section className="mb-6 rounded-card border border-border-hairline bg-surface p-5">
        <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><div className="flex items-center justify-between"><h2 className="font-body text-headline-sm text-ink">Investigasi tersimpan</h2><MonoMeta>{num(saved.data?.total)} TERSIMPAN</MonoMeta></div></header>
        {saved.loading ? <Skeleton className="h-10 w-full" /> : (saved.data?.items ?? []).length === 0 ? <p className="font-body text-body-md text-ink-muted-strong">Belum ada investigasi tersimpan.</p> : (
          <ul className="space-y-2">
            {saved.data?.items.map((item) => <li key={item.id}><Link href={`/investigations/${item.id}`} className="block min-h-11 rounded-control border border-border-hairline px-3 py-2 transition-colors hover:border-primary focus-ring"><span className="block font-body text-body-md font-semibold text-ink">{item.question}</span><span className="block font-body text-body-sm text-ink-muted-strong">{item.period} · {item.topChannel ?? '—'} · {CLAIM_LABEL[item.claimLevel] ?? item.claimLevel}</span></Link></li>)}
          </ul>
        )}
      </section>

      {/* Bilah aksi. */}
      <div className="sticky bottom-3 z-30 flex flex-col gap-3 rounded-card border border-border-hairline bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-body text-body-md font-semibold text-ink">Investigasi {caseId}</p>
          <p className="font-body text-body-sm text-ink-muted-strong">Tingkat klaim: {CLAIM_LABEL[claimLevel] ?? claimLevel}. Dossier tersimpan dapat dibuka kembali.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => window.print()}><Icon name="print" className="text-[16px]" aria-hidden="true" /> Cetak dossier</Button>
          <Button variant="primary" disabled={!analysis || saving || !!savedId} onClick={() => void saveInvestigation()}>{savedId ? 'Tersimpan' : saving ? 'Menyimpan…' : 'Simpan investigasi'}</Button>
        </div>
      </div>
    </div>
  );
}
