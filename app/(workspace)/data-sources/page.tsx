'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { UploadCloud, RefreshCw, Trash2, FileSpreadsheet, FileText } from 'lucide-react';
import type {
  ApiErrorCode,
  ReindexResponse,
  SourceListItem,
  SourcesListResponse,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { formatNumber, formatDateTimeId } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { StatusBadge, type Status } from '@/components/ui/badge';
import { Tabs } from '@/components/ui/tabs';
import { FilterChips } from '@/components/ui/filter-chips';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/inline-error';
import { toast } from '@/components/ui/toaster';

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Data yang dikirim tidak valid.',
  NOT_FOUND: 'Sumber tidak ditemukan.',
  METHOD_NOT_ALLOWED: 'Metode tidak didukung.',
  CONFLICT: 'Operasi tidak dapat dilakukan pada kondisi saat ini.',
  FILE_TOO_LARGE: 'Ukuran file melebihi batas 25 MB.',
  UNSUPPORTED_MEDIA_TYPE: 'Format file tidak didukung.',
  UNPROCESSABLE_SOURCE: 'File tidak dapat diproses. Periksa format atau kolom wajib.',
  INTERNAL_ERROR: 'Terjadi kesalahan internal. Silakan coba lagi.',
};

const ACCEPT = '.csv,.xlsx,.pdf,.docx,.txt,.md';
const MAX_BYTES = 25 * 1024 * 1024;

function sourceStatus(s: SourceListItem): Status {
  if (s.status === 'READY') return 'success';
  if (s.status === 'PROCESSING' || s.status === 'UPLOADED') return 'info';
  return 'danger';
}

function statusLabel(s: SourceListItem): string {
  return s.status === 'READY' ? 'Siap' : s.status === 'PROCESSING' || s.status === 'UPLOADED' ? 'Memproses' : 'Gagal';
}

