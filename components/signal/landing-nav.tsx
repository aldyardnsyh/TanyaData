'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * Navbar melayang yang membalik kulit mengikuti section di bawahnya (arah
 * user): di atas section gelap nav jadi terang, di atas section terang nav
 * jadi gelap, supaya tidak tenggelam dan selalu terbaca.
 * Purpose Gate: keterbacaan navigasi yang melayang melintasi band
 * selang-seling; perubahan warna adalah informasi posisi, bukan dekorasi.
 * Scroll-spy membaca atribut data-nav-theme tiap section dan membalik kulit
 * nav (kebalikan tema section). Transisi warna 600ms dengan easing lembut
 * supaya peralihan antar section terasa mulus; reduced-motion membuatnya
 * langsung berganti.
 * Shadow float muncul setelah scroll untuk memisahkan nav dari konten.
 */
const LINKS = [
  { href: '#fitur', label: 'Fitur' },
  { href: '#cara-kerja', label: 'Cara kerja' },
  { href: '#workspace', label: 'Workspace' },
  { href: '#faq', label: 'FAQ' },
] as const;

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  // 'dark' = nav gelap (di atas section terang), 'light' = nav terang (di atas section gelap).
  const [skin, setSkin] = useState<'dark' | 'light'>('dark');
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const update = () => {
      const nav = navRef.current;
      if (!nav) return;
      const rect = nav.getBoundingClientRect();
      const probeY = rect.top + rect.height / 2;
      let found: string | null = null;
      for (const sec of Array.from(document.querySelectorAll<HTMLElement>('[data-nav-theme]'))) {
        const r = sec.getBoundingClientRect();
        if (r.top <= probeY && r.bottom >= probeY) {
          found = sec.dataset.navTheme ?? null;
          break;
        }
      }
      if (found === 'dark') setSkin('light');
      else if (found === 'light') setSkin('dark');
      // Di celah antar section: pertahankan kulit terakhir agar tidak kedip.
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const skinText = skin === 'dark' ? 'text-porcelain' : 'text-ink';
  const skinLink = skin === 'dark' ? 'text-dark-muted hover:text-porcelain' : 'text-ink-72 hover:text-ink';

  return (
    <header className="pointer-events-none fixed inset-x-0 top-s2 z-sticky flex justify-center px-s2">
      <nav
        ref={navRef}
        aria-label="Navigasi landing"
        data-skin={skin}
        className={`pointer-events-auto flex w-full max-w-[1080px] items-center justify-between gap-s3 rounded-chip border px-s3 py-s2 transition-[background-color,border-color,box-shadow] duration-[600ms] ease-[var(--ease-smooth)] ${
          scrolled ? 'shadow-float' : ''
        } ${
          skin === 'dark'
            ? 'border-hairline-dark bg-[color-mix(in_srgb,var(--color-forest)_94%,transparent)]'
            : 'border-[color-mix(in_srgb,var(--color-ink)_14%,transparent)] bg-[color-mix(in_srgb,var(--color-porcelain)_94%,transparent)]'
        }`}
      >
        <Link
          href="/"
          className="touch-44 inline-flex items-center gap-s2 focus-ring"
          aria-label="TanyaData, kembali ke atas"
        >
          <span className="state-dot state-dot-active" aria-hidden="true" />
          <span
            className={`font-display text-label font-bold tracking-[-0.01em] transition-colors duration-[600ms] ease-[var(--ease-smooth)] ${skinText}`}
          >
            TanyaData
          </span>
        </Link>
        <div className="hidden items-center gap-s4 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`inline-flex min-h-11 items-center font-body text-body underline-offset-2 transition-colors duration-[600ms] ease-[var(--ease-smooth)] focus-ring ${skinLink}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <Link
          href="/overview"
          className="touch-44 inline-flex items-center rounded-chip bg-lime px-s3 font-display text-label font-semibold text-ink transition-[box-shadow,transform] duration-[var(--motion-expand)] hover:shadow-[0_0_32px_color-mix(in_srgb,var(--color-lime)_28%,transparent)] active:scale-[var(--scale-press)] focus-ring-forest motion-reduce:transform-none"
        >
          Coba data contoh
        </Link>
      </nav>
    </header>
  );
}
