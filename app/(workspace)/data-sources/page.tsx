'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  ApiErrorCode,
  DatasetSourceDetail,
  DocumentSourceDetail,
  IngestionJob,
  MetaResponse,
  PreviewResponse,
  ReindexResponse,
  SourceDetailResponse,
  SourceListItem,
  SourcesListResponse,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatDateEn, formatNumber } from '@/lib/ui/format';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';

/** Material Symbols self-hosted; dekoratif → aria-hidden (blueprint §2). */
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className ?? ''}`} aria-hidden="true">
      {name}
    </span>
  );
}

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'The submitted data is invalid.',
  NOT_FOUND: 'Source not found.',
  METHOD_NOT_ALLOWED: 'Method not supported.',
  CONFLICT: 'This source cannot be changed in its current state.',
  FILE_TOO_LARGE: 'The file exceeds the 25 MB limit.',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported file format.',
  UNPROCESSABLE_SOURCE: 'The file could not be processed. Check its format or required columns.',
  INTERNAL_ERROR: 'An internal error occurred. Please try again.',
};

const ACCEPT = '.csv,.xlsx,.pdf,.docx,.txt,.md';
const DATASET_EXTS = ['.csv', '.xlsx'];
const DOCUMENT_EXTS = ['.pdf', '.docx', '.txt', '.md'];
const MAX_BYTES = 25 * 1024 * 1024;

const num = (value: number | null | undefined) => (value == null ? 'n/a' : formatNumber(value));

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return 'n/a';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatLabel(format: string): string {
  if (format === 'seed-dataset') return 'SEED';
  return format.toUpperCase();
}

function sourceIcon(source: SourceListItem): string {
  if (source.kind === 'document') {
    if (source.format === 'pdf') return 'picture_as_pdf';
    if (source.format === 'txt' || source.format === 'md') return 'text_snippet';
    return 'description';
  }
  if (source.format === 'xlsx') return 'view_comfy_alt';
  if (source.format === 'csv') return 'table_chart';
  return 'dns';
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
  const [expanded, setExpanded] = useState(false);

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
    { id: 'all', label: `All (${datasetItems.length})` },
    ...datasetFormats.map((format) => ({
      id: format,
      label: `${formatLabel(format)} (${datasetItems.filter((s) => s.format.toLowerCase() === format).length})`,
    })),
  ];
  const visibleDatasets = datasetItems.filter(
    (s) => formatFilter === 'all' || s.format.toLowerCase() === formatFilter,
  );

  // Polling sumber PROCESSING/UPLOADED tiap 1 s; progres nyata dari IngestionJob (blueprint §4.4).
  const processingSource = items.find((s) => s.status === 'PROCESSING' || s.status === 'UPLOADED');
  useEffect(() => {
    if (!processingSource) {
      setJob(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sources/${processingSource.id}`);
        if (!res.ok) return;
        const json: SourceDetailResponse = await res.json();
        if (cancelled) return;
        const jobRow: IngestionJob | null = json.job ?? null;
        if (jobRow) {
          setJob({ name: processingSource.name, step: jobRow.step, progress: jobRow.progress });
        }
        if (json.source.status === 'READY' || json.source.status === 'FAILED') {
          setJob(null);
          sources.retry();
        }
      } catch {
        /* polling dilanjutkan pada tick berikutnya */
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingSource?.id, processingSource?.name]);

  const loadPreview = useCallback(async (id: string, limit: number) => {
    setPreviewId(id);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewLimit(limit);
    try {
      const [detailRes, previewRes] = await Promise.all([
        fetch(`/api/sources/${id}`),
        fetch(`/api/sources/${id}/preview?limit=${limit}`),
      ]);
      if (!detailRes.ok || !previewRes.ok) {
        const body = await (detailRes.ok ? previewRes : detailRes).json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Could not load preview.');
      }
      const [detailJson, previewJson] = (await Promise.all([
        detailRes.json(),
        previewRes.json(),
      ])) as [SourceDetailResponse, PreviewResponse];
      setPreviewDetail(detailJson);
      setPreview(previewJson);
    } catch (err) {
      setPreviewDetail(null);
      setPreview(null);
      setPreviewError(err instanceof Error ? err.message : 'Could not load preview.');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Tampilkan inspector seperti Stitch: pilih dataset pertama setelah daftar siap.
  useEffect(() => {
    if (previewId || sources.loading || items.length === 0) return;
    const first = items.find((s) => s.kind === 'dataset') ?? items[0];
    void loadPreview(first.id, 5);
  }, [sources.loading, items, previewId, loadPreview]);

  const upload = useCallback(
    async (file: File) => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
      if (![...DATASET_EXTS, ...DOCUMENT_EXTS].includes(ext)) {
        toast({ status: 'error', message: ERROR_MESSAGES.UNSUPPORTED_MEDIA_TYPE });
        return;
      }
      if (file.size > MAX_BYTES) {
        toast({ status: 'error', message: ERROR_MESSAGES.FILE_TOO_LARGE });
        return;
      }
      setUploading(true);
      setUploadName(file.name);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('kind', DATASET_EXTS.includes(ext) ? 'dataset' : 'document');
        const res = await fetch('/api/sources', { method: 'POST', body: form });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
          throw new Error(ERROR_MESSAGES[code] ?? body?.error?.message ?? 'Upload failed.');
        }
        toast({ status: 'success', message: 'File added. Processing started.' });
        sources.retry();
      } catch (err) {
        toast({ status: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
      } finally {
        setUploading(false);
        setUploadName(null);
      }
    },
    [sources],
  );

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    void upload(files[0]);
  };

  const reindex = async (source: SourceListItem) => {
    setOpenMenu(null);
    try {
      const res = await fetch(`/api/sources/${source.id}/reindex`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? 'Reindex failed.');
      }
      const json: ReindexResponse = body as ReindexResponse;
      toast({ status: 'success', message: `Reindex started (${json.job.step ?? 'processing'}).` });
      sources.retry();
      if (previewId === source.id) void loadPreview(source.id, previewLimit);
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Reindex failed.' });
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
      toast({ status: 'success', message: 'Source deleted.' });
      if (previewId === deleteTarget.id) {
        setPreviewId(null);
        setPreviewDetail(null);
        setPreview(null);
      }
      setDeleteTarget(null);
      sources.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Could not delete source.' });
    } finally {
      setDeleting(false);
    }
  };

  const statusBadge = (source: SourceListItem) => {
    if (source.status === 'READY') {
      return (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm text-on-surface">
          <span className="h-2 w-2 rounded-full bg-[#C5D94B]" aria-hidden="true" />
          <span>Ready</span>
        </div>
      );
    }
    if (source.status === 'FAILED') {
      return (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-error-container text-on-error-container font-label-sm text-label-sm font-bold">
          <Icon name="error" className="text-[14px]" />
          <span>Failed</span>
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-bold">
        <span className="h-2 w-2 rounded-full bg-[#C5D94B] animate-ping" aria-hidden="true" />
        <span>Processing</span>
      </div>
    );
  };

  const rowMenu = (source: SourceListItem) => (
    <div className="relative">
      <button
        type="button"
        aria-label={`More actions for ${source.name}`}
        aria-expanded={openMenu === source.id}
        onClick={() => setOpenMenu(openMenu === source.id ? null : source.id)}
        className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Icon name="more_vert" className="text-[16px]" />
      </button>
      {openMenu === source.id && (
        <div className="absolute right-0 top-full z-dropdown mt-1 min-w-[150px] rounded-lg border border-outline-variant bg-surface-container-lowest p-1 shadow-lg text-left">
          <button
            type="button"
            onClick={() => { setOpenMenu(null); void loadPreview(source.id, 5); }}
            className="block w-full rounded px-space-sm py-1.5 text-left font-label-md text-label-md text-on-surface hover:bg-surface-container transition-colors"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => void reindex(source)}
            className="block w-full rounded px-space-sm py-1.5 text-left font-label-md text-label-md text-on-surface hover:bg-surface-container transition-colors"
          >
            Reindex
          </button>
          {source.id !== 'seed' && (
            <button
              type="button"
              onClick={() => { setOpenMenu(null); setDeleteTarget(source); }}
              className="block w-full rounded px-space-sm py-1.5 text-left font-label-md text-label-md text-on-error-container hover:bg-error-container transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );

  const previewName = previewDetail?.source.name ?? 'n/a';
  const previewColumns = preview?.columns ?? [];
  const previewRows = preview?.rows ?? [];

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] w-full mx-auto">
      {/* Top Breadcrumb & Page Command Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-container-lowest p-space-lg rounded-xl shadow-sm">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Workspace Engine</span>
            <span className="text-outline text-label-sm">/</span>
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold">Data Hub</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-bold">Data Sources</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Manage the datasets and documents connected to your workspace.
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          {/* Connect SQL Database dihapus: tidak ada endpoint (blueprint §4.4). */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 h-9 px-space-md rounded bg-primary text-on-primary hover:bg-primary-container transition-colors font-label-md text-label-md shadow-sm"
          >
            <Icon name="upload_file" className="text-[18px]" />
            <span>Upload File</span>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          aria-label="Choose a file to upload"
          onChange={(event) => {
            onFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {/* Telemetry Summary Metric Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Total Synced Volume</span>
            <span className="p-1 rounded bg-surface-container text-outline"><Icon name="database" className="text-[16px]" /></span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-metric-display text-metric-display text-on-surface tabular-nums">
              {sources.loading ? <Skeleton className="h-7 w-24" /> : (totalBytes / (1024 * 1024)).toFixed(1)}{' '}
              <span className="font-body-sm text-body-sm text-outline font-normal">MB</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-primary font-bold">
              {num(counts?.dataset)} datasets
            </span>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Indexed Documents</span>
            <span className="p-1 rounded bg-surface-container text-outline"><Icon name="folder_copy" className="text-[16px]" /></span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-metric-display text-metric-display text-on-surface tabular-nums">
              {sources.loading ? <Skeleton className="h-7 w-10" /> : num(counts?.document)}{' '}
              <span className="font-body-sm text-body-sm text-outline font-normal">items</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-primary font-bold">
              {num(totalChunks)} chunks
            </span>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Records Stored</span>
            <span className="p-1 rounded bg-surface-container text-outline"><Icon name="table_rows" className="text-[16px]" /></span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-metric-display text-metric-display text-on-surface tabular-nums">
              {sources.loading ? <Skeleton className="h-7 w-28" /> : num(totalRows)}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface-variant">
              {num(totalTables)} tables
            </span>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Ingestion Pipeline</span>
            <span className="p-1 rounded bg-surface-container text-outline"><Icon name="chevron_forward" className="text-[16px]" /></span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#C5D94B]" aria-hidden="true" />
              <span className="font-label-md text-label-md text-on-surface font-semibold">Active Engine</span>
            </div>
            {failedCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded bg-error-container font-label-sm text-label-sm text-on-error-container font-bold">
                {num(failedCount)} attention
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-primary font-bold">
                All clear
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Upload & Ingestion Zone */}
      <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="cloud_upload" className="text-[20px] text-primary" />
            <h2 className="font-headline-sm text-headline-sm text-on-surface">Data Ingestion Gateway</h2>
          </div>
          <span className="font-label-sm text-label-sm text-outline">
            Engine v{meta.data?.app.version ?? 'n/a'}
          </span>
        </div>
        {/* Drag & Drop Container */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop files here or choose a file to upload"
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            onFiles(event.dataTransfer.files);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              fileRef.current?.click();
            }
          }}
          onClick={() => fileRef.current?.click()}
          className={`p-8 rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors flex flex-col items-center justify-center text-center cursor-pointer group focus-ring ${
            dragging ? 'ring-2 ring-primary' : ''
          }`}
        >
          <div className="h-12 w-12 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary group-hover:scale-105 transition-transform shadow-sm">
            <Icon name="cloud_download" className="text-[26px]" />
          </div>
          <span className="mt-3 font-headline-sm text-headline-sm text-on-surface">
            Drag and drop structured files or operational documents here
          </span>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            Automatic schema inference, chunking, and type normalization
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
            {['CSV', 'XLSX', 'PDF', 'DOCX', 'TXT', 'MD'].map((format) => (
              <span key={format} className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface font-bold">
                {format}
              </span>
            ))}
            {/* SQL dihapus: bukan format unggah yang didukung API (§8.2). */}
            <span className="text-outline font-label-sm text-label-sm ml-2">Max file size: 25MB</span>
          </div>
        </div>
        {/* Active Ingestion Card / Upload Progress */}
        {(uploading || job) && (
          <div className="bg-surface-container-low p-space-md rounded-lg flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span className="p-2 rounded bg-surface-container-lowest text-primary shadow-sm">
                  <Icon name="table_view" className="text-[18px]" />
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="font-label-md text-label-md text-on-surface font-semibold truncate">
                    {uploading ? uploadName : job?.name}
                  </span>
                  <span className="font-body-sm text-body-sm text-outline">
                    {uploading ? 'Uploading file…' : `${job?.step ?? 'Processing'} • ${job?.progress ?? 0}%`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-primary font-bold tabular-nums">
                  {uploading ? '…' : `${job?.progress ?? 0}%`}
                </span>
                {/* Cancel dihapus: tidak ada endpoint pembatalan job. */}
              </div>
            </div>
            <div
              className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuetext={uploading ? 'Uploading file' : `Processing ${job?.progress ?? 0}%`}
            >
              <div
                className={`bg-primary h-full rounded-full transition-all duration-300 ${uploading ? 'w-1/3 animate-indeterminate' : ''}`}
                style={uploading ? undefined : { width: `${job?.progress ?? 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Category 1: Structured Data Sources Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="p-space-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container-low">
          <div className="flex items-center gap-2">
            <Icon name="dataset" className="text-[20px] text-primary" />
            <h2 className="font-headline-sm text-headline-sm text-on-surface">Structured Data Sources</h2>
          </div>
          {/* Filter tabs */}
          <div className="flex items-center rounded-lg bg-surface-container-highest p-0.5 font-label-md text-label-md">
            {formatTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={formatFilter === tab.id}
                onClick={() => setFormatFilter(tab.id)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  formatFilter === tab.id
                    ? 'bg-surface-container-lowest text-on-surface font-bold shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-body-md text-body-md border-collapse">
            <thead>
              <tr className="bg-surface-container-low font-label-sm text-label-sm text-outline uppercase tracking-wider">
                <th className="py-2.5 px-space-md">Source Name</th>
                <th className="py-2.5 px-space-md">Type</th>
                <th className="py-2.5 px-space-md text-right">Rows / Records</th>
                <th className="py-2.5 px-space-md text-right">Storage Size</th>
                <th className="py-2.5 px-space-md">Last Updated</th>
                <th className="py-2.5 px-space-md">Processing Status</th>
                <th className="py-2.5 px-space-md text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {sources.loading && (
                <tr><td colSpan={7} className="py-4 px-space-md"><Skeleton className="h-8 w-full" /></td></tr>
              )}
              {!sources.loading && sources.error && (
                <tr><td colSpan={7} className="py-4 px-space-md text-body-md text-on-error-container">{sources.error}</td></tr>
              )}
              {!sources.loading && !sources.error && visibleDatasets.length === 0 && (
                <tr><td colSpan={7} className="py-4 px-space-md text-body-md text-on-surface-variant">No structured sources available.</td></tr>
              )}
              {visibleDatasets.map((source) => (
                <tr
                  key={source.id}
                  className={`hover:bg-surface-container-low transition-colors group ${
                    source.status === 'FAILED' ? 'bg-error-container/10' : ''
                  }`}
                >
                  <td className="py-3 px-space-md">
                    <div className="flex items-center gap-2">
                      <Icon name={sourceIcon(source)} className={`text-[18px] ${source.status === 'FAILED' ? 'text-tertiary-container' : 'text-primary'}`} />
                      <Link
                        href={`/data-sources/${source.id}`}
                        className="font-label-md text-label-md font-semibold text-on-surface hover:underline focus-ring"
                      >
                        {source.name}
                      </Link>
                    </div>
                  </td>
                  <td className="py-3 px-space-md">
                    <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm font-semibold text-on-surface-variant">
                      {formatLabel(source.format)}
                    </span>
                  </td>
                  <td className="py-3 px-space-md text-right tabular-nums font-label-md text-label-md text-on-surface">
                    {num(source.rowCount)} rows
                  </td>
                  <td className="py-3 px-space-md text-right tabular-nums text-outline font-body-sm text-body-sm">
                    {formatBytes(source.sizeBytes)}
                  </td>
                  <td className="py-3 px-space-md text-outline font-body-sm text-body-sm">
                    {formatDateEn(source.updatedAt ?? source.createdAt)}
                  </td>
                  <td className="py-3 px-space-md">{statusBadge(source)}</td>
                  <td className="py-3 px-space-md text-right">
                    <div className="inline-flex items-center gap-1">
                      {source.status === 'FAILED' ? (
                        <button
                          type="button"
                          onClick={() => void reindex(source)}
                          className="px-2 py-1 rounded bg-error-container text-on-error-container hover:bg-error hover:text-on-error font-label-sm text-label-sm font-bold transition-colors"
                        >
                          Reindex
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void loadPreview(source.id, 5)}
                            className="px-2 py-1 rounded bg-surface-container hover:bg-primary hover:text-on-primary font-label-sm text-label-sm transition-colors text-on-surface"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => void reindex(source)}
                            className="px-2 py-1 rounded bg-surface-container hover:bg-primary hover:text-on-primary font-label-sm text-label-sm transition-colors text-on-surface"
                          >
                            Sync
                          </button>
                        </>
                      )}
                      {rowMenu(source)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Category 2: Unstructured Document Intelligence Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="p-space-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container-low">
          <div className="flex items-center gap-2">
            <Icon name="auto_stories" className="text-[20px] text-primary" />
            <div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface">Unstructured Document Intelligence</h2>
              <p className="font-body-sm text-body-sm text-outline">
                Indexed document evidence for grounded answers
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-label-sm text-label-sm text-outline">
              Index: {meta.data?.capabilities.rag ?? 'n/a'}
            </span>
            {/* Batch Re-embed dihapus: tidak ada endpoint batch (hanya reindex per sumber). */}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-body-md text-body-md border-collapse">
            <thead>
              <tr className="bg-surface-container-low font-label-sm text-label-sm text-outline uppercase tracking-wider">
                <th className="py-2.5 px-space-md">Document Name</th>
                <th className="py-2.5 px-space-md">Format</th>
                <th className="py-2.5 px-space-md text-right">File Size</th>
                <th className="py-2.5 px-space-md">Indexed Date</th>
                <th className="py-2.5 px-space-md">Chunks / Embeddings</th>
                <th className="py-2.5 px-space-md">Processing Status</th>
                <th className="py-2.5 px-space-md text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {sources.loading && (
                <tr><td colSpan={7} className="py-4 px-space-md"><Skeleton className="h-8 w-full" /></td></tr>
              )}
              {!sources.loading && !sources.error && documentItems.length === 0 && (
                <tr><td colSpan={7} className="py-4 px-space-md text-body-md text-on-surface-variant">No documents available.</td></tr>
              )}
              {documentItems.map((source) => {
                const processing = source.status === 'PROCESSING' || source.status === 'UPLOADED';
                return (
                  <tr
                    key={source.id}
                    className={`hover:bg-surface-container-low transition-colors group ${
                      source.status === 'FAILED' ? 'bg-error-container/10' : processing ? 'bg-secondary-container/10' : ''
                    }`}
                  >
                    <td className="py-3 px-space-md">
                      <div className="flex items-center gap-2">
                        <Icon name={sourceIcon(source)} className={`text-[18px] ${source.status === 'FAILED' ? 'text-tertiary-container' : processing ? 'text-secondary' : 'text-primary'}`} />
                        <Link
                          href={`/data-sources/${source.id}`}
                          className="font-label-md text-label-md font-semibold text-on-surface hover:underline focus-ring"
                        >
                          {source.name}
                        </Link>
                      </div>
                    </td>
                    <td className="py-3 px-space-md">
                      <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm font-semibold text-on-surface-variant">
                        {formatLabel(source.format)}
                      </span>
                    </td>
                    <td className="py-3 px-space-md text-right tabular-nums text-outline font-body-sm text-body-sm">
                      {formatBytes(source.sizeBytes)}
                    </td>
                    <td className="py-3 px-space-md text-outline font-body-sm text-body-sm">
                      {formatDateEn(source.updatedAt ?? source.createdAt)}
                    </td>
                    <td className="py-3 px-space-md">
                      {processing ? (
                        <div className="flex items-center gap-2">
                          <span className="font-label-sm text-label-sm text-on-surface">
                            {job?.name === source.name ? `${job.step ?? 'Processing'} ${job.progress}%` : 'Processing'}
                          </span>
                          <div className="w-16 bg-surface-container-highest h-1 rounded-full overflow-hidden">
                            <div
                              className="bg-secondary h-full rounded-full"
                              style={{ width: `${job?.name === source.name ? job.progress : 0}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="font-label-sm text-label-sm px-2 py-0.5 rounded bg-surface-container-high text-on-surface">
                          {num(source.chunkCount)} chunks
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-space-md">{statusBadge(source)}</td>
                    <td className="py-3 px-space-md text-right">
                      <div className="inline-flex items-center gap-1">
                        {source.status === 'FAILED' ? (
                          <button
                            type="button"
                            onClick={() => void reindex(source)}
                            className="px-2 py-1 rounded bg-error-container text-on-error-container hover:bg-error hover:text-on-error font-label-sm text-label-sm font-bold transition-colors"
                          >
                            Reindex
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void loadPreview(source.id, 5)}
                              className="px-2 py-1 rounded bg-surface-container hover:bg-primary hover:text-on-primary font-label-sm text-label-sm transition-colors text-on-surface"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => void reindex(source)}
                              className="px-2 py-1 rounded bg-surface-container hover:bg-primary hover:text-on-primary font-label-sm text-label-sm transition-colors text-on-surface"
                            >
                              Re-index
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dataset Preview Drawer / Embedded Inspector */}
      {previewDetail && (
        <div
          className={`bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col mb-8 ${
            expanded ? 'fixed inset-4 z-drawer overflow-auto shadow-xl' : ''
          }`}
        >
          <div className="p-space-md bg-surface-container flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded bg-surface-container-lowest text-primary shadow-sm">
                <Icon name="table_chart" className="text-[20px]" />
              </span>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-headline-sm text-headline-sm text-on-surface font-bold">{previewName}</span>
                  {previewDetail && 'schema' in previewDetail && previewDetail.active && (
                    <span className="px-2 py-0.5 rounded bg-primary text-on-primary font-label-sm text-label-sm uppercase font-bold tracking-wider">
                      Active Ingested View
                    </span>
                  )}
                </div>
                <span className="font-body-sm text-body-sm text-outline">
                  Schema verified by TanyaData Engine v{meta.data?.app.version ?? 'n/a'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm">
                <Icon name="storage" className="text-[16px] text-outline" />
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Records:</span>
                <span className="font-label-md text-label-md text-on-surface font-bold tabular-nums">
                  {num(preview?.rowCount)}
                </span>
              </div>
              {previewDetail && 'schema' in previewDetail && previewDetail.quality && (
                <>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm">
                    <Icon name="check_circle" className="text-[16px] text-[#C5D94B]" />
                    <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Missing:</span>
                    <span className="font-label-md text-label-md text-on-surface font-bold tabular-nums">
                      {(() => {
                        const missing = Object.values(previewDetail.quality?.missingByColumn ?? {}).reduce((a, b) => a + b, 0);
                        const parsed = previewDetail.quality?.rowsParsed ?? 0;
                        return parsed > 0 ? `${((missing / parsed) * 100).toFixed(2)}%` : 'n/a';
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm">
                    <Icon name="verified" className="text-[16px] text-primary" />
                    <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Duplicate Check:</span>
                    <span className="font-label-md text-label-md text-on-surface font-bold">
                      {num(previewDetail.quality.duplicateRows)} duplicates
                    </span>
                  </div>
                </>
              )}
              {previewDetail && 'sections' in previewDetail && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm">
                  <Icon name="verified" className="text-[16px] text-primary" />
                  <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Index:</span>
                  <span className="font-label-md text-label-md text-on-surface font-bold">
                    {previewDetail.index.indexed ? previewDetail.index.engine : 'Not indexed'}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Export CSV Sample"
                  aria-label="Export CSV sample"
                  onClick={() => {
                    const header = previewColumns.map((c) => c.label);
                    const rows = previewRows.map((row) => previewColumns.map((c) => String(row[c.key] ?? '')));
                    const csv = [header, ...rows]
                      .map((line) => line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
                      .join('\n');
                    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `tanyadata-${previewId}-sample.csv`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="p-1.5 rounded bg-surface-container-lowest hover:bg-surface-container-high transition-colors text-outline shadow-sm"
                >
                  <Icon name="download" className="text-[18px]" />
                </button>
                <button
                  type="button"
                  title={expanded ? 'Exit fullscreen' : 'Fullscreen Drawer'}
                  aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen drawer'}
                  onClick={() => setExpanded((value) => !value)}
                  className="p-1.5 rounded bg-surface-container-lowest hover:bg-surface-container-high transition-colors text-outline shadow-sm"
                >
                  <Icon name={expanded ? 'close' : 'open_in_full'} className="text-[18px]" />
                </button>
              </div>
            </div>
          </div>
          {/* Detected Schema Metadata Strip */}
          <div className="px-space-md py-2.5 bg-surface-container-low flex items-center gap-3 overflow-x-auto text-label-sm font-label-sm">
            <span className="text-outline uppercase tracking-wider font-bold shrink-0">
              {previewDetail && 'sections' in previewDetail ? 'Sections:' : 'Inferred Types:'}
            </span>
            <div className="flex items-center gap-2">
              {previewDetail && 'sections' in previewDetail
                ? previewDetail.sections.slice(0, 8).map((section, index) => (
                    <span key={index} className="px-2 py-0.5 rounded bg-surface-container-lowest shadow-sm text-on-surface font-mono">
                      {section.title} <span className="text-primary font-bold">[p.{section.page ?? '—'}]</span>
                    </span>
                  ))
                : previewDetail && 'schema' in previewDetail && previewDetail.schema
                  ? previewDetail.schema.columns.map((column) => (
                      <span key={column.name} className="px-2 py-0.5 rounded bg-surface-container-lowest shadow-sm text-on-surface font-mono">
                        {column.name} <span className={`font-bold ${column.nullable ? 'text-outline' : 'text-primary'}`}>
                          [{column.type}{column.nullable ? '-NULLABLE' : ''}]
                        </span>
                      </span>
                    ))
                  : <span className="text-outline">n/a</span>}
            </div>
          </div>
          {/* First Rows Preview Grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-left font-body-sm text-body-sm border-collapse">
              <thead>
                <tr className="bg-surface-container-low font-label-sm text-label-sm text-outline uppercase tracking-wider">
                  <th className="py-2.5 px-space-md w-12 text-center">#</th>
                  {previewColumns.map((column) => (
                    <th key={column.key} className="py-2.5 px-space-md font-mono">{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {previewLoading && (
                  <tr><td colSpan={previewColumns.length + 1} className="py-4 px-space-md"><Skeleton className="h-6 w-full" /></td></tr>
                )}
                {!previewLoading && previewError && (
                  <tr><td colSpan={previewColumns.length + 1} className="py-4 px-space-md text-on-error-container">{previewError}</td></tr>
                )}
                {!previewLoading && !previewError && previewRows.length === 0 && (
                  <tr><td colSpan={previewColumns.length + 1} className="py-4 px-space-md text-on-surface-variant">No rows to display.</td></tr>
                )}
                {!previewLoading && previewRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-surface-container-low transition-colors">
                    <td className="py-2 px-space-md text-center text-outline tabular-nums">{rowIndex + 1}</td>
                    {previewColumns.map((column) => {
                      const value = row[column.key];
                      const isStatus = column.key.toLowerCase().includes('status');
                      const isAmount = column.key.toLowerCase().includes('amount') && typeof value === 'number';
                      return (
                        <td key={column.key} className="py-2 px-space-md font-mono text-on-surface">
                          {isStatus ? (
                            <span className={`px-2 py-0.5 rounded-full font-bold font-label-sm text-label-sm ${
                              String(value).toUpperCase() === 'FAILED'
                                ? 'bg-error-container text-on-error-container'
                                : 'bg-surface-container text-primary'
                            }`}>
                              {value ?? 'null'}
                            </span>
                          ) : value === null || value === undefined ? (
                            <span className="text-outline italic">null</span>
                          ) : isAmount ? (
                            <span className="text-right font-mono tabular-nums text-on-surface font-semibold">
                              Rp {formatNumber(value as number)}
                            </span>
                          ) : (
                            <span className="tabular-nums">{String(value)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Drawer Footer Action Bar */}
          <div className="p-space-sm px-space-md bg-surface-container-low flex flex-col sm:flex-row items-center justify-between gap-3 text-body-sm font-body-sm">
            <span className="text-outline">
              Showing first {previewRows.length} rows of {num(preview?.rowCount)} records
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!preview?.truncated || previewLoading}
                onClick={() => void loadPreview(previewId!, 50)}
                className="px-3 py-1 rounded bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-sm text-label-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
              >
                Load Next 50 Rows
              </button>
              <Link
                href="/assistant"
                className="px-3 py-1 rounded bg-primary text-on-primary hover:bg-primary-container font-label-sm text-label-sm font-semibold transition-colors shadow-sm"
              >
                Create Metric Model
              </Link>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete “${deleteTarget.name}”?` : 'Delete source?'}
        description="This action cannot be undone. Chat history and reports remain saved."
      >
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => setDeleteTarget(null)}
            className="h-9 px-space-md rounded bg-surface-container text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void confirmDelete()}
            className="h-9 px-space-md rounded bg-error text-on-error font-label-md text-label-md hover:bg-error-container hover:text-on-error-container transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
