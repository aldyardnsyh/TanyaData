'use client';

import { useEffect, useRef } from 'react';

/**
 * Reveal saat elemen masuk viewport (pola atlas-rise kanjikan; Aceternity
 * whileInView tanpa framer-motion). Purpose Gate: mengatur ritme baca section
 * landing, bukan scroll-jacking: tanpa parallax, tanpa pin, animasi sekali
 * lalu berhenti.
 *
 * Ketahanan: server merender data-reveal="in" (terlihat), lalu JS hanya
 * menyembunyikan elemen yang benar-benar di bawah viewport saat mount. Jadi
 * tanpa JS, saat print, dan saat lompat anchor, konten tetap terlihat.
 * Fallback 2 detik membalik semua state "out" ke "in" bila observer tidak
 * pernah terpicu (misalnya tangkapan layar full-page), sehingga konten tidak
 * pernah hilang lebih dari 2 detik. Reduced-motion: elemen langsung "in".
 */
export function ScrollReveal({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Delay transisi (ms) untuk stagger ringan antar elemen hero. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => el.setAttribute('data-reveal', 'in');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reveal();
      return;
    }
    const rect = el.getBoundingClientRect();
    const belowFold = rect.top >= window.innerHeight;
    if (!belowFold) {
      reveal();
      return;
    }
    el.setAttribute('data-reveal', 'out');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal();
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    );
    io.observe(el);
    const fallback = window.setTimeout(() => {
      reveal();
      io.disconnect();
    }, 2000);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-reveal="in"
      className={className}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
