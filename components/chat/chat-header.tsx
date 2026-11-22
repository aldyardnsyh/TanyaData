'use client';

/**
 * Header chat ramping ala ChatGPT (components/chat/chat-header.tsx):
 * judul percakapan + tombol percakapan baru. Chip konteks/periode/mode
 * DIHAPUS — info konteks sudah hidup di chip composer, jumlah pesan di
 * sidebar, dan periode bisa langsung ditanyakan ke asisten. Bagian dari
 * kolom chat — tidak menggulir bersama pesan.
 */
import { Icon } from '@/components/ui/icons';

interface ChatHeaderProps {
  title: string;
  loading: boolean;
  onNew: () => void;
  onOpenHistory: () => void;
}

export function ChatHeader({ title, loading, onNew, onOpenHistory }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-s2 border-b border-[var(--border-hairline)] bg-porcelain px-s3 py-s2">
      {loading ? (
        <span className="animate-skeleton h-s5 w-48 rounded-control bg-forest-08" aria-hidden="true" />
      ) : (
        <span className="truncate font-display text-title text-ink">{title}</span>
      )}
      <div className="flex shrink-0 items-center gap-s1">
        <button
          type="button"
          onClick={onNew}
          aria-label="Percakapan baru"
          title="Percakapan baru"
          className="touch-44 inline-flex items-center gap-s1 rounded-control border border-forest px-s2 font-display text-label font-semibold text-forest transition-colors hover:bg-forest-08 focus-ring"
        >
          <Icon name="add" className="text-[16px]" /> <span className="hidden sm:inline">Baru</span>
        </button>
        <button
          type="button"
          onClick={onOpenHistory}
          aria-label="Riwayat percakapan"
          className="touch-44 inline-flex items-center justify-center rounded-control text-ink-72 transition-colors hover:text-ink focus-ring lg:hidden"
        >
          <Icon name="history" className="text-[18px]" />
        </button>
      </div>
    </header>
  );
}
