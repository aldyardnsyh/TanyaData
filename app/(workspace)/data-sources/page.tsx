'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  ApiErrorCode,
  IngestionJob,
  MetaResponse,
  PreviewResponse,
  ReindexResponse,
  SourceDetailResponse,
  SourceListItem,
  SourcesListResponse,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';
import { StatusDot, type DotState } from '@/components/ui/status-dot';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/filter-chips';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Data yang dikirim tidak valid.',
  NOT_FOUND: 'Sumber tidak ditemukan.',
  METHOD_NOT_ALLOWED: 'Metode tidak didukung.',
  CONFLICT: 'Sumber tidak dapat diubah pada kondisi saat ini.',
  FILE_TOO_LARGE: 'Ukuran file melebihi batas 25 MB.',
  UNSUPPORTED_MEDIA_TYPE: 'Format file tidak didukung.',
  UNPROCESSABLE_SOURCE: 'File tidak dapat diproses. Periksa format atau kolom wajibnya.',
  INTERNAL_ERROR: 'Terjadi kesalahan internal. Silakan coba lagi.',
};

const ACCEPT = '.csv,.xlsx,.pdf,.docx,.txt,.md';
const DATASET_EXTS = ['.csv', '.xlsx'];
const DOCUMENT_EXTS = ['.pdf', '.docx', '.txt', '.md'];
const MAX_BYTES = 25 * 1024 * 1024;
const num = (value: number | null | undefined) => (value == null ? '—' : formatNumber(value));

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
function formatLabel(format: string): string { return format === 'seed-dataset' ? 'SEED' : format.toUpperCase(); }
function sourceIcon(source: SourceListItem): string {
  if (source.kind === 'document') return source.format === 'pdf' ? 'picture_as_pdf' : source.format === 'txt' || source.format === 'md' ? 'text_snippet' : 'description';
  return source.format === 'xlsx' ? 'view_comfy_alt' : source.format === 'csv' ? 'table_chart' : 'dns';
}
function statusState(status: string): DotState {
  if (status === 'READY') return 'active';
  if (status === 'FAILED') return 'error';
  return 'loading';
}
function statusLabel(status: string): string {
  if (status === 'READY') return 'Siap';
  if (status === 'FAILED') return 'Gagal';
  if (status === 'PROCESSING' || status === 'UPLOADED') return 'Memproses';
  return status;
}

type JobState = { name: string; step: string | null; progress: number };

