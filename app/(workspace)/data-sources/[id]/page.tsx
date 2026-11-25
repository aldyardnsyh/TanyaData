'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ApiErrorCode, CitationChunkResponse, Investigation, InvestigateResponse, PreviewResponse, SourceAnalyticsResponse, SourceDetailResponse, SourceSummaryResponse } from '@/lib/contracts/http';
import { parseCiteParam } from '@/lib/ui/citation-target';
import { apiUrl } from '@/lib/ui/api-base';
import { formatNumber } from '@/lib/ui/format';
import { docGroupOf, normalizeDocType } from '@/lib/core/doc-taxonomy';
import { Icon } from '@/components/ui/icons';
import { IconTooltip } from '@/components/ui/icon-tooltip';
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
  RATE_LIMITED: 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.',
  PUBLIC_DEPLOY_BLOCKED: 'Fitur ini tidak tersedia pada deployment publik tanpa autentikasi.',
};
// "Belum dihitung" menyiratkan proses yang tertunda. Field memang null bila
// tipe sumbernya tidak memiliki metrik itu, jadi labelnya harus jujur.
const num = (v: number | null | undefined) => (v == null ? 'Tidak tersedia' : formatNumber(v));
const ROW_COUNT_REASON = 'Jumlah baris hanya tersedia untuk dataset. Dokumen tidak memiliki baris data terstruktur.';
const CHUNK_COUNT_REASON = 'Jumlah potongan teks hanya tersedia untuk dokumen terindeks. Dataset tidak memiliki potongan teks.';
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
  // D2: ringkasan deterministik per dokumen (dari chunk terindeks).
  const [summary, setSummary] = useState<SourceSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  // Analytics per dokumen: tipe + metrik + insight, deterministik dari chunk.
  const [analytics, setAnalytics] = useState<SourceAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  // Investigasi per sumber (dataset): analisis mendalam dari detail sumber ini.
  const [invQuestion, setInvQuestion] = useState('Mengapa tingkat kegagalan transaksi meningkat?');
  const [invRunning, setInvRunning] = useState(false);
  const [invResult, setInvResult] = useState<Investigation | null>(null);
  const [invError, setInvError] = useState<string | null>(null);
  const [invSaving, setInvSaving] = useState(false);
  const [invSavedId, setInvSavedId] = useState<string | null>(null);

  // Bukti sitasi (deep-link dari chat): ?cite=chunk=..&page=..&section=..
  // → tampilkan chunk yang dirujuk, ter-highlight, auto-scroll ke sana.
  const router = useRouter();
  const searchParams = useSearchParams();
  const cite = parseCiteParam(searchParams.get('cite'));
  const [citeChunk, setCiteChunk] = useState<CitationChunkResponse['chunk'] | null>(null);
  const [citeError, setCiteError] = useState<string | null>(null);
  const citeRef = useRef<HTMLDivElement>(null);
  const citeActive = Boolean(cite.chunk || cite.page || cite.section);

  useEffect(() => {
    if (!detail || detail.source.kind !== 'document' || !citeActive) { setCiteChunk(null); setCiteError(null); return; }
    let cancelled = false;
    const params = new URLSearchParams();
    if (cite.chunk != null) params.set('chunk', String(cite.chunk));
    if (cite.page != null) params.set('page', String(cite.page));
    if (cite.section) params.set('section', cite.section);
    fetch(apiUrl(`/api/sources/${id}/chunk?${params.toString()}`))
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? 'Potongan sitasi tidak ditemukan.');
        return r.json() as Promise<CitationChunkResponse>;
      })
      .then((json) => { if (!cancelled) { setCiteChunk(json.chunk); setCiteError(null); } })
      .catch((err: unknown) => { if (!cancelled) { setCiteChunk(null); setCiteError(err instanceof Error ? err.message : 'Potongan sitasi gagal dimuat.'); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.source.id, id, searchParams]);

  useEffect(() => {
    if (citeChunk) citeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [citeChunk]);

  useEffect(() => {
    if (detail?.source.kind !== 'document') { setSummary(null); return; }
    let cancelled = false;
    setSummaryLoading(true);
    fetch(apiUrl(`/api/sources/${id}/summary`))
      .then((r) => (r.ok ? r.json() : null))
      .then((json: SourceSummaryResponse | null) => { if (!cancelled) setSummary(json); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    setAnalyticsLoading(true);
    fetch(apiUrl(`/api/sources/${id}/analytics`))
      .then((r) => (r.ok ? r.json() : null))
      .then((json: SourceAnalyticsResponse | null) => { if (!cancelled) setAnalytics(json); })
      .catch(() => { if (!cancelled) setAnalytics(null); })
      .finally(() => { if (!cancelled) setAnalyticsLoading(false); });
    return () => { cancelled = true; };
  }, [detail?.source.kind, id]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNotFound(false);
    try {
      const res = await fetch(apiUrl(`/api/sources/${id}`));
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
      const res = await fetch(apiUrl(`/api/sources/${id}/preview?limit=${lim}`));
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
      const res = await fetch(apiUrl(`/api/sources/${id}/reindex`), { method: 'POST' });
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

  /** Investigasi per sumber: jalankan analisis (persist=false) atau simpan dossier (persist=true). */
  const runInvestigation = async (persist: boolean) => {
    const q = invQuestion.trim();
    if (q.length < 3) { toast({ status: 'error', message: 'Pertanyaan minimal 3 karakter.' }); return; }
    if (persist) {
      if (!invResult || invSaving || invSavedId) return;
      setInvSaving(true);
    } else {
      setInvRunning(true);
      setInvResult(null);
      setInvError(null);
      setInvSavedId(null);
    }
    try {
      const res = await fetch(apiUrl('/api/investigations/analyze'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, dataset: id, persist, lang: 'id' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: InvestigateResponse = await res.json();
      setInvResult(json.investigation);
      if (persist) {
        setInvSavedId(json.investigation.id);
        toast({ status: 'success', message: 'Investigasi disimpan.', action: 'Buka', onAction: () => { window.location.href = `/investigations/${json.investigation.id}`; } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analisis gagal.';
      setInvError(message);
      if (persist) toast({ status: 'error', message });
    } finally {
      setInvRunning(false);
      setInvSaving(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/sources/${id}`), { method: 'DELETE' });
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
  const isDataset = detail !== null && 'schema' in detail;
  const previewColumns = preview?.columns ?? [];
  const previewRows = preview?.rows ?? [];

  // Pasangan metrik kecil di sisi kanan band — dari detail sumber yang sudah ada.
  const bannerStats = [
    { id: 'rows', label: 'Baris tersimpan', value: detail ? num(detail.source.rowCount) : '—', reason: ROW_COUNT_REASON },
    { id: 'chunks', label: 'Potongan terindeks', value: detail ? num(detail.source.chunkCount) : '—', reason: CHUNK_COUNT_REASON },
    { id: 'size', label: 'Ukuran berkas', value: detail ? formatBytes(detail.source.sizeBytes) : '—', reason: undefined },
  ];

  const summaryItems: BentoItem[] = detail ? [
    { id: 'rows', label: 'Baris tersimpan', value: num(detail.source.rowCount), source: detail.source.format.toUpperCase(), tooltip: ROW_COUNT_REASON, span: 'support' },
    { id: 'detail', label: isDocument ? 'Potongan terindeks' : 'Kolom', value: num(isDocument ? detail.source.chunkCount : 'schema' in detail ? detail.schema?.columns.length : null), source: isDocument ? `${num(detail.source.pageCount)} HALAMAN` : 'schema' in detail ? detail.schema?.tableName ?? '—' : '—', tooltip: isDocument ? CHUNK_COUNT_REASON : undefined, span: 'support' },
    { id: 'size', label: 'Ukuran penyimpanan', value: formatBytes(detail.source.sizeBytes), source: 'SUMBER', span: 'support' },
    { id: 'status', label: 'Status', value: statusLabel(detail.source.status), source: 'SQLITE · FTS5', span: 'support' },
  ] : [];

  return (
    <>
      {/* Band gelap struktural: kepala halaman + status ringkas sumber + aksi,
          idiom band Ringkasan (grid + glow lime). */}
      <section data-nav-theme="dark" aria-label="Detail sumber data" className="relative overflow-hidden bg-forest text-porcelain">
        <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
        <div
          aria-hidden="true"
          className="glow-radial-lime absolute -right-24 -top-28 h-[320px] w-[440px] max-w-none"
        />
        <div className="page-container relative pb-s5 pt-s5">
          <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
            TanyaData · Sumber Data
          </p>
          {loading ? (
            <div aria-busy="true" aria-label="Memuat detail sumber">
              <div className="animate-skeleton mt-s2 h-s6 w-72 rounded-control bg-porcelain/10" aria-hidden="true" />
              <div className="animate-skeleton mt-s2 h-s3 w-56 rounded-control bg-porcelain/10" aria-hidden="true" />
            </div>
          ) : (
            <>
              <h1 className="mt-s2 font-display text-display text-porcelain">{detail?.source.name ?? (notFound ? 'Sumber tidak ditemukan' : 'Sumber')}</h1>
              <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
                Periksa skema, kualitas data, dan konten terindeks dari sumber ini.
              </p>
            </>
          )}

          <div className="mt-s5 grid items-end gap-s4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5">
              {error && (
                <div role="alert" className="flex flex-col items-start gap-s2">
                  <span className="inline-flex items-center gap-s2">
                    <span className="state-dot state-dot-error" aria-hidden="true" />
                    <span className="font-body text-body text-porcelain">{error}</span>
                  </span>
                  <button type="button" onClick={() => void load()} className="touch-44 rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain hover:border-porcelain focus-ring">
                    Coba lagi
                  </button>
                </div>
              )}
              {!error && detail && (
                <>
                  <StatusBadge
                    label={statusLabel(detail.source.status)}
                    tone={statusTone(detail.source.status)}
                    className="[--border-hairline:var(--hairline-dark)] [&_.text-ink]:text-porcelain"
                  />
                  <p className="mt-s2 font-mono text-[11px] uppercase tracking-[0.06em] text-dark-muted">
                    {detail.source.kind.toUpperCase()} · {detail.source.format.toUpperCase()}
                  </p>
                </>
              )}
              {!error && !detail && !loading && (
                <p className="font-body text-body text-dark-muted">Sumber ini mungkin sudah dihapus.</p>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-3 lg:col-span-7">
              {bannerStats.map((item) => (
                <div key={item.id} className="min-w-0">
                  <dt className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                    {item.reason && item.value === 'Tidak tersedia' ? (
                      <IconTooltip label={item.reason}>
                        <span tabIndex={0} className="inline-flex items-center focus-ring">{item.label}</span>
                      </IconTooltip>
                    ) : item.label}
                  </dt>
                  <dd className="mt-s1 font-body text-metric tabular text-porcelain">
                    {loading ? (
                      <span className="animate-skeleton inline-block h-s5 w-24 rounded-control bg-porcelain/10" aria-hidden="true" />
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-s5 flex flex-wrap items-center gap-s2">
            <Link href="/data-sources" className="touch-44 inline-flex items-center gap-s2 rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain transition-colors hover:border-porcelain focus-ring"><Icon name="arrow_back" className="text-[16px]" /> Kembali</Link>
            <button type="button" onClick={() => void reindex()} disabled={!detail || loading} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain transition-colors hover:border-porcelain focus-ring disabled:opacity-50"><Icon name="refresh" className="text-[16px]" /> Indeks ulang</button>
            {detail && id !== 'seed' && <button type="button" onClick={() => setDeleteOpen(true)} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-terracotta px-s3 font-display text-label font-semibold text-porcelain focus-ring"><Icon name="delete" className="text-[16px]" /> Hapus</button>}
          </div>
        </div>
      </section>

      {/* Zona kerja terang: metadata Bento, pratinjau, skema/kualitas. */}
      <div className="page-container pb-s6" data-nav-theme="light">
        {notFound ? (
          <div className="surface flex flex-col items-start gap-s2 rounded-card-lg p-s4 mt-s5">
            <StatusBadge label="Tidak ditemukan" tone="error" />
            <p className="font-body text-body text-ink">Sumber ini mungkin sudah dihapus.</p>
            <Link href="/data-sources" className="touch-44 inline-flex items-center rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring">Kembali ke Sumber Data</Link>
          </div>
        ) : loading ? (
          <div className="space-y-s4 mt-s5" aria-busy="true"><div className="bento">{[0, 1, 2, 3].map((i) => <div key={i} data-cell data-span="support" className="surface p-s3"><div className="skeleton h-s2 w-2/3" /><div className="skeleton mt-s3 h-s5 w-1/2" /></div>)}</div><div className="skeleton h-64 w-full rounded-card-lg" /></div>
        ) : error ? (
          <div className="flex flex-col items-start gap-s2 surface rounded-card-lg p-s4 mt-s5" role="alert">
            <span className="inline-flex items-center gap-s2"><StatusBadge label="Gagal" tone="error" /><span className="font-body text-body text-ink">{error}</span></span>
            <button type="button" onClick={() => void load()} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
          </div>
        ) : detail ? (
          <>
            {/* Bukti sitasi: potongan yang dirujuk dari jawaban chat,
                di-highlight dan di-scroll ke tempatnya. */}
            {citeActive && (
              <div ref={citeRef} role="region" aria-label="Bukti sitasi" className="mt-s5 rounded-card-lg border-2 border-lime bg-forest-08 p-s4 shadow-float">
                <div className="flex items-center justify-between gap-s2">
                  <span className="mono-meta inline-flex items-center gap-s1 text-forest"><Icon name="fact_check" className="text-[14px]" /> BUKTI SITASI</span>
                  <button type="button" onClick={() => router.replace(`/data-sources/${id}`)} aria-label="Tutup bukti sitasi" className="touch-44 flex items-center justify-center rounded-control text-ink-72 transition-colors hover:text-ink focus-ring"><Icon name="close" className="text-[18px]" /></button>
                </div>
                {(citeChunk?.section || citeChunk?.page != null) && (
                  <div className="mt-s2 flex flex-wrap gap-s3">
                    {citeChunk?.section && <span className="mono-meta">BAGIAN · {citeChunk.section}</span>}
                    {citeChunk?.page != null && <span className="mono-meta">HALAMAN · {citeChunk.page}</span>}
                  </div>
                )}
                {citeError && <p className="mt-s2 font-body text-caption text-terracotta" role="alert">{citeError}</p>}
                {citeChunk ? (
                  <blockquote className="mt-s2 border-l-2 border-lime pl-s3 font-body text-body leading-relaxed text-ink">{citeChunk.content}</blockquote>
                ) : !citeError && <div className="skeleton mt-s3 h-24 w-full" />}
              </div>
            )}

            <section aria-label="Metadata sumber" className="mt-s5"><BentoGrid items={summaryItems} /></section>

            <SectionRule className="mt-s5" />

            {/* D2 — Ringkasan dokumen: struktur deterministik dari chunk
                terindeks (tanpa LLM), dengan CTA tanya-dokumen-ini (FR-C). */}
            {isDocument && (
              <section aria-labelledby="summary-heading" className="mt-s5">
                <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
                  <div>
                    <h2 id="summary-heading" className="font-display text-title text-ink">Ringkasan dokumen</h2>
                    <p className="mt-s1 font-body text-caption text-ink-72">
                      Struktur dan isi per bagian, dari chunk yang terindeks — bukan parafrasa model.
                    </p>
                  </div>
                  <Link
                    href={`/assistant?attach=${id}&source=${encodeURIComponent(detail.source.name)}`}
                    className="touch-44 inline-flex items-center gap-s2 rounded-chip bg-lime px-s3 font-display text-label font-semibold text-ink transition-transform hover:scale-[1.02] focus-ring-forest motion-reduce:transform-none"
                  >
                    Tanya dokumen ini
                    <Icon name="arrow_forward" className="text-[16px]" />
                  </Link>
                </div>
                <SectionRule className="mb-s4" />
                {/* Analytics per dokumen: tipe, metrik sesuai tipe, chart, dan
                    insight deterministik — siap demo tanpa membuka chat. */}
                {analyticsLoading && (
                  <div className="mb-s4 grid gap-s3 md:grid-cols-4" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-s6 w-full rounded-card-lg" />)}
                  </div>
                )}
                {!analyticsLoading && analytics && (
                  <div className="mb-s4 flex flex-col gap-s3">
                    {/* Klasifikasi tipe + sinyal. */}
                    <div className="flex flex-wrap items-center gap-s2">
                      <StatusBadge label={analytics.docTypeLabel} tone={docGroupOf(analytics.docType) === 'general' ? 'neutral' : 'active'} />
                      <span className="mono-meta">{Math.round(analytics.confidence * 100)}% KEYAKINAN</span>
                      {analytics.signals.slice(0, 4).map((s) => <span key={s} className="rounded-chip border border-[var(--border-hairline)] px-s2 py-s1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-72">{s}</span>)}
                    </div>
                    {/* Stat tiles. */}
                    <div className="grid gap-s3 sm:grid-cols-2 lg:grid-cols-4">
                      {([
                        ['BAGIAN', analytics.totals.sections],
                        ['CHUNK', analytics.totals.chunks],
                        ['HALAMAN', analytics.totals.pages ?? '—'],
                        ['KATA', analytics.totals.words],
                      ] as const).map(([label, value]) => (
                        <div key={label} className="surface rounded-card-lg p-s3">
                          <span className="mono-meta">{label}</span>
                          <p className="mt-s1 font-body text-metric tabular text-ink">{num(typeof value === 'number' ? value : null)}</p>
                        </div>
                      ))}
                    </div>
                    {/* Chart entitas: bar horizontal dengan bagian teratas. */}
                      {(() => {
                        // ADAPT-4a: nilai docType analytics masih alias legacy
                        // (financial-report / incident-report); normalisasi ke
                        // id kanonik registry sebelum dicabangkan.
                        const canonical = normalizeDocType(analytics.docType);
                        const raw = canonical === 'financial'
                          ? { title: 'Nominal & persentase', items: [...analytics.entities.amounts.slice(0, 5), ...analytics.entities.percentages.slice(0, 5)] }
                          : canonical === 'technical_report'
                            ? { title: 'Istilah kegagalan & kanal', items: [...analytics.entities.failureCodes.slice(0, 5), ...analytics.entities.channels.slice(0, 4)] }
                            : { title: 'Istilah dominan', items: analytics.entities.failureCodes.slice(0, 6) };
                      const byLabel = new Map<string, (typeof raw.items)[number]>();
                      for (const item of raw.items) {
                        const prior = byLabel.get(item.label);
                        if (!prior || item.count > prior.count) byLabel.set(item.label, item);
                      }
                      const chart = {
                        title: raw.title,
                        items: [...byLabel.values()].sort((a, b) => b.count - a.count),
                      };
                      const max = Math.max(1, ...chart.items.map((i) => i.count));
                      return chart.items.length > 0 && (
                        <div className="surface rounded-card-lg p-s3">
                          <span className="mono-meta">{chart.title.toUpperCase()}</span>
                          <div className="mt-s2 space-y-s2">
                            {chart.items.map((item) => (
                              <div key={item.label}>
                                <div className="mb-s1 flex items-center justify-between gap-s2 font-body text-caption">
                                  <span className="min-w-0 truncate text-ink">{item.label}</span>
                                  <span className="shrink-0 tabular text-ink-72">{item.count}×</span>
                                </div>
                                <div className="h-s2 w-full overflow-hidden rounded-control bg-forest-08">
                                  <div className="h-full bg-forest" style={{ width: `${Math.max(3, (item.count / max) * 100)}%` }} />
                                </div>
                                {item.topSection && <p className="mt-s1 font-body text-caption text-ink-72">Terbanyak di "{item.topSection}"{item.topPage != null ? ` · hlm ${item.topPage}` : ''}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Insight: pernyataan dari angka yang dihitung, bukan parafrasa. */}
                    <div className="surface rounded-card-lg p-s3">
                      <span className="mono-meta">INSIGHT</span>
                      <ul className="mt-s2 space-y-s2">
                        {analytics.insights.map((insight, i) => (
                          <li key={i} className="flex items-start gap-s2 font-body text-caption leading-relaxed text-ink">
                            <span className="mt-1 h-s2 w-s2 shrink-0 rounded-full bg-lime" aria-hidden="true" />{insight}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {summaryLoading && (
                  <div className="grid gap-s3" aria-busy="true">
                    <div className="skeleton h-s4 w-1/2" />
                    <div className="skeleton h-s4 w-3/4" />
                  </div>
                )}
                {!summaryLoading && summary && (
                  <>
                    <p className="mono-meta mb-s3">
                      {summary.totals.sections} BAGIAN · {summary.totals.chunks} CHUNK
                      {summary.totals.ocrSkipped > 0 ? ` · ${summary.totals.ocrSkipped} HALAMAN TANDAI OCR` : ''}
                    </p>
                    <div className="grid gap-s3 md:grid-cols-2">
                      {summary.sections.map((section) => (
                        <article key={section.title + String(section.page)} className="surface flex min-w-0 flex-col gap-s1 rounded-card-lg p-s3">
                          <div className="flex items-baseline justify-between gap-s2">
                            <h3 className="min-w-0 truncate font-display text-label font-semibold text-ink">{section.title}</h3>
                            {section.page !== null && <span className="mono-meta shrink-0">HAL {section.page}</span>}
                          </div>
                          <p className="break-words font-body text-caption leading-relaxed text-ink-72">{section.excerpt}</p>
                          <span className="mono-meta break-words">{section.chunkCount} CHUNK</span>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}

            <SectionRule className="mt-s5" />

            <section aria-labelledby="preview-heading" className="mt-s5">
              <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
                <div>
                  <h2 id="preview-heading" className="font-display text-title text-ink">Pratinjau data</h2>
                  <p className="mt-s1 font-body text-caption text-ink-72">Baris pertama dari sumber ini. Angka berasal dari berkas asli.</p>
                </div>
                <span className="mono-meta">{num(preview?.rowCount)} BARIS</span>
              </div>
              <SectionRule className="mb-s4" />
              <div className="surface overflow-hidden rounded-card-lg">
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
              <>
                <SectionRule className="mt-s5" />
                <div className="grid-dashboard mt-s5">
                  <section className="surface col-span-4 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none xl:col-span-6">
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
                  <section className="surface col-span-4 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none xl:col-span-6">
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
              </>
            )}
            {/* Investigasi per sumber (dataset): paralel ringkasan per dokumen —
                analisis mendalam dijalankan DARI sumbernya, hasil jadi dossier. */}
            {isDataset && (
              <>
                <SectionRule className="mt-s5" />
                <section aria-labelledby="investigasi-heading" className="surface mt-s5 p-s4">
                  <div className="mb-s3 flex flex-wrap items-end justify-between gap-s2">
                    <div>
                      <h2 id="investigasi-heading" className="font-display text-title text-ink">Investigasi</h2>
                      <p className="mt-s1 font-body text-caption text-ink-72">
                        Analisis mendalam atas sumber ini: apa yang berubah, faktor penyebabnya, dan seberapa jauh buktinya.
                      </p>
                    </div>
                    <Link href="/investigations" className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring">
                      Dossier tersimpan <Icon name="arrow_forward" className="text-[16px]" />
                    </Link>
                  </div>
                  <SectionRule className="mb-s3" />
                  <label className="flex flex-col gap-s1">
                    <span className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-ink-72">Pertanyaan investigasi</span>
                    <input type="text" value={invQuestion} onChange={(e) => setInvQuestion(e.target.value)} className="min-h-11 w-full rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink focus-ring" />
                  </label>
                  <div className="mt-s3 flex flex-wrap justify-end gap-s2">
                    <button type="button" disabled={invRunning || invSaving} onClick={() => void runInvestigation(false)} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring disabled:opacity-50">
                      <Icon name="query_stats" className="text-[16px]" /> {invRunning ? 'Menganalisis' : 'Jalankan analisis'}
                    </button>
                    <button type="button" disabled={!invResult || invRunning || invSaving || !!invSavedId} onClick={() => void runInvestigation(true)} className="touch-44 inline-flex items-center gap-s2 rounded-control bg-forest px-s3 font-display text-label font-semibold text-porcelain focus-ring disabled:opacity-50">
                      {invSavedId ? 'Tersimpan' : invSaving ? 'Menyimpan' : 'Simpan investigasi'}
                    </button>
                  </div>
                  {invError && <p role="alert" className="mt-s3 font-body text-caption text-terracotta">{invError}</p>}
                  {invRunning && <div className="mt-s3 skeleton h-24 w-full" aria-busy="true" />}
                  {!invRunning && invResult && (
                    <div className="mt-s3 grid gap-s3 border-t border-[var(--border-hairline)] pt-s3 md:grid-cols-3">
                      <div>
                        <span className="mono-meta">TINGKAT KLAIM</span>
                        <p className="mt-s1 font-body text-body font-semibold text-ink">
                          {invResult.conclusion.claimLevel === 'proven' ? 'Terbukti' : invResult.conclusion.claimLevel === 'measured' ? 'Terukur' : 'Indikasi'}
                        </p>
                        <p className="mt-s1 font-body text-caption text-ink-72">
                          Kanal dominan: {invResult.contribution.channels[0]?.channelName ?? '—'}
                          {invResult.contribution.channels[0] ? ` (+${invResult.contribution.channels[0].excessFailures} gagal)` : ''}
                        </p>
                      </div>
                      <div className="md:col-span-2">
                        <span className="mono-meta">KESIMPULAN</span>
                        <p className="mt-s1 font-body text-caption leading-relaxed text-ink">{invResult.conclusion.text}</p>
                        {invResult.evidence.sql.length > 0 && <p className="mt-s1 mono-meta">{invResult.evidence.sql.length} QUERY SQL · {invResult.documents.length} BUKTI DOKUMEN</p>}
                      </div>
                    </div>
                  )}
                  {!invRunning && invSavedId && (
                    <p className="mt-s3">
                      <Link href={`/investigations/${invSavedId}`} className="inline-flex items-center gap-s1 font-display text-label font-semibold text-forest focus-ring">Buka dossier <Icon name="arrow_forward" className="text-[14px]" /></Link>
                    </p>
                  )}
                </section>
              </>
            )}
            {'sections' in detail && (
              <>
                <SectionRule className="mt-s5" />
                <section className="surface mt-s5 p-s4 transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none">
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
              </>
            )}
          </>
        ) : null}
      </div>

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
    </>
  );
}
