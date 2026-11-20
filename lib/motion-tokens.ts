/**
 * UI_REFACTOR_DESIGN.md §6 — motion system baru (10 signature).
 * Semua durasi/easing berasal dari sini dan dari token CSS di globals.css.
 * Komponen dilarang menulis angka durasi inline.
 *
 * Purpose Gate tiap signature tertulis di docs/UI_REFACTOR_DESIGN.md §6.
 */
export const motionTokens = {
  duration: {
    instant: 0.08, // tooltip, focus ring
    fast: 0.12, // spotlight halo, backdrop
    normal: 0.16, // tab indicator, dock, bento masuk
    node: 0.2, // timeline node, toast
    expand: 0.22, // reveal grid
    sweep: 0.24, // attention border, modal
    slow: 0.32, // batas atas perubahan data
  },
  easing: {
    smooth: [0.22, 1, 0.36, 1],
    sharp: [0.4, 0, 0.2, 1],
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

/** Spring ringan untuk dock item aktif (M2). */
export const springs = {
  dock: { type: 'spring', stiffness: 320, damping: 28 },
  gentle: { type: 'spring', stiffness: 180, damping: 20 },
} as const;

/** Gate: reduced-motion → 0ms, tanpa transform. Tidak ada pengecualian. */
export function shouldAnimate(): boolean {
  if (typeof window === 'undefined') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Hentikan loop yang masih berjalan saat tab tersembunyi (§6 aturan 7). */
export function onVisible(play: () => void, stop: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const handler = () => (document.visibilityState === 'hidden' ? stop() : play());
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
