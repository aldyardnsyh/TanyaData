'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { apiUrl } from '@/lib/ui/api-base';
import { formatNumber } from '@/lib/ui/format';
import { docGroupLabel, docGroupOf, listDocGroups, type DocGroup } from '@/lib/core/doc-taxonomy';
import { Icon } from '@/components/ui/icons';
import { SectionRule } from '@/components/signal/section-rule';
import { BentoGrid, type BentoItem } from '@/components/signal/bento-grid';
import { AnimatedTabs } from '@/components/signal/animated-tabs';
import { LayoutGrid, type RevealCard } from '@/components/signal/layout-grid';
import { Dropzone } from '@/components/signal/dropzone';
import { StatusBadge } from '@/components/signal/status-badge';
import type { DotTone } from '@/components/signal/status-dot';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { NO_DOCUMENTS_MESSAGE } from '@/components/ui/no-documents-empty';

// Pagination client-side: payload daftar sumber kecil (metadata), fetch semua
// tetap murah; grid dibatasi 9 kartu per halaman agar komposisi tetap rapi.
const SRC_PAGE_SIZE = 9;

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Data yang dikirim tidak valid.',
  NOT_FOUND: 'Sumber tidak ditemukan.',
  METHOD_NOT_ALLOWED: 'Metode tidak didukung.',
  CONFLICT: 'Sumber tidak dapat diubah pada kondisi saat ini.',
  FILE_TOO_LARGE: 'Ukuran file melebihi batas 25 MB.',
  UNSUPPORTED_MEDIA_TYPE: 'Format file tidak didukung.',
  UNPROCESSABLE_SOURCE: 'File tidak dapat diproses. Periksa format atau kolom wajibnya.',
  INTERNAL_ERROR: 'Terjadi kesalahan internal. Silakan coba lagi.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.',
  PUBLIC_DEPLOY_BLOCKED: 'Fitur ini tidak tersedia pada deployment publik tanpa autentikasi.',
};
const DATASET_EXTS = ['.csv', '.xlsx'];
const DOCUMENT_EXTS = ['.pdf', '.docx', '.txt', '.md'];
const MAX_BYTES = 25 * 1024 * 1024;
// Label jujur untuk metrik yang memang tidak tersedia. "Belum dihitung"
// menyiratkan ada proses tertunda, padahal field memang null karena tipe
// sumbernya (dokumen tidak punya baris, dataset tidak punya potongan teks).
const num = (v: number | null | undefined) => (v == null ? 'Tidak tersedia' : formatNumber(v));
const ROW_COUNT_REASON = 'Jumlah baris dihitung dari dataset yang terdaftar. Dokumen tidak memiliki baris data terstruktur, jadi tidak menyumbang angka.';
const CHUNK_COUNT_REASON = 'Jumlah potongan teks terindeks dari dokumen. Dataset tidak memiliki potongan teks.';

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

/* ADAPT-4a — pengelompokan dokumen per doc_group (registry tunggal).
   Datasets tampil sebagai grup tersendiri; dokumen dikelompokkan memakai
   doc_group dari API (aditif) dengan fallback docGroupOf(doc_type). Respons
   lama tanpa field baru tetap jatuh ke grup 'general', tidak pernah crash. */
type SourceItem = SourceListItem & { docGroup?: DocGroup; docType?: string };
const DATASET_BUCKET = '__dataset';
const GROUP_ICON: Record<DocGroup, string> = {
  finance: 'account_balance',
  sop: 'menu_book',
  technical: 'engineering',
  identity: 'badge',
  general: 'description',
};
function bucketOf(source: SourceItem): string {
  if (source.kind === 'dataset') return DATASET_BUCKET;
  return source.docGroup ?? docGroupOf(source.docType);
}

