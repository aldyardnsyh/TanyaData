'use client';

/**
 * Composer chat (components/chat/chat-composer.tsx): textarea auto-grow,
 * chip konteks, ikon lampir dokumen/pilih dokumen/periode, tombol kirim
 * bulat. Composer bagian aliran bawah kolom chat — bukan sticky mengambang.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { SourcesListResponse } from '@/lib/contracts/http';
import { Icon } from '@/components/ui/icons';
import { GlowingCTA } from '@/components/signal/glowing-cta';
import { toast } from '@/components/ui/toaster';

interface ChatComposerProps {
  draft: string;
  sending: boolean;
  contextLabel: string;
  hasAttachment: boolean;
  docs: SourcesListResponse['items'];
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onDetach: () => void;
  onFilePick: (file: File) => void;
  /** Terapkan kelompok dokumen sebagai basis pengetahuan percakapan. */
  onAttachSources: (docs: Array<{ id: string; name: string }>) => void;
}

export function ChatComposer({
  draft, sending, contextLabel, hasAttachment, docs,
  onDraftChange, onSend, onDetach, onFilePick, onAttachSources,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<'source' | null>(null);
  // Pilihan kelompok dokumen (NotebookLM-style): centang beberapa, terapkan sekali.
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyPicked = () => {
    const selected = docs.filter((d) => picked.has(d.id)).map((d) => ({ id: d.id, name: d.name }));
    if (!selected.length) return;
    onAttachSources(selected);
    setPicked(new Set());
    setMenu(null);
  };

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="border-t border-[var(--border-hairline)] bg-porcelain px-s3 pb-s3 pt-s3 md:px-s4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="relative rounded-card-lg border border-[var(--border-hairline)] bg-porcelain p-s2 elevated">
          {/* Chip konteks: dokumen aktif / seluruh dokumen + hapus konteks. */}
          <div className="mb-s2 flex flex-wrap items-center justify-between gap-s1 px-s1">
            <span className="inline-flex flex-wrap items-center gap-s2">
              <span
                className={`inline-flex min-h-8 items-center gap-s1 rounded-chip border px-s2 ${hasAttachment ? 'border-forest bg-forest-08' : 'border-[var(--border-hairline)]'}`}
                title={hasAttachment ? 'Konteks chat diarahkan ke dokumen ini (FR-C)' : 'Tanpa dokumen terlampir: pertanyaan memakai seluruh dokumen terindeks'}
              >
                <Icon name="description" className={`text-[14px] ${hasAttachment ? 'text-forest' : 'text-ink-72'}`} />
                <span className="max-w-[220px] truncate font-mono text-[11px] uppercase tracking-[0.06em] text-ink">{contextLabel}</span>
                {hasAttachment && <span className="font-mono text-[10px] uppercase text-forest">AKTIF</span>}
              </span>
              {/* Petunjuk eksplisit: dari mana pertanyaan dijawab + cara membatasi. */}
              {!hasAttachment && (
                <button
                  type="button"
                  onClick={() => setMenu(menu === 'source' ? null : 'source')}
                  className="touch-44 inline-flex items-center rounded-control px-s1 font-body text-caption text-ink-72 transition-colors hover:text-forest focus-ring"
                >
                  Batasi ke satu dokumen
                </button>
              )}
            </span>
            {hasAttachment && (
              <button type="button" onClick={onDetach} className="touch-44 inline-flex items-center gap-s1 rounded-control px-s2 font-body text-caption text-ink-72 transition-colors hover:text-ink focus-ring">
                <Icon name="close" className="text-[14px]" /> Hapus konteks
              </button>
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            disabled={sending}
            aria-label="Tanyakan sesuatu tentang data"
            placeholder="Tanyakan metrik, tren, anomali, atau prosedur"
            className="w-full resize-none bg-transparent px-s2 py-s1 font-body text-body text-ink placeholder:text-ink-72 focus-ring"
          />

          <div className="mt-s1 flex items-center justify-between gap-s2 px-s1">
            <div className="flex items-center gap-s1">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="sr-only"
                aria-label="Lampirkan dokumen"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFilePick(f); }}
              />
              <button type="button" aria-label="Unggah dokumen baru" title="Unggah dokumen baru" onClick={() => fileInputRef.current?.click()} className="touch-44 flex items-center justify-center rounded-control text-ink-72 transition-colors hover:bg-forest-08 hover:text-forest focus-ring"><Icon name="attach_file" className="text-[20px]" /></button>
              <div className="relative">
                <button
                  type="button"
                  aria-label="Pilih dokumen sebagai konteks"
                  title="Pilih dokumen sebagai konteks"
                  aria-expanded={menu === 'source'}
                  onClick={() => setMenu(menu === 'source' ? null : 'source')}
                  className={`touch-44 inline-flex items-center gap-s1 rounded-control px-s2 font-display text-label font-semibold transition-colors focus-ring ${menu === 'source' ? 'bg-forest-08 text-forest' : 'text-ink-72 hover:bg-forest-08 hover:text-forest'}`}
                >
                  <Icon name="folder_open" className="text-[18px]" /> <span className="hidden sm:inline">Dokumen</span>
                </button>
                {menu === 'source' && (
                  <div role="listbox" aria-label="Pilih dokumen sebagai basis pengetahuan chat" className="absolute bottom-full left-0 z-dropdown mb-s1 max-h-80 w-80 overflow-y-auto rounded-control border border-[var(--border-hairline)] bg-porcelain p-s2 elevated">
                    <p className="px-s2 pb-s1 font-body text-caption text-ink-72">
                      Centang satu atau beberapa dokumen sebagai basis pengetahuan percakapan ini.
                    </p>
                    {docs.length === 0 && (
                      <p className="px-s2 py-s2 font-body text-caption text-ink-72">Belum ada dokumen READY. Unggah dari Sumber Data.</p>
                    )}
                    {docs.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        role="option"
                        aria-selected={picked.has(doc.id)}
                        onClick={() => togglePick(doc.id)}
                        className={`flex w-full items-center gap-s2 rounded-control px-s2 py-s2 text-left transition-colors hover:bg-forest-08 focus-ring ${picked.has(doc.id) ? 'bg-forest-08' : ''}`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${picked.has(doc.id) ? 'border-forest bg-forest' : 'border-[var(--border-hairline)]'}`} aria-hidden="true">
                          {picked.has(doc.id) && <Icon name="check" className="text-[12px] text-porcelain" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-body text-caption text-ink">{doc.name}</span>
                          <span className="mono-meta">{doc.format.toUpperCase()} · READY</span>
                        </span>
                      </button>
                    ))}
                    {picked.size > 0 && (
                      <button
                        type="button"
                        onClick={applyPicked}
                        className="mt-s1 w-full rounded-control bg-forest px-s2 py-s2 font-display text-label font-semibold text-porcelain focus-ring"
                      >
                        Gunakan {picked.size} dokumen sebagai konteks
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onSend}
              disabled={sending || draft.trim().length === 0}
              aria-label="Kirim pesan"
              className="touch-44 flex h-11 w-11 items-center justify-center rounded-full bg-forest text-porcelain transition-opacity hover:opacity-90 disabled:opacity-40 focus-ring"
            >
              {sending ? <Icon name="hourglass_top" className="text-[20px]" /> : <Icon name="arrow_upward" className="text-[20px]" />}
            </button>
          </div>
        </div>
        <p className="mt-s1 hidden px-s2 font-body text-caption text-ink-72 sm:block">Enter kirim · Shift+Enter baris baru</p>
      </div>
    </div>
  );
}
