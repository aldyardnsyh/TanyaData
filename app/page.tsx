'use client';

import Link from 'next/link';
import { useApi } from '@/lib/ui/fetch-hooks';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';
import { StatusDot } from '@/components/ui/status-dot';
import { KpiCard } from '@/components/ui/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatPercent, formatCompareLabel } from '@/lib/ui/format';
import type {
  Kpi,
  MetaResponse,
  DashboardSummaryResponse,
  TrendsResponse,
  ChannelPerformanceResponse,
  InsightsResponse,
} from '@/lib/contracts/http';

const num = (value: number | null | undefined) => (value == null ? '—' : formatNumber(value));
const pct = (value: number | null | undefined) => (value == null ? '—' : formatPercent(value));

function seriesPath(values: number[], max: number, width = 600, top = 16, bottom = 140): string {
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
  const channels = useApi<ChannelPerformanceResponse>('/api/dashboard/channel-performance?metric=failure_rate&limit=3');
  const insights = useApi<InsightsResponse>('/api/dashboard/insights?limit=2');

  const loading = meta.loading || summary.loading || trends.loading || channels.loading || insights.loading;
  const dataset = summary.data?.dataset ?? meta.data?.data.activeDataset ?? null;
  const period = summary.data?.period ?? null;
  const compareLabel = formatCompareLabel(period?.compare);
  const docs = meta.data?.data.documents ?? null;
  const capabilities = meta.data?.capabilities ?? null;
  const kpis = summary.data?.kpis ?? [];
  const kpi = (key: Kpi['key']) => kpis.find((item) => item.key === key);

  const total = kpi('total');
  const successRate = kpi('successRate');
  const failed = kpi('failed');

  const points = trends.data?.points ?? [];
  const successLine = seriesPath(points.map((p) => p.successful), Math.max(1, ...points.map((p) => p.successful)));
  const failedLine = seriesPath(points.map((p) => p.failed), Math.max(1, ...points.map((p) => p.failed)));
  const channelItems = channels.data?.items ?? [];
  const insightItems = insights.data?.items ?? [];

  const delta = (item: Kpi | undefined) =>
    item?.changePct == null
      ? null
      : { pct: item.changePct, direction: item.direction, compareValue: item.compareValue };

  return (
    <main className="bg-canvas">
      {/* HERO — satu display per layar, satu CTA primer. */}
      <section className="mx-auto max-w-[1600px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="max-w-3xl">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <StatusDot state="active" label="Workspace analitik lokal" />
            <MonoMeta>
              {dataset ? `${dataset.name} · ${formatNumber(dataset.rowCount)} ROWS` : 'Memuat metadata…'}
            </MonoMeta>
          </div>
          <h1 className="font-display text-display text-ink">
            Data transaksi, dibaca sebagai bukti.
          </h1>
          <p className="mt-4 max-w-2xl font-body text-body-lg text-ink-muted-strong">
            TanyaData mengubah pertanyaan dalam bahasa sehari-hari menjadi query SQL yang dapat diaudit, lalu
            menampilkan angka, tabel, dan sitasi dari sumber yang sama.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/overview"
              className="motion-ripple-host inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-6 font-body text-label-md font-semibold text-on-primary transition-colors duration-[var(--motion-fast)] hover:bg-[#0A3A2C] focus-ring-forest"
            >
              Buka Ringkasan
              <Icon name="arrow_forward" className="text-[16px]" aria-hidden="true" />
            </Link>
            <Link
              href="/assistant"
              className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 font-body text-label-md font-semibold text-primary transition-colors hover:bg-row-hover focus-ring"
            >
              Ajukan pertanyaan
            </Link>
          </div>
        </div>

        {/* PRODUCT PREVIEW — asymmetric bento, measurement rule, mono metadata. */}
        <div className="mt-12 rounded-overlay border border-border-hairline bg-surface p-4 sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-body text-headline-sm text-ink">Pratinjau workspace</h2>
              <p className="mt-1 font-body text-body-sm text-ink-muted-strong">
                Angka di bawah berasal dari dataset aktif, bukan contoh.
              </p>
            </div>
            <MonoMeta>{period?.label ?? '—'} · SQL · FTS5</MonoMeta>
          </div>
          <MeasurementRule className="mb-6" />

          {/* Asymmetric bento: hero spans 6, tiga regular spans 2 dari 12. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <KpiCard
                hero
                label="Total Transaksi"
                value={total?.value ?? null}
                format="number"
                delta={delta(total)}
                goodDirection="up"
                note={compareLabel ?? period?.label}
                meta={dataset ? `SQL · ${formatNumber(dataset.rowCount)} ROWS` : undefined}
                loading={loading}
                sparkline={points.map((p) => p.successful)}
              />
            </div>
            <div className="lg:col-span-2">
              <KpiCard label="Tingkat keberhasilan" value={successRate?.value ?? null} format="percent" delta={delta(successRate)} goodDirection="up" loading={loading} />
            </div>
            <div className="lg:col-span-2">
              <KpiCard label="Transaksi Gagal" value={failed?.value ?? null} format="number" delta={delta(failed)} goodDirection="down" loading={loading} />
            </div>
            <div className="lg:col-span-2">
              <div className="flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5">
                <p className="font-body text-label-sm uppercase text-ink-muted-strong">Dokumen terindeks</p>
                <p className="mt-3 font-body text-metric-display tabular text-ink">
                  {loading ? <Skeleton className="h-8 w-20" /> : `${num(docs?.indexed)}/${num(docs?.total)}`}
                </p>
                <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{num(docs?.chunks)} potongan</p>
                <div className="mt-auto pt-3"><MonoMeta>FTS5 · BM25</MonoMeta></div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Tren dari data nyata. Tooltip tidak menempel saat load. */}
            <div className="lg:col-span-7">
              <div className="rounded-card border border-border-hairline bg-surface">
                <header className="px-5 pb-3 pt-4">
                  <h3 className="font-body text-headline-sm text-ink">Transaksi per hari, {period?.label ?? '—'}</h3>
                </header>
                <div className="p-5">
                  <div className="mb-3 flex flex-wrap gap-4">
                    <span className="inline-flex items-center gap-2 font-body text-body-sm text-ink-muted-strong">
                      <span className="state-dot" aria-hidden="true" /> Sukses
                    </span>
                    <span className="inline-flex items-center gap-2 font-body text-body-sm text-ink-muted-strong">
                      <span className="state-dot state-dot-error" aria-hidden="true" /> Gagal
                    </span>
                  </div>
                  <svg viewBox="0 0 600 150" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Grafik tren transaksi harian">
                    {[30, 70, 110].map((y) => (
                      <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="var(--color-border-hairline)" strokeWidth="1" />
                    ))}
                    {successLine && <path d={successLine} fill="none" stroke="var(--color-primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                    {failedLine && <path d={failedLine} fill="none" stroke="var(--color-signal-terracotta)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
                  </svg>
                  <table className="sr-only">
                    <caption>Tren transaksi harian</caption>
                    <thead><tr><th>Tanggal</th><th>Sukses</th><th>Gagal</th></tr></thead>
                    <tbody>
                      {points.map((p) => (
                        <tr key={p.bucket}><td>{p.label}</td><td>{p.successful}</td><td>{p.failed}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Bukti dari API, bukan percakapan rekaan. */}
            <div className="lg:col-span-5">
              <div className="flex h-full flex-col rounded-card border border-border-hairline bg-surface">
                <header className="px-5 pb-3 pt-4">
                  <h3 className="font-body text-headline-sm text-ink">Temuan dari data</h3>
                </header>
                <div className="flex-1 space-y-3 p-5">
                  {insightItems.length === 0 && !insights.loading && (
                    <p className="font-body text-body-md text-ink-muted-strong">Belum ada temuan pada periode ini.</p>
                  )}
                  {insightItems.map((insight) => (
                    <div key={insight.id} className="rounded-control border border-border-hairline p-3">
                      <div className="flex items-start gap-2">
                        <span className={`state-dot mt-1.5 ${insight.severity === 'high' ? 'state-dot-error' : ''}`} aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="font-body text-body-md font-semibold text-ink">{insight.title}</p>
                          <p className="mt-1 font-body text-body-sm text-ink-muted-strong">{insight.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border-hairline px-5 py-3">
                  <MonoMeta>SQL · FTS5 · {insightItems.length} TEMUAN</MonoMeta>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* KAPABILITAS — nama fungsi, bukan buzzword. */}
      <section className="border-y border-border-hairline bg-surface">
        <div className="mx-auto max-w-[1600px] px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="font-display text-headline-lg text-ink">Tiga hal yang bisa dilakukan TanyaData</h2>
          <MeasurementRule className="my-6" />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              { icon: 'dashboard', title: 'Ringkasan', body: 'Pantau metrik transaksi dan lihat perubahan antarperiode.', meta: `SQL · ${capabilities?.sql ?? '—'}` },
              { icon: 'forum', title: 'Asisten', body: 'Tanyakan metrik dengan bahasa alami; jawaban menyertakan SQL dan sumber.', meta: `PENCARIAN · ${capabilities?.rag ?? '—'}` },
              { icon: 'query_stats', title: 'Investigasi', body: 'Telusuri anomali dan korelasikan dengan dokumen pendukung.', meta: 'FTS5 · BM25' },
            ].map((item) => (
              <div key={item.title} className="rounded-card border border-border-hairline bg-canvas p-5">
                <Icon name={item.icon} className="text-[24px] text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-body text-headline-sm text-ink">{item.title}</h3>
                <p className="mt-2 font-body text-body-md text-ink-muted-strong">{item.body}</p>
                <div className="mt-4 border-t border-border-hairline pt-3"><MonoMeta>{item.meta}</MonoMeta></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ALUR KERJA — tiga langkah nyata, tanpa template kartu bulat. */}
      <section className="mx-auto max-w-[1600px] px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="font-display text-headline-lg text-ink">Alur kerja</h2>
        <MeasurementRule className="my-6" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            { n: '01', title: 'Pilih sumber', body: 'Gunakan dataset bawaan atau unggah CSV/XLSX dan dokumen PDF/DOCX/TXT/MD.' },
            { n: '02', title: 'Ajukan pertanyaan', body: 'Tulis pertanyaan metrik; asisten menyusun query SQL deterministik.' },
            { n: '03', title: 'Periksa bukti', body: 'Baca angka, tabel pendukung, kutipan dokumen, dan query yang dipakai.' },
          ].map((step) => (
            <div key={step.n} className="border-t-2 border-primary pt-4">
              <MonoMeta>{step.n}</MonoMeta>
              <h3 className="mt-2 font-body text-headline-sm text-ink">{step.title}</h3>
              <p className="mt-2 font-body text-body-md text-ink-muted-strong">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* BUKTI: tabel kanal dari API. */}
      <section className="border-t border-border-hairline bg-surface">
        <div className="mx-auto max-w-[1600px] px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-headline-lg text-ink">Kanal dengan failure rate tertinggi</h2>
            <MonoMeta>{period?.label ?? '—'}</MonoMeta>
          </div>
          <MeasurementRule className="my-6" />
          <div className="overflow-x-auto rounded-card border border-border-hairline">
            <table className="w-full text-left">
              <thead className="bg-canvas">
                <tr>
                  <th className="px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong">Kanal</th>
                  <th className="px-4 py-3 text-right font-body text-label-sm uppercase text-ink-muted-strong">Transaksi</th>
                  <th className="px-4 py-3 text-right font-body text-label-sm uppercase text-ink-muted-strong">Failure rate</th>
                </tr>
              </thead>
              <tbody>
                {channelItems.map((channel, i) => (
                  <tr key={channel.channelId} className="border-t border-border-hairline hover:bg-row-hover">
                    <td className="px-4 py-3 font-body text-body-md text-ink">
                      <span className="inline-flex items-center gap-2">
                        <span className={`state-dot ${i === 0 ? 'state-dot-error' : ''}`} aria-hidden="true" />
                        {channel.channelName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-body text-body-md tabular text-ink">{num(channel.total)}</td>
                    <td className="px-4 py-3 text-right font-body text-body-md tabular text-error-text">{pct(channel.failureRate)}</td>
                  </tr>
                ))}
                {channelItems.length === 0 && !channels.loading && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center font-body text-body-md text-ink-muted-strong">Belum ada data kanal pada periode ini.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA — satu aksi primer, latar forest dengan focus ring lime. */}
      <section className="bg-primary">
        <div className="mx-auto max-w-[1600px] px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <MonoMeta className="!text-signal-lime">MULAI</MonoMeta>
              <h2 className="mt-3 font-display text-headline-lg text-on-primary">Buka workspace analitik</h2>
              <p className="mt-2 max-w-xl font-body text-body-lg text-primary-dim">
                Dataset dan dokumen sudah tersedia. Tidak perlu masuk atau menghubungkan layanan lain.
              </p>
            </div>
            <Link
              href="/overview"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-signal-lime px-6 font-body text-label-md font-semibold text-ink transition-transform duration-[var(--motion-fast)] hover:scale-[1.02] focus-ring-forest motion-reduce:transform-none"
            >
              Buka Ringkasan
              <Icon name="arrow_forward" className="text-[16px]" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER — dua kolom: identitas + rute nyata (L-07). */}
      <footer className="border-t border-border-hairline bg-surface">
        <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            <div>
              <p className="font-display text-headline-sm text-ink">TanyaData</p>
              <p className="mt-2 max-w-sm font-body text-body-md text-ink-muted-strong">
                Tanyakan datanya. Temukan wawasannya.
              </p>
              <div className="mt-4"><MonoMeta>SQLITE · SQL + FTS5 · READ ONLY</MonoMeta></div>
            </div>
            <div>
              <p className="mono-meta mb-3">RUTE WORKSPACE</p>
              <ul className="grid grid-cols-2 gap-2">
                {[
                  ['/overview', 'Ringkasan'],
                  ['/assistant', 'Asisten'],
                  ['/data-sources', 'Sumber Data'],
                  ['/investigations', 'Investigasi'],
                  ['/reports', 'Laporan'],
                  ['/settings', 'Pengaturan'],
                ].map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="inline-flex min-h-11 items-center font-body text-body-md text-ink-muted-strong transition-colors hover:text-primary focus-ring">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-8 border-t border-border-hairline pt-4">
            <MonoMeta>Dibuat oleh TanyaData · {new Date().getFullYear()}</MonoMeta>
          </div>
        </div>
      </footer>
    </main>
  );
}
