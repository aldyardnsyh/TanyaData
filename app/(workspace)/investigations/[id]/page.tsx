'use client';

import { use } from 'react';
import Link from 'next/link';
import type { ContributionChannel, InvestigationDetailResponse, MetaResponse, TemporalPoint } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatPercent } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';
import { StatusDot } from '@/components/ui/status-dot';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toaster';

const num = (value: number | null | undefined) => (value == null ? '—' : formatNumber(value));
const pct = (value: number | null | undefined) => (value == null ? '—' : formatPercent(value));
const CLAIM_LABEL: Record<string, string> = { proven: 'Terbukti', measured: 'Terukur', indication: 'Indikasi' };
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
    try { await navigator.clipboard.writeText(window.location.href); toast({ status: 'success', message: 'Tautan disalin.' }); }
    catch { toast({ status: 'error', message: 'Tautan gagal disalin.' }); }
  };

  if (data.loading) {
    return <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8"><Skeleton className="h-8 w-64" /><div className="mt-6 space-y-6"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div></div>;
  }
  if (data.error || !data.data) {
    return <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8"><EmptyState title="Investigasi tidak ditemukan" description={data.error ?? 'Dossier ini mungkin sudah dihapus.'} action={<Link href="/investigations" className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary focus-ring-forest">Kembali ke Investigasi</Link>} /></div>;
  }

  const investigation = data.data.investigation;
  const { question, period, comparison, contribution, concentration, temporal, documents, conclusion, evidence } = investigation;
  const channels = contribution.channels;
  const failureCodes = contribution.failureCodes;
  const codeTotal = failureCodes.reduce((sum, code) => sum + code.per1000.nov, 0);
  const claimLevel = conclusion.claimLevel;
  const datasetName = investigation.dataset?.name ?? meta.data?.data.activeDataset.name ?? '—';

  return (
    <div className="print-document mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Dossier investigasi"
        subtitle={question}
        meta={`${investigation.id} · ${period.label}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => document.getElementById('timeline')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Linimasa</Button>
            <Button variant="secondary" size="sm" onClick={() => void shareSnapshot()}>Salin tautan</Button>
            <Link href="/investigations" className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary transition-colors hover:bg-[#0A3A2C] focus-ring-forest"><Icon name="arrow_back" className="text-[16px]" aria-hidden="true" /> Kembali</Link>
          </>
        }
      />

      <div className="mb-6 rounded-card border border-border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3"><StatusDot state={claimLevel === 'proven' ? 'active' : 'neutral'} label={CLAIM_LABEL[claimLevel] ?? claimLevel} /><MonoMeta>{investigation.id}</MonoMeta></div>
            <p className="mt-2 font-body text-body-md text-ink">{conclusion.text}</p>
          </div>
          <div className="flex flex-wrap gap-2"><MonoMeta>DATASET · {datasetName}</MonoMeta><MonoMeta>PERIODE · {period.label}</MonoMeta><MonoMeta>METRIK · FAILURE RATE</MonoMeta></div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: 'Failure rate', value: pct(comparison.failureRate.current), meta: `BASELINE ${pct(comparison.failureRate.previous)}`, note: `${comparison.failureRate.deltaPctPoints >= 0 ? '+' : ''}${comparison.failureRate.deltaPctPoints.toFixed(2)} PP` },
          { label: 'Volume terdampak', value: num(comparison.total.current), meta: `PERUBAHAN ${comparison.total.changePct == null ? '—' : `${comparison.total.changePct >= 0 ? '+' : ''}${comparison.total.changePct.toFixed(2)}%`}`, note: 'TRANSAKSI' },
          { label: 'Kanal dominan', value: channels[0]?.channelName ?? '—', meta: channels.length ? `${channelShare(channels, 0).toFixed(1)}% DARI LONJAKAN` : '—', note: channels[1] ? `KE-2: ${channels[1].channelName}` : '—' },
        ].map((card) => (
          <div key={card.label} className="flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5">
            <p className="font-body text-label-sm uppercase text-ink-muted-strong">{card.label}</p>
            <p className="mt-3 font-body text-metric-display tabular text-ink">{card.value}</p>
            <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{card.note}</p>
            <div className="mt-auto pt-3"><MonoMeta>{card.meta}</MonoMeta></div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-card border border-border-hairline bg-surface p-5">
          <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Kontribusi per kanal</h2></header>
          <div className="space-y-4">
            {channels.map((item, index) => (
              <div key={item.channelName}>
                <div className="mb-1 flex items-center justify-between gap-2 font-body text-body-sm">
                  <span className="inline-flex min-w-0 items-center gap-2 text-ink"><span className={`state-dot shrink-0 ${index === 0 ? 'state-dot-error' : ''}`} aria-hidden="true" /><span className="truncate font-semibold">{item.channelName}</span></span>
                  <span className="shrink-0 tabular text-error-text">+{num(item.excessFailures)} gagal</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-control bg-row-hover"><div className={`h-full ${index === 0 ? 'bg-signal-terracotta' : 'bg-primary'}`} style={{ width: `${Math.max(2, channelShare(channels, index))}%` }} /></div>
                <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{pct(item.failureRate)} failure · {channelShare(channels, index).toFixed(1)}% dari kelebihan</p>
              </div>
            ))}
            {channels.length === 0 && <p className="font-body text-body-md text-ink-muted-strong">Belum ada data kontribusi.</p>}
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
                  return <tr key={code.failureCode} className="border-t border-border-hairline hover:bg-row-hover"><td className="px-3 py-3 font-body text-body-sm text-ink"><span className="inline-flex items-center gap-2"><span className={`state-dot ${rising ? 'state-dot-error' : ''}`} aria-hidden="true" />{code.failureName} ({code.failureCode})</span></td><td className="px-3 py-3 text-right font-body text-body-sm tabular text-ink">{code.per1000.nov}</td><td className="px-3 py-3 text-right font-body text-body-sm tabular text-ink-muted-strong">{share.toFixed(1)}%</td><td className="px-3 py-3 text-right font-body text-body-sm text-ink-muted-strong">{rising ? 'Naik' : 'Stabil'}</td></tr>;
                })}
                {failureCodes.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center font-body text-body-md text-ink-muted-strong">Belum ada data kode kegagalan.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-4 border-t border-border-hairline pt-3"><MonoMeta>{temporal.points.length} TITIK PERUBAHAN</MonoMeta></div>
        </section>
      </div>

      <section className="mb-6 rounded-card border border-border-hairline bg-surface p-5">
        <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Temuan dan bukti</h2></header>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { title: 'Fakta teramati', items: [conclusion.text, channels[0] ? `${channels[0].channelName} menyumbang ${channelShare(channels, 0).toFixed(1)}% dari kelebihan kegagalan.` : ''] },
            { title: 'Faktor pendukung', items: concentration.byChannelCategory.slice(0, 2).map((i) => `${i.channelName} · ${i.category} pada ${pct(i.failureRate)}`) },
            { title: 'Bukti dokumen', items: documents.slice(0, 2).map((d) => `${d.docTitle ?? d.sourceId}${d.page != null ? ` · hlm ${d.page}` : ''}: ${d.quote ?? d.section ?? ''}`) },
            { title: 'Keterbatasan', items: conclusion.caveats.slice(0, 2) },
          ].map((quadrant) => (
            <div key={quadrant.title} className="rounded-control border border-border-hairline bg-canvas p-4">
              <MonoMeta className="mb-3 block">{quadrant.title.toUpperCase()}</MonoMeta>
              <ul className="space-y-2">{quadrant.items.filter(Boolean).map((item, i) => <li key={i} className="flex items-start gap-2 font-body text-body-sm text-ink"><span className="state-dot mt-1.5 shrink-0" aria-hidden="true" />{item}</li>)}{quadrant.items.filter(Boolean).length === 0 && <li className="font-body text-body-sm text-ink-muted-strong">Tidak ada data.</li>}</ul>
            </div>
          ))}
        </div>
        <div id="view-raw-payloads" className="mt-6 border-t border-border-hairline pt-4">
          <MonoMeta className="mb-2 block">JEKAK SQL</MonoMeta>
          {evidence.sql.map((query, i) => <pre key={i} className="mb-2 overflow-x-auto rounded-control border border-border-hairline bg-canvas p-3 font-mono text-body-sm leading-relaxed text-ink"><code>{query}</code></pre>)}
          {evidence.sql.length === 0 && <p className="font-body text-body-sm text-ink-muted-strong">Tidak ada jekak SQL.</p>}
        </div>
      </section>

      <section id="timeline" className="mb-6 rounded-card border border-border-hairline bg-surface p-5">
        <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Linimasa perubahan</h2></header>
        {temporal.points.length === 0 ? <p className="font-body text-body-md text-ink-muted-strong">Belum ada titik perubahan.</p> : (
          <ol className="space-y-3 border-l-2 border-border-hairline pl-4">{temporal.points.map((point: TemporalPoint, i) => <li key={`${point.channelName}-${point.date}-${i}`} className="relative"><span className="absolute -left-[21px] top-1.5 state-dot state-dot-error" aria-hidden="true" /><span className="font-body text-body-md font-semibold text-ink">{point.channelName}</span><span className="ml-2 font-body text-body-sm text-ink-muted-strong">{point.date} · {point.kind}</span></li>)}</ol>
        )}
        {temporal.notes.length > 0 && <p className="mt-3 font-body text-body-sm text-ink-muted-strong">{temporal.notes.join(' ')}</p>}
      </section>

      <div className="sticky bottom-3 z-30 flex flex-col gap-3 rounded-card border border-border-hairline bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-body text-body-md font-semibold text-ink">Investigasi {investigation.id}</p><p className="font-body text-body-sm text-ink-muted-strong">Dibuat {investigation.createdAt.slice(0, 10)} · Tingkat klaim: {CLAIM_LABEL[claimLevel] ?? claimLevel}</p></div>
        <Button variant="secondary" onClick={() => window.print()}><Icon name="print" className="text-[16px]" aria-hidden="true" /> Cetak dossier</Button>
      </div>
    </div>
  );
}
