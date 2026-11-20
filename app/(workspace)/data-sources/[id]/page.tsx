'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ApiErrorCode, MetaResponse, PreviewResponse, SourceDetailResponse } from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';
import { StatusDot, type DotState } from '@/components/ui/status-dot';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toaster';

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Data yang dikirim tidak valid.',
  NOT_FOUND: 'Sumber tidak ditemukan.',
  METHOD_NOT_ALLOWED: 'Metode tidak didukung.',
  CONFLICT: 'Sumber tidak dapat diubah pada kondisi saat ini.',
  FILE_TOO_LARGE: 'Ukuran file melebihi batas 25 MB.',
  UNSUPPORTED_MEDIA_TYPE: 'Format file tidak didukung.',
  UNPROCESSABLE_SOURCE: 'File tidak dapat diproses.',
  INTERNAL_ERROR: 'Terjadi kesalahan internal. Silakan coba lagi.',
};
const num = (value: number | null | undefined) => (value == null ? '—' : formatNumber(value));
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
function formatLabel(format: string): string { return format === 'seed-dataset' ? 'SEED' : format.toUpperCase(); }
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
    setLoading(true); setError(null); setNotFound(false);
    try {
      const res = await fetch(`/api/sources/${id}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      setDetail((await res.json()) as SourceDetailResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detail sumber gagal dimuat.');
    } finally { setLoading(false); }
  }, [id]);

  const loadPreview = useCallback(async (lim: number) => {
    setPreviewLoading(true); setPreviewError(null);
    try {
      const res = await fetch(`/api/sources/${id}/preview?limit=${lim}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      setPreview((await res.json()) as PreviewResponse);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Pratinjau gagal dimuat.');
    } finally { setPreviewLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (detail) void loadPreview(limit); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [detail?.source.id]);

  const reindex = async () => {
    try {
      const res = await fetch(`/api/sources/${id}/reindex`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? 'Indeks ulang gagal.');
      }
      toast({ status: 'success', message: 'Indeks ulang dimulai.' });
      await load();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Indeks ulang gagal.' });
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? 'Penghapusan gagal.');
      }
      toast({ status: 'success', message: 'Sumber dihapus.', action: 'Kembali', onAction: () => { window.location.href = '/data-sources'; } });
      setDeleteOpen(false);
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Penghapusan gagal.' });
    } finally { setDeleting(false); }
  };

  const isDocument = detail !== null && 'sections' in detail;
  const previewColumns = preview?.columns ?? [];
  const previewRows = preview?.rows ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={loading ? 'Memuat…' : detail?.source.name ?? (notFound ? 'Sumber tidak ditemukan' : '—')}
        subtitle="Periksa skema, kualitas data, dan konten terindeks dari sumber ini."
        meta={detail ? `${formatLabel(detail.source.format)} · ${detail.source.status}` : undefined}
        actions={
          <>
            <Link href="/data-sources" className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-control bg-surface px-3 font-body text-label-md font-semibold text-ink transition-colors hover:border-primary focus-ring">
              <Icon name="arrow_back" className="text-[16px]" aria-hidden="true" /> Kembali
            </Link>
            <Button variant="secondary" size="sm" onClick={() => void reindex()} disabled={!detail || loading}>Indeks ulang</Button>
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)} disabled={!detail || id === 'seed'} title={id === 'seed' ? 'Dataset seed tidak dapat dihapus.' : undefined}>Hapus</Button>
          </>
        }
      />

      {notFound ? (
        <EmptyState title="Sumber tidak ditemukan" description="Sumber ini mungkin sudah dihapus." action={<Link href="/data-sources" className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary focus-ring-forest">Kembali ke Sumber Data</Link>} />
      ) : loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="rounded-card border border-border-hairline bg-surface p-5"><Skeleton className="h-16 w-full" /></div>)}</div>
          <div className="rounded-card border border-border-hairline bg-surface p-5"><Skeleton className="h-64 w-full" /></div>
        </div>
      ) : error ? (
        <div className="rounded-card border border-signal-terracotta bg-surface p-4">
          <p className="font-body text-body-md text-error-text">{error}</p>
          <Button size="sm" onClick={() => void load()} className="mt-2">Coba lagi</Button>
        </div>
      ) : detail ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Baris tersimpan', value: num(detail.source.rowCount), meta: formatLabel(detail.source.format) },
              { label: isDocument ? 'Potongan terindeks' : 'Kolom', value: num(isDocument ? detail.source.chunkCount : 'schema' in detail ? detail.schema?.columns.length : null), meta: isDocument ? `${num(detail.source.pageCount)} HALAMAN` : 'schema' in detail ? detail.schema?.tableName ?? '—' : '—' },
              { label: 'Ukuran penyimpanan', value: formatBytes(detail.source.sizeBytes), meta: 'SUMBER' },
            ].map((card) => (
              <div key={card.label} className="flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5">
                <p className="font-body text-label-sm uppercase text-ink-muted-strong">{card.label}</p>
                <p className="mt-3 font-body text-metric-display tabular text-ink">{card.value}</p>
                <div className="mt-auto pt-3"><MonoMeta>{card.meta}</MonoMeta></div>
              </div>
            ))}
            <div className="flex min-h-40 flex-col rounded-card border border-border-hairline bg-surface p-5">
              <p className="font-body text-label-sm uppercase text-ink-muted-strong">Status</p>
              <div className="mt-3"><StatusDot state={statusState(detail.source.status)} label={statusLabel(detail.source.status)} /></div>
              <div className="mt-auto pt-3"><MonoMeta>SQLITE · FTS5</MonoMeta></div>
            </div>
          </div>

          <section className="overflow-hidden rounded-card border border-border-hairline bg-surface">
            <header className="measurement-rule px-5 pb-3 pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-body text-headline-sm text-ink">{detail.source.name}</h2>
                  <p className="mt-1 font-body text-body-sm text-ink-muted-strong">Pratinjau baris pertama dari sumber ini.</p>
                </div>
                <MonoMeta>{num(preview?.rowCount)} BARIS</MonoMeta>
              </div>
            </header>
            <div className="flex flex-wrap gap-2 border-b border-border-hairline px-5 py-3">
              {'schema' in detail && detail.schema
                ? detail.schema.columns.map((column) => <MonoMeta key={column.name} className="!normal-case">{column.name} [{column.type}]</MonoMeta>)
                : 'sections' in detail ? detail.sections.slice(0, 8).map((section, i) => <MonoMeta key={i} className="!normal-case">{section.title}</MonoMeta>) : null}
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
                        return <td key={column.key} className="px-4 py-3 font-mono text-body-sm text-ink">{isStatus ? <StatusDot state={String(value).toUpperCase() === 'FAILED' ? 'error' : 'active'} label={String(value ?? '—')} /> : value == null ? <span className="text-ink-muted-strong">null</span> : isAmount ? <span className="tabular">Rp {formatNumber(value as number)}</span> : <span className="tabular">{String(value)}</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-hairline px-5 py-3">
              <MonoMeta>MENAMPILKAN {previewRows.length} DARI {num(preview?.rowCount)} BARIS</MonoMeta>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={!preview?.truncated || previewLoading} onClick={() => void loadPreview(50)}>Muat 50 baris berikutnya</Button>
                <Link href="/assistant" className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 font-body text-label-md font-semibold text-on-primary transition-colors hover:bg-[#0A3A2C] focus-ring-forest">Tanya data ini</Link>
              </div>
            </div>
          </section>

          {'schema' in detail && detail.quality && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section className="rounded-card border border-border-hairline bg-surface p-5">
                <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Skema terdeteksi</h2></header>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-canvas"><tr>{['Kolom', 'Tipe', 'Nullable'].map((h, i) => <th key={h} className={`px-4 py-3 font-body text-label-sm uppercase text-ink-muted-strong ${i === 2 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                    <tbody>{detail.schema?.columns.map((column) => <tr key={column.name} className="border-t border-border-hairline"><td className="px-4 py-3 font-mono text-body-sm text-ink">{column.name}</td><td className="px-4 py-3 font-mono text-body-sm text-primary">{column.type}</td><td className="px-4 py-3 text-right font-body text-body-sm text-ink-muted-strong">{column.nullable ? 'Ya' : 'Tidak'}</td></tr>)}</tbody>
                  </table>
                </div>
              </section>
              <section className="rounded-card border border-border-hairline bg-surface p-5">
                <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Kualitas data</h2></header>
                <dl className="divide-y divide-border-hairline">
                  {[
                    ['Baris diproses', num(detail.quality.rowsParsed)],
                    ['Baris ditolak', num(detail.quality.rowsRejected)],
                    ['Baris duplikat', num(detail.quality.duplicateRows)],
                    ['Rentang tanggal', detail.bounds ? `${detail.bounds.minDate} – ${detail.bounds.maxDate}` : '—'],
                  ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2 py-3 font-body text-body-md"><dt className="text-ink-muted-strong">{label}</dt><dd className="text-right font-mono tabular text-ink">{value}</dd></div>)}
                </dl>
              </section>
            </div>
          )}
          {'sections' in detail && (
            <section className="rounded-card border border-border-hairline bg-surface p-5">
              <header className="measurement-rule -mx-5 -mt-5 mb-4 px-5 pb-3 pt-4"><h2 className="font-body text-headline-sm text-ink">Metadata indeks</h2></header>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  ['Terindeks', detail.index.indexed ? 'Ya' : 'Tidak'],
                  ['Mesin', detail.index.indexed ? detail.index.engine : '—'],
                  ['Waktu', detail.index.indexedAt ? detail.index.indexedAt.slice(0, 10) : '—'],
                  ['Potongan', num(detail.source.chunkCount)],
                ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2 rounded-control border border-border-hairline p-3 font-body text-body-md"><dt className="text-ink-muted-strong">{label}</dt><dd className="font-mono text-ink">{value}</dd></div>)}
              </dl>
            </section>
          )}
        </>
      ) : null}

      <Dialog open={deleteOpen} onOpenChange={(open) => !open && setDeleteOpen(false)} title={detail ? `Hapus “${detail.source.name}”?` : 'Hapus sumber?'} description="Tindakan ini tidak dapat dibatalkan. Riwayat percakapan dan laporan tetap tersimpan.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setDeleteOpen(false)}>Batal</Button>
          <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>Hapus</Button>
        </div>
      </Dialog>
    </div>
  );
}