export default function DataSourcesPage() {
  const sources = useApi<SourcesListResponse>('/api/sources');
  const meta = useApi<MetaResponse>('/api/meta');

  const [filter, setFilter] = useState('all');
  const [srcPage, setSrcPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SourceListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewDetail, setPreviewDetail] = useState<SourceDetailResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLimit, setPreviewLimit] = useState(5);
  // Seleksi eksplisit: tepat satu kartu menjadi primary, sisanya secondary.
  // Dipegang di sini (bukan di dalam LayoutGrid) agar bisa di-reset saat
  // filter, halaman, atau sumber berubah.
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const items = (sources.data?.items ?? []) as SourceItem[];
  const counts = sources.data?.counts;
  const totalBytes = items.reduce((sum, s) => sum + (s.sizeBytes ?? 0), 0);
  const totalRows = items.reduce((sum, s) => sum + (s.rowCount ?? 0), 0);
  const totalChunks = items.reduce((sum, s) => sum + (s.chunkCount ?? 0), 0);
  const activeCount = items.filter((s) => s.status === 'READY').length;
  const datasetName = meta.data?.data.activeDataset.name;
  const ragLabel = meta.data?.capabilities.rag.toUpperCase() ?? 'FTS5';
  // Workspace kosong (SEED_PROFILE=none): tidak ada sumber sama sekali.
  // Dipakai untuk mengganti KPI/chart bernilai 0 dengan empty state jujur.
  const noDocuments = !sources.loading && !sources.error && items.length === 0;
  const scrollToUpload = () => document.getElementById('dropzone-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
  const pageItems = visible.slice((srcPage - 1) * SRC_PAGE_SIZE, srcPage * SRC_PAGE_SIZE);

  const processingSource = items.find((s) => s.status === 'PROCESSING' || s.status === 'UPLOADED');
  useEffect(() => {
    if (!processingSource) { setJob(null); return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(apiUrl(`/api/sources/${processingSource.id}`));
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
      const [detailRes, previewRes] = await Promise.all([fetch(apiUrl(`/api/sources/${id}`)), fetch(apiUrl(`/api/sources/${id}/preview?limit=${limit}`))]);
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

  // Pratinjau tidak pernah dimuat otomatis. User harus menekan "Pratinjau"
  // pada kartu sumber terlebih dahulu (F-03: state jujur, tanpa data diam-diam).
  const resetPreview = useCallback(() => {
    setPreviewId(null);
    setPreviewDetail(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setPreviewLimit(5);
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedSourceId(null);
    resetPreview();
  }, [resetPreview]);

  // Klik kartu = pilih sumber. Berpindah ke sumber lain mengosongkan pratinjau
  // lama supaya baris dari dokumen sebelumnya tidak ikut tampil.
  const selectSource = useCallback((id: string) => {
    if (id === selectedSourceId) return;
    resetPreview();
    setSelectedSourceId(id);
  }, [selectedSourceId, resetPreview]);

  // Klik "Pratinjau" = pilih kartu itu lalu muat pratinjau secara eksplisit.
  const previewSource = useCallback((id: string) => {
    if (id !== selectedSourceId) setSelectedSourceId(id);
    void loadPreview(id, 5);
  }, [selectedSourceId, loadPreview]);

  // Kembali dari halaman detail (atau restore dari router cache) mengembalikan
  // kartu ke ukuran awal: tidak ada kartu yang tetap membesar/aktif.
  useEffect(() => { resetSelection(); }, [resetSelection]);

  const upload = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (![...DATASET_EXTS, ...DOCUMENT_EXTS].includes(ext)) { toast({ status: 'error', message: ERROR_MESSAGES.UNSUPPORTED_MEDIA_TYPE }); return; }
    if (file.size > MAX_BYTES) { toast({ status: 'error', message: ERROR_MESSAGES.FILE_TOO_LARGE }); return; }
    setUploadName(file.name);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', DATASET_EXTS.includes(ext) ? 'dataset' : 'document');
      const res = await fetch(apiUrl('/api/sources'), { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(ERROR_MESSAGES[code] ?? body?.error?.message ?? 'Unggah gagal.');
      }
      toast({ status: 'success', message: 'File ditambahkan. Pemrosesan dimulai.' });
      resetSelection();
      sources.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Unggah gagal.' });
    } finally { setUploading(false); setUploadName(null); }
  }, [sources, resetSelection]);

  const reindex = async (source: SourceListItem) => {
    try {
      const res = await fetch(apiUrl(`/api/sources/${source.id}/reindex`), { method: 'POST' });
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
      const res = await fetch(apiUrl(`/api/sources/${deleteTarget.id}`), { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        const code = (body?.error?.code ?? 'INTERNAL_ERROR') as ApiErrorCode;
        throw new Error(code === 'CONFLICT' ? ERROR_MESSAGES.CONFLICT : ERROR_MESSAGES[code]);
      }
      toast({ status: 'success', message: 'Sumber dihapus.' });
      resetSelection();
      setDeleteTarget(null); sources.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Penghapusan gagal.' });
    } finally { setDeleting(false); }
  };

  const summaryItems: BentoItem[] = [
    { id: 'storage', label: 'Total penyimpanan', value: sources.loading ? '…' : `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`, source: `${num(counts?.dataset)} DATASET`, tooltip: 'Jumlah berkas dataset yang terdaftar di workspace ini.', span: 'support' },
    { id: 'docs', label: 'Dokumen terindeks', value: sources.loading ? '…' : num(counts?.document), source: `${num(totalChunks)} POTONGAN`, tooltip: CHUNK_COUNT_REASON, span: 'support' },
    { id: 'rows', label: 'Baris tersimpan', value: sources.loading ? '…' : num(totalRows), source: 'SQLITE · SQL', tooltip: ROW_COUNT_REASON, span: 'support' },
    { id: 'status', label: 'Status pemrosesan', value: (counts?.failed ?? 0) > 0 ? `${counts?.failed} perlu diperiksa` : 'Semua siap', source: 'SQLITE · FTS5', span: 'support' },
  ];

  // Pasangan metrik kecil di sisi kanan band — status ringkas dari API sumber.
  const bannerStats = [
    { id: 'docs', label: 'Dokumen terindeks', value: num(counts?.document) },
    { id: 'active', label: 'Sumber aktif', value: num(activeCount) },
    { id: 'processing', label: 'Sumber diproses', value: num(counts?.processing) },
  ];

  const cardFor = (source: SourceItem): RevealCard => {
    const previewed = previewId === source.id;
    return {
      id: source.id,
      title: source.name,
      meta: `${source.kind.toUpperCase()} · ${source.format.toUpperCase()} · ${formatBytes(source.sizeBytes)}`,
      selectedLabel: 'Dipilih',
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
            <Button asChild variant="secondary" size="sm">
              <Link href={`/data-sources/${source.id}`}>Buka detail</Link>
            </Button>
            <Button
              variant={previewed ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => previewSource(source.id)}
              aria-pressed={previewed}
            >
              {previewed && <span className="state-dot state-dot-active" aria-hidden="true" />}
              Pratinjau
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void reindex(source)}>
              Indeks ulang
            </Button>
            {source.id !== 'seed' && (
              <Button variant="danger" size="sm" onClick={() => setDeleteTarget(source)}>
                Hapus
              </Button>
            )}
          </div>
        </div>
      ),
    };
  };

  // Kelompok tampil per doc_group, urutan mengikuti registry (dataset dulu).
  const buckets = new Map<string, SourceItem[]>();
  for (const source of pageItems) {
    const key = bucketOf(source);
    const list = buckets.get(key) ?? [];
    list.push(source);
    buckets.set(key, list);
  }
  const groupOrder = [DATASET_BUCKET, ...listDocGroups().map((g) => g.id)].filter((key) => buckets.has(key));
  const groupHeading = (key: string): { label: string; icon: string } =>
    key === DATASET_BUCKET
      ? { label: 'Dataset', icon: 'table_chart' }
      : { label: docGroupLabel(key), icon: GROUP_ICON[key as DocGroup] ?? 'description' };

  const previewColumns = preview?.columns ?? [];
  const previewRows = preview?.rows ?? [];

  return (
    <>
      {/* Band gelap struktural: kepala halaman + status ringkas sumber + filter
          menyatu di satu band, idiom band Ringkasan (grid + glow lime). */}
      <section data-nav-theme="dark" aria-label="Ringkasan sumber data" className="relative overflow-hidden bg-forest text-porcelain">
        <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
        <div
          aria-hidden="true"
          className="glow-radial-lime absolute -right-24 -top-28 h-[320px] w-[440px] max-w-none"
        />
        <div className="page-container relative pb-s5 pt-s5">
          <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
            {datasetName ? `TanyaData · ${datasetName}` : 'TanyaData'}
          </p>
          <h1 className="mt-s2 font-display text-display text-porcelain">Sumber Data</h1>
          <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
            Kelola dataset dan dokumen yang menjadi dasar setiap jawaban.
          </p>

          <div className="mt-s5 grid items-end gap-s4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5">
              {sources.loading && (
                <div aria-busy="true" aria-label="Memuat status sumber">
                  <div className="animate-skeleton h-s5 w-40 rounded-control bg-porcelain/10" aria-hidden="true" />
                  <div className="animate-skeleton mt-s2 h-s6 w-56 rounded-control bg-porcelain/10" aria-hidden="true" />
                </div>
              )}
              {sources.error && (
                <div role="alert" className="flex flex-col items-start gap-s2">
                  <span className="inline-flex items-center gap-s2">
                    <span className="state-dot state-dot-error" aria-hidden="true" />
                    <span className="font-body text-body text-porcelain">Ringkasan sumber gagal dimuat.</span>
                  </span>
                  <Button variant="ghost" onClick={sources.retry} className="border border-hairline-dark text-porcelain hover:border-porcelain hover:bg-transparent">
                    Coba lagi
                  </Button>
                </div>
              )}
              {!sources.loading && !sources.error && (
                noDocuments ? (
                  <div className="flex flex-col items-start gap-s3">
                    <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                      Sumber terdaftar
                    </p>
                    <p className="max-w-[46ch] font-body text-body text-porcelain">{NO_DOCUMENTS_MESSAGE}</p>
                    <Button onClick={scrollToUpload} className="border border-lime bg-lime text-ink hover:bg-lime focus-ring-forest">
                      Unggah dokumen
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                      Sumber terdaftar
                    </p>
                    <p className="text-stat-lg text-lime text-glow-lime">{num(items.length)}</p>
                    <p className="mt-s2 font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">
                      SQLITE · SQL + {ragLabel}
                    </p>
                  </>
                )
              )}
            </div>
            {noDocuments ? (
              <p className="font-body text-caption text-dark-muted">Ringkasan muncul setelah berkas diunggah.</p>
            ) : (
              <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-3 lg:col-span-7">
                {bannerStats.map((item) => (
                  <div key={item.id} className="min-w-0">
                    <dt className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">{item.label}</dt>
                    <dd className="mt-s1 font-body text-metric tabular text-porcelain">
                      {sources.loading ? (
                        <span className="animate-skeleton inline-block h-s5 w-24 rounded-control bg-porcelain/10" aria-hidden="true" />
                      ) : sources.error ? (
                        '—'
                      ) : (
                        item.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="mt-s5 max-w-2xl">
            <AnimatedTabs
              tabs={tabs}
              activeId={filter}
              onChange={(id) => { setFilter(id); setSrcPage(1); resetSelection(); }}
              ariaLabel="Filter sumber data"
              tone="dark"
              state={sources.loading ? 'loading' : 'default'}
            />
          </div>
        </div>
      </section>

      {/* Zona kerja terang: panel unggah, ringkasan Bento, grid sumber, tabel validasi. */}
      <div className="page-container pb-s6" data-nav-theme="light">
        {/* Panel fokus gelap kedua: unggah. Dropzone existing di dalam band gelap
            rounded-card-lg (grid + glow diklip di lapisan dekorasi bersarang);
            petunjuk di atas gelap dibaca lewat override presentasi di wrapper. */}
        <section aria-labelledby="dropzone-heading" className="mt-s5">
          <div className="relative rounded-card-lg border border-hairline-dark bg-forest p-s3 shadow-float md:p-s4">
            <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-card-lg">
              <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
              <div aria-hidden="true" className="glow-radial-lime absolute -right-16 -top-20 h-[240px] w-[360px]" />
            </div>
            <div className="relative">
              <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
                <div>
                  <h2 id="dropzone-heading" className="font-display text-title text-porcelain">Unggah sumber</h2>
                  <p className="mt-s1 font-body text-caption text-dark-muted">Tarik berkas ke panel atau pilih dari perangkat; pemrosesan dimulai otomatis.</p>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">MAKS 25 MB · CSV XLSX PDF DOCX TXT MD</span>
              </div>
              <Dropzone
                onFiles={(files) => void upload(files)}
                busy={uploading}
                className="[--border-hairline:var(--hairline-dark)] [&_.text-ink]:text-porcelain [&_.text-ink-72]:text-dark-muted [&_.text-forest]:text-lime [&_.bg-forest-08]:bg-porcelain/10"
              />
              {(uploading || job) && (
                <div className="mt-s3 rounded-control border border-hairline-dark bg-porcelain/10 p-s3">
                  <div className="flex items-center justify-between gap-s2">
                    <span className="min-w-0 truncate font-body text-body text-porcelain">
                      {uploading ? `Mengunggah ${uploadName ?? 'berkas'}…` : job?.name}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">
                      {uploading ? 'MENGUNGGAH' : `${job?.step ?? 'MEMPROSES'} · ${job?.progress ?? 0}%`}
                    </span>
                  </div>
                  {uploading ? (
                    /* fetch tidak mengekspos progres unggah dan kontrak API tidak
                       punya endpoint progres upload: indeterminate, tanpa angka
                       palsu (F-02 / P5 "state jujur"). Progres determinate di bawah
                       berasal dari polling job nyata (GET /api/sources/:id). */
                    <div
                      className="mt-s2 h-s2 w-full overflow-hidden rounded-control bg-porcelain/10"
                      role="progressbar"
                      aria-label={`Mengunggah ${uploadName ?? 'berkas'}`}
                    >
                      <div className="animate-progress-indeterminate h-full w-1/3 rounded-control bg-lime" />
                    </div>
                  ) : (
                    <div
                      className="mt-s2 h-s2 w-full overflow-hidden rounded-control bg-porcelain/10"
                      role="progressbar"
                      aria-label={`Memproses ${job?.name ?? 'berkas'}`}
                      aria-valuenow={job?.progress ?? 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div className="h-full bg-lime transition-[width] duration-[var(--motion-slow)]" style={{ width: `${job?.progress ?? 0}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        <SectionRule className="mt-s5" />

        {/* Ringkasan sumber: Bento metrik pendukung. Saat workspace kosong,
            KPI tidak menampilkan 0 yang menyesatkan melainkan empty state. */}
        <section aria-label="Ringkasan sumber" className="mt-s5">
          <BentoGrid
            items={summaryItems}
            state={sources.loading ? 'loading' : sources.error ? 'error' : noDocuments ? 'empty' : 'default'}
            emptyTitle={NO_DOCUMENTS_MESSAGE}
            emptyAction={noDocuments ? { label: 'Unggah dokumen', onClick: scrollToUpload } : undefined}
            errorTitle="Ringkasan gagal dimuat."
            onRetry={sources.retry}
          />
        </section>

        <SectionRule className="mt-s5" />

        {/* Sumber terdaftar: reveal grid dengan hover lift bawaan LayoutGrid. */}
        <section aria-labelledby="sumber-heading" className="mt-s5">
          <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
            <div>
              <h2 id="sumber-heading" className="font-display text-title text-ink">Sumber terdaftar</h2>
              <p className="mt-s1 font-body text-caption text-ink-72">Filter di kepala band; pilih sumber untuk pratinjau, indeks ulang, atau penghapusan.</p>
            </div>
            <span className="mono-meta">{visible.length} SUMBER</span>
          </div>
          <SectionRule className="mb-s4" />
          {/* Loading / error / empty daftar tetap ditangani satu grid state;
              saat ada isi, kartu dikelompokkan per doc_group (ADAPT-4a). */}
          {sources.loading || sources.error || visible.length === 0 ? (
            <LayoutGrid
              cards={[]}
              selectedId={selectedSourceId}
              onSelect={selectSource}
              state={sources.loading ? 'loading' : sources.error ? 'error' : 'empty'}
              emptyTitle={items.length === 0 ? NO_DOCUMENTS_MESSAGE : 'Belum ada sumber pada filter ini. Unggah berkas untuk menambah sumber.'}
              emptyAction={{ label: 'Unggah dokumen', onClick: scrollToUpload }}
              errorTitle="Daftar sumber gagal dimuat."
              onRetry={sources.retry}
            />
          ) : (
            groupOrder.map((key) => {
              const groupItems = buckets.get(key) ?? [];
              const heading = groupHeading(key);
              return (
                <div key={key} className="mb-s5 last:mb-0">
                  <div className="mb-s2 flex items-center gap-s2">
                    <Icon name={heading.icon} className="text-[18px] text-forest" aria-hidden="true" />
                    <h3 className="font-display text-label font-semibold text-ink">{heading.label}</h3>
                    <span className="mono-meta">{groupItems.length} SUMBER</span>
                  </div>
                  <LayoutGrid
                    cards={groupItems.map(cardFor)}
                    selectedId={selectedSourceId}
                    onSelect={selectSource}
                    state="default"
                  />
                </div>
              );
            })
          )}
          <div className="mt-s3">
            <Pagination page={srcPage} pageSize={SRC_PAGE_SIZE} total={visible.length} onPage={(page) => { setSrcPage(page); resetSelection(); }} label="sumber" />
          </div>
        </section>

        <SectionRule className="mt-s5" />

        {/* Tabel validasi / pratinjau: data-table existing dalam kartu rounded-card-lg. */}
        <section aria-labelledby="validasi-heading" className="mt-s5">
          <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
            <div>
              <h2 id="validasi-heading" className="font-display text-title text-ink">Pratinjau validasi</h2>
              <p className="mt-s1 font-body text-caption text-ink-72">Baris pertama dari sumber yang dipilih. Angka berasal dari berkas asli.</p>
            </div>
            {previewDetail && <span className="mono-meta">{previewDetail.source.name.toUpperCase()} · {num(preview?.rowCount)} BARIS</span>}
          </div>
          <SectionRule className="mb-s4" />
          {previewLoading ? (
            <div className="skeleton h-40 w-full rounded-card-lg" aria-busy="true" />
          ) : previewError ? (
            <div className="flex flex-col items-start gap-s2 surface rounded-card-lg p-s4" role="alert">
              <span className="inline-flex items-center gap-s2"><StatusBadge label="Gagal" tone="error" /><span className="font-body text-body text-ink">{previewError}</span></span>
              {previewId && <Button variant="secondary" onClick={() => void loadPreview(previewId, previewLimit)}>Coba lagi</Button>}
            </div>
          ) : !previewDetail ? (
            <div className="surface flex items-center gap-s2 rounded-card-lg p-s4"><StatusBadge label="Belum ada pratinjau" tone="neutral" /><span className="font-body text-body text-ink-72">{noDocuments ? NO_DOCUMENTS_MESSAGE : 'Pilih sumber, lalu klik Pratinjau pada kartunya untuk melihat baris data.'}</span></div>
          ) : previewRows.length === 0 ? (
            <div className="surface flex items-center gap-s2 rounded-card-lg p-s4"><StatusBadge label="Kosong" tone="neutral" /><span className="font-body text-body text-ink-72">Tidak ada baris untuk ditampilkan.</span></div>
          ) : (
            <div className="surface overflow-hidden rounded-card-lg">
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
                  <Button variant="secondary" disabled={!preview?.truncated || previewLoading} onClick={() => previewId && void loadPreview(previewId, 50)}>Muat 50 baris</Button>
                  <Button asChild variant="primary"><Link href="/assistant">Tanya data ini</Link></Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-s3">
          <div className="animate-backdrop-in absolute inset-0 bg-ink/40" onClick={() => setDeleteTarget(null)} aria-hidden="true" />
          <div className="animate-modal-in elevated relative w-full max-w-[480px] rounded-overlay border border-[var(--border-hairline)] bg-porcelain p-s4" role="dialog" aria-modal="true" aria-label="Hapus sumber">
            <h2 className="font-display text-title text-ink">Hapus “{deleteTarget.name}”?</h2>
            <p className="mt-s2 font-body text-body text-ink-72">Tindakan ini tidak dapat dibatalkan. Riwayat percakapan dan laporan tetap tersimpan.</p>
            <div className="mt-s4 flex justify-end gap-s2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                Batal
              </Button>
              <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
                {deleting ? 'Menghapus' : 'Hapus'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
