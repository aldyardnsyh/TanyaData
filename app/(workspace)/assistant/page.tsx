'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummary,
  DatasetSourceDetail,
  MetaResponse,
  ReportCreateResponse,
  SendMessageResponse,
  SettingsResponse,
  SourceCitation,
  SourcesListResponse,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { normalizeChatOutputs } from '@/lib/ui/adaptive-output';
import { Icon } from '@/components/ui/icons';
import { SectionRule } from '@/components/signal/section-rule';
import { StatusDot } from '@/components/signal/status-dot';
import { TextGenerate } from '@/components/signal/text-generate';
import { AdaptiveOutputView } from '@/components/signal/adaptive-output';
import { CitationMarks } from '@/components/signal/citation-marks';
import { AnimatedModal } from '@/components/signal/animated-modal';
import { GlowingCTA } from '@/components/signal/glowing-cta';
import { toast } from '@/components/ui/toaster';

const SUGGESTED = [
  'Berapa total transaksi bulan ini?',
  'Bagaimana distribusi status transaksi?',
  'Mengapa tingkat kegagalan transaksi meningkat?',
  'Prosedur apa yang berlaku saat transaksi gagal?',
];

function wibTime(iso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)).replace(':', '.');
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-s2" role="status" aria-live="polite">
      <span className="inline-flex gap-s1" aria-hidden="true">
        {[0, 1, 2].map((i) => <span key={i} className="animate-typing-dot state-dot" style={{ animationDelay: `${i * 120}ms` }} />)}
      </span>
      <span className="font-body text-caption text-ink-72">Menyusun jawaban</span>
    </span>
  );
}

