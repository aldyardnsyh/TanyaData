'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Trash2, FileText, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import type {
  DatasetSourceDetail,
  DocumentSourceDetail,
  PreviewResponse,
  SourceDetailResponse,
} from '@/lib/contracts/http';
import { formatNumber, formatDateTimeId, formatPercent } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Tabs } from '@/components/ui/tabs';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';

function fmtCell(v: string | number | null): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return formatNumber(v);
  return v;
}

export default function DataSourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SourceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [limit, setLimit] = useState(5);
  // C-19/A-13: dua tab sesuai jenis sumber (dataset: Pratinjau/Skema; dokumen: Teks/Metadata).
  const [tab, setTab] = useState('preview');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
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
      const json: SourceDetailResponse = await res.json();
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail sumber.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadPreview = useCallback(async (lim: number) => {
    if (!id) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/sources/${id}/preview?limit=${lim}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: PreviewResponse = await res.json();
      setPreview(json);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Gagal memuat pratinjau.');
    } finally {
      setPreviewLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id && detail) void loadPreview(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, detail]);

  const reindex = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/sources/${id}/reindex`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Reindex gagal.');
      }
      toast({ status: 'success', message: 'Reindex dimulai.' });
      await load();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Reindex gagal.' });
    }
  };

  const confirmDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Gagal menghapus.');
      }
      toast({ status: 'success', message: 'Sumber dihapus.', action: 'Kembali', onAction: () => { window.location.href = '/data-sources'; } });
      setDeleteOpen(false);
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal menghapus.' });
    } finally {
      setDeleting(false);
    }
  };

  const isDataset = detail && 'schema' in detail;
  const isDocument = detail && 'sections' in detail;

  // §D.5 Skema: Kolom · Tipe terdeteksi · Null % · Contoh nilai.
  // Null % dari quality.missingByColumn ÷ rowsParsed; contoh dari baris pratinjau pertama yang terisi.
  const schemaRows: Record<string, string | number | null>[] =
    detail && 'schema' in detail && detail.schema
      ? detail.schema.columns.map((c) => {
          const missing = detail.quality?.missingByColumn?.[c.name];
          const parsed = detail.quality?.rowsParsed;
          const nullPct =
            typeof missing === 'number' && typeof parsed === 'number' && parsed > 0
              ? (missing / parsed) * 100
              : null;
          const sample = preview?.rows.find((r) => r[c.name] !== null && r[c.name] !== undefined)?.[c.name];
          return { name: c.name, type: c.type, nullPct, sample: sample ?? null };
        })
      : [];

  const previewColumns: DataTableColumn<Record<string, string | number | null>>[] =
    preview?.columns.map((c) => ({
      key: c.key,
      label: c.label,
      align: typeof preview.rows.find((r) => typeof r[c.key] === 'number') !== 'undefined' ? 'right' : 'left',
      format: (v) => fmtCell(v),
    })) ?? [];

  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-6 py-8">
      <Link href="/data-sources" className="inline-flex items-center gap-1.5 font-body text-label-md text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:text-on-surface focus-ring">
        <ArrowLeft className="h-4 w-4" />
        Kembali ke Sumber Data
      </Link>

      {notFound ? (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="Sumber tidak ditemukan"
          description="Sumber ini mungkin sudah dihapus."
          action={<Button variant="secondary" onClick={() => { window.location.href = '/data-sources'; }}>Kembali ke Sumber Data</Button>}
        />
      ) : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-md bg-error-container p-4 text-center">
          <p className="font-body text-body-md text-on-error-container">{error}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={load}>Coba lagi</Button>
        </div>
      ) : detail ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container">
                {isDocument ? <FileText className="h-5 w-5 text-tertiary" /> : <FileSpreadsheet className="h-5 w-5 text-primary" />}
              </div>
              <div>
                <h1 className="font-display text-headline-xl font-bold tracking-tight text-on-surface">{detail.source.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge
                    status={detail.source.status === 'READY' ? 'success' : detail.source.status === 'FAILED' ? 'danger' : 'info'}
                    label={detail.source.status === 'READY' ? 'Siap' : detail.source.status === 'FAILED' ? 'Gagal' : 'Memproses'}
                  />
                  <span className="font-body text-body-sm text-on-surface-variant">
                    {detail.source.format.toUpperCase()} · {formatDateTimeId(detail.source.createdAt)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void reindex()}><RefreshCw className="h-3.5 w-3.5" />Reindex</Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setDeleteOpen(true)}
                disabled={id === 'seed'}
                title={id === 'seed' ? 'Sumber data bawaan tidak dapat dihapus.' : undefined}
              >
                <Trash2 className="h-3.5 w-3.5" />Hapus
              </Button>
            </div>
          </div>

          {/* Meta strip — §D.5: Tipe, Baris, Kolom, Diperbarui (dataset). */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {isDataset && (
              <>
                <Meta label="Tipe" value={detail.source.format.toUpperCase()} />
                <Meta label="Baris" value={formatNumber(detail.source.rowCount)} />
                <Meta label="Kolom" value={detail.schema ? String(detail.schema.columns.length) : '—'} />
                <Meta label="Diperbarui" value={formatDateTimeId(detail.source.updatedAt ?? detail.source.createdAt)} />
              </>
            )}
            {isDocument && (
              <>
                <Meta label="Halaman" value={formatNumber(detail.source.pageCount)} />
                <Meta label="Chunk" value={formatNumber(detail.source.chunkCount)} />
                <Meta label="Indeks" value={detail.index.indexed ? detail.index.engine : 'Belum'} />
                <Meta label="Ukuran" value={`${formatNumber(Math.round((detail.source.sizeBytes ?? 0) / 1024))} KB`} />
              </>
            )}
          </div>

          {/* C-19: konten bertab — Pratinjau/Skema (dataset), Teks/Metadata (dokumen). */}
          <Tabs
            tabs={isDocument
              ? [{ id: 'preview', label: 'Teks' }, { id: 'schema', label: 'Metadata' }]
              : [{ id: 'preview', label: 'Pratinjau' }, { id: 'schema', label: 'Skema' }]}
            value={tab}
            onChange={setTab}
            idPrefix="detail"
            label="Bagian sumber"
          />

          {tab === 'schema' && isDataset && (
            <div role="tabpanel" id="detail-panel-schema" aria-labelledby="detail-schema" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
                <h2 className="font-display text-headline-sm font-semibold text-on-surface">Skema</h2>
                <p className="mb-2 font-body text-body-sm text-on-surface-variant">{detail.schema?.tableName ?? '—'}</p>
                <DataTable
                  columns={[
                    { key: 'name', label: 'Kolom' },
                    { key: 'type', label: 'Tipe terdeteksi' },
                    { key: 'nullPct', label: 'Null %', align: 'right', format: (v) => (typeof v === 'number' ? formatPercent(v) : '—') },
                    { key: 'sample', label: 'Contoh nilai', format: (v) => (v === null || v === undefined ? '—' : String(v)) },
                  ]}
                  rows={schemaRows}
                  emptyTitle="Skema tidak tersedia"
                  className="max-h-[480px] overflow-y-auto"
                  stickyHeader
                />
              </div>
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
                <h2 className="font-display text-headline-sm font-semibold text-on-surface">Kualitas data</h2>
                <dl className="mt-2 space-y-2">
                  <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Baris diparse</dt><dd className="tabular text-on-surface">{formatNumber(detail.quality?.rowsParsed ?? null)}</dd></div>
                  <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Baris ditolak</dt><dd className="tabular text-on-surface">{formatNumber(detail.quality?.rowsRejected ?? null)}</dd></div>
                  <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Duplikat</dt><dd className="tabular text-on-surface">{formatNumber(detail.quality?.duplicateRows ?? null)}</dd></div>
                  <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Rentang tanggal</dt><dd className="tabular text-on-surface">{detail.bounds ? `${formatDateTimeId(detail.bounds.minDate)} – ${formatDateTimeId(detail.bounds.maxDate)}` : '—'}</dd></div>
                </dl>
              </div>
            </div>
          )}

          {/* Document: sections — tab "Teks" */}
          {isDocument && tab === 'preview' && (
            <div role="tabpanel" id="detail-panel-preview" aria-labelledby="detail-preview" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
              <h2 className="mb-2 font-display text-headline-sm font-semibold text-on-surface">Daftar bagian & chunk</h2>
              <DataTable
                columns={[
                  { key: 'no', label: 'Bagian', align: 'right', format: (v) => formatNumber(v as number | null) },
                  { key: 'title', label: 'Judul' },
                  { key: 'page', label: 'Halaman', align: 'right', format: (v) => formatNumber(v as number | null) },
                  { key: 'chunkCount', label: 'Chunk', align: 'right', format: (v) => formatNumber(v as number) },
                ]}
                rows={(detail.sections ?? []) as unknown as Record<string, any>[]}
                emptyTitle="Tidak ada bagian"
              />
            </div>
          )}

          {/* Document: index — tab "Metadata" */}
          {isDocument && tab === 'schema' && (
            <div role="tabpanel" id="detail-panel-schema" aria-labelledby="detail-schema" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
              <h2 className="font-display text-headline-sm font-semibold text-on-surface">Metadata indeks</h2>
              <dl className="mt-2 space-y-2">
                <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Status indeks</dt><dd className="text-on-surface">{detail.index.indexed ? 'Terindeks' : 'Belum terindeks'}</dd></div>
                <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Mesin</dt><dd className="text-on-surface">{detail.index.indexed ? detail.index.engine : '—'}</dd></div>
                <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Terindeks pada</dt><dd className="text-on-surface">{detail.index.indexedAt ? formatDateTimeId(detail.index.indexedAt) : '—'}</dd></div>
                <div className="flex justify-between font-body text-body-md"><dt className="text-on-surface-variant">Jumlah chunk</dt><dd className="tabular text-on-surface">{formatNumber(detail.source.chunkCount)}</dd></div>
              </dl>
            </div>
          )}

          {/* Preview baris — tab "Pratinjau" (dataset) */}
          {isDataset && tab === 'preview' && (
          <div role="tabpanel" id="detail-panel-preview" aria-labelledby="detail-preview" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-headline-sm font-semibold text-on-surface">
                Pratinjau baris
              </h2>
              {/* §D.5: 5 baris awal, lalu muat hingga 50 baris (batas limit API). */}
              <Button size="sm" variant="secondary" disabled={!preview?.truncated || previewLoading} onClick={() => void loadPreview(50)}>
                Muat {Math.max(0, Math.min(50, preview?.rowCount ?? 0) - (preview?.rows.length ?? 0))} baris berikutnya
              </Button>
            </div>
            {previewLoading && preview === null ? (
              <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : previewError ? (
              <div className="text-center">
                <p className="font-body text-body-md text-error">{previewError}</p>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => void loadPreview(limit)}>Coba lagi</Button>
              </div>
            ) : preview && preview.rows.length > 0 ? (
              <>
                <div className="max-h-[480px] overflow-y-auto rounded-md border border-outline-variant">
                  <DataTable columns={previewColumns} rows={preview.rows} stickyHeader />
                </div>
                <p className="mt-2 font-body text-body-sm text-on-surface-variant">
                  Menampilkan {formatNumber(preview.rows.length)} dari {formatNumber(preview.rowCount)} baris.
                </p>
              </>
            ) : (
              <EmptyState title="Tidak ada data untuk ditampilkan" />
            )}
          </div>
          )}
        </>
      ) : null}

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => !o && setDeleteOpen(false)}
        title={detail ? `Hapus “${detail.source.name}”?` : 'Hapus sumber?'}
        description="Tindakan ini tidak dapat dibatalkan. Riwayat percakapan dan laporan tetap tersimpan."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setDeleteOpen(false)}>Batal</Button>
          <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>Hapus</Button>
        </div>
      </Dialog>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
      <p className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-1 font-display text-metric-md font-bold tabular text-on-surface">{value}</p>
    </div>
  );
}
