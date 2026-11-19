'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import type { ReportListResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatDateId, formatDateTimeId } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/inline-error';
import { Dialog } from '@/components/ui/dialog';

const FILTERS = [
  { id: 'all', label: 'Semua' },
  { id: 'bulan_ini', label: 'Bulan ini' },
];

export default function ReportsPage() {
  const reports = useApi<ReportListResponse>('/api/reports?limit=20');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const items = (reports.data?.items ?? []).filter((r) => {
    const q = query.trim().toLowerCase();
    if (q && !r.title.toLowerCase().includes(q)) return false;
    if (filter === 'bulan_ini') {
      const d = new Date(r.createdAt);
      const now = new Date();
      if (d.getUTCFullYear() !== now.getUTCFullYear() || d.getUTCMonth() !== now.getUTCMonth()) return false;
    }
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
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <FileText className="h-4 w-4" /> Buat laporan
        </Button>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-2.5 py-1 font-body text-label-md transition-colors duration-[var(--motion-fast)] focus-ring ${
                filter === f.id ? 'bg-surface-container-high text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari laporan…"
          aria-label="Cari laporan"
          className="h-8 w-48 rounded-md border border-outline-variant bg-surface-container-lowest px-3 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:shadow-[var(--focus-ring)] focus:outline-none"
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
            title={query || filter !== 'all' ? 'Tidak ada laporan yang cocok' : 'Belum ada laporan'}
            description={query || filter !== 'all' ? 'Coba ubah filter atau pencarian.' : 'Buat laporan dari jawaban asisten atau investigasi.'}
            action={
              query || filter !== 'all' ? (
                <Button size="sm" variant="secondary" onClick={() => { setQuery(''); setFilter('all'); }}>Reset filter</Button>
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

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Buat laporan"
        description="Laporan dibuat dari jawaban asisten atau investigasi yang tersimpan."
      >
        <p className="font-body text-body-md text-on-surface-variant">
          Buka Asisten, lalu pilih “Simpan sebagai laporan” pada jawaban yang ingin Anda arsipkan.
        </p>
        <div className="flex justify-end">
          <Link href="/assistant">
            <Button variant="primary" onClick={() => setCreateOpen(false)}>Buka Asisten</Button>
          </Link>
        </div>
      </Dialog>
    </div>
  );
}
