'use client';

import { use } from 'react';
import Link from 'next/link';
import type { ContributionChannel, InvestigationDetailResponse, MetaResponse, TemporalPoint } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatPercent } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { PageHeading } from '@/components/signal/page-heading';
import { SectionRule } from '@/components/signal/section-rule';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { TimelineView, type TimelineNode } from '@/components/signal/timeline-view';
import { StatusBadge } from '@/components/signal/status-badge';

const num = (v: number | null | undefined) => (v == null ? 'Belum dihitung' : formatNumber(v));
const pct = (v: number | null | undefined) => (v == null ? 'Belum dihitung' : formatPercent(v));
const CLAIM_LABEL: Record<string, string> = { proven: 'Terbukti', measured: 'Terukur', indication: 'Indikasi' };
function channelShare(channels: ContributionChannel[], index: number): number {
  const total = channels.reduce((sum, c) => sum + c.excessFailures, 0);
  if (total <= 0 || !channels[index]) return 0;
  return (channels[index].excessFailures / total) * 100;
}

export default function InvestigationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useApi<InvestigationDetailResponse>(`/api/investigations/${id}`);
  const meta = useApi<MetaResponse>('/api/meta');

  if (data.loading) {
    return <div className="page-container py-s5" aria-busy="true"><div className="skeleton h-s6 w-1/2" /><div className="bento mt-s5">{[0, 1, 2].map((i) => <div key={i} data-cell data-span="support" className="surface p-s3"><div className="skeleton h-s2 w-2/3" /><div className="skeleton mt-s3 h-s5 w-1/2" /></div>)}</div><div className="skeleton mt-s5 h-64 w-full" /></div>;
  }
  if (data.error || !data.data) {
    return (
      <div className="page-container py-s5">
        <div className="surface flex flex-col items-start gap-s2 p-s4">
          <StatusBadge label="Tidak ditemukan" tone="error" />
          <p className="font-body text-body text-ink">{data.error ?? 'Dossier ini mungkin sudah dihapus.'}</p>
          <Link href="/investigations" className="touch-44 inline-flex items-center rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring">Kembali ke Investigasi</Link>
        </div>
      </div>
    );
  }

  const investigation = data.data.investigation;
  const { question, period, comparison, contribution, concentration, temporal, documents, conclusion, evidence } = investigation;
  const channels = contribution.channels;
  const failureCodes = contribution.failureCodes;
  const codeTotal = failureCodes.reduce((sum, c) => sum + c.per1000.nov, 0);
  const claimLevel = conclusion.claimLevel;
  const datasetName = investigation.dataset?.name ?? meta.data?.data.activeDataset.name ?? '—';

  const summaryItems: BentoItem[] = [
    { id: 'rate', label: 'Failure rate', value: pct(comparison.failureRate.current), source: `BASELINE ${pct(comparison.failureRate.previous)}`, span: 'support' },
    { id: 'volume', label: 'Volume terdampak', value: num(comparison.total.current), source: `PERUBAHAN ${comparison.total.changePct == null ? '—' : `${comparison.total.changePct >= 0 ? '+' : ''}${comparison.total.changePct.toFixed(2)}%`}`, span: 'support' },
    { id: 'channel', label: 'Kanal dominan', value: channels[0]?.channelName ?? 'Belum dihitung', source: channels.length ? `${channelShare(channels, 0).toFixed(1)}% DARI LONJAKAN` : '—', span: 'support' },
    { id: 'claim', label: 'Tingkat klaim', value: CLAIM_LABEL[claimLevel] ?? claimLevel, source: channels[1] ? `KE-2: ${channels[1].channelName}` : '—', span: 'support' },
  ];

  const timelineNodes: TimelineNode[] = temporal.points.map((point: TemporalPoint, i) => ({
    id: `${point.channelName}-${point.date}-${i}`,
    date: point.date,
    label: `${point.channelName} · ${point.kind}`,
    evidence: point.kind === 'worsened' ? 'Peningkatan failure rate teramati.' : undefined,
  }));

  return (
    <div className="page-container py-s5">
      <PageHeading
        title="Dossier investigasi"
        caption={question}
        meta={`${investigation.id} · ${period.label.toUpperCase()} · ${datasetName.toUpperCase()}`}
        actions={
          <>
            <button type="button" onClick={() => document.getElementById('timeline')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="timeline" className="text-[16px]" /> Linimasa</button>
            <Link href="/investigations" className="touch-44 inline-flex items-center gap-s2 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring"><Icon name="arrow_back" className="text-[16px]" /> Kembali</Link>
          </>
        }
      />

      <section aria-label="Rantai investigasi" className="surface mb-s5 p-s4">
        <span className="mono-meta">RANTAI INVESTIGASI</span>
        <SectionRule className="mb-s3 mt-s2" />
        <div className="grid-dashboard">
          <div className="col-span-4 xl:col-span-3">
            <span className="font-body text-caption font-semibold text-ink">1 · Hipotesis</span>
            <p className="mt-s2 font-body text-caption leading-relaxed text-ink-72">{question}</p>
          </div>
          <div className="col-span-4 xl:col-span-3">
            <span className="font-body text-caption font-semibold text-ink">2 · Bukti</span>
            <p className="mt-s2 font-body text-caption leading-relaxed text-ink-72">{channels[0] ? `${channels[0].channelName} menyumbang ${channelShare(channels, 0).toFixed(1)}% dari kelebihan kegagalan.` : 'Belum ada bukti terukur.'} {documents.length ? `${documents.length} kutipan dokumen terlampir.` : ''}</p>
          </div>
          <div className="col-span-4 xl:col-span-3">
            <span className="font-body text-caption font-semibold text-ink">3 · Sebab</span>
            <p className="mt-s2 font-body text-caption leading-relaxed text-ink-72">{failureCodes[0] ? `${failureCodes[0].failureName} (${failureCodes[0].failureCode}) menjadi kode dominan.` : 'Sebab belum teridentifikasi dari data.'}</p>
          </div>
          <div className="col-span-4 xl:col-span-3">
            <span className="font-body text-caption font-semibold text-ink">4 · Tindakan</span>
            <p className="mt-s2 font-body text-caption leading-relaxed text-ink-72">Tindak lanjut belum dicatat pada dossier ini. Gunakan cetak dossier untuk mendiskusikan langkah perbaikan.</p>
          </div>
        </div>
      </section>

      <section aria-label="Kesimpulan" className="surface mb-s5 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none">
        <div className="flex flex-wrap items-start justify-between gap-s2">
          <div className="min-w-0">
            <StatusBadge label={CLAIM_LABEL[claimLevel] ?? claimLevel} tone={claimLevel === 'proven' ? 'active' : 'neutral'} />
            <p className="mt-s3 font-body text-body text-ink">{conclusion.text}</p>
          </div>
          <span className="mono-meta">{investigation.id}</span>
        </div>
      </section>

      <section aria-label="Perbandingan" className="mb-s5"><BentoGrid items={summaryItems} /></section>

      <div className="grid-dashboard mb-s5">
        <section className="surface col-span-4 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none xl:col-span-6" aria-labelledby="d-kontribusi">
          <h2 id="d-kontribusi" className="font-display text-title text-ink">Kontribusi per kanal</h2>
          <SectionRule className="mb-s3 mt-s2" />
          <div className="space-y-s3">
            {channels.map((item, index) => (
              <div key={item.channelName}>
                <div className="mb-s1 flex items-center justify-between gap-s2 font-body text-caption">
                  <StatusBadge label={item.channelName} tone={index === 0 ? 'error' : 'neutral'} />
                  <span className="tabular text-ink">+{num(item.excessFailures)} gagal</span>
                </div>
                <div className="h-s2 w-full overflow-hidden rounded-control bg-forest-08"><div className={`h-full ${index === 0 ? 'bg-terracotta' : 'bg-forest'}`} style={{ width: `${Math.max(2, channelShare(channels, index))}%` }} /></div>
                <p className="mt-s1 font-body text-caption text-ink-72">{pct(item.failureRate)} failure · {channelShare(channels, index).toFixed(1)}% dari kelebihan</p>
              </div>
            ))}
            {channels.length === 0 && <p className="font-body text-body text-ink-72">Belum ada data kontribusi.</p>}
          </div>
        </section>

        <section className="surface col-span-4 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none xl:col-span-6" aria-labelledby="d-kode">
          <h2 id="d-kode" className="font-display text-title text-ink">Kode kegagalan</h2>
          <SectionRule className="mb-s3 mt-s2" />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Kode kegagalan</caption>
              <thead><tr className="bg-forest-08">{['Kode', 'Per 1k', '% Total', 'Tren'].map((h, i) => <th key={h} scope="col" className={`px-s3 py-s2 font-body text-caption text-ink-72 ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {failureCodes.map((code) => {
                  const share = codeTotal > 0 ? (code.per1000.nov / codeTotal) * 100 : 0;
                  const rising = code.per1000.nov > code.per1000.oct;
                  return <tr key={code.failureCode} className="border-t border-[var(--border-hairline)]"><td className="px-s3 py-s2 font-body text-caption text-ink">{code.failureName} ({code.failureCode})</td><td className="px-s3 py-s2 text-right font-body text-caption tabular text-ink">{code.per1000.nov}</td><td className="px-s3 py-s2 text-right font-body text-caption tabular text-ink-72">{share.toFixed(1)}%</td><td className="px-s3 py-s2 text-right font-body text-caption text-ink-72">{rising ? 'Naik' : 'Stabil'}</td></tr>;
                })}
                {failureCodes.length === 0 && <tr><td colSpan={4} className="px-s3 py-s4 text-center font-body text-body text-ink-72">Belum ada data kode kegagalan.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="surface mb-s5 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none" aria-labelledby="d-bukti">
        <h2 id="d-bukti" className="font-display text-title text-ink">Temuan dan bukti</h2>
        <SectionRule className="mb-s4 mt-s2" />
        <div className="grid-dashboard">
          <div className="col-span-4 xl:col-span-6"><span className="mono-meta">FAKTA TERAMATI</span><p className="mt-s2 font-body text-body text-ink">{conclusion.text}</p>{channels[0] && <p className="mt-s2 font-body text-caption text-ink-72">{channels[0].channelName} menyumbang {channelShare(channels, 0).toFixed(1)}% dari kelebihan kegagalan.</p>}</div>
          <div className="col-span-4 xl:col-span-3"><span className="mono-meta">FAKTOR PENDUKUNG</span><ul className="mt-s2 space-y-s2">{concentration.byChannelCategory.slice(0, 2).map((i, idx) => <li key={idx} className="font-body text-caption text-ink">{i.channelName} · {i.category} pada {pct(i.failureRate)}</li>)}{concentration.byChannelCategory.length === 0 && <li className="font-body text-caption text-ink-72">Tidak ada data.</li>}</ul></div>
          <div className="col-span-4 xl:col-span-3"><span className="mono-meta">KETERBATASAN</span><ul className="mt-s2 space-y-s2">{conclusion.caveats.slice(0, 2).map((c, idx) => <li key={idx} className="font-body text-caption text-ink">{c}</li>)}{conclusion.caveats.length === 0 && <li className="font-body text-caption text-ink-72">Tidak ada catatan.</li>}</ul></div>
        </div>
        {documents.length > 0 && (
          <div className="mt-s4 border-t border-[var(--border-hairline)] pt-s3">
            <span className="mono-meta">BUKTI DOKUMEN</span>
            <ul className="mt-s2 space-y-s2">{documents.slice(0, 2).map((d, idx) => <li key={idx} className="font-body text-caption text-ink">{d.docTitle ?? d.sourceId}{d.page != null ? ` · hlm ${d.page}` : ''}: {d.quote ?? d.section ?? ''}</li>)}</ul>
          </div>
        )}
        {evidence.sql.length > 0 && (
          <div className="mt-s4 border-t border-[var(--border-hairline)] pt-s3">
            <span className="mono-meta">JEJAK SQL</span>
            {evidence.sql.map((query, idx) => <pre key={idx} className="mt-s2 overflow-x-auto rounded-control border border-[var(--border-hairline)] bg-forest-08 p-s3 font-mono text-caption leading-relaxed text-ink"><code>{query}</code></pre>)}
          </div>
        )}
      </section>

      <section id="timeline" className="surface mb-s5 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none" aria-labelledby="d-timeline">
        <h2 id="d-timeline" className="font-display text-title text-ink">Linimasa perubahan</h2>
        <SectionRule className="mb-s4 mt-s2" />
        {timelineNodes.length === 0 ? (
          <div className="flex items-center gap-s2"><StatusBadge label="Kosong" tone="neutral" /><p className="font-body text-body text-ink-72">Belum ada titik perubahan.</p></div>
        ) : <TimelineView nodes={timelineNodes} />}
        {temporal.notes.length > 0 && <p className="mt-s3 font-body text-caption text-ink-72">{temporal.notes.join(' ')}</p>}
      </section>

      <div className="sticky bottom-s3 z-sticky flex flex-col gap-s3 rounded-overlay border border-[var(--border-hairline)] bg-porcelain p-s4 elevated sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-body text-body font-semibold text-ink">Investigasi {investigation.id}</p><p className="font-body text-caption text-ink-72">Dibuat {investigation.createdAt.slice(0, 10)} · Tingkat klaim: {CLAIM_LABEL[claimLevel] ?? claimLevel}</p></div>
        <button type="button" onClick={() => window.print()} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="print" className="text-[16px]" /> Cetak dossier</button>
      </div>
    </div>
  );
}
