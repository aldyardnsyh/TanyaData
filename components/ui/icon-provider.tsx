'use client';

import { LucideProvider } from 'lucide-react';

/**
 * A-07 / §2.6: satu sumber stroke ikon untuk seluruh aplikasi.
 * LucideProvider menetapkan strokeWidth 1,5 + currentColor sebagai default
 * bagi semua ikon, sehingga tidak ada ikon yang jatuh ke bawaan 2.
 */
export function IconProvider({ children }: { children: React.ReactNode }) {
  return <LucideProvider strokeWidth={1.5}>{children}</LucideProvider>;
}
