'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReportListResponse, ReportDetailResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ReportDocument } from '@/components/reports/report-document';

export default function ReportsPage() {
  const reports = useApi<ReportListResponse>('/api/reports?limit=20');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    if (!selectedId && reports.data?.items.length) setSelectedId(reports.data.items[0].id);
  }, [reports.data, selectedId]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = reports.data?.items ?? [];
    return q ? all.filter((report) => report.title.toLowerCase().includes(q)) : all;
  }, [reports.data, query]);

  const detail = useApi<ReportDetailResponse>(selectedId ? `/api/reports/${selectedId}` : '/api/reports?limit=1');
  const detailReady = Boolean(selectedId) && Boolean(detail.data?.report);

  const exportListCsv = () => {
    const header = ['id', 'title', 'period', 'dataset', 'createdAt'];
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const lines = [header.join(','), ...items.map((report) => [report.id, report.title, report.period, report.dataset.name, report.createdAt].map(escape).join(','))];
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv; charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'tanyadata-laporan.csv'; anchor.click(); URL.revokeObjectURL(url);
  };

  const shareLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast({ status: 'success', message: 'Tautan disalin.' }); }
    catch { toast({ status: 'error', message: 'Tautan gagal disalin.' }); }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Laporan"
        subtitle="Tinjau dan ekspor temuan analitik yang tersimpan."
        meta={`${reports.data?.total ?? 0} LAPORAN`}
        actions={<Link href="/assistant" className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary transition-colors hover:bg-[#0A3A2C] focus-ring-forest"><Icon name="add" className="text-[16px]" aria-hidden="true" /> Buat dari asisten</Link>}
      />

      <section className="overflow-hidden rounded-card border border-border-hairline bg-surface">
        <header className="measurement-rule px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-body text-headline-sm text-ink">Daftar laporan</h2>
              <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Pilih laporan untuk melihat pratinjau dokumen.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter judul…" aria-label="Filter judul laporan" className="min-h-11 rounded-control border border-border-control bg-surface px-3 font-body text-body-md text-ink placeholder:text-ink-muted-strong focus-ring" />
              <Button variant="secondary" size="sm" onClick={exportListCsv} aria-label="Ekspor daftar CSV"><Icon name="download" className="text-[16px]" aria-hidden="true" /> Ekspor CSV</Button>
            </div>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-canvas"><tr>{['Judul laporan', 'Dataset', 'Dibuat', 'Aksi'].map((h, i) => <th key={h} className={`whitespace-nowrap px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong ${i === 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>
              {reports.loading && <tr><td colSpan={4} className="px-4 py-4"><Skeleton className="h-8 w-full" /></td></tr>}
              {!reports.loading && reports.error && <tr><td colSpan={4} className="px-4 py-4 font-body text-body-md text-error-text">{reports.error}</td></tr>}
              {!reports.loading && !reports.error && items.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center"><p className="font-body text-body-md text-ink">{query ? 'Tidak ada laporan yang cocok.' : 'Belum ada laporan.'}</p><p className="mt-1 font-body text-body-sm text-ink-muted-strong">Simpan jawaban dari asisten untuk membuat laporan. <Link href="/assistant" className="font-semibold text-primary hover:underline focus-ring">Buka asisten</Link></p></td></tr>
              )}
              {items.map((report) => {
                const active = report.id === selectedId;
                return (
                  <tr key={report.id} tabIndex={0} onClick={() => setSelectedId(report.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(report.id); } }} className={`cursor-pointer border-t border-border-hairline transition-colors hover:bg-row-hover focus-ring ${active ? 'bg-row-hover' : ''}`}>
                    <td className="px-4 py-3 font-body text-body-md text-ink"><span className="inline-flex items-center gap-2"><span className={`state-dot shrink-0 ${active ? 'state-dot-active' : ''}`} aria-hidden="true" /><span className="font-semibold">{report.title}</span></span></td>
                    <td className="px-4 py-3"><MonoMeta>{report.dataset.name}</MonoMeta></td>
                    <td className="px-4 py-3 font-body text-body-sm text-ink-muted-strong">{report.createdAt.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        <Link href={`/reports/${report.id}`} className="inline-flex min-h-11 items-center rounded-control px-2 font-body text-label-md font-semibold text-primary hover:bg-row-hover focus-ring">Lihat</Link>
                        <a href={`/api/reports/${report.id}/export?format=pdf`} download className="inline-flex min-h-11 items-center rounded-control px-2 font-body text-label-md text-ink-muted-strong hover:bg-row-hover focus-ring">PDF</a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border-hairline px-4 py-2"><MonoMeta>{items.length} LAPORAN</MonoMeta></div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><MonoMeta>PRATINJAU DOKUMEN</MonoMeta><span className="state-dot" aria-hidden="true" /><span className="font-body text-body-md font-semibold text-ink">Pratinjau cetak</span></div>
          <div className="flex items-center gap-2"><MonoMeta>A4 · 100%</MonoMeta><Button variant="secondary" size="sm" onClick={() => window.print()}><Icon name="print" className="text-[16px]" aria-hidden="true" /> Cetak</Button></div>
        </div>
        {detailReady ? <ReportDocument report={detail.data!.report} profileName="" profileRole="" /> : (
          <div className="mx-auto flex w-full max-w-[1020px] flex-col gap-8 rounded-card border border-border-hairline bg-surface p-6 sm:p-10"><p className="font-body text-body-md text-ink-muted-strong">{detail.loading ? 'Memuat laporan…' : detail.error ?? 'Pilih laporan untuk melihat pratinjau.'}</p></div>
        )}
        {detailReady && (
          <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-center gap-2 self-center rounded-overlay border border-border-hairline bg-surface p-2 shadow-overlay">
            <a href={`/api/reports/${selectedId}/export?format=pdf`} download className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary transition-colors hover:bg-[#0A3A2C] focus-ring-forest"><Icon name="picture_as_pdf" className="text-[16px]" aria-hidden="true" /> Unduh PDF</a>
            <a href={`/api/reports/${selectedId}/export?format=csv`} download className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-control px-4 font-body text-label-md text-ink transition-colors hover:border-primary focus-ring"><Icon name="download" className="text-[16px]" aria-hidden="true" /> Ekspor CSV</a>
            <Button variant="ghost" onClick={() => void shareLink()}><Icon name="link" className="text-[16px]" aria-hidden="true" /> Salin tautan</Button>
          </div>
        )}
      </section>
    </div>
  );
}
