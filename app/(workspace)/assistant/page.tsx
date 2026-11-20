'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Send, History, MessageSquare, Check } from 'lucide-react';
import type {
  ChatMessage,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummary,
  MetaResponse,
  ReportCreateResponse,
  SendMessageResponse,
  SettingsResponse,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { useI18n } from '@/lib/ui/i18n-provider';
import { formatDateId } from '@/lib/ui/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { EngineIndicator } from '@/components/ui/engine-indicator';
import { AnswerCard } from '@/components/chat/answer-card';
import { toast } from '@/components/ui/toaster';

const DEMO_SCENARIOS: { id: string; label: string; question: string }[] = [
  { id: 'total-bulan-ini', label: 'Total bulan ini', question: 'Berapa total transaksi pada bulan ini?' },
  { id: 'tren-3-bulan', label: 'Tren 3 bulan', question: 'Apakah tingkat keberhasilan transaksi mengalami perubahan dalam tiga bulan terakhir?' },
  { id: 'akar-kegagalan', label: 'Akar kegagalan', question: 'Mengapa tingkat kegagalan transaksi meningkat dibandingkan bulan sebelumnya?' },
  { id: 'sop-dokumen', label: 'Prosedur SOP', question: 'Apa prosedur yang harus dilakukan ketika transaksi gagal?' },
  { id: 'kontribusi-kanal', label: 'Kontribusi kanal', question: 'Kanal mana yang paling berkontribusi terhadap peningkatan kegagalan tersebut?' },
];

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-outline" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-outline [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-outline [animation-delay:240ms]" />
      </span>
      <span className="font-body text-body-sm text-on-surface-variant">Menyusun jawaban…</span>
    </div>
  );
}

