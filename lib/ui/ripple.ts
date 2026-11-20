'use client';

import { useCallback, type PointerEvent } from 'react';
import { motionTokens } from './motion-tokens';

/**
 * Purpose Gate: ripple WAAPI memberi konfirmasi klik pada CTA utama.
 * Reduced-motion → return lebih awal (0ms, tanpa elemen baru dibuat).
 * Tidak ada loop; ripple dibuang setelah animasi selesai.
 */
export function useRipple<T extends HTMLElement>() {
  return useCallback((event: PointerEvent<T>) => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const host = event.currentTarget;
    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = [
      'position:absolute',
      `left:${event.clientX - rect.left - size / 2}px`,
      `top:${event.clientY - rect.top - size / 2}px`,
      `width:${size}px`,
      `height:${size}px`,
      'border-radius:9999px',
      'background:currentColor',
      'opacity:0.18',
      'pointer-events:none',
    ].join(';');
    host.appendChild(dot);

    const animation = dot.animate(
      [
        { transform: 'scale(0)', opacity: 0.18 },
        { transform: 'scale(1)', opacity: 0 },
      ],
      {
        duration: motionTokens.duration.normal * 1000,
        easing: `cubic-bezier(${motionTokens.easing.smooth.join(',')})`,
      },
    );
    animation.onfinish = () => dot.remove();
    animation.oncancel = () => dot.remove();
  }, []);
}
