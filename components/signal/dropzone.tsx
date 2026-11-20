'use client';

import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/icons';

/**
 * Dropzone unggah (Aceternity-informed, TanyaData-specific).
 * Purpose Gate: satu area jelas untuk satu aksi unggah. Bukan dekorasi.
 * State: default · hover border forest · focus ring · active dragging ·
 * loading (busy) · empty n/a (dropzone selalu punya target) · error via toast
 * · success via toast. Target sentuh 44px, keyboard Enter/Space membuka picker.
 */
export function Dropzone({
  onFiles,
  accept = '.csv,.xlsx,.pdf,.docx,.txt,.md',
  label = 'Letakkan file di sini atau pilih file',
  hint = 'CSV, XLSX, PDF, DOCX, TXT, MD. Maksimal 25 MB.',
  busy = false,
  className = '',
}: {
  onFiles: (files: FileList | null) => void;
  accept?: string;
  label?: string;
  hint?: string;
  busy?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) onFiles(event.dataTransfer.files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!busy) inputRef.current?.click();
    }
  };

  return (
    <div className={className}>
      <input ref={inputRef} type="file" accept={accept} className="sr-only" aria-label="Pilih file untuk diunggah" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-busy={busy || undefined}
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        onClick={() => { if (!busy) inputRef.current?.click(); }}
        className={`flex min-h-37 flex-col items-center justify-center rounded-control border border-dashed bg-forest-08 px-s3 py-s4 text-center transition-colors duration-[var(--motion-fast)] hover:border-forest focus-ring ${dragging ? 'border-forest' : 'border-[var(--border-hairline)]'} ${busy ? 'opacity-60' : ''}`}
      >
        <Icon name="cloud_upload" className="text-[28px] text-forest" />
        <p className="mt-s3 font-display text-label font-semibold text-ink">{busy ? 'Memproses berkas' : label}</p>
        <p className="mt-s1 font-body text-caption text-ink-72">{hint}</p>
      </div>
    </div>
  );
}
