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
import { AnswerCard } from '@/components/chat/answer-card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
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

const SUGGESTED = [
  'How many transactions were processed this month?',
  'Compare success rates across the last three months.',
  'Why did the transaction failure rate increase?',
  'What procedures should be followed when a transaction fails?',
];

function TypingIndicator() {
  // Purpose Gate: 3 dot stagger 120ms menandakan pemrosesan; berhenti saat jawaban/error tiba.
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-[typing-dot_1.2s_var(--ease-in-out-quart)_infinite] rounded-full bg-outline" />
        <span className="h-1.5 w-1.5 animate-[typing-dot_1.2s_var(--ease-in-out-quart)_infinite] rounded-full bg-outline [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-[typing-dot_1.2s_var(--ease-in-out-quart)_infinite] rounded-full bg-outline [animation-delay:240ms]" />
      </span>
      <span className="font-body-sm text-body-sm text-on-surface-variant">Composing answer…</span>
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

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);
  const autoSubmittedRef = useRef(false);

  const activeDatasetId =
    meta.data?.data.activeDataset.id ?? settings.data?.activeDatasetId ?? 'seed';
  const settingsDatasetName = settings.data?.datasets.find(
    (d) => d.id === settings.data?.activeDatasetId,
  )?.name;
  const datasetName = meta.data?.data.activeDataset.name ?? settingsDatasetName ?? 'n/a';
  const periodLabel = meta.data?.data.periodDefaults.label ?? 'n/a';
  const docCount = meta.data?.data.documents.total ?? docs.data?.total ?? 0;
  const docItems = docs.data?.items ?? [];
  const modeLabel = meta.data
    ? `${meta.data.capabilities.sql === 'sqlite' ? 'SQLite' : meta.data.capabilities.sql} · SQL + ${meta.data.capabilities.rag.toUpperCase()}`
    : 'SQLite · SQL + FTS5';

  // Composer auto-grow 48–160px (C-15), tanpa resize manual.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // Skema dataset aktif untuk Contextual Ledger (blueprint §4.3).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sources/${activeDatasetId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: DatasetSourceDetail | null) => {
        if (!cancelled) setSchema(json);
      })
      .catch(() => {
        if (!cancelled) setSchema(null);
      });
    return () => {
      cancelled = true;
    };
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
      setDetailError(err instanceof Error ? err.message : 'Could not load conversation.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Pilih percakapan pertama sekali saat daftar siap.
  useEffect(() => {
    if (initializedRef.current || list.loading || !list.data) return;
    initializedRef.current = true;
    if (list.data.items.length > 0) void loadConversation(list.data.items[0].id);
  }, [list.loading, list.data, loadConversation]);

  // ?question= dari landing → isi composer, kirim sekali setelah sesi siap.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('question');
    if (q) setDraft(q);
  }, []);

  // Auto-scroll ke pesan terbaru saat thread bertambah.
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }, [detail?.messages.length, sending]);

  // Fokus pindah ke awal jawaban baru setelah selesai (§D.3).
  useEffect(() => {
    if (!focusMessageId) return;
    const el = document.getElementById(`msg-${focusMessageId}`);
    if (el) {
      el.focus({ preventScroll: true });
      setFocusMessageId(null);
    }
  }, [focusMessageId]);

  const newConversation = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang }),
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
      toast({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not create conversation.',
      });
      return null;
    }
  }, [lang, list]);

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || sending) return;
      setSending(true);
      setSendError(null);
      setLastFailed(null);
      setDraft('');

      let convId = activeId;
      if (!convId) {
        convId = await newConversation();
        if (!convId) {
          setSending(false);
          setDraft(text);
          return;
        }
      }

      const tempUser: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        createdAt: new Date().toISOString(),
        content: text,
      };
      setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, tempUser] } : prev));

      const period =
        periodOverride ??
        (settings.data?.dateRange
          ? { start: settings.data.dateRange.start, end: settings.data.dateRange.end }
          : undefined);

      try {
        const res = await fetch(`/api/conversations/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
          const realUser: ChatMessage = {
            id: `${json.message.id}-u`,
            role: 'user',
            createdAt: json.message.createdAt,
            content: text,
          };
          return {
            conversation: {
              ...prev.conversation,
              title: json.conversation.title,
              messageCount: json.conversation.messageCount,
            },
            messages: [...withoutTemp, realUser, json.message],
          };
        });
        setFocusMessageId(json.message.id);
        list.retry();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Answer could not be composed.';
        setSendError(message);
        setLastFailed(text);
        setDetail((prev) =>
          prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempUser.id) } : prev,
        );
        setDraft(text);
      } finally {
        setSending(false);
      }
    },
    [activeId, sending, newConversation, periodOverride, settings.data, lang, list],
  );

  // Kirim ?question= sekali setelah sesi aktif tersedia.
  useEffect(() => {
    if (autoSubmittedRef.current || !activeId || sending) return;
    const q = new URLSearchParams(window.location.search).get('question');
    if (!q) return;
    autoSubmittedRef.current = true;
    void send(q);
  }, [activeId, sending, send]);

  const fillAndSend = (question: string) => {
    setDraft(question);
    void send(question);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/conversations/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      toast({ status: 'success', message: 'Conversation deleted.' });
      if (activeId === deleteTarget.id) {
        setActiveId(null);
        setDetail(null);
      }
      setDeleteTarget(null);
      setSessionOpen(false);
      list.retry();
    } catch (err) {
      toast({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not delete conversation.',
      });
    } finally {
      setDeleting(false);
    }
  };

  const saveReport = async (msg: ChatMessage) => {
    if (!activeId) return;
    setSavingReportId(msg.id);
    try {
      const res = await fetch(`/api/conversations/${activeId}/messages/${msg.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: ReportCreateResponse = await res.json();
      toast({
        status: 'success',
        message: `Report saved: ${json.report.title}`,
        action: 'Open report',
        onAction: () => {
          window.location.href = `/reports/${json.report.id}`;
        },
      });
    } catch (err) {
      toast({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not save report.',
      });
    } finally {
      setSavingReportId(null);
    }
  };

  const exportTranscript = async () => {
    if (!activeId) {
      toast({ status: 'error', message: 'No active conversation to export.' });
      return;
    }
    try {
      const res = await fetch(`/api/conversations/${activeId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json: ConversationDetailResponse = await res.json();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `tanyadata-transcript-${activeId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ status: 'success', message: 'Transcript downloaded.' });
    } catch (err) {
      toast({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not export transcript.',
      });
    }
  };

  const attachDocument = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    body.append('kind', 'document');
    try {
      const res = await fetch('/api/sources', { method: 'POST', body });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      toast({ status: 'success', message: 'Document attached. Indexing started.' });
      docs.retry();
      meta.retry();
    } catch (err) {
      toast({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not attach document.',
      });
    }
  };

  const selectDataset = (id: string) => {
    setContextMenu(null);
    void fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeDatasetId: id }),
    })
      .then(() => {
        settings.retry();
        meta.retry();
      })
      .catch(() => toast({ status: 'error', message: 'Could not switch dataset.' }));
  };

  const applyDateRange = () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      toast({ status: 'error', message: 'Choose a valid start and end date.' });
      return;
    }
    setPeriodOverride({ start: dateStart, end: dateEnd });
    setContextMenu(null);
    toast({ status: 'success', message: 'Date range applied to the next query.' });
  };

  const clearContext = () => {
    setAttachedDataset(false);
    setAttachedDocs(false);
    setPeriodOverride(null);
    setDateStart('');
    setDateEnd('');
    toast({ status: 'success', message: 'Context cleared.' });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send(draft);
    }
  };

  const copyQuestion = async () => {
    if (!lastFailed) return;
    try {
      await navigator.clipboard.writeText(lastFailed);
      toast({ status: 'success', message: 'Question copied.' });
    } catch {
      toast({ status: 'error', message: 'Could not copy question.' });
    }
  };

  const conversations = list.data?.items ?? [];
  const messages = detail?.messages ?? [];
  const activeTitle = detail?.conversation.title ?? conversations[0]?.title ?? 'New conversation';

  return (
    <div className="flex flex-col w-full">
      {/* Top Command & Session Utility Bar (code.html 5-49) */}
      <div className="px-margin py-space-sm bg-surface-container-lowest flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-md min-w-0">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-space-xs">
              <span className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-bold">
                AI Assistant
              </span>
              <span className="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed font-bold">
                AGENT ONLINE
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
              Ask questions, explore trends, and investigate business performance with telemetry-backed intelligence.
            </p>
          </div>
          <div className="hidden md:flex items-center gap-space-xs pl-space-md relative">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={sessionOpen}
              onClick={() => setSessionOpen((open) => !open)}
              className="flex items-center gap-1.5 px-space-sm py-1.5 rounded bg-surface-container-low hover:bg-surface-container text-left transition-colors focus-ring"
            >
              <Icon name="forum" className="text-[16px] text-primary" />
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                  Active Session
                </span>
                <span className="font-label-md text-label-md text-on-surface font-semibold truncate max-w-[200px]">
                  {activeTitle}
                </span>
              </div>
              <Icon name="expand_more" className="text-[16px] text-on-surface-variant ml-1" />
            </button>
            {sessionOpen && (
              <div
                className="absolute z-dropdown left-0 top-full mt-1 w-[300px] rounded-lg border border-outline-variant bg-surface-container-lowest p-1 shadow-lg"
                role="listbox"
                aria-label="Conversations"
              >
                <div className="flex items-center justify-between px-space-sm py-1">
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                    Conversations
                  </span>
                  <button
                    type="button"
                    onClick={() => void newConversation()}
                    className="flex items-center gap-1 text-primary font-label-md text-label-md hover:underline focus-ring"
                  >
                    <Icon name="add" className="text-[14px]" /> New chat
                  </button>
                </div>
                {list.loading && (
                  <div className="space-y-1 p-1">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                )}
                {list.error && (
                  <p className="px-space-sm py-2 font-body-sm text-body-sm text-error">{list.error}</p>
                )}
                {!list.loading && !list.error && conversations.length === 0 && (
                  <p className="px-space-sm py-2 font-body-sm text-body-sm text-on-surface-variant">
                    No conversations yet.
                  </p>
                )}
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group flex items-start gap-1 rounded px-space-xs py-1.5 ${
                      activeId === conv.id ? 'bg-primary-fixed' : 'hover:bg-surface-container'
                    }`}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={activeId === conv.id}
                      onClick={() => {
                        void loadConversation(conv.id);
                        setSessionOpen(false);
                      }}
                      className="min-w-0 flex-1 text-left focus-ring rounded-sm"
                    >
                      <span className="block truncate font-label-md text-label-md text-on-surface font-semibold">
                        {conv.title}
                      </span>
                      {conv.preview && (
                        <span className="block truncate font-body-sm text-body-sm text-on-surface-variant">
                          {conv.preview}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete conversation ${conv.title}`}
                      onClick={() => setDeleteTarget(conv)}
                      className="rounded-sm p-1 text-on-surface-variant hover:text-error focus-ring"
                    >
                      <Icon name="delete" className="text-[14px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          {/* Active Context Status Badge */}
          <div className="flex items-center gap-1.5 px-space-sm py-1.5 rounded bg-surface-container text-on-surface font-label-md text-label-md">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary-fixed-dim opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary-container" />
            </span>
            <span className="font-medium text-on-surface-variant">Context:</span>
            <span className="font-semibold text-primary truncate max-w-[200px]">{datasetName}</span>
            <span className="font-label-sm text-label-sm px-1 py-[0.2rem] rounded bg-surface-container-highest text-on-surface-variant font-bold">
              +{docCount} Docs
            </span>
          </div>
          <button
            id="exportBtn"
            type="button"
            onClick={() => void exportTranscript()}
            className="flex items-center gap-1.5 h-8 px-space-sm rounded bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md transition-colors shadow-sm focus-ring"
          >
            <Icon name="file_download" className="text-[16px] text-on-surface-variant" />
            <span>Export Transcript</span>
          </button>
          <button
            aria-label="Conversation history"
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex md:hidden items-center justify-center w-8 h-8 rounded bg-surface-container text-on-surface focus-ring"
          >
            <Icon name="forum" className="text-[18px]" />
          </button>
          <button
            aria-label="Toggle Context Panel"
            aria-expanded={panelOpen}
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            className="flex lg:hidden items-center justify-center w-8 h-8 rounded bg-surface-container text-on-surface focus-ring"
          >
            <Icon name="dock_to_left" className="text-[18px]" />
          </button>
        </div>
      </div>

      {/* Main 2-Column Split Workspace (code.html 50-548) */}
      <div className="flex flex-col lg:flex-row w-full items-start">
        {/* LEFT 72% */}
        <div className="w-full lg:w-[72%] flex flex-col p-space-md lg:p-margin space-y-space-lg">
          {/* Quick Prompt Recommendation Ribbon */}
          <div className="flex flex-col space-y-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant flex items-center gap-1">
                <Icon name="auto_awesome" className="text-[14px]" /> Suggested Inquiries
              </span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Click to query engine</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-xs">
              {SUGGESTED.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => fillAndSend(question)}
                  className="p-2.5 rounded bg-surface-container-lowest hover:bg-surface-container-low text-left transition-colors flex items-start justify-between group shadow-sm focus-ring"
                >
                  <span className="font-body-sm text-body-sm text-on-surface group-hover:text-primary transition-colors">
                    {question}
                  </span>
                  <Icon
                    name="arrow_forward"
                    className="text-[14px] text-on-surface-variant group-hover:text-primary ml-1 shrink-0"
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Analytical History Stream */}
          <div
            ref={threadRef}
            className="flex flex-col space-y-space-lg"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {detailLoading ? (
              <div className="space-y-space-md">
                <Skeleton className="h-16 w-2/3" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : detailError ? (
              <div className="rounded-lg bg-error-container p-space-md text-center">
                <p className="font-body-md text-body-md text-on-error-container">{detailError}</p>
                {activeId && (
                  <Button size="sm" variant="secondary" className="mt-2" onClick={() => void loadConversation(activeId)}>
                    Try again
                  </Button>
                )}
              </div>
            ) : messages.length === 0 && !sending ? (
              <div className="rounded-lg bg-surface-container-lowest p-space-md shadow-sm">
                <EmptyState
                  icon={<Icon name="forum" className="text-[24px]" />}
                  title="Start with a question"
                  description="Every answer includes its evidence: SQL for data, quotations for documents."
                />
                <div className="flex flex-wrap justify-center gap-2 pb-space-sm">
                  {SUGGESTED.slice(0, 3).map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => fillAndSend(question)}
                      className="px-space-sm py-1.5 rounded-full bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md shadow-sm transition-colors focus-ring"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex items-start justify-end gap-space-sm pl-space-xl">
                    <div className="flex flex-col items-end space-y-1 max-w-[85%]">
                      <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
                        <span>Local workspace</span>
                        <span>•</span>
                        <span>{new Date(m.createdAt).toISOString().slice(11, 19)} UTC</span>
                      </div>
                      <div className="px-space-md py-space-sm rounded-lg bg-surface-container-lowest text-on-surface shadow-sm">
                        <p className="font-body-lg text-body-lg font-medium text-primary">{m.content}</p>
                      </div>
                      <div className="flex items-center gap-2 font-label-sm text-label-sm text-on-surface-variant">
                        <span className="flex items-center gap-1">
                          <Icon name="dataset" className="text-[12px]" /> Dataset Scope: {periodLabel}
                        </span>
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary shrink-0" aria-hidden="true">
                      <Icon name="workspace" className="text-[18px]" />
                    </div>
                  </div>
                ) : (
                  <div
                    key={m.id}
                    id={`msg-${m.id}`}
                    tabIndex={-1}
                    className="flex animate-[stagger-in_180ms_var(--ease-out-quart)_both] items-start gap-space-sm pr-2 focus:outline-none"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-on-primary shrink-0 shadow-sm">
                      <Icon name="smart_toy" className="text-[18px]" />
                    </div>
                    <AnswerCard
                      message={m}
                      modeLabel={modeLabel}
                      conversationId={activeId ?? undefined}
                      onFollowUp={(q) => fillAndSend(q)}
                      onSaveReport={saveReport}
                      savingReport={savingReportId === m.id}
                      onOpenSource={setSourceDetail}
                      disabled={sending}
                    />
                  </div>
                ),
              )
            )}
            {sending && (
              <div className="flex items-start gap-space-sm">
                <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-on-primary shrink-0 shadow-sm">
                  <Icon name="smart_toy" className="text-[18px]" />
                </div>
                <TypingIndicator />
              </div>
            )}
            {sendError && (
              <div className="rounded-lg bg-error-container p-space-md">
                <p className="font-body-md text-body-md text-on-error-container">{sendError}</p>
                <div className="mt-2 flex gap-2">
                  {lastFailed && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => void send(lastFailed)}>
                        Try again
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void copyQuestion()}>
                        Copy question
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Message Composer Anchor (code.html 354-405) */}
          <div className="sticky bottom-4 z-30 pt-space-md">
            <div className="rounded-xl bg-surface-container-lowest p-space-sm shadow-xl flex flex-col space-y-space-xs">
              <div className="flex items-center justify-between px-space-xs gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {attachedDataset && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface">
                      <Icon name="table_chart" className="text-[14px] text-primary" />
                      <span className="max-w-[180px] truncate">{datasetName}</span>
                      <button
                        type="button"
                        aria-label="Remove dataset context"
                        onClick={() => setAttachedDataset(false)}
                        className="hover:text-error focus-ring rounded-sm"
                      >
                        <Icon name="close" className="text-[12px] text-on-surface-variant" />
                      </button>
                    </span>
                  )}
                  {attachedDocs && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface">
                      <Icon name="description" className="text-[14px] text-tertiary" />
                      <span>{docCount} Docs Attached</span>
                      <button
                        type="button"
                        aria-label="Remove document context"
                        onClick={() => setAttachedDocs(false)}
                        className="hover:text-error focus-ring rounded-sm"
                      >
                        <Icon name="close" className="text-[12px] text-on-surface-variant" />
                      </button>
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearContext}
                  className="font-label-sm text-label-sm text-on-surface-variant hover:text-error transition-colors flex items-center gap-1 focus-ring"
                >
                  <Icon name="mop" className="text-[14px]" />
                  <span>Clear Context</span>
                </button>
              </div>
              <div className="relative">
                <textarea
                  id="promptInput"
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={2}
                  maxLength={2000}
                  disabled={sending}
                  aria-label="Ask a question about your business data"
                  placeholder="Ask anything about your business data (e.g. trends, anomalies, procedures)..."
                  className="w-full resize-none p-space-sm rounded bg-surface-container-low focus:bg-surface-container-lowest font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none transition-all focus-ring"
                />
              </div>
              <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                <div className="flex items-center gap-space-xs">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    className="sr-only"
                    aria-label="Attach document"
                    onChange={(event) => void attachDocument(event)}
                  />
                  <button
                    type="button"
                    title="Attach Document"
                    aria-label="Attach Document"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1 font-label-md text-label-md focus-ring"
                  >
                    <Icon name="attach_file" className="text-[18px]" />
                    <span className="hidden sm:inline">Attach Document (+)</span>
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      title="Select SQL Table"
                      aria-label="Select SQL Table"
                      aria-expanded={contextMenu === 'dataset'}
                      onClick={() => setContextMenu(contextMenu === 'dataset' ? null : 'dataset')}
                      className="p-1.5 rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors focus-ring"
                    >
                      <Icon name="dataset" className="text-[18px]" />
                    </button>
                    {contextMenu === 'dataset' && (
                      <div
                        className="absolute z-dropdown bottom-full left-0 mb-1 w-[240px] rounded-lg border border-outline-variant bg-surface-container-lowest p-1 shadow-lg"
                        role="listbox"
                        aria-label="Select dataset"
                      >
                        {(meta.data?.data.datasetChoices ?? settings.data?.datasets ?? []).map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            role="option"
                            aria-selected={choice.id === activeDatasetId}
                            onClick={() => selectDataset(choice.id)}
                            className="block w-full rounded px-space-sm py-1.5 text-left font-label-md text-label-md text-on-surface hover:bg-surface-container transition-colors focus-ring"
                          >
                            {choice.name}
                          </button>
                        ))}
                        {(meta.data?.data.datasetChoices ?? settings.data?.datasets ?? []).length === 0 && (
                          <p className="px-space-sm py-1.5 font-body-sm text-body-sm text-on-surface-variant">
                            No datasets available
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      title="Filter Date Range"
                      aria-label="Filter Date Range"
                      aria-expanded={contextMenu === 'date'}
                      onClick={() => setContextMenu(contextMenu === 'date' ? null : 'date')}
                      className="p-1.5 rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors focus-ring"
                    >
                      <Icon name="date_range" className="text-[18px]" />
                    </button>
                    {contextMenu === 'date' && (
                      <div className="absolute z-dropdown bottom-full left-0 mb-1 w-[240px] rounded-lg border border-outline-variant bg-surface-container-lowest p-space-sm shadow-lg space-y-space-xs">
                        <label className="block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                          Start date
                          <input
                            type="date"
                            value={dateStart}
                            onChange={(e) => setDateStart(e.target.value)}
                            className="mt-1 w-full rounded bg-surface-container-low px-2 py-1 font-body-sm text-body-sm text-on-surface focus-ring"
                          />
                        </label>
                        <label className="block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                          End date
                          <input
                            type="date"
                            value={dateEnd}
                            onChange={(e) => setDateEnd(e.target.value)}
                            className="mt-1 w-full rounded bg-surface-container-low px-2 py-1 font-body-sm text-body-sm text-on-surface focus-ring"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={applyDateRange}
                          className="w-full rounded bg-primary-container text-on-primary px-space-sm py-1.5 font-label-md text-label-md focus-ring"
                        >
                          Apply range
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-label-sm text-label-sm text-on-surface-variant hidden sm:inline">
                    Ctrl + Enter to execute
                  </span>
                  <button
                    type="button"
                    disabled={sending || draft.trim().length === 0}
                    onClick={() => void send(draft)}
                    className="flex items-center gap-2 h-9 px-space-md rounded bg-primary-container text-on-primary hover:bg-primary transition-all font-label-md text-label-md shadow-sm focus-ring disabled:opacity-45"
                  >
                    <span className="font-semibold">{sending ? 'Sending…' : 'Send Query'}</span>
                    <span className="w-4 h-4 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
                      <Icon name="arrow_upward" className="text-[12px] font-bold" />
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT 28% - Contextual Ledger (code.html 407-546) */}
        <div
          id="contextPanel"
          className={`w-full lg:w-[28%] bg-surface-container-low p-space-md lg:p-margin flex-col space-y-space-md ${
            panelOpen ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Icon name="inventory_2" className="text-[18px] text-primary" />
              <span className="font-headline-sm text-headline-sm text-on-surface font-bold">Contextual Ledger</span>
            </div>
            <span className="font-label-sm text-label-sm px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-mono">
              READY
            </span>
          </div>

          {/* Active Dataset Schema Tree */}
          <div className="rounded-lg bg-surface-container-lowest p-space-sm shadow-sm space-y-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                <Icon name="account_tree" className="text-[14px]" /> Active Schema Tree
              </span>
              <span className="font-label-sm text-label-sm text-primary font-bold">
                {schema?.schema ? 1 : 0} Table(s)
              </span>
            </div>
            <div className="space-y-space-xs font-mono text-body-sm text-body-sm">
              {schema?.schema ? (
                <div className="p-2 rounded bg-surface-container-low space-y-1">
                  <div className="flex items-center justify-between text-on-surface font-semibold gap-2">
                    <span className="flex items-center gap-1 text-primary min-w-0">
                      <Icon name="table" className="text-[14px]" />
                      <span className="truncate">{schema.schema.tableName}</span>
                    </span>
                    <span className="text-on-surface-variant font-label-sm text-label-sm tabular shrink-0">
                      {formatNumber(schema.source.rowCount ?? null)} rows
                    </span>
                  </div>
                  <div className="pl-4 space-y-0.5 text-on-surface-variant text-[10px]">
                    {schema.schema.columns.map((column) => (
                      <div key={column.name} className="flex justify-between gap-2">
                        <span className="truncate">• {column.name}</span>
                        <span className="shrink-0">{column.type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="font-body-sm text-body-sm text-on-surface-variant">No schema available.</p>
              )}
            </div>
          </div>

          {/* Indexed Documents */}
          <div className="rounded-lg bg-surface-container-lowest p-space-sm shadow-sm space-y-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                <Icon name="folder_special" className="text-[14px]" /> Indexed Documents (RAG)
              </span>
              <span className="font-label-sm text-label-sm px-1.5 py-[0.2rem] rounded bg-secondary-fixed text-on-secondary-fixed font-bold">
                {docCount} ACTIVE
              </span>
            </div>
            <div className="space-y-space-xs">
              {docItems.map((doc) => (
                <div
                  key={doc.id}
                  className="p-2 rounded bg-surface-container-low flex items-center justify-between hover:bg-surface-container transition-colors gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      name={doc.format === 'pdf' ? 'picture_as_pdf' : 'description'}
                      className={`text-[16px] shrink-0 ${doc.format === 'pdf' ? 'text-tertiary' : 'text-primary'}`}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="font-label-md text-label-md text-on-surface font-semibold truncate">
                        {doc.name}
                      </span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant">
                        Indexed · {formatNumber(doc.chunkCount ?? null)} chunks ·{' '}
                        {formatNumber(doc.sizeBytes == null ? null : Math.round(doc.sizeBytes / 1024))}KB
                      </span>
                    </div>
                  </div>
                  <Icon name="check_circle" className="text-[14px] text-primary shrink-0" />
                </div>
              ))}
              {docItems.length === 0 && !docs.loading && (
                <p className="font-body-sm text-body-sm text-on-surface-variant">No indexed documents.</p>
              )}
            </div>
          </div>

          {/* Dataset Snapshot (mengganti angka fiktif Stitch) */}
          <div className="rounded-lg bg-surface-container-lowest p-space-sm shadow-sm space-y-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                <Icon name="query_stats" className="text-[14px]" /> Dataset Snapshot
              </span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Snapshot</span>
            </div>
            <div className="space-y-space-xs font-label-md text-label-md">
              <div className="flex items-center justify-between py-1 border-b border-surface-variant gap-2">
                <span className="text-on-surface-variant">Total Rows</span>
                <span className="font-semibold text-on-surface font-mono tabular">
                  {formatNumber(meta.data?.data.activeDataset.rowCount ?? null)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-surface-variant gap-2">
                <span className="text-on-surface-variant">Documents Indexed</span>
                <span className="font-semibold text-on-surface font-mono tabular">
                  {formatNumber(meta.data?.data.documents.indexed ?? null)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-surface-variant gap-2">
                <span className="text-on-surface-variant">Indexed Chunks</span>
                <span className="font-semibold text-on-surface font-mono tabular">
                  {formatNumber(meta.data?.data.documents.chunks ?? null)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-surface-variant gap-2">
                <span className="text-on-surface-variant">Period</span>
                <span className="font-semibold text-on-surface font-mono truncate max-w-[140px]">
                  {periodLabel}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 gap-2">
                <span className="text-on-surface-variant">Engine</span>
                <span className="font-semibold text-on-surface font-mono truncate max-w-[140px]">{modeLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile history drawer */}
      <Drawer open={historyOpen} onOpenChange={setHistoryOpen} side="left" width="300px" title="Conversations">
        <div className="flex flex-col gap-space-xs">
          <Button size="sm" variant="secondary" onClick={() => void newConversation()}>
            <Icon name="add" className="text-[14px]" /> New chat
          </Button>
          {conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              onClick={() => {
                void loadConversation(conv.id);
                setHistoryOpen(false);
              }}
              className={`rounded px-space-sm py-1.5 text-left font-label-md text-label-md focus-ring ${
                activeId === conv.id ? 'bg-primary-fixed text-primary' : 'text-on-surface hover:bg-surface-container'
              }`}
            >
              <span className="block truncate font-semibold">{conv.title}</span>
              {conv.preview && <span className="block truncate font-body-sm text-body-sm">{conv.preview}</span>}
            </button>
          ))}
          {conversations.length === 0 && !list.loading && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">No conversations yet.</p>
          )}
        </div>
      </Drawer>

      {/* Source detail drawer */}
      <Drawer
        open={!!sourceDetail}
        onOpenChange={(open) => !open && setSourceDetail(null)}
        side="right"
        width="420px"
        title="Citation detail"
      >
        {sourceDetail && (
          <div className="space-y-space-md">
            <div>
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                Document
              </span>
              <p className="font-label-md text-label-md font-bold text-on-surface">
                {sourceDetail.docTitle ?? sourceDetail.sourceId}
              </p>
            </div>
            {sourceDetail.section && (
              <div>
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Section
                </span>
                <p className="font-body-md text-body-md text-on-surface">{sourceDetail.section}</p>
              </div>
            )}
            {sourceDetail.page != null && (
              <div>
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Page
                </span>
                <p className="font-body-md text-body-md text-on-surface">{sourceDetail.page}</p>
              </div>
            )}
            {sourceDetail.quote && (
              <blockquote className="rounded-lg bg-surface-container-low p-space-sm font-body-md text-body-md text-on-surface">
                {sourceDetail.quote}
              </blockquote>
            )}
            {sourceDetail.score != null && (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Match score: {formatNumber(Math.round(sourceDetail.score * 100))}%
              </p>
            )}
          </div>
        )}
      </Drawer>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete conversation?"
        description={
          deleteTarget
            ? `“${deleteTarget.title}” and all its messages will be deleted. Saved reports remain available.`
            : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
