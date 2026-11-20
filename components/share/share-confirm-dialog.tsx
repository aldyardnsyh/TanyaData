'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export type ShareOptions = {
  includeCitations: boolean;
  includeIdentity: boolean;
};

/**
 * Konfirmasi wajib sebelum tautan dibuat (SHARE_PAGE_SPEC §7–§8).
 * Tidak ada auto-share. Dua checkbox terpisah, keduanya default tercentang.
 * Radix Dialog memberi focus trap + Escape close; tombol primer memakai
 * focus-ring-forest (lime di atas forest), satu-satunya lime di alur share.
 */
export function ShareConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  busy = false,
  previewUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (options: ShareOptions) => void | Promise<void>;
  busy?: boolean;
  /** GET endpoint opsional untuk flag PII. Gagal fetch → anggap tidak sensitif. */
  previewUrl?: string;
}) {
  const [includeCitations, setIncludeCitations] = useState(true);
  const [includeIdentity, setIncludeIdentity] = useState(true);
  const [sensitive, setSensitive] = useState(false);

  useEffect(() => {
    if (!open || !previewUrl) {
      setSensitive(false);
      return;
    }
    let cancelled = false;
    fetch(previewUrl)
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { sensitive?: boolean } | null) => {
        if (!cancelled) setSensitive(Boolean(json?.sensitive));
      })
      .catch(() => { if (!cancelled) setSensitive(false); });
    return () => { cancelled = true; };
  }, [open, previewUrl]);

  const submit = () => {
    void onConfirm({ includeCitations, includeIdentity });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title="Bagikan sesi ini?"
      description="Pertanyaan & jawaban akan dapat diakses siapa pun yang punya link."
    >
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-1 font-body text-body-md text-ink">
          <input
            type="checkbox"
            checked={includeCitations}
            onChange={(event) => setIncludeCitations(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-primary focus-ring"
          />
          Sertakan sitasi
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-1 font-body text-body-md text-ink">
          <input
            type="checkbox"
            checked={includeIdentity}
            onChange={(event) => setIncludeIdentity(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-primary focus-ring"
          />
          Sertakan identitas dokumen
        </label>
      </div>

      {sensitive && (
        <p role="status" className="rounded-control border border-signal-terracotta bg-surface p-3 font-body text-body-sm text-error-text">
          Sesi ini memuat data yang mungkin sensitif. Periksa kembali sebelum membagikan.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Batal</Button>
        <Button variant="primary" onClick={submit} loading={busy}>Buat tautan</Button>
      </div>
    </Dialog>
  );
}
