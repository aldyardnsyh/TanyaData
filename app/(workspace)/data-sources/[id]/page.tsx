'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ApiErrorCode, PreviewResponse, SourceDetailResponse } from '@/lib/contracts/http';
import { formatNumber } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { PageHeading } from '@/components/signal/page-heading';
import { SectionRule } from '@/components/signal/section-rule';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { StatusBadge } from '@/components/signal/status-badge';
import type { DotTone } from '@/components/signal/status-dot';
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
const num = (v: number | null | undefined) => (v == null ? 'Belum dihitung' : formatNumber(v));
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
function statusTone(status: string): DotTone {
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

  const summaryItems: BentoItem[] = detail ? [
    { id: 'rows', label: 'Baris tersimpan', value: num(detail.source.rowCount), source: detail.source.format.toUpperCase(), span: 'support' },
    { id: 'detail', label: isDocument ? 'Potongan terindeks' : 'Kolom', value: num(isDocument ? detail.source.chunkCount : 'schema' in detail ? detail.schema?.columns.length : null), source: isDocument ? `${num(detail.source.pageCount)} HALAMAN` : 'schema' in detail ? detail.schema?.tableName ?? '—' : '—', span: 'support' },
    { id: 'size', label: 'Ukuran penyimpanan', value: formatBytes(detail.source.sizeBytes), source: 'SUMBER', span: 'support' },
    { id: 'status', label: 'Status', value: statusLabel(detail.source.status), source: 'SQLITE · FTS5', span: 'support' },
  ] : [];

  return (
    <div className="page-container py-s5">
      <PageHeading
        title={loading ? 'Memuat sumber' : detail?.source.name ?? (notFound ? 'Sumber tidak ditemukan' : 'Sumber')}
        caption="Periksa skema, kualitas data, dan konten terindeks dari sumber ini."
        meta={detail ? `${detail.source.kind.toUpperCase()} · ${detail.source.format.toUpperCase()} · ${detail.source.status}` : undefined}
        actions={
          <>
            <Link href="/data-sources" className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="arrow_back" className="text-[16px]" /> Kembali</Link>
            <button type="button" onClick={() => void reindex()} disabled={!detail || loading} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring disabled:opacity-50"><Icon name="refresh" className="text-[16px]" /> Indeks ulang</button>
            {detail && id !== 'seed' && <button type="button" onClick={() => setDeleteOpen(true)} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-terracotta px-s3 font-display text-label font-semibold text-ink focus-ring"><Icon name="delete" className="text-[16px]" /> Hapus</button>}
          </>
        }
      />

      {notFound ? (
        <div className="surface flex flex-col items-start gap-s2 p-s4">
          <StatusBadge label="Tidak ditemukan" tone="error" />
          <p className="font-body text-body text-ink">Sumber ini mungkin sudah dihapus.</p>
          <Link href="/data-sources" className="touch-44 inline-flex items-center rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring">Kembali ke Sumber Data</Link>
        </div>
      ) : loading ? (
        <div className="space-y-s4" aria-busy="true"><div className="bento">{[0, 1, 2, 3].map((i) => <div key={i} data-cell data-span="support" className="surface p-s3"><div className="skeleton h-s2 w-2/3" /><div className="skeleton mt-s3 h-s5 w-1/2" /></div>)}</div><div className="skeleton h-64 w-full" /></div>
      ) : error ? (
        <div className="flex flex-col items-start gap-s2 surface p-s4" role="alert">
          <span className="inline-flex items-center gap-s2"><StatusBadge label="Gagal" tone="error" /><span className="font-body text-body text-ink">{error}</span></span>
          <button type="button" onClick={() => void load()} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
        </div>
      ) : detail ? (
        <>
          <section aria-label="Metadata sumber" className="mb-s5"><BentoGrid items={summaryItems} /></section>

          <section aria-labelledby="preview-heading" className="mb-s5">
            <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
              <div>
                <h2 id="preview-heading" className="font-display text-title text-ink">Pratinjau data</h2>
                <p className="mt-s1 font-body text-caption text-ink-72">Baris pertama dari sumber ini. Angka berasal dari berkas asli.</p>
              </div>
              <span className="mono-meta">{num(preview?.rowCount)} BARIS</span>
            </div>
            <SectionRule className="mb-s3" />
            <div className="surface overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Pratinjau {detail.source.name}</caption>
                  <thead><tr className="bg-forest-08"><th scope="col" className="px-s3 py-s2 font-body text-caption text-ink-72">#</th>{previewColumns.map((col) => <th key={col.key} scope="col" className="whitespace-nowrap px-s3 py-s2 font-body text-caption text-ink-72">{col.label}</th>)}</tr></thead>
                  <tbody>
                    {previewLoading && <tr><td colSpan={previewColumns.length + 1} className="px-s3 py-s4"><div className="skeleton h-s3 w-full" /></td></tr>}
                    {!previewLoading && previewError && <tr><td colSpan={previewColumns.length + 1} className="px-s3 py-s4 font-body text-body text-ink">{previewError}</td></tr>}
                    {!previewLoading && !previewError && previewRows.length === 0 && <tr><td colSpan={previewColumns.length + 1} className="px-s3 py-s4 font-body text-body text-ink-72">Tidak ada baris untuk ditampilkan.</td></tr>}
                    {!previewLoading && previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-[var(--border-hairline)]">
                        <td className="px-s3 py-s2 font-body text-caption tabular text-ink-72">{i + 1}</td>
                        {previewColumns.map((col) => {
                          const value = row[col.key];
                          const isAmount = col.key.toLowerCase().includes('amount') && typeof value === 'number';
                          return <td key={col.key} className="whitespace-nowrap px-s3 py-s2 font-body text-caption tabular text-ink">{isAmount ? `Rp ${formatNumber(value as number)}` : value == null ? <span className="text-ink-72">null</span> : String(value)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-s2 border-t border-[var(--border-hairline)] px-s3 py-s2">
                <span className="mono-meta">MENAMPILKAN {previewRows.length} DARI {num(preview?.rowCount)} BARIS</span>
                <div className="flex flex-wrap gap-s2">
                  <button type="button" disabled={!preview?.truncated || previewLoading} onClick={() => void loadPreview(50)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring disabled:opacity-50">Muat 50 baris</button>
                  <Link href="/assistant" className="touch-44 inline-flex items-center rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring">Tanya data ini</Link>
                </div>
              </div>
            </div>
          </section>

          {/* Skema & kualitas (dataset) atau metadata indeks (dokumen). */}
          {'schema' in detail && detail.quality && (
            <div className="grid-dashboard mb-s5">
              <section className="surface col-span-4 p-s4 xl:col-span-6">
                <h2 className="font-display text-title text-ink">Skema terdeteksi</h2>
                <SectionRule className="mb-s3 mt-s2" />
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <caption className="sr-only">Skema kolom</caption>
                    <thead><tr className="bg-forest-08">{['Kolom', 'Tipe', 'Nullable'].map((h) => <th key={h} scope="col" className="px-s3 py-s2 font-body text-caption text-ink-72">{h}</th>)}</tr></thead>
                    <tbody>{detail.schema?.columns.map((column) => <tr key={column.name} className="border-t border-[var(--border-hairline)]"><td className="px-s3 py-s2 font-body text-caption text-ink">{column.name}</td><td className="px-s3 py-s2 font-body text-caption text-forest">{column.type}</td><td className="px-s3 py-s2 font-body text-caption text-ink-72">{column.nullable ? 'Ya' : 'Tidak'}</td></tr>)}</tbody>
                  </table>
                </div>
              </section>
              <section className="surface col-span-4 p-s4 xl:col-span-6">
                <h2 className="font-display text-title text-ink">Kualitas data</h2>
                <SectionRule className="mb-s3 mt-s2" />
                <dl className="divide-y divide-[var(--border-hairline)]">
                  {[
                    ['Baris diproses', num(detail.quality.rowsParsed)],
                    ['Baris ditolak', num(detail.quality.rowsRejected)],
                    ['Baris duplikat', num(detail.quality.duplicateRows)],
                    ['Rentang tanggal', detail.bounds ? `${detail.bounds.minDate} – ${detail.bounds.maxDate}` : '—'],
                  ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-s2 py-s2 font-body text-caption"><dt className="text-ink-72">{label}</dt><dd className="text-right tabular text-ink">{value}</dd></div>)}
                </dl>
              </section>
            </div>
          )}
          {'sections' in detail && (
            <section className="surface mb-s5 p-s4">
              <h2 className="font-display text-title text-ink">Metadata indeks</h2>
              <SectionRule className="mb-s3 mt-s2" />
              <dl className="grid grid-cols-1 gap-s2 sm:grid-cols-2">
                {[
                  ['Terindeks', detail.index.indexed ? 'Ya' : 'Tidak'],
                  ['Mesin', detail.index.indexed ? detail.index.engine : '—'],
                  ['Waktu', detail.index.indexedAt ? detail.index.indexedAt.slice(0, 10) : '—'],
                  ['Potongan', num(detail.source.chunkCount)],
                ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-s2 rounded-control border border-[var(--border-hairline)] p-s3 font-body text-caption"><dt className="text-ink-72">{label}</dt><dd className="tabular text-ink">{value}</dd></div>)}
              </dl>
            </section>
          )}
        </>
      ) : null}

      {deleteOpen && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-s3">
          <div className="animate-backdrop-in absolute inset-0 bg-ink/40" onClick={() => setDeleteOpen(false)} aria-hidden="true" />
          <div className="animate-modal-in elevated relative w-full max-w-[480px] rounded-overlay border border-[var(--border-hairline)] bg-porcelain p-s4" role="dialog" aria-modal="true" aria-label="Hapus sumber">
            <h2 className="font-display text-title text-ink">Hapus sumber?</h2>
            <p className="mt-s2 font-body text-body text-ink-72">Tindakan ini tidak dapat dibatalkan. Riwayat percakapan dan laporan tetap tersimpan.</p>
            <div className="mt-s4 flex justify-end gap-s2">
              <button type="button" onClick={() => setDeleteOpen(false)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring">Batal</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="touch-44 rounded-control border border-terracotta px-s3 font-display text-label font-semibold text-ink focus-ring disabled:opacity-50">{deleting ? 'Menghapus' : 'Hapus'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