export default function AssistantPage() {
  const { lang } = useI18n();
  const list = useApi<ConversationListResponse>('/api/conversations?limit=50');
  const meta = useApi<MetaResponse>('/api/meta');
  const settings = useApi<SettingsResponse>('/api/settings');
  const docs = useApi<SourcesListResponse>('/api/sources?kind=document&status=READY');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceDetail, setSourceDetail] = useState<SourceCitation | null>(null);
  const [shareTarget, setShareTarget] = useState<ChatMessage | null>(null);
  const [shareState, setShareState] = useState<'default' | 'loading' | 'error' | 'success'>('default');
  const [shareError, setShareError] = useState<string | null>(null);
  const [includeCitations, setIncludeCitations] = useState(true);
  const [includeIdentity, setIncludeIdentity] = useState(true);
  const [savingReportId, setSavingReportId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [schema, setSchema] = useState<DatasetSourceDetail | null>(null);
  const [periodOverride, setPeriodOverride] = useState<{ start: string; end: string } | null>(null);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [contextMenu, setContextMenu] = useState<'dataset' | 'date' | 'source' | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const autoSubmittedRef = useRef(false);

  const activeDatasetId = meta.data?.data.activeDataset.id ?? settings.data?.activeDatasetId ?? 'seed';
  const datasetName = meta.data?.data.activeDataset.name ?? settings.data?.datasets.find((d) => d.id === settings.data?.activeDatasetId)?.name ?? 'Dataset aktif';
  const periodLabel = meta.data?.data.periodDefaults.label ?? periodOverride?.start ?? 'Periode bawaan';
  const docCount = meta.data?.data.documents.total ?? docs.data?.total ?? 0;
  const modeLabel = meta.data ? `SQLite · SQL + ${meta.data.capabilities.rag.toUpperCase()}` : 'SQLite · SQL + FTS5';

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sources/${activeDatasetId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: DatasetSourceDetail | null) => { if (!cancelled) setSchema(json); })
      .catch(() => { if (!cancelled) setSchema(null); });
    return () => { cancelled = true; };
  }, [activeDatasetId]);

  const loadConversation = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: ConversationDetailResponse = await res.json();
      setDetail(json);
      setActiveId(id);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Percakapan tidak dapat dimuat.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current || list.loading || !list.data) return;
    initializedRef.current = true;
    if (list.data.items.length > 0) void loadConversation(list.data.items[0].id);
  }, [list.loading, list.data, loadConversation]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('question');
    if (q) setDraft(q);
  }, []);

  useEffect(() => {
    if (autoSubmittedRef.current || !activeId || sending) return;
    const q = new URLSearchParams(window.location.search).get('question');
    if (!q) return;
    autoSubmittedRef.current = true;
    void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, sending]);

  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }, [detail?.messages.length, sending]);

  const newConversation = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      const conv: ConversationSummary = json.conversation;
      setDetail({ conversation: conv, activeAttachment: null, messages: [] });
      setActiveId(conv.id);
      setHistoryOpen(false);
      list.retry();
      return conv.id;
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Percakapan baru gagal dibuat.' });
      return null;
    }
  }, [lang, list]);

  const send = useCallback(async (content: string) => {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    setLastFailed(null);
    setDraft('');

    let convId = activeId;
    if (!convId) {
      convId = await newConversation();
      if (!convId) { setSending(false); setDraft(text); return; }
    }

    const tempUser: ChatMessage = { id: `temp-${Date.now()}`, role: 'user', createdAt: new Date().toISOString(), content: text };
    setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, tempUser] } : prev));

    const period = periodOverride ?? (settings.data?.dateRange ? { start: settings.data.dateRange.start, end: settings.data.dateRange.end } : undefined);

    try {
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, lang, ...(period ? { period } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: SendMessageResponse = await res.json();
      setDetail((prev) => {
        if (!prev) return prev;
        const withoutTemp = prev.messages.filter((m) => m.id !== tempUser.id);
        const realUser: ChatMessage = { id: `${json.message.id}-u`, role: 'user', createdAt: json.message.createdAt, content: text };
        return {
          conversation: { ...prev.conversation, title: json.conversation.title, messageCount: json.conversation.messageCount },
          activeAttachment: prev.activeAttachment,
          messages: [...withoutTemp, realUser, json.message],
        };
      });
      list.retry();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Jawaban gagal dibuat.';
      setSendError(message);
      setLastFailed(text);
      setDetail((prev) => (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempUser.id) } : prev));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [activeId, sending, newConversation, periodOverride, settings.data, lang, list]);

  const fillAndSend = (question: string) => { setDraft(question); void send(question); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/conversations/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      toast({ status: 'success', message: 'Percakapan dihapus.' });
      if (activeId === deleteTarget.id) { setActiveId(null); setDetail(null); }
      setDeleteTarget(null);
      list.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Penghapusan gagal.' });
    } finally { setDeleting(false); }
  };

  const saveReport = async (msg: ChatMessage) => {
    if (!activeId) return;
    setSavingReportId(msg.id);
    try {
      const res = await fetch(`/api/conversations/${activeId}/messages/${msg.id}/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: ReportCreateResponse = await res.json();
      toast({ status: 'success', message: `Laporan disimpan: ${json.report.title}`, action: 'Buka laporan', onAction: () => { window.location.href = `/reports/${json.report.id}`; } });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Laporan gagal disimpan.' });
    } finally { setSavingReportId(null); }
  };

  /** Konfirmasi dulu (C-09), baru POST /api/share. Tautan tidak dibuat saat Batal. */
  const confirmShare = async () => {
    if (!activeId || !shareTarget) return;
    setShareState('loading');
    setShareError(null);
    try {
      const res = await fetch('/api/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeId,
          confirmed: true,
          options: { includeCitations, includeIdentity },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: { id?: string; url?: string } = await res.json();
      const url = json.url ?? (json.id && typeof window !== 'undefined' ? `${window.location.origin}/share/${json.id}` : '');
      setShareState('success');
      toast({
        status: 'success', message: 'Tautan siap dibagikan.', action: 'Salin tautan',
        onAction: () => { void navigator.clipboard.writeText(url).then(() => toast({ status: 'success', message: 'Tautan disalin.' })).catch(() => toast({ status: 'error', message: 'Tautan gagal disalin.' })); },
      });
      window.setTimeout(() => { setShareTarget(null); setShareState('default'); }, 600);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Tautan gagal dibuat.');
      setShareState('error');
    }
  };

  const attachDocument = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('file', file); body.append('kind', 'document');
    try {
      const res = await fetch('/api/sources', { method: 'POST', body });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      toast({ status: 'success', message: 'Dokumen dilampirkan. Pengindeksan dimulai.' });
      docs.retry(); meta.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Lampiran gagal.' });
    }
  };

  const selectDataset = (id: string) => {
    setContextMenu(null);
    void fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeDatasetId: id }) })
      .then(() => { settings.retry(); meta.retry(); })
      .catch(() => toast({ status: 'error', message: 'Dataset gagal diganti.' }));
  };

  /** FR-C.1-2: lepas attachment aktif dari percakapan + reset periode. */
  const detachAttachment = async () => {
    setContextMenu(null);
    setPeriodOverride(null);
    setDateStart('');
    setDateEnd('');
    const att = detail?.activeAttachment;
    if (!att) {
      toast({ status: 'success', message: 'Tidak ada dokumen dalam konteks.' });
      return;
    }
    try {
      const res = await fetch(`/api/attachments/${att.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeInConversation: null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (activeId) await loadConversation(activeId);
      toast({ status: 'success', message: 'Konteks dokumen dilepas. Pertanyaan berikutnya memakai seluruh sumber.' });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal melepas konteks.' });
    }
  };

  /** FR-C: arahkan konteks chat ke satu dokumen READY yang sudah ada.
   * datasetId = dataset aktif tempat chunk dokumen terindeks (retrieval
   * memfilter per source_id di dalam dataset tersebut). */
  const attachFromSource = async (sourceId: string, name: string) => {
    setContextMenu(null);
    if (!activeId) {
      toast({ status: 'error', message: 'Mulai percakapan terlebih dahulu untuk melampirkan dokumen.' });
      return;
    }
    try {
      const res = await fetch('/api/attachments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId: activeDatasetId, sourceId, name, activeInConversation: activeId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      await loadConversation(activeId);
      toast({ status: 'success', message: `Konteks diarahkan ke ${name}.` });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal melampirkan dokumen.' });
    }
  };

  const applyDateRange = () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      toast({ status: 'error', message: 'Pilih tanggal mulai dan akhir yang valid.' }); return;
    }
    setPeriodOverride({ start: dateStart, end: dateEnd });
    setContextMenu(null);
    toast({ status: 'success', message: 'Periode diterapkan pada pertanyaan berikutnya.' });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  };

  const copyQuestion = async () => {
    if (!lastFailed) return;
    try { await navigator.clipboard.writeText(lastFailed); toast({ status: 'success', message: 'Pertanyaan disalin.' }); }
    catch { toast({ status: 'error', message: 'Pertanyaan gagal disalin.' }); }
  };

  const conversations = list.data?.items ?? [];
  const messages = detail?.messages ?? [];
  const activeTitle = detail?.conversation.title ?? conversations[0]?.title ?? 'Percakapan baru';
  const sensitive = Boolean(shareTarget?.sources?.some((s) => s.kind === 'document'));

  return (
    <>
      {/* Band gelap struktural: kepala halaman + konteks percakapan aktif menyatu
          di satu band, idiom landing (grid + glow lime) seperti band Ringkasan.
          Kontrol kepala halaman (percakapan baru, riwayat) ikut di sini. */}
      <section data-nav-theme="dark" aria-label="Asisten analisis percakapan" className="relative overflow-hidden bg-forest text-porcelain">
        <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
        <div
          aria-hidden="true"
          className="glow-radial-lime absolute -right-24 -top-28 h-[320px] w-[440px] max-w-none"
        />
        <div className="page-container relative pb-s5 pt-s5">
          <p className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
            TanyaData · {datasetName}
          </p>
          <h1 className="mt-s2 font-display text-display text-porcelain">Asisten</h1>
          <p className="mt-s2 max-w-[52ch] font-body text-body text-dark-muted">
            Ajukan pertanyaan metrik. Setiap jawaban menyertakan sumber yang mendasarinya.
          </p>

          <div className="mt-s5 flex flex-wrap items-end justify-between gap-s4">
            {/* Konteks aktif: percakapan berjalan + attachment/dataset/periode dari API. */}
            <div className="flex min-w-0 flex-col gap-s2">
              <span className="font-display text-caption font-semibold uppercase tracking-[0.12em] text-dark-muted">
                Percakapan aktif
              </span>
              {detailLoading ? (
                <span className="animate-skeleton h-s6 w-56 rounded-control bg-porcelain/10" aria-hidden="true" />
              ) : (
                <span className="truncate font-display text-title text-porcelain">{activeTitle}</span>
              )}
              <div className="flex flex-wrap items-center gap-s2">
                <span className="inline-flex min-h-11 items-center gap-s2 rounded-chip border border-hairline-dark bg-porcelain/10 px-s3">
                  <Icon name="table_chart" className="text-[14px] text-dark-muted" />
                  <span className="max-w-[180px] truncate font-mono text-caption uppercase tracking-[0.06em] text-porcelain">{datasetName}</span>
                </span>
                <span className="inline-flex min-h-11 items-center gap-s2 rounded-chip border border-hairline-dark px-s3">
                  <Icon name="description" className="text-[14px] text-dark-muted" />
                  <span className="font-mono text-caption uppercase tracking-[0.06em] text-dark-muted">{docCount} DOKUMEN</span>
                </span>
                <span className="inline-flex min-h-11 items-center gap-s2 rounded-chip border border-hairline-dark px-s3">
                  <Icon name="date_range" className="text-[14px] text-dark-muted" />
                  <span className="font-mono text-caption uppercase tracking-[0.06em] text-dark-muted">PERIODE · {periodLabel.toUpperCase()}</span>
                </span>
              </div>
            </div>
            {/* Kontrol kepala halaman, skin gelap band. */}
            <div className="flex flex-wrap items-center gap-s2">
              <button type="button" onClick={() => void newConversation()} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain transition-colors hover:border-porcelain focus-ring">
                <Icon name="add" className="text-[16px]" /> Percakapan baru
              </button>
              <button type="button" onClick={() => setHistoryOpen(true)} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-hairline-dark px-s3 font-display text-label font-semibold text-porcelain transition-colors hover:border-porcelain focus-ring lg:hidden" aria-label="Riwayat percakapan">
                <Icon name="history" className="text-[18px]" /> Riwayat
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Zona kerja terang: rail riwayat + panel percakapan, dipisah SectionRule. */}
      <div className="page-container pb-s6" data-nav-theme="light">
        <div className="flex w-full flex-col items-start gap-s4 pt-s5 lg:flex-row">
          {/* Riwayat: rail 3/12 mulai 1024, sheet di bawah 1024. */}
          <aside className="hidden w-full shrink-0 flex-col gap-s2 lg:flex lg:w-1/4" aria-label="Daftar percakapan">
            <div className="flex items-center justify-between">
              <span className="mono-meta">PERCAKAPAN · {conversations.length}</span>
            </div>
            {list.loading && <div className="skeleton h-40 w-full" aria-busy="true" />}
            {list.error && (
              <div className="flex flex-col items-start gap-s2" role="alert">
                <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-caption text-ink">{list.error}</span></span>
                <button type="button" onClick={list.retry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
              </div>
            )}
            {!list.loading && !list.error && conversations.length === 0 && (
              <p className="font-body text-caption text-ink-72">Belum ada percakapan. Mulai pertanyaan pertama.</p>
            )}
            <div className="flex flex-col gap-s1">
              {conversations.map((conv) => (
                <div key={conv.id} className={`group flex items-start gap-s1 rounded-control border transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none ${activeId === conv.id ? 'border-forest bg-forest-08' : 'border-[var(--border-hairline)] bg-porcelain'}`}>
                  <button type="button" onClick={() => void loadConversation(conv.id)} aria-current={activeId === conv.id ? 'page' : undefined} className="min-w-0 flex-1 rounded-control px-s2 py-s2 text-left focus-ring">
                    <span className="block truncate font-display text-label font-semibold text-ink">{conv.title}</span>
                    {conv.preview && <span className="block truncate font-body text-caption text-ink-72">{conv.preview}</span>}
                    <span className="mt-s1 block truncate font-mono text-[11px] uppercase tracking-[0.06em] text-ink-72">
                      {conv.messageCount} PESAN{conv.lastMessageAt ? ` · ${wibTime(conv.lastMessageAt)} WIB` : ''}
                    </span>
                  </button>
                  <button type="button" onClick={() => setDeleteTarget(conv)} aria-label={`Hapus ${conv.title}`} className="touch-44 flex shrink-0 items-center justify-center rounded-control text-ink-72 hover:text-ink focus-ring">
                    <Icon name="delete" className="text-[16px]" />
                  </button>
                </div>
              ))}
            </div>
          </aside>

          {/* Panel percakapan aktif: utas dalam satu kartu rounded-card-lg.
              Pertanyaan user = bubble gelap kecil; jawaban tetap AdaptiveOutputView. */}
          <section aria-label="Percakapan aktif" className="surface min-w-0 w-full rounded-card-lg p-s4 md:p-s5 lg:w-3/4">
            <div className="flex flex-wrap items-center justify-between gap-s2">
              <span className="mono-meta">UTAS · {messages.length} PESAN</span>
              <span className="mono-meta">{modeLabel}</span>
            </div>
            <SectionRule className="mb-s4 mt-s3" />

            {/* Contoh pertanyaan saat kosong (state empty, tetap dirender). */}
            {messages.length === 0 && !detailLoading && !sending && (
              <div className="mb-s4 flex flex-col gap-s3 rounded-control border border-[var(--border-hairline)] bg-forest-08 p-s3">
                <span className="mono-meta">CONTOH PERTANYAAN</span>
                <div className="grid grid-cols-1 gap-s2 sm:grid-cols-2">
                  {SUGGESTED.map((question) => (
                    <button key={question} type="button" onClick={() => fillAndSend(question)} className="touch-44 flex items-center justify-between gap-s2 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 text-left font-body text-caption text-ink transition-colors hover:border-forest focus-ring">
                      <span>{question}</span>
                      <Icon name="arrow_forward" className="shrink-0 text-[16px] text-ink-72" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-s4" role="log" aria-live="polite" aria-relevant="additions">
              {detailLoading && (
                <div className="space-y-s3" aria-busy="true"><div className="skeleton h-40 w-2/3" /><div className="skeleton h-80 w-full" /><div className="skeleton h-48 w-full" /></div>
              )}
              {detailError && (
                <div className="flex flex-col items-start gap-s2 rounded-control border border-[var(--border-hairline)] p-s3" role="alert">
                  <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-body text-ink">{detailError}</span></span>
                  {activeId && <button type="button" onClick={() => void loadConversation(activeId)} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>}
                </div>
              )}
              {messages.map((m) => m.role === 'user' ? (
                <div key={m.id} className="flex items-start justify-end gap-s3 pl-s5">
                  <div className="flex max-w-[85%] flex-col items-end gap-s1">
                    <span className="mono-meta">{wibTime(m.createdAt)} WIB</span>
                    <div className="rounded-card-lg bg-forest px-s3 py-s2 text-porcelain">
                      <p className="font-body text-body text-porcelain">{m.content}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <article key={m.id} className="animate-phrase-in flex flex-col gap-s3 pr-s2">
                  <div className="flex items-center gap-s2">
                    <StatusDot tone="active" />
                    <span className="mono-meta">{wibTime(m.createdAt)} WIB · {m.meta?.mode ?? 'jawaban'}</span>
                  </div>
                  <TextGenerate text={m.answer || m.content} state={m.guardrail ? 'empty' : 'default'} emptyTitle={m.guardrail?.explanation ?? 'Informasi ini tidak ditemukan pada sumber.'} />
                  {m.guardrail && m.followUps && m.followUps.length > 0 && (
                    <div className="flex flex-wrap gap-s2">
                      {m.followUps.map((q) => <button key={q} type="button" onClick={() => fillAndSend(q)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s2 font-body text-caption text-ink hover:border-forest focus-ring">{q}</button>)}
                    </div>
                  )}
                  {!m.guardrail && (
                    <>
                      <AdaptiveOutputView outputs={normalizeChatOutputs(m)} onOpenCitation={(id) => { const sources = m.sources ?? []; setSourceDetail(sources.find((s) => `S${sources.indexOf(s) + 1}` === id) ?? null); }} />
                      <CitationMarks citations={m.sources ?? []} onOpen={setSourceDetail} />
                      {m.followUps && m.followUps.length > 0 && (
                        <div className="flex flex-wrap gap-s2">
                          {m.followUps.map((q) => <button key={q} type="button" onClick={() => fillAndSend(q)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s2 font-body text-caption text-ink hover:border-forest focus-ring">{q}</button>)}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-s2">
                        <button type="button" onClick={() => setShareTarget(m)} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s2 font-display text-label font-semibold text-ink hover:border-forest focus-ring">
                          <Icon name="ios_share" className="text-[16px]" /> Bagikan
                        </button>
                        <button type="button" onClick={() => void saveReport(m)} disabled={savingReportId === m.id} className="touch-44 inline-flex items-center gap-s2 rounded-control border border-[var(--border-hairline)] px-s2 font-display text-label font-semibold text-ink hover:border-forest focus-ring disabled:opacity-50">
                          <Icon name="save" className="text-[16px]" /> {savingReportId === m.id ? 'Menyimpan' : 'Simpan laporan'}
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
              {sending && <TypingIndicator />}
              {sendError && (
                <div className="flex flex-col items-start gap-s2 rounded-control border border-[var(--border-hairline)] p-s3" role="alert">
                  <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-body text-ink">{sendError}</span></span>
                  <div className="flex flex-wrap gap-s2">
                    {lastFailed && <><button type="button" onClick={() => void send(lastFailed)} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button><button type="button" onClick={() => void copyQuestion()} className="touch-44 rounded-control px-s3 font-display text-label text-ink-72 focus-ring">Salin pertanyaan</button></>}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <SectionRule className="mt-s5" />

        {/* Composer: band gelap kedua modul (momen modul, idiom hero landing).
            Sticky di bawah viewport di semua ukuran; di 390 menyertai sheet riwayat.
            Grid + glow diklip di lapisan dekorasi bersarang: menu konteks dataset/periode
            pop ke atas panel dan tidak boleh terpotong oleh overflow-hidden panelnya. */}
        <div className="sticky bottom-s3 z-sticky mt-s4">
          <div className="relative rounded-card-lg border border-hairline-dark bg-forest p-s3 shadow-float md:p-s4">
            <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-card-lg">
              <div aria-hidden="true" className="bg-grid-dark mask-grid-fade absolute inset-0" />
              <div aria-hidden="true" className="glow-radial-lime absolute -bottom-20 -left-16 h-[240px] w-[360px]" />
            </div>
            <div className="relative">
              <div className="mb-s2 flex flex-wrap items-center justify-between gap-s2">
                <div className="flex flex-wrap items-center gap-s2">
                  <span className="inline-flex min-h-11 items-center gap-s2 rounded-chip border border-hairline-dark bg-porcelain/10 px-s3"><Icon name="table_chart" className="text-[14px] text-dark-muted" /><span className="max-w-[140px] truncate font-mono text-caption uppercase tracking-[0.06em] text-porcelain">{datasetName}</span></span>
                  {detail?.activeAttachment ? (
                    <span className="inline-flex min-h-11 items-center gap-s2 rounded-chip border border-lime/50 bg-porcelain/10 px-s3" title="Konteks chat diarahkan ke dokumen ini (FR-C)">
                      <Icon name="description" className="text-[14px] text-lime" />
                      <span className="max-w-[180px] truncate font-mono text-caption uppercase tracking-[0.06em] text-porcelain">{detail.activeAttachment.name}</span>
                      <span className="font-mono text-[10px] uppercase text-lime">AKTIF</span>
                    </span>
                  ) : (
                    <span className="inline-flex min-h-11 items-center gap-s2 rounded-chip border border-hairline-dark px-s3" title="Tanpa dokumen terlampir: pertanyaan memakai seluruh sumber">
                      <Icon name="description" className="text-[14px] text-dark-muted" />
                      <span className="font-mono text-caption uppercase tracking-[0.06em] text-dark-muted">TANPA DOKUMEN TERLAMPIR</span>
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => void detachAttachment()} className="touch-44 inline-flex items-center gap-s1 font-body text-caption text-dark-muted transition-colors hover:text-porcelain focus-ring"><Icon name="close" className="text-[14px]" /> Hapus konteks</button>
              </div>
              <textarea
                ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown}
                rows={2} maxLength={2000} disabled={sending}
                aria-label="Tanyakan sesuatu tentang data" placeholder="Tanyakan metrik, tren, anomali, atau prosedur"
                className="w-full resize-none rounded-control border border-[var(--border-hairline)] bg-porcelain p-s3 font-body text-body text-ink placeholder:text-ink-72 focus-ring"
              />
              <div className="mt-s2 flex flex-wrap items-center justify-between gap-s2">
                <div className="flex items-center gap-s1">
                  <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" aria-label="Lampirkan dokumen" onChange={(e) => void attachDocument(e)} />
                  <button type="button" aria-label="Lampirkan dokumen" onClick={() => fileInputRef.current?.click()} className="touch-44 flex items-center justify-center rounded-control text-dark-muted transition-colors hover:bg-porcelain/10 hover:text-porcelain focus-ring"><Icon name="attach_file" className="text-[20px]" /></button>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Lampirkan dari sumber yang sudah ada"
                      aria-expanded={contextMenu === 'source'}
                      onClick={() => setContextMenu(contextMenu === 'source' ? null : 'source')}
                      className="touch-44 flex items-center justify-center rounded-control text-dark-muted transition-colors hover:bg-porcelain/10 hover:text-porcelain focus-ring"
                    >
                      <Icon name="folder_open" className="text-[20px]" />
                    </button>
                    {contextMenu === 'source' && (
                      <div role="listbox" aria-label="Pilih dokumen sebagai konteks chat" className="absolute bottom-full left-0 z-dropdown mb-s1 max-h-64 w-72 overflow-y-auto rounded-control border border-[var(--border-hairline)] bg-porcelain p-s2 elevated">
                        {(docs.data?.items ?? []).length === 0 && (
                          <p className="px-s2 py-s2 font-body text-caption text-ink-72">Belum ada dokumen READY. Unggah dari Sumber Data.</p>
                        )}
                        {(docs.data?.items ?? []).map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            role="option"
                            aria-selected={detail?.activeAttachment?.name === doc.name}
                            onClick={() => void attachFromSource(doc.id, doc.name)}
                            className="block w-full rounded-control px-s2 py-s2 text-left transition-colors hover:bg-forest-08 focus-ring"
                          >
                            <span className="block truncate font-body text-caption text-ink">{doc.name}</span>
                            <span className="mono-meta">{doc.format.toUpperCase()} · READY</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <button type="button" aria-label="Pilih dataset" aria-expanded={contextMenu === 'dataset'} onClick={() => setContextMenu(contextMenu === 'dataset' ? null : 'dataset')} className="touch-44 flex items-center justify-center rounded-control text-dark-muted transition-colors hover:bg-porcelain/10 hover:text-porcelain focus-ring"><Icon name="database" className="text-[20px]" /></button>
                    {contextMenu === 'dataset' && (
                      <div className="absolute bottom-full left-0 z-dropdown mb-s1 w-60 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s2 elevated" role="listbox" aria-label="Pilih dataset">
                        {(meta.data?.data.datasetChoices ?? settings.data?.datasets ?? []).map((choice) => (
                          <button key={choice.id} type="button" role="option" aria-selected={choice.id === activeDatasetId} onClick={() => selectDataset(choice.id)} className="block min-h-11 w-full rounded-control px-s2 text-left font-body text-caption text-ink hover:bg-forest-08 focus-ring">{choice.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <button type="button" aria-label="Filter periode" aria-expanded={contextMenu === 'date'} onClick={() => setContextMenu(contextMenu === 'date' ? null : 'date')} className="touch-44 flex items-center justify-center rounded-control text-dark-muted transition-colors hover:bg-porcelain/10 hover:text-porcelain focus-ring"><Icon name="date_range" className="text-[20px]" /></button>
                    {contextMenu === 'date' && (
                      <div className="absolute bottom-full left-0 z-dropdown mb-s1 w-60 space-y-s2 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s3 elevated">
                        <label className="block font-body text-caption text-ink-72">Mulai<input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="mt-s1 min-h-11 w-full rounded-control border border-[var(--border-hairline)] bg-porcelain px-s2 font-body text-caption text-ink focus-ring" /></label>
                        <label className="block font-body text-caption text-ink-72">Akhir<input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="mt-s1 min-h-11 w-full rounded-control border border-[var(--border-hairline)] bg-porcelain px-s2 font-body text-caption text-ink focus-ring" /></label>
                        <button type="button" onClick={applyDateRange} className="touch-44 w-full rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Terapkan</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-s3">
                  <span className="hidden font-body text-caption text-dark-muted sm:inline">Enter kirim · Shift+Enter baris baru</span>
                  <GlowingCTA type="button" tone="dark" state={sending ? 'loading' : 'default'} onClick={() => void send(draft)} disabled={draft.trim().length === 0} loadingLabel="Mengirim">Kirim</GlowingCTA>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Riwayat mobile (sheet) di bawah 1024. */}
      {historyOpen && (
        <div className="fixed inset-0 z-drawer lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
          <nav className="absolute inset-y-0 left-0 w-rail-expanded overflow-y-auto bg-porcelain p-s3" aria-label="Riwayat percakapan">
            <div className="mb-s3 flex items-center justify-between">
              <span className="font-display text-title text-ink">Riwayat</span>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Tutup riwayat" className="touch-44 flex items-center justify-center rounded-control text-ink focus-ring"><Icon name="close" className="text-[20px]" /></button>
            </div>
            <button type="button" onClick={() => void newConversation()} className="touch-44 mb-s2 inline-flex items-center gap-s2 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring"><Icon name="add" className="text-[16px]" /> Percakapan baru</button>
            <div className="flex flex-col gap-s1">
              {conversations.map((conv) => (
                <button key={conv.id} type="button" onClick={() => { void loadConversation(conv.id); setHistoryOpen(false); }} className="min-h-11 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 py-s2 text-left transition-[border-color,box-shadow,transform] duration-[var(--motion-expand)] hover:-translate-y-0.5 hover:border-forest hover:shadow-lift motion-reduce:transform-none focus-ring">
                  <span className="block truncate font-display text-label font-semibold text-ink">{conv.title}</span>
                  {conv.preview && <span className="block truncate font-body text-caption text-ink-72">{conv.preview}</span>}
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}

      {/* Detail sitasi (drawer). */}
      {sourceDetail && (
        <div className="fixed inset-0 z-drawer">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setSourceDetail(null)} aria-hidden="true" />
          <aside className="absolute inset-y-0 right-0 w-full max-w-[420px] overflow-y-auto bg-porcelain p-s4 elevated" role="dialog" aria-modal="true" aria-label="Detail sitasi">
            <div className="mb-s3 flex items-center justify-between">
              <h2 className="font-display text-title text-ink">Detail sitasi</h2>
              <button type="button" onClick={() => setSourceDetail(null)} aria-label="Tutup detail sitasi" className="touch-44 flex items-center justify-center rounded-control text-ink focus-ring"><Icon name="close" className="text-[20px]" /></button>
            </div>
            <SectionRule className="mb-s4" />
            <div className="flex flex-col gap-s3">
              <div><span className="mono-meta">DOKUMEN</span><p className="mt-s1 font-body text-body font-semibold text-ink">{sourceDetail.docTitle ?? sourceDetail.sourceId}</p></div>
              {sourceDetail.section && <div><span className="mono-meta">BAGIAN</span><p className="mt-s1 font-body text-body text-ink">{sourceDetail.section}</p></div>}
              {sourceDetail.page != null && <div><span className="mono-meta">HALAMAN</span><p className="mt-s1 font-body text-body text-ink">{sourceDetail.page}</p></div>}
              {sourceDetail.quote && <blockquote className="rounded-control border border-[var(--border-hairline)] bg-forest-08 p-s3 font-body text-body text-ink">{sourceDetail.quote}</blockquote>}
              {sourceDetail.deep_link_status === 'valid' && sourceDetail.deep_link && (
                <a href={sourceDetail.deep_link} className="touch-44 inline-flex items-center font-display text-label font-semibold text-forest focus-ring">Lihat di dokumen</a>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Konfirmasi hapus. */}
      {deleteTarget && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-s3">
          <div className="animate-backdrop-in absolute inset-0 bg-ink/40" onClick={() => setDeleteTarget(null)} aria-hidden="true" />
          <div className="animate-modal-in elevated relative w-full max-w-[480px] rounded-overlay border border-[var(--border-hairline)] bg-porcelain p-s4" role="dialog" aria-modal="true" aria-label="Hapus percakapan">
            <h2 className="font-display text-title text-ink">Hapus percakapan?</h2>
            <p className="mt-s2 font-body text-body text-ink-72">“{deleteTarget.title}” dan semua pesannya akan dihapus. Laporan tersimpan tetap tersedia.</p>
            <div className="mt-s4 flex justify-end gap-s2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s3 font-display text-label font-semibold text-ink focus-ring">Batal</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="touch-44 rounded-control border border-terracotta px-s3 font-display text-label font-semibold text-ink focus-ring disabled:opacity-50">{deleting ? 'Menghapus' : 'Hapus'}</button>
            </div>
          </div>
        </div>
      )}

      {/* C-09 Confirm Modal: konfirmasi share (FR-E.3). */}
      <AnimatedModal
        open={Boolean(shareTarget)}
        onClose={() => { setShareTarget(null); setShareState('default'); }}
        title="Bagikan sesi ini?"
        confirmLabel="Buat tautan"
        state={shareState}
        errorTitle={shareError ?? 'Tautan gagal dibuat.'}
        onConfirm={() => void confirmShare()}
        onRetry={() => void confirmShare()}
      >
        <p>Pertanyaan dan jawaban akan dapat diakses siapa pun yang punya link.</p>
        <ul className="mt-s3 space-y-s1 font-body text-caption text-ink-72">
          <li>Pesan dalam sesi ini: {detail?.messages.length ?? 0}</li>
          <li>Lampiran: {datasetName}</li>
          <li>Angka dan kutipan mengikuti snapshot pesan.</li>
        </ul>
        <div className="mt-s3 flex flex-col gap-s2">
          <label className="flex min-h-11 items-center gap-s2"><input type="checkbox" checked={includeCitations} onChange={(e) => setIncludeCitations(e.target.checked)} className="h-s3 w-s3 accent-forest" /><span className="font-body text-caption text-ink">Sertakan sitasi</span></label>
          <label className="flex min-h-11 items-center gap-s2"><input type="checkbox" checked={includeIdentity} onChange={(e) => setIncludeIdentity(e.target.checked)} className="h-s3 w-s3 accent-forest" /><span className="font-body text-caption text-ink">Sertakan identitas dokumen</span></label>
        </div>
        {sensitive && (
          <p className="mt-s3 inline-flex items-start gap-s2 rounded-control bg-terracotta-16 p-s2 font-body text-caption text-ink">
            <StatusDot tone="error" /> Sesi ini memuat data yang mungkin sensitif. Periksa kembali sebelum membagikan.
          </p>
        )}
      </AnimatedModal>
    </>
  );
}
