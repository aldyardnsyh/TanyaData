/**
 * Motion token Precision Console (DESIGN_DIRECTION §6.1 / DECISION-013).
 * Durasi maks 320ms untuk perubahan data. Tidak ada nilai ad-hoc di komponen.
 */
export const motionTokens = {
  duration: {
    instant: 0.08, // tooltip, focus, badge update
    fast: 0.12, // hover, chip, tombol, ripple
    base: 0.18, // entrance, nav indicator, toast
    /** SHARE_PAGE_SPEC §6: entrance halaman share 240ms, tanpa transform. */
    shareEntrance: 0.24,
    slow: 0.32, // count-up, chart draw, dialog, drawer
  },
  easing: {
    outExpo: [0.16, 1, 0.3, 1],
    spring: [0.34, 1.56, 0.64, 1],
    linear: [0, 0, 1, 1],
  },
  distance: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
  },
  scale: {
    subtle: 0.98,
    press: 0.95,
    pop: 1.04,
  },
} as const;

/** Spring presets untuk interaksi langsung (nav, toast, dialog). */
export const springs = {
  snappy: { type: 'spring', stiffness: 420, damping: 32 },
  gentle: { type: 'spring', stiffness: 180, damping: 20 },
  instant: { type: 'spring', stiffness: 600, damping: 38 },
} as const;

/** Gate global: reduced-motion → 0ms, tanpa transform. */
export function shouldAnimate(): boolean {
  if (typeof window === 'undefined') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Hentikan loop saat tab tidak aktif (§6.3.6). */
export function onVisible(play: () => void, stop: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const handler = () => (document.visibilityState === 'hidden' ? stop() : play());
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