export default function DataSourcesPage() {
  const sources = useApi<SourcesListResponse>('/api/sources');
  const [tab, setTab] = useState('structured');
  const [kindFilter, setKindFilter] = useState('all');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SourceListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const items = sources.data?.items ?? [];
  const counts = sources.data?.counts;

  // Poll sumber yang masih PROCESSING/UPLOADED tiap 1 s sampai terminal.
  useEffect(() => {
    const active = items.filter((s) => s.status === 'PROCESSING' || s.status === 'UPLOADED');
    if (active.length > 0) {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => sources.retry(), 1000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      // interval sengaja dipertahankan lintas render; bersihkan saat unmount
    };
  }, [items, sources]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const upload = useCallback(async (file: File, kind: 'dataset' | 'document') => {
    setUploading(true);
    setUploadProgress({ name: file.name });
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      const res = await fetch('/api/sources', { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? body?.error?.message ?? 'Unggah gagal.');
      }
      toast({ status: 'success', message: 'File ditambahkan. Pemrosesan dimulai.' });
      sources.retry();
      setUploadProgress(null);
    } catch (err) {
      setUploadProgress(null);
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Unggah gagal.' });
    } finally {
      setUploading(false);
    }
  }, [sources]);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const file = files[0];
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    const datasetExts = ['.csv', '.xlsx'];
    const documentExts = ['.pdf', '.docx', '.txt', '.md'];
    if (![...datasetExts, ...documentExts].includes(ext)) {
      toast({ status: 'error', message: ERROR_MESSAGES.UNSUPPORTED_MEDIA_TYPE });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ status: 'error', message: ERROR_MESSAGES.FILE_TOO_LARGE });
      return;
    }
    void upload(file, datasetExts.includes(ext) ? 'dataset' : 'document');
  };

  const reindex = async (source: SourceListItem) => {
    try {
      const res = await fetch(`/api/sources/${source.id}/reindex`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? 'Reindex gagal.');
      }
      const json: ReindexResponse = await res.json();
      toast({ status: 'success', message: `Reindex dimulai (${json.job.step ?? 'memproses'}).` });
      sources.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Reindex gagal.' });
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
        throw new Error(code === 'CONFLICT' ? 'Sumber aktif atau sedang diproses tidak dapat dihapus.' : ERROR_MESSAGES[code]);
      }
      toast({ status: 'success', message: 'Sumber dihapus.' });
      setDeleteTarget(null);
      sources.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal menghapus sumber.' });
    } finally {
      setDeleting(false);
    }
  };

  const filtered = items.filter((s) => {
    if (tab === 'structured' && s.kind !== 'dataset') return false;
    if (tab === 'documents' && s.kind !== 'document') return false;
    if (kindFilter !== 'all' && s.format.toLowerCase() !== kindFilter) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-headline-xl font-bold tracking-tight text-on-surface">Sumber Data</h1>
          <p className="mt-0.5 font-body text-body-md text-on-surface-variant">Kelola dataset dan dokumen pada workspace.</p>
        </div>
        <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <UploadCloud className="h-4 w-4" />
          Unggah file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          aria-label="Pilih file untuk diunggah"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Dataset</p>
          <p className="mt-1 font-display text-metric-xl font-bold tabular text-on-surface">{formatNumber(counts?.dataset ?? null)}</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Dokumen</p>
          <p className="mt-1 font-display text-metric-xl font-bold tabular text-on-surface">{formatNumber(counts?.document ?? null)}</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Sedang diproses / Gagal</p>
          <p className="mt-1 font-display text-metric-xl font-bold tabular text-on-surface">
            {formatNumber((counts?.processing ?? 0) + (counts?.failed ?? 0))}
          </p>
        </div>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        aria-label="Tarik file ke sini atau pilih file"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        className={`flex min-h-36 flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-[var(--motion-fast)] focus-ring ${
          dragging ? 'border-primary bg-surface' : 'border-outline-variant bg-surface-container-lowest'
        }`}
      >
        <UploadCloud className="h-6 w-6 text-primary" aria-hidden="true" />
        <p className="mt-2 font-display text-headline-sm font-semibold text-on-surface">Tarik file ke sini atau pilih file</p>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">CSV, XLSX, PDF, DOCX, TXT, MD · maks 25 MB</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => fileRef.current?.click()} disabled={uploading}>
          Pilih file
        </Button>
      </div>

      {uploadProgress && (
        <div className="rounded-md border border-outline-variant bg-surface-container-low p-3">
          <div className="mb-1 flex items-center justify-between font-body text-body-sm text-on-surface">
            <span className="truncate">Mengunggah {uploadProgress.name}…</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest"
            role="progressbar"
            aria-valuetext={`Mengunggah ${uploadProgress.name}`}
          >
            <div className="h-full w-1/3 rounded-full bg-primary animate-indeterminate" />
          </div>
        </div>
      )}

      {/* Daftar sumber */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant p-4">
          <Tabs
            tabs={[
              { id: 'structured', label: `Dataset (${counts?.dataset ?? 0})` },
              { id: 'documents', label: `Dokumen (${counts?.document ?? 0})` },
            ]}
            value={tab}
            onChange={(v) => { setTab(v); setKindFilter('all'); }}
            idPrefix="sumber"
            label="Jenis sumber"
          />
          {/* C-18: filter format = pill chip (group + aria-pressed), scroll + fade tepi kanan. */}
          <FilterChips
            chips={(tab === 'structured' ? ['all', 'csv', 'xlsx'] : ['all', 'pdf', 'docx', 'txt', 'md']).map((k) => ({
              id: k,
              label: k === 'all' ? 'Semua' : k.toUpperCase(),
            }))}
            value={kindFilter}
            onChange={setKindFilter}
            label="Filter format"
          />
        </div>

        {/* Panel tab — id cocok dengan aria-controls Tabs (A-13). */}
        <div role="tabpanel" id={`sumber-panel-${tab}`} aria-labelledby={`sumber-${tab}`}>

        {sources.loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : sources.error ? (
          <div className="p-4">
            <InlineError title="Gagal memuat daftar sumber" message={sources.error} onRetry={sources.retry} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={tab === 'structured' ? <FileSpreadsheet className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
            title="Belum ada sumber"
            description="Unggah file untuk menambah dataset atau dokumen."
          />
        ) : (
          <div className="divide-y divide-outline-variant">
            {filtered.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {s.kind === 'dataset' ? (
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-tertiary" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <Link href={`/data-sources/${s.id}`} className="block truncate font-body text-label-md font-semibold text-on-surface hover:underline focus-ring">
                      {s.name}
                    </Link>
                    <span className="block font-body text-body-sm text-on-surface-variant">
                      {s.format.toUpperCase()} · {s.kind === 'dataset' ? `${formatNumber(s.rowCount)} baris` : `${formatNumber(s.chunkCount)} chunk`} · {formatDateTimeId(s.createdAt)}
                    </span>
                  </div>
                </div>
                <StatusBadge status={sourceStatus(s)} label={statusLabel(s)} />
                <div className="flex items-center gap-1">
                  <Link href={`/data-sources/${s.id}`}>
                    <Button size="sm" variant="secondary">Detail</Button>
                  </Link>
                  {s.status === 'FAILED' && (
                    <Button size="sm" variant="ghost" onClick={() => void reindex(s)} aria-label={`Reindex ${s.name}`}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Reindex
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleteTarget(s)}
                    disabled={s.id === 'seed'}
                    title={s.id === 'seed' ? 'Sumber data bawaan tidak dapat dihapus.' : undefined}
                    aria-label={`Hapus ${s.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget ? `Hapus “${deleteTarget.name}”?` : 'Hapus sumber?'}
        description="Tindakan ini tidak dapat dibatalkan. Riwayat percakapan dan laporan tetap tersimpan."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setDeleteTarget(null)}>Batal</Button>
          <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>Hapus</Button>
        </div>
      </Dialog>
    </div>
  );
}
