'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * C-07 / §3.2: count-up angka 600ms sekali per muat.
 * SSR-aman: render pertama mengikuti server (nilai akhir), lalu efek menganimasikan
 * dari 0 ke target sekali saat data tersedia. Reduced-motion langsung ke nilai akhir.
 */
export function useCountUp(target: number | null, durationMs = 600): number | null {
  const [value, setValue] = useState<number | null>(target);
  const animatedFor = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      animatedFor.current = null;
      return;
    }
    if (animatedFor.current === target) return;
    animatedFor.current = target;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    setValue(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
      setValue(target * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else setValue(target);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
