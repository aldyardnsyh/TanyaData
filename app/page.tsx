'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/ui/format';
import { IconArrowDown } from '@/components/ui/icons';
import type { MetaResponse, DashboardSummaryResponse } from '@/lib/contracts/http';

export default function LandingPage() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/meta').then((r) => r.json()).catch(() => null),
      fetch('/api/dashboard/summary').then((r) => r.json()).catch(() => null),
    ])
      .then(([m, s]) => {
        setMeta(m);
        setSummary(s);
      })
      .finally(() => setLoading(false));
  }, []);

  const txCount = summary?.dataset.rowCount ?? meta?.data.activeDataset.rowCount ?? null;
  const docCount = meta?.data.documents.total ?? null;

  return (
    <main className="min-h-screen bg-surface">
      {/* Nav */}
      <nav className="fixed top-0 z-sticky w-full border-b border-outline-variant bg-surface" aria-label="Navigasi utama">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between px-6">
          <Link href="/" className="font-display text-headline-sm font-bold text-primary tracking-tight">
            TanyaData
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            <Link href="#cara-kerja" className="font-body text-label-md text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:text-on-surface focus-ring">
              Cara kerja
            </Link>
            <Link href="#kemampuan" className="font-body text-label-md text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:text-on-surface focus-ring">
              Kemampuan
            </Link>
            <Link href="#batasan" className="font-body text-label-md text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:text-on-surface focus-ring">
              Batasan
            </Link>
          </div>
          <Link
            href="/overview"
            className="rounded-md bg-surface-container-lowest border border-outline-variant px-4 py-2 font-body text-label-md font-semibold text-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
          >
            Buka Workspace
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto flex min-h-[80vh] max-w-[1240px] flex-col items-center justify-center gap-8 px-6 py-24 text-center lg:flex-row lg:text-left">
          <div className="flex flex-col gap-6 lg:max-w-[640px]">
            <span className="inline-flex items-center gap-2 rounded-pill bg-surface-container-high px-3 py-1 font-body text-label-sm font-semibold text-on-surface-variant">
              <span className="h-2 w-2 rounded-full bg-secondary-container" aria-hidden="true" />
              Berjalan lokal · Tanpa login
            </span>
            <h1 className="animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:80ms] font-display text-display-lg font-bold text-on-surface">
              Tanyakan datanya. <span className="italic text-primary">Temukan wawasannya.</span>
            </h1>
            <p className="animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:160ms] max-w-[62ch] font-body text-body-lg text-on-surface-variant">
              TanyaData mengubah data transaksi Anda menjadi jawaban yang terukur, dengan bukti SQL dan kutipan dokumen yang bisa diaudit.
            </p>
            <div className="animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:240ms] flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link
                href="/overview"
                className="rounded-md bg-primary px-5 py-3 font-body text-label-md font-semibold text-on-primary transition-colors duration-[var(--motion-fast)] hover:bg-primary-container focus-ring"
              >
                Buka Workspace
              </Link>
              <Link
                href="#cara-kerja"
                className="inline-flex min-h-11 items-center gap-1 rounded-md px-4 py-2 font-body text-label-md font-semibold text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:bg-surface-container hover:text-on-surface focus-ring"
              >
                Lihat cara kerjanya
                <IconArrowDown className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
          {/* Preview produk — ilustratif; hanya di layar, bukan pembaca layar */}
          <div className="w-full lg:w-[520px] animate-[entrance_240ms_var(--ease-out-quart)_both] [animation-delay:320ms]" aria-hidden="true">
            <Card className="rounded-xl shadow-sm">
              {/* Mini topbar */}
              <div className="flex flex-wrap items-center justify-between rounded-md bg-surface-container-low px-3 py-2 text-label-sm font-semibold text-on-surface">
                <span>Mode baca-saja</span>
                <span className="rounded-pill bg-surface-container-high px-2 py-0.5 text-on-surface-variant">
                  Mesin: SQLite · SQL + FTS5
                </span>
              </div>
              {/* 3 KPI nyata */}
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-md bg-surface-container-low p-3">
                  <p className="font-body text-label-sm text-on-surface-variant uppercase">Transaksi</p>
                  <p className="mt-1 font-display text-metric-xl font-bold text-on-surface tabular">
                    {loading ? <Skeleton className="h-8 w-20" /> : formatNumber(txCount)}
                  </p>
                </div>
                <div className="rounded-md bg-surface-container-low p-3">
                  <p className="font-body text-label-sm text-on-surface-variant uppercase">Dokumen</p>
                  <p className="mt-1 font-display text-metric-xl font-bold text-on-surface tabular">
                    {loading ? <Skeleton className="h-8 w-20" /> : formatNumber(docCount)}
                  </p>
                </div>
                <div className="rounded-md bg-surface-container-low p-3">
                  <p className="font-body text-label-sm text-on-surface-variant uppercase">Periode</p>
                  <p className="mt-1 font-display text-metric-xl font-bold text-on-surface tabular">
                    {loading ? <Skeleton className="h-8 w-20" /> : summary?.period?.label ?? meta?.data?.periodDefaults?.label ?? '—'}
                  </p>
                </div>
              </div>
              {/* 1 chart statis */}
              <div className="mt-4 h-24 rounded-md bg-surface-container-low" aria-hidden="true" />
              {/* 1 contoh tanya-jawab dengan chip SQL — ilustrasi, bukan hasil query nyata */}
              <div className="mt-4 space-y-2">
                <div className="flex justify-end">
                  <span className="rounded-md bg-surface-container-high px-3 py-2 font-body text-body-md text-on-surface">
                    Berapa total transaksi bulan ini?
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-container font-body text-label-sm font-bold text-on-primary">
                    Q
                  </span>
                  <span className="rounded-md bg-surface-container-lowest px-3 py-2 font-body text-body-md text-on-surface">
                    <span className="font-body text-on-surface-variant" aria-hidden="true">Ada XX.YYY transaksi pada periode yang Anda pilih.</span>
                    <span className="ml-2 inline-block rounded-sm bg-surface-container-low px-1.5 py-0.5 font-mono text-label-sm text-primary">
                      SQL
                    </span>
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </section>

      {/* Trust strip */}
      <section className="mx-auto max-w-[1240px] px-6 py-8">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-on-surface-variant">
          <span className="inline-flex items-center gap-1.5 font-body text-label-sm">
            <span className="h-2 w-2 rounded-full bg-secondary-container" aria-hidden="true" />
            Data tetap di perangkat Anda
          </span>
          <span className="hidden sm:inline">·</span>
          <span className="font-body text-label-sm">SQLite · SQL + FTS5</span>
          <span className="hidden sm:inline">·</span>
          <span className="inline-flex items-center gap-1.5 font-body text-label-sm">
            <span className="h-2 w-2 rounded-full bg-secondary-container" aria-hidden="true" />
            Setiap jawaban menyertakan bukti
          </span>
        </div>
      </section>

        {/* Cara kerja */}
        <section id="cara-kerja" className="mx-auto max-w-[1240px] px-6 py-16">
          <h2 className="text-center font-display text-headline-lg font-bold text-on-surface">Cara kerja</h2>
          <div className="mx-auto mt-8 grid max-w-[640px] grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { num: '01', title: 'Hubungkan sumber', desc: 'Unggah CSV/XLSX atau hubungkan database SQLite.' },
              { num: '02', title: 'Tanya dengan bahasa sehari-hari', desc: 'Tanyakan apa saja dalam Bahasa Indonesia atau Inggris.' },
              { num: '03', title: 'Telusuri bukti', desc: 'Jawaban selalu disertai SQL dan kutipan dokumen.' },
            ].map((step) => (
              <div key={step.num} className="rounded-xl bg-surface-container-lowest border border-outline-variant p-5">
                <p className="font-display text-metric-xl font-bold text-outline-variant">{step.num}</p>
                <h3 className="mt-2 font-display text-headline-sm font-semibold text-on-surface">{step.title}</h3>
                <p className="mt-1 font-body text-body-md text-on-surface-variant">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Kemampuan */}
        <section id="kemampuan" className="mx-auto max-w-[1240px] bg-surface-container-low px-6 py-16">
          <h2 className="mx-auto max-w-[640px] text-center font-display text-headline-lg font-bold text-on-surface">
            Kemampuan
          </h2>
          <div className="mx-auto mt-8 grid max-w-[640px] grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { title: 'Ringkasan performa', desc: 'Ringkas kondisi bisnis dari dataset aktif dengan KPI dan tren.', href: '/overview' },
              { title: 'Asisten berbukti', desc: 'Tanya-jawab data dengan jawaban terukur dan bukti SQL.', href: '/assistant' },
              { title: 'Investigasi akar masalah', desc: 'Identifikasi akar masalah dengan analisis kanal dan kategori.', href: '/investigations' },
            ].map((cap) => (
              <div key={cap.title} className="rounded-xl bg-surface-container-lowest border border-outline-variant p-5">
                <h3 className="font-display text-headline-sm font-semibold text-on-surface">{cap.title}</h3>
                <p className="mt-1 font-body text-body-md text-on-surface-variant">{cap.desc}</p>
                <Link
                  href={cap.href}
                  className="mt-3 inline-block font-body text-label-md font-semibold text-primary transition-colors duration-[var(--motion-fast)] hover:underline focus-ring"
                >
                  Pelajari lebih lanjut →
                </Link>
              </div>
            ))}
          </div>
        </section>

      {/* Batasan */}
      <section id="batasan" className="mx-auto max-w-[1240px] px-6 py-16">
        <h2 className="text-center font-display text-headline-lg font-bold text-on-surface">Batasan</h2>
          <div className="mx-auto mt-6 max-w-[640px] space-y-3">
            <div className="rounded-md bg-surface-container-low px-4 py-3 font-body text-body-md text-on-surface-variant">
              Tanpa login; workspace dapat diakses siapa saja.
            </div>
            <div className="rounded-md bg-surface-container-low px-4 py-3 font-body text-body-md text-on-surface-variant">
              Berjalan lokal / state dapat hilang di hosting ephemeral.
            </div>
            <div className="rounded-md bg-surface-container-low px-4 py-3 font-body text-body-md text-on-surface-variant">
              Bukan pengganti sistem transaksi.
            </div>
          </div>
        </section>

      {/* Footer */}
      <footer className="mx-auto max-w-[1240px] border-t border-outline-variant px-6 py-8 text-center">
        <p className="font-body text-body-sm text-on-surface-variant">TanyaData · 2026</p>
        <Link
          href="#batasan"
          className="mt-2 inline-block font-body text-label-sm font-semibold text-primary transition-colors duration-[var(--motion-fast)] hover:underline focus-ring"
        >
          Batasan
        </Link>
      </footer>
    </main>
  );
}