export default function AssistantPage() {
  const { t, lang } = useI18n();
  const list = useApi<ConversationListResponse>('/api/conversations?limit=50');
  const meta = useApi<MetaResponse>('/api/meta');
  const settings = useApi<SettingsResponse>('/api/settings');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savingReportId, setSavingReportId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Fokus pindah ke awal jawaban baru setelah selesai (§D.3), bukan saat sesi dibuka.
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // C-15: composer auto-grow 48–160px, tanpa resize manual (§4.10).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

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
      setDetailError(err instanceof Error ? err.message : 'Gagal memuat percakapan.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Pilih percakapan pertama saat daftar siap (sekali).
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || list.loading || !list.data) return;
    initializedRef.current = true;
    if (list.data.items.length > 0) {
      void loadConversation(list.data.items[0].id);
    }
  }, [list.loading, list.data, loadConversation]);

  // Auto-scroll ke bawah saat pesan bertambah.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
      list.retry();
      return conv.id;
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal membuat percakapan.' });
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

      // Optimistic user bubble.
      const tempUser: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        createdAt: new Date().toISOString(),
        content: text,
      };
      setDetail((prev) =>
        prev
          ? { ...prev, messages: [...prev.messages, tempUser] }
          : prev,
      );

      const period = settings.data?.dateRange
        ? { start: settings.data.dateRange.start, end: settings.data.dateRange.end }
        : undefined;

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
            conversation: { ...prev.conversation, title: json.conversation.title, messageCount: json.conversation.messageCount },
            messages: [...withoutTemp, realUser, json.message],
          };
        });
        setFocusMessageId(json.message.id);
        list.retry();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Jawaban gagal disusun.';
        setSendError(msg);
        setLastFailed(text);
        setDetail((prev) => (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempUser.id) } : prev));
        setDraft(text);
      } finally {
        setSending(false);
      }
    },
    [activeId, sending, newConversation, settings.data, lang, list],
  );

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
      if (activeId === deleteTarget.id) {
        setActiveId(null);
        setDetail(null);
      }
      setDeleteTarget(null);
      list.retry();
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal menghapus percakapan.' });
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
        message: `Laporan tersimpan: ${json.report.title}`,
        action: 'Buka laporan',
        onAction: () => {
          window.location.href = `/reports/${json.report.id}`;
        },
      });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal menyimpan laporan.' });
    } finally {
      setSavingReportId(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const copyQuestion = async () => {
    if (!lastFailed) return;
    try {
      await navigator.clipboard.writeText(lastFailed);
      toast({ status: 'success', message: 'Pertanyaan tersalin.' });
    } catch {
      toast({ status: 'error', message: 'Gagal menyalin pertanyaan.' });
    }
  };

  const conversations = list.data?.items ?? [];
  const messages = detail?.messages ?? [];
  const llmOn = meta.data?.capabilities.llm === true;

  const conversationList = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Percakapan</span>
        <Button size="sm" variant="secondary" onClick={() => void newConversation()}>
          <Plus className="h-3.5 w-3.5" />
          {t('button.newChat')}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {list.loading ? (
          <div className="space-y-2 p-1">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.error ? (
          <div className="p-2 text-center">
            <p className="font-body text-body-sm text-error">{list.error}</p>
            <Button size="sm" variant="ghost" onClick={list.retry}>Coba lagi</Button>
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-6 w-6" />}
            title="Belum ada percakapan"
            description="Mulai pertanyaan pertama Anda."
            className="py-8"
            action={
              <Button size="sm" variant="secondary" onClick={() => void newConversation()}>
                <Plus className="h-3.5 w-3.5" />
                Percakapan baru
              </Button>
            }
          />
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <div
                  className={`group flex items-start gap-1 rounded-md px-2 py-2 transition-colors duration-[var(--motion-fast)] ${
                    activeId === c.id ? 'bg-primary-fixed' : 'hover:bg-surface-container'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      void loadConversation(c.id);
                      setHistoryOpen(false);
                    }}
                    className="min-w-0 flex-1 text-left focus-ring rounded-sm"
                  >
                    <span className={`block truncate font-body text-label-md ${activeId === c.id ? 'text-primary font-semibold' : 'text-on-surface'}`}>
                      {c.title}
                    </span>
                    {c.preview && (
                      <span className="block truncate font-body text-body-sm text-on-surface-variant">{c.preview}</span>
                    )}
                    <span className="block font-body text-body-sm text-on-surface-variant">
                      {formatDateId((c.lastMessageAt ?? c.createdAt).slice(0, 10))} · {c.messageCount} pesan
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus percakapan ${c.title}`}
                    onClick={() => setDeleteTarget(c)}
                    className="rounded-sm p-1 text-on-surface-variant opacity-0 transition-opacity duration-[var(--motion-fast)] hover:text-error group-hover:opacity-100 focus-visible:opacity-100 focus-ring"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Conversation sidebar (desktop) */}
      <aside className="hidden w-66 shrink-0 border-r border-outline-variant bg-surface-container-lowest lg:block" aria-label="Daftar percakapan">
        {conversationList}
      </aside>

      {/* Thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Chat header */}
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant bg-surface-container-lowest px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => setHistoryOpen(true)} aria-label="Riwayat percakapan">
              <History className="h-4 w-4" />
            </Button>
            <h1 className="truncate font-display text-headline-sm font-semibold text-on-surface">
              {detail?.conversation.title ?? t('nav.assistant')}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-body text-body-sm text-on-surface-variant">
              {meta.data?.data.activeDataset.name ?? settings.data?.datasets.find((d) => d.id === settings.data?.activeDatasetId)?.name ?? 'Dataset aktif'}
            </span>
            {/* C-10: indikator mesin bersama (§4.5); label & status dari /api/meta capabilities. */}
            <EngineIndicator
              online={!!meta.data && !meta.error}
              label={meta.data
                ? `Mesin: ${meta.data.capabilities.sql === 'sqlite' ? 'SQLite' : meta.data.capabilities.sql} · SQL + ${meta.data.capabilities.rag.toUpperCase()}`
                : undefined}
            />
            {/* C-11: kondisi aktif = badge statis dengan Check, bukan spinner permanen. */}
            {llmOn && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 font-body text-label-sm font-semibold text-on-surface-variant">
                <Check className="h-3 w-3" aria-hidden="true" />
                LLM aktif
              </span>
            )}
            <Button size="sm" variant="secondary" className="lg:hidden" onClick={() => void newConversation()}>
              <Plus className="h-3.5 w-3.5" />
              Baru
            </Button>
          </div>
        </header>

        {/* Messages */}
        <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-relevant="additions">
          <div className="mx-auto max-w-[820px] space-y-5">
            {detailLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-2/3" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : detailError ? (
              <div className="rounded-md bg-error-container p-4 text-center">
                <p className="font-body text-body-md text-on-error-container">{detailError}</p>
                {activeId && <Button size="sm" variant="secondary" className="mt-2" onClick={() => void loadConversation(activeId)}>Coba lagi</Button>}
              </div>
            ) : messages.length === 0 && !sending ? (
              <div className="space-y-4 py-6">
                <EmptyState
                  icon={<MessageSquare className="h-6 w-6" />}
                  title="Mulai dari pertanyaan ini"
                  description="Jawaban selalu menyertakan sumber: SQL untuk data, kutipan untuk dokumen."
                />
                <div className="flex flex-wrap justify-center gap-2">
                  {[t('assistant.followUp1'), t('assistant.followUp2'), t('assistant.followUp3')].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void send(q)}
                      className="rounded-full border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-body text-label-md text-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <div className="pt-2">
                  <p className="mb-2 text-center font-body text-label-sm uppercase tracking-wider text-on-surface-variant">Coba contoh</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {DEMO_SCENARIOS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        title={s.question}
                        onClick={() => void send(s.question)}
                        className="rounded-full bg-surface-container px-3 py-1.5 font-body text-label-md text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:bg-surface-container-high hover:text-on-surface focus-ring"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-br-sm bg-surface-container-high px-4 py-2.5 font-body text-body-md text-on-surface">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} id={`msg-${m.id}`} tabIndex={-1} className="flex items-start gap-2.5 focus:outline-none">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary font-body text-label-sm font-bold text-on-primary" aria-hidden="true">
                      T
                    </span>
                    <div className="min-w-0 flex-1">
                      <AnswerCard
                        message={m}
                        onSaveReport={saveReport}
                        savingReport={savingReportId === m.id}
                        onFollowUp={(q) => void send(q)}
                        disabled={sending}
                      />
                    </div>
                  </div>
                ),
              )
            )}
            {sending && (
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary font-body text-label-sm font-bold text-on-primary" aria-hidden="true">T</span>
                <TypingIndicator />
              </div>
            )}
            {sendError && (
              <div className="rounded-md bg-error-container p-3">
                <p className="font-body text-body-md text-on-error-container">{sendError}</p>
                <div className="mt-2 flex gap-2">
                  {lastFailed && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => void send(lastFailed)}>Coba lagi</Button>
                      <Button size="sm" variant="ghost" onClick={() => void copyQuestion()}>Salin pertanyaan</Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-outline-variant bg-surface-container-lowest px-4 py-3">
          <div className="mx-auto max-w-[820px]">
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-2 shadow-xs">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={2000}
                disabled={sending}
                aria-label="Tulis pertanyaan"
                placeholder="Tanyakan sesuatu tentang data atau dokumen…"
                className="max-h-40 min-h-12 w-full resize-none overflow-y-auto bg-transparent px-2 py-1 font-body text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none"
              />
              <div className="flex items-center justify-between px-1 pt-1">
                <span className="font-body text-body-sm text-on-surface-variant">Enter untuk mengirim · Shift+Enter baris baru</span>
                <Button variant="primary" size="sm" disabled={sending || draft.trim().length === 0} onClick={() => void send(draft)} aria-label={t('button.send')}>
                  <Send className="h-3.5 w-3.5" />
                  {t('button.send')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile history drawer */}
      <Drawer open={historyOpen} onOpenChange={setHistoryOpen} side="left" width="300px" title="Percakapan">
        {conversationList}
      </Drawer>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Hapus percakapan?"
        description={deleteTarget ? `“${deleteTarget.title}” akan dihapus beserta seluruh pesannya. Laporan yang sudah dibuat tetap tersimpan.` : undefined}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setDeleteTarget(null)}>{t('button.cancel')}</Button>
          <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>{t('button.delete')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
