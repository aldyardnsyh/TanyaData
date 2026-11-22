'use client';

/**
 * Sidebar riwayat percakapan (components/chat/chat-sidebar.tsx).
 * Kolom tersendiri dengan scroll independen — tidak ikut menggulir area chat.
 * Dipakai di desktop (rail) dan mobile (isi sheet).
 * Item memakai menu ⋯ ala ChatGPT/Claude: Sematkan, Ganti nama,
 * Pindahkan ke grup, Hapus. Percakapan bisa dikelompokkan per topik;
 * tiap grup bisa dibuka-tutup.
 */
import { useMemo, useState } from 'react';
import type { ConversationSummary } from '@/lib/contracts/http';
import { Icon } from '@/components/ui/icons';
import { StatusDot } from '@/components/signal/status-dot';

export function wibTime(iso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)).replace(':', '.');
}

export type ConversationPatch = { title?: string; group?: string | null; pinned?: boolean };

interface ChatSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onDelete: (conv: ConversationSummary) => void;
  onPatch: (conv: ConversationSummary, patch: ConversationPatch) => Promise<void>;
  onRetry: () => void;
  /** Item dipilih dari sheet mobile → tutup sheet. */
  onNavigate?: () => void;
}

function ConversationItem({
  conv, active, onOpen, onPatch, onDelete, renaming, onBeginRename, onEndRename,
}: {
  conv: ConversationSummary;
  active: boolean;
  onOpen: () => void;
  onPatch: (patch: ConversationPatch) => Promise<void>;
  onDelete: () => void;
  renaming: boolean;
  onBeginRename: () => void;
  onEndRename: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [groupMode, setGroupMode] = useState<'closed' | 'list' | 'new'>('closed');
  const [newGroup, setNewGroup] = useState('');

  const saveRename = async () => {
    if (!editTitle.trim() || saving) return;
    setSaving(true);
    try {
      await onPatch({ title: editTitle.trim() });
      onEndRename();
    } finally {
      setSaving(false);
    }
  };

  if (renaming) {
    return (
      <div className="flex flex-col gap-s2 rounded-control border border-forest bg-forest-08 px-s2 py-s2">
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') onEndRename(); }}
          maxLength={60}
          aria-label="Judul percakapan"
          className="min-h-11 w-full rounded-control border border-[var(--border-hairline)] bg-porcelain px-s2 font-display text-label text-ink focus-ring"
          autoFocus
        />
        <div className="flex gap-s1">
          <button type="button" onClick={onEndRename} className="touch-44 rounded-control border border-[var(--border-hairline)] px-s2 font-display text-label text-ink focus-ring">Batal</button>
          <button type="button" onClick={() => void saveRename()} disabled={!editTitle.trim() || saving} className="touch-44 rounded-control bg-forest px-s2 font-display text-label font-semibold text-porcelain focus-ring disabled:opacity-50">{saving ? 'Menyimpan' : 'Simpan'}</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative flex min-w-0 items-start rounded-control border transition-[border-color,box-shadow] duration-[var(--motion-expand)] hover:border-forest hover:shadow-lift ${active ? 'border-forest bg-forest-08' : 'border-[var(--border-hairline)] bg-porcelain'}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        className="min-w-0 flex-1 rounded-control px-s2 py-s2 text-left focus-ring"
      >
        <span className="flex items-center gap-s1">
          {conv.pinned && <Icon name="push_pin" className="shrink-0 text-[12px] text-forest" aria-hidden="true" />}
          <span className="truncate font-display text-label font-semibold text-ink">{conv.title}</span>
        </span>
        {conv.preview && <span className="block truncate font-body text-caption text-ink-72">{conv.preview}</span>}
        <span className="mt-s1 block truncate font-mono text-[11px] uppercase tracking-[0.06em] text-ink-72">
          {conv.messageCount} PESAN{conv.lastMessageAt ? ` · ${wibTime(conv.lastMessageAt)} WIB` : ''}
        </span>
      </button>

      {/* Menu ⋯ ala ChatGPT/Claude: satu titik masuk untuk semua aksi sesi. */}
      <div className="relative shrink-0 self-center">
        <button
          type="button"
          aria-label={`Menu percakapan ${conv.title}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={`touch-44 flex items-center justify-center rounded-control px-s1 text-ink-72 transition-colors hover:bg-forest-08 hover:text-forest focus-ring ${menuOpen ? 'bg-forest-08 text-forest' : ''}`}
        >
          <Icon name="more_vert" className="text-[18px]" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-dropdown" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div role="menu" aria-label={`Aksi percakapan ${conv.title}`} className="absolute right-0 top-full z-dropdown mt-s1 w-56 rounded-control border border-[var(--border-hairline)] bg-porcelain p-s1 elevated">
              <button
                type="button"
                role="menuitem"
                onClick={() => { void onPatch({ pinned: !conv.pinned }); setMenuOpen(false); }}
                className="flex w-full items-center gap-s2 rounded-control px-s2 py-s2 text-left font-body text-caption text-ink transition-colors hover:bg-forest-08 focus-ring"
              >
                <Icon name="push_pin" className="text-[16px] text-ink-72" /> {conv.pinned ? 'Lepas sematan' : 'Sematkan'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { onBeginRename(); setMenuOpen(false); }}
                className="flex w-full items-center gap-s2 rounded-control px-s2 py-s2 text-left font-body text-caption text-ink transition-colors hover:bg-forest-08 focus-ring"
              >
                <Icon name="edit" className="text-[16px] text-ink-72" /> Ganti nama
              </button>
              <div className="my-s1 border-t border-[var(--border-hairline)]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => setGroupMode(groupMode === 'list' ? 'closed' : 'list')}
                aria-expanded={groupMode === 'list'}
                className="flex w-full items-center justify-between gap-s2 rounded-control px-s2 py-s2 text-left font-body text-caption text-ink transition-colors hover:bg-forest-08 focus-ring"
              >
                <span className="flex items-center gap-s2"><Icon name="folder" className="text-[16px] text-ink-72" /> Pindahkan ke grup</span>
                <Icon name={groupMode === 'list' ? 'expand_less' : 'expand_more'} className="text-[16px] text-ink-72" />
              </button>
              {groupMode === 'list' && (
                <div className="mb-s1 ml-s4 flex flex-col">
                  {conv.groupName && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { void onPatch({ group: null }); setGroupMode('closed'); setMenuOpen(false); }}
                      className="rounded-control px-s2 py-s1.5 text-left font-body text-caption text-ink-72 transition-colors hover:bg-forest-08 focus-ring"
                    >
                      Tanpa grup
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setGroupMode('new')}
                    className="rounded-control px-s2 py-s1.5 text-left font-body text-caption text-forest transition-colors hover:bg-forest-08 focus-ring"
                  >
                    + Grup baru…
                  </button>
                </div>
              )}
              {groupMode === 'new' && (
                <div className="mb-s1 ml-s4 flex gap-s1">
                  <input
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newGroup.trim()) {
                        void onPatch({ group: newGroup.trim() });
                        setGroupMode('closed');
                        setMenuOpen(false);
                      }
                    }}
                    placeholder="Nama grup"
                    aria-label="Nama grup baru"
                    maxLength={40}
                    className="min-h-9 min-w-0 flex-1 rounded-control border border-[var(--border-hairline)] bg-porcelain px-s2 font-body text-caption text-ink focus-ring"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={!newGroup.trim()}
                    onClick={() => { void onPatch({ group: newGroup.trim() }); setGroupMode('closed'); setMenuOpen(false); }}
                    className="touch-44 rounded-control bg-forest px-s2 font-display text-label font-semibold text-porcelain focus-ring disabled:opacity-40"
                  >
                    OK
                  </button>
                </div>
              )}
              <div className="my-s1 border-t border-[var(--border-hairline)]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => { onDelete(); setMenuOpen(false); }}
                className="flex w-full items-center gap-s2 rounded-control px-s2 py-s2 text-left font-body text-caption text-terracotta transition-colors hover:bg-terracotta/10 focus-ring"
              >
                <Icon name="delete" className="text-[16px]" /> Hapus
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ChatSidebar({
  conversations, activeId, loading, error, onSelect, onDelete, onPatch, onRetry, onNavigate,
}: ChatSidebarProps) {
  const [query, setQuery] = useState('');
  // Grup yang ditutup user (nama grup → tertutup).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Item yang sedang ganti nama (id).
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(q) || (c.preview ?? '').toLowerCase().includes(q));
  }, [conversations, query]);

  const pinned = filtered.filter((c) => c.pinned);
  const groups = useMemo(() => {
    const map = new Map<string, ConversationSummary[]>();
    for (const c of filtered) {
      if (c.pinned) continue;
      const key = c.groupName ?? '';
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleGroup = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const renderItem = (conv: ConversationSummary) => (
    <ConversationItem
      key={conv.id}
      conv={conv}
      active={activeId === conv.id}
      onOpen={() => { onSelect(conv.id); onNavigate?.(); }}
      onPatch={(patch) => onPatch(conv, patch)}
      onDelete={() => onDelete(conv)}
      renaming={renamingId === conv.id}
      onBeginRename={() => setRenamingId(conv.id)}
      onEndRename={() => setRenamingId(null)}
    />
  );

  const renderGroupHeader = (name: string, count: number) => {
    const isCollapsed = collapsed.has(name);
    return (
      <button
        type="button"
        onClick={() => toggleGroup(name)}
        aria-expanded={!isCollapsed}
        className="mt-s2 flex w-full items-center gap-s1 rounded-control px-s2 py-s1 text-left transition-colors hover:bg-forest-08 focus-ring"
      >
        <Icon name={isCollapsed ? 'expand_more' : 'expand_less'} className="text-[16px] text-ink-72" />
        <span className="truncate font-display text-label font-semibold text-ink">{name}</span>
        <span className="mono-meta">{count}</span>
      </button>
    );
  };

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col">
      <div className="flex items-center justify-between px-s3 pb-s2 pt-s3">
        {/* Satu tombol "Percakapan baru" saja — ada di header chat, bukan di sini. */}
        <span className="mono-meta">PERCAKAPAN · {conversations.length}</span>
      </div>
      <div className="px-s3 pb-s2">
        <label className="relative block">
          <span className="sr-only">Cari percakapan</span>
          <Icon name="search" className="pointer-events-none absolute left-s2 top-1/2 -translate-y-1/2 text-[16px] text-ink-72" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari percakapan"
            className="min-h-11 w-full rounded-control border border-[var(--border-hairline)] bg-porcelain pl-s5 pr-s2 font-body text-caption text-ink placeholder:text-ink-72 focus-ring"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-s2 pb-s3">
        {loading && <div className="skeleton h-40 w-full" aria-busy="true" />}
        {error && (
          <div className="flex flex-col items-start gap-s2 px-s2 py-s2" role="alert">
            <span className="inline-flex items-center gap-s2"><StatusDot tone="error" /><span className="font-body text-caption text-ink">{error}</span></span>
            <button type="button" onClick={onRetry} className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring">Coba lagi</button>
          </div>
        )}
        {!loading && !error && conversations.length === 0 && (
          <p className="px-s2 py-s3 font-body text-caption text-ink-72">Belum ada percakapan. Mulai pertanyaan pertama.</p>
        )}
        {!loading && !error && filtered.length === 0 && conversations.length > 0 && (
          <p className="px-s2 py-s3 font-body text-caption text-ink-72">Tidak ada percakapan yang cocok dengan pencarian.</p>
        )}
        <div className="flex min-w-0 flex-col gap-s1">
          {pinned.length > 0 && (
            <>
              {pinned.length > 1 && <span className="mono-meta mt-s2 px-s2">DISEMATKAN</span>}
              {pinned.map(renderItem)}
            </>
          )}
          {groups.map(([name, items]) =>
            name === '' ? (
              items.map(renderItem)
            ) : (
              <div key={name}>
                {renderGroupHeader(name, items.length)}
                {!collapsed.has(name) && <div className="flex flex-col gap-s1 pl-s2">{items.map(renderItem)}</div>}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
