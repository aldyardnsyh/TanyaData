'use client';

import { useEffect, useRef, useState } from 'react';
import { motionTokens, shouldAnimate } from './motion-tokens';

/**
 * Count-up sekali saat mount/perubahan data (DESIGN_DIRECTION §5.1 / motion #2).
 * 320ms, ease-out-expo. Hover replay = emphasis 120ms, BUKAN hitung ulang penuh.
 * SSR-aman: render pertama mengikuti server (nilai akhir).
 */
export function useCountUp(target: number | null, replayToken = 0): number | null {
  const [value, setValue] = useState<number | null>(target);
  const animatedFor = useRef<number | null>(null);
  const lastToken = useRef(replayToken);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      animatedFor.current = null;
      return;
    }
    const tokenChanged = lastToken.current !== replayToken;
    lastToken.current = replayToken;
    if (animatedFor.current === target && !tokenChanged) return;
    animatedFor.current = target;

    if (!shouldAnimate()) {
      setValue(target);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const duration = motionTokens.duration.slow * 1000;
    setValue(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(target * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else setValue(target);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, replayToken]);

  return value;
}
