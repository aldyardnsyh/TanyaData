'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Navbar melayang landing (pola Floating Navbar Aceternity, band gelap forest).
 * Purpose Gate: nav berisi hanya anchor ke section yang benar-benar ada di
 * halaman ini dan satu rute nyata (/overview), tanpa tautan mati (R-24).
 * Bayangan float muncul setelah scroll untuk memisahkan nav dari konten; di
 * atas hero gelap nav menyatu, di section terang tetap terbaca karena band-nya
 * sendiri gelap.
 */
const LINKS = [
  { href: '#bukti', label: 'Bukti' },
  { href: '#cara-kerja', label: 'Cara kerja' },
  { href: '#format', label: 'Format' },
  { href: '#audit', label: 'Jejak audit' },
  { href: '#privasi', label: 'Privasi' },
] as const;

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-s2 z-sticky flex justify-center px-s2">
      <nav
        aria-label="Navigasi landing"
        data-scrolled={scrolled}
        className={`pointer-events-auto flex w-full max-w-[1080px] items-center justify-between gap-s3 rounded-chip border border-hairline-dark bg-forest px-s3 py-s2 transition-[box-shadow,background-color] duration-[var(--motion-expand)] ${
          scrolled ? 'shadow-float bg-[color-mix(in_srgb,var(--color-forest)_94%,transparent)]' : 'bg-forest'
        }`}
      >
        <Link href="/" className="touch-44 inline-flex items-center gap-s2 focus-ring" aria-label="TanyaData, kembali ke atas">
          <span className="state-dot state-dot-active" aria-hidden="true" />
          <span className="font-display text-label font-bold tracking-[-0.01em] text-porcelain">TanyaData</span>
        </Link>
        <div className="hidden items-center gap-s4 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center font-body text-body text-dark-muted underline-offset-2 transition-colors duration-[var(--motion-fast)] hover:text-porcelain focus-ring"
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
