'use client';

import { useEffect } from 'react';

/**
 * §6.3.6: hentikan loop saat tab tidak aktif.
 * Menandai <html> agar CSS `animation-play-state: paused` berlaku pada
 * dua loop yang diizinkan (typing indicator + skeleton saat proses nyata).
 */
export function MotionVisibility() {
  useEffect(() => {
    const apply = () => {
      if (typeof document === 'undefined') return;
      document.documentElement.dataset.tabHidden =
        document.visibilityState === 'hidden' ? 'true' : 'false';
    };
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => document.removeEventListener('visibilitychange', apply);
  }, []);
  return null;
}
