'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ReportListResponse, ReportDetailResponse, SettingsResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatDateEn, formatNumber } from '@/lib/ui/format';
import { toast } from '@/components/ui/toaster';
import { ReportDocument } from '@/components/reports/report-document';

/** Material Symbols self-hosted; dekoratif → aria-hidden (blueprint §2). */
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

const num = (value: number | null | undefined) => (value == null ? 'n/a' : formatNumber(value));

export default function ReportsPage() {
  const reports = useApi<ReportListResponse>('/api/reports?limit=20');
  const settings = useApi<SettingsResponse>('/api/settings');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');

  // Baris pertama dipilih otomatis agar canvas langsung menampilkan laporan nyata.
  useEffect(() => {
    if (!selectedId && reports.data?.items.length) {
      setSelectedId(reports.data.items[0].id);
    }
  }, [reports.data, selectedId]);

  // C-27 / ASSUMPTION-008: tidak ada field `type` di ReportListItem →
  // filter kategori dan kolom Category disembunyikan. Pencarian judul tetap aktif.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = reports.data?.items ?? [];
    return q ? all.filter((report) => report.title.toLowerCase().includes(q)) : all;
  }, [reports.data, query]);

  // Detail hanya di-fetch saat ada id valid (hindari GET /api/reports/ → 404 di console).
  const detail = useApi<ReportDetailResponse>(selectedId ? `/api/reports/${selectedId}` : '/api/reports?limit=1');
  const detailReady = Boolean(selectedId) && Boolean(detail.data?.report);

  const exportListCsv = () => {
    const header = ['id', 'title', 'period', 'dataset', 'createdAt'];
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const lines = [header.join(','), ...items.map((report) =>
      [report.id, report.title, report.period, report.dataset.name, report.createdAt].map(escape).join(','),
    )];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'tanyadata-reports.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const shareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ status: 'success', message: 'Secure link copied to clipboard.' });
    } catch {
      toast({ status: 'error', message: 'Could not copy the link.' });
    }
  };

  return (
    <div className="p-space-lg max-w-[1520px] mx-auto w-full flex flex-col gap-space-lg">
      {/* Top Executive Action Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
        <div className="flex flex-col">
          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline">Intelligence Operations</span>
            <span className="text-outline">/</span>
            <span className="font-label-sm text-label-sm text-primary font-bold uppercase tracking-wider">Archival &amp; Briefs</span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight mt-0.5">Reports</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Review, organize, and export analytical findings.</p>
        </div>
        <div className="flex items-center gap-space-sm self-start lg:self-center">
          {/* Schedule Distribution dihapus: tidak ada endpoint (blueprint §4.6). */}
          <Link
            href="/assistant"
            className="h-9 px-space-md rounded bg-primary-container text-on-primary hover:bg-primary font-label-md text-label-md flex items-center gap-2 transition-all shadow-sm"
          >
            <Icon name="add_circle" className="text-[18px]" />
            <span>Generate New Report</span>
          </Link>
        </div>
      </div>

      {/* Section 1: Report Listing & Index Table Container */}
      <div className="flex flex-col bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
        {/* Filter and Status Ribbon */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-space-md py-space-sm gap-space-sm bg-surface-container-low">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0" id="reportTabs">
            <button
              type="button"
              aria-current="page"
              className="px-space-md py-1.5 rounded-lg bg-surface-container-lowest text-primary font-label-md text-label-md shadow-xs flex items-center gap-1.5"
            >
              <span>All Reports</span>
              <span className="font-label-sm text-label-sm px-1.5 py-0.2 rounded-full bg-surface-container text-on-surface-variant">{num(reports.data?.total)}</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex items-center">
              <Icon name="filter_list" className="absolute left-2 text-[16px] text-outline" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter inventory..."
                aria-label="Filter inventory"
                className="w-44 pl-7 pr-3 py-1 h-7 rounded bg-surface-container-lowest font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:bg-surface-bright transition-colors"
              />
            </div>
            <button
              type="button"
              title="Export Table CSV"
              aria-label="Export table CSV"
              onClick={exportListCsv}
              className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface"
            >
              <Icon name="download" className="text-[18px]" />
            </button>
          </div>
        </div>

        {/* Precision Inventory Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="reportsInventoryTable">
            <thead>
              <tr className="bg-surface-container-high text-outline font-label-sm text-label-sm uppercase tracking-wider select-none">
                <th className="py-2.5 px-space-md">Report Title</th>
                {/* Category column dihapus: tidak ada field `type` (ASSUMPTION-008). */}
                <th className="py-2.5 px-space-md">Source Dataset</th>
                <th className="py-2.5 px-space-md">Generated</th>
                <th className="py-2.5 px-space-md">Author</th>
                <th className="py-2.5 px-space-md">Format</th>
                <th className="py-2.5 px-space-md text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low font-body-sm text-body-sm">
              {items.map((report) => {
                const active = report.id === selectedId;
                return (
                  <tr
                    key={report.id}
                    tabIndex={0}
                    onClick={() => setSelectedId(report.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(report.id);
                      }
                    }}
                    className={`hover:bg-surface-container-low transition-colors group cursor-pointer focus-ring ${active ? 'bg-surface-container-low' : 'bg-surface-container-lowest'}`}
                  >
                    <td className="py-3 px-space-md font-label-md text-label-md text-on-surface flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${active ? 'bg-secondary-fixed-dim' : 'bg-outline-variant'}`} />
                      <span className="group-hover:text-primary font-semibold transition-colors">{report.title}</span>
                      {active && (
                        <span className="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-primary-container/10 text-primary-container font-semibold">Active Preview</span>
                      )}
                    </td>
                    <td className="py-3 px-space-md font-mono text-outline">{report.dataset.name}</td>
                    <td className="py-3 px-space-md text-on-surface-variant font-mono">{formatDateEn(report.createdAt)}</td>
                    <td className="py-3 px-space-md">
                      <div className="flex items-center gap-1.5">
                        <Icon name="neurology" className="text-[16px] text-primary" />
                        <span className="text-on-surface font-medium">TanyaData Engine</span>
                      </div>
                    </td>
                    <td className="py-3 px-space-md">
                      <div className="flex items-center gap-1 font-label-sm text-label-sm">
                        <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-mono font-bold">PDF</span>
                        <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-mono font-bold">CSV</span>
                      </div>
                    </td>
                    <td className="py-3 px-space-md text-right">
                      <div className="inline-flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        <Link href={`/reports/${report.id}`} className="px-2 py-1 rounded bg-primary-container text-on-primary font-label-sm text-label-sm hover:bg-primary transition-colors">View</Link>
                        <a href={`/api/reports/${report.id}/export?format=pdf`} download className="px-2 py-1 rounded bg-surface-container text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm transition-colors">Export</a>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {reports.loading && (
                <tr><td colSpan={6} className="py-6 px-space-md text-center font-body-sm text-body-sm text-on-surface-variant">Loading reports…</td></tr>
              )}
              {!reports.loading && reports.error && (
                <tr><td colSpan={6} className="py-6 px-space-md text-center font-body-sm text-body-sm text-error">{reports.error}</td></tr>
              )}
              {!reports.loading && !reports.error && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 px-space-md text-center">
                    <p className="font-body-md text-body-md text-on-surface">{query ? 'No reports match your filter.' : 'No reports yet.'}</p>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                      Save an answer from the AI Assistant to create one.{' '}
                      <Link href="/assistant" className="text-primary font-semibold hover:underline">Open Assistant</Link>
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Report Document Visual Area (Bottom Half) */}
      <div className="flex flex-col gap-space-sm relative">
        {/* Section Meta & Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Document Stage</span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="font-label-md text-label-md font-semibold text-on-surface">Formal Printable Preview</span>
          </div>
          <div className="flex items-center gap-space-sm">
            <span className="font-label-sm text-label-sm text-outline font-mono">A4 Canvas • 100% Scale</span>
            <button
              type="button"
              onClick={() => window.print()}
              className="h-7 px-2.5 rounded bg-surface-container-lowest text-on-surface hover:bg-surface-container font-label-sm text-label-sm flex items-center gap-1 shadow-xs"
            >
              <Icon name="print" className="text-[15px]" />
              <span>Print Sheet</span>
            </button>
          </div>
        </div>

        {/* Physical Document Canvas */}
        {detailReady ? (
          <ReportDocument
            report={detail.data!.report}
            profileName={settings.data?.profile.name ?? ''}
            profileRole={settings.data?.profile.role ?? ''}
          />
        ) : (
          <div className="bg-surface-container-lowest rounded-xl shadow-md p-6 sm:p-10 flex flex-col gap-8 max-w-[1020px] mx-auto w-full relative print-document">
            <p className="font-body-md text-body-md text-on-surface-variant">
              {detail.loading ? 'Loading report…' : (detail.error ?? 'Select a report to preview.')}
            </p>
          </div>
        )}

        {/* Floating Sticky Action Deck for Active Document */}
        {detailReady && (
          <div className="sticky bottom-4 z-30 self-center">
            <div className="flex items-center gap-2 p-1.5 rounded-lg sm:rounded-full bg-surface-container-lowest shadow-xl">
              <a
                href={`/api/reports/${selectedId}/export?format=pdf`}
                download
                className="h-9 px-4 rounded-lg sm:rounded-full bg-primary-container text-on-primary hover:bg-primary font-label-md text-label-md flex items-center gap-2 transition-all shadow-sm"
              >
                <Icon name="picture_as_pdf" className="text-[18px]" />
                <span>Download PDF</span>
              </a>
              <a
                href={`/api/reports/${selectedId}/export?format=csv`}
                download
                className="h-9 px-4 rounded-lg sm:rounded-full bg-surface-container-high text-on-surface hover:bg-surface-container font-label-md text-label-md flex items-center gap-2 transition-colors"
              >
                <Icon name="csv" className="text-[18px] text-outline" />
                <span>Export Raw CSV</span>
              </a>
              <div className="h-4 w-px bg-surface-container" />
              <button
                type="button"
                onClick={() => void shareLink()}
                className="h-9 px-3.5 rounded-lg sm:rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-label-md text-label-md flex items-center gap-1.5 transition-colors"
              >
                <Icon name="share" className="text-[18px]" />
                <span className="hidden sm:inline">Share Secure Link</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
