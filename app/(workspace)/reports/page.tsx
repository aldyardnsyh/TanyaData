'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import type { ReportListResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatDateTimeId } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/inline-error';

export default function ReportsPage() {
  const reports = useApi<ReportListResponse>('/api/reports?limit=20');
  const [query, setQuery] = useState('');

  // C-27: API tidak menyediakan `type` → filter jenis disembunyikan (jangan mengarang kategori).
  // Yang tersisa hanya pencarian judul.
  const items = (reports.data?.items ?? []).filter((r) => {
    const q = query.trim().toLowerCase();
    if (q && !r.title.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-headline-xl font-bold tracking-tight text-on-surface">Laporan</h1>
          <p className="mt-0.5 font-body text-body-md text-on-surface-variant">
            Tinjau dan ekspor laporan yang tersimpan · {formatNumber(reports.data?.total ?? null)} laporan
          </p>
        </div>
        {/* C-26: laporan dibuat dari jawaban asisten; tidak ada endpoint create terpisah →
            tombol langsung menuju Asisten, tanpa dialog perantara (R-26). */}
        <Link href="/assistant">
          <Button variant="primary">
            <FileText className="h-4 w-4" /> Buat dari asisten
          </Button>
        </Link>
      </div>

      {/* Pencarian */}
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari laporan…"
          aria-label="Cari laporan"
          className="h-8 w-full rounded-md border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none sm:w-60"
        />
      </div>

      {/* Daftar */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
        {reports.loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : reports.error ? (
          <div className="p-4">
            <InlineError title="Gagal memuat daftar laporan" message={reports.error} onRetry={reports.retry} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title={query ? 'Tidak ada laporan yang cocok' : 'Belum ada laporan'}
            description={query ? 'Coba ubah kata pencarian.' : 'Buat laporan dari jawaban asisten.'}
            action={
              query ? (
                <Button size="sm" variant="secondary" onClick={() => setQuery('')}>Reset pencarian</Button>
              ) : (
                <Link href="/assistant">
                  <Button size="sm" variant="secondary">Buat dari asisten</Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="divide-y divide-outline-variant">
            {items.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/reports/${r.id}`} className="block truncate font-body text-label-md font-semibold text-on-surface hover:underline focus-ring">
                    {r.title}
                  </Link>
                  <p className="font-body text-body-sm text-on-surface-variant">
                    {r.period} · {r.dataset.name} · {formatDateTimeId(r.createdAt)}
                  </p>
                </div>
                <Link href={`/reports/${r.id}`}>
                  <Button size="sm" variant="secondary">Buka</Button>
                </Link>
                <a href={`/api/reports/${r.id}/export?format=pdf`} download>
                  <Button size="sm" variant="ghost" aria-label={`Ekspor PDF ${r.title}`}>
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}