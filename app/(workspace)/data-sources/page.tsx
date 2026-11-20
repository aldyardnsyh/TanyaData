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
import { PageHeading } from '@/components/signal/page-heading';
import { SectionRule } from '@/components/signal/section-rule';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { AnimatedTabs } from '@/components/signal/animated-tabs';
import { LayoutGrid, type RevealCard } from '@/components/signal/layout-grid';
import { Dropzone } from '@/components/signal/dropzone';
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
  UNPROCESSABLE_SOURCE: 'File tidak dapat diproses. Periksa format atau kolom wajibnya.',
  INTERNAL_ERROR: 'Terjadi kesalahan internal. Silakan coba lagi.',
};
const DATASET_EXTS = ['.csv', '.xlsx'];
const DOCUMENT_EXTS = ['.pdf', '.docx', '.txt', '.md'];
const MAX_BYTES = 25 * 1024 * 1024;
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
type JobState = { name: string; step: string | null; progress: number };

export default function DataSourcesPage() {
  const sources = useApi<SourcesListResponse>('/api/sources');
  const meta = useApi<MetaResponse>('/api/meta');

  const [filter, setFilter] = useState('all');
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SourceListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewDetail, setPreviewDetail] = useState<SourceDetailResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLimit, setPreviewLimit] = useState(5);

  const items = sources.data?.items ?? [];
  const counts = sources.data?.counts;
  const totalBytes = items.reduce((sum, s) => sum + (s.sizeBytes ?? 0), 0);
  const totalRows = items.reduce((sum, s) => sum + (s.rowCount ?? 0), 0);
  const totalChunks = items.reduce((sum, s) => sum + (s.chunkCount ?? 0), 0);

  const tabs = [
    { id: 'all', label: `Semua (${items.length})` },
    { id: 'dataset', label: `Dataset (${counts?.dataset ?? 0})` },
    { id: 'document', label: `Dokumen (${counts?.document ?? 0})` },
    { id: 'processing', label: `Memproses (${counts?.processing ?? 0})` },
    { id: 'failed', label: `Gagal (${counts?.failed ?? 0})` },
  ];
  const visible = items.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'processing') return s.status === 'PROCESSING' || s.status === 'UPLOADED';
    if (filter === 'failed') return s.status === 'FAILED';
    return s.kind === filter;
  });

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
    const interval = window.setInterval(() => void tick(), 1000);
    return () => { cancelled = true; window.clearInterval(interval); };
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

  const upload = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (![...DATASET_EXTS, ...DOCUMENT_EXTS].includes(ext)) { toast({ status: 'error', message: ERROR_MESSAGES.UNSUPPORTED_MEDIA_TYPE }); return; }
    if (file.size > MAX_BYTES) { toast({ status: 'error', message: ERROR_MESSAGES.FILE_TOO_LARGE }); return; }
    setUploading(true);
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
    } finally { setUploading(false); }
  }, [sources]);

  const reindex = async (source: SourceListItem) => {
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

  const summaryItems: BentoItem[] = [
    { id: 'storage', label: 'Total penyimpanan', value: sources.loading ? '…' : `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`, source: `${num(counts?.dataset)} DATASET`, span: 'support' },
    { id: 'docs', label: 'Dokumen terindeks', value: sources.loading ? '…' : num(counts?.document), source: `${num(totalChunks)} POTONGAN`, span: 'support' },
    { id: 'rows', label: 'Baris tersimpan', value: sources.loading ? '…' : num(totalRows), source: 'SQLITE · SQL', span: 'support' },
    { id: 'status', label: 'Status pemrosesan', value: (counts?.failed ?? 0) > 0 ? `${counts?.failed} perlu diperiksa` : 'Semua siap', source: 'SQLITE · FTS5', span: 'support' },
  ];

  const cards: RevealCard[] = visible.map((source) => ({
    id: source.id,
    title: source.name,
    meta: `${source.kind.toUpperCase()} · ${source.format.toUpperCase()} · ${formatBytes(source.sizeBytes)}`,
    preview: (
      <div className="flex flex-wrap items-center justify-between gap-s2">
        <StatusBadge label={statusLabel(source.status)} tone={statusTone(source.status)} />
        <span className="mono-meta">{source.kind === 'dataset' ? `${num(source.rowCount)} BARIS` : `${num(source.chunkCount)} POTONGAN`}</span>
      </div>
    ),
    detail: (
      <div className="flex flex-col gap-s2">
        <p className="font-body text-caption text-ink-72">Dibuat {source.createdAt.slice(0, 10)}</p>
        <div className="flex flex-wrap gap-s2">
          <Link href={`/data-sources/${source.id}`} className="touch-44 inline-flex items-center rounded-control border border-forest px-s2 font-display text-label font-semibold text-forest focus-ring">Buka detail</Link>
          <button type="button" onClick={() => void loadPreview(source.id, 5)} className="touch-44 inline-flex items-center rounded-control border border-[var(--border-hairline)] px-s2 font-display text-label font-semibold text-ink focus-ring">Pratinjau</button>
          <button type="button" onClick={() => void reindex(source)} className="touch-44 inline-flex items-center rounded-control border border-[var(--border-hairline)] px-s2 font-display text-label font-semibold text-ink focus-ring">Indeks ulang</button>
          {source.id !== 'seed' && <button type="button" onClick={() => setDeleteTarget(source)} className="touch-44 inline-flex items-center rounded-control border border-[var(--border-hairline)] px-s2 font-display text-label font-semibold text-ink focus-ring">Hapus</button>}
        </div>
      </div>
    ),
  }));

  const previewColumns = preview?.columns ?? [];
  const previewRows = preview?.rows ?? [];

  return (
    <div className="page-container py-s5">
      <PageHeading
        title="Sumber Data"
        caption="Kelola dataset dan dokumen yang menjadi dasar setiap jawaban."
        meta={`SQLITE · SQL + ${meta.data?.capabilities.rag.toUpperCase() ?? 'FTS5'}`}
      />

      <section aria-label="Ringkasan sumber" className="mb-s5">
        <BentoGrid items={summaryItems} state={sources.loading ? 'loading' : sources.error ? 'error' : 'default'} errorTitle="Ringkasan gagal dimuat." onRetry={sources.retry} />
      </section>

      <section aria-labelledby="dropzone-heading" className="mb-s5">
        <h2 id="dropzone-heading" className="font-display text-title text-ink">Unggah sumber</h2>
        <SectionRule className="mb-s3 mt-s2" />
        <Dropzone onFiles={(files) => void upload(files)} busy={uploading} />
        {(uploading || job) && (
          <div className="mt-s3 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s3">
            <div className="flex items-center justify-between gap-s2">
              <span className="min-w-0 truncate font-body text-body text-ink">{uploading ? 'Mengunggah berkas' : job?.name}</span>
              <span className="mono-meta">{uploading ? 'MENGUNGGAH' : `${job?.step ?? 'MEMPROSES'} · ${job?.progress ?? 0}%`}</span>
            </div>
            <div className="mt-s2 h-s2 w-full overflow-hidden rounded-control bg-forest-08" role="progressbar" aria-valuenow={uploading ? undefined : job?.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-forest transition-[width] duration-[var(--motion-slow)]" style={{ width: uploading ? '33%' : `${job?.progress ?? 0}%` }} />
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="sumber-heading" className="mb-s5">
        <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
          <h2 id="sumber-heading" className="font-display text-title text-ink">Sumber terdaftar</h2>
          <span className="mono-meta">{visible.length} SUMBER</span>
        </div>
        <AnimatedTabs tabs={tabs} activeId={filter} onChange={setFilter} className="mb-s3" />
        <LayoutGrid
          cards={cards}
          state={sources.loading ? 'loading' : sources.error ? 'error' : visible.length === 0 ? 'empty' : 'default'}
          emptyTitle="Belum ada sumber pada filter ini. Unggah berkas untuk menambah sumber."
          emptyAction={{ label: 'Unggah berkas', onClick: () => document.getElementById('dropzone-heading')?.scrollIntoView({ behavior: 'smooth' }) }}
          errorTitle="Daftar sumber gagal dimuat."
          onRetry={sources.retry}
        />
      </section>

      {/* Tabel validasi / pratinjau. */}
      <section aria-labelledby="validasi-heading">
        <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
          <div>
            <h2 id="validasi-heading" className="font-display text-title text-ink">Pratinjau validasi</h2>
            <p className="mt-s1 font-body text-caption text-ink-72">Baris pertama dari sumber yang dipilih. Angka berasal dari berkas asli.</p>
          </div>
          {previewDetail && <span className="mono-meta">{previewDetail.source.name.toUpperCase()} · {num(preview?.rowCount)} BARIS</span>}
        </div>
        <SectionRule className="mb-s3" />
        {previewLoading ? (
          <div className="skeleton h-40 w-full" aria-busy="true" />
        ) : previewError ? (
          <div className="flex flex-col items-start gap-s2 surface p-s4" role="alert">
            <span className="inline-flex items-center gap-s2"><StatusBadge label="Gagal" tone="error" /><span className="font-body text-body text-ink">{previewError}</span></span>
            {previewId && <button type="button" onClick={() => void loadPreview(previewId, previewLimit)} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>}
          </div>
        ) : !previewDetail ? (
          <div className="surface flex items-center gap-s2 p-s4"><StatusBadge label="Belum ada pratinjau" tone="neutral" /><span className="font-body text-body text-ink-72">Pilih sumber untuk melihat pratinjau.</span></div>
        ) : previewRows.length === 0 ? (
          <div className="surface flex items-center gap-s2 p-s4"><StatusBadge label="Kosong" tone="neutral" /><span className="font-body text-body text-ink-72">Tidak ada baris untuk ditampilkan.</span></div>
        ) : (
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Pratinjau {previewDetail.source.name}</caption>
                <thead><tr className="bg-forest-08"><th scope="col" className="px-s3 py-s2 font-body text-caption text-ink-72">#</th>{previewColumns.map((col) => <th key={col.key} scope="col" className="whitespace-nowrap px-s3 py-s2 font-body text-caption text-ink-72">{col.label}</th>)}</tr></thead>
                <tbody>
                  {previewRows.map((row, i) => (
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
                <button type="button" disabled={!preview?.truncated || previewLoading} onClick={() => previewId && void loadPreview(previewId, 50)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring disabled:opacity-50">Muat 50 baris</button>
                <Link href="/assistant" className="touch-44 inline-flex items-center rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring">Tanya data ini</Link>
              </div>
            </div>
          </div>
        )}
      </section>

      {deleteTarget && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-s3">
          <div className="animate-backdrop-in absolute inset-0 bg-ink/40" onClick={() => setDeleteTarget(null)} aria-hidden="true" />
          <div className="animate-modal-in elevated relative w-full max-w-[480px] rounded-overlay border border-[var(--border-hairline)] bg-porcelain p-s4" role="dialog" aria-modal="true" aria-label="Hapus sumber">
            <h2 className="font-display text-title text-ink">Hapus “{deleteTarget.name}”?</h2>
            <p className="mt-s2 font-body text-body text-ink-72">Tindakan ini tidak dapat dibatalkan. Riwayat percakapan dan laporan tetap tersimpan.</p>
            <div className="mt-s4 flex justify-end gap-s2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring">Batal</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="touch-44 rounded-control border border-terracotta px-s3 font-display text-label font-semibold text-ink focus-ring disabled:opacity-50">{deleting ? 'Menghapus' : 'Hapus'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