export default function DataSourcesPage() {
  const sources = useApi<SourcesListResponse>('/api/sources');
  const meta = useApi<MetaResponse>('/api/meta');

  const [formatFilter, setFormatFilter] = useState('all');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SourceListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewDetail, setPreviewDetail] = useState<SourceDetailResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLimit, setPreviewLimit] = useState(5);

  const fileRef = useRef<HTMLInputElement>(null);

  const items = sources.data?.items ?? [];
  const counts = sources.data?.counts;
  const datasetItems = items.filter((s) => s.kind === 'dataset');
  const documentItems = items.filter((s) => s.kind === 'document');
  const totalBytes = items.reduce((sum, s) => sum + (s.sizeBytes ?? 0), 0);
  const totalRows = items.reduce((sum, s) => sum + (s.rowCount ?? 0), 0);
  const totalChunks = items.reduce((sum, s) => sum + (s.chunkCount ?? 0), 0);
  const totalTables = items.reduce((sum, s) => sum + (s.tableCount ?? 0), 0);
  const failedCount = counts?.failed ?? 0;

  const datasetFormats = [...new Set(datasetItems.map((s) => s.format.toLowerCase()))];
  const formatTabs = [
    { id: 'all', label: `Semua (${datasetItems.length})` },
    ...datasetFormats.map((format) => ({ id: format, label: `${formatLabel(format)} (${datasetItems.filter((s) => s.format.toLowerCase() === format).length})` })),
  ];
  const visibleDatasets = datasetItems.filter((s) => formatFilter === 'all' || s.format.toLowerCase() === formatFilter);

  const processingSource = items.find((s) => s.status === 'PROCESSING' || s.status === 'UPLOADED');
  useEffect(() => {
    if (!processingSource) { setJob(null); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sources/${processingSource.id}`);
        if (!res.ok) return;
        const json: SourceDetailResponse = await res.json();
        if (cancelled) return;
        const jobRow: IngestionJob | null = json.job ?? null;
        if (jobRow) setJob({ name: processingSource.name, step: jobRow.step, progress: jobRow.progress });
        if (json.source.status === 'READY' || json.source.status === 'FAILED') { setJob(null); sources.retry(); }
      } catch { /* polling dilanjutkan */ }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingSource?.id, processingSource?.name]);

  const loadPreview = useCallback(async (id: string, limit: number) => {
    setPreviewId(id); setPreviewLoading(true); setPreviewError(null); setPreviewLimit(limit);
    try {
      const [detailRes, previewRes] = await Promise.all([fetch(`/api/sources/${id}`), fetch(`/api/sources/${id}/preview?limit=${limit}`)]);
      if (!detailRes.ok || !previewRes.ok) {
        const body = await (detailRes.ok ? previewRes : detailRes).json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Pratinjau gagal dimuat.');
      }
      const [detailJson, previewJson] = (await Promise.all([detailRes.json(), previewRes.json()])) as [SourceDetailResponse, PreviewResponse];
      setPreviewDetail(detailJson); setPreview(previewJson);
    } catch (err) {
      setPreviewDetail(null); setPreview(null);
      setPreviewError(err instanceof Error ? err.message : 'Pratinjau gagal dimuat.');
    } finally { setPreviewLoading(false); }
  }, []);

  useEffect(() => {
    if (previewId || sources.loading || items.length === 0) return;
    const first = items.find((s) => s.kind === 'dataset') ?? items[0];
    void loadPreview(first.id, 5);
  }, [sources.loading, items, previewId, loadPreview]);

  const upload = useCallback(async (file: File) => {
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (![...DATASET_EXTS, ...DOCUMENT_EXTS].includes(ext)) { toast({ status: 'error', message: ERROR_MESSAGES.UNSUPPORTED_MEDIA_TYPE }); return; }
    if (file.size > MAX_BYTES) { toast({ status: 'error', message: ERROR_MESSAGES.FILE_TOO_LARGE }); return; }
    setUploading(true); setUploadName(file.name);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', DATASET_EXTS.includes(ext) ? 'dataset' : 'document');
      const res = await fetch('/api/sources', { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? body?.error?.message ?? 'Unggah gagal.');
      }
      toast({ status: 'success', message: 'File ditambahkan. Pemrosesan dimulai.' });
      sources.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Unggah gagal.' });
    } finally { setUploading(false); setUploadName(null); }
  }, [sources]);

  const onFiles = (files: FileList | null) => { if (files && files.length > 0) void upload(files[0]); };

  const reindex = async (source: SourceListItem) => {
    setOpenMenu(null);
    try {
      const res = await fetch(`/api/sources/${source.id}/reindex`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? 'Indeks ulang gagal.');
      }
      const json: ReindexResponse = body as ReindexResponse;
      toast({ status: 'success', message: `Indeks ulang dimulai (${json.job.step ?? 'memproses'}).` });
      sources.retry();
      if (previewId === source.id) void loadPreview(source.id, previewLimit);
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Indeks ulang gagal.' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sources/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(code === 'CONFLICT' ? ERROR_MESSAGES.CONFLICT : ERROR_MESSAGES[code]);
      }
      toast({ status: 'success', message: 'Sumber dihapus.' });
      if (previewId === deleteTarget.id) { setPreviewId(null); setPreviewDetail(null); setPreview(null); }
      setDeleteTarget(null); sources.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Penghapusan gagal.' });
    } finally { setDeleting(false); }
  };

  const previewName = previewDetail?.source.name ?? '—';
  const previewColumns = preview?.columns ?? [];
  const previewRows = preview?.rows ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Sumber Data"
        subtitle="Kelola dataset dan dokumen yang menjadi dasar setiap jawaban."
        meta="SQLITE · SQL + FTS5"
        actions={<Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}><Icon name="upload_file" className="text-[18px]" aria-hidden="true" /> Unggah file</Button>}
      />
      <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" aria-label="Pilih file untuk diunggah" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />

      {/* Ringkasan sumber. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total penyimpanan', value: sources.loading ? null : `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`, meta: `${num(counts?.dataset)} DATASET` },
          { label: 'Dokumen terindeks', value: sources.loading ? null : num(counts?.document), meta: `${num(totalChunks)} POTONGAN` },
          { label: 'Baris tersimpan', value: sources.loading ? null : num(totalRows), meta: `${num(totalTables)} TABEL` },
        ].map((card) => (
          <div key={card.label} className="flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5">
            <p className="font-body text-label-sm uppercase text-ink-muted-strong">{card.label}</p>
            <p className="mt-3 font-body text-metric-display tabular text-ink">{card.value ?? <Skeleton className="h-8 w-24" />}</p>
            <div className="mt-auto pt-3"><MonoMeta>{card.meta}</MonoMeta></div>
          </div>
        ))}
        <div className="flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5">
          <p className="font-body text-label-sm uppercase text-ink-muted-strong">Status pemrosesan</p>
          <div className="mt-3"><StatusDot state={failedCount > 0 ? 'error' : 'active'} label={failedCount > 0 ? `${failedCount} perlu diperiksa` : 'Semua siap'} /></div>
          <div className="mt-auto pt-3"><MonoMeta>SQLITE · FTS5</MonoMeta></div>
        </div>
      </div>

      {/* Zona unggah. */}
      <section className="rounded-card border border-border-hairline bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-body text-headline-sm text-ink">Unggah sumber</h2>
          <MonoMeta>MAKS 25 MB</MonoMeta>
        </div>
        <MeasurementRule className="mb-5" />
        <div
          role="button" tabIndex={0}
          aria-label="Letakkan file di sini atau pilih file untuk diunggah"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
          onClick={() => fileRef.current?.click()}
          className={`flex h-dropzone-mobile flex-col items-center justify-center rounded-control border border-dashed border-border-control bg-canvas text-center transition-colors hover:border-primary focus-ring sm:h-dropzone ${dragging ? 'border-primary' : ''}`}
        >
          <Icon name="cloud_upload" className="text-[28px] text-primary" aria-hidden="true" />
          <p className="mt-3 font-body text-body-md font-semibold text-ink">Letakkan file CSV, XLSX, PDF, DOCX, TXT, atau MD di sini</p>
          <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Skema dan potongan teks dibuat otomatis saat pengindeksan.</p>
        </div>
        {(uploading || job) && (
          <div className="mt-4 rounded-control border border-border-hairline bg-canvas p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-body text-body-md text-ink">{uploading ? uploadName : job?.name}</span>
              <MonoMeta>{uploading ? 'MENGUNGGAH' : `${job?.step ?? 'MEMPROSES'} · ${job?.progress ?? 0}%`}</MonoMeta>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-control bg-row-hover" role="progressbar" aria-valuenow={uploading ? undefined : job?.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary transition-[width] duration-[var(--motion-slow)]" style={{ width: uploading ? '33%' : `${job?.progress ?? 0}%` }} />
            </div>
          </div>
        )}
      </section>

      {/* Dataset terstruktur. */}
      <section className="overflow-hidden rounded-card border border-border-hairline bg-surface">
        <header className="measurement-rule px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="font-body text-headline-sm text-ink">Dataset terstruktur</h2>
            <FilterChips chips={formatTabs} value={formatFilter} onChange={setFormatFilter} label="Filter format dataset" />
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-canvas">
              <tr>{['Nama sumber', 'Format', 'Baris', 'Ukuran', 'Status', 'Aksi'].map((h, i) => <th key={h} className={`whitespace-nowrap px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong ${i === 2 || i === 3 ? 'text-right' : ''}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {sources.loading && <tr><td colSpan={6} className="px-4 py-4"><Skeleton className="h-8 w-full" /></td></tr>}
              {!sources.loading && sources.error && <tr><td colSpan={6} className="px-4 py-4 font-body text-body-md text-error-text">{sources.error}</td></tr>}
              {!sources.loading && !sources.error && visibleDatasets.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center font-body text-body-md text-ink-muted-strong">Belum ada dataset. Unggah file untuk menambah sumber.</td></tr>}
              {visibleDatasets.map((source) => (
                <tr key={source.id} className="border-t border-border-hairline hover:bg-row-hover">
                  <td className="px-4 py-3 font-body text-body-md text-ink">
                    <span className="inline-flex items-center gap-2"><Icon name={sourceIcon(source)} className="text-[18px] text-primary" aria-hidden="true" /><Link href={`/data-sources/${source.id}`} className="font-semibold hover:underline focus-ring">{source.name}</Link></span>
                  </td>
                  <td className="px-4 py-3"><MonoMeta>{formatLabel(source.format)}</MonoMeta></td>
                  <td className="px-4 py-3 text-right font-body text-body-md tabular text-ink">{num(source.rowCount)}</td>
                  <td className="px-4 py-3 text-right font-body text-body-sm tabular text-ink-muted-strong">{formatBytes(source.sizeBytes)}</td>
                  <td className="px-4 py-3"><StatusDot state={statusState(source.status)} label={statusLabel(source.status)} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => void loadPreview(source.id, 5)}>Pratinjau</Button>
                      <Button variant="ghost" size="sm" onClick={() => void reindex(source)}>Indeks ulang</Button>
                      {source.id !== 'seed' && <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(source)} aria-label={`Hapus ${source.name}`}><Icon name="delete" className="text-[16px]" aria-hidden="true" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border-hairline px-4 py-2"><MonoMeta>{visibleDatasets.length} DATASET</MonoMeta></div>
      </section>

      {/* Dokumen. */}
      <section className="overflow-hidden rounded-card border border-border-hairline bg-surface">
        <header className="measurement-rule px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="font-body text-headline-sm text-ink">Dokumen</h2>
            <MonoMeta>INDEKS · {meta.data?.capabilities.rag ?? 'FTS5'}</MonoMeta>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-canvas">
              <tr>{['Nama dokumen', 'Format', 'Ukuran', 'Potongan', 'Status', 'Aksi'].map((h, i) => <th key={h} className={`whitespace-nowrap px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong ${i === 2 || i === 3 ? 'text-right' : ''}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {sources.loading && <tr><td colSpan={6} className="px-4 py-4"><Skeleton className="h-8 w-full" /></td></tr>}
              {!sources.loading && !sources.error && documentItems.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center font-body text-body-md text-ink-muted-strong">Belum ada dokumen. Unggah PDF, DOCX, TXT, atau MD.</td></tr>}
              {documentItems.map((source) => (
                <tr key={source.id} className="border-t border-border-hairline hover:bg-row-hover">
                  <td className="px-4 py-3 font-body text-body-md text-ink">
                    <span className="inline-flex items-center gap-2"><Icon name={sourceIcon(source)} className="text-[18px] text-primary" aria-hidden="true" /><Link href={`/data-sources/${source.id}`} className="font-semibold hover:underline focus-ring">{source.name}</Link></span>
                  </td>
                  <td className="px-4 py-3"><MonoMeta>{formatLabel(source.format)}</MonoMeta></td>
                  <td className="px-4 py-3 text-right font-body text-body-sm tabular text-ink-muted-strong">{formatBytes(source.sizeBytes)}</td>
                  <td className="px-4 py-3 text-right font-body text-body-md tabular text-ink">{num(source.chunkCount)}</td>
                  <td className="px-4 py-3"><StatusDot state={statusState(source.status)} label={statusLabel(source.status)} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => void loadPreview(source.id, 5)}>Lihat</Button>
                      <Button variant="ghost" size="sm" onClick={() => void reindex(source)}>Indeks ulang</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border-hairline px-4 py-2"><MonoMeta>{documentItems.length} DOKUMEN</MonoMeta></div>
      </section>

      {/* Pratinjau sumber. */}
      {previewDetail && (
        <section className="overflow-hidden rounded-card border border-border-hairline bg-surface">
          <header className="measurement-rule px-5 pb-3 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-body text-headline-sm text-ink">{previewName}</h2>
                <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Pratinjau baris pertama dari sumber yang dipilih.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <MonoMeta>{num(preview?.rowCount)} BARIS</MonoMeta>
                <Button variant="ghost" size="sm" aria-label="Ekspor sampel CSV" onClick={() => {
                  const header = previewColumns.map((c) => c.label);
                  const rows = previewRows.map((row) => previewColumns.map((c) => String(row[c.key] ?? '')));
                  const csv = [header, ...rows].map((line) => line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
                  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
                  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `tanyadata-${previewId}-sampel.csv`; anchor.click(); URL.revokeObjectURL(url);
                }}><Icon name="download" className="text-[16px]" aria-hidden="true" /> Ekspor CSV</Button>
              </div>
            </div>
          </header>
          <div className="flex flex-wrap gap-2 border-b border-border-hairline px-5 py-3">
            {'schema' in previewDetail && previewDetail.schema
              ? previewDetail.schema.columns.map((column) => <MonoMeta key={column.name} className="!normal-case">{column.name} [{column.type}]</MonoMeta>)
              : 'sections' in previewDetail
                ? previewDetail.sections.slice(0, 8).map((section, i) => <MonoMeta key={i} className="!normal-case">{section.title}</MonoMeta>)
                : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-canvas">
                <tr><th className="px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong">#</th>{previewColumns.map((column) => <th key={column.key} className="px-4 py-3 font-mono text-body-sm text-ink-muted-strong">{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {previewLoading && <tr><td colSpan={previewColumns.length + 1} className="px-4 py-4"><Skeleton className="h-6 w-full" /></td></tr>}
                {!previewLoading && previewError && <tr><td colSpan={previewColumns.length + 1} className="px-4 py-4 font-body text-body-md text-error-text">{previewError}</td></tr>}
                {!previewLoading && !previewError && previewRows.length === 0 && <tr><td colSpan={previewColumns.length + 1} className="px-4 py-8 text-center font-body text-body-md text-ink-muted-strong">Tidak ada baris untuk ditampilkan.</td></tr>}
                {!previewLoading && previewRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-border-hairline hover:bg-row-hover">
                    <td className="px-4 py-3 font-body text-body-sm tabular text-ink-muted-strong">{rowIndex + 1}</td>
                    {previewColumns.map((column) => {
                      const value = row[column.key];
                      const isStatus = column.key.toLowerCase().includes('status');
                      const isAmount = column.key.toLowerCase().includes('amount') && typeof value === 'number';
                      return (
                        <td key={column.key} className="px-4 py-3 font-mono text-body-sm text-ink">
                          {isStatus ? <StatusDot state={String(value).toUpperCase() === 'FAILED' ? 'error' : 'active'} label={String(value ?? '—')} /> : value == null ? <span className="text-ink-muted-strong">null</span> : isAmount ? <span className="tabular">Rp {formatNumber(value as number)}</span> : <span className="tabular">{String(value)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-hairline px-5 py-3">
            <MonoMeta>MENAMPILKAN {previewRows.length} DARI {num(preview?.rowCount)} BARIS</MonoMeta>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={!preview?.truncated || previewLoading} onClick={() => void loadPreview(previewId!, 50)}>Muat 50 baris berikutnya</Button>
              <Link href="/assistant" className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary transition-colors hover:bg-[#0A3A2C] focus-ring-forest">Tanya data ini</Link>
            </div>
          </div>
        </section>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} title={deleteTarget ? `Hapus “${deleteTarget.name}”?` : 'Hapus sumber?'} description="Tindakan ini tidak dapat dibatalkan. Riwayat percakapan dan laporan tetap tersimpan.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setDeleteTarget(null)}>Batal</Button>
          <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>Hapus</Button>
        </div>
      </Dialog>
    </div>
  );
}
