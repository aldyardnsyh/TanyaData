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
import { formatNumber } from '@/lib/ui/format';
import { Icon } from '@/components/ui/icons';
import { MonoMeta } from '@/components/ui/mono-meta';
import { MeasurementRule } from '@/components/ui/measurement-rule';
import { StatusDot } from '@/components/ui/status-dot';
import { AnswerCard } from '@/components/chat/answer-card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';

const SUGGESTED = [
  'Berapa total transaksi bulan ini?',
  'Bagaimana distribusi status transaksi?',
  'Mengapa tingkat kegagalan transaksi meningkat?',
  'Prosedur apa yang berlaku saat transaksi gagal?',
];

function wibTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(':', '.');
}

/** Motion #5: typing 3-dot berhenti begitu jawaban tiba. Satu dari dua loop yang diizinkan. */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden="true">
        <span className="state-dot animate-skeleton [animation-delay:0ms]" />
        <span className="state-dot animate-skeleton [animation-delay:120ms]" />
        <span className="state-dot animate-skeleton [animation-delay:240ms]" />
      </span>
      <span className="font-body text-body-sm text-ink-muted-strong">Menyusun jawaban…</span>
    </div>
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
  const [sessionOpen, setSessionOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<'dataset' | 'date' | null>(null);
  const [attachedDataset, setAttachedDataset] = useState(true);
  const [attachedDocs, setAttachedDocs] = useState(true);
  const [periodOverride, setPeriodOverride] = useState<{ start: string; end: string } | null>(null);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [sourceDetail, setSourceDetail] = useState<SourceCitation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savingReportId, setSavingReportId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [schema, setSchema] = useState<DatasetSourceDetail | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const autoSubmittedRef = useRef(false);

  const activeDatasetId = meta.data?.data.activeDataset.id ?? settings.data?.activeDatasetId ?? 'seed';
  const datasetName = meta.data?.data.activeDataset.name ?? settings.data?.datasets.find((d) => d.id === settings.data?.activeDatasetId)?.name ?? 'Dataset aktif';
  const periodLabel = meta.data?.data.periodDefaults.label ?? '—';
  const docCount = meta.data?.data.documents.total ?? docs.data?.total ?? 0;
  const docItems = docs.data?.items ?? [];
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
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }, [detail?.messages.length, sending]);

  useEffect(() => {
    if (!focusMessageId) return;
    const el = document.getElementById(`msg-${focusMessageId}`);
    if (el) { el.focus({ preventScroll: true }); setFocusMessageId(null); }
  }, [focusMessageId]);

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
      setDetail({ conversation: conv, messages: [] });
      setActiveId(conv.id);
      setSessionOpen(false);
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
          messages: [...withoutTemp, realUser, json.message],
        };
      });
      setFocusMessageId(json.message.id);
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

  useEffect(() => {
    if (autoSubmittedRef.current || !activeId || sending) return;
    const q = new URLSearchParams(window.location.search).get('question');
    if (!q) return;
    autoSubmittedRef.current = true;
    void send(q);
  }, [activeId, sending, send]);

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
      setSessionOpen(false);
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
      toast({
        status: 'success', message: `Laporan disimpan: ${json.report.title}`, action: 'Buka laporan',
        onAction: () => { window.location.href = `/reports/${json.report.id}`; },
      });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Laporan gagal disimpan.' });
    } finally { setSavingReportId(null); }
  };

  const exportTranscript = async () => {
    if (!activeId) { toast({ status: 'error', message: 'Tidak ada percakapan aktif.' }); return; }
    try {
      const res = await fetch(`/api/conversations/${activeId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: ConversationDetailResponse = await res.json();
      const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `tanyadata-transkrip-${activeId}.json`; anchor.click();
      URL.revokeObjectURL(url);
      toast({ status: 'success', message: 'Transkrip diunduh.' });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Ekspor gagal.' });
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
    void fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeDatasetId: id }),
    }).then(() => { settings.retry(); meta.retry(); })
      .catch(() => toast({ status: 'error', message: 'Dataset gagal diganti.' }));
  };

  const applyDateRange = () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      toast({ status: 'error', message: 'Pilih tanggal mulai dan akhir yang valid.' }); return;
    }
    setPeriodOverride({ start: dateStart, end: dateEnd });
    setContextMenu(null);
    toast({ status: 'success', message: 'Periode diterapkan pada pertanyaan berikutnya.' });
  };

  const clearContext = () => {
    setAttachedDataset(false); setAttachedDocs(false); setPeriodOverride(null);
    setDateStart(''); setDateEnd('');
    toast({ status: 'success', message: 'Konteks dihapus.' });
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

  return (
    <div className="flex w-full flex-col">
      {/* Header asisten. */}
      <div className="border-b border-border-hairline bg-surface px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-display text-ink">Asisten</h1>
              <StatusDot state="active" label="SQLite · SQL + FTS5" />
            </div>
            <p className="mt-2 max-w-2xl font-body text-body-md text-ink-muted-strong">
              Ajukan pertanyaan metrik. Setiap jawaban menyertakan SQL dan sumber yang mendasarinya.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Button variant="secondary" size="sm" onClick={() => setSessionOpen((o) => !o)} aria-expanded={sessionOpen}>
                <Icon name="forum" className="text-[16px]" aria-hidden="true" />
                <span className="max-w-[160px] truncate">{activeTitle}</span>
                <Icon name="expand_more" className="text-[16px]" aria-hidden="true" />
              </Button>
              {sessionOpen && (
                <div className="absolute right-0 z-dropdown mt-1 w-[300px] rounded-card border border-border-hairline bg-surface p-2 shadow-overlay" role="listbox" aria-label="Percakapan">
                  <div className="flex items-center justify-between px-2 py-1">
                    <MonoMeta>PERCAKAPAN</MonoMeta>
                    <button type="button" onClick={() => void newConversation()} className="inline-flex min-h-11 items-center gap-1 font-body text-label-md font-semibold text-primary focus-ring">
                      <Icon name="add" className="text-[14px]" aria-hidden="true" /> Baru
                    </button>
                  </div>
                  {list.loading && <div className="space-y-1 p-1"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>}
                  {list.error && <p className="px-2 py-2 font-body text-body-sm text-error-text">{list.error}</p>}
                  {!list.loading && !list.error && conversations.length === 0 && <p className="px-2 py-2 font-body text-body-sm text-ink-muted-strong">Belum ada percakapan.</p>}
                  {conversations.map((conv) => (
                    <div key={conv.id} className={`group flex items-start gap-1 rounded-control ${activeId === conv.id ? 'bg-row-hover' : ''}`}>
                      <button type="button" role="option" aria-selected={activeId === conv.id} onClick={() => { void loadConversation(conv.id); setSessionOpen(false); }} className="min-w-0 flex-1 rounded-control px-2 py-2 text-left focus-ring">
                        <span className="block truncate font-body text-body-md font-semibold text-ink">{conv.title}</span>
                        {conv.preview && <span className="block truncate font-body text-body-sm text-ink-muted-strong">{conv.preview}</span>}
                      </button>
                      <button type="button" aria-label={`Hapus ${conv.title}`} onClick={() => setDeleteTarget(conv)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-muted-strong hover:text-error-text focus-ring">
                        <Icon name="delete" className="text-[16px]" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={() => void exportTranscript()}>
              <Icon name="download" className="text-[16px]" aria-hidden="true" /> Ekspor transkrip
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)} className="lg:hidden" aria-label="Riwayat percakapan">
              <Icon name="history" className="text-[18px]" aria-hidden="true" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPanelOpen((o) => !o)} className="xl:hidden" aria-label="Tampilkan konteks" aria-expanded={panelOpen}>
              <Icon name="dock_to_left" className="text-[18px]" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <MeasurementRule className="mt-5" />
      </div>

      <div className="flex w-full flex-col items-start xl:flex-row">
        <div className="flex w-full flex-col gap-6 p-4 sm:p-6 lg:p-8 xl:w-[72%]">
          {/* Contoh pertanyaan. */}
          <div>
            <MonoMeta className="mb-3 block">CONTOH PERTANYAAN</MonoMeta>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTED.map((question) => (
                <button key={question} type="button" onClick={() => fillAndSend(question)} className="flex min-h-11 items-center justify-between gap-2 rounded-control border border-border-hairline bg-surface px-3 text-left font-body text-body-sm text-ink transition-colors hover:border-primary focus-ring">
                  <span>{question}</span>
                  <Icon name="arrow_forward" className="shrink-0 text-[16px] text-ink-muted-strong" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          {/* Utas percakapan. Motion #5: stagger 30ms maks 8. */}
          <div className="flex flex-col gap-6" role="log" aria-live="polite" aria-relevant="additions">
            {detailLoading ? (
              <div className="space-y-4"><Skeleton className="h-16 w-2/3" /><Skeleton className="h-40 w-full" /><Skeleton className="h-24 w-full" /></div>
            ) : detailError ? (
              <div className="rounded-card border border-signal-terracotta bg-surface p-4">
                <p className="font-body text-body-md text-error-text">{detailError}</p>
                {activeId && <Button size="sm" onClick={() => void loadConversation(activeId)} className="mt-2">Coba lagi</Button>}
              </div>
            ) : messages.length === 0 && !sending ? (
              <div className="rounded-card border border-border-hairline bg-surface p-6">
                <EmptyState icon={<Icon name="forum" className="text-[24px]" />} title="Belum ada percakapan" description="Mulai dengan pertanyaan pertama. Jawaban menyertakan SQL untuk data dan kutipan untuk dokumen." />
                <div className="flex flex-wrap justify-center gap-2 pb-2">
                  {SUGGESTED.slice(0, 3).map((question) => (
                    <button key={question} type="button" onClick={() => fillAndSend(question)} className="min-h-11 rounded-control border border-border-control px-3 font-body text-body-sm text-ink transition-colors hover:border-primary focus-ring">{question}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex items-start justify-end gap-3 pl-8" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                    <div className="flex max-w-[85%] flex-col items-end gap-1">
                      <MonoMeta>{wibTime(m.createdAt)} WIB · PERIODE {periodLabel}</MonoMeta>
                      <div className="rounded-card border border-border-hairline bg-surface px-4 py-3">
                        <p className="font-body text-body-lg text-ink">{m.content}</p>
                      </div>
                    </div>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary" aria-hidden="true">
                      <Icon name="person" className="text-[18px]" />
                    </span>
                  </div>
                ) : (
                  <div key={m.id} id={`msg-${m.id}`} tabIndex={-1} className="flex animate-message-in items-start gap-3 pr-2 focus:outline-none" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary" aria-hidden="true">
                      <Icon name="forum" className="text-[18px]" />
                    </span>
                    <AnswerCard message={m} modeLabel={modeLabel} conversationId={activeId ?? undefined} onFollowUp={(q) => fillAndSend(q)} onSaveReport={saveReport} savingReport={savingReportId === m.id} onOpenSource={setSourceDetail} disabled={sending} />
                  </div>
                ),
              )
            )}
            {sending && (
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary" aria-hidden="true"><Icon name="forum" className="text-[18px]" /></span>
                <TypingIndicator />
              </div>
            )}
            {sendError && (
              <div className="rounded-card border border-signal-terracotta bg-surface p-4">
                <p className="font-body text-body-md text-error-text">{sendError}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {lastFailed && <><Button size="sm" onClick={() => void send(lastFailed)}>Coba lagi</Button><Button size="sm" variant="ghost" onClick={() => void copyQuestion()}>Salin pertanyaan</Button></>}
                </div>
              </div>
            )}
          </div>

          {/* Composer. Enter kirim, Shift+Enter baris baru (U-08). */}
          <div className="sticky bottom-4 z-30">
            <div className="rounded-overlay border border-border-hairline bg-surface p-3 shadow-overlay">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {attachedDataset && (
                    <span className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-hairline px-2">
                      <Icon name="table_chart" className="text-[14px] text-primary" aria-hidden="true" />
                      <span className="max-w-[160px] truncate font-body text-body-sm text-ink">{datasetName}</span>
                      <button type="button" aria-label="Hapus konteks dataset" onClick={() => setAttachedDataset(false)} className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted-strong hover:text-error-text focus-ring"><Icon name="close" className="text-[14px]" aria-hidden="true" /></button>
                    </span>
                  )}
                  {attachedDocs && (
                    <span className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-hairline px-2">
                      <Icon name="description" className="text-[14px] text-primary" aria-hidden="true" />
                      <MonoMeta>{docCount} DOKUMEN</MonoMeta>
                      <button type="button" aria-label="Hapus konteks dokumen" onClick={() => setAttachedDocs(false)} className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted-strong hover:text-error-text focus-ring"><Icon name="close" className="text-[14px]" aria-hidden="true" /></button>
                    </span>
                  )}
                </div>
                <button type="button" onClick={clearContext} className="inline-flex min-h-11 items-center gap-1 font-body text-body-sm text-ink-muted-strong hover:text-error-text focus-ring">
                  <Icon name="close" className="text-[14px]" aria-hidden="true" /> Hapus konteks
                </button>
              </div>
              <textarea
                id="promptInput" ref={textareaRef} value={draft}
                onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown}
                rows={2} maxLength={2000} disabled={sending}
                aria-label="Tanyakan sesuatu tentang data"
                placeholder="Tanyakan metrik, tren, anomali, atau prosedur…"
                className="w-full resize-none rounded-control border border-border-control bg-canvas p-3 font-body text-body-md text-ink placeholder:text-ink-muted-strong focus-ring"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md" className="sr-only" aria-label="Lampirkan dokumen" onChange={(e) => void attachDocument(e)} />
                  <button type="button" aria-label="Lampirkan dokumen" onClick={() => fileInputRef.current?.click()} className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted-strong hover:bg-row-hover focus-ring"><Icon name="attach_file" className="text-[20px]" aria-hidden="true" /></button>
                  <div className="relative">
                    <button type="button" aria-label="Pilih dataset" aria-expanded={contextMenu === 'dataset'} onClick={() => setContextMenu(contextMenu === 'dataset' ? null : 'dataset')} className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted-strong hover:bg-row-hover focus-ring"><Icon name="database" className="text-[20px]" aria-hidden="true" /></button>
                    {contextMenu === 'dataset' && (
                      <div className="absolute bottom-full left-0 z-dropdown mb-1 w-60 rounded-card border border-border-hairline bg-surface p-2 shadow-overlay" role="listbox" aria-label="Pilih dataset">
                        {(meta.data?.data.datasetChoices ?? settings.data?.datasets ?? []).map((choice) => (
                          <button key={choice.id} type="button" role="option" aria-selected={choice.id === activeDatasetId} onClick={() => selectDataset(choice.id)} className="block min-h-11 w-full rounded-control px-2 text-left font-body text-body-md text-ink hover:bg-row-hover focus-ring">{choice.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <button type="button" aria-label="Filter periode" aria-expanded={contextMenu === 'date'} onClick={() => setContextMenu(contextMenu === 'date' ? null : 'date')} className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted-strong hover:bg-row-hover focus-ring"><Icon name="date_range" className="text-[20px]" aria-hidden="true" /></button>
                    {contextMenu === 'date' && (
                      <div className="absolute bottom-full left-0 z-dropdown mb-1 w-60 space-y-2 rounded-card border border-border-hairline bg-surface p-3 shadow-overlay">
                        <label className="block font-body text-body-sm text-ink-muted-strong">Mulai<input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="mt-1 min-h-11 w-full rounded-control border border-border-control bg-surface px-2 font-body text-body-md text-ink focus-ring" /></label>
                        <label className="block font-body text-body-sm text-ink-muted-strong">Akhir<input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="mt-1 min-h-11 w-full rounded-control border border-border-control bg-surface px-2 font-body text-body-md text-ink focus-ring" /></label>
                        <Button size="sm" onClick={applyDateRange} className="w-full">Terapkan</Button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden font-body text-body-sm text-ink-muted-strong sm:inline">Enter kirim · Shift+Enter baris baru</span>
                  <Button variant="primary" disabled={sending || draft.trim().length === 0} onClick={() => void send(draft)}>
                    {sending ? 'Mengirim…' : 'Kirim'}
                    <Icon name="arrow_upward" className="text-[16px]" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Panel konteks. */}
        <aside id="contextPanel" className={`w-full border-l border-border-hairline bg-canvas p-4 sm:p-6 xl:flex xl:w-[28%] xl:flex-col ${panelOpen ? 'flex' : 'hidden'}`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-body text-headline-sm text-ink">Konteks</h2>
            <MonoMeta>SQL · FTS5</MonoMeta>
          </div>
          <MeasurementRule className="mb-4" />

          <div className="mb-4 rounded-card border border-border-hairline bg-surface p-4">
            <MonoMeta className="mb-2 block">SKEMA AKTIF</MonoMeta>
            {schema?.schema ? (
              <div className="rounded-control border border-border-hairline p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1 font-body text-body-sm font-semibold text-primary"><Icon name="table" className="text-[14px]" aria-hidden="true" /><span className="truncate">{schema.schema.tableName}</span></span>
                  <MonoMeta>{formatNumber(schema.source.rowCount ?? null)} ROWS</MonoMeta>
                </div>
                <ul className="mt-2 space-y-0.5 pl-4 font-mono text-body-sm text-ink-muted-strong">
                  {schema.schema.columns.map((column) => <li key={column.name} className="flex justify-between gap-2"><span className="truncate">{column.name}</span><span className="shrink-0">{column.type}</span></li>)}
                </ul>
              </div>
            ) : <p className="font-body text-body-sm text-ink-muted-strong">Skema tidak tersedia.</p>}
          </div>

          <div className="mb-4 rounded-card border border-border-hairline bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <MonoMeta>DOKUMEN TERINDEKS</MonoMeta>
              <MonoMeta>{docCount}</MonoMeta>
            </div>
            <div className="space-y-1">
              {docItems.map((doc) => (
                <div key={doc.id} className="flex min-h-11 items-center justify-between gap-2 rounded-control px-2 hover:bg-row-hover">
                  <span className="inline-flex min-w-0 items-center gap-2"><Icon name={doc.format === 'pdf' ? 'picture_as_pdf' : 'description'} className="shrink-0 text-[16px] text-primary" aria-hidden="true" /><span className="truncate font-body text-body-sm text-ink">{doc.name}</span></span>
                  <Icon name="check" className="shrink-0 text-[16px] text-primary" aria-hidden="true" />
                </div>
              ))}
              {docItems.length === 0 && !docs.loading && <p className="font-body text-body-sm text-ink-muted-strong">Belum ada dokumen terindeks.</p>}
            </div>
          </div>

          <div className="rounded-card border border-border-hairline bg-surface p-4">
            <MonoMeta className="mb-2 block">SNAPSHOT DATASET</MonoMeta>
            <dl className="space-y-2 font-body text-body-sm">
              {[
                ['Total baris', formatNumber(meta.data?.data.activeDataset.rowCount ?? null)],
                ['Dokumen', formatNumber(meta.data?.data.documents.indexed ?? null)],
                ['Potongan', formatNumber(meta.data?.data.documents.chunks ?? null)],
                ['Periode', periodLabel],
                ['Mesin', modeLabel],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-2 border-b border-border-hairline pb-2 last:border-0 last:pb-0">
                  <dt className="text-ink-muted-strong">{label}</dt>
                  <dd className="truncate text-right font-mono tabular text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>

      <Drawer open={historyOpen} onOpenChange={setHistoryOpen} side="left" width="300px" title="Percakapan">
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={() => void newConversation()}><Icon name="add" className="text-[14px]" aria-hidden="true" /> Percakapan baru</Button>
          {conversations.map((conv) => (
            <button key={conv.id} type="button" onClick={() => { void loadConversation(conv.id); setHistoryOpen(false); }} className={`min-h-11 rounded-control px-3 py-2 text-left focus-ring ${activeId === conv.id ? 'bg-row-hover text-primary' : 'text-ink hover:bg-row-hover'}`}>
              <span className="block truncate font-body text-body-md font-semibold">{conv.title}</span>
              {conv.preview && <span className="block truncate font-body text-body-sm text-ink-muted-strong">{conv.preview}</span>}
            </button>
          ))}
          {conversations.length === 0 && !list.loading && <p className="font-body text-body-sm text-ink-muted-strong">Belum ada percakapan.</p>}
        </div>
      </Drawer>

      <Drawer open={!!sourceDetail} onOpenChange={(open) => !open && setSourceDetail(null)} side="right" width="420px" title="Detail sitasi">
        {sourceDetail && (
          <div className="space-y-4">
            <div><MonoMeta className="mb-1 block">DOKUMEN</MonoMeta><p className="font-body text-body-md font-semibold text-ink">{sourceDetail.docTitle ?? sourceDetail.sourceId}</p></div>
            {sourceDetail.section && <div><MonoMeta className="mb-1 block">BAGIAN</MonoMeta><p className="font-body text-body-md text-ink">{sourceDetail.section}</p></div>}
            {sourceDetail.page != null && <div><MonoMeta className="mb-1 block">HALAMAN</MonoMeta><p className="font-body text-body-md text-ink">{sourceDetail.page}</p></div>}
            {sourceDetail.quote && <blockquote className="rounded-card border border-border-hairline bg-canvas p-3 font-body text-body-md text-ink">{sourceDetail.quote}</blockquote>}
          </div>
        )}
      </Drawer>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} title="Hapus percakapan?" description={deleteTarget ? `“${deleteTarget.title}” dan semua pesannya akan dihapus. Laporan tersimpan tetap tersedia.` : undefined}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setDeleteTarget(null)}>Batal</Button>
          <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>Hapus</Button>
        </div>
      </Dialog>
    </div>
  );
}
