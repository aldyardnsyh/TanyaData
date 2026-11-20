'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  ApiErrorCode,
  MetaResponse,
  PreviewResponse,
  SourceDetailResponse,
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
  UNPROCESSABLE_SOURCE: 'The file could not be processed.',
  INTERNAL_ERROR: 'An internal error occurred. Please try again.',
};

const num = (value: number | null | undefined) => (value == null ? 'n/a' : formatNumber(value));

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return 'n/a';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function DataSourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const meta = useApi<MetaResponse>('/api/meta');

  const [detail, setDetail] = useState<SourceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/sources/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      setDetail((await res.json()) as SourceDetailResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load source detail.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadPreview = useCallback(
    async (lim: number) => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await fetch(`/api/sources/${id}/preview?limit=${lim}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        setPreview((await res.json()) as PreviewResponse);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : 'Could not load preview.');
      } finally {
        setPreviewLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (detail) void loadPreview(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.source.id]);

  const reindex = async () => {
    try {
      const res = await fetch(`/api/sources/${id}/reindex`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? 'Reindex failed.');
      }
      toast({ status: 'success', message: 'Reindex started.' });
      await load();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Reindex failed.' });
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? 'Could not delete source.');
      }
      toast({
        status: 'success',
        message: 'Source deleted.',
        action: 'Back',
        onAction: () => { window.location.href = '/data-sources'; },
      });
      setDeleteOpen(false);
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Could not delete source.' });
    } finally {
      setDeleting(false);
    }
  };

  const isDocument = detail !== null && 'sections' in detail;
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
            <Link href="/data-sources" className="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold hover:underline">
              Data Hub
            </Link>
            <span className="text-outline text-label-sm">/</span>
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Source Detail</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-bold">
            {loading ? <Skeleton className="h-7 w-64" /> : (detail?.source.name ?? (notFound ? 'Source not found' : 'n/a'))}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Inspect schema, data quality, and indexed content for this source.
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <Link
            href="/data-sources"
            className="flex items-center gap-2 h-9 px-space-md rounded bg-surface-container-low text-on-surface hover:bg-surface-container transition-colors font-label-md text-label-md shadow-sm"
          >
            <Icon name="arrow_back" className="text-[18px] text-primary" />
            <span>Back to Data Sources</span>
          </Link>
          <button
            type="button"
            onClick={() => void reindex()}
            disabled={!detail || loading}
            className="flex items-center gap-2 h-9 px-space-md rounded bg-surface-container-low text-on-surface hover:bg-surface-container transition-colors font-label-md text-label-md shadow-sm disabled:opacity-50"
          >
            <Icon name="refresh" className="text-[18px] text-primary" />
            <span>Reindex</span>
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            disabled={!detail || id === 'seed'}
            title={id === 'seed' ? 'Seed dataset cannot be deleted.' : undefined}
            className="flex items-center gap-2 h-9 px-space-md rounded bg-primary text-on-primary hover:bg-primary-container transition-colors font-label-md text-label-md shadow-sm disabled:opacity-50"
          >
            <Icon name="delete" className="text-[18px]" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {notFound ? (
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-sm text-center">
          <Icon name="error" className="text-[26px] text-tertiary-container" />
          <p className="mt-2 font-body-md text-body-md text-on-surface">This source may have been removed.</p>
          <Link href="/data-sources" className="mt-3 inline-block px-space-md py-1.5 rounded bg-primary text-on-primary font-label-md text-label-md">
            Back to Data Sources
          </Link>
        </div>
      ) : loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm"><Skeleton className="h-16 w-full" /></div>
            ))}
          </div>
          <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm"><Skeleton className="h-64 w-full" /></div>
        </div>
      ) : error ? (
        <div className="bg-error-container p-space-md rounded-xl text-center">
          <p className="font-body-md text-body-md text-on-error-container">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 px-space-md py-1.5 rounded bg-surface-container-lowest text-on-surface font-label-md text-label-md">
            Retry
          </button>
        </div>
      ) : detail ? (
        <>
          {/* Telemetry Summary Metric Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Records Stored</span>
                <span className="p-1 rounded bg-surface-container text-outline"><Icon name="table_rows" className="text-[16px]" /></span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="font-metric-display text-metric-display text-on-surface tabular-nums">{num(detail.source.rowCount)}</span>
                <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-primary font-bold">
                  {formatLabel(detail.source.format)}
                </span>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">
                  {isDocument ? 'Indexed Chunks' : 'Columns'}
                </span>
                <span className="p-1 rounded bg-surface-container text-outline"><Icon name={isDocument ? 'text_snippet' : 'view_comfy_alt'} className="text-[16px]" /></span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="font-metric-display text-metric-display text-on-surface tabular-nums">
                  {num(isDocument ? detail.source.chunkCount : detail && 'schema' in detail ? detail.schema?.columns.length : null)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface-variant">
                  {isDocument
                    ? `${num(detail.source.pageCount)} pages`
                    : detail && 'schema' in detail ? detail.schema?.tableName ?? 'n/a' : 'n/a'}
                </span>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Storage Size</span>
                <span className="p-1 rounded bg-surface-container text-outline"><Icon name="database" className="text-[16px]" /></span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="font-metric-display text-metric-display text-on-surface tabular-nums">{formatBytes(detail.source.sizeBytes)}</span>
                <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface-variant">
                  {formatDateEn(detail.source.createdAt)}
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
                  <span className={`h-2 w-2 rounded-full ${detail.source.status === 'READY' ? 'bg-[#C5D94B]' : detail.source.status === 'FAILED' ? 'bg-tertiary' : 'bg-secondary animate-ping'}`} aria-hidden="true" />
                  <span className="font-label-md text-label-md text-on-surface font-semibold">{detail.source.status}</span>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-primary font-bold">
                  Engine v{meta.data?.app.version ?? 'n/a'}
                </span>
              </div>
            </div>
          </div>

          {/* Dataset Preview Drawer / Embedded Inspector */}
          <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col mb-8">
            <div className="p-space-md bg-surface-container flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="p-2 rounded bg-surface-container-lowest text-primary shadow-sm">
                  <Icon name="table_chart" className="text-[20px]" />
                </span>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-headline-sm text-headline-sm text-on-surface font-bold">{detail.source.name}</span>
                    {detail && 'schema' in detail && detail.active && (
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
                  <span className="font-label-md text-label-md text-on-surface font-bold tabular-nums">{num(preview?.rowCount)}</span>
                </div>
                {detail && 'schema' in detail && detail.quality && (
                  <>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm">
                      <Icon name="check_circle" className="text-[16px] text-[#C5D94B]" />
                      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Missing:</span>
                      <span className="font-label-md text-label-md text-on-surface font-bold tabular-nums">
                        {(() => {
                          const missing = Object.values(detail.quality?.missingByColumn ?? {}).reduce((a, b) => a + b, 0);
                          const parsed = detail.quality?.rowsParsed ?? 0;
                          return parsed > 0 ? `${((missing / parsed) * 100).toFixed(2)}%` : 'n/a';
                        })()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm">
                      <Icon name="verified" className="text-[16px] text-primary" />
                      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Duplicate Check:</span>
                      <span className="font-label-md text-label-md text-on-surface font-bold">{num(detail.quality.duplicateRows)} duplicates</span>
                    </div>
                  </>
                )}
                {detail && 'sections' in detail && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm">
                    <Icon name="verified" className="text-[16px] text-primary" />
                    <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Index:</span>
                    <span className="font-label-md text-label-md text-on-surface font-bold">
                      {detail.index.indexed ? detail.index.engine : 'Not indexed'}
                    </span>
                  </div>
                )}
              </div>
            </div>
            {/* Detected Schema Metadata Strip */}
            <div className="px-space-md py-2.5 bg-surface-container-low flex items-center gap-3 overflow-x-auto text-label-sm font-label-sm">
              <span className="text-outline uppercase tracking-wider font-bold shrink-0">
                {isDocument ? 'Sections:' : 'Inferred Types:'}
              </span>
              <div className="flex items-center gap-2">
              {detail && 'sections' in detail
                ? detail.sections.slice(0, 8).map((section, index) => (
                    <span key={index} className="px-2 py-0.5 rounded bg-surface-container-lowest shadow-sm text-on-surface font-mono">
                      {section.title} <span className="text-primary font-bold">[p.{section.page ?? '—'}]</span>
                    </span>
                  ))
                : detail && 'schema' in detail && detail.schema
                  ? detail.schema.columns.map((column) => (
                      <span key={column.name} className="px-2 py-0.5 rounded bg-surface-container-lowest shadow-sm text-on-surface font-mono">
                        {column.name} <span className={`font-bold ${column.nullable ? 'text-outline' : 'text-primary'}`}>
                          [{column.type}{column.nullable ? '-NULLABLE' : ''}]
                        </span>
                      </span>
                    ))
                  : <span className="text-outline">n/a</span>}
              </div>
            </div>
            {/* Rows Preview Grid */}
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
                              <span className="font-mono tabular-nums text-on-surface font-semibold">Rp {formatNumber(value as number)}</span>
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
                  onClick={() => void loadPreview(50)}
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

          {/* Schema & Quality (dataset) / Index metadata (document) */}
          {detail && 'schema' in detail && detail.quality && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
              <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md">
                <div className="flex items-center gap-2 mb-space-sm">
                  <Icon name="data_object" className="text-[20px] text-primary" />
                  <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">Detected Schema</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-body-sm text-body-sm border-collapse">
                    <thead>
                      <tr className="bg-surface-container-low font-label-sm text-label-sm text-outline uppercase tracking-wider">
                        <th className="py-2 px-space-sm">Column</th>
                        <th className="py-2 px-space-sm">Type</th>
                        <th className="py-2 px-space-sm text-right">Nullable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container">
                      {detail.schema?.columns.map((column) => (
                        <tr key={column.name} className="hover:bg-surface-container-low transition-colors">
                          <td className="py-2 px-space-sm font-mono text-on-surface">{column.name}</td>
                          <td className="py-2 px-space-sm font-mono text-primary">{column.type}</td>
                          <td className="py-2 px-space-sm text-right text-on-surface-variant">{column.nullable ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md">
                <div className="flex items-center gap-2 mb-space-sm">
                  <Icon name="verified" className="text-[20px] text-primary" />
                  <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">Data Quality</h2>
                </div>
                <dl className="divide-y divide-surface-container">
                  {[
                    ['Rows parsed', num(detail.quality.rowsParsed)],
                    ['Rows rejected', num(detail.quality.rowsRejected)],
                    ['Duplicate rows', num(detail.quality.duplicateRows)],
                    ['Date bounds', detail.bounds ? `${detail.bounds.minDate} – ${detail.bounds.maxDate}` : 'n/a'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-2 font-body-md text-body-md">
                      <dt className="text-on-surface-variant">{label}</dt>
                      <dd className="font-mono tabular-nums text-on-surface">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}
          {detail && 'sections' in detail && (
            <div className="bg-surface-container-lowest rounded-xl shadow-sm p-space-md">
              <div className="flex items-center gap-2 mb-space-sm">
                <Icon name="auto_stories" className="text-[20px] text-primary" />
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">Index Metadata</h2>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                {[
                  ['Indexed', detail.index.indexed ? 'Yes' : 'No'],
                  ['Engine', detail.index.indexed ? detail.index.engine : 'n/a'],
                  ['Indexed at', detail.index.indexedAt ? formatDateEn(detail.index.indexedAt) : 'n/a'],
                  ['Chunks', num(detail.source.chunkCount)],
                ].map(([label, value]) => (
                  <div key={label} className="p-space-xs rounded bg-surface-container-low flex items-center justify-between font-body-md text-body-md">
                    <dt className="text-on-surface-variant">{label}</dt>
                    <dd className="font-mono text-on-surface">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      ) : null}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => !open && setDeleteOpen(false)}
        title={detail ? `Delete “${detail.source.name}”?` : 'Delete source?'}
        description="This action cannot be undone. Chat history and reports remain saved."
      >
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => setDeleteOpen(false)}
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

function formatLabel(format: string): string {
  if (format === 'seed-dataset') return 'SEED';
  return format.toUpperCase();
}
