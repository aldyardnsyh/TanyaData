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
import { PageHeading } from '@/components/signal/page-heading';
import { SectionRule } from '@/components/signal/section-rule';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { TimelineView, type TimelineNode } from '@/components/signal/timeline-view';
import { StatusBadge } from '@/components/signal/status-badge';
import { GlowingCTA } from '@/components/signal/glowing-cta';
import { toast } from '@/components/ui/toaster';

const num = (v: number | null | undefined) => (v == null ? 'Belum dihitung' : formatNumber(v));
const pct = (v: number | null | undefined) => (v == null ? 'Belum dihitung' : formatPercent(v));
const CLAIM_LABEL: Record<string, string> = { proven: 'Terbukti', measured: 'Terukur', indication: 'Indikasi' };

function channelShare(channels: ContributionChannel[], index: number): number {
  const total = channels.reduce((sum, c) => sum + c.excessFailures, 0);
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

  const failureRate = overview.data?.failureRate;
  const topChannels = overview.data?.topChannels ?? [];
  const changePoints = overview.data?.changePoints ?? [];
  const contributionChannels = analysis?.contribution.channels ?? [];
  const failureCodes = analysis?.contribution.failureCodes ?? [];
  const documents = analysis?.documents ?? [];
  const caveats = analysis?.conclusion.caveats ?? [];
  const temporalPoints = analysis?.temporal.points ?? [];
  const series = analysis?.temporal.series ?? [];
  const chartRows = series[0]?.rows ?? [];
  const chartMax = Math.max(1, ...chartRows.map((row) => row.failureRate));
  const chartPath = chartRows.map((row, index) => {
    const x = chartRows.length > 1 ? (index / (chartRows.length - 1)) * 1000 : 0;
    const y = 180 - (row.failureRate / chartMax) * 150;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const dominant = contributionChannels[0];
  const runnerUp = contributionChannels[1];
  const excessTotal = topChannels.reduce((sum, c) => sum + c.excessFailures, 0);
  const codeTotal = failureCodes.reduce((sum, c) => sum + c.per1000.nov, 0);
  const claimLevel = analysis?.conclusion.claimLevel ?? 'indication';
  const caseId = analysis?.id ?? saved.data?.items[0]?.id ?? '—';
  const datasetName = meta.data?.data.activeDataset.name ?? '—';
  const periodLabel = overview.data?.period.label ?? meta.data?.data.periodDefaults.label ?? '—';
  const channelNames = [...new Set(topChannels.map((c) => c.channelName))];
  const categoryNames = categories.data?.items.map((i) => i.categoryName) ?? [];

  const timelineNodes: TimelineNode[] = temporalPoints.map((point: TemporalPoint, i) => ({
    id: `${point.channelName}-${point.date}-${i}`,
    date: point.date,
    label: `${point.channelName} · ${point.kind}`,
    evidence: point.kind === 'worsened' ? 'Peningkatan failure rate teramati.' : undefined,
  }));

  const summaryItems: BentoItem[] = [
    { id: 'rate', label: 'Failure rate', value: pct(failureRate?.current), source: `BASELINE ${pct(failureRate?.previous)}`, span: 'support' },
    { id: 'volume', label: 'Volume terdampak', value: analyzing ? '…' : num(analysis?.comparison.total.current), source: `KELEBIHAN ${num(excessTotal)}`, span: 'support' },
    { id: 'channel', label: 'Kanal dominan', value: dominant?.channelName ?? 'Belum dihitung', source: dominant ? `${channelShare(contributionChannels, 0).toFixed(1)}% DARI LONJAKAN` : '—', span: 'support' },
    { id: 'claim', label: 'Tingkat klaim', value: CLAIM_LABEL[claimLevel] ?? claimLevel, source: runnerUp ? `KE-2: ${runnerUp.channelName}` : '—', span: 'support' },
  ];

  return (
    <div className="page-container py-s5">
      <PageHeading
        title="Investigasi"
        caption="Pahami perubahan kinerja dan telusuri faktor yang berkontribusi."
        meta={`${caseId} · ${periodLabel.toUpperCase()} · ${datasetName.toUpperCase()}`}
        actions={
          <>
            <button type="button" onClick={() => document.getElementById('timeline')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="timeline" className="text-[16px]" /> Linimasa</button>
            <button type="button" onClick={openHypothesis} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="tune" className="text-[16px]" /> Ubah hipotesis</button>
          </>
        }
      />

      {/* Form analisis. */}
      {formOpen && (
        <section id="hypothesis-form" className="surface mb-s5 p-s4">
          <div className="mb-s3 flex items-center justify-between">
            <h2 className="font-display text-title text-ink">Ubah hipotesis</h2>
            <button type="button" onClick={() => setFormOpen(false)} aria-label="Tutup formulir" className="touch-44 flex items-center justify-center rounded-control text-ink-72 focus-ring"><Icon name="close" className="text-[18px]" /></button>
          </div>
          <SectionRule className="mb-s4" />
          <div className="grid-dashboard">
            <label className="col-span-4 flex flex-col gap-s1 xl:col-span-6"><span className="font-body text-caption text-ink-72">Pertanyaan</span><input ref={questionRef} type="text" value={question} onChange={(e) => setQuestion(e.target.value)} className="min-h-11 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink focus-ring" /></label>
            <label className="col-span-4 flex flex-col gap-s1 xl:col-span-3"><span className="font-body text-caption text-ink-72">Kanal</span><select value={channel} onChange={(e) => setChannel(e.target.value)} className="min-h-11 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink focus-ring"><option value="">Semua kanal</option>{channelNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="col-span-4 flex flex-col gap-s1 xl:col-span-3"><span className="font-body text-caption text-ink-72">Kategori</span><select value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-11 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink focus-ring"><option value="">Semua kategori</option>{categoryNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          </div>
          <div className="mt-s4 flex justify-end gap-s2">
            <button type="button" onClick={() => setFormOpen(false)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring">Batal</button>
            <GlowingCTA state={analyzing ? 'loading' : 'default'} onClick={() => void runAnalysis()} loadingLabel="Menganalisis">Jalankan analisis</GlowingCTA>
          </div>
        </section>
      )}

      {/* Konteks + perbandingan. */}
      <section aria-label="Perbandingan" className="mb-s5">
        <BentoGrid items={summaryItems} state={overview.loading ? 'loading' : overview.error ? 'error' : 'default'} errorTitle="Ringkasan investigasi gagal dimuat." onRetry={overview.retry} />
      </section>

      {/* Grafik deret waktu. */}
      <section className="surface mb-s5 p-s4" aria-labelledby="deret-heading">
        <div className="mb-s3 flex flex-wrap items-start justify-between gap-s2">
          <div>
            <h2 id="deret-heading" className="font-display text-title text-ink">Failure rate dari waktu ke waktu</h2>
            <p className="mt-s1 font-body text-caption text-ink-72">Dengan penanda titik perubahan dari data.</p>
          </div>
          <span className="mono-meta">{periodLabel.toUpperCase()}</span>
        </div>
        <SectionRule className="mb-s3" />
        <div className="relative h-64">
          <svg viewBox="0 0 1000 240" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Failure rate dari waktu ke waktu">
            {[40, 90, 140, 190].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="var(--border-hairline)" strokeWidth="1" strokeDasharray="2 2" />)}
            {chartPath && <path d={chartPath} fill="none" stroke="var(--color-forest)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
          </svg>
          {analyzing && <div className="absolute inset-0 flex items-center justify-center font-body text-body text-ink-72">Menganalisis</div>}
          {!analyzing && !chartPath && <div className="absolute inset-0 flex items-center justify-center font-body text-body text-ink-72">{error ?? 'Tidak ada deret waktu.'}</div>}
        </div>
        <table className="sr-only"><caption>Failure rate dari waktu ke waktu</caption><thead><tr><th>Periode</th><th>Failure rate</th></tr></thead><tbody>{chartRows.map((row) => <tr key={row.bucket}><td>{row.bucket}</td><td>{row.failureRate}</td></tr>)}</tbody></table>
      </section>

      {/* Kontribusi kanal & kode gagal: 4/8. */}
      <div className="grid-dashboard mb-s5">
        <section className="surface col-span-4 p-s4 xl:col-span-5" aria-labelledby="kontribusi-heading">
          <h2 id="kontribusi-heading" className="font-display text-title text-ink">Kontribusi per kanal</h2>
          <SectionRule className="mb-s3 mt-s2" />
          <div className="space-y-s3">
            {contributionChannels.map((item, index) => (
              <div key={item.channelName}>
                <div className="mb-s1 flex items-center justify-between gap-s2 font-body text-caption">
                  <span className="inline-flex min-w-0 items-center gap-s2 text-ink"><StatusBadge label={item.channelName} tone={index === 0 ? 'error' : 'neutral'} /></span>
                  <span className="shrink-0 tabular text-ink">+{num(item.excessFailures)} gagal</span>
                </div>
                <div className="h-s2 w-full overflow-hidden rounded-control bg-forest-08"><div className={`h-full ${index === 0 ? 'bg-terracotta' : 'bg-forest'}`} style={{ width: `${Math.max(2, channelShare(contributionChannels, index))}%` }} /></div>
                <p className="mt-s1 font-body text-caption text-ink-72">{pct(item.failureRate)} failure · {channelShare(contributionChannels, index).toFixed(1)}% dari kelebihan</p>
              </div>
            ))}
            {!analyzing && contributionChannels.length === 0 && <p className="font-body text-body text-ink-72">{error ?? 'Belum ada data kontribusi.'}</p>}
          </div>
        </section>

        <section className="surface col-span-4 p-s4 xl:col-span-7" aria-labelledby="kode-heading">
          <h2 id="kode-heading" className="font-display text-title text-ink">Kode kegagalan</h2>
          <SectionRule className="mb-s3 mt-s2" />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Kontribusi kode kegagalan</caption>
              <thead><tr className="bg-forest-08">{['Kode', 'Per 1k', '% Total', 'Tren'].map((h, i) => <th key={h} scope="col" className={`px-s3 py-s2 font-body text-caption text-ink-72 ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {failureCodes.map((code) => {
                  const share = codeTotal > 0 ? (code.per1000.nov / codeTotal) * 100 : 0;
                  const rising = code.per1000.nov > code.per1000.oct;
                  return <tr key={code.failureCode} className="border-t border-[var(--border-hairline)]"><td className="px-s3 py-s2 font-body text-caption text-ink">{code.failureName} ({code.failureCode})</td><td className="px-s3 py-s2 text-right font-body text-caption tabular text-ink">{code.per1000.nov}</td><td className="px-s3 py-s2 text-right font-body text-caption tabular text-ink-72">{share.toFixed(1)}%</td><td className="px-s3 py-s2 text-right font-body text-caption text-ink-72">{rising ? 'Naik' : 'Stabil'}</td></tr>;
                })}
                {!analyzing && failureCodes.length === 0 && <tr><td colSpan={4} className="px-s3 py-s4 text-center font-body text-body text-ink-72">Belum ada data kode kegagalan.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-s3 border-t border-[var(--border-hairline)] pt-s2"><span className="mono-meta">{changePoints.length} TITIK PERUBAHAN</span></div>
        </section>
      </div>

      {/* Evidence Timeline. */}
      <section id="timeline" className="surface mb-s5 p-s4" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="font-display text-title text-ink">Linimasa bukti</h2>
        <SectionRule className="mb-s4 mt-s2" />
        {timelineNodes.length === 0 ? (
          <div className="flex items-center gap-s2"><StatusBadge label="Kosong" tone="neutral" /><p className="font-body text-body text-ink-72">Tidak ada kejadian bertanggal pada sumber ini. Ubah pertanyaan.</p></div>
        ) : (
          <TimelineView nodes={timelineNodes} state={analyzing ? 'loading' : 'default'} />
        )}
      </section>

      {/* Dokumen + kesimpulan + caveat. */}
      <section className="surface mb-s5 p-s4" aria-labelledby="kesimpulan-heading">
        <h2 id="kesimpulan-heading" className="font-display text-title text-ink">Kesimpulan dan keterbatasan</h2>
        <SectionRule className="mb-s4 mt-s2" />
        <div className="grid-dashboard">
          <div className="col-span-4 xl:col-span-6">
            <span className="mono-meta">FAKTA TERAMATI</span>
            <p className="mt-s2 font-body text-body text-ink">{analysis?.conclusion.text ?? 'Belum ada kesimpulan.'}</p>
            {dominant && <p className="mt-s2 font-body text-caption text-ink-72">{dominant.channelName} menyumbang {channelShare(contributionChannels, 0).toFixed(1)}% dari kelebihan kegagalan.</p>}
          </div>
          <div className="col-span-4 xl:col-span-3">
            <span className="mono-meta">BUKTI DOKUMEN</span>
            <ul className="mt-s2 space-y-s2">
              {documents.slice(0, 2).map((d, i) => <li key={i} className="font-body text-caption text-ink">{d.docTitle ?? d.sourceId}{d.page != null ? ` · hlm ${d.page}` : ''}: {d.quote ?? d.section ?? ''}</li>)}
              {documents.length === 0 && <li className="font-body text-caption text-ink-72">Tidak ada bukti dokumen.</li>}
            </ul>
          </div>
          <div className="col-span-4 xl:col-span-3">
            <span className="mono-meta">KETERBATASAN</span>
            <ul className="mt-s2 space-y-s2">
              {caveats.slice(0, 2).map((c, i) => <li key={i} className="font-body text-caption text-ink">{c}</li>)}
              {caveats.length === 0 && <li className="font-body text-caption text-ink-72">Tidak ada catatan keterbatasan.</li>}
            </ul>
          </div>
        </div>
        {(analysis?.evidence.sql ?? []).length > 0 && (
          <div className="mt-s4 border-t border-[var(--border-hairline)] pt-s3">
            <span className="mono-meta">JEJAK SQL</span>
            {(analysis?.evidence.sql ?? []).map((query, i) => <pre key={i} className="mt-s2 overflow-x-auto rounded-control border border-[var(--border-hairline)] bg-forest-08 p-s3 font-mono text-caption leading-relaxed text-ink"><code>{query}</code></pre>)}
          </div>
        )}
      </section>

      {/* Investigasi tersimpan. */}
      <section className="surface mb-s5 p-s4" aria-labelledby="tersimpan-heading">
        <div className="mb-s3 flex items-center justify-between">
          <h2 id="tersimpan-heading" className="font-display text-title text-ink">Investigasi tersimpan</h2>
          <span className="mono-meta">{num(saved.data?.total)} TERSIMPAN</span>
        </div>
        <SectionRule className="mb-s3" />
        {saved.loading ? <div className="skeleton h-40 w-full" /> : (saved.data?.items ?? []).length === 0 ? <p className="font-body text-body text-ink-72">Belum ada investigasi tersimpan.</p> : (
          <ul className="space-y-s2">
            {saved.data?.items.map((item) => <li key={item.id}><Link href={`/investigations/${item.id}`} className="block min-h-11 rounded-control border border-[var(--border-hairline)] px-s3 py-s2 transition-colors hover:border-forest focus-ring"><span className="block font-body text-body font-semibold text-ink">{item.question}</span><span className="block font-body text-caption text-ink-72">{item.period} · {item.topChannel ?? '—'} · {CLAIM_LABEL[item.claimLevel] ?? item.claimLevel}</span></Link></li>)}
          </ul>
        )}
      </section>

      {/* Bilah aksi. */}
      <div className="sticky bottom-s3 z-sticky flex flex-col gap-s3 rounded-overlay border border-[var(--border-hairline)] bg-porcelain p-s4 elevated sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-body text-body font-semibold text-ink">Investigasi {caseId}</p>
          <p className="font-body text-caption text-ink-72">Tingkat klaim: {CLAIM_LABEL[claimLevel] ?? claimLevel}. Dossier tersimpan dapat dibuka kembali.</p>
        </div>
        <div className="flex flex-wrap gap-s2">
          <button type="button" onClick={() => window.print()} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="print" className="text-[16px]" /> Cetak dossier</button>
          <button type="button" disabled={!analysis || saving || !!savedId} onClick={() => void saveInvestigation()} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring disabled:opacity-50">{savedId ? 'Tersimpan' : saving ? 'Menyimpan' : 'Simpan investigasi'}</button>
        </div>
      </div>
    </div>
  );
}
