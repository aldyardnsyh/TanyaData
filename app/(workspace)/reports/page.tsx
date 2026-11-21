'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReportDetailResponse, ReportListResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { Icon } from '@/components/ui/icons';
import { SectionRule } from '@/components/signal/section-rule';
import { StatusBadge } from '@/components/signal/status-badge';
import { ReportDocument } from '@/components/reports/report-document';
import { toast } from '@/components/ui/toaster';

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
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'tanyadata-laporan.csv'; anchor.click();
    URL.revokeObjectURL(url);
  };

  const shareLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast({ status: 'success', message: 'Tautan disalin.' }); }
    catch { toast({ status: 'error', message: 'Tautan gagal disalin.' }); }
  };

  // Metrik band dari data existing: total laporan tersimpan + jejak laporan
  // terbaru (daftar diurutkan created_at DESC, items[0] = laporan terakhir).
  const datasetName = reports.data?.items[0]?.dataset.name;
  const latestReport = reports.data?.items[0];
  const bannerStats = [
    { id: 'created', label: 'Terakhir dibuat', value: latestReport ? latestReport.createdAt.slice(0, 10) : '—' },
    { id: 'period', label: 'Periode terakhir', value: latestReport?.period || '—' },
  ];

  return (
    <>
      {/* Band gelap struktural: kepala halaman + metrik ringkas laporan menyatu
          di satu band, idiom band Ringkasan (grid + glow lime). Disembunyikan
          saat cetak agar keluaran print tetap dokumen saja. */}
      <section data-nav-theme="dark" aria-label="Ringkasan laporan" className="print-no-print relative overflow-hidden bg-forest text-porcelain">
        <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
        <div
          aria-hidden="true"
          className="glow-radial-lime absolute -right-24 -top-28 h-[320px] w-[440px] max-w-none"
        />
        <div className="page-container relative pb-s5 pt-s5">
          <div className="flex flex-wrap items-start justify-between gap-s3">
            <div className="min-w-0">
              <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                {datasetName ? `TanyaData · ${datasetName}` : 'TanyaData'}
              </p>
              <h1 className="mt-s2 font-display text-display text-porcelain">Laporan</h1>
              <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
                Tinjau dan ekspor temuan analitik yang tersimpan.
              </p>
            </div>
            <Link href="/assistant" className="touch-44 inline-flex items-center gap-s2 rounded-control bg-lime px-s3 font-display text-label font-semibold text-ink focus-ring-forest">
              <Icon name="add" className="text-[16px]" /> Buat dari asisten
            </Link>
          </div>

          <div className="mt-s5 grid items-end gap-s4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5">
              {reports.loading && (
                <div aria-busy="true" aria-label="Memuat ringkasan laporan">
                  <div className="animate-skeleton h-s5 w-40 rounded-control bg-porcelain/10" aria-hidden="true" />
                  <div className="animate-skeleton mt-s2 h-s6 w-56 rounded-control bg-porcelain/10" aria-hidden="true" />
                </div>
              )}
              {reports.error && (
                <div role="alert" className="flex flex-col items-start gap-s2">
                  <span className="inline-flex items-center gap-s2">
                    <span className="state-dot state-dot-error" aria-hidden="true" />
                    <span className="font-body text-body text-porcelain">Ringkasan laporan gagal dimuat.</span>
                  </span>
                  <button type="button" onClick={reports.retry} className="touch-44 rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain hover:border-porcelain focus-ring">
                    Coba lagi
                  </button>
                </div>
              )}
              {!reports.loading && !reports.error && (
                <>
                  <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                    Laporan tersimpan
                  </p>
                  <p className="text-stat-lg text-lime text-glow-lime">{reports.data?.total ?? 0}</p>
                  <p className="mt-s2 font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">
                    SQLITE · SQL + FTS5 · READ ONLY
                  </p>
                </>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:col-span-7">
              {bannerStats.map((item) => (
                <div key={item.id} className="min-w-0">
                  <dt className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">{item.label}</dt>
                  <dd className="mt-s1 truncate font-body text-metric tabular text-porcelain">
                    {reports.loading ? (
                      <span className="animate-skeleton inline-block h-s5 w-24 rounded-control bg-porcelain/10" aria-hidden="true" />
                    ) : reports.error ? (
                      '—'
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Zona kerja terang: daftar kartu hover-lift + panel dokumen cetak. */}
      <div className="page-container pb-s6" data-nav-theme="light">
        <div className="grid-dashboard mt-s5">
          {/* Daftar: 4 kolom. Kartu laporan memakai grammar hover lift. */}
          <section className="surface col-span-4 flex flex-col p-s4 xl:col-span-4" aria-labelledby="daftar-heading">
            <div className="mb-s3 flex flex-wrap items-start justify-between gap-s2">
              <div>
                <h2 id="daftar-heading" className="font-display text-title text-ink">Daftar laporan</h2>
                <p className="mt-s1 font-body text-caption text-ink-72">Pilih laporan untuk melihat pratinjau.</p>
              </div>
            </div>
            <SectionRule className="mb-s3" />
            <div className="mb-s3 flex flex-wrap gap-s2">
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter judul" aria-label="Filter judul laporan" className="min-h-11 min-w-0 flex-1 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-caption text-ink placeholder:text-ink-72 focus-ring" />
              <button type="button" onClick={exportListCsv} aria-label="Ekspor daftar CSV" className="touch-44 inline-flex items-center justify-center rounded-control border border-[var(--border-hairline)] px-s3 text-ink-72 focus-ring"><Icon name="download" className="text-[16px]" /></button>
            </div>
            {reports.loading ? (
              <div className="space-y-s2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16 w-full" />)}</div>
            ) : reports.error ? (
              <div className="flex flex-col items-start gap-s2" role="alert"><StatusBadge label="Gagal" tone="error" /><span className="font-body text-body text-ink">{reports.error}</span><button type="button" onClick={reports.retry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button></div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-start gap-s2 py-s4">
                <StatusBadge label="Kosong" tone="neutral" />
                <p className="font-body text-body text-ink">{query ? 'Tidak ada laporan yang cocok.' : 'Belum ada laporan.'}</p>
                <p className="font-body text-caption text-ink-72">Simpan jawaban dari asisten untuk membuat laporan.</p>
                <Link href="/assistant" className="touch-44 inline-flex items-center font-display text-label font-semibold text-forest focus-ring">Buka asisten</Link>
              </div>
            ) : (
              <ul className="flex flex-col gap-s2">
                {items.map((report) => {
                  const active = report.id === selectedId;
                  return (
                    <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(report.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex min-h-11 w-full flex-col items-start gap-s1 rounded-surface border px-s3 py-s3 text-left transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none focus-ring ${active ? 'border-forest bg-forest-08' : 'border-[var(--border-hairline)]'}`}
                      >
                        <span className="flex w-full items-center justify-between gap-s2">
                          <span className="inline-flex items-center gap-s2 font-body text-body font-semibold text-ink"><span className={`state-dot ${active ? 'state-dot-active' : ''}`} aria-hidden="true" />{report.title}</span>
                          {active && <Icon name="arrow_forward" className="text-[16px] text-forest" />}
                        </span>
                        <span className="mono-meta max-w-full truncate">{[report.period, report.dataset.name, report.createdAt.slice(0, 10)].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-auto border-t border-[var(--border-hairline)] pt-s2"><span className="mono-meta">{items.length} LAPORAN</span></div>
          </section>

          {/* Pratinjau: 8 kolom. Dokumen cetak A4 di panggung rounded-card-lg. */}
          <section className="col-span-4 flex flex-col gap-s3 xl:col-span-8" aria-labelledby="pratinjau-heading">
            <div className="flex flex-wrap items-center justify-between gap-s2">
              <div className="flex items-center gap-s2"><span className="mono-meta" id="pratinjau-heading">PRATINJAU DOKUMEN</span><span className="state-dot" aria-hidden="true" /><span className="font-body text-body font-semibold text-ink">Pratinjau cetak</span></div>
              <div className="flex items-center gap-s2"><span className="mono-meta">A4 · 100%</span><button type="button" onClick={() => window.print()} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="print" className="text-[16px]" /> Cetak</button></div>
            </div>
            <SectionRule />
            <div className="rounded-card-lg border border-[var(--border-hairline)] bg-forest-08 p-s3 print:border-none print:bg-transparent print:p-0">
              {detailReady ? <ReportDocument report={detail.data!.report} profileName="" profileRole="" /> : (
                <div className="mx-auto flex w-full max-w-[1020px] flex-col gap-s5 rounded-surface border border-[var(--border-hairline)] bg-porcelain p-s5">
                  <p className="font-body text-body text-ink-72">{detail.loading ? 'Memuat laporan' : detail.error ?? 'Pilih laporan untuk melihat pratinjau.'}</p>
                </div>
              )}
            </div>
            {detailReady && (
              <div className="sticky bottom-s3 z-sticky flex flex-wrap items-center justify-center gap-s2 self-center rounded-overlay border border-[var(--border-hairline)] bg-porcelain p-s2 elevated">
                <a href={`/api/reports/${selectedId}/export?format=pdf`} download className="touch-44 inline-flex items-center gap-s2 rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring"><Icon name="picture_as_pdf" className="text-[16px]" /> Unduh PDF</a>
                <a href={`/api/reports/${selectedId}/export?format=csv`} download className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="download" className="text-[16px]" /> Ekspor CSV</a>
                <button type="button" onClick={() => void shareLink()} className="touch-44 inline-flex items-center gap-s2 rounded-control px-s3 font-display text-label text-ink-72 focus-ring"><Icon name="link" className="text-[16px]" /> Salin tautan</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
