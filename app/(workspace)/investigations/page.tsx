'use client';

/**
 * Halaman Investigasi — pustaka investigasi tersimpan (app/(workspace)/investigations/page.tsx).
 * Konsep (paralel ringkasan per dokumen): investigasi = analisis mendalam per
 * SUMBER DATA, dijalankan dari halaman detail sumber (/data-sources/[id]).
 * Halaman ini bukan tempat menganalisis — tempat menemukan kembali hasil yang
 * sudah disimpan lintas sumber.
 */
import { useState } from 'react';
import Link from 'next/link';
import type { InvestigationsListResponse, MetaResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { SectionRule } from '@/components/signal/section-rule';
import { StatusBadge } from '@/components/signal/status-badge';
import { GlowingCTA } from '@/components/signal/glowing-cta';
import { NoDocumentsEmpty } from '@/components/ui/no-documents-empty';

const num = (v: number | null | undefined) => (v == null ? '0' : formatNumber(v));
const CLAIM_LABEL: Record<string, string> = { proven: 'Terbukti', measured: 'Terukur', indication: 'Indikasi' };

function wibDate(iso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export default function InvestigationsPage() {
  const saved = useApi<InvestigationsListResponse>('/api/investigations?limit=50');
  const meta = useApi<MetaResponse>('/api/meta');
  const [query, setQuery] = useState('');

  // null = belum tahu; jangan klaim "tidak ada dokumen" sebelum meta siap.
  const hasDocuments = meta.loading || meta.error ? null : (meta.data?.data.documents.total ?? 0) > 0;
  const items = saved.data?.items ?? [];
  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      item.question.toLowerCase().includes(q) || (item.datasetName ?? '').toLowerCase().includes(q));
  })();

  return (
    <>
      {/* Band gelap struktural: identitas halaman + jumlah investigasi + CTA mulai. */}
      <section data-nav-theme="dark" aria-label="Investigasi tersimpan" className="relative overflow-hidden bg-forest text-porcelain">
        <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
        <div aria-hidden="true" className="glow-radial-lime absolute -right-24 -top-28 h-[320px] w-[440px] max-w-none" />
        <div className="page-container relative pb-s5 pt-s5">
          <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">TanyaData</p>
          <h1 className="mt-s2 font-display text-display text-porcelain">Investigasi</h1>
          <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
            Analisis mendalam atas satu sumber data: apa yang berubah, apa penyebabnya,
            dan seberapa jauh buktinya. Jalankan dari halaman detail sumber.
          </p>
          <div className="mt-s5 flex flex-wrap items-end justify-between gap-s4">
            <div className="min-w-0">
              <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">Investigasi tersimpan</p>
              <p className="text-stat-lg text-lime text-glow-lime">{saved.loading ? '…' : num(saved.data?.total)}</p>
            </div>
            <Link href="/data-sources" className="touch-44 inline-flex items-center gap-s2 rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain transition-colors hover:border-porcelain focus-ring">
              <Icon name="database" className="text-[16px]" /> Mulai dari sumber data
            </Link>
          </div>
        </div>
      </section>

      {/* Zona terang: daftar investigasi tersimpan lintas sumber. */}
      <div className="page-container pb-s6" data-nav-theme="light">
        <SectionRule className="mt-s5" />

        <section className="mt-s5" aria-labelledby="daftar-heading">
          <div className="mb-s3 flex flex-wrap items-end justify-between gap-s3">
            <div>
              <h2 id="daftar-heading" className="font-display text-title text-ink">Dossier tersimpan</h2>
              <p className="mt-s1 font-body text-caption text-ink-72">Hasil analisis yang sudah disimpan, dari semua sumber.</p>
            </div>
            <label className="relative block w-full max-w-xs">
              <span className="sr-only">Cari investigasi</span>
              <Icon name="search" className="pointer-events-none absolute left-s2 top-1/2 -translate-y-1/2 text-[16px] text-ink-72" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari pertanyaan atau sumber" className="min-h-11 w-full rounded-control border border-[var(--border-hairline)] bg-porcelain pl-s5 pr-s2 font-body text-caption text-ink placeholder:text-ink-72 focus-ring" />
            </label>
          </div>
          <SectionRule className="mb-s3" />

          {saved.loading && <div className="skeleton h-40 w-full" aria-busy="true" />}
          {saved.error && (
            <div role="alert" className="flex flex-col items-start gap-s2">
              <span className="inline-flex items-center gap-s2"><StatusBadge label="Gagal" tone="error" /><span className="font-body text-body text-ink">Dossier gagal dimuat.</span></span>
              <button type="button" onClick={saved.retry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
            </div>
          )}
          {!saved.loading && !saved.error && filtered.length === 0 && (
            items.length === 0 && hasDocuments === false ? (
              <div className="surface rounded-card-lg p-s4">
                <NoDocumentsEmpty heading="Belum ada investigasi" />
              </div>
            ) : (
              <div className="surface flex flex-col items-start gap-s3 p-s4">
                <p className="font-body text-body text-ink">
                  {items.length === 0 ? 'Belum ada investigasi tersimpan.' : 'Tidak ada yang cocok dengan pencarian.'}
                </p>
                {items.length === 0 && (
                  <>
                    <p className="font-body text-caption text-ink-72">Buka sumber data bertipe dataset, lalu jalankan analisis dari section Investigasi.</p>
                    <Link href="/data-sources" className="touch-44 inline-flex items-center gap-s2 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">
                      <Icon name="database" className="text-[16px]" /> Buka sumber data
                    </Link>
                  </>
                )}
              </div>
            )
          )}

          <ul className="space-y-s2">
            {filtered.map((item) => (
              <li key={item.id}>
                <Link href={`/investigations/${item.id}`} className="block min-h-11 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 py-s2 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none focus-ring">
                  <span className="block font-body text-body font-semibold text-ink">{item.question}</span>
                  <span className="mt-s1 flex flex-wrap items-center gap-s2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-72">
                    {item.datasetName && <span className="inline-flex items-center gap-s1"><Icon name="database" className="text-[13px]" />{item.datasetName}</span>}
                    <span>{item.period}</span>
                    {item.topChannel && <span>· {item.topChannel}</span>}
                    <span>· {CLAIM_LABEL[item.claimLevel] ?? item.claimLevel}</span>
                    <span>· {wibDate(item.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Penjelasan mekanisme: dari mana investigasi berasal. */}
        <section className="surface mt-s5 p-s4" aria-labelledby="cara-heading">
          <h2 id="cara-heading" className="font-display text-title text-ink">Cara kerja investigasi</h2>
          <SectionRule className="mb-s3 mt-s2" />
          <div className="grid-dashboard">
            <div className="col-span-4 sm:col-span-2 xl:col-span-4">
              <span className="mono-meta">1 · PILIH SUMBER</span>
              <p className="mt-s2 font-body text-caption text-ink-72">Investigasi berlaku pada satu sumber data terstruktur (dataset), setara dengan ringkasan yang berlaku pada satu dokumen.</p>
            </div>
            <div className="col-span-4 sm:col-span-2 xl:col-span-4">
              <span className="mono-meta">2 · AJUKAN PERTANYAAN</span>
              <p className="mt-s2 font-body text-caption text-ink-72">Dari halaman detail sumber, tulis pertanyaan (opsional: fokus kanal/kategori) lalu jalankan analisis.</p>
            </div>
            <div className="col-span-4 sm:col-span-2 xl:col-span-4">
              <span className="mono-meta">3 · SIMPAN DOSSIER</span>
              <p className="mt-s2 font-body text-caption text-ink-72">Dossier menyimpan kontribusi, linimasa, kesimpulan, dan jejak SQL, lalu dapat dibuka kembali dari halaman ini.</p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
