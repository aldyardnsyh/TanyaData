import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: { absolute: '404 · TanyaData' },
};

/** B-01: 404 branded — dokumen + tanda tanya (SVG stroke 1,5, currentColor), satu jalan pulang. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="flex max-w-md flex-col items-center gap-4 py-12 text-center">
        <svg
          className="h-24 w-24 text-outline"
          viewBox="0 0 96 96"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Dokumen */}
          <path d="M28 14h28l14 14v54a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" />
          <path d="M56 14v14h14" />
          <path d="M34 44h20" />
          <path d="M34 54h14" />
          {/* Tanda tanya */}
          <path d="M52 64c0-4 3-6 6.5-6 3.4 0 6 2.2 6 5.4 0 3.9-4.6 4.4-6 7.6" />
          <path d="M58.5 76.5v.1" />
        </svg>
        <h1 className="font-display text-headline-lg text-on-surface">Halaman tidak ditemukan</h1>
        <p className="font-body text-body-md text-on-surface-variant">
          Alamat ini tidak tersedia pada workspace TanyaData.
        </p>
        <Link
          href="/assistant"
          className="inline-flex h-11 items-center rounded-md border border-outline-variant bg-surface-container-lowest px-5 font-body text-label-md text-on-surface transition-colors duration-[var(--motion-fast)] hover:bg-surface-container focus-ring"
        >
          Kembali ke Asisten
        </Link>
      </div>
    </main>
  );
}
