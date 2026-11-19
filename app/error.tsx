'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log untuk developer; user tidak melihat stack trace.
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-6">
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container text-outline">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h1 className="font-display text-headline-sm font-semibold text-on-surface">Halaman gagal dimuat</h1>
        <p className="max-w-sm font-body text-body-md text-on-surface-variant">{error.message}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-body text-label-md font-semibold text-on-primary transition-colors duration-[var(--motion-fast)] hover:bg-primary-container focus-ring"
        >
          Coba lagi
        </button>
      </div>
    </div>
  );
}
