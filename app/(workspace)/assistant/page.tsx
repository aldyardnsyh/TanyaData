'use client';

/**
 * Halaman Asisten — chat window (app/(workspace)/assistant/page.tsx).
 * Layout chat modern: sidebar riwayat (scroll sendiri) + kolom chat
 * (header → area pesan yang menggulir → composer). Semua state dan logika
 * API tinggal di sini; render dipecah ke components/chat/*.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  ChatMessage,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummary,
  MetaResponse,
  ReportCreateResponse,
  SendMessageResponse,
  SettingsResponse,
  ShareCreateResponse,
  SourceCitation,
  SourcesListResponse,
} from '@/lib/contracts/http';
import { useApi } from '@/lib/ui/fetch-hooks';
import { apiUrl } from '@/lib/ui/api-base';
import { useI18n } from '@/lib/ui/i18n-provider';
import { citationTargetPath } from '@/lib/ui/citation-target';
import { ChatSidebar } from '@/components/chat/chat-sidebar';
import { ChatHeader } from '@/components/chat/chat-header';
import { ChatMessages } from '@/components/chat/chat-messages';
import { ChatComposer } from '@/components/chat/chat-composer';
import { SectionRule } from '@/components/signal/section-rule';
import { AnimatedModal } from '@/components/signal/animated-modal';
import { Icon } from '@/components/ui/icons';
import { toast } from '@/components/ui/toaster';

/**
 * Salin teks ke papan klip dengan dua jalur: Clipboard API lalu fallback
 * `document.execCommand('copy')` untuk browser lama / konteks non-HTTPS.
 * Mengembalikan `false` bila KEDUANYA gagal, supaya pemanggil tidak pernah
 * mengklaim sukses palsu. Teks kosong selalu gagal (tidak pernah menyalin '').
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API ada tetapi menolak (izin / non-HTTPS): lanjut ke fallback.
  }
  return copyWithExecCommand(text);
}

/** Fallback sinkron untuk browser tanpa Clipboard API. */
function copyWithExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || !text) return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  let copied = false;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(area);
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
  }
  return copied;
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
  // Tautan absolut yang benar-benar diterima server; null = belum ada.
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  // 'idle' = belum dicoba, 'copied' = tersalin, 'manual' = dua jalur gagal.
  const [shareCopy, setShareCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [includeCitations, setIncludeCitations] = useState(true);
  const [includeIdentity, setIncludeIdentity] = useState(true);
  const [savingReportId, setSavingReportId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const initializedRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  // Cermin activeId untuk closure (send/attachFromSource) agar alur otomatis
  // (?attach=&question=) memakai percakapan yang sama, bukan membuat dua.
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const docCount = meta.data?.data.documents.total ?? docs.data?.total ?? 0;
  // null = belum tahu (meta/docs masih dimuat atau gagal): jangan klaim kosong.
  const hasDocuments = meta.loading || docs.loading || meta.error
    ? null
    : docCount > 0;
  // RAG-first: konteks yang ditampilkan adalah DOKUMEN (attachment aktif atau
  // seluruh dokumen terindeks), bukan dataset SQLite — dataset hanya sumber
  // SQL di belakang layar dan dipilih dari Pengaturan.
  const docGroup = detail?.activeAttachments ?? [];
  const contextLabel = docGroup.length > 1
    ? `${docGroup.length} dokumen (kelompok)`
    : detail?.activeAttachment?.name ?? `Semua dokumen (${docCount})`;

  const loadConversation = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(apiUrl(`/api/conversations/${id}`));
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

  // Halaman Asisten SELALU terbuka dalam keadaan bersih (tanpa memuat
  // percakapan lama) — percakapan baru tercipta otomatis saat pesan pertama
  // dikirim atau dokumen dilampirkan. Riwayat tinggal dipilih dari sidebar.

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('question');
    if (q) setDraft(q);
  }, []);

  const send = useCallback(async (content: string) => {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    setLastFailed(null);
    setDraft('');

    let convId = activeIdRef.current;
    if (!convId) {
      try {
        const res = await fetch(apiUrl('/api/conversations'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        const json = await res.json();
        const conv: ConversationSummary = json.conversation;
        setDetail({ conversation: conv, activeAttachment: null, activeAttachments: [], messages: [] });
        setActiveId(conv.id);
        convId = conv.id;
        list.retry();
      } catch (err) {
        toast({ status: 'error', message: err instanceof Error ? err.message : 'Percakapan baru gagal dibuat.' });
        setSending(false);
        setDraft(text);
        return;
      }
    }

    const tempUser: ChatMessage = { id: `temp-${Date.now()}`, role: 'user', createdAt: new Date().toISOString(), content: text };
    setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, tempUser] } : prev));

    const period = settings.data?.dateRange ? { start: settings.data.dateRange.start, end: settings.data.dateRange.end } : undefined;

    try {
      const res = await fetch(apiUrl(`/api/conversations/${convId}/messages`), {
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
          activeAttachments: prev.activeAttachments,
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
  }, [sending, settings.data, lang, list]);

  const newConversation = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(apiUrl('/api/conversations'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      const conv: ConversationSummary = json.conversation;
      setDetail({ conversation: conv, activeAttachment: null, activeAttachments: [], messages: [] });
      setActiveId(conv.id);
      setHistoryOpen(false);
      list.retry();
      return conv.id;
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Percakapan baru gagal dibuat.' });
      return null;
    }
  }, [lang, list]);

  // "Tanya dokumen ini" dari detail sumber: arahkan konteks chat dulu, lalu
  // auto-send ?question bila ada. Tanpa percakapan aktif → buat otomatis
  // (user tidak wajib klik "Percakapan baru" dulu).
  const attachFromSource = useCallback(async (sourceId: string, name: string) => {
    let convId = activeIdRef.current;
    if (!convId) {
      convId = await newConversation();
      if (!convId) return;
    }
    try {
      const res = await fetch(apiUrl('/api/attachments'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // C2: dataset inti dokumen = id sumbernya sendiri (hasil unifikasi).
        body: JSON.stringify({ datasetId: sourceId, sourceId, name, activeInConversation: convId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      await loadConversation(convId);
      toast({ status: 'success', message: `Konteks diarahkan ke ${name}.` });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal melampirkan dokumen.' });
    }
  }, [loadConversation, newConversation]);

  // Alur otomatis dari halaman lain (?attach=&question=): jalan sekali saat
  // bootstrap, TANPA menunggu percakapan dipilih — attachFromSource/send
  // membuat percakapan sendiri bila belum ada (activeIdRef).
  useEffect(() => {
    if (autoSubmittedRef.current || list.loading) return;
    const params = new URLSearchParams(window.location.search);
    const attachId = params.get('attach');
    const attachSourceName = params.get('source');
    const q = params.get('question');
    if (!q && !attachId) return;
    autoSubmittedRef.current = true;
    void (async () => {
      if (attachId) await attachFromSource(attachId, attachSourceName ?? '');
      if (q) await send(q);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.loading]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/conversations/${deleteTarget.id}`), { method: 'DELETE' });
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

  /** Patch percakapan dari menu ⋯ sidebar: ganti nama / grup / semat. */
  const patchConversation = async (conv: ConversationSummary, patch: { title?: string; group?: string | null; pinned?: boolean }) => {
    try {
      const res = await fetch(apiUrl(`/api/conversations/${conv.id}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      toast({
        status: 'success',
        message: patch.pinned !== undefined
          ? (patch.pinned ? 'Percakapan disematkan.' : 'Sematan dilepas.')
          : patch.group !== undefined
            ? (patch.group ? `Dipindahkan ke grup "${patch.group}".` : 'Dikeluarkan dari grup.')
            : 'Judul percakapan diperbarui.',
      });
      list.retry();
      if (activeId === conv.id) {
        setDetail((prev) => (prev ? { ...prev, conversation: { ...prev.conversation, title: json.conversation.title ?? prev.conversation.title } } : prev));
      }
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal memperbarui percakapan.' });
      throw err;
    }
  };

  const saveReport = async (msg: ChatMessage) => {
    if (!activeId) return;
    setSavingReportId(msg.id);
    try {
      const res = await fetch(apiUrl(`/api/conversations/${activeId}/messages/${msg.id}/report`), {
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

  /** Reset dialog share ke kondisi awal. Stabil agar focus-trap modal tidak di-reset tiap render. */
  const closeShare = useCallback(() => {
    setShareTarget(null);
    setShareState('default');
    setShareError(null);
    setShareUrl(null);
    setShareCopy('idle');
  }, []);

  /**
   * Coba salin tautan yang SUDAH ada. Bila Clipboard API dan execCommand
   * sama-sama gagal, tampilkan instruksi salin manual di dialog dan beri tahu
   * sekali lewat toast error. Tidak pernah mengklaim sukses tanpa bukti.
   */
  const attemptCopyShare = async (url: string) => {
    if (!url) return;
    const copied = await copyToClipboard(url);
    if (copied) {
      setShareCopy('copied');
      toast({ status: 'success', message: 'Tautan disalin.' });
      return;
    }
    setShareCopy('manual');
    toast({ status: 'error', message: 'Penyalinan otomatis diblokir. Salin tautan dari kotak di dialog.' });
  };

  /** Konfirmasi dulu (C-09), baru POST /api/share. Tautan tidak dibuat saat Batal. */
  const confirmShare = async () => {
    if (!activeId || !shareTarget) return;
    setShareState('loading');
    setShareError(null);
    setShareUrl(null);
    setShareCopy('idle');
    try {
      const res = await fetch(apiUrl('/api/share'), {
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
      const json: ShareCreateResponse = await res.json();
      const relative = json.share?.url;
      const shareId = json.share?.id;
      // Fail-closed: tanpa id/url yang valid, tidak ada tautan untuk disalin.
      if (typeof relative !== 'string' || relative.length === 0 || typeof shareId !== 'string' || shareId.length === 0) {
        throw new Error('Tautan tidak diterima dari server.');
      }
      const absolute = new URL(relative, window.location.origin).toString();
      setShareUrl(absolute);
      setShareState('success');
      // Salin otomatis sekali; bila gagal, tautan tetap terlihat di dialog.
      const copied = await copyToClipboard(absolute);
      if (copied) {
        setShareCopy('copied');
        toast({ status: 'success', message: 'Tautan disalin. Tempel di mana saja.' });
      } else {
        setShareCopy('manual');
        toast({ status: 'error', message: 'Tautan dibuat, tetapi penyalinan otomatis diblokir. Salin dari kotak di dialog.' });
      }
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Tautan gagal dibuat.');
      setShareState('error');
    }
  };

  const attachDocument = async (file: File) => {
    const body = new FormData();
    body.append('file', file); body.append('kind', 'document');
    try {
      const res = await fetch(apiUrl('/api/sources'), { method: 'POST', body });
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

  // Kelompok dokumen (NotebookLM-style): centang beberapa dokumen sekaligus
  // sebagai basis pengetahuan percakapan; tanpa percakapan aktif → buat baru.
  const attachDocuments = useCallback(async (docs: Array<{ id: string; name: string }>) => {
    let convId = activeIdRef.current;
    if (!convId) {
      convId = await newConversation();
      if (!convId) return;
    }
    try {
      for (const doc of docs) {
        const res = await fetch(apiUrl('/api/attachments'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ datasetId: doc.id, sourceId: doc.id, name: doc.name, activeInConversation: convId }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
        }
      }
      await loadConversation(convId);
      toast({
        status: 'success',
        message: docs.length > 1
          ? `Kelompok ${docs.length} dokumen dijadikan konteks percakapan.`
          : `Konteks diarahkan ke ${docs[0].name}.`,
      });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal melampirkan dokumen.' });
    }
  }, [loadConversation, newConversation]);

  /** FR-C.1-2: lepas SEMUA attachment aktif dari percakapan. */
  const detachAttachment = async () => {
    const atts = detail?.activeAttachments ?? [];
    if (!atts.length) {
      toast({ status: 'success', message: 'Tidak ada dokumen dalam konteks.' });
      return;
    }
    try {
      for (const att of atts) {
        const res = await fetch(apiUrl(`/api/attachments/${att.id}`), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeInConversation: null }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      if (activeId) await loadConversation(activeId);
      toast({ status: 'success', message: 'Konteks dokumen dilepas. Pertanyaan berikutnya memakai seluruh sumber.' });
    } catch (err) {
      toast({ status: 'error', message: err instanceof Error ? err.message : 'Gagal melepas konteks.' });
    }
  };

  const copyQuestion = async () => {
    if (!lastFailed) return;
    try { await navigator.clipboard.writeText(lastFailed); toast({ status: 'success', message: 'Pertanyaan disalin.' }); }
    catch { toast({ status: 'error', message: 'Pertanyaan gagal disalin.' }); }
  };

  const conversations = list.data?.items ?? [];
  const messages = detail?.messages ?? [];
  const activeTitle = detail?.conversation.title ?? 'Percakapan baru';
  const sensitive = Boolean(shareTarget?.sources?.some((s) => s.kind === 'document'));

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] overflow-hidden md:h-[calc(100dvh-3.5rem)]" data-nav-theme="light" aria-label="Asisten analisis percakapan">
      {/* Sidebar riwayat: kolom tersendiri, scroll independen dari area pesan. */}
      <aside className="hidden w-rail-expanded shrink-0 flex-col overflow-hidden border-r border-[var(--border-hairline)] bg-porcelain lg:flex" aria-label="Daftar percakapan">
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          loading={list.loading}
          error={list.error}
          onSelect={(id) => void loadConversation(id)}
          onDelete={setDeleteTarget}
          onPatch={patchConversation}
          onRetry={list.retry}
        />
      </aside>

      {/* Kolom chat: header → area pesan (satu-satunya yang scroll) → composer. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          title={activeTitle}
          loading={detailLoading}
          onNew={() => void newConversation()}
          onOpenHistory={() => setHistoryOpen(true)}
        />
        <ChatMessages
          messages={messages}
          docCount={docCount}
          hasDocuments={hasDocuments}
          detailLoading={detailLoading}
          detailError={detailError}
          sending={sending}
          sendError={sendError}
          lastFailed={lastFailed}
          savingReportId={savingReportId}
          onFollowUp={(q) => void send(q)}
          onShare={setShareTarget}
          onSaveReport={(m) => void saveReport(m)}
          onRetry={() => { if (activeId) void loadConversation(activeId); else if (lastFailed) void send(lastFailed); }}
          onCopyQuestion={() => void copyQuestion()}
          onOpenCitation={setSourceDetail}
        />
        <ChatComposer
          draft={draft}
          sending={sending}
          contextLabel={contextLabel}
          hasAttachment={Boolean(detail?.activeAttachment)}
          docs={docs.data?.items ?? []}
          onDraftChange={setDraft}
          onSend={() => void send(draft)}
          onDetach={() => void detachAttachment()}
          onFilePick={(f) => void attachDocument(f)}
          onAttachSources={(docs) => void attachDocuments(docs)}
        />
      </div>

      {/* Riwayat mobile (sheet) di bawah 1024. */}
      {historyOpen && (
        <div className="fixed inset-0 z-drawer lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
          <nav className="absolute inset-y-0 left-0 w-rail-expanded overflow-hidden bg-porcelain" aria-label="Riwayat percakapan">
            <div className="flex items-center justify-between px-s3 pt-s3">
              <span className="font-display text-title text-ink">Riwayat</span>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Tutup riwayat" className="touch-44 flex items-center justify-center rounded-control text-ink focus-ring"><Icon name="close" className="text-[20px]" /></button>
            </div>
            <div className="h-[calc(100%-3.5rem)]">
              <ChatSidebar
                conversations={conversations}
                activeId={activeId}
                loading={list.loading}
                error={list.error}
                onSelect={(id) => void loadConversation(id)}
                onDelete={setDeleteTarget}
                onPatch={patchConversation}
                onRetry={list.retry}
                onNavigate={() => setHistoryOpen(false)}
              />
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
              {citationTargetPath(sourceDetail) && (
                <Link href={citationTargetPath(sourceDetail)!} className="touch-44 inline-flex items-center gap-s1 font-display text-label font-semibold text-forest focus-ring">Lihat di dokumen<Icon name="arrow_forward" className="text-[16px]" /></Link>
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
        onClose={closeShare}
        title={shareState === 'success' ? 'Tautan siap dibagikan' : 'Bagikan sesi ini?'}
        confirmLabel={shareState === 'success' ? 'Selesai' : 'Buat tautan'}
        cancelLabel={shareState === 'success' ? 'Tutup' : 'Batal'}
        state={shareState}
        errorTitle={shareError ?? 'Tautan gagal dibuat.'}
        onConfirm={() => { if (shareState === 'success') closeShare(); else void confirmShare(); }}
        onRetry={() => void confirmShare()}
      >
        {shareState === 'success' && shareUrl ? (
          <div className="flex flex-col gap-s3">
            <p>Siapa pun yang punya tautan ini dapat membuka sesi dalam mode baca saja.</p>
            <div className="flex flex-col gap-s2">
              <label htmlFor="share-url" className="mono-meta">TAUTAN BAGI</label>
              <div className="flex flex-col gap-s2 sm:flex-row">
                <input
                  id="share-url"
                  readOnly
                  value={shareUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-h-11 w-full min-w-0 flex-1 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s3 font-body text-body text-ink focus-ring"
                />
                <button
                  type="button"
                  onClick={() => void attemptCopyShare(shareUrl)}
                  className="touch-44 shrink-0 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring"
                >
                  Salin
                </button>
              </div>
            </div>
            <p
              role="status"
              aria-live="polite"
              className={`font-body text-caption ${shareCopy === 'manual' ? 'text-ink' : 'text-ink-72'}`}
            >
              {shareCopy === 'copied'
                ? 'Tersalin ke papan klip.'
                : shareCopy === 'manual'
                  ? 'Browser memblokir penyalinan otomatis. Pilih teks di kotak lalu salin manual, atau tekan Salin sekali lagi.'
                  : 'Pilih teks di kotak bila ingin menyalin manual.'}
            </p>
          </div>
        ) : (
          <>
            <p>Pertanyaan dan jawaban akan dapat diakses siapa pun yang punya link.</p>
            <ul className="mt-s3 space-y-s1 font-body text-caption text-ink-72">
              <li>Pesan dalam sesi ini: {detail?.messages.length ?? 0}</li>
              <li>Konteks: {contextLabel}</li>
              <li>Angka dan kutipan mengikuti snapshot pesan.</li>
            </ul>
            <div className="mt-s3 flex flex-col gap-s2">
              <label className="flex min-h-11 items-center gap-s2"><input type="checkbox" checked={includeCitations} onChange={(e) => setIncludeCitations(e.target.checked)} className="h-s3 w-s3 accent-forest" /><span className="font-body text-caption text-ink">Sertakan sitasi</span></label>
              <label className="flex min-h-11 items-center gap-s2"><input type="checkbox" checked={includeIdentity} onChange={(e) => setIncludeIdentity(e.target.checked)} className="h-s3 w-s3 accent-forest" /><span className="font-body text-caption text-ink">Sertakan identitas dokumen</span></label>
            </div>
            {sensitive && (
              <p className="mt-s3 inline-flex items-start gap-s2 rounded-control bg-terracotta-16 p-s2 font-body text-caption text-ink">
                Sesi ini memuat data yang mungkin sensitif. Periksa kembali sebelum membagikan.
              </p>
            )}
          </>
        )}
      </AnimatedModal>
    </div>
  );
}
