'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlowingCTA } from '@/components/signal/glowing-cta';

/**
 * CTA navigasi landing menuju Overview, tempat data contoh sudah siap.
 * Purpose Gate: satu CTA menyala di hero dan satu di band CTA akhir; keduanya
 * menuju rute nyata yang ada (LandingCopySEO §2-S1/S7).
 * Microcopy state dari LANDING_COPY_SEO §4: loading "Membuka...", error
 * "Gagal membuka. Coba lagi." Success = halaman Overview tampil, sehingga
 * state sukses tidak pernah terlihat di halaman ini.
 */
export function LandingCTA({
  tone = 'light',
  className = '',
}: {
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = () => {
    setFailed(false);
    setNavigating(true);
    void (async () => {
      try {
        await router.push('/overview');
      } catch {
        setNavigating(false);
        setFailed(true);
      }
    })();
  };

  if (failed) {
    return (
      <div className={`flex flex-col items-start gap-s2 ${className}`} role="alert">
        <span className="inline-flex items-center gap-s2">
          <span className="state-dot state-dot-error" aria-hidden="true" />
          <span className="font-body text-body text-ink">Gagal membuka. Coba lagi.</span>
        </span>
        <button
          type="button"
          onClick={open}
          className="touch-44 rounded-control border border-forest px-s3 font-display text-label font-semibold text-forest focus-ring"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  return (
    <GlowingCTA
      onClick={open}
      state={navigating ? 'loading' : 'default'}
      tone={tone}
      loadingLabel="Membuka..."
      className={className}
    >
      Coba dengan data contoh
    </GlowingCTA>
  );
}
